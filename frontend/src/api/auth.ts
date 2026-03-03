// Authentication API methods

import { apiClient } from './client';
import type {
  LoginRequest,
  RegisterRequest,
  AuthResponse,
  AuthTokens,
  User,
  UserProfile,
  UserSubscriptionInfo,
  DatabaseTestResponse,
} from '@/types/api';

export const authAPI = {
  // Authentication
  async login(credentials: LoginRequest): Promise<AuthResponse> {
    return apiClient.post('/auth/login', credentials);
  },

  async register(userData: RegisterRequest): Promise<AuthResponse> {
    return apiClient.post('/auth/register', userData);
  },

  async logout(): Promise<{ message: string }> {
    return apiClient.post('/auth/logout');
  },

  async refreshToken(): Promise<{ tokens: AuthTokens }> {
    return apiClient.post('/auth/refresh');
  },

  // Current user
  async getCurrentUser(): Promise<{ user: User }> {
    return apiClient.get('/auth/me');
  },

  async updateProfile(data: {
    full_name?: string;
    current_password?: string;
    new_password?: string;
  }): Promise<{ message: string }> {
    return apiClient.put('/auth/profile', data);
  },

  async deactivateAccount(): Promise<{ message: string }> {
    return apiClient.delete('/auth/deactivate');
  },

  // Password recovery
  async requestPasswordReset(email: string): Promise<{ message: string }> {
    return apiClient.post('/auth/forgot-password', { email });
  },

  async resetPassword(token: string, new_password: string): Promise<{ message: string }> {
    return apiClient.post('/auth/reset-password', { token, new_password });
  },

  // User profile and subscription info
  async getUserProfile(): Promise<UserProfile> {
    return apiClient.get('/users/profile');
  },

  async getUserSubscription(): Promise<UserSubscriptionInfo> {
    return apiClient.get('/users/subscription');
  },

  // Test database connection (for debugging)
  async testDatabaseConnection(): Promise<DatabaseTestResponse> {
    return apiClient.get('/users/test-db');
  },
};
