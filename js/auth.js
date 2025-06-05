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
    
    handleLogin(form) {
        const email = form.querySelector('input[type="email"]').value;
        const password = form.querySelector('input[type="password"]').value;
        
        const user = {
            email: email,
            id: Date.now()
        };
        
        localStorage.setItem('currentUser', JSON.stringify(user));
        app.currentUser = user;
        app.updateAuthUI(true);
        
        this.hideModal();
        form.reset();
    },
    
    handleRegister(form) {
        const inputs = form.querySelectorAll('input');
        const name = inputs[0].value;
        const email = inputs[1].value;
        const password = inputs[2].value;
        const confirmPassword = inputs[3].value;
        
        if (password !== confirmPassword) {
            alert('Пароли не совпадают');
            return;
        }
        
        const user = {
            name: name,
            email: email,
            id: Date.now()
        };
        
        localStorage.setItem('currentUser', JSON.stringify(user));
        app.currentUser = user;
        app.updateAuthUI(true);
        
        this.hideModal();
        form.reset();
    },
    
    logout() {
        localStorage.removeItem('currentUser');
        app.currentUser = null;
        app.updateAuthUI(false);
    },
    
    handleForgotPassword() {
        alert('Функция восстановления пароля');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    auth.init();
});
