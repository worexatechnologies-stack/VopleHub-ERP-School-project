import { baseApi } from './baseApi';
import { setAccessToken } from '../slices/authSlice';
import { ACCESS_TOKEN_STORAGE_KEY } from '../../utils/auth';
import type { AuthUser } from '../../utils/auth';
import type { UserRole } from '../../types';

export interface LoginResponse {
  access: string;
  // The refresh token is delivered ONLY as an HttpOnly cookie by the server.
  // It is never returned in the JSON body, so we do not type it here.
  user: AuthUser & { role: string };
}

export interface LoginRequest {
  email: string;
  password: string;
  role?: string;
}

export const authApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    login: build.mutation<LoginResponse, LoginRequest>({
      query: (credentials) => ({
        url: '/auth/login/',
        method: 'POST',
        body: credentials,
      }),
      invalidatesTags: ['Auth'],
      transformResponse: (data: LoginResponse) => ({
        ...data,
        user: {
          ...data.user,
          role: (roleMap[data.user.role] || data.user.role) as UserRole,
        },
      }),
    }),
    getCurrentUser: build.query<AuthUser, void>({
      query: () => ({ url: '/auth/me/' }),
      providesTags: ['Auth'],
      transformResponse: (data: AuthUser & { role: string }) => ({
        email: data.email,
        name: data.name || data.email,
        role: (roleMap[data.role] || data.role) as UserRole,
        schoolId: data.schoolId,
        schoolName: data.schoolName,
        studentId: data.studentId,
        parentStudentIds: data.parentStudentIds || [],
        permissions: data.permissions || [],
        mustChangePassword: Boolean(data.mustChangePassword),
      }),
    }),
    changePassword: build.mutation<
      { success?: boolean; detail?: string; access?: string },
      { password: string; currentPassword?: string }
    >({
      query: (body) => ({
        url: '/auth/change-password/',
        method: 'POST',
        body,
      }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          if (data?.access) {
            localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, data.access);
            dispatch(setAccessToken(data.access));
          }
        } catch {
          // Handled by calling component
        }
      },
      invalidatesTags: ['Auth', { type: 'CredentialVault', id: 'LIST' }],
    }),
    logout: build.mutation<void, void>({
      query: () => ({
        url: '/auth/logout/',
        method: 'POST',
      }),
      invalidatesTags: ['Auth'],
    }),
    resetCredentials: build.mutation<{ loginId: string; temporaryPassword: string }, number>({
      query: (userId) => ({
        url: `/auth/users/${userId}/reset-credentials/`,
        method: 'POST',
      }),
      invalidatesTags: ['Auth'],
    }),
    getUsers: build.query<Array<{
      id: number;
      email: string;
      name: string;
      role: string;
      schoolId?: string;
      schoolName?: string;
      isActive?: boolean;
      mustChangePassword?: boolean;
      studentId?: string;
      parentStudentIds?: string[];
      permissions?: string[];
    }>, void>({
      query: () => ({ url: '/auth/users/' }),
      providesTags: ['User'],
    }),
    presenceHeartbeat: build.mutation<void, void>({
      query: () => ({
        url: '/auth/presence/heartbeat/',
        method: 'POST',
      }),
    }),
    setSchoolAdminStatus: build.mutation<void, { id: string | number; action: 'reactivate' | 'deactivate' }>({
      query: ({ id, action }) => ({
        url: `/auth/school-admins/${id}/${action}/`,
        method: 'POST',
      }),
      invalidatesTags: ['User'],
    }),
    setSchoolAdminPassword: build.mutation<void, { id: string | number; password: string }>({
      query: ({ id, password }) => ({
        url: `/auth/school-admins/${id}/set-password/`,
        method: 'POST',
        body: { password },
      }),
      invalidatesTags: ['User'],
    }),
    deleteSchoolAdmin: build.mutation<void, { id: string | number; confirmation: string }>({
      query: ({ id, confirmation }) => ({
        url: `/auth/school-admins/${id}/delete/`,
        method: 'POST',
        body: { confirmation },
      }),
      invalidatesTags: ['User'],
    }),
    createSchoolAdmin: build.mutation<any, { name: string; schoolId: string | number; status: string }>({
      query: (body) => ({
        url: '/auth/school-admins/',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['User'],
    }),
  }),
});

const roleMap: Record<string, string> = {
  super_admin: 'Super Admin',
  school_admin: 'School Admin',
  teacher: 'Teacher',
  parent: 'Parent',
  student: 'Student',
  public_learner: 'Public Learner',
};

export const {
  useLoginMutation,
  useGetCurrentUserQuery,
  useChangePasswordMutation,
  useLogoutMutation,
  useResetCredentialsMutation,
  useGetUsersQuery,
  usePresenceHeartbeatMutation,
  useSetSchoolAdminStatusMutation,
  useSetSchoolAdminPasswordMutation,
  useDeleteSchoolAdminMutation,
  useCreateSchoolAdminMutation,
} = authApi;