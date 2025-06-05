const auth = {
    modal: null,
    
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
        
        document.getElementById('forgotPassword').addEventListener('click', (e) => {
            e.preventDefault();
            this.handleForgotPassword();
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