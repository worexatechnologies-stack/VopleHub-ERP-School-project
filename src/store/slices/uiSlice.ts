import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

interface ToastState {
  id: string;
  title: string;
  message: string;
  tone: 'success' | 'error' | 'info' | 'warning';
}

interface UiState {
  activeTab: string;
  toasts: ToastState[];
  credentialSlip: {
    title: string;
    lines: string[];
  } | null;
}

const initialState: UiState = {
  activeTab: 'dashboard',
  toasts: [],
  credentialSlip: null,
};

let toastCounter = 0;

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setActiveTab: (state, action: PayloadAction<string>) => {
      state.activeTab = action.payload;
    },
    showToast: (state, action: PayloadAction<Omit<ToastState, 'id'>>) => {
      toastCounter += 1;
      state.toasts.push({ id: `toast-${toastCounter}-${Date.now()}`, ...action.payload });
    },
    dismissToast: (state, action: PayloadAction<string>) => {
      state.toasts = state.toasts.filter((toast) => toast.id !== action.payload);
    },
    setCredentialSlip: (
      state,
      action: PayloadAction<{ title: string; lines: string[] } | null>
    ) => {
      state.credentialSlip = action.payload;
    },
  },
});

export const { setActiveTab, showToast, dismissToast, setCredentialSlip } = uiSlice.actions;

export default uiSlice.reducer;