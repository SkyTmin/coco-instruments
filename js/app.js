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
                
                // ВАЖНО: Всегда загружаем данные с сервера при проверке авторизации
                if (this.isOnline) {
                    await this.loadAllDataFromServer();
                }
            } else {
                this.updateAuthUI(false);
                // Очищаем локальные данные если пользователь не авторизован
                this.clearAllLocalData();
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            this.updateAuthUI(false);
            this.clearAllLocalData();
        }
    },

    async loadAllDataFromServer() {
        if (!this.currentUser || !this.isOnline) {
            return;
        }

        this.showSyncIndicator(true);

        try {
            console.log('🔄 Загружаем все данные с сервера...');
            
            // Параллельная загрузка всех данных
            await Promise.all([
                this.loadCocoMoneyData(),
                this.loadDebtsData(),
                this.loadClothingSizeData(),
                this.loadScaleCalculatorData()
            ]);
            
            console.log('✅ Все данные загружены с сервера');
            this.showToast('Данные загружены', 'success');
        } catch (error) {
            console.error('❌ Ошибка загрузки данных:', error);
            this.showToast('Ошибка загрузки данных', 'error');
        } finally {
            this.showSyncIndicator(false);
        }
    },

    async syncAllData() {
        if (this.syncInProgress || !this.currentUser || !this.isOnline) {
            return;
        }

        this.syncInProgress = true;
        this.showSyncIndicator(true);

        try {
            console.log('🔄 Синхронизация данных с сервером...');
            
            // Отправляем локальные данные на сервер
            await Promise.all([
                this.syncCocoMoneyToServer(),
                this.syncDebtsToServer(),
                this.syncClothingSizeToServer(),
                this.syncScaleCalculatorToServer()
            ]);
            
            console.log('✅ Синхронизация завершена');
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
            
            // Сохраняем в localStorage для офлайн доступа
            localStorage.setItem('cocoMoneySheets', JSON.stringify(serverSheets));
            localStorage.setItem('cocoMoneyCategories', JSON.stringify(serverCategories));
            
            // Обновляем UI если модуль загружен
            if (typeof cocoMoney !== 'undefined') {
                cocoMoney.sheets = serverSheets || { income: [], preliminary: [] };
                cocoMoney.customCategories = serverCategories || [];
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
            
            // Сохраняем в localStorage для офлайн доступа
            localStorage.setItem('cocoDebts', JSON.stringify(serverDebts));
            localStorage.setItem('cocoDebtCategories', JSON.stringify(serverCategories));
            
            // Обновляем UI если модуль загружен
            if (typeof debts !== 'undefined') {
                debts.debtsList = serverDebts || [];
                debts.customCategories = serverCategories || [];
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
            
            // Сохраняем в localStorage для офлайн доступа
            localStorage.setItem('clothingSizeData', JSON.stringify(serverData));
            
            // Обновляем UI если модуль загружен
            if (typeof clothingSize !== 'undefined' && serverData) {
                clothingSize.state.parameters = serverData.parameters || {};
                clothingSize.state.savedResults = serverData.savedResults || [];
                clothingSize.state.currentGender = serverData.currentGender || 'male';
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
            
            // Сохраняем в localStorage для офлайн доступа
            localStorage.setItem('scaleCalculatorHistory', JSON.stringify(serverHistory));
            
            // Обновляем UI если модуль загружен
            if (typeof scaleCalculator !== 'undefined') {
                scaleCalculator.history = serverHistory || [];
                scaleCalculator.renderHistory();
            }
            
            console.log('✅ История калькулятора масштабов загружена');
        } catch (error) {
            console.error('❌ Ошибка загрузки истории калькулятора:', error);
        }
    },

    // Методы синхронизации локальных данных на сервер
    async syncCocoMoneyToServer() {
        if (typeof cocoMoney !== 'undefined' && cocoMoney.sheets) {
            await API.cocoMoney.saveSheets(cocoMoney.sheets);
            await API.cocoMoney.saveCategories(cocoMoney.customCategories);
        }
    },

    async syncDebtsToServer() {
        if (typeof debts !== 'undefined' && debts.debtsList) {
            await API.debts.saveDebts(debts.debtsList);
            await API.debts.saveCategories(debts.customCategories);
        }
    },

    async syncClothingSizeToServer() {
        if (typeof clothingSize !== 'undefined' && clothingSize.state) {
            await API.clothingSize.saveData({
                parameters: clothingSize.state.parameters,
                savedResults: clothingSize.state.savedResults,
                currentGender: clothingSize.state.currentGender
            });
        }
    },

    async syncScaleCalculatorToServer() {
        if (typeof scaleCalculator !== 'undefined' && scaleCalculator.history) {
            await API.scaleCalculator.saveHistory(scaleCalculator.history);
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
        
        // ВАЖНО: Загружаем все данные с сервера после входа
        if (this.isOnline) {
            console.log('🔄 Загружаем данные пользователя после входа...');
            setTimeout(async () => {
                await this.loadAllDataFromServer();
            }, 500);
        }
    },

    async onUserLogout() {
        console.log('👤 Пользователь вышел из системы');
        this.currentUser = null;
        this.updateAuthUI(false);
        
        // ВАЖНО: Очищаем все локальные данные при выходе
        this.clearAllLocalData();
    },

    clearAllLocalData() {
        console.log('🗑️ Очищаем все локальные данные...');
        
        // Очищаем localStorage
        localStorage.removeItem('cocoMoneySheets');
        localStorage.removeItem('cocoMoneyCategories');
        localStorage.removeItem('cocoDebts');
        localStorage.removeItem('cocoDebtCategories');
        localStorage.removeItem('clothingSizeData');
        localStorage.removeItem('scaleCalculatorHistory');
        
        // Очищаем данные в модулях если они загружены
        if (typeof cocoMoney !== 'undefined') {
            cocoMoney.sheets = { income: [], preliminary: [] };
            cocoMoney.customCategories = [];
            cocoMoney.renderAll();
        }
        
        if (typeof debts !== 'undefined') {
            debts.debtsList = [];
            debts.customCategories = [];
            debts.renderAll();
        }
        
        if (typeof clothingSize !== 'undefined') {
            clothingSize.state = {
                currentSection: 'parameters',
                currentUnit: 'cm',
                currentGender: 'male',
                parameters: {},
                savedResults: [],
                currentCategory: null
            };
            clothingSize.restoreParameters();
        }
        
        if (typeof scaleCalculator !== 'undefined') {
            scaleCalculator.history = [];
            scaleCalculator.renderHistory();
        }
        
        console.log('✅ Локальные данные очищены');
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
        
        this.previousSection = this.currentSection;
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

    showSectionDirect(sectionName) {
        console.log('Showing section directly (no animation):', sectionName);
        
        const sections = document.querySelectorAll('.sub-section');
        sections.forEach(section => {
            section.style.display = 'none';
        });
        
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
        
        this.hideAllSections(true);
    },

    handleServiceClick(service) {
        console.log('Handle service click:', service);
        
        if (service === 'coco-money') {
            sessionStorage.setItem('returnToSection', 'finance');
            window.location.href = 'coco-money.html';
        } else if (service === 'debts') {
            sessionStorage.setItem('returnToSection', 'finance');
            window.location.href = 'debts.html';
        } else if (service === 'scale-calculator') {
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

    returnToFinanceSection() {
        console.log('Returning to finance section');
        this.showSectionDirect('finance');
        sessionStorage.removeItem('returnToSection');
    },

    handleBrowserNavigation() {
        window.addEventListener('focus', () => {
            const returnToSection = sessionStorage.getItem('returnToSection');
            if (returnToSection === 'finance') {
                console.log('Returning to finance section from service');
                setTimeout(() => {
                    this.returnToFinanceSection();
                }, 100);
            }
        });

        window.addEventListener('popstate', (e) => {
            console.log('Browser back button pressed');
            const returnToSection = sessionStorage.getItem('returnToSection');
            if (returnToSection === 'finance') {
                this.returnToFinanceSection();
            } else {
                this.hideAllSections(true);
            }
        });

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
