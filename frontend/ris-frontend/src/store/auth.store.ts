import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiClient } from '../lib/axios';
import { queryClient } from '../lib/query-client';
import type {
  AuthUser,
  LoginCredentials,
  LoginResponse,
  RefreshResponse,
  ChangePasswordRequest,
} from '../types/auth.types';

// ── State shape ──────────────────────────────────────────────────────────────

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  role: AuthUser['role'] | null;
}

interface AuthActions {
  /** Authenticate with email + password. Throws on failure. */
  login: (credentials: LoginCredentials) => Promise<void>;
  /** Revoke session, clear tokens, clear React Query cache. */
  logout: () => Promise<void>;
  /** Exchange the stored refresh token for a new access token. */
  refreshTokens: () => Promise<void>;
  /** Update the stored user profile (e.g. after profile edit). */
  setUser: (user: AuthUser) => void;
  /** Store access token in memory (called after 2FA or refresh). */
  setTokens: (accessToken: string) => void;
  /** Change the authenticated user's password. */
  changePassword: (payload: ChangePasswordRequest) => Promise<void>;
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useAuthStore = create<AuthState & AuthActions>()(
  persist(
    (set) => ({
      // ── Initial state ──────────────────────────────────────
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,
      role: null,

      // ── Actions ────────────────────────────────────────────
      login: async (credentials) => {
        set({ isLoading: true });
        try {
          const { data } = await apiClient.post<LoginResponse>(
            '/auth/login',
            credentials,
          );
          set({
            accessToken: data.accessToken,
            user: data.user,
            isAuthenticated: true,
            role: data.user.role,
            isLoading: false,
          });
        } catch (err) {
          set({ isLoading: false });
          throw err;
        }
      },

      logout: async () => {
        try {
          await apiClient.post('/auth/logout');
        } catch {
          // Ignore server errors — always clear client state
        } finally {
          queryClient.clear();
          set({
            user: null,
            accessToken: null,
            isAuthenticated: false,
            role: null,
          });
        }
      },

      refreshTokens: async () => {
        const { data } = await apiClient.post<RefreshResponse>(
          '/auth/refresh',
        );
        set({ accessToken: data.accessToken });
      },

      setUser: (user) => set({ user, role: user.role }),

      setTokens: (accessToken) =>
        set({ accessToken }),

      changePassword: async (payload) => {
        await apiClient.post('/auth/change-password', payload);
      },
    }),
    {
      name: 'ris-auth',
      // Tokens are memory-only, so auth state cannot survive a reload either —
      // otherwise the app rehydrates as "logged in" with no token and every
      // request 401s as "token expired". Persist nothing; reload → login page.
      partialize: () => ({}),
      // One-time wipe of any legacy persisted auth from earlier builds.
      onRehydrateStorage: () => () => {
        try { localStorage.removeItem('ris-auth'); } catch { /* noop */ }
      },
    },
  ),
);
