import { baseApi } from './baseApi';

export interface VaultCredential {
  id: number;
  schoolId: number;
  schoolName?: string;
  userId?: number;
  role: 'student' | 'teacher' | 'parent' | 'admin' | 'school_admin' | string;
  name: string;
  loginId: string;
  password: string;
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
    getVaultCredentials: builder.query<VaultCredential[], VaultQueryParams | void>({
      query: (params) => ({
        url: '/credential-vault/',
        params: params || {},
      }),
      transformResponse: (response: any) => (Array.isArray(response) ? response : response?.results || []),
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: 'CredentialVault' as const, id })),
              { type: 'CredentialVault', id: 'LIST' },
            ]
          : [{ type: 'CredentialVault', id: 'LIST' }],
    }),

    syncVaultRoster: builder.mutation<VaultSyncResult, { schoolId?: number } | void>({
      query: (body) => ({
        url: '/credential-vault/sync/',
        method: 'POST',
        body: body || {},
      }),
      invalidatesTags: [{ type: 'CredentialVault', id: 'LIST' }],
    }),

    resetVaultCredentialPassword: builder.mutation<VaultCredential, number>({
      query: (id) => ({
        url: `/credential-vault/${id}/reset/`,
        method: 'POST',
      }),
      invalidatesTags: (_res, _err, id) => [
        { type: 'CredentialVault', id },
        { type: 'CredentialVault', id: 'LIST' },
      ],
    }),

    updateVaultCredential: builder.mutation<
      VaultCredential,
      { id: number; password?: string; name?: string; phone?: string }
    >({
      query: ({ id, ...patch }) => ({
        url: `/credential-vault/${id}/`,
        method: 'PATCH',
        body: patch,
      }),
      invalidatesTags: (_res, _err, { id }) => [
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
  useSyncVaultRosterMutation,
  useResetVaultCredentialPasswordMutation,
  useUpdateVaultCredentialMutation,
  useDeleteVaultCredentialMutation,
} = vaultApi;
