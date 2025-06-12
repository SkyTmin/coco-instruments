const app = {
    currentUser: null,
    currentSection: 'home',

    init() {
        console.log('App init started');
        this.checkAuth();
        this.setupEventListeners();
        this.addTouchSupport();
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
                this.hideAllSections();
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
        this.hideAllSections();
        const section = document.getElementById(`${sectionName}Section`);
        if (section) {
            section.style.display = 'block';
            this.currentSection = sectionName;
            window.location.hash = sectionName;
            console.log('Section displayed:', sectionName);
        } else {
            console.error('Section not found:', `${sectionName}Section`);
        }
    },

    hideAllSections() {
        console.log('Hiding all sections');
        const sections = document.querySelectorAll('.sub-section');
        sections.forEach(section => {
            section.style.display = 'none';
        });
        this.currentSection = 'home';
        history.pushState(null, null, window.location.pathname);
    },

    handleServiceClick(service) {
        console.log('Handle service click:', service);
        if (service === 'coco-money') {
            window.location.href = 'coco-money.html';
        } else if (service === 'debts') {
            window.location.href = 'debts.html';
        } else {
            console.log(`Service not implemented: ${service}`);
        }
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
                    this.hideAllSections();
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
    // DOM is already ready
    console.log('DOM already ready - initializing app');
    app.init();
}