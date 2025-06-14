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
        ...options.headers,
      },
      credentials: 'include', // 🔥 Ключевой момент для CORS + токены/cookies
    };

    if (this.tokens.access) {
      config.headers.Authorization = `Bearer ${this.tokens.access}`;
    }

    try {
      const response = await fetch(url, config);

      if (response.status === 401 && this.tokens.refresh) {
        const refreshed = await this.refreshToken();
        if (refreshed) {
          config.headers.Authorization = `Bearer ${this.tokens.access}`;
          return fetch(url, config).then(res => res.json());
        }
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return response.json();
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  },

  async refreshToken() {
    try {
      const response = await fetch(`${this.baseURL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.tokens.refresh }),
        credentials: 'include' // 🔥 тоже важно
      });

      if (response.ok) {
        const data = await response.json();
        this.saveTokens({
          access: data.data.accessToken,
          refresh: data.data.refreshToken
        });
        return true;
      }
    } catch (error) {
      console.error('Token refresh failed:', error);
    }

    this.clearTokens();
    window.location.href = '/';
    return false;
  },

  auth: {
    async register(email, name, password) {
      const response = await API.request('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, name, password })
      });
      API.saveTokens({
        access: response.data.accessToken,
        refresh: response.data.refreshToken
      });
      return response.data;
    },

    async login(email, password) {
      const response = await API.request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      API.saveTokens({
        access: response.data.accessToken,
        refresh: response.data.refreshToken
      });
      return response.data;
    },

    async logout() {
      await API.request('/auth/logout', { method: 'POST' });
      API.clearTokens();
    }
  },

  cocoMoney: {
    async getSheets(type) {
      const query = type ? `?type=${type}` : '';
      return API.request(`/finance/coco-money/sheets${query}`);
    },

    async createSheet(data) {
      return API.request('/finance/coco-money/sheets', {
        method: 'POST',
        body: JSON.stringify(data)
      });
    },

    async updateSheet(id, data) {
      return API.request(`/finance/coco-money/sheets/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
    },

    async deleteSheet(id) {
      return API.request(`/finance/coco-money/sheets/${id}`, {
        method: 'DELETE'
      });
    },

    async addExpense(sheetId, data) {
      return API.request(`/finance/coco-money/sheets/${sheetId}/expenses`, {
        method: 'POST',
        body: JSON.stringify(data)
      });
    },

    async getCategories() {
      return API.request('/finance/coco-money/categories');
    },

    async createCategory(name) {
      return API.request('/finance/coco-money/categories', {
        method: 'POST',
        body: JSON.stringify({ name })
      });
    }
  },

  debts: {
    async getDebts(sort, status) {
      const params = new URLSearchParams();
      if (sort) params.append('sort', sort);
      if (status) params.append('status', status);
      const query = params.toString() ? `?${params}` : '';
      return API.request(`/finance/debts${query}`);
    },

    async createDebt(data) {
      return API.request('/finance/debts', {
        method: 'POST',
        body: JSON.stringify(data)
      });
    },

    async updateDebt(id, data) {
      return API.request(`/finance/debts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
    },

    async deleteDebt(id) {
      return API.request(`/finance/debts/${id}`, {
        method: 'DELETE'
      });
    },

    async addPayment(debtId, data) {
      return API.request(`/finance/debts/${debtId}/payments`, {
        method: 'POST',
        body: JSON.stringify(data)
      });
    }
  },

  clothingSize: {
    async getParameters() {
      return API.request('/clothing/size/parameters');
    },

    async saveParameters(data) {
      return API.request('/clothing/size/parameters', {
        method: 'POST',
        body: JSON.stringify(data)
      });
    },

    async updateParameters(data) {
      return API.request('/clothing/size/parameters', {
        method: 'PUT',
        body: JSON.stringify(data)
      });
    },

    async calculateSize(category, parameters) {
      return API.request('/clothing/size/calculate', {
        method: 'POST',
        body: JSON.stringify({ category, parameters })
      });
    }
  },

  scaleCalculator: {
    async calculate(type, value) {
      return API.request('/geodesy/scale-calculator/calculate', {
        method: 'POST',
        body: JSON.stringify({ type, value })
      });
    },

    async getHistory() {
      return API.request('/geodesy/scale-calculator/history');
    },

    async clearHistory() {
      return API.request('/geodesy/scale-calculator/history', {
        method: 'DELETE'
      });
    }
  }
};

API.loadTokens();
