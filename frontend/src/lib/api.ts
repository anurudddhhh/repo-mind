import axios from 'axios';
import { useAuthStore } from '@/store/useAuthStore';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor to inject the JWT token into every request
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

// Interceptor to handle 401 Unauthorized (e.g., token expired)
api.interceptors.response.use((response) => response, (error) => {
  if (error.response?.status === 401) {
    // Force logout on 401
    useAuthStore.getState().logout();
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  }
  return Promise.reject(error);
});
