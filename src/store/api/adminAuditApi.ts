import { baseApi } from './baseApi';

export interface AdminAuditEvent {
  id: number;
  action: string;
  object_type: string;
  object_id: string;
  metadata: Record<string, unknown>;
  remote_addr: string | null;
  created_at: string;
  actor_id: number | null;
  actor_name: string;
  school_id: number | null;
  school_name: string;
}

export const adminAuditApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getAdminAuditEvents: build.query<{
      count: number;
      next: string | null;
      previous: string | null;
      results: AdminAuditEvent[];
    }, { page: number; page_size?: number; search?: string; action?: string; school?: number | string; ordering?: string }>({
      query: (params) => ({ url: '/admin-audit-events/', params }),
    }),
  }),
});

export const { useGetAdminAuditEventsQuery } = adminAuditApi;
