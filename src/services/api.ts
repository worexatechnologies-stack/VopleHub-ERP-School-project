import type { UserRole } from '../types';
import type { AuthUser } from '../utils/auth';
import {
  AUTH_SESSION_EXPIRED_EVENT,
  getCsrfToken,
} from '../utils/auth';

// Same-origin avoids HTTPS mixed-content failures and keeps authentication behind Caddy/Nginx.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');

const roleMap: Record<string, UserRole> = {
  super_admin: 'Super Admin',
  school_admin: 'School Admin',
  teacher: 'Teacher',
  parent: 'Parent',
  student: 'Student',
  public_learner: 'Public Learner',
};

export async function fetchCsrfToken(): Promise<string> {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/csrf/`, {
      method: 'GET',
      credentials: 'include',
    });
    if (response.ok) {
      const data = await response.json();
      return data.csrfToken || getCsrfToken();
    }
  } catch {}
  return getCsrfToken();
}

export async function loginWithApi(
  email: string,
  password: string,
  role?: string,
): Promise<{ user: AuthUser; mfaRequired?: boolean; mfaToken?: string; devOtp?: string }> {
  try {
    let csrf = getCsrfToken();
    if (!csrf) {
      csrf = await fetchCsrfToken();
    }

    const response = await fetch(`${API_BASE_URL}/auth/login/`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Type': 'web',
        'X-Auth-Mode': 'session',
        ...(csrf ? { 'X-CSRFToken': csrf } : {}),
      },
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        password,
        role,
        client_type: 'web',
        auth_mode: 'session',
      }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid login ID or password. Check that you selected the matching role tab.');
      }
      if (response.status === 403) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Access forbidden. Please check your role selection.');
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

    if (data.mfa_required) {
      return {
        user: {} as any,
        mfaRequired: true,
        mfaToken: data.mfa_token,
        devOtp: data.dev_otp,
      };
    }

    const resolvedRole = roleMap[data.user?.role];
    if (!resolvedRole) {
      throw new Error('The sign-in service returned an incomplete session. Please try again.');
    }

    return {
      user: {
        email: data.user.email,
        name: data.user.name || data.user.email,
        role: resolvedRole,
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
  const data = await apiRequest<{
    email: string;
    name: string;
    role: string;
    schoolId?: string;
    schoolName?: string;
    studentId?: string;
    parentStudentIds?: string[];
    permissions?: string[];
    mustChangePassword?: boolean;
  }>('/auth/me/');

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
  const csrf = getCsrfToken();
  const response = await fetch(`${API_BASE_URL}/auth/logout/`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Type': 'web',
      'X-Auth-Mode': 'session',
      ...(csrf ? { 'X-CSRFToken': csrf } : {}),
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
  const method = (init.method || 'GET').toUpperCase();
  const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  let csrf = isMutating ? getCsrfToken() : '';
  if (isMutating && !csrf) {
    csrf = await fetchCsrfToken();
  }

  const response = await fetch(targetUrl, {
    ...init,
    credentials: 'include',
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      'X-Client-Type': 'web',
      'X-Auth-Mode': 'session',
      ...(csrf ? { 'X-CSRFToken': csrf } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    let detail = '';
    let parsedBody: ApiErrorBody | null = null;
    try {
      const errorBody = (await response.json()) as { detail?: unknown; errors?: unknown };
      parsedBody = errorBody;
      const message = errorBody.detail ?? errorBody.errors ?? errorBody;
      if (typeof message === 'string') detail = `: ${message}`;
      else if (message) detail = `: ${JSON.stringify(message)}`;
    } catch {
      // Preserve the HTTP status when an upstream response is not JSON.
    }
    const unauthenticated = response.status === 401 ||
      (response.status === 403 && parsedBody?.detail === 'Authentication credentials were not provided.');
    if (unauthenticated && !path.startsWith('/auth/login/') && !path.startsWith('/auth/verify-otp/')) {
      window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
    }
    throw new ApiRequestError(response.status, `API request failed (${response.status})${detail}.`, parsedBody);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/** Download a protected binary API response via session credentials. */
export async function apiDownload(path: string): Promise<{ blob: Blob; filename: string; contentType: string }> {
  const targetUrl = normalizeApiPath(path);
  const response = await fetch(targetUrl, {
    credentials: 'include',
    headers: {
      'X-Client-Type': 'web',
      'X-Auth-Mode': 'session',
    },
  });

  let unauthenticated = response.status === 401;
  if (response.status === 403) {
    const errorBody = await response.clone().json().catch(() => ({})) as { detail?: string };
    unauthenticated = errorBody.detail === 'Authentication credentials were not provided.';
  }
  if (unauthenticated) {
    window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
    throw new Error(`Download failed: session expired (${response.status}).`);
  }

  if (!response.ok) throw new Error(`Document download failed (${response.status}).`);

  const header = response.headers.get('Content-Disposition') || '';
  const match = header.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
  const filename = match ? decodeURIComponent(match[1]) : 'downloaded-file';
  const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
  const blob = await response.blob();
  return { blob, filename, contentType };
}
