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
      app.currentUser = await API.getProfile();
      app.updateAuthUI(true);
      this.hideModal();
      form.reset();
      alert('Вход выполнен успешно!');
    } catch (err) {
      alert(err.message.includes('401') ? 'Неверный email или пароль' : err.message);
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

    if (!name || name.length < 2) return alert('Имя слишком короткое');
    if (!email.includes('@')) return alert('Некорректный email');
    if (password !== confirmPassword) return alert('Пароли не совпадают');
    if (password.length < 8) return alert('Пароль должен быть не менее 8 символов');

    const btn = form.querySelector('.auth-submit');
    btn.disabled = true;
    btn.textContent = 'Регистрация...';

    try {
      await API.auth.register(email, name, password);
      app.currentUser = await API.getProfile();
      app.updateAuthUI(true);
      this.hideModal();
      form.reset();
      alert('Регистрация прошла успешно!');
    } catch (err) {
      alert(err.message.includes('409') ? 'Email уже занят' : err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Зарегистрироваться';
    }
  },

  async logout() {
    await API.auth.logout();
    app.currentUser = null;
    app.updateAuthUI(false);
    alert('Вы вышли из системы');
    window.location.href = '/';
  },

  handleForgotPassword() {
    alert('Функция восстановления пароля скоро будет доступна');
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  auth.init();
  try {
    const user = await API.getProfile();
    if (user) {
      app.currentUser = user;
      app.updateAuthUI(true);
    } else {
      app.updateAuthUI(false);
    }
  } catch (e) {
    app.updateAuthUI(false);
  }
});
