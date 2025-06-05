const pwa = {
    deferredPrompt: null,
    
    init() {
        this.registerServiceWorker();
        this.setupInstallPrompt();
        this.detectStandalone();
    },
    
    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js')
                .then(registration => {
                    console.log('ServiceWorker registered');
                })
                .catch(error => {
                    console.log('ServiceWorker registration failed:', error);
                });
        }
    },
    
    setupInstallPrompt() {
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            this.showInstallButton();
        });
        
        window.addEventListener('appinstalled', () => {
            console.log('App installed');
            this.deferredPrompt = null;
        });
    },
    
    showInstallButton() {
        const installBtn = document.createElement('button');
        installBtn.className = 'install-btn';
        installBtn.textContent = 'Установить приложение';
        installBtn.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background-color: var(--brown);
            color: var(--beige);
            padding: 12px 24px;
            border-radius: 25px;
            font-weight: 600;
            box-shadow: 0 4px 15px var(--shadow);
            z-index: 1000;
            animation: slideUp 0.5s ease;
        `;
        
        installBtn.addEventListener('click', async () => {
            if (this.deferredPrompt) {
                this.deferredPrompt.prompt();
                const { outcome } = await this.deferredPrompt.userChoice;
                
                if (outcome === 'accepted') {
                    installBtn.remove();
                }
                
                this.deferredPrompt = null;
            }
        });
        
        document.body.appendChild(installBtn);
        
        setTimeout(() => {
            installBtn.remove();
        }, 10000);
    },
    
    detectStandalone() {
        if (window.matchMedia('(display-mode: standalone)').matches || 
            window.navigator.standalone === true) {
            document.body.classList.add('standalone');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    pwa.init();
});