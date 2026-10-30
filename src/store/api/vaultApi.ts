import { baseApi } from './baseApi';

export interface VaultCredential {
  id: number;
  schoolId: number;
  schoolName?: string;
  userId?: number;
  role: 'student' | 'teacher' | 'parent' | 'admin' | 'school_admin' | string;
  name: string;
  loginId: string;
  identifier: string; // admission_no or emp id
  className: string;
  section: string;
  academicYear: string;
  phone: string;
  linkedStudentName: string;
  source: string;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VaultQueryParams {
  role?: string;
  className?: string;
  section?: string;
  search?: string;
  schoolId?: number | string;
  page?: number;
  page_size?: number;
  ordering?: string;
}

export interface VaultPage {
  count: number;
  next: string | null;
  previous: string | null;
  results: VaultCredential[];
}

export interface VaultSummary {
  total: number;
  byRole: Record<string, { total: number; temporary: number }>;
}

export interface OneTimeCredential {
  userId?: number;
  loginId: string;
  temporaryPassword: string;
  mustChangePassword: true;
}

export interface VaultSyncResult {
  success: boolean;
  synced: number;
  students: number;
  teachers: number;
  parents: number;
}

export const vaultApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getVaultCredentials: builder.query<VaultPage, VaultQueryParams | void>({
      query: (params) => ({
        url: '/credential-vault/',
        params: { ...(params || {}), page: params?.page ?? 1, page_size: params?.page_size ?? 50 },
      }),
      providesTags: (result) => result
        ? [...result.results.map(({ id }) => ({ type: 'CredentialVault' as const, id })), { type: 'CredentialVault', id: 'LIST' }]
        : [{ type: 'CredentialVault', id: 'LIST' }],
    }),
    getVaultSummary: builder.query<VaultSummary, Omit<VaultQueryParams, 'page' | 'page_size' | 'ordering'> | void>({
      query: (params) => ({ url: '/credential-vault/summary/', params: params || {} }),
      providesTags: [{ type: 'CredentialVault', id: 'SUMMARY' }],
    }),

    syncVaultRoster: builder.mutation<VaultSyncResult, { schoolId?: number } | void>({
      query: (body) => ({
        url: '/credential-vault/sync/',
        method: 'POST',
        body: body || {},
      }),
      invalidatesTags: [{ type: 'CredentialVault', id: 'LIST' }],
    }),

    resetVaultCredentialPassword: builder.mutation<OneTimeCredential, number>({
      query: (id) => ({
        url: `/credential-vault/${id}/reset/`,
        method: 'POST',
      }),
      invalidatesTags: (_res, _err, id) => [
        { type: 'CredentialVault', id },
        { type: 'CredentialVault', id: 'LIST' },
      ],
    }),

    deleteVaultCredential: builder.mutation<void, number>({
      query: (id) => ({
        url: `/credential-vault/${id}/`,
        method: 'DELETE',
      }),
      invalidatesTags: [{ type: 'CredentialVault', id: 'LIST' }, 'User'],
    }),
  }),
});

export const {
  useGetVaultCredentialsQuery,
  useGetVaultSummaryQuery,
  useSyncVaultRosterMutation,
  useResetVaultCredentialPasswordMutation,
  useDeleteVaultCredentialMutation,
} = vaultApi;
