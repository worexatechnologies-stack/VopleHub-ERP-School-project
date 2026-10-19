import { baseApi } from './baseApi';

export interface NotificationRecord {
  id: number;
  title: string;
  body: string;
  category: string;
  channel: string;
  readAt?: string | null;
  read_at?: string | null;
  createdAt?: string;
  created_at?: string;
  senderName?: string;
  senderId?: number;
  recipientName?: string;
  recipientId?: number;
  requestStatus?: string;
  related_object?: Record<string, any>;
  sender?: {
    id: number;
    name: string;
    role: string;
  };
}

export interface NotificationComposerPayload {
  recipientMode: 'all' | 'class' | 'section' | 'subject' | 'individual';
  targetClass?: string;
  targetClassId?: number | null;
  targetSection?: string;
  targetSectionId?: number | null;
  recipients?: string[];
  category: string;
  title: string;
  body: string;
}

export const notificationApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getNotifications: build.query<NotificationRecord[], void>({
      query: () => ({ url: '/notifications/' }),
      providesTags: ['Notification'],
    }),
    markNotificationRead: build.mutation<NotificationRecord, number>({
      query: (id) => ({ url: `/notifications/${id}/read/`, method: 'PATCH' }),
      invalidatesTags: ['Notification'],
    }),
    respondNotificationDecision: build.mutation<
      any,
      { id: number; action: 'Approve' | 'Reject' | 'Approved' | 'Declined'; status?: 'Approved' | 'Declined'; note?: string }
    >({
      query: ({ id, ...body }) => ({
        url: `/notifications/${id}/decision/`,
        method: 'POST',
        body: {
          ...body,
          action: body.action,
          status: (body.action === 'Approve' || body.action === 'Approved' || body.status === 'Approved') ? 'Approved' : 'Declined',
        },
      }),
      invalidatesTags: ['Notification'],
    }),
    clearAllNotifications: build.mutation<void, void>({
      query: () => ({
        url: '/notifications/clear-all/',
        method: 'DELETE',
      }),
      invalidatesTags: ['Notification'],
    }),
    notifyTeachers: build.mutation<{ created: number }, NotificationComposerPayload>({
      query: (body) => ({ url: '/notifications/school-to-teachers/', method: 'POST', body }),
      invalidatesTags: ['Notification'],
    }),
    notifyParents: build.mutation<{ created: number }, NotificationComposerPayload>({
      query: (body) => ({ url: '/notifications/teacher-to-parents/', method: 'POST', body }),
      invalidatesTags: ['Notification'],
    }),
    notifyStudents: build.mutation<{ created: number }, NotificationComposerPayload>({
      query: (body) => ({ url: '/notifications/teacher-to-students/', method: 'POST', body }),
      invalidatesTags: ['Notification'],
    }),
    notifyAdmin: build.mutation<{ created: number }, NotificationComposerPayload>({
      query: (body) => ({ url: '/notifications/teacher-to-admin/', method: 'POST', body }),
      invalidatesTags: ['Notification'],
    }),
    registerFcmDevice: build.mutation<void, { token: string; deviceName: string }>({
      query: (body) => ({ url: '/notifications/devices/', method: 'POST', body }),
    }),
    unregisterFcmDevice: build.mutation<void, { token: string }>({
      query: (body) => ({ url: '/notifications/devices/', method: 'DELETE', body }),
    }),
  }),
});

export const {
  useGetNotificationsQuery,
  useLazyGetNotificationsQuery,
  useMarkNotificationReadMutation,
  useRespondNotificationDecisionMutation,
  useClearAllNotificationsMutation,
  useNotifyTeachersMutation,
  useNotifyParentsMutation,
  useNotifyStudentsMutation,
  useNotifyAdminMutation,
  useRegisterFcmDeviceMutation,
  useUnregisterFcmDeviceMutation,
} = notificationApi;
