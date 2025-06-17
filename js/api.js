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
  },

  // Coco Money API
  cocoMoney: {
    async getSheets() {
      try {
        const res = await API.request('/coco-money/sheets');
        return res.data || { income: [], preliminary: [] };
      } catch (err) {
        console.error('Error loading sheets:', err);
        return { income: [], preliminary: [] };
      }
    },

    async saveSheets(sheets) {
      try {
        await API.request('/coco-money/sheets', {
          method: 'POST',
          body: JSON.stringify({ sheets })
        });
        return true;
      } catch (err) {
        console.error('Error saving sheets:', err);
        return false;
      }
    },

    async getCategories() {
      try {
        const res = await API.request('/coco-money/categories');
        return res.data || [];
      } catch (err) {
        console.error('Error loading categories:', err);
        return [];
      }
    },

    async saveCategories(categories) {
      try {
        await API.request('/coco-money/categories', {
          method: 'POST',
          body: JSON.stringify({ categories })
        });
        return true;
      } catch (err) {
        console.error('Error saving categories:', err);
        return false;
      }
    }
  },

  // Debts API
  debts: {
    async getDebts() {
      try {
        const res = await API.request('/debts');
        return res.data || [];
      } catch (err) {
        console.error('Error loading debts:', err);
        return [];
      }
    },

    async saveDebts(debts) {
      try {
        await API.request('/debts', {
          method: 'POST',
          body: JSON.stringify({ debts })
        });
        return true;
      } catch (err) {
        console.error('Error saving debts:', err);
        return false;
      }
    },

    async getCategories() {
      try {
        const res = await API.request('/debts/categories');
        return res.data || [];
      } catch (err) {
        console.error('Error loading debt categories:', err);
        return [];
      }
    },

    async saveCategories(categories) {
      try {
        await API.request('/debts/categories', {
          method: 'POST',
          body: JSON.stringify({ categories })
        });
        return true;
      } catch (err) {
        console.error('Error saving debt categories:', err);
        return false;
      }
    }
  },

  // Clothing Size API
  clothingSize: {
    async getData() {
      try {
        const res = await API.request('/clothing-size');
        return res.data || {
          parameters: {},
          savedResults: [],
          currentGender: 'male'
        };
      } catch (err) {
        console.error('Error loading clothing size data:', err);
        return {
          parameters: {},
          savedResults: [],
          currentGender: 'male'
        };
      }
    },

    async saveData(data) {
      try {
        await API.request('/clothing-size', {
          method: 'POST',
          body: JSON.stringify(data)
        });
        return true;
      } catch (err) {
        console.error('Error saving clothing size data:', err);
        return false;
      }
    }
  },

  // Scale Calculator API - ИСПРАВЛЕН ПУТЬ
  scaleCalculator: {
    async getHistory() {
      try {
        const res = await API.request('/geodesy/scale-calculator/history');
        // Конвертируем формат с бэкенда в формат фронтенда
        const history = res.data || [];
        return history.map(item => ({
          id: Date.parse(item.createdAt) || item.id, // Используем timestamp как id для совместимости
          scale: item.scale,
          textHeight: item.textHeight,
          timestamp: item.createdAt
        }));
      } catch (err) {
        console.error('Error loading scale calculator history:', err);
        return [];
      }
    },

    async saveHistory(history) {
      try {
        // Теперь используем новый endpoint для синхронизации
        await API.request('/geodesy/scale-calculator/history', {
          method: 'POST',
          body: JSON.stringify({ history })
        });
        return true;
      } catch (err) {
        console.error('Error saving scale calculator history:', err);
        return false;
      }
    }
  },

  // Sync utilities
  sync: {
    async syncAllData() {
      const user = await API.getProfile();
      if (!user) return false;

      try {
        // Синхронизация всех модулей
        await Promise.all([
          API.sync.syncCocoMoney(),
          API.sync.syncDebts(),
          API.sync.syncClothingSize(),
          API.sync.syncScaleCalculator()
        ]);
        return true;
      } catch (err) {
        console.error('Sync failed:', err);
        return false;
      }
    },

    async syncCocoMoney() {
      if (typeof cocoMoney !== 'undefined') {
        try {
          const serverData = await API.cocoMoney.getSheets();
          const serverCategories = await API.cocoMoney.getCategories();
          
          // Обновляем данные только если они есть на сервере
          if (serverData && (serverData.income.length > 0 || serverData.preliminary.length > 0)) {
            cocoMoney.sheets = serverData;
          }
          
          if (serverCategories && serverCategories.length > 0) {
            cocoMoney.customCategories = serverCategories;
          }
          
          cocoMoney.renderAll();
          cocoMoney.updateCategorySelect();
        } catch (err) {
          console.error('Error syncing CocoMoney:', err);
        }
      }
    },

    async syncDebts() {
      if (typeof debts !== 'undefined') {
        try {
          const serverDebts = await API.debts.getDebts();
          const serverCategories = await API.debts.getCategories();
          
          // Обновляем данные только если они есть на сервере
          if (serverDebts && serverDebts.length > 0) {
            debts.debtsList = serverDebts;
          }
          
          if (serverCategories && serverCategories.length > 0) {
            debts.customCategories = serverCategories;
          }
          
          debts.renderAll();
          debts.updateCategorySelect();
        } catch (err) {
          console.error('Error syncing Debts:', err);
        }
      }
    },

    async syncClothingSize() {
      if (typeof clothingSize !== 'undefined') {
        try {
          const serverData = await API.clothingSize.getData();
          
          // Обновляем данные только если они есть на сервере
          if (serverData) {
            if (Object.keys(serverData.parameters || {}).length > 0) {
              clothingSize.state.parameters = serverData.parameters;
            }
            
            if (serverData.savedResults && serverData.savedResults.length > 0) {
              clothingSize.state.savedResults = serverData.savedResults;
            }
            
            if (serverData.currentGender) {
              clothingSize.state.currentGender = serverData.currentGender;
            }
            
            clothingSize.restoreParameters();
            clothingSize.updateGenderSpecificElements();
          }
        } catch (err) {
          console.error('Error syncing ClothingSize:', err);
        }
      }
    },

    async syncScaleCalculator() {
      if (typeof scaleCalculator !== 'undefined') {
        try {
          const serverHistory = await API.scaleCalculator.getHistory();
          
          // Обновляем историю только если она есть на сервере
          if (serverHistory && serverHistory.length > 0) {
            scaleCalculator.history = serverHistory;
            scaleCalculator.renderHistory();
          }
        } catch (err) {
          console.error('Error syncing ScaleCalculator:', err);
        }
      }
    }
  }
};

API.loadTokens();
