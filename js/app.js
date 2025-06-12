const app = {
    currentUser: null,
    currentSection: 'home',
    previousSection: null,

    init() {
        console.log('App init started');
        this.checkAuth();
        this.setupEventListeners();
        this.addTouchSupport();
        this.handleBrowserNavigation();
        console.log('App init completed');
    },

    checkAuth() {
        const user = localStorage.getItem('currentUser');
        if (user) {
            this.currentUser = JSON.parse(user);
            this.updateAuthUI(true);
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