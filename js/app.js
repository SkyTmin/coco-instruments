const app = {
currentUser: null,
currentSection: ‘home’,

```
init() {
    this.checkAuth();
    this.setupEventListeners();
    this.addTouchSupport();
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
    console.log(`Opening service: ${service}`);
},

addTouchSupport() {
    let touchStartX = 0;
    let touchEndX = 0;
    let touchStartY = 0;
    let touchEndY = 0;
    
    document.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    });
    
    document.addEventListener('touchend', e => {
        touchEndX = e.changedTouches[0].screenX;
        touchEndY = e.changedTouches[0].screenY;
        this.handleSwipe();
    });
    
    this.handleSwipe = () => {
        const swipeThreshold = 100;
        const verticalThreshold = 50;
        
        const horizontalDiff = touchEndX - touchStartX;
        const verticalDiff = Math.abs(touchEndY - touchStartY);
        
        if (verticalDiff < verticalThreshold) {
            if (horizontalDiff > swipeThreshold && this.currentSection !== 'home') {
                this.hideAllSections();
            } else if (horizontalDiff < -swipeThreshold && this.currentSection !== 'home') {
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