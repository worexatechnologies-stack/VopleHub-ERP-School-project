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

  const data = getErrorData(error);
  if (data) {
    const detail = data.detail ?? data.errors ?? data.message;
    if (typeof detail === 'string' && detail.trim()) {
      return detail.trim();
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
    if ('error' in error && typeof error.error === 'string') return error.error;
    if (typeof error.status === 'string') return `Network error: ${error.status}`;
    return `Server error (${error.status}).`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return fallback;
}
