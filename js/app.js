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
            await API.sync.syncAllData();
            this.showToast('Данные синхронизированы', 'success');
        } catch (error) {
            console.error('Sync failed:', error);
            this.showToast('Ошибка синхронизации', 'error');
        } finally {
            this.syncInProgress = false;
            this.showSyncIndicator(false);
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
        this.currentUser = userData;
        this.updateAuthUI(true);
        
        // Синхронизация данных после входа
        if (this.isOnline) {
            setTimeout(() => {
                this.syncAllData();
            }, 1000); // Небольшая задержка для UI
        }
    },

    async onUserLogout() {
        this.currentUser = null;
        this.updateAuthUI(false);
        
        // Очистка данных при выходе (опционально)
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
