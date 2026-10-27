import { UserRole } from '../types';

export interface AuthUser {
  id?: number | string;
  email: string;
  name: string;
  role: UserRole;
  schoolId?: string;
  schoolName?: string;
  studentId?: string;
  parentStudentIds?: string[];
  permissions: string[];
  mustChangePassword?: boolean;
}

/**
 * Browser authentication uses a Django server-side session in an HttpOnly
 * cookie. The browser never reads or persists mobile access/refresh tokens.
 */

export function getCsrfToken(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

/** @deprecated Web flow uses HttpOnly session cookies. Retained for backward typing compatibility. */
export function getAccessToken(): string | null {
  return null;
}

/** @deprecated Web flow uses HttpOnly session cookies. Retained for backward typing compatibility. */
export function setAccessTokenInMemory(_token: string | null): void {}

export const AUTH_SESSION_EXPIRED_EVENT = 'school-erp:session-expired';

export function clearAuthenticatedSession(): void {
  try {
    localStorage.removeItem('school_erp_api_token');
    localStorage.removeItem('school_erp_api_refresh_token');
    localStorage.removeItem('school_erp_session_id');
    localStorage.removeItem('erp_students');
    localStorage.removeItem('erp_individual_fees');
    localStorage.removeItem('erp_fee_categories');
    localStorage.removeItem('erp_fee_structures');
    localStorage.removeItem('sa_schools');
    localStorage.removeItem('sa_admins');
    localStorage.removeItem('sa_users');
    localStorage.removeItem('sa_audit_logs');
  } catch {}
  clearAuthenticatedUser();
}

/** @deprecated UI modules should use the authenticated API user instead. */
export const SUPER_ADMIN_EMAIL = '';
/** @deprecated UI modules should use the authenticated API user instead. */
export const SUPER_ADMIN_NAME = '';
/** @deprecated Passwords are never available in frontend code. */
export const SUPER_ADMIN_PASSWORD = '';
/** @deprecated Bootstrap accounts exist only on the server. */
export const PRESET_ACCOUNTS: Array<AuthUser & { password: string; description: string }> = [];

/** @deprecated Replaced by server validation in App.tsx. */
export function decodeJWT(_token?: string): AuthUser | null {
  return getStoredAuthenticatedUser();
}

const AUTH_USER_STORAGE_KEY = 'school_erp_authenticated_user';

export function storeAuthenticatedUser(user: AuthUser): void {
  try {
    localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
  } catch {}
}

export function getStoredAuthenticatedUser(): AuthUser | null {
  try {
    const value = localStorage.getItem(AUTH_USER_STORAGE_KEY);
    if (!value) return null;
    const user = JSON.parse(value) as AuthUser;
    return user.email && user.role ? user : null;
  } catch {
    return null;
  }
}

export function clearAuthenticatedUser(): void {
  try {
    localStorage.removeItem(AUTH_USER_STORAGE_KEY);
  } catch {}
}

export function hasPermission(user: AuthUser | null, permission: string): boolean {
  return Boolean(user?.permissions.includes(permission));
}

export function isUserAuthenticated(): boolean {
  return Boolean(getStoredAuthenticatedUser());
}
