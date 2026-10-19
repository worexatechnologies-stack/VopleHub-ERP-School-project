import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { Mutex } from 'async-mutex';

import type { RootState } from '../index';
import { logout, setAccessToken } from '../slices/authSlice';
import {
  ACCESS_TOKEN_STORAGE_KEY,
  AUTH_SESSION_EXPIRED_EVENT,
  REFRESH_TOKEN_STORAGE_KEY,
} from '../../utils/auth';
import {
  clearAuthenticatedSession,
  storeAuthenticatedUser,
} from '../../utils/auth';
import type { AuthUser } from '../../utils/auth';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');

const mutex = new Mutex();

interface TokenResponse {
  access?: string;
  refresh?: string;
  user?: AuthUser & { role: string };
}

/**
 * fetchBaseQuery wrapper that:
 * 1. Reads the bearer token directly from the Redux auth slice (falls back to
 *    localStorage for warm first render when the store has not hydrated yet).
 * 2. On HTTP 401, attempts a single refresh-token exchange with a shared mutex.
 * 3. On refresh failure, dispatches logout and broadcasts the session-expired
 *    event so the app can redirect to login.
 */
const baseQueryWithAuth: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  const getState = api.getState as () => RootState;
  const state = getState();
  const storedAccess = localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);

  // Prefer the live store token; fall back to localStorage for the initial
  // render before the auth slice has been populated.
  const accessToken = state.auth?.accessToken || storedAccess;

  // Login and refresh authenticate with credentials (email/password) or the
  // HttpOnly refresh cookie — NEVER with a bearer token. If a stale/expired
  // access token is still present in localStorage/Redux, attaching it here
  // makes SimpleJWT reject the whole request with 401 token_not_valid before
  // the login view even runs, which blocks every sign-in attempt.
  const requestUrl = typeof args === 'string' ? args : args.url;
  const isCredentialAuth = requestUrl.startsWith('/auth/login/') || requestUrl.startsWith('/auth/refresh/');
  const isPublicEndpoint =
    isCredentialAuth ||
    requestUrl.startsWith('/enrollment/verify/') ||
    requestUrl.startsWith('/enrollment/submit/');

  // Protected endpoints require an access token. If no token is available,
  // do not issue a doomed network request that will fail with 401 in the console.
  if (!accessToken && !isPublicEndpoint) {
    return {
      error: {
        status: 401,
        data: { detail: 'Authentication credentials were not provided.' },
      },
    };
  }

  const rawBaseQuery = fetchBaseQuery({
    baseUrl: API_BASE_URL,
    // Send cookies (HttpOnly refresh token) on same-origin requests.
    credentials: 'include',
    prepareHeaders: (headers) => {
      // Always look up current access token dynamically so retried requests after refresh
      // send the new access token instead of closed-over stale tokens.
      const currentToken =
        ((api.getState as () => RootState)().auth?.accessToken) ||
        localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
      if (currentToken && !isPublicEndpoint) {
        headers.set('Authorization', `Bearer ${currentToken}`);
      }
      // Include the tenant context explicitly for deeper defense in depth.
      // The backend additionally enforces tenant isolation via PostgreSQL RLS.
      const currentSchoolId = (api.getState as () => RootState)().auth?.user?.schoolId;
      if (currentSchoolId) {
        headers.set('X-School-Id', String(currentSchoolId));
      }
      // If the request body is FormData, do not set application/json so the browser
      // can automatically inject the multipart/form-data boundary.
      const isFormData =
        typeof args === 'object' &&
        args !== null &&
        'body' in args &&
        (args.body instanceof FormData || (Boolean(args.body) && typeof (args.body as any).append === 'function'));
      if (!isFormData) {
        headers.set('Content-Type', 'application/json');
      } else {
        headers.delete('Content-Type');
      }
      return headers;
    },
  });

  let result = await rawBaseQuery(args, api, extraOptions);

  // Endpoints that should not trigger auto-refresh on 401:
  // Login, refresh itself, logout, and public enrollment pages.
  // Endpoints like /auth/change-password/ and /auth/me/ ARE protected and MUST refresh if expired!
  const isExcludedFromRefresh =
    requestUrl.startsWith('/auth/login/') ||
    requestUrl.startsWith('/auth/refresh/') ||
    requestUrl.startsWith('/auth/logout/') ||
    requestUrl.startsWith('/enrollment/verify/') ||
    requestUrl.startsWith('/enrollment/submit/');

  if (result.error?.status === 401 && !isExcludedFromRefresh) {
    // Only one refresh at a time. Other requests wait on the mutex.
    if (!mutex.isLocked()) {
      const release = await mutex.acquire();
      try {
        // The refresh token is sent automatically as an HttpOnly cookie.
        // We must use `credentials: 'include'` so the browser attaches it.
        const refreshResult = await fetchBaseQuery({ baseUrl: API_BASE_URL, credentials: 'include' })({
          url: '/auth/refresh/',
          method: 'POST',
        }, api, extraOptions);

        const data = refreshResult.data as TokenResponse | undefined;
        if (refreshResult.error || !data?.access) {
          throw new Error('Token refresh failed.');
        }

        // Persist the NEW access token. The rotated refresh token is stored
        // in the HttpOnly cookie by the server; we never see or store it.
        localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, data.access);
        api.dispatch(setAccessToken(data.access));

        // Retry the originally failed request with the new token.
        result = await rawBaseQuery(args, api, extraOptions);
      } catch {
        // Refresh failed — clear the session.
        clearAuthenticatedSession();
        api.dispatch(logout());
        window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
      } finally {
        release();
      }
    } else {
      // Another request is refreshing; wait then retry once.
      await mutex.waitForUnlock();
      const updatedState = (api.getState as () => RootState)();
      const updatedToken = updatedState.auth?.accessToken || localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
      if (!updatedToken && !isCredentialAuth) {
        return {
          error: {
            status: 401,
            data: { detail: 'Session expired.' },
          },
        };
      }
      result = await rawBaseQuery(args, api, extraOptions);
    }
  }

  return result;
};

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithAuth,
  tagTypes: [
    'Auth',
    'School',
    'User',
    'Teacher',
    'Student',
    'Class',
    'Subject',
    'Section',
    'AcademicYear',
    'Attendance',
    'Exam',
    'ExamResult',
    'Notification',
    'Timetable',
    'Chat',
    'Fee',
    'Library',
    'Transport',
    'Report',
    'CommunityEvent',
    'EventRegistration',
    'CommunityPost',
    'StaffSalary',
    'CredentialVault',
    'Homework',
  ],
  endpoints: () => ({}),
});

/**
 * Persist the authenticated user to localStorage and the Redux store.
 * Used by the LoginScreen and session-restore flow.
 *
 * The refresh token is now delivered ONLY as an HttpOnly cookie by the
 * server; we never store the raw refresh token in localStorage. This
 * destroys the XSS vector that localStorage refresh-token theft creates.
 */
export function persistAuthSession(
  access: string,
  user: AuthUser,
): void {
  localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, access);
  // NOTE: We deliberately do NOT store the refresh token. The HttpOnly
  // cookie set by the server is the only thing the browser retains.
  storeAuthenticatedUser(user);
}

export { API_BASE_URL };