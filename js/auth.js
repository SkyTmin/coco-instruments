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
            const submitBtn = form.querySelector('.auth-submit');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Вход...';
            
            console.log('Attempting login for:', email);
            
            const response = await API.auth.login(email, password);
            
            console.log('Login successful:', response);
            
            const user = {
                id: response.user.id,
                email: response.user.email,
                name: response.user.name
            };
            
            localStorage.setItem('currentUser', JSON.stringify(user));
            app.currentUser = user;
            app.updateAuthUI(true);
            
            this.hideModal();
            form.reset();
            
            alert('Вход выполнен успешно!');
        } catch (error) {
            console.error('Login error:', error);
            
            if (error.message.includes('401')) {
                alert('Неверный email или пароль');
            } else if (error.message.includes('Ошибка сети')) {
                alert(error.message);
            } else {
                alert('Ошибка входа. Попробуйте позже.');
            }
        } finally {
            const submitBtn = form.querySelector('.auth-submit');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Войти';
        }
    },
    
    async handleRegister(form) {
        const inputs = form.querySelectorAll('input');
        const name = inputs[0].value.trim();
        const email = inputs[1].value.trim();
        const password = inputs[2].value;
        const confirmPassword = inputs[3].value;
        
        console.log('Registration attempt:', { name, email });
        
        // Валидация на клиенте
        if (!name || name.length < 2) {
            alert('Имя должно содержать минимум 2 символа');
            return;
        }
        
        if (!email || !email.includes('@')) {
            alert('Введите корректный email');
            return;
        }
        
        if (password !== confirmPassword) {
            alert('Пароли не совпадают');
            return;
        }
        
        if (password.length < 8) {
            alert('Пароль должен быть не менее 8 символов');
            return;
        }
        
        // Проверка сложности пароля
        const hasUpperCase = /[A-Z]/.test(password);
        const hasLowerCase = /[a-z]/.test(password);
        const hasNumbers = /\d/.test(password);
        const hasSpecialChar = /\W/.test(password);
        
        if (!hasUpperCase || !hasLowerCase || (!hasNumbers && !hasSpecialChar)) {
            alert('Пароль должен содержать заглавные и строчные буквы, а также цифры или специальные символы');
            return;
        }
        
        try {
            const submitBtn = form.querySelector('.auth-submit');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Регистрация...';
            
            console.log('Sending registration request...');
            
            const response = await API.auth.register(email, name, password);
            
            console.log('Registration successful:', response);
            
            const user = {
                id: response.user.id,
                email: response.user.email,
                name: response.user.name
            };
            
            localStorage.setItem('currentUser', JSON.stringify(user));
            app.currentUser = user;
            app.updateAuthUI(true);
            
            this.hideModal();
            form.reset();
            
            alert('Регистрация прошла успешно! Добро пожаловать!');
        } catch (error) {
            console.error('Registration error:', error);
            
            if (error.message.includes('409')) {
                alert('Пользователь с таким email уже существует');
            } else if (error.message.includes('400')) {
                alert('Проверьте правильность введенных данных');
            } else if (error.message.includes('Ошибка сети')) {
                alert(error.message);
            } else {
                alert(`Ошибка регистрации: ${error.message || 'Попробуйте позже'}`);
            }
        } finally {
            const submitBtn = form.querySelector('.auth-submit');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Зарегистрироваться';
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
        
        alert('Вы вышли из системы');
        
        // Redirect to home if on protected page
        window.location.href = '/';
    },
    
    handleForgotPassword() {
        alert('Функция восстановления пароля будет доступна в ближайшее время');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    auth.init();
});
