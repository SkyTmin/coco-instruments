const cocoMoney = {
    sheets: {
        income: [],
        preliminary: []
    },
    currentSheet: null,
    currentTab: 'income',
    customCategories: [],
    confirmCallback: null,
    touchStartX: 0,
    touchStartY: 0,
    isOnline: navigator.onLine,
    pendingSync: false,

    init() {
        // Ensure default structure exists before loading
        this.sheets = {
            income: [],
            preliminary: []
        };
        
        this.setupEventListeners();
        this.setupTouchGestures();
        this.setupNetworkListeners();
        this.loadData();
        this.setToday();
    },

    setupNetworkListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            if (this.pendingSync) {
                this.syncToServer();
            }
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
        });
    },

    async loadData() {
        const user = await API.getProfile();
        if (user && this.isOnline) {
            // Загружаем данные с сервера ТОЛЬКО для авторизованного пользователя
            try {
                console.log('🔄 Загружаем данные Coco Money с сервера...');
                const serverSheets = await API.cocoMoney.getSheets();
                const serverCategories = await API.cocoMoney.getCategories();
                
                console.log('📥 Полученные данные с сервера:', { 
                    sheets: serverSheets, 
                    categories: serverCategories 
                });
                
                // Обновляем данные ВСЕГДА, даже если они пустые (важно для синхронизации!)
                this.sheets = serverSheets || { income: [], preliminary: [] };
                this.customCategories = serverCategories || [];
                
                console.log('✅ Данные Coco Money обновлены из сервера');
                
                // Сохраняем в localStorage как резервную копию
                this.saveToLocalStorage();
            } catch (err) {
                console.error('❌ Ошибка загрузки с сервера:', err);
                // НЕ загружаем из localStorage при ошибке если пользователь авторизован
                // Показываем пустые данные
                this.sheets = { income: [], preliminary: [] };
                this.customCategories = [];
            }
        } else if (!user) {
            // Если пользователь не авторизован - показываем пустые данные
            console.log('📱 Пользователь не авторизован - показываем пустые данные');
            this.sheets = { income: [], preliminary: [] };
            this.customCategories = [];
        } else {
            // Пользователь авторизован, но офлайн - загружаем из localStorage
            console.log('📱 Загружаем данные Coco Money из localStorage (офлайн режим)');
            this.loadFromLocalStorage();
        }
        
        this.renderAll();
        this.updateCategorySelect();
    },

    loadFromLocalStorage() {
        const savedSheets = localStorage.getItem('cocoMoneySheets');
        const savedCategories = localStorage.getItem('cocoMoneyCategories');
        
        if (savedSheets) {
            try {
                const parsed = JSON.parse(savedSheets);
                this.sheets = {
                    income: parsed.income || [],
                    preliminary: parsed.preliminary || []
                };
                console.log('📥 Листы загружены из localStorage:', this.sheets);
            } catch (e) {
                console.error('Error parsing saved sheets:', e);
                this.sheets = {
                    income: [],
                    preliminary: []
                };
            }
        } else {
            this.sheets = {
                income: [],
                preliminary: []
            };
        }
        
        if (savedCategories) {
            try {
                this.customCategories = JSON.parse(savedCategories) || [];
                console.log('📥 Категории загружены из localStorage:', this.customCategories);
            } catch (e) {
                console.error('Error parsing saved categories:', e);
                this.customCategories = [];
            }
        }
    },

    saveToLocalStorage() {
        localStorage.setItem('cocoMoneySheets', JSON.stringify(this.sheets));
        localStorage.setItem('cocoMoneyCategories', JSON.stringify(this.customCategories));
        console.log('💾 Данные Coco Money сохранены в localStorage');
    },

    async saveData() {
        // Всегда сохраняем в localStorage
        this.saveToLocalStorage();
        
        // Пытаемся синхронизировать с сервером
        if (this.isOnline) {
            await this.syncToServer();
        } else {
            this.pendingSync = true;
            console.log('⏳ Отложена синхронизация с сервером (офлайн)');
        }
    },

    async syncToServer() {
        const user = await API.getProfile();
        if (!user) {
            console.log('❌ Пользователь не авторизован, пропускаем синхронизацию');
            return;
        }

        try {
            console.log('🔄 Синхронизируем данные Coco Money с сервером...');
            console.log('📤 Отправляем данные:', { 
                sheets: this.sheets, 
                categories: this.customCategories 
            });
            
            await Promise.all([
                API.cocoMoney.saveSheets(this.sheets),
                API.cocoMoney.saveCategories(this.customCategories)
            ]);
            
            this.pendingSync = false;
            console.log('✅ Данные Coco Money синхронизированы с сервером');
            this.showToast('Данные синхронизированы', 'success');
        } catch (err) {
            console.error('❌ Ошибка синхронизации с сервером:', err);
            this.pendingSync = true;
            this.showToast('Ошибка синхронизации', 'warning');
        }
    },

    setupEventListeners() {
        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.switchTab(btn.dataset.tab);
            });
        });

        // FAB button
        document.getElementById('fab-btn').addEventListener('click', () => {
            this.showCreateForm(this.currentTab);
        });

        // Sheet form
        document.getElementById('sheetForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveSheet();
        });

        // Expense form
        document.getElementById('expenseForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addExpense();
        });

        // Category select
        document.getElementById('expenseCategory').addEventListener('change', (e) => {
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
    },

    setupTouchGestures() {
        let touchStartTime = 0;
        
        document.addEventListener('touchstart', (e) => {
            this.touchStartX = e.changedTouches[0].screenX;
            this.touchStartY = e.changedTouches[0].screenY;
            touchStartTime = Date.now();
            
            // Show swipe indicators
            if (this.currentTab === 'income') {
                document.getElementById('swipe-right').style.opacity = '0.3';
            } else {
                document.getElementById('swipe-left').style.opacity = '0.3';
            }
        }, { passive: true });

        document.addEventListener('touchmove', (e) => {
            const touchX = e.changedTouches[0].screenX;
            const deltaX = touchX - this.touchStartX;
            
            // Update indicator opacity based on swipe distance
            if (Math.abs(deltaX) > 20) {
                const opacity = Math.min(Math.abs(deltaX) / 100, 0.6);
                if (deltaX > 0 && this.currentTab === 'preliminary') {
                    document.getElementById('swipe-left').style.opacity = opacity;
                } else if (deltaX < 0 && this.currentTab === 'income') {
                    document.getElementById('swipe-right').style.opacity = opacity;
                }
            }
        }, { passive: true });

        document.addEventListener('touchend', (e) => {
            const touchEndX = e.changedTouches[0].screenX;
            const touchEndY = e.changedTouches[0].screenY;
            const touchEndTime = Date.now();
            
            // Hide swipe indicators
            document.getElementById('swipe-left').style.opacity = '0';
            document.getElementById('swipe-right').style.opacity = '0';
            
            // Only handle swipe if it was quick enough (less than 300ms)
            if (touchEndTime - touchStartTime < 300) {
                this.handleSwipe(touchEndX, touchEndY);
            }
        }, { passive: true });
    },

    handleSwipe(endX, endY) {
        const deltaX = endX - this.touchStartX;
        const deltaY = Math.abs(endY - this.touchStartY);
        const threshold = 50; // Reduced threshold for easier swiping
        const verticalThreshold = 100; // Increased to prevent accidental triggers

        if (deltaY > verticalThreshold) return;

        if (Math.abs(deltaX) > threshold) {
            if (deltaX > 0 && this.currentTab === 'preliminary') {
                this.switchTab('income');
            } else if (deltaX < 0 && this.currentTab === 'income') {
                this.switchTab('preliminary');
            }
        }
    },

    switchTab(tab) {
        this.currentTab = tab;
        
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `${tab}-content`);
        });
    },

    renderAll() {
        this.renderSheets('income');
        this.renderSheets('preliminary');
        this.updateStats('income');
        this.updateStats('preliminary');
    },

    renderSheets(type) {
        const container = document.getElementById(`${type}-cards`);
        const sheets = this.sheets[type] || []; // Add fallback
        
        if (!container) {
            console.error(`Container ${type}-cards not found`);
            return;
        }
        
        if (sheets.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>У вас пока нет ${type === 'income' ? 'доходных листов' : 'предварительных доходов'}</p>
                    <button class="btn btn-primary" onclick="cocoMoney.showCreateForm('${type}')">
                        Добавить ${type === 'income' ? 'доходный лист' : 'предварительный доход'}
                    </button>
                </div>
            `;
            return;
        }
        
        container.innerHTML = sheets.map(sheet => this.createMiniCard(sheet, type)).join('');
    },

    createMiniCard(sheet, type) {
        const expenses = sheet.expenses || [];
        const totalExpenses = expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
        const syncStatus = this.pendingSync && !this.isOnline ? '<span class="sync-pending">⏳</span>' : '';
        
        return `
            <div class="mini-card ${type === 'preliminary' ? 'preliminary' : ''}" 
                 onclick="cocoMoney.showDetail('${sheet.id}', '${type}')">
                <h3>${sheet.name || 'Без названия'} ${syncStatus}</h3>
                <div class="mini-card-info">
                    <div class="info-row">
                        <span class="info-label">Сумма:</span>
                        <span class="info-value amount-value">+${this.formatAmount(sheet.amount || 0)}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Дата:</span>
                        <span class="info-value">${this.formatDate(sheet.date || new Date())}</span>
                    </div>
                    ${sheet.note ? `
                        <div class="info-row">
                            <span class="info-label">Заметка:</span>
                            <span class="info-value">${sheet.note}</span>
                        </div>
                    ` : ''}
                    ${totalExpenses > 0 ? `
                        <div class="info-row">
                            <span class="info-label">Расходы:</span>
                            <span class="info-value expense-preview">-${this.formatAmount(totalExpenses)}</span>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    },

    showCreateForm(type = 'income') {
        const modal = document.getElementById('createModal');
        const form = document.getElementById('sheetForm');
        const title = document.getElementById('modal-title');
        
        form.reset();
        document.getElementById('sheetId').value = '';
        document.getElementById('sheetType').value = type;
        title.textContent = type === 'income' ? 'Новый доходный лист' : 'Новый предварительный доход';
        
        this.setToday();
        modal.classList.add('active');
    },

    hideCreateForm() {
        document.getElementById('createModal').classList.remove('active');
    },

    setToday() {
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('sheetDate').value = today;
    },

    async saveSheet() {
        const id = document.getElementById('sheetId').value;
        const type = document.getElementById('sheetType').value;
        
        // Ensure sheets structure exists
        if (!this.sheets[type]) {
            this.sheets[type] = [];
        }
        
        const sheetData = {
            id: id || Date.now().toString(),
            name: document.getElementById('sheetName').value,
            amount: parseFloat(document.getElementById('sheetAmount').value),
            date: document.getElementById('sheetDate').value,
            note: document.getElementById('sheetNote').value,
            expenses: id ? (this.getSheetById(id, type)?.expenses || []) : []
        };
        
        if (id) {
            const index = this.sheets[type].findIndex(s => s.id === id);
            if (index !== -1) {
                this.sheets[type][index] = sheetData;
            }
        } else {
            this.sheets[type].push(sheetData);
        }
        
        console.log('💾 Сохраняем лист:', sheetData);
        await this.saveData();
        this.renderAll();
        this.hideCreateForm();
        this.showToast('Лист сохранен');
    },

    showDetail(sheetId, type) {
        const sheet = this.getSheetById(sheetId, type);
        if (!sheet) return;
        
        // Ensure expenses array exists
        if (!sheet.expenses) {
            sheet.expenses = [];
        }
        
        this.currentSheet = { ...sheet, type };
        
        document.getElementById('detail-title').textContent = sheet.name || 'Без названия';
        document.getElementById('detail-amount').textContent = `+${this.formatAmount(sheet.amount || 0)}`;
        document.getElementById('detail-date').textContent = this.formatDate(sheet.date);
        
        const noteWrapper = document.getElementById('detail-note-wrapper');
        const noteElement = document.getElementById('detail-note');
        if (sheet.note) {
            noteWrapper.style.display = 'flex';
            noteElement.textContent = sheet.note;
        } else {
            noteWrapper.style.display = 'none';
        }
        
        const convertSection = document.getElementById('convert-section');
        convertSection.style.display = type === 'preliminary' ? 'block' : 'none';
        
        this.renderExpenses();
        this.updateDetailStats();
        
        document.getElementById('detailModal').classList.add('active');
    },

    hideDetail() {
        document.getElementById('detailModal').classList.remove('active');
        this.currentSheet = null;
    },

    renderExpenses() {
        const container = document.getElementById('expenses-list');
        const expenses = this.currentSheet.expenses || [];
        
        if (expenses.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: rgba(123, 75, 42, 0.6);">Расходов пока нет</p>';
            return;
        }
        
        container.innerHTML = expenses.map((expense, index) => `
            <div class="expense-item">
                <div class="expense-info">
                    <div class="expense-title">${expense.name}</div>
                    <div class="expense-meta">
                        ${this.getCategoryName(expense.category)}
                        ${expense.note ? ` • ${expense.note}` : ''}
                    </div>
                </div>
                <div class="expense-amount">-${this.formatAmount(expense.amount)}</div>
                <button class="expense-delete" onclick="cocoMoney.deleteExpense(${index})" title="Удалить расход">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
        `).join('');
    },

    async addExpense() {
        const expense = {
            name: document.getElementById('expenseName').value,
            amount: parseFloat(document.getElementById('expenseAmount').value),
            category: document.getElementById('expenseCategory').value,
            note: document.getElementById('expenseNote').value
        };
        
        // Ensure expenses array exists
        if (!this.currentSheet.expenses) {
            this.currentSheet.expenses = [];
        }
        
        this.currentSheet.expenses.push(expense);
        
        const sheetIndex = this.sheets[this.currentSheet.type].findIndex(s => s.id === this.currentSheet.id);
        if (sheetIndex !== -1) {
            this.sheets[this.currentSheet.type][sheetIndex].expenses = this.currentSheet.expenses;
        }
        
        console.log('💾 Добавляем расход:', expense);
        await this.saveData();
        this.renderExpenses();
        this.updateDetailStats();
        this.renderAll();
        
        document.getElementById('expenseForm').reset();
        this.showToast('Расход добавлен');
    },

    // ИСПРАВЛЕННАЯ ФУНКЦИЯ: Удаление расхода
    async deleteExpense(expenseIndex) {
        if (!this.currentSheet || !this.currentSheet.expenses) return;
        
        const expense = this.currentSheet.expenses[expenseIndex];
        if (!expense) {
            console.error('Expense not found at index:', expenseIndex);
            return;
        }
        
        const confirmMessage = `Удалить расход "${expense.name}" на сумму ${this.formatAmount(expense.amount)}?`;
        
        if (!confirm(confirmMessage)) return;
        
        // Удаляем расход из массива
        this.currentSheet.expenses.splice(expenseIndex, 1);
        
        // Обновляем данные в основном массиве листов
        const sheetIndex = this.sheets[this.currentSheet.type].findIndex(s => s.id === this.currentSheet.id);
        if (sheetIndex !== -1) {
            this.sheets[this.currentSheet.type][sheetIndex].expenses = this.currentSheet.expenses;
        }
        
        console.log('🗑️ Удаляем расход:', expense.name);
        await this.saveData();
        this.renderExpenses();
        this.updateDetailStats();
        this.renderAll();
        
        this.showToast('Расход удален');
    },

    updateDetailStats() {
        const expenses = this.currentSheet.expenses || [];
        const totalExpenses = expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
        const balance = (this.currentSheet.amount || 0) - totalExpenses;
        
        document.getElementById('detail-income').textContent = `${this.formatAmount(this.currentSheet.amount || 0)}`;
        document.getElementById('detail-expenses').textContent = `${this.formatAmount(totalExpenses)}`;
        document.getElementById('detail-balance').textContent = `${this.formatAmount(balance)}`;
    },

    updateStats(type) {
        const sheets = this.sheets[type] || [];
        const totalSheets = sheets.length;
        const totalAmount = sheets.reduce((sum, sheet) => sum + (sheet.amount || 0), 0);
        const totalExpenses = sheets.reduce((sum, sheet) => 
            sum + (sheet.expenses || []).reduce((expSum, exp) => expSum + (exp.amount || 0), 0), 0);
        const net = totalAmount - totalExpenses;
        
        // Safe element updates
        const updateElement = (id, value) => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = value;
            }
        };
        
        updateElement(`${type}-total-sheets`, totalSheets);
        updateElement(`${type}-total-amount`, this.formatAmount(totalAmount));
        updateElement(`${type}-total-expenses`, this.formatAmount(totalExpenses));
        updateElement(`${type}-net`, this.formatAmount(net));
        
        this.updateCategoryStats(type);
    },

    updateCategoryStats(type) {
        const container = document.getElementById(`${type}-categories-stats`);
        if (!container) return;
        
        const sheets = this.sheets[type] || [];
        const categoryTotals = {};
        
        sheets.forEach(sheet => {
            (sheet.expenses || []).forEach(expense => {
                const categoryName = this.getCategoryName(expense.category || '');
                categoryTotals[categoryName] = (categoryTotals[categoryName] || 0) + (expense.amount || 0);
            });
        });
        
        const categories = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
        
        if (categories.length === 0) {
            container.innerHTML = '';
            return;
        }
        
        container.innerHTML = `
            <h4>Расходы по категориям:</h4>
            ${categories.map(([category, amount]) => `
                <div class="category-stat">
                    <span>${category}</span>
                    <span>${this.formatAmount(amount)}</span>
                </div>
            `).join('')}
        `;
    },

    editCurrentSheet() {
        const sheet = this.currentSheet;
        document.getElementById('sheetId').value = sheet.id;
        document.getElementById('sheetType').value = sheet.type;
        document.getElementById('sheetName').value = sheet.name;
        document.getElementById('sheetAmount').value = sheet.amount;
        document.getElementById('sheetDate').value = sheet.date;
        document.getElementById('sheetNote').value = sheet.note || '';
        
        document.getElementById('modal-title').textContent = 
            sheet.type === 'income' ? 'Редактировать доходный лист' : 'Редактировать предварительный доход';
        
        this.hideDetail();
        document.getElementById('createModal').classList.add('active');
    },

    async deleteCurrentSheet() {
        const message = `Вы действительно хотите удалить "${this.currentSheet.name || 'Без названия'}"? Это действие нельзя отменить.`;
        this.showConfirm(message, async () => {
            const index = this.sheets[this.currentSheet.type].findIndex(s => s.id === this.currentSheet.id);
            if (index !== -1) {
                this.sheets[this.currentSheet.type].splice(index, 1);
                console.log('🗑️ Удаляем лист:', this.currentSheet.name);
                await this.saveData();
                this.renderAll();
                this.hideDetail();
                this.showToast('Лист удален');
            }
        });
    },

    async convertToIncome() {
        const message = `Преобразовать "${this.currentSheet.name || 'Без названия'}" в доходный лист?`;
        this.showConfirm(message, async () => {
            const prelimIndex = this.sheets.preliminary.findIndex(s => s.id === this.currentSheet.id);
            if (prelimIndex !== -1) {
                const sheet = this.sheets.preliminary[prelimIndex];
                
                this.sheets.preliminary.splice(prelimIndex, 1);
                
                // Ensure income array exists
                if (!this.sheets.income) {
                    this.sheets.income = [];
                }
                
                this.sheets.income.push(sheet);
                
                console.log('🔄 Конвертируем лист в доходный:', sheet.name);
                await this.saveData();
                this.renderAll();
                this.hideDetail();
                this.switchTab('income');
                this.showToast('Лист перемещен в доходы');
            }
        });
    },

    exportSheet() {
        const sheet = this.currentSheet;
        const expenses = sheet.expenses || [];
        const totalExpenses = expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
        const balance = (sheet.amount || 0) - totalExpenses;
        
        let exportText = `${sheet.name || 'Без названия'}\n`;
        exportText += `${'='.repeat(40)}\n\n`;
        exportText += `Дата: ${this.formatDate(sheet.date)}\n`;
        exportText += `Сумма: ${this.formatAmount(sheet.amount || 0)}\n`;
        if (sheet.note) {
            exportText += `Заметка: ${sheet.note}\n`;
        }
        exportText += `\nРасходы:\n`;
        exportText += `${'-'.repeat(40)}\n`;
        
        if (expenses.length === 0) {
            exportText += `Нет расходов\n`;
        } else {
            expenses.forEach(expense => {
                const categoryName = expense.category ? this.getCategoryName(expense.category) : 'Без категории';
                exportText += `${expense.name}: ${this.formatAmount(expense.amount || 0)} (${categoryName})`;
                if (expense.note) {
                    exportText += ` - ${expense.note}`;
                }
                exportText += `\n`;
            });
        }
        
        exportText += `\n${'='.repeat(40)}\n`;
        exportText += `Итого доход: ${this.formatAmount(sheet.amount || 0)}\n`;
        exportText += `Итого расходы: ${this.formatAmount(totalExpenses)}\n`;
        exportText += `Остаток: ${this.formatAmount(balance)}\n`;
        
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
        const sheetName = this.currentSheet.name || 'dohodnyj-list';
        const fileName = `${sheetName.replace(/[^a-zа-я0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.txt`;
        
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

    async addCategory() {
        const categoryName = document.getElementById('categoryName').value.trim();
        if (!categoryName) return;
        
        const categoryId = categoryName.toLowerCase().replace(/\s+/g, '-');
        
        if (!this.customCategories.find(cat => cat.id === categoryId)) {
            this.customCategories.push({ id: categoryId, name: categoryName });
            console.log('📝 Добавляем категорию:', categoryName);
            await this.saveData();
            this.updateCategorySelect();
            this.showToast('Категория добавлена');
        }
        
        document.getElementById('expenseCategory').value = categoryId;
        this.hideCategoryModal();
    },

    updateCategorySelect() {
        const select = document.getElementById('expenseCategory');
        const currentValue = select.value;
        
        const defaultOptions = `
            <option value="">Категория</option>
            <option value="transport">Транспорт</option>
            <option value="food">Продукты</option>
            <option value="utilities">Коммунальные услуги</option>
            <option value="entertainment">Развлечения</option>
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
        // Save both expense form and main sheet form data
        this.tempFormData = {
            // Expense form data
            expenseName: document.getElementById('expenseName').value,
            expenseAmount: document.getElementById('expenseAmount').value,
            expenseNote: document.getElementById('expenseNote').value,
            // Sheet form data (if modal is open)
            sheetName: document.getElementById('sheetName').value,
            sheetAmount: document.getElementById('sheetAmount').value,
            sheetDate: document.getElementById('sheetDate').value,
            sheetNote: document.getElementById('sheetNote').value,
            sheetId: document.getElementById('sheetId').value,
            sheetType: document.getElementById('sheetType').value
        };
    },

    restoreFormData() {
        if (this.tempFormData) {
            // Restore expense form data
            if (this.tempFormData.expenseName !== undefined) {
                document.getElementById('expenseName').value = this.tempFormData.expenseName;
                document.getElementById('expenseAmount').value = this.tempFormData.expenseAmount;
                document.getElementById('expenseNote').value = this.tempFormData.expenseNote;
            }
            // Restore sheet form data if needed
            if (document.getElementById('createModal').classList.contains('active') && 
                this.tempFormData.sheetName !== undefined) {
                document.getElementById('sheetName').value = this.tempFormData.sheetName;
                document.getElementById('sheetAmount').value = this.tempFormData.sheetAmount;
                document.getElementById('sheetDate').value = this.tempFormData.sheetDate;
                document.getElementById('sheetNote').value = this.tempFormData.sheetNote;
                document.getElementById('sheetId').value = this.tempFormData.sheetId;
                document.getElementById('sheetType').value = this.tempFormData.sheetType;
            }
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
        if (!categoryId) {
            return 'Без категории';
        }
        
        const defaultCategories = {
            transport: 'Транспорт',
            food: 'Продукты',
            utilities: 'Коммунальные услуги',
            entertainment: 'Развлечения',
            other: 'Другое'
        };
        
        if (defaultCategories[categoryId]) {
            return defaultCategories[categoryId];
        }
        
        const customCategory = this.customCategories.find(cat => cat.id === categoryId);
        return customCategory ? customCategory.name : categoryId;
    },

    getSheetById(id, type) {
        if (!this.sheets[type]) return null;
        return this.sheets[type].find(sheet => sheet.id === id);
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
    },

    showToast(message, type = 'info') {
        // Create toast element if it doesn't exist
        let toast = document.getElementById('toast-coco-money');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast-coco-money';
            toast.className = 'toast';
            document.body.appendChild(toast);
        }
        
        toast.textContent = message;
        toast.className = `toast ${type} show`;
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    cocoMoney.init();
});

// Register service worker for PWA (only on HTTPS or localhost)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.log('Service Worker registration failed:', error);
    });
}
