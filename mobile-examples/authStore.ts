/**
 * Authentication Store Example
 * 
 * Example implementation using Zustand for state management.
 * Shows how to handle the email/password authentication flow.
 * 
 * Install dependencies:
 * npm install zustand expo-secure-store
 */

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://your-api.com';

interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
  status: 'pending' | 'active' | 'suspended';
  onboarding_done: boolean;
  member_no: string | null;
  is_new_user: boolean;
}

interface AuthState {
  // State
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  
  // Actions
  setAuth: (data: { user: User; accessToken: string }) => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<boolean>;
  loadStoredAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  // Initial state
  user: null,
  accessToken: null,
  isAuthenticated: false,
  isLoading: false,

  /**
   * Set authentication data after successful login
   */
  setAuth: ({ user, accessToken }) => {
    set({ 
      user, 
      accessToken, 
      isAuthenticated: true,
      isLoading: false,
    });
  },

  /**
   * Login with email and password
   * Called from the login screen
   */
  login: async (email: string, password: string) => {
    set({ isLoading: true });

    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Login failed');
      }

      // Store tokens securely
      await SecureStore.setItemAsync('access_token', data.access_token);
      await SecureStore.setItemAsync('refresh_token', data.refresh_token);

      // Update state
      set({
        user: data.user,
        accessToken: data.access_token,
        isAuthenticated: true,
        isLoading: false,
      });

    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  /**
   * Logout user
   * Clears tokens and state
   */
  logout: async () => {
    try {
      const { accessToken } = get();
      
      // Call backend logout if authenticated
      if (accessToken) {
        await fetch(`${API_URL}/auth/logout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        });
      }

      // Clear stored tokens
      await SecureStore.deleteItemAsync('access_token');
      await SecureStore.deleteItemAsync('refresh_token');

      // Clear state
      set({
        user: null,
        accessToken: null,
        isAuthenticated: false,
      });
    } catch (error) {
      console.error('Logout error:', error);
      // Still clear local state even if backend call fails
      set({
        user: null,
        accessToken: null,
        isAuthenticated: false,
      });
    }
  },

  /**
   * Refresh access token using refresh token
   * Called when access token expires
   */
  refreshToken: async (): Promise<boolean> => {
    try {
      const refreshToken = await SecureStore.getItemAsync('refresh_token');
      
      if (!refreshToken) {
        return false;
      }

      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (!response.ok) {
        // Refresh failed, logout user
        await get().logout();
        return false;
      }

      const data = await response.json();

      // Store new tokens
      await SecureStore.setItemAsync('access_token', data.access_token);
      await SecureStore.setItemAsync('refresh_token', data.refresh_token);

      // Update state
      set({ accessToken: data.access_token });

      return true;
    } catch (error) {
      console.error('Token refresh error:', error);
      return false;
    }
  },

  /**
   * Load stored authentication on app start
   * Call this in your app initialization
   */
  loadStoredAuth: async () => {
    try {
      const accessToken = await SecureStore.getItemAsync('access_token');
      
      if (!accessToken) {
        set({ isLoading: false });
        return;
      }

      // Verify token is valid by fetching user profile
      const response = await fetch(`${API_URL}/members/me`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        // Token invalid, try to refresh
        const refreshed = await get().refreshToken();
        if (!refreshed) {
          set({ isLoading: false });
          return;
        }
      }

      const userData = await response.json();

      set({
        user: userData,
        accessToken,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error) {
      console.error('Load stored auth error:', error);
      set({ isLoading: false });
    }
  },
}));
