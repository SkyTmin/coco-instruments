const navigation = {
    history: [],
    
    init() {
        this.setupBackButton();
        this.setupDeepLinks();
    },
    
    setupBackButton() {
        window.addEventListener('popstate', (e) => {
            if (e.state && e.state.section) {
                this.navigateToSection(e.state.section, false);
            } else {
                app.hideAllSections();
            }
        });
    },
    
    setupDeepLinks() {
        const hash = window.location.hash.substring(1);
        if (hash) {
            this.navigateToSection(hash);
        }
    },
    
    navigateToSection(section, pushState = true) {
        app.showSection(section);
        
        if (pushState) {
            history.pushState({ section: section }, '', `#${section}`);
        }
    },
    
    goBack() {
        history.back();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    navigation.init();
});