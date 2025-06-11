const navigation = {
history: [],

```
init() {
    this.setupBackButton();
    this.setupDeepLinks();
    this.setupHashChange();
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
    if (hash && (hash === 'finance' || hash === 'geodesy')) {
        // Use setTimeout to ensure DOM is ready
        setTimeout(() => {
            app.showSection(hash);
        }, 0);
    }
},

setupHashChange() {
    window.addEventListener('hashchange', () => {
        const hash = window.location.hash.substring(1);
        if (hash === 'finance' || hash === 'geodesy') {
            app.showSection(hash);
        } else if (!hash) {
            app.hideAllSections();
        }
    });
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
```

};

document.addEventListener(‘DOMContentLoaded’, () => {
navigation.init();
});