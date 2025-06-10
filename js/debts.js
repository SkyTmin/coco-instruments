const debts = {
    debtsList: [],
    currentDebt: null,
    currentPayment: null,
    customCategories: [],
    confirmCallback: null,
    sortOrder: 'date-desc',

    init() {
        this.loadData();
        this.setupEventListeners();
        this.renderAll();
        this.setToday();
    },

    loadData() {
        const savedDebts = localStorage.getItem('cocoDebts');
        const savedCategories = localStorage.getItem('cocoDebtCategories');
        
        if (savedDebts) {
            try {
                this.debtsList = JSON.parse(savedDebts) || [];
            } catch (e) {
                console.error('Error parsing saved debts:', e);
                this.debtsList = [];
            }
        }
        
        if (savedCategories) {
            try {
                this.customCategories = JSON.parse(savedCategories) || [];
            } catch (e) {
                console.error('Error parsing saved categories:', e);
                this.customCategories = [];
            }
            this.updateCategorySelect();
        }
    },

    saveData() {
        localStorage.setItem('cocoDebts', JSON.stringify(this.debtsList));
        localStorage.setItem('cocoDebtCategories', JSON.stringify(this.customCategories));
    },

    setupEventListeners() {
        // FAB button
        document.getElementById('fab-btn').addEventListener('click', () => {
            this.showCreateForm();
        });

        // Sort select
        document.getElementById('sort-select').addEventListener('change', (e) => {
            this.sortOrder = e.target.value;
            this.renderAll();
        });

        // Debt form
        document.getElementById('debtForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveDebt();
        });

        // Payment form
        document.getElementById('paymentForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addPayment();
        });

        // Payment edit form
        document.getElementById('paymentEditForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.updatePayment();
        });

        // Category select
        document.getElementById('debtCategory').addEventListener('change', (e) => {
            if (e.target.value === 'new') {
                this.saveFormData();
                this.showCategoryModal();
            }
        });

        // Category form
        document.getElementById('categoryForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addCategory();
        });

        // Modal close on backdrop click
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('active');
                }
            });
        });

        // Date change on payment form
        document.getElementById('paymentDate').addEventListener('change', (e) => {
            if (e.target.value) {
                document.getElementById('paymentPreliminary').checked = false;
            }
        });
    },

    showCreateForm() {
        const modal = document.getElementById('debtModal');
        const form = document.getElementById('debtForm');
        const title = document.getElementById('debt-modal-title');
        
        form.reset();
        document.getElementById('debtId').value = '';
        title.textContent = 'Новый долг';
        
        this.setToday();
        modal.classList.add('active');
    },

    hideDebtForm() {
        document.getElementById('debtModal').classList.remove('active');
    },

    setToday() {
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('debtDate').value = today;
        document.getElementById('paymentDate').value = today;
    },

    saveDebt() {
        const id = document.getElementById('debtId').value;
        
        const debtData = {
            id: id || Date.now().toString(),
            name: document.getElementById('debtName').value,
            amount: parseFloat(document.getElementById('debtAmount').value),
            date: document.getElementById('debtDate').value,
            category: document.getElementById('debtCategory').value,
            status: document.getElementById('debtStatus').value,
            note: document.getElementById('debtNote').value,
            payments: id ? (this.getDebtById(id)?.payments || []) : []
        };
        
        if (id) {
            const index = this.debtsList.findIndex(d => d.id === id);
            if (index !== -1) {
                this.debtsList[index] = debtData;
            }
        } else {
            this.debtsList.push(debtData);
        }
        
        this.saveData();
        this.renderAll();
        this.hideDebtForm();
    },

    renderAll() {
        this.sortDebts();
        this.renderDebts();
        this.updateStats();
    },

    sortDebts() {
        switch (this.sortOrder) {
            case 'date-desc':
                this.debtsList.sort((a, b) => new Date(b.date) - new Date(a.date));
                break;
            case 'date-asc':
                this.debtsList.sort((a, b) => new Date(a.date) - new Date(b.date));
                break;
            case 'amount-desc':
                this.debtsList.sort((a, b) => b.amount - a.amount);
                break;
            case 'amount-asc':
                this.debtsList.sort((a, b) => a.amount - b.amount);
                break;
            case 'status':
                const statusOrder = { active: 0, partial: 1, closed: 2 };
                this.debtsList.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
                break;
        }
    },

    renderDebts() {
        const container = document.getElementById('debts-list');
        
        if (this.debtsList.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">💸</div>
                    <p>У вас пока нет долгов</p>
                    <button class="btn btn-primary" onclick="debts.showCreateForm()">
                        Добавить долг
                    </button>
                </div>
            `;
            return;
        }
        
        container.innerHTML = this.debtsList.map(debt => this.createDebtCard(debt)).join('');
    },

    createDebtCard(debt) {
        const payments = debt.payments || [];
        const regularPayments = payments.filter(p => !p.preliminary);
        const totalPaid = regularPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
        const percentage = debt.amount > 0 ? Math.min(100, Math.round((totalPaid / debt.amount) * 100)) : 0;
        
        const statusColors = {
            active: '#2ecc71',
            partial: '#f39c12',
            closed: '#95a5a6'
        };
        
        const statusLabels = {
            active: 'Активный',
            partial: 'Частично погашен',
            closed: 'Погашен'
        };
        
        return `
            <div class="debt-card" onclick="debts.showDetail('${debt.id}')">
                <div class="debt-card-header">
                    <h3>${debt.name || 'Без названия'}</h3>
                    <span class="status-badge" style="background-color: ${statusColors[debt.status]}">
                        ${statusLabels[debt.status]}
                    </span>
                </div>
                <div class="debt-card-info">
                    <div class="info-row">
                        <span class="info-label">Сумма:</span>
                        <span class="info-value amount-value">${this.formatAmount(debt.amount || 0)}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Дата:</span>
                        <span class="info-value">${this.formatDate(debt.date || new Date())}</span>
                    </div>
                    ${debt.category ? `
                        <div class="info-row">
                            <span class="info-label">Категория:</span>
                            <span class="info-value">${this.getCategoryName(debt.category)}</span>
                        </div>
                    ` : ''}
                </div>
                <div class="debt-progress">
                    <div class="progress-bar-mini">
                        <div class="progress-fill-mini" style="width: ${percentage}%; background-color: ${statusColors[debt.status]}"></div>
                    </div>
                    <span class="progress-text-mini">${percentage}%</span>
                </div>
            </div>
        `;
    },

    showDetail(debtId) {
        const debt = this.getDebtById(debtId);
        if (!debt) return;
        
        if (!debt.payments) {
            debt.payments = [];
        }
        
        this.currentDebt = { ...debt };
        
        document.getElementById('detail-debt-title').textContent = debt.name || 'Без названия';
        document.getElementById('detail-debt-amount').textContent = this.formatAmount(debt.amount || 0);
        document.getElementById('detail-debt-date').textContent = this.formatDate(debt.date);
        
        const statusLabels = {
            active: 'Активный',
            partial: 'Частично погашен',
            closed: 'Погашен'
        };
        document.getElementById('detail-debt-status').textContent = statusLabels[debt.status];
        
        const categoryWrapper = document.getElementById('detail-category-wrapper');
        const categoryElement = document.getElementById('detail-debt-category');
        if (debt.category) {
            categoryWrapper.style.display = 'flex';
            categoryElement.textContent = this.getCategoryName(debt.category);
        } else {
            categoryWrapper.style.display = 'none';
        }
        
        const noteWrapper = document.getElementById('detail-note-wrapper');
        const noteElement = document.getElementById('detail-debt-note');
        if (debt.note) {
            noteWrapper.style.display = 'flex';
            noteElement.textContent = debt.note;
        } else {
            noteWrapper.style.display = 'none';
        }
        
        this.renderPayments();
        this.updateDetailStats();
        this.updateProgressBar();
        
        document.getElementById('debtDetailModal').classList.add('active');
    },

    hideDetail() {
        document.getElementById('debtDetailModal').classList.remove('active');
        this.currentDebt = null;
    },

    renderPayments() {
        const container = document.getElementById('payments-list');
        const payments = this.currentDebt.payments || [];
        
        if (payments.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: rgba(123, 75, 42, 0.6);">Погашений пока нет</p>';
            return;
        }
        
        // Separate preliminary and regular payments
        const preliminaryPayments = payments.filter(p => p.preliminary);
        const regularPayments = payments.filter(p => !p.preliminary);
        
        let html = '';
        
        if (preliminaryPayments.length > 0) {
            html += '<div class="payments-group preliminary-group">';
            html += '<h4>Предварительные погашения</h4>';
            html += preliminaryPayments.map(payment => this.createPaymentItem(payment, true)).join('');
            html += '</div>';
        }
        
        if (regularPayments.length > 0) {
            html += '<div class="payments-group">';
            if (preliminaryPayments.length > 0) {
                html += '<h4>Выполненные погашения</h4>';
            }
            html += regularPayments.map(payment => this.createPaymentItem(payment, false)).join('');
            html += '</div>';
        }
        
        container.innerHTML = html;
    },

    createPaymentItem(payment, isPreliminary) {
        const dateText = payment.date ? this.formatDate(payment.date) : 'Без даты';
        return `
            <div class="payment-item ${isPreliminary ? 'preliminary' : ''}" onclick="debts.showPaymentEditForm('${payment.id}')">
                <div class="payment-info">
                    <div class="payment-amount">${this.formatAmount(payment.amount)}</div>
                    <div class="payment-meta">
                        ${payment.date ? `<span>${dateText}</span>` : ''}
                        ${payment.note ? `<span>${payment.note}</span>` : ''}
                        ${isPreliminary ? '<span class="preliminary-badge">Предварительное</span>' : ''}
                    </div>
                </div>
                <button class="payment-delete" onclick="event.stopPropagation(); debts.deletePayment('${payment.id}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
        `;
    },

    addPayment() {
        const isPreliminary = document.getElementById('paymentPreliminary').checked;
        const payment = {
            id: Date.now().toString(),
            amount: parseFloat(document.getElementById('paymentAmount').value),
            date: !isPreliminary ? document.getElementById('paymentDate').value : '',
            note: document.getElementById('paymentNote').value,
            preliminary: isPreliminary
        };
        
        if (!this.currentDebt.payments) {
            this.currentDebt.payments = [];
        }
        
        this.currentDebt.payments.push(payment);
        
        const debtIndex = this.debtsList.findIndex(d => d.id === this.currentDebt.id);
        if (debtIndex !== -1) {
            this.debtsList[debtIndex].payments = this.currentDebt.payments;
            
            // Auto-update status
            this.updateDebtStatus(this.debtsList[debtIndex]);
        }
        
        this.saveData();
        this.renderPayments();
        this.updateDetailStats();
        this.updateProgressBar();
        this.renderAll();
        
        document.getElementById('paymentForm').reset();
        this.setToday();
    },

    showPaymentEditForm(paymentId) {
        const payment = this.currentDebt.payments.find(p => p.id === paymentId);
        if (!payment) return;
        
        this.currentPayment = payment;
        
        document.getElementById('editPaymentId').value = payment.id;
        document.getElementById('editPaymentAmount').value = payment.amount;
        document.getElementById('editPaymentDate').value = payment.date || '';
        document.getElementById('editPaymentNote').value = payment.note || '';
        
        // Show convert checkbox only for preliminary payments
        const convertGroup = document.getElementById('convertPaymentGroup');
        if (payment.preliminary) {
            convertGroup.style.display = 'block';
            document.getElementById('convertToRegular').checked = false;
        } else {
            convertGroup.style.display = 'none';
        }
        
        document.getElementById('paymentEditModal').classList.add('active');
    },

    hidePaymentEditForm() {
        document.getElementById('paymentEditModal').classList.remove('active');
        this.currentPayment = null;
    },

    updatePayment() {
        const paymentId = document.getElementById('editPaymentId').value;
        const paymentIndex = this.currentDebt.payments.findIndex(p => p.id === paymentId);
        
        if (paymentIndex !== -1) {
            const payment = this.currentDebt.payments[paymentIndex];
            payment.amount = parseFloat(document.getElementById('editPaymentAmount').value);
            payment.date = document.getElementById('editPaymentDate').value;
            payment.note = document.getElementById('editPaymentNote').value;
            
            // Convert to regular payment if checkbox is checked
            if (payment.preliminary && document.getElementById('convertToRegular').checked) {
                payment.preliminary = false;
                if (!payment.date) {
                    payment.date = new Date().toISOString().split('T')[0];
                }
            }
            
            const debtIndex = this.debtsList.findIndex(d => d.id === this.currentDebt.id);
            if (debtIndex !== -1) {
                this.debtsList[debtIndex].payments = this.currentDebt.payments;
                this.updateDebtStatus(this.debtsList[debtIndex]);
            }
            
            this.saveData();
            this.renderPayments();
            this.updateDetailStats();
            this.updateProgressBar();
            this.renderAll();
        }
        
        this.hidePaymentEditForm();
    },

    deletePayment(paymentId) {
        this.currentDebt.payments = this.currentDebt.payments.filter(p => p.id !== paymentId);
        
        const debtIndex = this.debtsList.findIndex(d => d.id === this.currentDebt.id);
        if (debtIndex !== -1) {
            this.debtsList[debtIndex].payments = this.currentDebt.payments;
            this.updateDebtStatus(this.debtsList[debtIndex]);
        }
        
        this.saveData();
        this.renderPayments();
        this.updateDetailStats();
        this.updateProgressBar();
        this.renderAll();
    },

    updateDebtStatus(debt) {
        const regularPayments = (debt.payments || []).filter(p => !p.preliminary);
        const totalPaid = regularPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
        
        if (totalPaid >= debt.amount) {
            debt.status = 'closed';
        } else if (totalPaid > 0) {
            debt.status = 'partial';
        } else {
            debt.status = 'active';
        }
    },

    updateDetailStats() {
        const regularPayments = (this.currentDebt.payments || []).filter(p => !p.preliminary);
        const totalPaid = regularPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
        const remaining = Math.max(0, (this.currentDebt.amount || 0) - totalPaid);
        
        document.getElementById('detail-debt').textContent = this.formatAmount(this.currentDebt.amount || 0);
        document.getElementById('detail-paid').textContent = this.formatAmount(totalPaid);
        document.getElementById('detail-remaining').textContent = this.formatAmount(remaining);
    },

    updateProgressBar() {
        const regularPayments = (this.currentDebt.payments || []).filter(p => !p.preliminary);
        const totalPaid = regularPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
        const percentage = this.currentDebt.amount > 0 ? Math.min(100, Math.round((totalPaid / this.currentDebt.amount) * 100)) : 0;
        
        document.getElementById('progress-fill').style.width = `${percentage}%`;
        document.getElementById('progress-text').textContent = `${percentage}%`;
    },

    updateStats() {
        const totalDebts = this.debtsList.length;
        const totalAmount = this.debtsList.reduce((sum, debt) => sum + (debt.amount || 0), 0);
        
        let totalPaid = 0;
        this.debtsList.forEach(debt => {
            const regularPayments = (debt.payments || []).filter(p => !p.preliminary);
            totalPaid += regularPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
        });
        
        const totalRemaining = totalAmount - totalPaid;
        
        document.getElementById('total-debts').textContent = totalDebts;
        document.getElementById('total-debt-amount').textContent = this.formatAmount(totalAmount);
        document.getElementById('total-paid').textContent = this.formatAmount(totalPaid);
        document.getElementById('total-remaining').textContent = this.formatAmount(totalRemaining);
    },

    editCurrentDebt() {
        const debt = this.currentDebt;
        document.getElementById('debtId').value = debt.id;
        document.getElementById('debtName').value = debt.name;
        document.getElementById('debtAmount').value = debt.amount;
        document.getElementById('debtDate').value = debt.date;
        document.getElementById('debtCategory').value = debt.category || '';
        document.getElementById('debtStatus').value = debt.status;
        document.getElementById('debtNote').value = debt.note || '';
        
        document.getElementById('debt-modal-title').textContent = 'Редактировать долг';
        
        this.hideDetail();
        document.getElementById('debtModal').classList.add('active');
    },

    deleteCurrentDebt() {
        const message = `Вы действительно хотите удалить долг "${this.currentDebt.name || 'Без названия'}"? Это действие нельзя отменить.`;
        this.showConfirm(message, () => {
            const index = this.debtsList.findIndex(d => d.id === this.currentDebt.id);
            if (index !== -1) {
                this.debtsList.splice(index, 1);
                this.saveData();
                this.renderAll();
                this.hideDetail();
            }
        });
    },

    exportDebt() {
        const debt = this.currentDebt;
        const regularPayments = (debt.payments || []).filter(p => !p.preliminary);
        const preliminaryPayments = (debt.payments || []).filter(p => p.preliminary);
        const totalPaid = regularPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
        const remaining = Math.max(0, (debt.amount || 0) - totalPaid);
        
        const statusLabels = {
            active: 'Активный',
            partial: 'Частично погашен',
            closed: 'Погашен'
        };
        
        let exportText = `${debt.name || 'Без названия'}\n`;
        exportText += `${'='.repeat(40)}\n\n`;
        exportText += `Дата: ${this.formatDate(debt.date)}\n`;
        exportText += `Сумма долга: ${this.formatAmount(debt.amount || 0)}\n`;
        exportText += `Статус: ${statusLabels[debt.status]}\n`;
        if (debt.category) {
            exportText += `Категория: ${this.getCategoryName(debt.category)}\n`;
        }
        if (debt.note) {
            exportText += `Заметка: ${debt.note}\n`;
        }
        
        exportText += `\nПогашения:\n`;
        exportText += `${'-'.repeat(40)}\n`;
        
        if (preliminaryPayments.length > 0) {
            exportText += `\nПредварительные:\n`;
            preliminaryPayments.forEach(payment => {
                exportText += `${this.formatAmount(payment.amount || 0)}`;
                if (payment.note) {
                    exportText += ` - ${payment.note}`;
                }
                exportText += `\n`;
            });
        }
        
        if (regularPayments.length > 0) {
            exportText += `\nВыполненные:\n`;
            regularPayments.forEach(payment => {
                exportText += `${this.formatAmount(payment.amount || 0)}`;
                if (payment.date) {
                    exportText += ` (${this.formatDate(payment.date)})`;
                }
                if (payment.note) {
                    exportText += ` - ${payment.note}`;
                }
                exportText += `\n`;
            });
        } else if (preliminaryPayments.length === 0) {
            exportText += `Нет погашений\n`;
        }
        
        exportText += `\n${'='.repeat(40)}\n`;
        exportText += `Сумма долга: ${this.formatAmount(debt.amount || 0)}\n`;
        exportText += `Погашено: ${this.formatAmount(totalPaid)}\n`;
        exportText += `Осталось: ${this.formatAmount(remaining)}\n`;
        exportText += `Прогресс: ${Math.min(100, Math.round((totalPaid / (debt.amount || 1)) * 100))}%\n`;
        
        document.getElementById('exportData').value = exportText;
        document.getElementById('exportModal').classList.add('active');
    },

    copyExportData() {
        const textarea = document.getElementById('exportData');
        textarea.select();
        document.execCommand('copy');
        
        const btn = event.target;
        const originalText = btn.textContent;
        btn.textContent = 'Скопировано!';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
    },

    downloadExportData() {
        const text = document.getElementById('exportData').value;
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const link = document.createElement('a');
        const debtName = this.currentDebt.name || 'dolg';
        const fileName = `${debtName.replace(/[^a-zа-я0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.txt`;
        
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        link.click();
        
        URL.revokeObjectURL(link.href);
        this.hideExport();
    },

    hideExport() {
        document.getElementById('exportModal').classList.remove('active');
    },

    showCategoryModal() {
        document.getElementById('categoryModal').classList.add('active');
        document.getElementById('categoryName').focus();
    },

    hideCategoryModal() {
        document.getElementById('categoryModal').classList.remove('active');
        document.getElementById('categoryForm').reset();
        this.restoreFormData();
    },

    addCategory() {
        const categoryName = document.getElementById('categoryName').value.trim();
        if (!categoryName) return;
        
        const categoryId = categoryName.toLowerCase().replace(/\s+/g, '-');
        
        if (!this.customCategories.find(cat => cat.id === categoryId)) {
            this.customCategories.push({ id: categoryId, name: categoryName });
            this.saveData();
            this.updateCategorySelect();
        }
        
        document.getElementById('debtCategory').value = categoryId;
        this.hideCategoryModal();
    },

    updateCategorySelect() {
        const select = document.getElementById('debtCategory');
        const currentValue = select.value;
        
        const defaultOptions = `
            <option value="">Без категории</option>
            <option value="personal">Личные</option>
            <option value="bank">Банковские</option>
            <option value="business">Бизнес</option>
            <option value="other">Другое</option>
        `;
        
        const customOptions = this.customCategories.map(cat => 
            `<option value="${cat.id}">${cat.name}</option>`
        ).join('');
        
        select.innerHTML = defaultOptions + customOptions + '<option value="new">+ Новая категория</option>';
        
        if (currentValue && currentValue !== 'new') {
            select.value = currentValue;
        }
    },

    saveFormData() {
        this.tempFormData = {
            debtName: document.getElementById('debtName').value,
            debtAmount: document.getElementById('debtAmount').value,
            debtDate: document.getElementById('debtDate').value,
            debtNote: document.getElementById('debtNote').value,
            debtId: document.getElementById('debtId').value,
            debtStatus: document.getElementById('debtStatus').value
        };
    },

    restoreFormData() {
        if (this.tempFormData) {
            document.getElementById('debtName').value = this.tempFormData.debtName;
            document.getElementById('debtAmount').value = this.tempFormData.debtAmount;
            document.getElementById('debtDate').value = this.tempFormData.debtDate;
            document.getElementById('debtNote').value = this.tempFormData.debtNote;
            document.getElementById('debtId').value = this.tempFormData.debtId;
            document.getElementById('debtStatus').value = this.tempFormData.debtStatus;
            this.tempFormData = null;
        }
    },

    showConfirm(message, callback) {
        document.getElementById('confirmMessage').textContent = message;
        this.confirmCallback = callback;
        document.getElementById('confirmModal').classList.add('active');
    },

    confirmAction() {
        if (this.confirmCallback) {
            this.confirmCallback();
            this.confirmCallback = null;
        }
        document.getElementById('confirmModal').classList.remove('active');
    },

    cancelAction() {
        this.confirmCallback = null;
        document.getElementById('confirmModal').classList.remove('active');
    },

    getCategoryName(categoryId) {
        const defaultCategories = {
            personal: 'Личные',
            bank: 'Банковские',
            business: 'Бизнес',
            other: 'Другое'
        };
        
        if (defaultCategories[categoryId]) {
            return defaultCategories[categoryId];
        }
        
        const customCategory = this.customCategories.find(cat => cat.id === categoryId);
        return customCategory ? customCategory.name : 'Без категории';
    },

    getDebtById(id) {
        return this.debtsList.find(debt => debt.id === id);
    },

    formatAmount(amount) {
        return new Intl.NumberFormat('ru-RU', {
            style: 'currency',
            currency: 'RUB',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(amount);
    },

    formatDate(dateString) {
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) {
                return 'Неизвестная дата';
            }
            return date.toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });
        } catch (e) {
            return 'Неизвестная дата';
        }
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    debts.init();
});

// Register service worker for PWA
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.log('Service Worker registration failed:', error);
    });
}