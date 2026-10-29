import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';

export interface StructuredErrorData {
  detail?: string | unknown;
  errors?: string | unknown;
  message?: string;
  references?: unknown[];
  canCascade?: boolean;
  cascadeParam?: string;
  cascadeSummary?: string;
  [key: string]: unknown;
}

export function isFetchBaseQueryError(error: unknown): error is FetchBaseQueryError {
  return typeof error === 'object' && error !== null && 'status' in error;
}

export function getErrorStatus(error: unknown): number | null {
  if (isFetchBaseQueryError(error) && typeof error.status === 'number') {
    return error.status;
  }
  if (typeof error === 'object' && error !== null && 'status' in error && typeof (error as any).status === 'number') {
    return (error as any).status;
  }
  return null;
}

export function getErrorData(error: unknown): StructuredErrorData | null {
  if (isFetchBaseQueryError(error) && error.data && typeof error.data === 'object') {
    return error.data as StructuredErrorData;
  }
  if (typeof error === 'object' && error !== null) {
    if ('data' in error && (error as any).data && typeof (error as any).data === 'object') {
      return (error as any).data as StructuredErrorData;
    }
    if ('body' in error && (error as any).body && typeof (error as any).body === 'object') {
      return (error as any).body as StructuredErrorData;
    }
  }
  return null;
}

export function getErrorMessage(error: unknown, fallback = 'Please try again.'): string {
  if (!error) return fallback;

  const status = getErrorStatus(error);
  if (status !== null && status >= 500) {
    return 'Something went wrong. Please try again. If it keeps happening, contact your school office.';
  }
  if (isFetchBaseQueryError(error) && typeof error.status === 'string') {
    if (error.status === 'TIMEOUT_ERROR') return 'This is taking longer than usual. Please try again.';
    if (error.status === 'PARSING_ERROR') return 'We could not read the reply. Please refresh and try again.';
    return 'We could not connect. Check your internet connection and try again.';
  }

  const data = getErrorData(error);
  if (data) {
    const detail = data.detail ?? data.errors ?? data.message;
    if (typeof detail === 'string' && detail.trim()) {
      const message = detail.trim();
      if (looksTechnical(message)) return fallback;
      return message;
    }
    if (detail && typeof detail === 'object') {
      return JSON.stringify(detail);
    }
    // DRF field-specific validation errors: { [field]: ["Message"] }
    if (typeof data === 'object') {
      const messages: string[] = [];
      for (const [key, val] of Object.entries(data)) {
        if (key === 'detail' || key === 'errors' || key === 'message') continue;
        if (Array.isArray(val)) {
          messages.push(...val.map(String));
        } else if (typeof val === 'string' && val.trim()) {
          messages.push(val.trim());
        }
      }
      if (messages.length > 0) {
        return messages.join(' ');
      }
    }
  }

  if (isFetchBaseQueryError(error)) {
    return fallback;
  }

  if (error instanceof Error) {
    return looksTechnical(error.message) ? fallback : error.message;
  }

  if (typeof error === 'string') {
    return looksTechnical(error) ? fallback : error;
  }

  return fallback;
}

function looksTechnical(message: string): boolean {
  return /<!doctype|<html\b|<title>\s*server error|traceback|stack trace|integrityerror|operationalerror|exception:|\b500\b|\b502\b|\b503\b|\b504\b|fetch failed|network error:|failed to fetch/i.test(message);
}
