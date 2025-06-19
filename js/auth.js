const auth = {
  modal: null,
  currentTab: 'login',

  init() {
    this.modal = document.getElementById('authModal');
    this.setupEventListeners();
  },

  setupEventListeners() {
    document.getElementById('loginBtn').addEventListener('click', () => this.showModal());
    document.getElementById('logoutBtn').addEventListener('click', () => this.logout());
    document.querySelector('.close').addEventListener('click', () => this.hideModal());
    window.addEventListener('click', e => {
      if (e.target === this.modal) this.hideModal();
    });
    document.getElementById('loginForm').addEventListener('submit', e => {
      e.preventDefault();
      this.handleLogin(e.target);
    });
    document.getElementById('registerForm').addEventListener('submit', e => {
      e.preventDefault();
      this.handleRegister(e.target);
    });
    document.getElementById('forgotPassword').addEventListener('click', e => {
      e.preventDefault();
      this.handleForgotPassword();
    });
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
    });
  },

  switchTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.querySelectorAll('.auth-form').forEach(f => f.style.display = f.dataset.form === tab ? 'flex' : 'none');
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
    const btn = form.querySelector('.auth-submit');
    btn.disabled = true;
    btn.textContent = 'Вход...';

    try {
      const res = await API.auth.login(email, password);
      const user = await API.getProfile();
      
      // Safely notify the app about user login
      if (window.app && typeof window.app.onUserLogin === 'function') {
        await window.app.onUserLogin(user);
        window.app.currentUser = user;
        window.app.updateAuthUI(true);
      }
      
      this.hideModal();
      form.reset();
      
      // Show success notification
      this.showNotification('Добро пожаловать! Загружаем ваши данные...', 'success');
    } catch (err) {
      const errorMessage = err.message.includes('401') ? 'Неверный email или пароль' : err.message;
      this.showNotification(errorMessage, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Войти';
    }
  },

  async handleRegister(form) {
    const [nameInput, emailInput, passInput, confirmInput] = form.querySelectorAll('input');
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const password = passInput.value;
    const confirmPassword = confirmInput.value;

    if (!name || name.length < 2) {
      this.showError('Имя слишком короткое');
      return;
    }
    if (!email.includes('@')) {
      this.showError('Некорректный email');
      return;
    }
    if (password !== confirmPassword) {
      this.showError('Пароли не совпадают');
      return;
    }
    if (password.length < 8) {
      this.showError('Пароль должен быть не менее 8 символов');
      return;
    }

    const btn = form.querySelector('.auth-submit');
    btn.disabled = true;
    btn.textContent = 'Регистрация...';

    try {
      await API.auth.register(email, name, password);
      const user = await API.getProfile();
      
      // Safely notify the app about user login
      if (window.app && typeof window.app.onUserLogin === 'function') {
        await window.app.onUserLogin(user);
        window.app.currentUser = user;
        window.app.updateAuthUI(true);
      }
      
      this.hideModal();
      form.reset();
      
      this.showNotification('Регистрация успешна! Добро пожаловать!', 'success');
    } catch (err) {
      const errorMessage = err.message.includes('409') ? 'Email уже занят' : err.message;
      this.showError(errorMessage);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Зарегистрироваться';
    }
  },

  async logout() {
    const confirmLogout = confirm('Вы действительно хотите выйти?');
    if (!confirmLogout) return;

    try {
      await API.auth.logout();
      
      // Safely notify the app about user logout
      if (window.app && typeof window.app.onUserLogout === 'function') {
        await window.app.onUserLogout();
        window.app.currentUser = null;
        window.app.updateAuthUI(false);
      }
      
      this.showNotification('Вы вышли из системы', 'info');
      
      // Redirect to main page
      window.location.href = '/';
    } catch (err) {
      console.error('Logout error:', err);
      this.showNotification('Ошибка при выходе', 'error');
    }
  },

  handleForgotPassword() {
    this.showNotification('Функция восстановления пароля скоро будет доступна', 'info');
  },

  showError(message) {
    this.showNotification(message, 'error');
  },

  showNotification(message, type = 'info') {
    // Use app's toast if available
    if (window.app && typeof window.app.showToast === 'function') {
      window.app.showToast(message, type);
    } else {
      // Fallback to alert
      alert(message);
    }
  },

  // Check auth status on page load
  async checkAuthStatus() {
    try {
      const user = await API.getProfile();
      if (user) {
        // Update app state if app is available
        if (window.app) {
          window.app.currentUser = user;
          window.app.updateAuthUI(true);
          
          // Load user data from server for authenticated user
          if (typeof window.app.loadAllDataFromServer === 'function' && navigator.onLine) {
            setTimeout(() => {
              window.app.loadAllDataFromServer();
            }, 500);
          }
        }
      } else {
        // Update UI for unauthenticated user
        if (window.app) {
          window.app.updateAuthUI(false);
          
          // Clear local data for unauthenticated user
          if (typeof window.app.clearAllLocalData === 'function') {
            window.app.clearAllLocalData();
          }
        }
      }
    } catch (e) {
      console.error('Auth status check failed:', e);
      
      // Update UI and clear data on error
      if (window.app) {
        window.app.updateAuthUI(false);
        
        if (typeof window.app.clearAllLocalData === 'function') {
          window.app.clearAllLocalData();
        }
      }
    }
  }
};

// Initialize auth when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  auth.init();
  
  // Wait a bit for app to initialize before checking auth status
  setTimeout(async () => {
    await auth.checkAuthStatus();
  }, 100);
});
