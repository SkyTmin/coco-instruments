const app = {
currentUser: null,
currentSection: ‘home’,

```
init() {
    this.checkAuth();
    this.setupEventListeners();
    this.addTouchSupport();
    this.handleInitialRoute();
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
    
    if (isLoggedIn) {
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'block';
    } else {
        loginBtn.style.display = 'block';
        logoutBtn.style.display = 'none';
    }
},

handleInitialRoute() {
    // Check if there's a hash in the URL
    const hash = window.location.hash.substring(1);
    if (hash === 'finance') {
        this.showSection('finance');
    } else if (hash === 'geodesy') {
        this.showSection('geodesy');
    }
    
    // Listen for hash changes
    window.addEventListener('hashchange', () => {
        const newHash = window.location.hash.substring(1);
        if (newHash === 'finance') {
            this.showSection('finance');
        } else if (newHash === 'geodesy') {
            this.showSection('geodesy');
        } else {
            this.hideAllSections();
        }
    });
},

setupEventListeners() {
    document.querySelectorAll('.app-card').forEach(card => {
        card.addEventListener('click', () => {
            const section = card.getAttribute('data-section');
            this.showSection(section);
            // Update URL hash
            window.location.hash = section;
        });
    });
    
    document.querySelectorAll('.back-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            this.hideAllSections();
            // Clear URL hash
            history.pushState(null, null, window.location.pathname);
        });
    });
    
    document.querySelectorAll('.sub-card').forEach(card => {
        card.addEventListener('click', () => {
            const service = card.getAttribute('data-service');
            this.handleServiceClick(service);
        });
    });
},

showSection(sectionName) {
    this.hideAllSections();
    const section = document.getElementById(`${sectionName}Section`);
    if (section) {
        section.style.display = 'block';
        this.currentSection = sectionName;
    }
},

hideAllSections() {
    document.querySelectorAll('.sub-section').forEach(section => {
        section.style.display = 'none';
    });
    this.currentSection = 'home';
},

handleServiceClick(service) {
    if (service === 'coco-money') {
        window.location.href = 'coco-money.html';
    } else if (service === 'debts') {
        window.location.href = 'debts.html';
    } else {
        console.log(`Opening service: ${service}`);
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
```

};

document.addEventListener(‘DOMContentLoaded’, () => {
app.init();
});

```
setupEventListeners() {
    document.querySelectorAll('.app-card').forEach(card => {
        card.addEventListener('click', () => {
            const section = card.getAttribute('data-section');
            this.showSection(section);
        });
    });
    
    document.querySelectorAll('.back-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            this.hideAllSections();
        });
    });
    
    document.querySelectorAll('.sub-card').forEach(card => {
        card.addEventListener('click', () => {
            const service = card.getAttribute('data-service');
            this.handleServiceClick(service);
        });
    });
},

showSection(sectionName) {
    this.hideAllSections();
    const section = document.getElementById(`${sectionName}Section`);
    if (section) {
        section.style.display = 'block';
        this.currentSection = sectionName;
    }
},

hideAllSections() {
    document.querySelectorAll('.sub-section').forEach(section => {
        section.style.display = 'none';
    });
    this.currentSection = 'home';
},

handleServiceClick(service) {
    if (service === 'coco-money') {
        window.location.href = 'coco-money.html';
    } else if (service === 'debts') {
        window.location.href = 'debts.html';
    } else {
        console.log(`Opening service: ${service}`);
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
```

};

document.addEventListener(‘DOMContentLoaded’, () => {
app.init();
});
