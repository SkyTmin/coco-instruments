const navigation = {
    init() {
        // Handle direct links with hash
        const hash = window.location.hash.substring(1);
        if (hash && (hash === 'finance' || hash === 'geodesy')) {
            // Wait for app to initialize
            setTimeout(() => {
                if (typeof app !== 'undefined' && app.showSection) {
                    app.showSection(hash);
                }
            }, 100);
        }

        // Handle browser back button
        window.addEventListener('popstate', (e) => {
            const hash = window.location.hash.substring(1);
            if (hash && (hash === 'finance' || hash === 'geodesy')) {
                if (typeof app !== 'undefined' && app.showSection) {
                    app.showSection(hash);
                }
            } else {
                if (typeof app !== 'undefined' && app.hideAllSections) {
                    app.hideAllSections();
                }
            }
        });
    }
};

// Initialize navigation when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        navigation.init();
    });
} else {
    navigation.init();
}