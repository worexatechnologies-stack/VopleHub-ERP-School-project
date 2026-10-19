import { baseApi } from './baseApi';

export interface ChatChildMapping {
  studentId: number | string;
  studentName: string;
  className: string;
  sectionName: string;
  subjects: string[];
}

export interface ChatStudentInfo {
  id: number | string;
  name: string;
  className: string;
  section: string;
  rollNo: number;
  admissionNo: string;
}

export interface ChatContact {
  id: string | number;
  userId?: number;
  name: string;
  role: 'School Admin' | 'Teacher' | 'Parent' | 'Student' | string;
  email?: string;
  phone?: string;
  isOnline?: boolean;
  isOfficeDesk?: boolean;
  assignedSections?: string[];
  subjects?: string[];
  teachingAssignments?: Array<{
    classId?: number;
    className?: string;
    sectionId?: number;
    sectionName?: string;
    subjectId?: number;
    subjectName?: string;
  }>;
  childMappings?: ChatChildMapping[];
  students?: ChatStudentInfo[];
  studentSummary?: string;
  studentNames?: string[];
}

export interface MessageAttachment {
  id: string;
  originalName: string;
  contentType: string;
  fileSize: number;
  downloadUrl: string;
}

export interface ApiDirectMessage {
  id: number;
  uuid?: string;
  conversationId: number;
  senderId: number;
  senderName: string;
  recipientId: number;
  recipientName: string;
  isMe: boolean;
  body: string;
  messageType?: string;
  clientKey?: string;
  replyToId?: number;
  editedAt?: string | null;
  isDeleted?: boolean;
  attachments?: MessageAttachment[];
  createdAt: string;
  readAt: string | null;
}

export interface ApiConversation {
  id: number;
  uuid?: string;
  conversationType?: string;
  status?: string;
  otherParticipant: {
    id: number;
    name: string;
    role: string;
    email: string;
    isOnline: boolean;
    assignedSections?: string[];
    subjects?: string[];
    childMappings?: ChatChildMapping[];
    students?: ChatStudentInfo[];
    studentSummary?: string;
  };
  student?: ChatStudentInfo | null;
  lastMessage?: {
    id: number;
    body: string;
    createdAt: string;
    messageType?: string;
    isDeleted?: boolean;
  } | null;
  unreadCount: number;
  updatedAt: string;
  isMuted?: boolean;
  isArchived?: boolean;
}

export interface UnreadSummaryResponse {
  totalUnread: number;
  conversations: Record<string, number>;
}

export const chatApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getChatContacts: build.query<ChatContact[], { search?: string } | string | void>({
      query: (arg) => {
        const search = typeof arg === 'string' ? arg : arg?.search;
        return {
          url: search ? `/chat/contacts/?search=${encodeURIComponent(search)}` : '/chat/contacts/',
        };
      },
      providesTags: ['Chat'],
    }),
    getConversations: build.query<ApiConversation[], void>({
      query: () => ({ url: '/conversations/' }),
      providesTags: ['Chat'],
    }),
    getMessages: build.query<ApiDirectMessage[], { conversationId: number; before?: number; limit?: number } | number>({
      query: (arg) => {
        const id = typeof arg === 'number' ? arg : arg.conversationId;
        const before = typeof arg === 'object' ? arg.before : undefined;
        const limit = typeof arg === 'object' ? arg.limit : undefined;
        let url = `/conversations/${id}/messages/`;
        const params: string[] = [];
        if (before) params.push(`before=${before}`);
        if (limit) params.push(`limit=${limit}`);
        if (params.length) url += `?${params.join('&')}`;
        return { url };
      },
      providesTags: (_res, _err, arg) => {
        const id = typeof arg === 'number' ? arg : arg.conversationId;
        return [{ type: 'Chat' as const, id: `messages-${id}` }];
      },
    }),
    startConversation: build.mutation<ApiConversation, { targetUserId?: number | string; teacherId?: number; studentId?: number }>({
      query: (body) => ({
        url: '/conversations/start/',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Chat'],
    }),
    sendMessage: build.mutation<
      ApiDirectMessage,
      { conversationId: number; message: string; client_idempotency_key?: string; files?: File[] }
    >({
      query: ({ conversationId, message, client_idempotency_key, files }) => {
        const key = client_idempotency_key || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `msg-${Date.now()}`);

        if (files && files.length > 0) {
          const formData = new FormData();
          formData.append('message', message);
          formData.append('client_idempotency_key', key);
          files.forEach((f) => {
            formData.append('files', f);
          });
          return {
            url: `/conversations/${conversationId}/messages/`,
            method: 'POST',
            body: formData,
            headers: { 'Idempotency-Key': key },
          };
        }

        return {
          url: `/conversations/${conversationId}/messages/`,
          method: 'POST',
          body: { message, client_idempotency_key: key },
          headers: { 'Idempotency-Key': key },
        };
      },
      invalidatesTags: (_res, _err, arg) => [
        { type: 'Chat', id: `messages-${arg.conversationId}` },
        'Chat',
      ],
    }),
    editMessage: build.mutation<ApiDirectMessage, { messageId: number; message: string; conversationId: number }>({
      query: ({ messageId, message }) => ({
        url: `/messages/${messageId}/`,
        method: 'PATCH',
        body: { message },
      }),
      invalidatesTags: (_res, _err, arg) => [
        { type: 'Chat', id: `messages-${arg.conversationId}` },
        'Chat',
      ],
    }),
    deleteMessage: build.mutation<{ id: number; isDeleted: boolean }, { messageId: number; conversationId: number }>({
      query: ({ messageId }) => ({
        url: `/messages/${messageId}/`,
        method: 'DELETE',
      }),
      invalidatesTags: (_res, _err, arg) => [
        { type: 'Chat', id: `messages-${arg.conversationId}` },
        'Chat',
      ],
    }),
    markConversationRead: build.mutation<{ success: boolean; markedRead: number }, number>({
      query: (conversationId) => ({
        url: `/conversations/${conversationId}/read/`,
        method: 'POST',
      }),
      invalidatesTags: ['Chat'],
    }),
    getUnreadCount: build.query<UnreadSummaryResponse, void>({
      query: () => ({ url: '/unread-count/' }),
      providesTags: ['Chat'],
    }),
    clearAllChats: build.mutation<void, void>({
      query: () => ({
        url: '/chat/clear-all/',
        method: 'DELETE',
      }),
      invalidatesTags: ['Chat'],
    }),
  }),
});

export const {
  useGetChatContactsQuery,
  useGetConversationsQuery,
  useGetMessagesQuery,
  useStartConversationMutation,
  useSendMessageMutation,
  useEditMessageMutation,
  useDeleteMessageMutation,
  useMarkConversationReadMutation,
  useGetUnreadCountQuery,
  useClearAllChatsMutation,
} = chatApi;
