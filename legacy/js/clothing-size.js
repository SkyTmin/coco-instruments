const clothingSize = {
    // Состояние приложения
    state: {
        currentSection: 'parameters',
        currentUnit: 'cm',
        currentGender: 'male',
        parameters: {},
        savedResults: [],
        currentCategory: null
    },
    isOnline: navigator.onLine,
    pendingSync: false,

    // Формулы расчета размеров
    formulas: {
        outerwear: {
            calculate(chest) {
                const ru = Math.round(chest / 2);
                const eu = ru;
                const us = ru - 10;
                const int = this.getIntSize(chest);
                return { ru, eu, us, int };
            },
            getIntSize(chest) {
                if (chest >= 86 && chest < 94) return 'S';
                if (chest >= 94 && chest < 102) return 'M';
                if (chest >= 102 && chest < 110) return 'L';
                if (chest >= 110 && chest < 118) return 'XL';
                if (chest >= 118 && chest < 126) return 'XXL';
                return 'XXXL';
            },
            required: ['chest', 'height']
        },

        shirts: {
            calculate(chest, neck) {
                const collarSize = neck ? neck + 1.5 : null;
                const bodySize = Math.round(chest / 2);
                const int = this.getIntSize(chest);
                return { bodySize, collarSize, int };
            },
            getIntSize(chest) {
                const halfChest = chest / 2;
                if (halfChest >= 46 && halfChest < 50) return 'S';
                if (halfChest >= 50 && halfChest < 52) return 'M';
                if (halfChest >= 52 && halfChest < 54) return 'L';
                if (halfChest >= 54 && halfChest < 56) return 'XL';
                if (halfChest >= 56 && halfChest < 58) return 'XXL';
                return 'XXXL';
            },
            required: ['chest', 'neck']
        },

        pants: {
            calculate(waist, inseam) {
                const w = Math.round(waist / 2.54);
                const l = inseam ? Math.round(inseam / 2.54) : null;
                return { w, l };
            },
            required: ['waist', 'inseam']
        },

        shoes: {
            calculate(footLength) {
                const ru = Math.round(footLength * 1.5);
                const eu = Math.round(footLength + 1.5);
                const usMale = Math.round((footLength / 2.54) * 3 - 22);
                const usFemale = Math.round((footLength / 2.54) * 3 - 21);
                const uk = eu - 33;
                return { ru, eu, usMale, usFemale, uk };
            },
            required: ['foot']
        },

        underwear: {
            calculate(chest, underbust) {
                const bandSize = Math.round(underbust);
                const difference = chest - underbust;
                let cupSize = 'A';
                
                if (difference < 10) cupSize = 'A';
                else if (difference >= 10 && difference <= 12) cupSize = 'B';
                else if (difference >= 13 && difference <= 15) cupSize = 'C';
                else if (difference >= 16 && difference <= 18) cupSize = 'D';
                else if (difference > 18) cupSize = 'E';
                
                return { size: `${bandSize}${cupSize}`, bandSize, cupSize };
            },
            required: ['chest', 'underbust']
        }
    },

    // Подсказки для измерений
    hints: {
        height: {
            title: 'Измерение роста',
            description: 'Измеряется босиком, стоя прямо у стены',
            tips: [
                'Встаньте спиной к стене',
                'Пятки, ягодицы и лопатки касаются стены',
                'Смотрите прямо перед собой',
                'Измерьте от пола до макушки'
            ]
        },
        weight: {
            title: 'Измерение веса',
            description: 'Взвешивайтесь утром натощак',
            tips: [
                'Используйте одни и те же весы',
                'Взвешивайтесь в одно время',
                'Минимум одежды'
            ]
        },
        chest: {
            title: 'Обхват груди',
            description: 'Измеряется по самой выступающей части груди',
            tips: [
                'Лента проходит горизонтально',
                'Руки опущены вдоль тела',
                'Не затягивайте ленту слишком туго',
                'Сделайте выдох перед измерением'
            ]
        },
        underbust: {
            title: 'Обхват под грудью',
            description: 'Измеряется строго под грудью',
            tips: [
                'Лента должна быть параллельна полу',
                'Плотно, но не туго',
                'На выдохе'
            ]
        },
        waist: {
            title: 'Обхват талии',
            description: 'Измеряется в самой узкой части талии',
            tips: [
                'Найдите естественную линию талии',
                'Не втягивайте живот',
                'Лента параллельна полу'
            ]
        },
        hips: {
            title: 'Обхват бедер',
            description: 'Измеряется по самой широкой части бедер',
            tips: [
                'Ноги вместе',
                'Лента проходит по ягодицам',
                'Горизонтально полу'
            ]
        },
        neck: {
            title: 'Обхват шеи',
            description: 'Измеряется у основания шеи',
            tips: [
                'Лента проходит над адамовым яблоком',
                'Можно просунуть палец между лентой и шеей',
                'Для рубашек важно точное измерение'
            ]
        },
        foot: {
            title: 'Длина стопы',
            description: 'Измеряется от пятки до большого пальца',
            tips: [
                'Встаньте на лист бумаги',
                'Обведите стопу карандашом',
                'Измерьте максимальную длину',
                'Измеряйте вечером'
            ]
        },
        inseam: {
            title: 'Длина внутреннего шва',
            description: 'От паха до пола',
            tips: [
                'Встаньте прямо',
                'Измерьте от паха до пола',
                'Или измерьте на хорошо сидящих брюках'
            ]
        },
        wrist: {
            title: 'Обхват запястья',
            description: 'Измеряется в самой узкой части',
            tips: [
                'Расслабьте руку',
                'Измерьте там, где носите часы'
            ]
        },
        head: {
            title: 'Обхват головы',
            description: 'По линии лба',
            tips: [
                'Лента проходит над бровями',
                'Над ушами',
                'По самой широкой части головы'
            ]
        }
    },

    // Таблицы размеров
    sizeTables: {
        tops: {
            headers: ['RU', 'EU', 'US', 'UK', 'INT', 'Обхват груди'],
            data: [
                ['44', '46', '36', '34', 'S', '86-94 см'],
                ['46', '48', '38', '36', 'M', '94-102 см'],
                ['48', '50', '40', '38', 'L', '102-110 см'],
                ['50', '52', '42', '40', 'XL', '110-118 см'],
                ['52', '54', '44', '42', 'XXL', '118-126 см']
            ]
        },
        bottoms: {
            headers: ['W (дюймы)', 'Обхват талии (см)', 'INT'],
            data: [
                ['28', '71-73', 'XS'],
                ['30', '76-78', 'S'],
                ['32', '81-83', 'M'],
                ['34', '86-88', 'L'],
                ['36', '91-93', 'XL']
            ]
        },
        shoes: {
            headers: ['RU', 'EU', 'US мужской', 'US женский', 'UK', 'Длина стопы (см)'],
            data: [
                ['39', '40', '7', '8.5', '6', '25.5'],
                ['40', '41', '8', '9.5', '7', '26'],
                ['41', '42', '9', '10.5', '8', '26.5'],
                ['42', '43', '10', '11.5', '9', '27.5'],
                ['43', '44', '11', '12.5', '10', '28']
            ]
        }
    },

    // Инициализация
    init() {
        this.setupEventListeners();
        this.setupNetworkListeners();
        this.loadSavedData();
        this.updateGenderSpecificElements();
        this.initializeAnimations();
        this.checkRequiredParameters();
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

    // Загрузка сохраненных данных
    async loadSavedData() {
    const user = await API.getProfile();
    if (user && this.isOnline) {
        // Загружаем данные с сервера ТОЛЬКО для авторизованного пользователя
        try {
            const serverData = await API.clothingSize.getData();
            
            this.state.parameters = serverData.parameters || {};
            this.state.savedResults = serverData.savedResults || [];
            this.state.currentGender = serverData.currentGender || 'male';
            
            // Сохраняем в localStorage как резервную копию
            this.saveToLocalStorage();
        } catch (err) {
            console.error('Failed to load from server:', err);
            // НЕ загружаем из localStorage при ошибке если пользователь авторизован
            // Показываем пустые данные
            this.state = {
                currentSection: 'parameters',
                currentUnit: 'cm',
                currentGender: 'male',
                parameters: {},
                savedResults: [],
                currentCategory: null
            };
        }
    } else if (!user) {
        // Если пользователь не авторизован - показываем пустые данные
        this.state = {
            currentSection: 'parameters',
            currentUnit: 'cm',
            currentGender: 'male',
            parameters: {},
            savedResults: [],
            currentCategory: null
        };
    } else {
        // Пользователь авторизован, но офлайн - загружаем из localStorage
        this.loadFromLocalStorage();
    }
    
    this.restoreParameters();
},

    loadFromLocalStorage() {
        const saved = localStorage.getItem('clothingSizeData');
        if (saved) {
            const data = JSON.parse(saved);
            this.state.parameters = data.parameters || {};
            this.state.savedResults = data.savedResults || [];
            this.state.currentGender = data.currentGender || 'male';
        }
    },

    saveToLocalStorage() {
        const data = {
            parameters: this.state.parameters,
            savedResults: this.state.savedResults,
            currentGender: this.state.currentGender
        };
        localStorage.setItem('clothingSizeData', JSON.stringify(data));
    },

    async saveData() {
        // Всегда сохраняем в localStorage
        this.saveToLocalStorage();
        
        // Пытаемся синхронизировать с сервером
        if (this.isOnline) {
            await this.syncToServer();
        } else {
            this.pendingSync = true;
        }
    },

    async syncToServer() {
        const user = await API.getProfile();
        if (!user) return;

        try {
            const data = {
                parameters: this.state.parameters,
                savedResults: this.state.savedResults,
                currentGender: this.state.currentGender
            };
            
            await API.clothingSize.saveData(data);
            this.pendingSync = false;
            this.showToast('Данные синхронизированы', 'success');
        } catch (err) {
            console.error('Failed to sync to server:', err);
            this.pendingSync = true;
            this.showToast('Ошибка синхронизации', 'warning');
        }
    },

    // Восстановление параметров в форме
    restoreParameters() {
        Object.keys(this.state.parameters).forEach(key => {
            const input = document.getElementById(key);
            if (input) {
                input.value = this.state.parameters[key];
                input.classList.add('has-value');
            }
        });
        
        const genderRadio = document.querySelector(`input[name="gender"][value="${this.state.currentGender}"]`);
        if (genderRadio) {
            genderRadio.checked = true;
        }
    },

    // Настройка обработчиков событий
    setupEventListeners() {
        // Переключение единиц измерения
        document.querySelectorAll('.unit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchUnit(e.target.dataset.unit));
        });

        // Переключение пола
        document.querySelectorAll('input[name="gender"]').forEach(radio => {
            radio.addEventListener('change', (e) => this.switchGender(e.target.value));
        });

        // Навигация
        document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const section = e.currentTarget.dataset.section;
                this.switchSection(section);
            });
        });

        // Подсказки
        document.querySelectorAll('.hint-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.showHint(e.target.dataset.hint);
            });
        });

        // Закрытие модалок
        document.querySelector('.hint-close').addEventListener('click', () => {
            document.getElementById('hint-modal').classList.remove('active');
        });

        document.querySelector('.result-close').addEventListener('click', () => {
            document.getElementById('result-modal').classList.remove('active');
        });

        // Клик вне модалки
        ['hint-modal', 'result-modal'].forEach(modalId => {
            document.getElementById(modalId).addEventListener('click', (e) => {
                if (e.target.id === modalId) {
                    e.target.classList.remove('active');
                }
            });
        });

        // Сохранение параметров
        document.querySelector('.save-params-btn').addEventListener('click', () => {
            this.saveParameters();
        });

        // Кнопки расчета
        document.querySelectorAll('.calculate-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const category = e.target.closest('.category-card').dataset.category;
                this.calculateSize(category);
            });
        });

        // Ввод параметров
        document.querySelectorAll('.parameter-input input').forEach(input => {
            input.addEventListener('input', (e) => {
                if (e.target.value) {
                    e.target.classList.add('has-value');
                } else {
                    e.target.classList.remove('has-value');
                }
                this.validateInput(e.target);
            });

            input.addEventListener('blur', () => {
                this.checkRequiredParameters();
            });
        });

        // Переключение таблиц
        document.querySelector('.table-type-select').addEventListener('change', (e) => {
            this.updateSizeTable(e.target.value);
        });

        // Переключение вида таблиц
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchTableView(e.target.dataset.view);
            });
        });

        // Слайдер оверсайз
        const slider = document.getElementById('oversize-slider');
        slider.addEventListener('input', (e) => {
            this.updateOversizeCalculation(e.target.value);
        });

        // Кнопка профиля
        document.querySelector('.profile-btn').addEventListener('click', () => {
            this.showProfile();
        });

        // Кнопка редактирования
        document.querySelector('.edit-btn').addEventListener('click', () => {
            this.toggleEditMode();
        });

        // Сохранение результата
        document.querySelector('.save-result-btn').addEventListener('click', () => {
            this.saveResult();
        });
    },

    // Переключение единиц измерения
    switchUnit(unit) {
        this.state.currentUnit = unit;
        document.querySelectorAll('.unit-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.unit === unit);
        });

        // Конвертация значений
        const factor = unit === 'inch' ? 0.393701 : 2.54;
        document.querySelectorAll('.parameter-input input').forEach(input => {
            if (input.value) {
                const currentValue = parseFloat(input.value);
                input.value = unit === 'inch' 
                    ? (currentValue * 0.393701).toFixed(1)
                    : Math.round(currentValue * 2.54);
            }
        });

        // Обновление единиц
        document.querySelectorAll('.unit').forEach(span => {
            span.textContent = unit === 'inch' ? 'in' : 'см';
        });

        this.showToast(`Единицы изменены на ${unit === 'inch' ? 'дюймы' : 'сантиметры'}`);
    },

    // Переключение пола
    switchGender(gender) {
        this.state.currentGender = gender;
        this.updateGenderSpecificElements();
        this.checkRequiredParameters();
        this.saveData(); // Auto-save gender change
    },

    // Обновление элементов в зависимости от пола
    updateGenderSpecificElements() {
        const isFemale = this.state.currentGender === 'female';
        
        document.querySelectorAll('.female-only').forEach(el => {
            el.style.display = isFemale ? '' : 'none';
        });

        // Обновление категорий
        if (!isFemale) {
            const underwearCard = document.querySelector('[data-category="underwear"]');
            if (underwearCard) underwearCard.style.display = 'none';
        }
    },

    // Переключение секций
    switchSection(section) {
        this.state.currentSection = section;
        
        // Обновление навигации
        document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.section === section);
        });

        // Показ секции
        document.querySelectorAll('.content-section').forEach(sec => {
            sec.classList.toggle('active', sec.id === `${section}-section`);
        });

        // Анимация появления
        const activeSection = document.querySelector('.content-section.active');
        if (activeSection) {
            activeSection.style.animation = 'fadeInUp 0.4s ease';
        }

        // Обновление данных для секций
        if (section === 'tables') {
            this.updateSizeTable('tops');
        } else if (section === 'oversize') {
            this.initializeOversizeSection();
        }
    },

    // Показ подсказки
    showHint(parameter) {
        const hint = this.hints[parameter];
        if (!hint) return;

        document.getElementById('hint-title').textContent = hint.title;
        document.getElementById('hint-description').textContent = hint.description;
        
        const tipsList = document.getElementById('hint-tips');
        tipsList.innerHTML = hint.tips.map(tip => `<li>${tip}</li>`).join('');

        // Добавление иллюстрации
        this.addHintIllustration(parameter);

        document.getElementById('hint-modal').classList.add('active');
    },

    // Добавление иллюстрации к подсказке
    addHintIllustration(parameter) {
        const imageContainer = document.getElementById('hint-image');
        
        // SVG иллюстрации для каждого параметра
        const illustrations = {
            chest: `<svg viewBox="0 0 200 200" fill="none" stroke="currentColor">
                <circle cx="100" cy="100" r="60" stroke-dasharray="5,5"/>
                <path d="M40 100 Q100 120 160 100" stroke-width="2"/>
                <text x="100" y="180" text-anchor="middle" fill="currentColor">Обхват груди</text>
            </svg>`,
            waist: `<svg viewBox="0 0 200 200" fill="none" stroke="currentColor">
                <ellipse cx="100" cy="100" rx="50" ry="40" stroke-dasharray="5,5"/>
                <path d="M50 100 Q100 90 150 100" stroke-width="2"/>
                <text x="100" y="180" text-anchor="middle" fill="currentColor">Обхват талии</text>
            </svg>`,
            // Добавьте другие иллюстрации
        };

        imageContainer.innerHTML = illustrations[parameter] || '<div class="no-illustration">Иллюстрация</div>';
    },

    // Валидация ввода
    validateInput(input) {
        const value = parseFloat(input.value);
        const min = parseFloat(input.min);
        const max = parseFloat(input.max);

        if (value < min || value > max) {
            input.classList.add('error');
            this.showToast(`Значение должно быть от ${min} до ${max}`, 'error');
            return false;
        }

        input.classList.remove('error');
        return true;
    },

    // Проверка обязательных параметров
    checkRequiredParameters() {
        document.querySelectorAll('.category-card').forEach(card => {
            const category = card.dataset.category;
            const formula = this.formulas[category];
            if (!formula) return;

            const hasAllRequired = formula.required.every(param => {
                const input = document.getElementById(param);
                return input && input.value && !input.classList.contains('error');
            });

            const btn = card.querySelector('.calculate-btn');
            btn.disabled = !hasAllRequired;
            btn.style.opacity = hasAllRequired ? '1' : '0.5';
        });
    },

    // Сохранение параметров
    async saveParameters() {
        const params = {};
        document.querySelectorAll('.parameter-input input').forEach(input => {
            if (input.value) {
                params[input.id] = parseFloat(input.value);
            }
        });

        this.state.parameters = params;
        await this.saveData();
        this.showToast('Параметры сохранены');
        this.checkRequiredParameters();
    },

    // Расчет размера
    calculateSize(category) {
        const formula = this.formulas[category];
        if (!formula) return;

        const params = {};
        formula.required.forEach(param => {
            const input = document.getElementById(param);
            if (input) {
                params[param] = parseFloat(input.value);
            }
        });

        // Проверка наличия всех параметров
        if (Object.keys(params).length !== formula.required.length) {
            this.showToast('Заполните все необходимые параметры', 'error');
            return;
        }

        // Расчет
        const result = formula.calculate(...Object.values(params));
        this.showResult(category, result);
    },

    // Показ результата
    showResult(category, result) {
        const modal = document.getElementById('result-modal');
        const display = document.getElementById('result-display');
        
        let html = '<div class="result-grid">';
        
        switch(category) {
            case 'outerwear':
                html += `
                    <div class="result-item">
                        <span class="result-label">Российский размер:</span>
                        <span class="result-value">${result.ru}</span>
                    </div>
                    <div class="result-item">
                        <span class="result-label">Европейский размер:</span>
                        <span class="result-value">${result.eu}</span>
                    </div>
                    <div class="result-item">
                        <span class="result-label">Американский размер:</span>
                        <span class="result-value">${result.us}</span>
                    </div>
                    <div class="result-item">
                        <span class="result-label">Международный:</span>
                        <span class="result-value">${result.int}</span>
                    </div>
                    <div class="result-tip">
                        💡 Для зимней одежды рекомендуем взять на размер больше
                    </div>
                `;
                break;
                
            case 'shirts':
                html += `
                    <div class="result-item">
                        <span class="result-label">Размер тела:</span>
                        <span class="result-value">${result.bodySize}</span>
                    </div>
                    ${result.collarSize ? `
                    <div class="result-item">
                        <span class="result-label">Размер воротника:</span>
                        <span class="result-value">${result.collarSize.toFixed(1)} см</span>
                    </div>` : ''}
                    <div class="result-item">
                        <span class="result-label">Международный:</span>
                        <span class="result-value">${result.int}</span>
                    </div>
                `;
                break;
                
            case 'pants':
                html += `
                    <div class="result-item">
                        <span class="result-label">Ширина (W):</span>
                        <span class="result-value">${result.w}"</span>
                    </div>
                    ${result.l ? `
                    <div class="result-item">
                        <span class="result-label">Длина (L):</span>
                        <span class="result-value">${result.l}"</span>
                    </div>` : ''}
                    <div class="result-item full-width">
                        <span class="result-label">Размер джинсов:</span>
                        <span class="result-value">W${result.w}${result.l ? `/L${result.l}` : ''}</span>
                    </div>
                `;
                break;
                
            case 'shoes':
                html += `
                    <div class="result-item">
                        <span class="result-label">Российский:</span>
                        <span class="result-value">${result.ru}</span>
                    </div>
                    <div class="result-item">
                        <span class="result-label">Европейский:</span>
                        <span class="result-value">${result.eu}</span>
                    </div>
                    <div class="result-item">
                        <span class="result-label">US мужской:</span>
                        <span class="result-value">${result.usMale}</span>
                    </div>
                    <div class="result-item">
                        <span class="result-label">US женский:</span>
                        <span class="result-value">${result.usFemale}</span>
                    </div>
                    <div class="result-item">
                        <span class="result-label">UK:</span>
                        <span class="result-value">${result.uk}</span>
                    </div>
                `;
                break;
                
            case 'underwear':
                html += `
                    <div class="result-item full-width">
                        <span class="result-label">Размер бюстгальтера:</span>
                        <span class="result-value large">${result.size}</span>
                    </div>
                    <div class="result-item">
                        <span class="result-label">Обхват пояса:</span>
                        <span class="result-value">${result.bandSize}</span>
                    </div>
                    <div class="result-item">
                        <span class="result-label">Размер чашки:</span>
                        <span class="result-value">${result.cupSize}</span>
                    </div>
                `;
                break;
        }
        
        html += '</div>';
        
        display.innerHTML = html;
        this.state.currentCategory = category;
        modal.classList.add('active');
    },

    // Сохранение результата
    async saveResult() {
        if (!this.state.currentCategory) return;
        
        const result = {
            category: this.state.currentCategory,
            date: new Date().toISOString(),
            parameters: { ...this.state.parameters }
        };
        
        this.state.savedResults.unshift(result);
        if (this.state.savedResults.length > 10) {
            this.state.savedResults = this.state.savedResults.slice(0, 10);
        }
        
        await this.saveData();
        this.showToast('Результат сохранен');
        document.getElementById('result-modal').classList.remove('active');
    },

    // Обновление таблицы размеров
    updateSizeTable(type) {
        const table = this.sizeTables[type];
        if (!table) return;

        const tableEl = document.getElementById('size-table');
        const thead = tableEl.querySelector('thead tr');
        const tbody = tableEl.querySelector('tbody');

        // Обновление заголовков
        thead.innerHTML = table.headers.map(h => `<th>${h}</th>`).join('');

        // Обновление данных
        tbody.innerHTML = table.data.map(row => 
            `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`
        ).join('');

        // Подсветка размера пользователя
        this.highlightUserSize(type);
    },

    // Подсветка размера пользователя
    highlightUserSize(type) {
        // Логика определения размера пользователя на основе параметров
        const chest = this.state.parameters.chest;
        if (!chest) return;

        const rows = document.querySelectorAll('#size-table tbody tr');
        rows.forEach(row => {
            const chestRange = row.cells[row.cells.length - 1].textContent;
            if (this.isInRange(chest, chestRange)) {
                row.classList.add('highlighted');
            } else {
                row.classList.remove('highlighted');
            }
        });
    },

    // Проверка попадания в диапазон
    isInRange(value, range) {
        const match = range.match(/(\d+)-(\d+)/);
        if (!match) return false;
        
        const min = parseInt(match[1]);
        const max = parseInt(match[2]);
        return value >= min && value <= max;
    },

    // Переключение вида таблицы
    switchTableView(view) {
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === view);
        });

        const table = document.querySelector('.size-table-wrapper');
        const cards = document.getElementById('size-cards');

        if (view === 'table') {
            table.style.display = 'block';
            cards.style.display = 'none';
        } else {
            table.style.display = 'none';
            cards.style.display = 'grid';
            this.renderSizeCards();
        }
    },

    // Отрисовка карточек размеров
    renderSizeCards() {
        const type = document.querySelector('.table-type-select').value;
        const table = this.sizeTables[type];
        if (!table) return;

        const cardsContainer = document.getElementById('size-cards');
        cardsContainer.innerHTML = table.data.map(row => {
            const card = `
                <div class="size-card">
                    ${row.map((cell, i) => `
                        <div class="size-card-item">
                            <span class="size-label">${table.headers[i]}:</span>
                            <span class="size-value">${cell}</span>
                        </div>
                    `).join('')}
                </div>
            `;
            return card;
        }).join('');
    },

    // Инициализация секции оверсайз
    initializeOversizeSection() {
        const chest = this.state.parameters.chest;
        if (chest) {
            const baseSize = this.formulas.shirts.getIntSize(chest);
            document.getElementById('base-size').textContent = baseSize;
            this.updateOversizeCalculation(1);
        }
    },

    // Обновление расчета оверсайз
    updateOversizeCalculation(level) {
        const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
        const chest = this.state.parameters.chest;
        
        if (!chest) {
            this.showToast('Сначала укажите обхват груди в параметрах', 'warning');
            return;
        }

        const baseSize = this.formulas.shirts.getIntSize(chest);
        const baseIndex = sizes.indexOf(baseSize);
        const newIndex = Math.min(baseIndex + parseInt(level), sizes.length - 1);
        const newSize = sizes[newIndex];

        document.getElementById('oversize-result').textContent = newSize;

        // Обновление советов
        const tips = {
            0: [
                'Это ваш обычный размер',
                'Идеально для классической посадки'
            ],
            1: [
                'Сочетайте с облегающим низом для баланса',
                'Подчеркните талию ремнем или заправьте спереди'
            ],
            2: [
                'Носите с узкими брюками или леггинсами',
                'Добавьте структурированные аксессуары'
            ],
            3: [
                'Создайте многослойный образ',
                'Используйте как платье с высокими сапогами'
            ]
        };

        const tipsList = document.getElementById('oversize-tips');
        tipsList.innerHTML = tips[level].map(tip => `<li>${tip}</li>`).join('');
    },

    // Показ профиля
    showProfile() {
        this.switchSection('parameters');
        this.showToast('Профиль пользователя');
    },

    // Переключение режима редактирования
    toggleEditMode() {
        const container = document.querySelector('.parameters-container');
        container.classList.toggle('edit-mode');
        
        const inputs = container.querySelectorAll('input[type="number"]');
        inputs.forEach(input => {
            input.readOnly = !input.readOnly;
        });
        
        this.showToast(container.classList.contains('edit-mode') 
            ? 'Режим редактирования включен' 
            : 'Режим редактирования выключен'
        );
    },

    // Показ уведомления
    showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast ${type}`;
        toast.classList.add('show');
        
        if (this.pendingSync && !this.isOnline) {
            message += ' (ожидает синхронизации)';
        }
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    },

    // Инициализация анимаций
    initializeAnimations() {
        // Анимация появления карточек
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('animated');
                }
            });
        }, { threshold: 0.1 });

        document.querySelectorAll('.category-card, .parameter-block').forEach(el => {
            observer.observe(el);
        });

        // Плавная прокрутка
        this.initSmoothScrolling();
    },

    // Плавная прокрутка
    initSmoothScrolling() {
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                e.preventDefault();
                const target = document.querySelector(this.getAttribute('href'));
                if (target) {
                    target.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            });
        });
    },

    // Экспорт данных
    exportData() {
        const data = {
            parameters: this.state.parameters,
            savedResults: this.state.savedResults,
            date: new Date().toISOString()
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `clothing-sizes-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        this.showToast('Данные экспортированы');
    },

    // Импорт данных
    async importData(file) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                this.state.parameters = data.parameters || {};
                this.state.savedResults = data.savedResults || [];
                this.restoreParameters();
                await this.saveData();
                this.showToast('Данные импортированы');
            } catch (error) {
                this.showToast('Ошибка импорта данных', 'error');
            }
        };
        reader.readAsText(file);
    }
};

// Инициализация при загрузке DOM
document.addEventListener('DOMContentLoaded', () => {
    clothingSize.init();
});

// Регистрация service worker для PWA
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.log('Service Worker registration failed:', error);
    });
}
