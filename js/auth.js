const auth = {
    modal: null,
    currentTab: 'login',
    
    init() {
        this.modal = document.getElementById('authModal');
        this.setupEventListeners();
    },
    
    setupEventListeners() {
        document.getElementById('loginBtn').addEventListener('click', () => {
            this.showModal();
        });
        
        document.getElementById('logoutBtn').addEventListener('click', () => {
            this.logout();
        });
        
        document.querySelector('.close').addEventListener('click', () => {
            this.hideModal();
        });
        
        window.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.hideModal();
            }
        });
        
        document.getElementById('loginForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin(e.target);
        });
        
        document.getElementById('registerForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleRegister(e.target);
        });
        
        document.getElementById('forgotPassword').addEventListener('click', (e) => {
            e.preventDefault();
            this.handleForgotPassword();
        });
        
        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.switchTab(tab.getAttribute('data-tab'));
            });
        });
    },
    
    switchTab(tabName) {
        this.currentTab = tabName;
        
        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.classList.toggle('active', tab.getAttribute('data-tab') === tabName);
        });
        
        document.querySelectorAll('.auth-form').forEach(form => {
            form.style.display = form.getAttribute('data-form') === tabName ? 'flex' : 'none';
        });
    },
    
    showModal() {
        this.modal.style.display = 'block';
        document.body.style.overflow = 'hidden';
    },
    
    hideModal() {
        this.modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    },
    
async handleLogin(form) {
    const email = form.querySelector('input[type="email"]').value;
    const password = form.querySelector('input[type="password"]').value;
    
    try {
        const response = await API.auth.login(email, password);
        
        app.currentUser = response.user;
        localStorage.setItem('currentUser', JSON.stringify(response.user));
        app.updateAuthUI(true);
        
        this.hideModal();
        form.reset();
        
        // Перезагрузить данные если нужно
        if (typeof cocoMoney !== 'undefined') {
            cocoMoney.loadData();
        }
    } catch (error) {
        alert('Ошибка входа: ' + error.message);
    }
},
    
    async handleRegister(form) {
    const inputs = form.querySelectorAll('input');
    const name = inputs[0].value;
    const email = inputs[1].value;
    const password = inputs[2].value;
    const confirmPassword = inputs[3].value;
    
    if (password !== confirmPassword) {
        alert('Пароли не совпадают');
        return;
    }
    
    try {
        const response = await API.auth.register(email, name, password);
        
        app.currentUser = response.user;
        localStorage.setItem('currentUser', JSON.stringify(response.user));
        app.updateAuthUI(true);
        
        this.hideModal();
        form.reset();
    } catch (error) {
        alert('Ошибка регистрации: ' + error.message);
    }
},
    
    async logout() {
    try {
        await API.auth.logout();
    } catch (error) {
        console.error('Logout error:', error);
    }
    
    localStorage.removeItem('currentUser');
    app.currentUser = null;
    app.updateAuthUI(false);
    
    // Очистить локальные данные
    localStorage.removeItem('cocoMoneySheets');
    localStorage.removeItem('cocoDebts');
    
    window.location.href = '/';
}

document.addEventListener('DOMContentLoaded', () => {
    auth.init();
});
