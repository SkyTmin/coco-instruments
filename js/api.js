window.addEventListener('unhandledrejection', event => {
  console.error('Unhandled promise rejection:', event.reason);

  if (event.reason?.message?.includes('401')) {
    alert('Сессия истекла. Необходимо войти снова.');
    API.clearTokens();
    window.location.href = '/';
  }
});

const API = {
  baseURL: 'https://coco-instruments-backend-production.up.railway.app/api/v1',

  tokens: {
    access: null,
    refresh: null
  },

  loadTokens() {
    const savedTokens = localStorage.getItem('cocoTokens');
    if (savedTokens) {
      this.tokens = JSON.parse(savedTokens);
    }
  },

  saveTokens(tokens) {
    this.tokens = tokens;
    localStorage.setItem('cocoTokens', JSON.stringify(tokens));
  },

  clearTokens() {
    this.tokens = { access: null, refresh: null };
    localStorage.removeItem('cocoTokens');
  },

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options.headers,
      },
      mode: 'cors',
      credentials: 'include',
    };

    if (this.tokens.access) {
      config.headers.Authorization = `Bearer ${this.tokens.access}`;
    }

    try {
      let response = await fetch(url, config);

      if (response.status === 401 && this.tokens.refresh) {
        const refreshed = await this.refreshToken();
        if (refreshed) {
          config.headers.Authorization = `Bearer ${this.tokens.access}`;
          response = await fetch(url, config);
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      if (error.message.includes('Failed to fetch')) {
        throw new Error('Ошибка сети. Проверьте интернет.');
      }
      throw error;
    }
  },

  async refreshToken() {
    try {
      const res = await fetch(`${this.baseURL}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ refreshToken: this.tokens.refresh }),
        credentials: 'include',
        mode: 'cors'
      });

      if (res.ok) {
        const data = await res.json();
        this.saveTokens({
          access: data.data.accessToken,
          refresh: data.data.refreshToken
        });
        return true;
      }
    } catch (err) {
      console.error('Refresh token failed:', err);
    }

    this.clearTokens();
    window.location.href = '/';
    return false;
  },

  async getProfile() {
    try {
      return await this.request('/auth/profile');
    } catch (err) {
      return null;
    }
  },

  auth: {
    async register(email, name, password) {
      const res = await API.request('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, name, password })
      });
      if (res.data) API.saveTokens(res.data);
      return res.data;
    },

    async login(email, password) {
      const res = await API.request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      if (res.data) API.saveTokens(res.data);
      return res.data;
    },

    async logout() {
      try {
        await API.request('/auth/logout', { method: 'POST' });
      } catch (err) {
        console.error('Logout error:', err);
      }
      API.clearTokens();
    }
  }
};

API.loadTokens();
