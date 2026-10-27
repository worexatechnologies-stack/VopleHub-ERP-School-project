import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector, useStore } from 'react-redux';
import type { TypedUseSelectorHook } from 'react-redux';

import authReducer from './slices/authSlice';
import uiReducer from './slices/uiSlice';
import { baseApi } from './api/baseApi';
import { subscribeSyncEvents } from '../utils/syncBus';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    ui: uiReducer,
    [baseApi.reducerPath]: baseApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Allow File/FormData objects in student/teacher photo uploads.
        ignoredPaths: [
          'ui.studentForm.photoFile',
          'ui.teacherForm.photoFile',
        ],
      },
    }).concat(baseApi.middleware),
  devTools: import.meta.env.DEV,
});

// Listen for cross-tab mutations (e.g. school admin added/deleted a student in another tab)
// and immediately invalidate RTK query caches so Super Admin stays 100% synchronized live.
if (typeof window !== 'undefined') {
  subscribeSyncEvents((type) => {
    if (type === 'STUDENT_MUTATED') {
      store.dispatch(baseApi.util.invalidateTags(['Student', 'SchoolCounts']));
    } else if (type === 'SCHOOL_MUTATED') {
      store.dispatch(baseApi.util.invalidateTags(['School', 'SchoolCounts']));
    } else if (type === 'TEACHER_MUTATED') {
      store.dispatch(baseApi.util.invalidateTags(['Teacher', 'SchoolCounts']));
    }
  });
}

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
export const useAppStore = useStore;