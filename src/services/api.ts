import type { UserRole } from '../types';
import type { AuthUser } from '../utils/auth';
import {
  ACCESS_TOKEN_STORAGE_KEY,
  AUTH_SESSION_EXPIRED_EVENT,
  REFRESH_TOKEN_STORAGE_KEY,
} from '../utils/auth';

// Same-origin avoids HTTPS mixed-content failures and keeps authentication behind Caddy.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');

const roleMap: Record<string, UserRole> = {
  super_admin: 'Super Admin',
  school_admin: 'School Admin',
  teacher: 'Teacher',
  parent: 'Parent',
  student: 'Student',
  public_learner: 'Public Learner',
};

export async function loginWithApi(email: string, password: string): Promise<{ user: AuthUser; access: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/login/`, {
      method: 'POST',
      // Send the HttpOnly refresh-token cookie automatically.
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      // Login IDs are generated lowercase. Normalising pasted whitespace/case here
      // prevents a correct generated login ID from being rejected by an exact DB lookup.
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    });
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid login ID or password. Check that you selected the matching role tab.');
      }
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('Retry-After'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0
          ? ` Please wait ${Math.ceil(retryAfter)} seconds and try again.`
          : ' Please wait one minute and try again.';
        throw new Error(`Too many sign-in attempts.${wait}`);
      }
      throw new Error(`Sign-in is temporarily unavailable (HTTP ${response.status}). Please try again.`);
    }

    const data = await response.json();
    const role = roleMap[data.user?.role];
    if (!role || !data.access) {
      throw new Error('The sign-in service returned an incomplete session. Please try again.');
    }

    return {
      access: data.access,
      user: {
        email: data.user.email,
        name: data.user.name || data.user.email,
        role,
        schoolId: data.user.schoolId || undefined,
        schoolName: data.user.schoolName || undefined,
        studentId: data.user.studentId || undefined,
        parentStudentIds: Array.isArray(data.user.parentStudentIds) ? data.user.parentStudentIds : [],
        permissions: Array.isArray(data.user.permissions) ? data.user.permissions : [],
        mustChangePassword: Boolean(data.user.mustChangePassword),
      },
    };
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error('Unable to reach the sign-in service. Please check your connection and try again.');
  }
}

export async function getCurrentUser(): Promise<AuthUser> {
  const data = await apiRequest<{ email: string; name: string; role: string; schoolId?: string; schoolName?: string; studentId?: string; parentStudentIds?: string[]; permissions?: string[]; mustChangePassword?: boolean }>('/auth/me/');
  const role = roleMap[data.role];
  if (!role) throw new Error('The account has an unsupported role.');
  return {
    email: data.email,
    name: data.name || data.email,
    role,
    schoolId: data.schoolId,
    schoolName: data.schoolName,
    studentId: data.studentId,
    parentStudentIds: Array.isArray(data.parentStudentIds) ? data.parentStudentIds : [],
    permissions: Array.isArray(data.permissions) ? data.permissions : [],
    mustChangePassword: Boolean(data.mustChangePassword),
  };
}

export async function logoutWithApi(): Promise<void> {
  const access = localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
  const response = await fetch(`${API_BASE_URL}/auth/logout/`, {
    method: 'POST',
    // Send the HttpOnly refresh-token cookie automatically.
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
    },
  });
  if (!response.ok && response.status !== 401) {
    throw new Error(`Sign-out could not be completed (${response.status}).`);
  }
}

export { API_BASE_URL };

export interface ApiErrorBody {
  detail?: unknown;
  errors?: unknown;
  references?: unknown;
  [key: string]: unknown;
}

/**
 * HTTP error that keeps the server's structured response available to callers.
 * Screens can use fields such as `references` for actionable conflict messages
 * without parsing a JSON string out of `Error.message`.
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(status: number, message: string, body: ApiErrorBody | null = null) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.body = body;
  }
}

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      // The refresh token is sent automatically as an HttpOnly cookie.
      const response = await fetch(`${API_BASE_URL}/auth/refresh/`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) return null;
      const data = await response.json() as { access?: string };
      if (!data.access) return null;
      localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, data.access);
      return data.access;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

function normalizeApiPath(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  let cleanPath = path;
  while (cleanPath.startsWith('/api/v1/api/v1/')) {
    cleanPath = cleanPath.slice('/api/v1'.length);
  }
  if (cleanPath.startsWith(API_BASE_URL)) {
    return cleanPath;
  }
  if (cleanPath.startsWith('/api/v1')) {
    return cleanPath;
  }
  return `${API_BASE_URL}${cleanPath.startsWith('/') ? '' : '/'}${cleanPath}`;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isFormData = init.body instanceof FormData;
  const targetUrl = normalizeApiPath(path);
  const makeRequest = (token: string | null) => fetch(targetUrl, {
    ...init,
    headers: { ...(isFormData ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  });
  let response = await makeRequest(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY));
  if (response.status === 401 && !path.startsWith('/auth/refresh/')) {
    const refreshedAccessToken = await refreshAccessToken();
    if (refreshedAccessToken) response = await makeRequest(refreshedAccessToken);
  }
  if (response.status === 401) window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
  if (!response.ok) {
    let detail = '';
    let parsedBody: ApiErrorBody | null = null;
    try {
      const errorBody = await response.json() as { detail?: unknown; errors?: unknown };
      parsedBody = errorBody;
      const message = errorBody.detail ?? errorBody.errors ?? errorBody;
      if (typeof message === 'string') detail = `: ${message}`;
      else if (message) detail = `: ${JSON.stringify(message)}`;
    } catch {
      // Preserve the HTTP status when an upstream response is not JSON.
    }
    throw new ApiRequestError(response.status, `API request failed (${response.status})${detail}.`, parsedBody);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/** Download a protected binary API response while preserving JWT refresh behavior. */
export async function apiDownload(path: string): Promise<{ blob: Blob; filename: string; contentType: string }> {
  const targetUrl = normalizeApiPath(path);
  const makeRequest = (token: string | null) => fetch(targetUrl, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  let response = await makeRequest(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY));
  if (response.status === 401) {
    const refreshedAccessToken = await refreshAccessToken();
    if (refreshedAccessToken) response = await makeRequest(refreshedAccessToken);
  }
  if (response.status === 401) window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
  if (!response.ok) throw new Error(`Document download failed (${response.status}).`);
  const header = response.headers.get('Content-Disposition') || '';
  const contentType = response.headers.get('Content-Type') || '';

  // Extract filename safely handling RFC 5987 / 6266 utf-8 encoded filenames and standard quotes
  let filename = '';
  const utf8Match = /filename\*=utf-8''([^;]+)/i.exec(header);
  if (utf8Match && utf8Match[1]) {
    try {
      filename = decodeURIComponent(utf8Match[1].trim());
    } catch {
      filename = utf8Match[1].trim();
    }
  }
  if (!filename) {
    const match = /filename="?([^";]+)"?/i.exec(header);
    if (match && match[1]) {
      filename = match[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  if (!filename) {
    filename = 'document';
  }

  const rawBlob = await response.blob();
  const blob = new Blob([rawBlob], { type: contentType || rawBlob.type || 'application/octet-stream' });
  return { blob, filename, contentType };
}
