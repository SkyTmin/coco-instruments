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
    
    init() {
        console.log('Инициализация калькулятора масштабов');
        this.loadHistory();
        this.setupEventListeners();
        this.renderHistory();
        this.addInitialAnimation();
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
    addToHistory(scale, textHeight) {
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
        
        this.saveHistory();
        this.renderHistory();
    },
    
    loadHistory() {
        const saved = localStorage.getItem('scaleCalculatorHistory');
        if (saved) {
            try {
                this.history = JSON.parse(saved) || [];
            } catch (e) {
                console.error('Ошибка загрузки истории:', e);
                this.history = [];
            }
        }
    },
    
    saveHistory() {
        localStorage.setItem('scaleCalculatorHistory', JSON.stringify(this.history));
    },
    
    clearHistory() {
        if (confirm('Вы действительно хотите очистить всю историю расчётов?')) {
            this.history = [];
            this.saveHistory();
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
        
        historyList.innerHTML = html;
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
        toast.textContent = message;
        toast.classList.add('show');
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
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
}