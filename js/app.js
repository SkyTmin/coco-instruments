const app = {
    currentUser: null,
    currentSection: 'home',
    previousSection: null,
    isOnline: navigator.onLine,
    syncInProgress: false,

    init() {
        console.log('App init started');
        this.setupNetworkListeners();
        this.checkAuth();
        this.setupEventListeners();
        this.addTouchSupport();
        this.handleBrowserNavigation();
        console.log('App init completed');
    },

    setupNetworkListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            if (this.currentUser) {
                this.syncAllData();
            }
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
        });
    },

    async checkAuth() {
        try {
            const user = await API.getProfile();
            if (user) {
                this.currentUser = user;
                this.updateAuthUI(true);
                
                // Автоматическая синхронизация при запуске приложения
                if (this.isOnline) {
                    await this.syncAllData();
                }
            } else {
                this.updateAuthUI(false);
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            this.updateAuthUI(false);
        }
    },

    async syncAllData() {
        if (this.syncInProgress || !this.currentUser || !this.isOnline) {
            return;
        }

        this.syncInProgress = true;
        this.showSyncIndicator(true);

        try {
            console.log('🔄 Начинаем полную синхронизацию данных...');
            
            // Загружаем данные с сервера для всех модулей
            await Promise.all([
                this.loadCocoMoneyData(),
                this.loadDebtsData(),
                this.loadClothingSizeData(),
                this.loadScaleCalculatorData()
            ]);
            
            console.log('✅ Синхронизация завершена успешно');
            this.showToast('Данные синхронизированы', 'success');
        } catch (error) {
            console.error('❌ Ошибка синхронизации:', error);
            this.showToast('Ошибка синхронизации', 'error');
        } finally {
            this.syncInProgress = false;
            this.showSyncIndicator(false);
        }
    },

    async loadCocoMoneyData() {
        try {
            console.log('📊 Загружаем данные Coco Money...');
            const serverSheets = await API.cocoMoney.getSheets();
            const serverCategories = await API.cocoMoney.getCategories();
            
            console.log('📥 Данные с сервера - листы:', serverSheets, 'категории:', serverCategories);
            
            // Если модуль загружен, обновляем данные ВСЕГДА (даже если они пустые)
            if (typeof cocoMoney !== 'undefined') {
                // Обновляем данные независимо от того, пустые они или нет
                cocoMoney.sheets = serverSheets || { income: [], preliminary: [] };
                cocoMoney.customCategories = serverCategories || [];
                
                console.log('✅ Данные Coco Money обновлены локально');
                cocoMoney.renderAll();
                cocoMoney.updateCategorySelect();
            }
            
            console.log('✅ Coco Money данные загружены');
        } catch (error) {
            console.error('❌ Ошибка загрузки Coco Money:', error);
        }
    },

    async loadDebtsData() {
        try {
            console.log('💳 Загружаем данные долгов...');
            const serverDebts = await API.debts.getDebts();
            const serverCategories = await API.debts.getCategories();
            
            console.log('📥 Данные с сервера - долги:', serverDebts, 'категории:', serverCategories);
            
            // Если модуль загружен, обновляем данные ВСЕГДА (даже если они пустые)
            if (typeof debts !== 'undefined') {
                // Обновляем данные независимо от того, пустые они или нет
                debts.debtsList = serverDebts || [];
                debts.customCategories = serverCategories || [];
                
                console.log('✅ Данные долгов обновлены локально');
                debts.renderAll();
                debts.updateCategorySelect();
            }
            
            console.log('✅ Данные долгов загружены');
        } catch (error) {
            console.error('❌ Ошибка загрузки долгов:', error);
        }
    },

    async loadClothingSizeData() {
        try {
            console.log('👕 Загружаем данные размеров одежды...');
            const serverData = await API.clothingSize.getData();
            
            console.log('📥 Данные размеров одежды с сервера:', serverData);
            
            // Если модуль загружен, обновляем данные ВСЕГДА
            if (typeof clothingSize !== 'undefined' && serverData) {
                // Обновляем данные независимо от того, пустые они или нет
                clothingSize.state.parameters = serverData.parameters || {};
                clothingSize.state.savedResults = serverData.savedResults || [];
                clothingSize.state.currentGender = serverData.currentGender || 'male';
                
                console.log('✅ Данные размеров одежды обновлены локально');
                clothingSize.restoreParameters();
                clothingSize.updateGenderSpecificElements();
            }
            
            console.log('✅ Данные размеров одежды загружены');
        } catch (error) {
            console.error('❌ Ошибка загрузки размеров одежды:', error);
        }
    },

    async loadScaleCalculatorData() {
        try {
            console.log('📐 Загружаем историю калькулятора масштабов...');
            const serverHistory = await API.scaleCalculator.getHistory();
            
            console.log('📥 История масштабов с сервера:', serverHistory);
            
            // Если модуль загружен, обновляем данные ВСЕГДА (даже если пустые)
            if (typeof scaleCalculator !== 'undefined') {
                // Обновляем данные независимо от того, пустые они или нет
                scaleCalculator.history = serverHistory || [];
                
                console.log('✅ История калькулятора масштабов обновлена локально');
                scaleCalculator.renderHistory();
            }
            
            console.log('✅ История калькулятора масштабов загружена');
        } catch (error) {
            console.error('❌ Ошибка загрузки истории калькулятора:', error);
        }
    },

    showSyncIndicator(show) {
        let indicator = document.getElementById('sync-indicator');
        
        if (show && !indicator) {
            indicator = document.createElement('div');
            indicator.id = 'sync-indicator';
            indicator.className = 'sync-indicator';
            indicator.innerHTML = '⏳ Синхронизация...';
            document.body.appendChild(indicator);
        } else if (!show && indicator) {
            indicator.remove();
        }
    },

    updateAuthUI(isLoggedIn) {
        const loginBtn = document.getElementById('loginBtn');
        const logoutBtn = document.getElementById('logoutBtn');
        
        if (loginBtn && logoutBtn) {
            if (isLoggedIn) {
                loginBtn.style.display = 'none';
                logoutBtn.style.display = 'block';
            } else {
                loginBtn.style.display = 'block';
                logoutBtn.style.display = 'none';
            }
        }

        // Показываем/скрываем индикатор статуса синхронизации
        this.updateSyncStatus();
    },

    updateSyncStatus() {
        let statusIndicator = document.getElementById('connection-status');
        
        if (this.currentUser) {
            if (!statusIndicator) {
                statusIndicator = document.createElement('div');
                statusIndicator.id = 'connection-status';
                statusIndicator.className = 'connection-status';
                
                const header = document.querySelector('.header-content');
                if (header) {
                    header.appendChild(statusIndicator);
                }
            }
            
            if (this.isOnline) {
                statusIndicator.innerHTML = '🟢 Онлайн';
                statusIndicator.className = 'connection-status online';
            } else {
                statusIndicator.innerHTML = '🔴 Офлайн';
                statusIndicator.className = 'connection-status offline';
            }
        } else if (statusIndicator) {
            statusIndicator.remove();
        }
    },

    async onUserLogin(userData) {
        console.log('👤 Пользователь вошел в систему:', userData);
        this.currentUser = userData;
        this.updateAuthUI(true);
        
        // Принудительная синхронизация данных после входа
        if (this.isOnline) {
            console.log('🔄 Запускаем синхронизацию после входа...');
            // Небольшая задержка для завершения UI обновлений
            setTimeout(async () => {
                await this.syncAllData();
            }, 500);
        }
    },

    async onUserLogout() {
        console.log('👤 Пользователь вышел из системы');
        this.currentUser = null;
        this.updateAuthUI(false);
        
        // Опционально: очистить локальные данные при выходе
        // this.clearLocalData();
    },

    clearLocalData() {
        // Очищаем все локальные данные при выходе из аккаунта
        localStorage.removeItem('cocoMoneySheets');
        localStorage.removeItem('cocoMoneyCategories');
        localStorage.removeItem('cocoDebts');
        localStorage.removeItem('cocoDebtCategories');
        localStorage.removeItem('clothingSizeData');
        localStorage.removeItem('scaleCalculatorHistory');
    },

    setupEventListeners() {
        console.log('Setting up event listeners');
        
        // App cards click handlers
        const appCards = document.querySelectorAll('.app-card');
        console.log('Found app cards:', appCards.length);
        
        appCards.forEach(card => {
            card.addEventListener('click', (e) => {
                e.preventDefault();
                const section = card.getAttribute('data-section');
                console.log('App card clicked:', section);
                this.showSection(section);
            });
        });
        
        // Back buttons
        const backBtns = document.querySelectorAll('.back-btn');
        console.log('Found back buttons:', backBtns.length);
        
        backBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('Back button clicked');
                this.goBack();
            });
        });
        
        // Sub cards click handlers
        const subCards = document.querySelectorAll('.sub-card');
        console.log('Found sub cards:', subCards.length);
        
        subCards.forEach(card => {
            card.addEventListener('click', (e) => {
                e.preventDefault();
                const service = card.getAttribute('data-service');
                console.log('Sub card clicked:', service);
                this.handleServiceClick(service);
            });
        });
    },

    showSection(sectionName) {
        console.log('Showing section:', sectionName);
        
        // Сохраняем текущую секцию как предыдущую
        this.previousSection = this.currentSection;
        
        // Скрываем все секции
        this.hideAllSections(false);
        
        const section = document.getElementById(`${sectionName}Section`);
        if (section) {
            section.style.display = 'block';
            this.currentSection = sectionName;
            console.log('Section displayed:', sectionName);
        } else {
            console.error('Section not found:', `${sectionName}Section`);
        }
    },

    // Новый метод для прямого показа секции без анимации
    showSectionDirect(sectionName) {
        console.log('Showing section directly (no animation):', sectionName);
        
        // Скрываем все секции
        const sections = document.querySelectorAll('.sub-section');
        sections.forEach(section => {
            section.style.display = 'none';
        });
        
        // Показываем нужную секцию
        const section = document.getElementById(`${sectionName}Section`);
        if (section) {
            section.style.display = 'block';
            this.currentSection = sectionName;
            this.previousSection = 'home';
            console.log('Section displayed directly:', sectionName);
        } else {
            console.error('Section not found:', `${sectionName}Section`);
        }
    },

    hideAllSections(resetToHome = true) {
        console.log('Hiding all sections, resetToHome:', resetToHome);

        const sections = document.querySelectorAll('.sub-section');
        sections.forEach(section => {
            section.style.display = 'none';
        });

        if (resetToHome) {
            this.currentSection = 'home';
            this.previousSection = null;
            if (window.location.hash) {
                history.pushState(null, null, window.location.pathname);
            }
        }
    },

    goBack() {
        console.log('Going back from:', this.currentSection, 'to:', this.previousSection);
        
        if (this.currentSection === 'home') {
            return;
        }
        
        // Всегда возвращаемся на главную при нажатии "Назад"
        this.hideAllSections(true);
    },

    handleServiceClick(service) {
        console.log('Handle service click:', service);
        
        if (service === 'coco-money') {
            // Сохраняем информацию о том, откуда пришли
            sessionStorage.setItem('returnToSection', 'finance');
            window.location.href = 'coco-money.html';
        } else if (service === 'debts') {
            // Сохраняем информацию о том, откуда пришли
            sessionStorage.setItem('returnToSection', 'finance');
            window.location.href = 'debts.html';
        } else if (service === 'scale-calculator') {
            // Сохраняем информацию о том, откуда пришли для калькулятора масштабов
            sessionStorage.setItem('returnToSection', 'geodesy');
            window.location.href = 'scale-calculator.html';
        } else if (service === 'clothing-size') {
            sessionStorage.setItem('returnToSection', 'clothing');
            window.location.href = 'clothing-size.html';
        } else if (service === 'clothing-carousel') {
            console.log('Карусель одежды еще не реализована');
            this.showToast('Функция в разработке');
        } else {
            console.log(`Service not implemented: ${service}`);
        }
    },

    // Новый метод для возврата к секции финансов
    returnToFinanceSection() {
        console.log('Returning to finance section');
        this.showSectionDirect('finance'); // Используем прямой показ без анимации
        // Очищаем информацию о возврате
        sessionStorage.removeItem('returnToSection');
    },

    handleBrowserNavigation() {
        // Проверяем, нужно ли вернуться к определенной секции
        window.addEventListener('focus', () => {
            const returnToSection = sessionStorage.getItem('returnToSection');
            if (returnToSection === 'finance') {
                console.log('Returning to finance section from service');
                setTimeout(() => {
                    this.returnToFinanceSection();
                }, 100);
            }
        });

        // Обработка кнопки "Назад" браузера
        window.addEventListener('popstate', (e) => {
            console.log('Browser back button pressed');
            const returnToSection = sessionStorage.getItem('returnToSection');
            if (returnToSection === 'finance') {
                this.returnToFinanceSection();
            } else {
                this.hideAllSections(true);
            }
        });

        // Обработка восстановления страницы из кэша
        window.addEventListener('pageshow', (e) => {
            if (e.persisted) {
                console.log('Page restored from cache');
                const returnToSection = sessionStorage.getItem('returnToSection');
                if (returnToSection === 'finance') {
                    this.returnToFinanceSection();
                } else {
                    this.hideAllSections(true);
                }
            }
        });
    },

    addTouchSupport() {
        let touchStartX = 0;
        let touchStartY = 0;
        let touchEndX = 0;
        let touchEndY = 0;
        
        document.addEventListener('touchstart', e => {
            touchStartX = e.changedTouches[0].screenX;
            touchStartY = e.changedTouches[0].screenY;
        }, { passive: true });
        
        document.addEventListener('touchend', e => {
            touchEndX = e.changedTouches[0].screenX;
            touchEndY = e.changedTouches[0].screenY;
            this.handleSwipe();
        }, { passive: true });
        
        this.handleSwipe = () => {
            const swipeThreshold = 100;
            const verticalThreshold = 50;
            
            const deltaX = touchEndX - touchStartX;
            const deltaY = Math.abs(touchEndY - touchStartY);
            
            if (deltaY > verticalThreshold) {
                return;
            }
            
            if (this.currentSection !== 'home') {
                if (deltaX < -swipeThreshold || deltaX > swipeThreshold) {
                    this.goBack();
                }
            }
        };
    },

    showToast(message, type = 'info') {
        // Create toast element if it doesn't exist
        let toast = document.getElementById('app-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'app-toast';
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

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('DOMContentLoaded - initializing app');
        app.init();
    });
} else {
    console.log('DOM already ready - initializing app');
    app.init();
}
