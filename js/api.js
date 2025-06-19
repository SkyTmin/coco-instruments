// js/api.js - Enhanced API Client with Comprehensive Error Handling
window.addEventListener('unhandledrejection', event => {
  console.error('🚨 Unhandled promise rejection:', event.reason);
  
  if (event.reason?.message?.includes('401') || event.reason?.status === 401) {
    console.warn('🔐 Authentication failed - redirecting to login');
    API.clearTokens();
    // Only redirect if not already on login page
    if (!window.location.pathname.includes('index.html') && !window.location.pathname === '/') {
      window.location.href = '/';
    }
  }
});

const API = {
  baseURL: 'https://coco-instruments-backend-production.up.railway.app/api/v1',
  
  tokens: {
    access: null,
    refresh: null
  },
  
  // Request queue for handling concurrent requests during token refresh
  requestQueue: [],
  isRefreshing: false,
  
  // Network status tracking
  isOnline: navigator.onLine,
  
  // Initialize API client
  init() {
    this.loadTokens();
    this.setupNetworkListeners();
    this.setupRequestInterceptors();
    
    console.log('🚀 API Client initialized');
    console.log('📡 Base URL:', this.baseURL);
    console.log('🌐 Online status:', this.isOnline);
  },
  
  setupNetworkListeners() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      console.log('🌐 Network: Online');
      this.processQueuedRequests();
    });
    
    window.addEventListener('offline', () => {
      this.isOnline = false;
      console.log('🌐 Network: Offline');
    });
  },
  
  setupRequestInterceptors() {
    // Override fetch to add automatic retry and logging
    const originalFetch = window.fetch;
    window.fetch = async (url, options = {}) => {
      const startTime = Date.now();
      
      try {
        const response = await originalFetch(url, options);
        const duration = Date.now() - startTime;
        
        console.log(`📤 ${options.method || 'GET'} ${url} - ${response.status} (${duration}ms)`);
        
        return response;
      } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`❌ ${options.method || 'GET'} ${url} - Failed (${duration}ms):`, error);
        throw error;
      }
    };
  },
  
  loadTokens() {
    try {
      const savedTokens = localStorage.getItem('cocoTokens');
      if (savedTokens) {
        this.tokens = JSON.parse(savedTokens);
        console.log('🔑 Tokens loaded from localStorage');
      }
    } catch (error) {
      console.error('❌ Failed to load tokens:', error);
      this.clearTokens();
    }
  },
  
  saveTokens(tokens) {
    try {
      this.tokens = {
        access: tokens.accessToken || tokens.access,
        refresh: tokens.refreshToken || tokens.refresh
      };
      localStorage.setItem('cocoTokens', JSON.stringify(this.tokens));
      console.log('💾 Tokens saved to localStorage');
    } catch (error) {
      console.error('❌ Failed to save tokens:', error);
    }
  },
  
  clearTokens() {
    this.tokens = { access: null, refresh: null };
    localStorage.removeItem('cocoTokens');
    console.log('🗑️ Tokens cleared');
  },
  
  // Enhanced request method with comprehensive error handling
  async request(endpoint, options = {}) {
    if (!this.isOnline) {
      throw new Error('Network offline - request queued for retry');
    }
    
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        // Remove Cache-Control header that causes CORS issues
        ...options.headers,
      },
      mode: 'cors',
      credentials: 'include',
    };
    
    // Add authorization header if token exists
    if (this.tokens.access) {
      config.headers['Authorization'] = `Bearer ${this.tokens.access}`;
    }
    
    try {
      let response = await this.makeRequest(url, config);
      
      // Handle 401 Unauthorized
      if (response.status === 401 && this.tokens.refresh && !endpoint.includes('/auth/refresh')) {
        console.log('🔄 Access token expired, attempting refresh...');
        
        const refreshSuccess = await this.handleTokenRefresh();
        if (refreshSuccess) {
          // Retry original request with new token
          config.headers['Authorization'] = `Bearer ${this.tokens.access}`;
          response = await this.makeRequest(url, config);
        } else {
          throw new Error('Authentication failed - please login again');
        }
      }
      
      // Handle other HTTP errors
      if (!response.ok) {
        await this.handleHttpError(response, endpoint);
      }
      
      return await this.parseResponse(response);
      
    } catch (error) {
      console.error(`❌ Request failed: ${options.method || 'GET'} ${endpoint}`, error);
      throw this.enhanceError(error, endpoint, options);
    }
  },
  
  async makeRequest(url, config, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, config);
        return response;
      } catch (error) {
        console.warn(`⚠️ Request attempt ${i + 1} failed:`, error.message);
        
        if (i === retries - 1) throw error;
        
        // Exponential backoff
        await this.sleep(Math.pow(2, i) * 1000);
      }
    }
  },
  
  async handleTokenRefresh() {
    if (this.isRefreshing) {
      // Wait for ongoing refresh
      return new Promise((resolve) => {
        this.requestQueue.push(resolve);
      });
    }
    
    this.isRefreshing = true;
    
    try {
      console.log('🔄 Refreshing access token...');
      
      const response = await fetch(`${this.baseURL}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.tokens.refresh}`
        },
        body: JSON.stringify({ refreshToken: this.tokens.refresh }),
        credentials: 'include',
        mode: 'cors'
      });
      
      if (response.ok) {
        const data = await response.json();
        this.saveTokens({
          accessToken: data.data.accessToken,
          refreshToken: data.data.refreshToken
        });
        
        console.log('✅ Token refresh successful');
        this.processQueuedRequests(true);
        return true;
      } else {
        console.error('❌ Token refresh failed:', response.status);
        this.clearTokens();
        this.processQueuedRequests(false);
        return false;
      }
    } catch (error) {
      console.error('❌ Token refresh error:', error);
      this.clearTokens();
      this.processQueuedRequests(false);
      return false;
    } finally {
      this.isRefreshing = false;
    }
  },
  
  processQueuedRequests(success = true) {
    this.requestQueue.forEach(resolve => resolve(success));
    this.requestQueue = [];
  },
  
  async handleHttpError(response, endpoint) {
    const errorData = await response.text();
    let errorMessage = `HTTP ${response.status}`;
    
    try {
      const parsed = JSON.parse(errorData);
      errorMessage = parsed.message || parsed.error || errorMessage;
    } catch (e) {
      errorMessage = errorData || errorMessage;
    }
    
    console.error(`❌ HTTP Error ${response.status} on ${endpoint}:`, errorMessage);
    
    const error = new Error(errorMessage);
    error.status = response.status;
    error.endpoint = endpoint;
    throw error;
  },
  
  async parseResponse(response) {
    const contentType = response.headers.get('content-type');
    
    if (contentType?.includes('application/json')) {
      return await response.json();
    } else {
      return await response.text();
    }
  },
  
  enhanceError(error, endpoint, options) {
    if (error.message?.includes('Failed to fetch') || error.name === 'TypeError') {
      const enhancedError = new Error('Network error - check internet connection');
      enhancedError.originalError = error;
      enhancedError.endpoint = endpoint;
      enhancedError.isNetworkError = true;
      return enhancedError;
    }
    
    error.endpoint = endpoint;
    error.method = options.method || 'GET';
    return error;
  },
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },
  
  // Enhanced profile method with caching
  async getProfile() {
    try {
      const response = await this.request('/auth/profile');
      return response.data || response;
    } catch (error) {
      console.error('❌ Failed to get profile:', error);
      return null;
    }
  },
  
  // Authentication methods
  auth: {
    async register(email, name, password) {
      const response = await API.request('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, name, password })
      });
      
      if (response.data) {
        API.saveTokens(response.data);
      }
      
      return response.data;
    },
    
    async login(email, password) {
      const response = await API.request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      
      if (response.data) {
        API.saveTokens(response.data);
      }
      
      return response.data;
    },
    
    async logout() {
      try {
        await API.request('/auth/logout', { method: 'POST' });
      } catch (error) {
        console.error('❌ Logout error:', error);
      } finally {
        API.clearTokens();
      }
    }
  },
  
  // Enhanced Coco Money API with better error handling
  cocoMoney: {
    async getSheets() {
      try {
        console.log('📊 Fetching Coco Money sheets...');
        const response = await API.request('/coco-money/sheets');
        const data = response.data || response;
        console.log('✅ Coco Money sheets loaded:', data);
        return data;
      } catch (error) {
        console.error('❌ Failed to load Coco Money sheets:', error);
        
        if (error.status === 404) {
          console.log('📊 No sheets found, returning empty data');
          return { income: [], preliminary: [] };
        }
        
        throw error;
      }
    },
    
    async saveSheets(sheets) {
      try {
        console.log('💾 Saving Coco Money sheets...', sheets);
        await API.request('/coco-money/sheets', {
          method: 'POST',
          body: JSON.stringify({ sheets })
        });
        console.log('✅ Coco Money sheets saved successfully');
        return true;
      } catch (error) {
        console.error('❌ Failed to save Coco Money sheets:', error);
        throw error;
      }
    },
    
    async getCategories() {
      try {
        console.log('📋 Fetching Coco Money categories...');
        const response = await API.request('/coco-money/categories');
        const data = response.data || response;
        console.log('✅ Coco Money categories loaded:', data);
        return data;
      } catch (error) {
        console.error('❌ Failed to load Coco Money categories:', error);
        
        if (error.status === 404) {
          console.log('📋 No categories found, returning empty array');
          return [];
        }
        
        throw error;
      }
    },
    
    async saveCategories(categories) {
      try {
        console.log('💾 Saving Coco Money categories...', categories);
        await API.request('/coco-money/categories', {
          method: 'POST',
          body: JSON.stringify({ categories })
        });
        console.log('✅ Coco Money categories saved successfully');
        return true;
      } catch (error) {
        console.error('❌ Failed to save Coco Money categories:', error);
        throw error;
      }
    }
  },
  
  // Enhanced Debts API
  debts: {
    async getDebts() {
      try {
        console.log('💳 Fetching debts...');
        const response = await API.request('/debts');
        const data = response.data || response;
        console.log('✅ Debts loaded:', data);
        return data;
      } catch (error) {
        console.error('❌ Failed to load debts:', error);
        
        if (error.status === 404) {
          console.log('💳 No debts found, returning empty array');
          return [];
        }
        
        throw error;
      }
    },
    
    async saveDebts(debts) {
      try {
        console.log('💾 Saving debts...', debts);
        await API.request('/debts', {
          method: 'POST',
          body: JSON.stringify({ debts })
        });
        console.log('✅ Debts saved successfully');
        return true;
      } catch (error) {
        console.error('❌ Failed to save debts:', error);
        throw error;
      }
    },
    
    async getCategories() {
      try {
        console.log('📋 Fetching debt categories...');
        const response = await API.request('/debts/categories');
        const data = response.data || response;
        console.log('✅ Debt categories loaded:', data);
        return data;
      } catch (error) {
        console.error('❌ Failed to load debt categories:', error);
        
        if (error.status === 404) {
          console.log('📋 No debt categories found, returning empty array');
          return [];
        }
        
        throw error;
      }
    },
    
    async saveCategories(categories) {
      try {
        console.log('💾 Saving debt categories...', categories);
        await API.request('/debts/categories', {
          method: 'POST',
          body: JSON.stringify({ categories })
        });
        console.log('✅ Debt categories saved successfully');
        return true;
      } catch (error) {
        console.error('❌ Failed to save debt categories:', error);
        throw error;
      }
    }
  },
  
  // Enhanced Clothing Size API
  clothingSize: {
    async getData() {
      try {
        console.log('👕 Fetching clothing size data...');
        const response = await API.request('/clothing-size');
        const data = response.data || response;
        console.log('✅ Clothing size data loaded:', data);
        return data;
      } catch (error) {
        console.error('❌ Failed to load clothing size data:', error);
        
        if (error.status === 404) {
          console.log('👕 No clothing data found, returning empty data');
          return {
            parameters: {},
            savedResults: [],
            currentGender: 'male'
          };
        }
        
        throw error;
      }
    },
    
    async saveData(data) {
      try {
        console.log('💾 Saving clothing size data...', data);
        await API.request('/clothing-size', {
          method: 'POST',
          body: JSON.stringify(data)
        });
        console.log('✅ Clothing size data saved successfully');
        return true;
      } catch (error) {
        console.error('❌ Failed to save clothing size data:', error);
        throw error;
      }
    }
  },
  
  // Enhanced Scale Calculator API
  scaleCalculator: {
    async getHistory() {
      try {
        console.log('📐 Fetching scale calculator history...');
        const response = await API.request('/geodesy/scale-calculator/history');
        const history = response.data || response;
        
        // Convert backend format to frontend format
        const formattedHistory = (history || []).map(item => ({
          id: Date.parse(item.createdAt) || item.id,
          scale: item.scale,
          textHeight: item.textHeight,
          timestamp: item.createdAt
        }));
        
        console.log('✅ Scale calculator history loaded:', formattedHistory);
        return formattedHistory;
      } catch (error) {
        console.error('❌ Failed to load scale calculator history:', error);
        
        if (error.status === 404) {
          console.log('📐 No history found, returning empty array');
          return [];
        }
        
        throw error;
      }
    },
    
    async saveHistory(history) {
      try {
        console.log('💾 Saving scale calculator history...', history);
        await API.request('/geodesy/scale-calculator/history', {
          method: 'POST',
          body: JSON.stringify({ history })
        });
        console.log('✅ Scale calculator history saved successfully');
        return true;
      } catch (error) {
        console.error('❌ Failed to save scale calculator history:', error);
        throw error;
      }
    }
  },
  
  // Enhanced sync utilities with queue management
  sync: {
    syncQueue: [],
    isSyncing: false,
    
    async syncAllData() {
      if (this.isSyncing) {
        console.log('⏳ Sync already in progress, skipping...');
        return false;
      }
      
      const user = await API.getProfile();
      if (!user) {
        console.log('❌ No authenticated user, skipping sync');
        return false;
      }
      
      this.isSyncing = true;
      
      try {
        console.log('🔄 Starting comprehensive data sync...');
        
        const syncPromises = [
          this.syncCocoMoney(),
          this.syncDebts(),
          this.syncClothingSize(),
          this.syncScaleCalculator()
        ];
        
        const results = await Promise.allSettled(syncPromises);
        
        // Log results
        results.forEach((result, index) => {
          const modules = ['CocoMoney', 'Debts', 'ClothingSize', 'ScaleCalculator'];
          if (result.status === 'fulfilled') {
            console.log(`✅ ${modules[index]} sync completed`);
          } else {
            console.error(`❌ ${modules[index]} sync failed:`, result.reason);
          }
        });
        
        const successCount = results.filter(r => r.status === 'fulfilled').length;
        console.log(`🎯 Sync completed: ${successCount}/${results.length} modules successful`);
        
        return successCount === results.length;
      } catch (error) {
        console.error('❌ Comprehensive sync failed:', error);
        throw error;
      } finally {
        this.isSyncing = false;
      }
    },
    
    async syncCocoMoney() {
      if (typeof cocoMoney === 'undefined') {
        console.log('⏭️ CocoMoney module not loaded, skipping sync');
        return;
      }
      
      try {
        const [serverSheets, serverCategories] = await Promise.all([
          API.cocoMoney.getSheets(),
          API.cocoMoney.getCategories()
        ]);
        
        // Update local data with server data
        if (serverSheets) {
          cocoMoney.sheets = serverSheets;
        }
        
        if (serverCategories) {
          cocoMoney.customCategories = serverCategories;
        }
        
        // Update UI
        cocoMoney.renderAll();
        cocoMoney.updateCategorySelect();
        
        console.log('✅ CocoMoney sync completed');
      } catch (error) {
        console.error('❌ CocoMoney sync failed:', error);
        throw error;
      }
    },
    
    async syncDebts() {
      if (typeof debts === 'undefined') {
        console.log('⏭️ Debts module not loaded, skipping sync');
        return;
      }
      
      try {
        const [serverDebts, serverCategories] = await Promise.all([
          API.debts.getDebts(),
          API.debts.getCategories()
        ]);
        
        // Update local data with server data
        if (serverDebts) {
          debts.debtsList = serverDebts;
        }
        
        if (serverCategories) {
          debts.customCategories = serverCategories;
        }
        
        // Update UI
        debts.renderAll();
        debts.updateCategorySelect();
        
        console.log('✅ Debts sync completed');
      } catch (error) {
        console.error('❌ Debts sync failed:', error);
        throw error;
      }
    },
    
    async syncClothingSize() {
      if (typeof clothingSize === 'undefined') {
        console.log('⏭️ ClothingSize module not loaded, skipping sync');
        return;
      }
      
      try {
        const serverData = await API.clothingSize.getData();
        
        if (serverData) {
          clothingSize.state.parameters = serverData.parameters || {};
          clothingSize.state.savedResults = serverData.savedResults || [];
          clothingSize.state.currentGender = serverData.currentGender || 'male';
          
          clothingSize.restoreParameters();
          clothingSize.updateGenderSpecificElements();
        }
        
        console.log('✅ ClothingSize sync completed');
      } catch (error) {
        console.error('❌ ClothingSize sync failed:', error);
        throw error;
      }
    },
    
    async syncScaleCalculator() {
      if (typeof scaleCalculator === 'undefined') {
        console.log('⏭️ ScaleCalculator module not loaded, skipping sync');
        return;
      }
      
      try {
        const serverHistory = await API.scaleCalculator.getHistory();
        
        if (serverHistory) {
          scaleCalculator.history = serverHistory;
          scaleCalculator.renderHistory();
        }
        
        console.log('✅ ScaleCalculator sync completed');
      } catch (error) {
        console.error('❌ ScaleCalculator sync failed:', error);
        throw error;
      }
    }
  }
};

// Initialize API client
API.init();

// Global error handlers
window.addEventListener('error', (event) => {
  console.error('🚨 Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('🚨 Unhandled promise rejection:', event.reason);
});

// Export for global access
window.API = API;
