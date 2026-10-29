import { baseApi } from './baseApi';
import type { AuthUser } from '../../utils/auth';
import type { UserRole } from '../../types';

export interface LoginResponse {
  access?: string;
  refresh?: string;
  sessionId?: string;
  session_id?: string;
  user?: AuthUser & { role: string };
  mfa_required?: boolean;
  mfa_token?: string;
  email?: string;
  masked_email?: string;
  masked_phone?: string;
  role?: string;
  dev_otp?: string;
  message?: string;
}

export interface VerifyOtpRequest {
  mfa_token: string;
  otp: string;
}

export interface ResendOtpRequest {
  mfa_token: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  role?: string;
  human_verification_token?: string;
  turnstile_token?: string;
}

export const authApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    login: build.mutation<LoginResponse, LoginRequest>({
      query: (credentials) => ({
        url: '/auth/login/',
        method: 'POST',
        body: {
          ...credentials,
          client_type: 'web',
          auth_mode: 'session',
        },
      }),
      invalidatesTags: ['Auth'],
      transformResponse: (data: LoginResponse) => ({
        ...data,
        user: data.user
          ? {
              ...data.user,
              role: (roleMap[data.user.role] || data.user.role) as UserRole,
              mustChangePassword: Boolean(
                data.user.mustChangePassword ??
                (data.user as any).must_change_password
              ),
            }
          : undefined,
      }),
    }),
    verifyOtp: build.mutation<LoginResponse, VerifyOtpRequest>({
      query: (body) => ({
        url: '/auth/verify-otp/',
        method: 'POST',
        body: {
          ...body,
          client_type: 'web',
          auth_mode: 'session',
        },
      }),
      invalidatesTags: ['Auth'],
      transformResponse: (data: LoginResponse) => ({
        ...data,
        user: data.user
          ? {
              ...data.user,
              role: (roleMap[data.user.role] || data.user.role) as UserRole,
              mustChangePassword: Boolean(
                data.user.mustChangePassword ??
                (data.user as any).must_change_password
              ),
            }
          : undefined,
      }),
    }),
    resendOtp: build.mutation<{ success: boolean; dev_otp?: string; message: string; cooldown?: number }, ResendOtpRequest>({
      query: (body) => ({
        url: '/auth/resend-otp/',
        method: 'POST',
        body,
      }),
    }),
    getCsrfToken: build.query<{ csrfToken: string }, void>({
      query: () => ({ url: '/auth/csrf/' }),
    }),
    getCurrentUser: build.query<AuthUser, void>({
      query: () => ({ url: '/auth/me/' }),
      providesTags: ['Auth'],
      transformResponse: (data: any) => ({
        id: data.id,
        email: data.email,
        name: data.name || data.email,
        role: (roleMap[data.role] || data.role) as UserRole,
        schoolId: data.schoolId,
        schoolName: data.schoolName,
        studentId: data.studentId,
        parentStudentIds: data.parentStudentIds || [],
        permissions: data.permissions || [],
        mustChangePassword: Boolean(data.mustChangePassword ?? data.must_change_password),
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
    resetStudentLoginCredentials: build.mutation<{ userId: number; loginId: string; temporaryPassword: string }, { studentId: string; role: 'Student' | 'Parent' }>({
      query: (body) => ({
        url: `/auth/students/${body.studentId}/reset-credentials/`,
        method: 'POST',
        body: { role: body.role },
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
  useVerifyOtpMutation,
  useResendOtpMutation,
  useGetCsrfTokenQuery,
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
