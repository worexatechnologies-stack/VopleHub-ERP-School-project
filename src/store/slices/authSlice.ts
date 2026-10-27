import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

import {
  AuthUser,
  getStoredAuthenticatedUser,
} from '../../utils/auth';
import { loginWithApi } from '../../services/api';

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isRestoringSession: boolean;
  status: 'idle' | 'loading' | 'succeeded' | 'failed';
  error: string | null;
}

const initialUser = typeof window !== 'undefined' ? getStoredAuthenticatedUser() : null;

const initialState: AuthState = {
  user: initialUser,
  isAuthenticated: Boolean(initialUser),
  // Starts true on browser boot / reload; resolves once /auth/me/ completes
  isRestoringSession: true,
  status: 'idle',
  error: null,
};

export const login = createAsyncThunk(
  'auth/login',
  async ({ email, password }: { email: string; password: string }) => {
    return await loginWithApi(email, password);
  }
);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials: (
      state,
      action: PayloadAction<{ user: AuthUser; sessionId?: string; csrfToken?: string; access?: string; refresh?: string }>
    ) => {
      state.user = action.payload.user;
      state.isAuthenticated = true;
      state.isRestoringSession = false;
      state.status = 'succeeded';
      state.error = null;
    },
    setUser: (state, action: PayloadAction<AuthUser>) => {
      state.user = action.payload;
      state.isAuthenticated = true;
      state.isRestoringSession = false;
    },
    setAccessToken: (_state, _action: PayloadAction<string>) => {
      // Deprecated: browser authentication uses Django's HttpOnly session cookie.
    },
    finishSessionRestore: (state) => {
      state.isRestoringSession = false;
    },
    logout: (state) => {
      state.user = null;
      state.isAuthenticated = false;
      state.isRestoringSession = false;
      state.status = 'idle';
      state.error = null;
    },
    authError: (state, action: PayloadAction<string>) => {
      state.status = 'failed';
      state.error = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(login.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(login.fulfilled, (state, action) => {
        state.user = action.payload.user;
        state.isAuthenticated = true;
        state.isRestoringSession = false;
        state.status = 'succeeded';
        state.error = null;
      })
      .addCase(login.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.error?.message || 'Sign-in failed.';
      });
  },
});

export const {
  setCredentials,
  setUser,
  setAccessToken,
  finishSessionRestore,
  logout,
  authError,
} = authSlice.actions;

export default authSlice.reducer;
