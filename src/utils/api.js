const API_BASE_URL = process.env.REACT_APP_API_URL || 'https://your-app.railway.app/api';

// Универсальная функция для запросов
const apiRequest = async (endpoint, options = {}) => {
  const url = `${API_BASE_URL}${endpoint}`;
  const token = localStorage.getItem('token');
  
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
    ...options,
  };

  try {
    const response = await fetch(url, config);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Ошибка сервера');
    }

    return data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
};

// Аутентификация
export const registerUser = async (userData) => {
  return apiRequest('/auth/register', {
    method: 'POST',
    body: JSON.stringify(userData),
  });
};

export const loginUser = async (credentials) => {
  return apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
};

export const getCurrentUser = async () => {
  return apiRequest('/auth/me');
};

// Инструменты
export const getTools = async (category = null, search = null) => {
  const params = new URLSearchParams();
  if (category) params.append('category', category);
  if (search) params.append('search', search);
  
  return apiRequest(`/tools?${params.toString()}`);
};

export const getTool = async (id) => {
  return apiRequest(`/tools/${id}`);
};

export const createTool = async (toolData) => {
  return apiRequest('/tools', {
    method: 'POST',
    body: JSON.stringify(toolData),
  });
};

export const updateTool = async (id, toolData) => {
  return apiRequest(`/tools/${id}`, {
    method: 'PUT',
    body: JSON.stringify(toolData),
  });
};

export const deleteTool = async (id) => {
  return apiRequest(`/tools/${id}`, {
    method: 'DELETE',
  });
};

// Категории
export const getCategories = async () => {
  return apiRequest('/categories');
};

// Финансовые калькуляторы
export const calculateLoan = async (data) => {
  return apiRequest('/finance/loan', {
    method: 'POST',
    body: JSON.stringify(data),
  });
};

export const calculateInvestment = async (data) => {
  return apiRequest('/finance/investment', {
    method: 'POST',
    body: JSON.stringify(data),
  });
};

// Геодезические расчеты
export const calculateDistance = async (data) => {
  return apiRequest('/geodesy/distance', {
    method: 'POST',
    body: JSON.stringify(data),
  });
};

export const convertCoordinates = async (data) => {
  return apiRequest('/geodesy/coordinates', {
    method: 'POST',
    body: JSON.stringify(data),
  });
};

// Статистика и аналитика
export const getToolStats = async () => {
  return apiRequest('/stats/tools');
};

export const getUserStats = async () => {
  return apiRequest('/stats/user');
};