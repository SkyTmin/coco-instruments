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
    },
    
    setupDateDefault() {
        const dateInput = document.querySelector('#income-form input[name="date"]');
        if (dateInput) {
            dateInput.value = new Date().toISOString().split('T')[0];
        }
    },
    
    setupCategoryChangeHandlers() {
        // Будет вызываться после рендера для установки обработчиков
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
        document.querySelectorAll('.tab-btn').forEach(btn => {
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
            this.render(); // Обновляем все формы
            form.reset();
        }
    },
    
    deleteCategory(category) {
        if (this.categories.length > 1) {
            this.categories = this.categories.filter(c => c !== category);
            this.saveData();
            this.renderCategories();
            this.render(); // Обновляем все формы
        }
    },
    
    renderCategories() {
        const container = document.getElementById('categories-list');
        container.innerHTML = this.categories.map(category => `
            <div class="category-list-item">
                <span>${category}</span>
                <button onclick="cocoMoney.deleteCategory('${category}')">×</button>
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
        
        // Устанавливаем обработчики для селектов категорий
        setTimeout(() => {
            document.querySelectorAll('.category-select').forEach(select => {
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
            <div class="card income-sheet ${sheet.preliminary ? 'preliminary-card' : ''}">
                <div class="sheet-header">
                    <div class="sheet-info">
                        <h3 class="sheet-title">
                            ${sheet.title}
                            ${sheet.preliminary ? '<span class="preliminary-badge">Предварительный</span>' : ''}
                        </h3>
                        <div class="sheet-amount">+ ${this.formatMoney(sheet.amount)}</div>
                        <div class="sheet-meta">
                            <span>📅 ${this.formatDate(sheet.date)}</span>
                            ${sheet.note ? `<span>📝 ${sheet.note}</span>` : ''}
                        </div>
                        <div class="sheet-meta">
                            <span>💰 Баланс: <strong class="${balance >= 0 ? '' : 'negative'}">${this.formatMoney(balance)}</strong></span>
                        </div>
                    </div>
                    <div class="sheet-actions">
                        <button class="export-btn" onclick="cocoMoney.showExportModal(${sheet.id})">
                            📥 Скачать
                        </button>
                        <button class="edit-btn" onclick="cocoMoney.showEditForm(${sheet.id})">
                            ✏️ Изменить
                        </button>
                        ${sheet.preliminary ? `
                            <button class="convert-btn" onclick="cocoMoney.convertToPermanent(${sheet.id})">
                                ✅ В доходы
                            </button>
                        ` : ''}
                        <button class="delete-btn" onclick="cocoMoney.promptDelete(${sheet.id})">
                            🗑️ Удалить
                        </button>
                    </div>
                </div>
                
                <div class="expenses-section">
                    <h4>Расходы</h4>
                    <form class="expense-form" onsubmit="cocoMoney.addExpense(${sheet.id}, event)">
                        <div class="expense-form-row">
                            <input type="text" name="expenseTitle" class="expense-input" placeholder="Название расхода" required>
                            <input type="number" name="expenseAmount" class="expense-input" placeholder="Сумма" step="0.01" required>
                            <div class="category-select-wrapper">
                                <select name="expenseCategory" class="expense-input category-select" data-sheet-id="${sheet.id}" required>
                                    <option value="">Категория</option>
                                    ${this.categories.map(cat => `<option value="${cat}">${cat}</option>`).join('')}
                                    <option value="new_category" style="font-style: italic; color: var(--brown);">➕ Новая категория</option>
                                </select>
                            </div>
                            <input type="text" name="expenseNote" class="expense-input" placeholder="Заметка (необязательно)">
                        </div>
                        <button type="submit" class="add-expense-btn">Добавить расход</button>
                    </form>
                    
                    ${sheet.expenses.length > 0 ? `
                        <ul class="expenses-list">
                            ${sheet.expenses.map(expense => `
                                <li class="expense-item">
                                    <div class="expense-info">
                                        <div class="expense-title">${expense.title}</div>
                                        <div class="expense-meta">
                                            <span>🏷️ ${expense.category}</span>
                                            ${expense.note ? `<span>📝 ${expense.note}</span>` : ''}
                                        </div>
                                    </div>
                                    <div class="expense-amount">− ${this.formatMoney(expense.amount)}</div>
                                    <button class="delete-expense" onclick="cocoMoney.deleteExpense(${sheet.id}, ${expense.id})">×</button>
                                </li>
                            `).join('')}
                        </ul>
                    ` : '<p style="text-align: center; color: rgba(123, 75, 42, 0.5);">Расходов пока нет</p>'}
                </div>
            </div>
        `;
    },
    
    renderStatistics() {
        const regularSheets = this.sheets.filter(s => !s.preliminary);
        const preliminarySheets = this.sheets.filter(s => s.preliminary);
        
        // Показываем статистику только для активной вкладки
        if (this.currentTab === 'regular') {
            // Статистика для обычных листов
            const regularStats = this.calculateStats(regularSheets);
            document.getElementById('regular-total-sheets').textContent = regularStats.totalSheets;
            document.getElementById('regular-total-income').textContent = this.formatMoney(regularStats.totalIncome);
            document.getElementById('regular-total-expenses').textContent = this.formatMoney(regularStats.totalExpenses);
            document.getElementById('regular-net-profit').textContent = this.formatMoney(regularStats.netProfit);
            
            // Категории для обычных листов
            const regularCategoriesHtml = this.renderCategoriesBreakdown(regularStats.categoriesData);
            document.getElementById('regular-categories-breakdown').innerHTML = regularCategoriesHtml;
            
            // Показываем только статистику обычных листов
            document.getElementById('regular-statistics').style.display = regularSheets.length > 0 ? 'block' : 'none';
            document.getElementById('preliminary-statistics').style.display = 'none';
        } else {
            // Статистика для предварительных листов
            const preliminaryStats = this.calculateStats(preliminarySheets);
            document.getElementById('preliminary-total-sheets').textContent = preliminaryStats.totalSheets;
            document.getElementById('preliminary-total-income').textContent = this.formatMoney(preliminaryStats.totalIncome);
            document.getElementById('preliminary-total-expenses').textContent = this.formatMoney(preliminaryStats.totalExpenses);
            document.getElementById('preliminary-net-profit').textContent = this.formatMoney(preliminaryStats.netProfit);
            
            // Категории для предварительных листов
            const preliminaryCategoriesHtml = this.renderCategoriesBreakdown(preliminaryStats.categoriesData);
            document.getElementById('preliminary-categories-breakdown').innerHTML = preliminaryCategoriesHtml;
            
            // Показываем только статистику предварительных листов
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
            <h3>Расходы по категориям</h3>
            ${Object.entries(categoriesData)
                .sort((a, b) => b[1] - a[1])
                .map(([category, amount]) => `
                    <div class="category-item">
                        <span class="category-name">${category}</span>
                        <span class="category-amount">${this.formatMoney(amount)}</span>
                    </div>
                `).join('')}
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
            const notification = document.getElementById('copy-notification');
            notification.style.display = 'block';
            setTimeout(() => {
                notification.style.display = 'none';
            }, 2000);
        } catch (err) {
            alert('Не удалось скопировать текст');
        }
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

document.addEventListener('DOMContentLoaded', () => {
    cocoMoney.init();
});

window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        if (e.target.id === 'income-form-modal') {
            cocoMoney.hideIncomeForm();
        } else if (e.target.id === 'export-modal') {
            cocoMoney.hideExportModal();
        } else if (e.target.id === 'edit-sheet-modal') {
            cocoMoney.hideEditForm();
        } else if (e.target.id === 'category-modal') {
            cocoMoney.hideCategoryModal();
        } else if (e.target.id === 'confirm-modal') {
            cocoMoney.cancelDelete();
        }
    }
});