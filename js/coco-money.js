const cocoMoney = {
    sheets: [],
    categories: ['Транспорт', 'Продукты', 'Развлечения', 'Здоровье', 'Образование', 'Другое'],
    currentExportData: null,
    
    init() {
        this.loadData();
        this.render();
        this.setupDateDefault();
    },
    
    setupDateDefault() {
        const dateInput = document.querySelector('#income-form input[name="date"]');
        if (dateInput) {
            dateInput.value = new Date().toISOString().split('T')[0];
        }
    },
    
    loadData() {
        const saved = localStorage.getItem('cocoMoneySheets');
        if (saved) {
            this.sheets = JSON.parse(saved);
        }
    },
    
    saveData() {
        localStorage.setItem('cocoMoneySheets', JSON.stringify(this.sheets));
    },
    
    showIncomeForm() {
        document.getElementById('income-form-modal').style.display = 'block';
        this.setupDateDefault();
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
    
    deleteSheet(sheetId) {
        if (confirm('Удалить этот доходный лист?')) {
            this.sheets = this.sheets.filter(s => s.id !== sheetId);
            this.saveData();
            this.render();
        }
    },
    
    render() {
        const container = document.getElementById('income-sheets-container');
        const noData = document.getElementById('no-data');
        const statistics = document.getElementById('statistics');
        
        if (this.sheets.length === 0) {
            noData.style.display = 'block';
            container.innerHTML = '';
            statistics.style.display = 'none';
            return;
        }
        
        noData.style.display = 'none';
        statistics.style.display = 'block';
        
        container.innerHTML = this.sheets.map(sheet => this.renderSheet(sheet)).join('');
        this.renderStatistics();
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
                    </div>
                </div>
                
                <div class="expenses-section">
                    <h4>Расходы</h4>
                    <form class="expense-form" onsubmit="cocoMoney.addExpense(${sheet.id}, event)">
                        <input type="text" name="expenseTitle" class="expense-input" placeholder="Название расхода" required>
                        <div class="expense-form-row">
                            <input type="number" name="expenseAmount" class="expense-input" placeholder="Сумма" step="0.01" required>
                            <select name="expenseCategory" class="expense-input" required>
                                <option value="">Категория</option>
                                ${this.categories.map(cat => `<option value="${cat}">${cat}</option>`).join('')}
                            </select>
                        </div>
                        <input type="text" name="expenseNote" class="expense-input" placeholder="Заметка (необязательно)">
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
        const totalSheets = this.sheets.length;
        const totalIncome = this.sheets.reduce((sum, sheet) => sum + sheet.amount, 0);
        const totalExpenses = this.sheets.reduce((sum, sheet) => 
            sum + sheet.expenses.reduce((expSum, exp) => expSum + exp.amount, 0), 0);
        const netProfit = totalIncome - totalExpenses;
        
        document.getElementById('total-sheets').textContent = totalSheets;
        document.getElementById('total-income').textContent = this.formatMoney(totalIncome);
        document.getElementById('total-expenses').textContent = this.formatMoney(totalExpenses);
        document.getElementById('net-profit').textContent = this.formatMoney(netProfit);
        
        const categoriesData = {};
        this.sheets.forEach(sheet => {
            sheet.expenses.forEach(expense => {
                if (!categoriesData[expense.category]) {
                    categoriesData[expense.category] = 0;
                }
                categoriesData[expense.category] += expense.amount;
            });
        });
        
        const categoriesHtml = Object.keys(categoriesData).length > 0 ? `
            <h3>Расходы по категориям</h3>
            ${Object.entries(categoriesData)
                .sort((a, b) => b[1] - a[1])
                .map(([category, amount]) => `
                    <div class="category-item">
                        <span class="category-name">${category}</span>
                        <span class="category-amount">${this.formatMoney(amount)}</span>
                    </div>
                `).join('')}
        ` : '';
        
        document.getElementById('categories-breakdown').innerHTML = categoriesHtml;
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
        }
    }
});