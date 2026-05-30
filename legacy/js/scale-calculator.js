const scaleCalculator = {
    // Известные значения для интерполяции
    knownValues: {
        scale1: 1000,
        height1: 2.5,
        scale2: 100,
        height2: 0.250
    },
    
    // История расчётов
    history: [],
    
    // Таймер для задержки расчёта
    debounceTimer: null,
    
    // Синхронизация
    isOnline: navigator.onLine,
    pendingSync: false,
    
    init() {
        console.log('Инициализация калькулятора масштабов');
        this.setupEventListeners();
        this.setupNetworkListeners();
        this.loadHistory();
        this.addInitialAnimation();
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

    async loadHistory() {
    const user = await API.getProfile();
    if (user && this.isOnline) {
        // Загружаем данные с сервера ТОЛЬКО для авторизованного пользователя
        try {
            console.log('🔄 Загружаем историю калькулятора масштабов с сервера...');
            const serverHistory = await API.scaleCalculator.getHistory();
            
            console.log('📥 История с сервера:', serverHistory);
            
            // Обновляем данные ВСЕГДА, даже если они пустые (важно для синхронизации!)
            this.history = serverHistory || [];
            
            console.log('✅ История калькулятора масштабов обновлена из сервера');
            
            // Сохраняем в localStorage как резервную копию
            this.saveToLocalStorage();
        } catch (err) {
            console.error('❌ Ошибка загрузки с сервера:', err);
            // НЕ загружаем из localStorage при ошибке если пользователь авторизован
            // Показываем пустые данные
            this.history = [];
        }
    } else if (!user) {
        // Если пользователь не авторизован - показываем пустые данные
        console.log('📱 Пользователь не авторизован - показываем пустые данные');
        this.history = [];
    } else {
        // Пользователь авторизован, но офлайн - загружаем из localStorage
        console.log('📱 Загружаем историю калькулятора масштабов из localStorage (офлайн режим)');
        this.loadFromLocalStorage();
    }
    
    this.renderHistory();
},

    loadFromLocalStorage() {
        const saved = localStorage.getItem('scaleCalculatorHistory');
        if (saved) {
            try {
                this.history = JSON.parse(saved) || [];
                console.log('📥 История загружена из localStorage:', this.history);
            } catch (e) {
                console.error('Ошибка загрузки истории:', e);
                this.history = [];
            }
        } else {
            this.history = [];
        }
    },

    saveToLocalStorage() {
        localStorage.setItem('scaleCalculatorHistory', JSON.stringify(this.history));
        console.log('💾 История калькулятора масштабов сохранена в localStorage');
    },

    async saveHistory() {
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
            console.log('🔄 Синхронизируем историю калькулятора масштабов с сервером...');
            console.log('📤 Отправляем данные:', this.history);
            
            await API.scaleCalculator.saveHistory(this.history);
            
            this.pendingSync = false;
            console.log('✅ История калькулятора масштабов синхронизирована с сервером');
            this.showToast('История синхронизирована');
        } catch (err) {
            console.error('❌ Ошибка синхронизации с сервером:', err);
            this.pendingSync = true;
            this.showToast('Ошибка синхронизации');
        }
    },
    
    setupEventListeners() {
        const scaleInput = document.getElementById('scaleInput');
        const textHeightInput = document.getElementById('textHeightInput');
        
        // Обработчики ввода с debounce
        scaleInput.addEventListener('input', (e) => {
            this.handleScaleInput(e.target.value);
        });
        
        textHeightInput.addEventListener('input', (e) => {
            this.handleTextHeightInput(e.target.value);
        });
        
        // Обработчики фокуса для анимаций
        scaleInput.addEventListener('focus', (e) => {
            this.animateInputFocus(e.target);
        });
        
        scaleInput.addEventListener('blur', (e) => {
            this.animateInputBlur(e.target);
        });
        
        textHeightInput.addEventListener('focus', (e) => {
            this.animateInputFocus(e.target);
        });
        
        textHeightInput.addEventListener('blur', (e) => {
            this.animateInputBlur(e.target);
        });
        
        // Предотвращение ввода отрицательных значений
        scaleInput.addEventListener('keydown', (e) => {
            if (e.key === '-' || e.key === 'e') {
                e.preventDefault();
            }
        });
        
        textHeightInput.addEventListener('keydown', (e) => {
            if (e.key === '-' || e.key === 'e') {
                e.preventDefault();
            }
        });
    },
    
    handleScaleInput(value) {
        clearTimeout(this.debounceTimer);
        
        // Очистка второго поля при вводе
        const textHeightInput = document.getElementById('textHeightInput');
        if (value) {
            textHeightInput.value = '';
            textHeightInput.parentElement.classList.remove('has-value');
        }
        
        // Задержка перед расчётом
        this.debounceTimer = setTimeout(() => {
            if (value && !isNaN(value) && value > 0) {
                const scale = parseFloat(value);
                const textHeight = this.calculateTextHeightFromScale(scale);
                this.displayResult('scale', scale, textHeight);
                this.animateResult();
            } else if (!value) {
                this.clearResult();
            }
        }, 300);
    },
    
    handleTextHeightInput(value) {
        clearTimeout(this.debounceTimer);
        
        // Очистка второго поля при вводе
        const scaleInput = document.getElementById('scaleInput');
        if (value) {
            scaleInput.value = '';
            scaleInput.parentElement.classList.remove('has-value');
        }
        
        // Задержка перед расчётом
        this.debounceTimer = setTimeout(() => {
            if (value && !isNaN(value) && value > 0) {
                const textHeight = parseFloat(value);
                const scale = this.calculateScaleFromTextHeight(textHeight);
                this.displayResult('height', scale, textHeight);
                this.animateResult();
            } else if (!value) {
                this.clearResult();
            }
        }, 300);
    },
    
    // Расчёт высоты текста по масштабу (логарифмическая интерполяция)
    calculateTextHeightFromScale(scale) {
        const { scale1, height1, scale2, height2 } = this.knownValues;
        
        // Логарифмическая интерполяция для более точных результатов
        const logScale = Math.log(scale);
        const logScale1 = Math.log(scale1);
        const logScale2 = Math.log(scale2);
        const logHeight1 = Math.log(height1);
        const logHeight2 = Math.log(height2);
        
        // Интерполяция в логарифмическом пространстве
        const t = (logScale - logScale1) / (logScale2 - logScale1);
        const logHeight = logHeight1 + t * (logHeight2 - logHeight1);
        
        // Преобразование обратно из логарифмического пространства
        const height = Math.exp(logHeight);
        
        // Округление до 3 знаков после запятой
        return Math.round(height * 1000) / 1000;
    },
    
    // Расчёт масштаба по высоте текста
    calculateScaleFromTextHeight(textHeight) {
        const { scale1, height1, scale2, height2 } = this.knownValues;
        
        // Логарифмическая интерполяция
        const logHeight = Math.log(textHeight);
        const logHeight1 = Math.log(height1);
        const logHeight2 = Math.log(height2);
        const logScale1 = Math.log(scale1);
        const logScale2 = Math.log(scale2);
        
        // Интерполяция в логарифмическом пространстве
        const t = (logHeight - logHeight1) / (logHeight2 - logHeight1);
        const logScale = logScale1 + t * (logScale2 - logScale1);
        
        // Преобразование обратно из логарифмического пространства
        const scale = Math.exp(logScale);
        
        // Округление до целого числа
        return Math.round(scale);
    },
    
    displayResult(inputType, scale, textHeight) {
        const resultContent = document.getElementById('resultContent');
        const resultSection = document.getElementById('resultSection');
        
        let html = '';
        
        if (inputType === 'scale') {
            html = `
                <div class="result-item primary">
                    <span class="result-label">Для масштаба 1:${scale}</span>
                    <span class="result-value">${textHeight} мм</span>
                </div>
                <div class="result-explanation">
                    Рекомендуемая высота текста на карте данного масштаба составляет ${textHeight} миллиметров
                </div>
            `;
        } else {
            html = `
                <div class="result-item primary">
                    <span class="result-label">Для высоты текста ${textHeight} мм</span>
                    <span class="result-value">1:${scale}</span>
                </div>
                <div class="result-explanation">
                    Текст высотой ${textHeight} мм соответствует масштабу карты 1:${scale}
                </div>
            `;
        }
        
        resultContent.innerHTML = html;
        resultSection.classList.add('active');
        
        // Сохранение в историю
        this.addToHistory(scale, textHeight);
    },
    
    clearResult() {
        const resultSection = document.getElementById('resultSection');
        const resultContent = document.getElementById('resultContent');
        
        resultSection.classList.remove('active');
        setTimeout(() => {
            resultContent.innerHTML = '<p>Введите значение масштаба или высоты текста для расчёта</p>';
        }, 300);
    },
    
    clearInputs() {
        const scaleInput = document.getElementById('scaleInput');
        const textHeightInput = document.getElementById('textHeightInput');
        
        scaleInput.value = '';
        textHeightInput.value = '';
        
        // Удаление классов состояния
        scaleInput.parentElement.classList.remove('has-value');
        textHeightInput.parentElement.classList.remove('has-value');
        
        this.clearResult();
        this.showToast('Поля очищены');
    },
    
    // Работа с историей
    async addToHistory(scale, textHeight) {
        const timestamp = new Date().toISOString();
        const entry = {
            id: Date.now(),
            scale,
            textHeight,
            timestamp
        };
        
        // Добавление в начало массива
        this.history.unshift(entry);
        
        // Ограничение размера истории (максимум 20 записей)
        if (this.history.length > 20) {
            this.history = this.history.slice(0, 20);
        }
        
        await this.saveHistory();
        this.renderHistory();
    },
    
    async clearHistory() {
        if (confirm('Вы действительно хотите очистить всю историю расчётов?')) {
            this.history = [];
            await this.saveHistory();
            this.renderHistory();
            this.showToast('История очищена');
        }
    },
    
    renderHistory() {
        const historyList = document.getElementById('historyList');
        const historySection = document.getElementById('historySection');
        
        if (this.history.length === 0) {
            historyList.innerHTML = '<p class="history-empty">История пока пуста</p>';
            historySection.classList.remove('has-history');
            return;
        }
        
        historySection.classList.add('has-history');
        
        const syncStatus = this.pendingSync && !this.isOnline ? ' <span class="sync-pending">⏳</span>' : '';
        
        const html = this.history.map(entry => {
            const date = new Date(entry.timestamp);
            const timeStr = date.toLocaleTimeString('ru-RU', { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
            const dateStr = date.toLocaleDateString('ru-RU', { 
                day: 'numeric', 
                month: 'short' 
            });
            
            return `
                <div class="history-item" onclick="scaleCalculator.restoreFromHistory(${entry.scale}, ${entry.textHeight})">
                    <div class="history-values">
                        <span class="history-scale">1:${entry.scale}</span>
                        <span class="history-arrow">↔</span>
                        <span class="history-height">${entry.textHeight} мм</span>
                    </div>
                    <div class="history-time">${timeStr}, ${dateStr}</div>
                </div>
            `;
        }).join('');
        
        historyList.innerHTML = html + (this.history.length > 0 && syncStatus ? `<div class="sync-status">${syncStatus}</div>` : '');
    },
    
    restoreFromHistory(scale, textHeight) {
        const scaleInput = document.getElementById('scaleInput');
        const textHeightInput = document.getElementById('textHeightInput');
        
        // Анимация восстановления
        scaleInput.value = scale;
        textHeightInput.value = '';
        
        scaleInput.parentElement.classList.add('has-value');
        textHeightInput.parentElement.classList.remove('has-value');
        
        this.displayResult('scale', scale, textHeight);
        this.animateResult();
        this.showToast('Значение восстановлено из истории');
        
        // Прокрутка к калькулятору
        document.querySelector('.calculator-card').scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center' 
        });
    },
    
    // Анимации
    animateInputFocus(input) {
        const wrapper = input.parentElement;
        wrapper.classList.add('focused');
        
        const underline = wrapper.querySelector('.input-underline');
        underline.style.transform = 'scaleX(1)';
    },
    
    animateInputBlur(input) {
        const wrapper = input.parentElement;
        wrapper.classList.remove('focused');
        
        if (input.value) {
            wrapper.classList.add('has-value');
        } else {
            wrapper.classList.remove('has-value');
            const underline = wrapper.querySelector('.input-underline');
            underline.style.transform = 'scaleX(0)';
        }
    },
    
    animateResult() {
        const resultCard = document.querySelector('.result-card');
        resultCard.classList.add('animate-in');
        
        setTimeout(() => {
            resultCard.classList.remove('animate-in');
        }, 600);
    },
    
    addInitialAnimation() {
        // Анимация появления элементов при загрузке
        const elements = [
            '.info-card',
            '.calculator-card',
            '.history-section',
            '.help-section'
        ];
        
        elements.forEach((selector, index) => {
            const element = document.querySelector(selector);
            if (element) {
                element.style.opacity = '0';
                element.style.transform = 'translateY(20px)';
                
                setTimeout(() => {
                    element.style.transition = 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
                    element.style.opacity = '1';
                    element.style.transform = 'translateY(0)';
                }, 100 + (index * 100));
            }
        });
    },
    
    // Уведомления
    showToast(message) {
        const toast = document.getElementById('toast');
        
        let displayMessage = message;
        if (this.pendingSync && !this.isOnline) {
            displayMessage += ' (ожидает синхронизации)';
        }
        
        toast.textContent = displayMessage;
        toast.classList.add('show');
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    },

    // Экспорт истории
    exportHistory() {
        if (this.history.length === 0) {
            this.showToast('История пуста');
            return;
        }
        
        const data = {
            history: this.history,
            exportDate: new Date().toISOString(),
            version: '1.0'
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `scale-calculator-history-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        this.showToast('История экспортирована');
    },

    // Импорт истории
    async importHistory(file) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                if (data.history && Array.isArray(data.history)) {
                    // Объединяем с существующей историей, избегая дубликатов
                    const existingIds = new Set(this.history.map(entry => entry.id));
                    const newEntries = data.history.filter(entry => !existingIds.has(entry.id));
                    
                    this.history = [...newEntries, ...this.history];
                    
                    // Ограничиваем размер
                    if (this.history.length > 50) {
                        this.history = this.history.slice(0, 50);
                    }
                    
                    await this.saveHistory();
                    this.renderHistory();
                    this.showToast(`Импортировано ${newEntries.length} записей`);
                } else {
                    this.showToast('Неверный формат файла');
                }
            } catch (error) {
                this.showToast('Ошибка импорта');
                console.error('Import error:', error);
            }
        };
        reader.readAsText(file);
    }
};

// Инициализация при загрузке DOM
document.addEventListener('DOMContentLoaded', () => {
    scaleCalculator.init();
});

// Регистрация service worker для PWA
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.log('Service Worker registration failed:', error);
    });
