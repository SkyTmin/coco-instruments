const cocoMoney = {
    sheets: [],
    categories: ['Транспорт', 'Продукты', 'Развлечения', 'Здоровье', 'Образование', 'Другое'],
    currentExportData: null,
    currentTab: 'regular',
    deleteTargetId: null,
    editingSheetId: null,
    
    init() {
        this.loadData();
        this.render();
        this.setupDateDefault();
        this.setupCategoryChangeHandlers();
        this.setupModalClosers();
    },
    
    setupDateDefault() {
        const dateInput = document.querySelector('#income-form input[name="date"]');
        if (dateInput) {
            dateInput.value = new Date().toISOString().split('T')[0];
        }
    },
    
    setupCategoryChangeHandlers() {
        // Will be called after render
    },
    
    setupModalClosers() {
        // Close modals when clicking outside
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal(modal.id);
                }
            });
        });
    },
    
    closeModal(modalId) {
        document.getElementById(modalId).style.display = 'none';
    },
    
    loadData() {
        const savedSheets = localStorage.getItem('cocoMoneySheets');
        if (savedSheets) {
            this.sheets = JSON.parse(savedSheets);
        }
        
        const savedCategories = localStorage.getItem('cocoMoneyCategories');
        if (savedCategories) {
            this.categories = JSON.parse(savedCategories);
        }
    },
    
    saveData() {
        localStorage.setItem('cocoMoneySheets', JSON.stringify(this.sheets));
        localStorage.setItem('cocoMoneyCategories', JSON.stringify(this.categories));
    },
    
    switchTab(tab) {
        this.currentTab = tab;
        document.querySelectorAll('.tab').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
        });
        this.render();
    },
    
    showIncomeForm(isPreliminary = false) {
        document.getElementById('income-form-modal').style.display = 'block';
        this.setupDateDefault();
        const checkbox = document.querySelector('#income-form input[name="preliminary"]');
        if (checkbox) {
            checkbox.checked = isPreliminary || this.currentTab === 'preliminary';
        }
    },
    
    hideIncomeForm() {
        document.getElementById('income-form-modal').style.display = 'none';
        document.getElementById('income-form').reset();
    },
    
    addIncomeSheet(event) {
        event.preventDefault();
        const form = event.target;
        
        const sheet = {
            id: Date.now(),
            title: form.title.value,
            amount: parseFloat(form.amount.value),
            date: form.date.value,
            note: form.note.value,
            preliminary: form.preliminary.checked,
            expenses: []
        };
        
        this.sheets.push(sheet);
        this.saveData();
        this.render();
        this.hideIncomeForm();
    },
    
    showEditForm(sheetId) {
        const sheet = this.sheets.find(s => s.id === sheetId);
        if (!sheet) return;
        
        this.editingSheetId = sheetId;
        const form = document.getElementById('edit-sheet-form');
        form.sheetId.value = sheetId;
        form.title.value = sheet.title;
        form.amount.value = sheet.amount;
        form.date.value = sheet.date;
        form.note.value = sheet.note || '';
        
        document.getElementById('edit-sheet-modal').style.display = 'block';
    },
    
    hideEditForm() {
        document.getElementById('edit-sheet-modal').style.display = 'none';
        document.getElementById('edit-sheet-form').reset();
        this.editingSheetId = null;
    },
    
    updateSheet(event) {
        event.preventDefault();
        const form = event.target;
        const sheetId = parseInt(form.sheetId.value);
        
        const sheet = this.sheets.find(s => s.id === sheetId);
        if (sheet) {
            sheet.title = form.title.value;
            sheet.amount = parseFloat(form.amount.value);
            sheet.date = form.date.value;
            sheet.note = form.note.value;
            
            this.saveData();
            this.render();
            this.hideEditForm();
        }
    },
    
    convertToPermanent(sheetId) {
        const sheet = this.sheets.find(s => s.id === sheetId);
        if (sheet && sheet.preliminary) {
            if (confirm(`Преобразовать предварительный лист "${sheet.title}" в обычный доходный лист?`)) {
                sheet.preliminary = false;
                this.saveData();
                this.currentTab = 'regular';
                this.switchTab('regular');
            }
        }
    },
    
    promptDelete(sheetId) {
        const sheet = this.sheets.find(s => s.id === sheetId);
        if (!sheet) return;
        
        this.deleteTargetId = sheetId;
        const message = `Вы точно хотите удалить ${sheet.preliminary ? 'предварительный' : 'доходный'} лист "${sheet.title}"?`;
        document.getElementById('confirm-message').textContent = message;
        document.getElementById('confirm-modal').style.display = 'block';
    },
    
    confirmDelete() {
        if (this.deleteTargetId) {
            this.sheets = this.sheets.filter(s => s.id !== this.deleteTargetId);
            this.saveData();
            this.render();
        }
        this.cancelDelete();
    },
    
    cancelDelete() {
        document.getElementById('confirm-modal').style.display = 'none';
        this.deleteTargetId = null;
    },
    
    showCategoryModal() {
        this.renderCategories();
        document.getElementById('category-modal').style.display = 'block';
    },
    
    hideCategoryModal() {
        document.getElementById('category-modal').style.display = 'none';
        document.getElementById('add-category-form').reset();
    },
    
    addCategory(event) {
        event.preventDefault();
        const form = event.target;
        const categoryName = form.categoryName.value.trim();
        
        if (categoryName && !this.categories.includes(categoryName)) {
            this.categories.push(categoryName);
            this.saveData();
            this.renderCategories();
            this.render();
            form.reset();
        }
    },
    
    deleteCategory(category) {
        if (this.categories.length > 1) {
            this.categories = this.categories.filter(c => c !== category);
            this.saveData();
            this.renderCategories();
            this.render();
        }
    },
    
    renderCategories() {
        const container = document.getElementById('categories-list');
        container.innerHTML = this.categories.map(category => `
            <div class="category-list-item">
                <span>${category}</span>
                <button onclick="cocoMoney.deleteCategory('${category}')">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
        `).join('');
    },
    
    handleCategoryChange(selectElement, sheetId) {
        if (selectElement.value === 'new_category') {
            this.showCategoryModal();
            selectElement.value = '';
        }
    },
    
    addExpense(sheetId, event) {
        event.preventDefault();
        const form = event.target;
        
        const expense = {
            id: Date.now(),
            title: form.expenseTitle.value,
            amount: parseFloat(form.expenseAmount.value),
            category: form.expenseCategory.value,
            note: form.expenseNote.value
        };
        
        const sheet = this.sheets.find(s => s.id === sheetId);
        if (sheet) {
            sheet.expenses.push(expense);
            this.saveData();
            this.render();
        }
    },
    
    deleteExpense(sheetId, expenseId) {
        const sheet = this.sheets.find(s => s.id === sheetId);
        if (sheet) {
            sheet.expenses = sheet.expenses.filter(e => e.id !== expenseId);
            this.saveData();
            this.render();
        }
    },
    
    render() {
        const container = document.getElementById('income-sheets-container');
        const noDataRegular = document.getElementById('no-data');
        const noDataPreliminary = document.getElementById('no-data-preliminary');
        const statistics = document.getElementById('statistics');
        
        const regularSheets = this.sheets.filter(s => !s.preliminary);
        const preliminarySheets = this.sheets.filter(s => s.preliminary);
        
        if (this.currentTab === 'regular') {
            if (regularSheets.length === 0) {
                noDataRegular.style.display = 'block';
                noDataPreliminary.style.display = 'none';
                container.innerHTML = '';
            } else {
                noDataRegular.style.display = 'none';
                noDataPreliminary.style.display = 'none';
                container.innerHTML = regularSheets.map(sheet => this.renderSheet(sheet)).join('');
            }
        } else {
            if (preliminarySheets.length === 0) {
                noDataPreliminary.style.display = 'block';
                noDataRegular.style.display = 'none';
                container.innerHTML = '';
            } else {
                noDataPreliminary.style.display = 'none';
                noDataRegular.style.display = 'none';
                container.innerHTML = preliminarySheets.map(sheet => this.renderSheet(sheet)).join('');
            }
        }
        
        if (this.sheets.length > 0) {
            statistics.style.display = 'block';
            this.renderStatistics();
        } else {
            statistics.style.display = 'none';
        }
        
        // Setup category change handlers
        setTimeout(() => {
            document.querySelectorAll('.expense-select').forEach(select => {
                select.addEventListener('change', (e) => {
                    const sheetId = parseInt(e.target.getAttribute('data-sheet-id'));
                    this.handleCategoryChange(e.target, sheetId);
                });
            });
        }, 0);
    },
    
    renderSheet(sheet) {
        const totalExpenses = sheet.expenses.reduce((sum, exp) => sum + exp.amount, 0);
        const balance = sheet.amount - totalExpenses;
        
        return `
            <div class="card ${sheet.preliminary ? 'preliminary-card' : ''}">
                <div class="card-header">
                    <div>
                        <h3 class="card-title">
                            ${sheet.title}
                            ${sheet.preliminary ? '<span class="card-badge">Предварительный</span>' : ''}
                        </h3>
                    </div>
                    <div class="card-actions">
                        <button class="card-action card-action-primary" onclick="cocoMoney.showExportModal(${sheet.id})" title="Скачать">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                        </button>
                        <button class="card-action" onclick="cocoMoney.showEditForm(${sheet.id})" title="Изменить">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                        </button>
                        ${sheet.preliminary ? `
                            <button class="card-action card-action-success" onclick="cocoMoney.convertToPermanent(${sheet.id})" title="В доходы">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="9 11 12 14 22 4"/>
                                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                                </svg>
                            </button>
                        ` : ''}
                        <button class="card-action card-action-danger" onclick="cocoMoney.promptDelete(${sheet.id})" title="Удалить">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>
                    </div>
                </div>
                
                <div class="card-content">
                    <p class="card-amount ${balance < 0 ? 'negative' : ''}">
                        ${balance >= 0 ? '+' : ''}${this.formatMoney(sheet.amount)}
                    </p>
                    <div class="card-meta">
                        <span class="card-meta-item">
                            <svg class="card-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                                <line x1="16" y1="2" x2="16" y2="6"/>
                                <line x1="8" y1="2" x2="8" y2="6"/>
                                <line x1="3" y1="10" x2="21" y2="10"/>
                            </svg>
                            ${this.formatDate(sheet.date)}
                        </span>
                        ${sheet.note ? `
                            <span class="card-meta-item">
                                <svg class="card-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                    <polyline points="14 2 14 8 20 8"/>
                                    <line x1="16" y1="13" x2="8" y2="13"/>
                                    <line x1="16" y1="17" x2="8" y2="17"/>
                                    <polyline points="10 9 9 9 8 9"/>
                                </svg>
                                ${sheet.note}
                            </span>
                        ` : ''}
                    </div>
                    <div class="card-balance">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="12" y1="1" x2="12" y2="23"/>
                            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                        </svg>
                        Баланс: <strong class="${balance < 0 ? 'negative' : ''}">${this.formatMoney(balance)}</strong>
                    </div>
                </div>
                
                <div class="expenses-section">
                    <div class="expenses-header">
                        <h4 class="expenses-title">Расходы</h4>
                    </div>
                    <form class="expense-form" onsubmit="cocoMoney.addExpense(${sheet.id}, event)">
                        <div class="expense-form-row">
                            <input type="text" name="expenseTitle" class="expense-input" placeholder="Название расхода" required>
                            <input type="number" name="expenseAmount" class="expense-input" placeholder="Сумма" step="0.01" required>
                            <select name="expenseCategory" class="expense-input expense-select" data-sheet-id="${sheet.id}" required>
                                <option value="">Категория</option>
                                ${this.categories.map(cat => `<option value="${cat}">${cat}</option>`).join('')}
                                <option value="new_category" style="font-style: italic;">➕ Новая категория</option>
                            </select>
                            <input type="text" name="expenseNote" class="expense-input" placeholder="Заметка">
                        </div>
                        <button type="submit" class="btn btn-primary">Добавить расход</button>
                    </form>
                    
                    ${sheet.expenses.length > 0 ? `
                        <ul class="expenses-list">
                            ${sheet.expenses.map(expense => `
                                <li class="expense-item">
                                    <div class="expense-info">
                                        <div class="expense-name">${expense.title}</div>
                                        <div class="expense-meta">
                                            <span>🏷️ ${expense.category}</span>
                                            ${expense.note ? `<span>📝 ${expense.note}</span>` : ''}
                                        </div>
                                    </div>
                                    <div class="expense-amount">−${this.formatMoney(expense.amount)}</div>
                                    <button class="expense-delete" onclick="cocoMoney.deleteExpense(${sheet.id}, ${expense.id})">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <line x1="18" y1="6" x2="6" y2="18"/>
                                            <line x1="6" y1="6" x2="18" y2="18"/>
                                        </svg>
                                    </button>
                                </li>
                            `).join('')}
                        </ul>
                    ` : '<p class="no-expenses">Расходов пока нет</p>'}
                </div>
            </div>
        `;
    },
    
    renderStatistics() {
        const regularSheets = this.sheets.filter(s => !s.preliminary);
        const preliminarySheets = this.sheets.filter(s => s.preliminary);
        
        // Show statistics only for active tab
        if (this.currentTab === 'regular') {
            const regularStats = this.calculateStats(regularSheets);
            document.getElementById('regular-total-sheets').textContent = regularStats.totalSheets;
            document.getElementById('regular-total-income').textContent = this.formatMoney(regularStats.totalIncome);
            document.getElementById('regular-total-expenses').textContent = this.formatMoney(regularStats.totalExpenses);
            document.getElementById('regular-net-profit').textContent = this.formatMoney(regularStats.netProfit);
            
            const regularCategoriesHtml = this.renderCategoriesBreakdown(regularStats.categoriesData);
            document.getElementById('regular-categories-breakdown').innerHTML = regularCategoriesHtml;
            
            document.getElementById('regular-statistics').style.display = regularSheets.length > 0 ? 'block' : 'none';
            document.getElementById('preliminary-statistics').style.display = 'none';
        } else {
            const preliminaryStats = this.calculateStats(preliminarySheets);
            document.getElementById('preliminary-total-sheets').textContent = preliminaryStats.totalSheets;
            document.getElementById('preliminary-total-income').textContent = this.formatMoney(preliminaryStats.totalIncome);
            document.getElementById('preliminary-total-expenses').textContent = this.formatMoney(preliminaryStats.totalExpenses);
            document.getElementById('preliminary-net-profit').textContent = this.formatMoney(preliminaryStats.netProfit);
            
            const preliminaryCategoriesHtml = this.renderCategoriesBreakdown(preliminaryStats.categoriesData);
            document.getElementById('preliminary-categories-breakdown').innerHTML = preliminaryCategoriesHtml;
            
            document.getElementById('regular-statistics').style.display = 'none';
            document.getElementById('preliminary-statistics').style.display = preliminarySheets.length > 0 ? 'block' : 'none';
        }
    },
    
    calculateStats(sheets) {
        const totalSheets = sheets.length;
        const totalIncome = sheets.reduce((sum, sheet) => sum + sheet.amount, 0);
        const totalExpenses = sheets.reduce((sum, sheet) => 
            sum + sheet.expenses.reduce((expSum, exp) => expSum + exp.amount, 0), 0);
        const netProfit = totalIncome - totalExpenses;
        
        const categoriesData = {};
        sheets.forEach(sheet => {
            sheet.expenses.forEach(expense => {
                if (!categoriesData[expense.category]) {
                    categoriesData[expense.category] = 0;
                }
                categoriesData[expense.category] += expense.amount;
            });
        });
        
        return {
            totalSheets,
            totalIncome,
            totalExpenses,
            netProfit,
            categoriesData
        };
    },
    
    renderCategoriesBreakdown(categoriesData) {
        if (Object.keys(categoriesData).length === 0) {
            return '';
        }
        
        return `
            <div class="categories-breakdown">
                <h3>Расходы по категориям</h3>
                ${Object.entries(categoriesData)
                    .sort((a, b) => b[1] - a[1])
                    .map(([category, amount]) => `
                        <div class="category-item">
                            <span class="category-name">${category}</span>
                            <span class="category-amount">${this.formatMoney(amount)}</span>
                        </div>
                    `).join('')}
            </div>
        `;
    },
    
    showExportModal(sheetId) {
        const sheet = this.sheets.find(s => s.id === sheetId);
        if (!sheet) return;
        
        const exportData = this.formatExportData(sheet);
        this.currentExportData = exportData;
        
        document.getElementById('export-content').value = exportData;
        document.getElementById('export-modal').style.display = 'block';
    },
    
    hideExportModal() {
        document.getElementById('export-modal').style.display = 'none';
        this.currentExportData = null;
    },
    
    formatExportData(sheet) {
        const totalExpenses = sheet.expenses.reduce((sum, exp) => sum + exp.amount, 0);
        const balance = sheet.amount - totalExpenses;
        
        let text = `╔═══════════════════════════════════════╗
║         COCO MONEY - ОТЧЁТ            ║
╚═══════════════════════════════════════╝

📊 ДОХОДНЫЙ ЛИСТ${sheet.preliminary ? ' (ПРЕДВАРИТЕЛЬНЫЙ)' : ''}
═══════════════════════════════════════

📌 Название: ${sheet.title}
💵 Доход: ${this.formatMoney(sheet.amount)}
📅 Дата: ${this.formatDate(sheet.date)}
${sheet.note ? `📝 Заметка: ${sheet.note}\n` : ''}

💸 РАСХОДЫ
───────────────────────────────────────`;
        
        if (sheet.expenses.length > 0) {
            sheet.expenses.forEach((expense, index) => {
                text += `

${index + 1}. ${expense.title}
   Сумма: ${this.formatMoney(expense.amount)}
   Категория: ${expense.category}${expense.note ? `
   Заметка: ${expense.note}` : ''}`;
            });
            
            text += `

───────────────────────────────────────
ИТОГО РАСХОДОВ: ${this.formatMoney(totalExpenses)}`;
        } else {
            text += `

   Расходов не зарегистрировано`;
        }
        
        text += `

═══════════════════════════════════════
💰 БАЛАНС: ${this.formatMoney(balance)}
═══════════════════════════════════════

Сгенерировано: ${new Date().toLocaleString('ru-RU')}
© Coco Instruments`;
        
        return text;
    },
    
    downloadData() {
        if (!this.currentExportData) return;
        
        const blob = new Blob([this.currentExportData], { type: 'text/plain;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `coco-money-${new Date().toISOString().split('T')[0]}.txt`;
        link.click();
    },
    
    async copyData() {
        if (!this.currentExportData) return;
        
        try {
            await navigator.clipboard.writeText(this.currentExportData);
            this.showToast('Скопировано в буфер обмена');
        } catch (err) {
            alert('Не удалось скопировать текст');
        }
    },
    
    showToast(message) {
        const toast = document.getElementById('copy-notification');
        toast.style.display = 'flex';
        setTimeout(() => {
            toast.style.display = 'none';
        }, 3000);
    },
    
    formatMoney(amount) {
        return new Intl.NumberFormat('ru-RU', {
            style: 'currency',
            currency: 'RUB',
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }).format(amount);
    },
    
    formatDate(dateString) {
        return new Date(dateString).toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
    }
};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    cocoMoney.init();
});

// Handle ESC key to close modals
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal').forEach(modal => {
            if (modal.style.display === 'block') {
                modal.style.display = 'none';
            }
        });
    }
});