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
      
      // Уведомляем приложение о входе пользователя
      if (typeof app !== 'undefined' && app.onUserLogin) {
        await app.onUserLogin(user);
      }
      
      app.currentUser = user;
      app.updateAuthUI(true);
      this.hideModal();
      form.reset();
      
      // Показываем уведомление об успешном входе
      if (typeof app !== 'undefined' && app.showToast) {
        app.showToast('Добро пожаловать! Загружаем ваши данные...', 'success');
      } else {
        alert('Вход выполнен успешно!');
      }
    } catch (err) {
      const errorMessage = err.message.includes('401') ? 'Неверный email или пароль' : err.message;
      
      if (typeof app !== 'undefined' && app.showToast) {
        app.showToast(errorMessage, 'error');
      } else {
        alert(errorMessage);
      }
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
      
      // Уведомляем приложение о входе пользователя
      if (typeof app !== 'undefined' && app.onUserLogin) {
        await app.onUserLogin(user);
      }
      
      app.currentUser = user;
      app.updateAuthUI(true);
      this.hideModal();
      form.reset();
      
      if (typeof app !== 'undefined' && app.showToast) {
        app.showToast('Регистрация успешна! Добро пожаловать!', 'success');
      } else {
        alert('Регистрация прошла успешно!');
      }
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
      
      // Уведомляем приложение о выходе пользователя
      if (typeof app !== 'undefined' && app.onUserLogout) {
        await app.onUserLogout();
      }
      
      app.currentUser = null;
      app.updateAuthUI(false);
      
      if (typeof app !== 'undefined' && app.showToast) {
        app.showToast('Вы вышли из системы', 'info');
      } else {
        alert('Вы вышли из системы');
      }
      
      // Перенаправляем на главную страницу
      window.location.href = '/';
    } catch (err) {
      console.error('Logout error:', err);
      
      if (typeof app !== 'undefined' && app.showToast) {
        app.showToast('Ошибка при выходе', 'error');
      }
    }
  },

  handleForgotPassword() {
    if (typeof app !== 'undefined' && app.showToast) {
      app.showToast('Функция восстановления пароля скоро будет доступна', 'info');
    } else {
      alert('Функция восстановления пароля скоро будет доступна');
    }
  },

  showError(message) {
    if (typeof app !== 'undefined' && app.showToast) {
      app.showToast(message, 'error');
    } else {
      alert(message);
    }
  },

  // Проверка статуса авторизации при загрузке страницы
  async checkAuthStatus() {
    try {
      const user = await API.getProfile();
      if (user) {
        app.currentUser = user;
        app.updateAuthUI(true);
        
        // ВАЖНО: Загружаем данные с сервера для авторизованного пользователя
        if (typeof app !== 'undefined' && app.loadAllDataFromServer && navigator.onLine) {
          setTimeout(() => {
            app.loadAllDataFromServer();
          }, 500);
        }
      } else {
        app.updateAuthUI(false);
        
        // ВАЖНО: Очищаем локальные данные для неавторизованного пользователя
        if (typeof app !== 'undefined' && app.clearAllLocalData) {
          app.clearAllLocalData();
        }
      }
    } catch (e) {
      console.error('Auth status check failed:', e);
      app.updateAuthUI(false);
      
      // Очищаем данные при ошибке проверки авторизации
      if (typeof app !== 'undefined' && app.clearAllLocalData) {
        app.clearAllLocalData();
      }
    }
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  auth.init();
  await auth.checkAuthStatus();
});
