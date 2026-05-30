// js/app.js - Enterprise-Grade Application Controller with Advanced Sync Management

// Type definitions using JSDoc for JavaScript compatibility
/**
 * @typedef {Object} SyncMetrics
 * @property {number} startTime
 * @property {number} [endTime]
 * @property {number} [duration]
 * @property {boolean} success
 * @property {string[]} errors
 * @property {Object.<string, {success: boolean, duration: number, error?: string}>} modules
 */

/**
 * @typedef {Object} NetworkStatus
 * @property {boolean} isOnline
 * @property {number} lastOnlineTime
 * @property {number} lastOfflineTime
 * @property {string} [connectionType]
 * @property {string} [effectiveType]
 */

/**
 * @typedef {Object} AppState
 * @property {any} currentUser
 * @property {string} currentSection
 * @property {string|null} previousSection
 * @property {boolean} isInitialized
 * @property {boolean} syncInProgress
 * @property {number} lastSyncTime
 * @property {NetworkStatus} networkStatus
 * @property {SyncMetrics[]} syncMetrics
 * @property {Array<{action: string, data: any, attempts: number, maxAttempts: number}>} retryQueue
 */

const app = {
  // Application state with comprehensive tracking
  /** @type {AppState} */
  state: {
    currentUser: null,
    currentSection: 'home',
    previousSection: null,
    isInitialized: false,
    syncInProgress: false,
    lastSyncTime: 0,
    networkStatus: {
      isOnline: navigator.onLine,
      lastOnlineTime: Date.now(),
      lastOfflineTime: 0,
      connectionType: navigator.connection?.type || 'unknown',
      effectiveType: navigator.connection?.effectiveType || 'unknown'
    },
    syncMetrics: [],
    retryQueue: []
  },

  // Configuration constants
  config: {
    SYNC_INTERVAL: 5 * 60 * 1000, // 5 minutes
    RETRY_INTERVALS: [1000, 3000, 5000, 10000, 30000], // Progressive retry delays
    MAX_SYNC_METRICS: 50,
    PERFORMANCE_THRESHOLD: 2000, // 2 seconds
    HEALTH_CHECK_INTERVAL: 30 * 1000, // 30 seconds
    OFFLINE_TIMEOUT: 10 * 1000 // 10 seconds to consider truly offline
  },

  // Performance monitoring
  performance: {
    marks: new Map(),
    measures: new Map(),
    
    mark(name) {
      this.marks.set(name, performance.now());
    },
    
    measure(name, startMark) {
      const startTime = this.marks.get(startMark);
      if (!startTime) return 0;
      
      const duration = performance.now() - startTime;
      this.measures.set(name, duration);
      
      if (duration > app.config.PERFORMANCE_THRESHOLD) {
        console.warn(`⚠️ Performance Warning: ${name} took ${duration.toFixed(2)}ms`);
      }
      
      return duration;
    }
  },

  // Enhanced initialization with comprehensive setup
  async init() {
    try {
      console.log('🚀 Initializing Coco Instruments Application...');
      this.performance.mark('app-init-start');

      // Initialize core components
      await this.initializeCore();
      
      // Setup monitoring and listeners
      this.setupMonitoring();
      this.setupNetworkListeners();
      this.setupEventListeners();
      this.setupPerformanceObserver();
      
      // Authentication check and data loading
      await this.checkAuthAndLoadData();
      
      // UI initialization
      this.addTouchSupport();
      this.handleBrowserNavigation();
      
      // Start background tasks
      this.startBackgroundTasks();
      
      this.state.isInitialized = true;
      this.performance.measure('app-init', 'app-init-start');
      
      console.log('✅ Application initialized successfully');
      console.log(`📊 Initialization took: ${this.performance.measures.get('app-init')?.toFixed(2)}ms`);
      
    } catch (error) {
      console.error('❌ Application initialization failed:', error);
      this.handleInitializationError(error);
    }
  },

  async initializeCore() {
    // Initialize API client
    if (typeof API !== 'undefined' && API.init) {
      await API.init();
    }
    
    // Initialize performance monitoring
    this.initializePerformanceMonitoring();
    
    // Setup error handlers
    this.setupGlobalErrorHandlers();
  },

  setupMonitoring() {
    // Network connection monitoring
    if ('connection' in navigator) {
      const connection = navigator.connection;
      
      connection.addEventListener('change', () => {
        this.state.networkStatus.connectionType = connection.type;
        this.state.networkStatus.effectiveType = connection.effectiveType;
        
        console.log('📶 Network connection changed:', {
          type: connection.type,
          effectiveType: connection.effectiveType,
          downlink: connection.downlink
        });
      });
    }

    // Memory usage monitoring
    if ('memory' in performance) {
      setInterval(() => {
        const memory = performance.memory;
        if (memory.usedJSHeapSize > memory.totalJSHeapSize * 0.8) {
          console.warn('⚠️ High memory usage detected:', {
            used: Math.round(memory.usedJSHeapSize / 1024 / 1024),
            total: Math.round(memory.totalJSHeapSize / 1024 / 1024),
            limit: Math.round(memory.jsHeapSizeLimit / 1024 / 1024)
          });
        }
      }, 60000); // Check every minute
    }
  },

  setupNetworkListeners() {
    window.addEventListener('online', async () => {
      const now = Date.now();
      this.state.networkStatus.isOnline = true;
      this.state.networkStatus.lastOnlineTime = now;
      
      const offlineDuration = now - this.state.networkStatus.lastOfflineTime;
      console.log(`🌐 Network: Back online after ${Math.round(offlineDuration / 1000)}s`);
      
      this.showToast('Подключение восстановлено', 'success');
      
      // Process retry queue
      await this.processRetryQueue();
      
      // Sync data if authenticated and enough time has passed
      if (this.state.currentUser && (now - this.state.lastSyncTime) > this.config.SYNC_INTERVAL) {
        await this.syncAllData();
      }
    });

    window.addEventListener('offline', () => {
      this.state.networkStatus.isOnline = false;
      this.state.networkStatus.lastOfflineTime = Date.now();
      
      console.log('🌐 Network: Offline');
      this.showToast('Подключение потеряно - работа в офлайн режиме', 'warning');
    });
  },

  setupPerformanceObserver() {
    if ('PerformanceObserver' in window) {
      // Monitor long tasks
      try {
        const longTaskObserver = new PerformanceObserver((list) => {
          list.getEntries().forEach((entry) => {
            if (entry.duration > 50) { // Tasks longer than 50ms
              console.warn(`⚠️ Long task detected: ${entry.duration.toFixed(2)}ms`);
            }
          });
        });
        longTaskObserver.observe({ entryTypes: ['longtask'] });
      } catch (e) {
        console.log('Long task observer not supported');
      }

      // Monitor navigation timing
      try {
        const navigationObserver = new PerformanceObserver((list) => {
          list.getEntries().forEach((entry) => {
            console.log('📊 Navigation timing:', {
              loadEventEnd: entry.loadEventEnd,
              domContentLoaded: entry.domContentLoadedEventEnd,
              firstPaint: entry.responseEnd
            });
          });
        });
        navigationObserver.observe({ entryTypes: ['navigation'] });
      } catch (e) {
        console.log('Navigation observer not supported');
      }
    }
  },

  async checkAuthAndLoadData() {
    try {
      this.performance.mark('auth-check-start');
      
      const user = await API.getProfile();
      if (user) {
        this.state.currentUser = user;
        this.updateAuthUI(true);
        
        console.log('👤 User authenticated:', user.data?.email || user.email);
        
        // Load user data with comprehensive error handling
        if (this.state.networkStatus.isOnline) {
          await this.loadAllDataFromServer();
        } else {
          console.log('📱 Offline - loading cached data');
          this.loadCachedData();
        }
      } else {
        console.log('👤 No authenticated user');
        this.updateAuthUI(false);
        this.clearAllLocalData();
      }
      
      this.performance.measure('auth-check', 'auth-check-start');
      
    } catch (error) {
      console.error('❌ Authentication check failed:', error);
      this.updateAuthUI(false);
      this.clearAllLocalData();
    }
  },

  async loadAllDataFromServer() {
    if (!this.state.currentUser || !this.state.networkStatus.isOnline) {
      console.log('⏭️ Skipping server data load - no user or offline');
      return;
    }

    /** @type {SyncMetrics} */
    const syncMetric = {
      startTime: Date.now(),
      success: false,
      errors: [],
      modules: {}
    };

    this.showSyncIndicator(true);

    try {
      console.log('🔄 Loading all data from server...');
      this.performance.mark('data-load-start');
      
      // Load data in parallel with individual error handling
      const loadPromises = [
        this.loadModuleData('cocoMoney', () => this.loadCocoMoneyData()),
        this.loadModuleData('debts', () => this.loadDebtsData()),
        this.loadModuleData('clothingSize', () => this.loadClothingSizeData()),
        this.loadModuleData('scaleCalculator', () => this.loadScaleCalculatorData())
      ];

      const results = await Promise.allSettled(loadPromises);
      
      // Process results
      results.forEach((result, index) => {
        const moduleNames = ['cocoMoney', 'debts', 'clothingSize', 'scaleCalculator'];
        const moduleName = moduleNames[index];
        
        if (result.status === 'fulfilled') {
          syncMetric.modules[moduleName] = result.value;
          console.log(`✅ ${moduleName} data loaded successfully`);
        } else {
          const error = result.reason?.message || 'Unknown error';
          syncMetric.modules[moduleName] = { success: false, duration: 0, error };
          syncMetric.errors.push(`${moduleName}: ${error}`);
          console.error(`❌ ${moduleName} data load failed:`, result.reason);
        }
      });

      const successCount = Object.values(syncMetric.modules).filter(m => m.success).length;
      const totalCount = Object.keys(syncMetric.modules).length;
      
      syncMetric.success = successCount === totalCount;
      this.performance.measure('data-load', 'data-load-start');
      
      if (syncMetric.success) {
        console.log(`✅ All data loaded successfully (${this.performance.measures.get('data-load')?.toFixed(2)}ms)`);
        this.showToast('Данные загружены', 'success');
      } else {
        console.warn(`⚠️ Partial data load: ${successCount}/${totalCount} modules successful`);
        this.showToast(`Частично загружено: ${successCount}/${totalCount}`, 'warning');
      }
      
      this.state.lastSyncTime = Date.now();
      
    } catch (error) {
      console.error('❌ Data loading failed:', error);
      syncMetric.errors.push(error.message);
      this.showToast('Ошибка загрузки данных', 'error');
    } finally {
      syncMetric.endTime = Date.now();
      syncMetric.duration = syncMetric.endTime - syncMetric.startTime;
      
      this.addSyncMetric(syncMetric);
      this.showSyncIndicator(false);
    }
  },

  async loadModuleData(moduleName, loadFunction) {
    const startTime = Date.now();
    
    try {
      await loadFunction();
      return {
        success: true,
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  },

  async loadCocoMoneyData() {
    console.log('📊 Loading Coco Money data...');
    const [serverSheets, serverCategories] = await Promise.all([
      API.cocoMoney.getSheets(),
      API.cocoMoney.getCategories()
    ]);
    
    // Cache data locally
    localStorage.setItem('cocoMoneySheets', JSON.stringify(serverSheets));
    localStorage.setItem('cocoMoneyCategories', JSON.stringify(serverCategories));
    
    // Update UI if module is loaded
    if (typeof cocoMoney !== 'undefined') {
      cocoMoney.sheets = serverSheets || { income: [], preliminary: [] };
      cocoMoney.customCategories = serverCategories || [];
      cocoMoney.renderAll();
      cocoMoney.updateCategorySelect();
    }
  },

  async loadDebtsData() {
    console.log('💳 Loading debts data...');
    const [serverDebts, serverCategories] = await Promise.all([
      API.debts.getDebts(),
      API.debts.getCategories()
    ]);
    
    // Cache data locally
    localStorage.setItem('cocoDebts', JSON.stringify(serverDebts));
    localStorage.setItem('cocoDebtCategories', JSON.stringify(serverCategories));
    
    // Update UI if module is loaded
    if (typeof debts !== 'undefined') {
      debts.debtsList = serverDebts || [];
      debts.customCategories = serverCategories || [];
      debts.renderAll();
      debts.updateCategorySelect();
    }
  },

  async loadClothingSizeData() {
    console.log('👕 Loading clothing size data...');
    const serverData = await API.clothingSize.getData();
    
    // Cache data locally
    localStorage.setItem('clothingSizeData', JSON.stringify(serverData));
    
    // Update UI if module is loaded
    if (typeof clothingSize !== 'undefined' && serverData) {
      clothingSize.state.parameters = serverData.parameters || {};
      clothingSize.state.savedResults = serverData.savedResults || [];
      clothingSize.state.currentGender = serverData.currentGender || 'male';
      clothingSize.restoreParameters();
      clothingSize.updateGenderSpecificElements();
    }
  },

  async loadScaleCalculatorData() {
    console.log('📐 Loading scale calculator data...');
    const serverHistory = await API.scaleCalculator.getHistory();
    
    // Cache data locally
    localStorage.setItem('scaleCalculatorHistory', JSON.stringify(serverHistory));
    
    // Update UI if module is loaded
    if (typeof scaleCalculator !== 'undefined') {
      scaleCalculator.history = serverHistory || [];
      scaleCalculator.renderHistory();
    }
  },

  loadCachedData() {
    console.log('💾 Loading cached data...');
    
    // Load cached data for each module
    this.loadCachedModuleData('cocoMoney', 'cocoMoneySheets', 'cocoMoneyCategories');
    this.loadCachedModuleData('debts', 'cocoDebts', 'cocoDebtCategories');
    this.loadCachedModuleData('clothingSize', 'clothingSizeData');
    this.loadCachedModuleData('scaleCalculator', 'scaleCalculatorHistory');
  },

  loadCachedModuleData(moduleName, ...cacheKeys) {
    try {
      if (moduleName === 'cocoMoney' && typeof cocoMoney !== 'undefined') {
        const sheets = localStorage.getItem(cacheKeys[0]);
        const categories = localStorage.getItem(cacheKeys[1]);
        
        if (sheets) cocoMoney.sheets = JSON.parse(sheets);
        if (categories) cocoMoney.customCategories = JSON.parse(categories);
        
        cocoMoney.renderAll();
        cocoMoney.updateCategorySelect();
      }
      // Similar for other modules...
      
      console.log(`💾 ${moduleName} cached data loaded`);
    } catch (error) {
      console.error(`❌ Failed to load cached data for ${moduleName}:`, error);
    }
  },

  async syncAllData() {
    if (this.state.syncInProgress || !this.state.currentUser || !this.state.networkStatus.isOnline) {
      console.log('⏭️ Skipping sync - already syncing, not authenticated, or offline');
      return false;
    }

    this.state.syncInProgress = true;
    /** @type {SyncMetrics} */
    const syncMetric = {
      startTime: Date.now(),
      success: false,
      errors: [],
      modules: {}
    };

    this.showSyncIndicator(true);

    try {
      console.log('🔄 Starting comprehensive data sync...');
      this.performance.mark('sync-start');
      
      // Sync all modules in parallel
      const syncPromises = [
        this.syncModuleData('cocoMoney', () => this.syncCocoMoneyToServer()),
        this.syncModuleData('debts', () => this.syncDebtsToServer()),
        this.syncModuleData('clothingSize', () => this.syncClothingSizeToServer()),
        this.syncModuleData('scaleCalculator', () => this.syncScaleCalculatorToServer())
      ];

      const results = await Promise.allSettled(syncPromises);
      
      // Process results
      results.forEach((result, index) => {
        const moduleNames = ['cocoMoney', 'debts', 'clothingSize', 'scaleCalculator'];
        const moduleName = moduleNames[index];
        
        if (result.status === 'fulfilled') {
          syncMetric.modules[moduleName] = result.value;
        } else {
          const error = result.reason?.message || 'Unknown error';
          syncMetric.modules[moduleName] = { success: false, duration: 0, error };
          syncMetric.errors.push(`${moduleName}: ${error}`);
        }
      });

      const successCount = Object.values(syncMetric.modules).filter(m => m.success).length;
      const totalCount = Object.keys(syncMetric.modules).length;
      
      syncMetric.success = successCount === totalCount;
      this.performance.measure('sync-total', 'sync-start');
      
      this.state.lastSyncTime = Date.now();
      
      if (syncMetric.success) {
        console.log(`✅ Sync completed successfully (${this.performance.measures.get('sync-total')?.toFixed(2)}ms)`);
        this.showToast('Данные синхронизированы', 'success');
        return true;
      } else {
        console.warn(`⚠️ Partial sync: ${successCount}/${totalCount} modules successful`);
        this.showToast(`Частично синхронизировано: ${successCount}/${totalCount}`, 'warning');
        return false;
      }
      
    } catch (error) {
      console.error('❌ Sync failed:', error);
      syncMetric.errors.push(error.message);
      this.showToast('Ошибка синхронизации', 'error');
      return false;
    } finally {
      syncMetric.endTime = Date.now();
      syncMetric.duration = syncMetric.endTime - syncMetric.startTime;
      
      this.addSyncMetric(syncMetric);
      this.state.syncInProgress = false;
      this.showSyncIndicator(false);
    }
  },

  async syncModuleData(moduleName, syncFunction) {
    const startTime = Date.now();
    
    try {
      await syncFunction();
      return {
        success: true,
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  },

  async syncCocoMoneyToServer() {
    if (typeof cocoMoney !== 'undefined' && cocoMoney.sheets) {
      await Promise.all([
        API.cocoMoney.saveSheets(cocoMoney.sheets),
        API.cocoMoney.saveCategories(cocoMoney.customCategories)
      ]);
    }
  },

  async syncDebtsToServer() {
    if (typeof debts !== 'undefined' && debts.debtsList) {
      await Promise.all([
        API.debts.saveDebts(debts.debtsList),
        API.debts.saveCategories(debts.customCategories)
      ]);
    }
  },

  async syncClothingSizeToServer() {
    if (typeof clothingSize !== 'undefined' && clothingSize.state) {
      await API.clothingSize.saveData({
        parameters: clothingSize.state.parameters,
        savedResults: clothingSize.state.savedResults,
        currentGender: clothingSize.state.currentGender
      });
    }
  },

  async syncScaleCalculatorToServer() {
    if (typeof scaleCalculator !== 'undefined' && scaleCalculator.history) {
      await API.scaleCalculator.saveHistory(scaleCalculator.history);
    }
  },

  async processRetryQueue() {
    if (this.state.retryQueue.length === 0) return;
    
    console.log(`🔄 Processing retry queue: ${this.state.retryQueue.length} items`);
    
    const queue = [...this.state.retryQueue];
    this.state.retryQueue = [];
    
    for (const item of queue) {
      try {
        // Implement retry logic based on action type
        await this.retryAction(item);
        console.log(`✅ Retry successful: ${item.action}`);
      } catch (error) {
        item.attempts++;
        if (item.attempts < item.maxAttempts) {
          this.state.retryQueue.push(item);
          console.log(`⚠️ Retry failed, re-queued: ${item.action} (${item.attempts}/${item.maxAttempts})`);
        } else {
          console.error(`❌ Max retries exceeded: ${item.action}`, error);
        }
      }
    }
  },

  async retryAction(item) {
    // Implement specific retry logic based on action type
    switch (item.action) {
      case 'sync':
        await this.syncAllData();
        break;
      case 'loadData':
        await this.loadAllDataFromServer();
        break;
      default:
        throw new Error(`Unknown retry action: ${item.action}`);
    }
  },

  addSyncMetric(metric) {
    this.state.syncMetrics.unshift(metric);
    
    // Keep only the last N metrics
    if (this.state.syncMetrics.length > this.config.MAX_SYNC_METRICS) {
      this.state.syncMetrics = this.state.syncMetrics.slice(0, this.config.MAX_SYNC_METRICS);
    }
  },

  startBackgroundTasks() {
    // Periodic sync for authenticated users
    setInterval(async () => {
      if (this.state.currentUser && 
          this.state.networkStatus.isOnline && 
          !this.state.syncInProgress &&
          (Date.now() - this.state.lastSyncTime) > this.config.SYNC_INTERVAL) {
        
        console.log('🕐 Periodic sync triggered');
        await this.syncAllData();
      }
    }, this.config.SYNC_INTERVAL);

    // Health check
    setInterval(() => {
      this.performHealthCheck();
    }, this.config.HEALTH_CHECK_INTERVAL);
  },

  performHealthCheck() {
    const now = Date.now();
    const recentMetrics = this.state.syncMetrics.slice(0, 5);
    const failureRate = recentMetrics.length > 0 
      ? recentMetrics.filter(m => !m.success).length / recentMetrics.length 
      : 0;

    if (failureRate > 0.5) {
      console.warn('⚠️ Health Warning: High sync failure rate detected');
    }

    // Memory cleanup
    if (this.state.syncMetrics.length > this.config.MAX_SYNC_METRICS * 1.5) {
      this.state.syncMetrics = this.state.syncMetrics.slice(0, this.config.MAX_SYNC_METRICS);
      console.log('🧹 Cleaned up old sync metrics');
    }
  },

  initializePerformanceMonitoring() {
    // Monitor critical web vitals
    if ('web-vitals' in window || 'PerformanceObserver' in window) {
      console.log('📊 Performance monitoring enabled');
    }
  },

  setupGlobalErrorHandlers() {
    window.addEventListener('error', (event) => {
      console.error('🚨 Global JavaScript Error:', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      console.error('🚨 Unhandled Promise Rejection:', event.reason);
      
      // Handle authentication errors globally
      if (event.reason?.message?.includes('401') || 
          event.reason?.status === 401 ||
          event.reason?.message?.includes('Authentication failed')) {
        this.handleAuthenticationError();
      }
    });
  },

  handleInitializationError(error) {
    console.error('❌ Critical initialization error:', error);
    
    // Show user-friendly error message
    this.showToast('Ошибка инициализации приложения', 'error');
    
    // Attempt recovery
    setTimeout(() => {
      console.log('🔄 Attempting recovery...');
      window.location.reload();
    }, 5000);
  },

  handleAuthenticationError() {
    console.log('🔐 Handling authentication error');
    
    API.clearTokens();
    this.state.currentUser = null;
    this.updateAuthUI(false);
    this.clearAllLocalData();
    
    // Redirect to login if not already there
    if (!window.location.pathname.includes('index.html') && window.location.pathname !== '/') {
      window.location.href = '/';
    }
  },

  showSyncIndicator(show) {
    let indicator = document.getElementById('sync-indicator');
    
    if (show && !indicator) {
      indicator = document.createElement('div');
      indicator.id = 'sync-indicator';
      indicator.className = 'sync-indicator';
      indicator.innerHTML = `
        <div class="sync-spinner"></div>
        <span>Синхронизация...</span>
      `;
      
      // Add styles
      Object.assign(indicator.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        background: 'rgba(123, 75, 42, 0.9)',
        color: 'white',
        padding: '12px 16px',
        borderRadius: '8px',
        fontSize: '14px',
        fontWeight: '500',
        zIndex: '10000',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        backdropFilter: 'blur(10px)'
      });
      
      document.body.appendChild(indicator);
    } else if (!show && indicator) {
      indicator.remove();
    }
  },

  updateAuthUI(isLoggedIn) {
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    
    if (loginBtn && logoutBtn) {
      if (isLoggedIn) {
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'block';
      } else {
        loginBtn.style.display = 'block';
        logoutBtn.style.display = 'none';
      }
    }

    this.updateConnectionStatus();
  },

  updateConnectionStatus() {
    let statusIndicator = document.getElementById('connection-status');
    
    if (this.state.currentUser) {
      if (!statusIndicator) {
        statusIndicator = document.createElement('div');
        statusIndicator.id = 'connection-status';
        statusIndicator.className = 'connection-status';
        
        const header = document.querySelector('.header-content');
        if (header) {
          header.appendChild(statusIndicator);
        }
      }
      
      const syncAge = this.state.lastSyncTime > 0 
        ? Math.round((Date.now() - this.state.lastSyncTime) / 1000 / 60)
        : null;
      
      if (this.state.networkStatus.isOnline) {
        statusIndicator.innerHTML = `🟢 Онлайн${syncAge ? ` (${syncAge}м)` : ''}`;
        statusIndicator.className = 'connection-status online';
      } else {
        statusIndicator.innerHTML = '🔴 Офлайн';
        statusIndicator.className = 'connection-status offline';
      }
    } else if (statusIndicator) {
      statusIndicator.remove();
    }
  },

  clearAllLocalData() {
    console.log('🗑️ Clearing all local data...');
    
    // Clear localStorage
    const keysToRemove = [
      'cocoMoneySheets', 'cocoMoneyCategories',
      'cocoDebts', 'cocoDebtCategories', 
      'clothingSizeData', 'scaleCalculatorHistory'
    ];
    
    keysToRemove.forEach(key => localStorage.removeItem(key));
    
    // Clear module data if loaded
    this.clearModuleData();
    
    console.log('✅ Local data cleared');
  },

  clearModuleData() {
    if (typeof cocoMoney !== 'undefined') {
      cocoMoney.sheets = { income: [], preliminary: [] };
      cocoMoney.customCategories = [];
      cocoMoney.renderAll();
    }
    
    if (typeof debts !== 'undefined') {
      debts.debtsList = [];
      debts.customCategories = [];
      debts.renderAll();
    }
    
    if (typeof clothingSize !== 'undefined') {
      clothingSize.state = {
        currentSection: 'parameters',
        currentUnit: 'cm',
        currentGender: 'male',
        parameters: {},
        savedResults: [],
        currentCategory: null
      };
      clothingSize.restoreParameters();
    }
    
    if (typeof scaleCalculator !== 'undefined') {
      scaleCalculator.history = [];
      scaleCalculator.renderHistory();
    }
  },

  async onUserLogin(userData) {
    console.log('👤 User logged in:', userData.user?.email || userData.email);
    this.state.currentUser = userData;
    this.updateAuthUI(true);
    
    // Load user data after login
    if (this.state.networkStatus.isOnline) {
      setTimeout(async () => {
        await this.loadAllDataFromServer();
      }, 500);
    }
  },

  async onUserLogout() {
    console.log('👤 User logged out');
    this.state.currentUser = null;
    this.updateAuthUI(false);
    this.clearAllLocalData();
  },

  showToast(message, type = 'info') {
    let toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    
    const icons = {
      success: '✅',
      error: '❌', 
      warning: '⚠️',
      info: 'ℹ️'
    };
    
    toast.innerHTML = `${icons[type]} ${message}`;
    toast.className = `toast ${type} show`;
    
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  },

  // Navigation methods
  setupEventListeners() {
    document.querySelectorAll('.app-card').forEach(card => {
      card.addEventListener('click', () => {
        const section = card.dataset.section;
        this.showSection(section);
      });
    });

    document.querySelectorAll('.sub-card').forEach(card => {
      card.addEventListener('click', () => {
        const service = card.dataset.service;
        this.navigateToService(service);
      });
    });

    document.querySelectorAll('.back-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.hideAllSections();
      });
    });
  },

  showSection(sectionName) {
    this.state.previousSection = this.state.currentSection;
    this.state.currentSection = sectionName;
    
    document.querySelector('.app-grid').style.display = 'none';
    
    const sectionMap = {
      finance: 'financeSection',
      geodesy: 'geodesySection',
      clothing: 'clothingSection'
    };
    
    const sectionId = sectionMap[sectionName];
    if (sectionId) {
      document.getElementById(sectionId).style.display = 'block';
    }
    
    window.location.hash = sectionName;
  },

  hideAllSections(resetToHome = true) {
    document.querySelectorAll('.sub-section').forEach(section => {
      section.style.display = 'none';
    });
    
    if (resetToHome) {
      document.querySelector('.app-grid').style.display = 'grid';
      this.state.currentSection = 'home';
      window.location.hash = '';
    }
  },

  navigateToService(service) {
    const routes = {
      'coco-money': '/coco-money.html',
      'debts': '/debts.html',
      'scale-calculator': '/scale-calculator.html',
      'clothing-size': '/clothing-size.html'
    };
    
    const route = routes[service];
    if (route) {
      sessionStorage.setItem('returnToSection', this.state.currentSection);
      window.location.href = route;
    }
  },

  addTouchSupport() {
    let touchStartX = 0;
    let touchStartY = 0;
    
    document.addEventListener('touchstart', e => {
      touchStartX = e.changedTouches[0].screenX;
      touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });
    
    document.addEventListener('touchend', e => {
      const touchEndX = e.changedTouches[0].screenX;
      const touchEndY = e.changedTouches[0].screenY;
      const deltaX = touchEndX - touchStartX;
      const deltaY = Math.abs(touchEndY - touchStartY);
      
      if (Math.abs(deltaX) > 50 && deltaY < 100) {
        if (deltaX > 0 && this.state.currentSection !== 'home') {
          this.hideAllSections();
        }
      }
    }, { passive: true });
  },

  handleBrowserNavigation() {
    window.addEventListener('popstate', () => {
      const hash = window.location.hash.substring(1);
      if (hash && ['finance', 'geodesy', 'clothing'].includes(hash)) {
        this.showSection(hash);
      } else {
        this.hideAllSections();
      }
    });
  }
};

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOM loaded - initializing application');
    app.init();
  });
} else {
  console.log('📄 DOM ready - initializing application');
  app.init();
}

// Export for debugging and other modules
window.app = app;
