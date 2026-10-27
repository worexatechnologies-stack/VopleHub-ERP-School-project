import {
  createApi,
  fetchBaseQuery,
  BaseQueryFn,
  FetchArgs,
  FetchBaseQueryError,
} from '@reduxjs/toolkit/query/react';

import type { RootState } from '../index';
import { logout } from '../slices/authSlice';
import {
  AUTH_SESSION_EXPIRED_EVENT,
  getCsrfToken,
  storeAuthenticatedUser,
} from '../../utils/auth';
import type { AuthUser } from '../../utils/auth';
import { broadcastSyncEvent } from '../../utils/syncBus';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');

/**
 * Django session query:
 * 1. Automatically includes the HttpOnly server-side session cookie.
 * 2. Injects X-CSRFToken header on all mutating HTTP requests (POST, PUT, PATCH, DELETE).
 * 3. Injects X-Client-Type: web and X-Auth-Mode: session headers.
 * 4. Injects tenant boundary (X-School-Id) header.
 * 5. Handles session expiration gracefully without infinite retry loops.
 */
const rawBaseQuery = fetchBaseQuery({
  baseUrl: API_BASE_URL,
  credentials: 'include',
  prepareHeaders: (headers, { getState, endpoint }) => {
    headers.set('X-Client-Type', 'web');
    headers.set('X-Auth-Mode', 'session');

    const csrf = getCsrfToken();
    if (csrf) {
      headers.set('X-CSRFToken', csrf);
    }

    const currentSchoolId = (getState() as RootState).auth?.user?.schoolId;
    if (currentSchoolId) {
      headers.set('X-School-Id', String(currentSchoolId));
    }

    return headers;
  },
});

const baseQueryWithAuth: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  const requestUrl = typeof args === 'string' ? args : args.url;
  const method = (typeof args === 'object' && args.method ? args.method : 'GET').toUpperCase();
  const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  // If making an unsafe request and CSRF token cookie is not yet populated, fetch it first
  if (isMutating && !getCsrfToken() && !requestUrl.startsWith('/auth/csrf/')) {
    try {
      await fetch(`${API_BASE_URL}/auth/csrf/`, { method: 'GET', credentials: 'include' });
    } catch {}
  }

  const result = await rawBaseQuery(args, api, extraOptions);

  const isPublicOrAuthEndpoint =
    requestUrl.startsWith('/auth/login/') ||
    requestUrl.startsWith('/auth/verify-otp/') ||
    requestUrl.startsWith('/auth/resend-otp/') ||
    requestUrl.startsWith('/auth/csrf/') ||
    requestUrl.startsWith('/auth/refresh/') ||
    requestUrl.startsWith('/enrollment/');

  // Django may report an unauthenticated session as either 401 or 403
  // (depending on the authentication class). Only treat the explicit
  // authentication failure as session expiry; ordinary role-based 403s must
  // remain visible to the calling screen.
  const errorBody = result.error?.data as { detail?: string } | undefined;
  const unauthenticated403 = result.error?.status === 403 &&
    errorBody?.detail === 'Authentication credentials were not provided.';
  if ((result.error?.status === 401 || unauthenticated403) && !isPublicOrAuthEndpoint) {
    api.dispatch(logout());
    window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
  }

  if (isMutating && !result.error) {
    if (requestUrl.includes('/students')) {
      broadcastSyncEvent('STUDENT_MUTATED');
    } else if (requestUrl.includes('/schools')) {
      broadcastSyncEvent('SCHOOL_MUTATED');
    } else if (requestUrl.includes('/teachers')) {
      broadcastSyncEvent('TEACHER_MUTATED');
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
    'SchoolCounts',
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
    'StoreProduct',
    'StoreOrder',
    'StorePaymentSettings',
  ],
  endpoints: () => ({}),
});

/**
 * Cache the user profile for display while Django validates the session on boot.
 * This profile is never proof of authentication.
 */
export function persistAuthSession(
  _access: string,
  user: AuthUser,
  _refresh?: string,
  _sessionId?: string,
): void {
  storeAuthenticatedUser(user);
}

export { API_BASE_URL };
