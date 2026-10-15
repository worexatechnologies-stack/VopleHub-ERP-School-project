import { baseApi } from './baseApi';

export type EventKind = 'School event' | 'Workshop' | 'Competition' | 'Seminar' | 'Sports' | 'Cultural';
export type EventStatus = 'Draft' | 'Published' | 'Completed' | 'Cancelled';
export type PostKind = 'Announcement' | 'Awareness campaign' | 'School achievement' | 'Social update';

export interface SchoolEventRecord {
  id: number | string;
  title: string;
  kind: EventKind;
  description: string;
  date: string;
  end_date?: string | null;
  registration_deadline?: string | null;
  venue: string;
  capacity: number;
  ticket_required: boolean;
  status: EventStatus;
  audience: string;
  created_by?: number | null;
  created_at: string;
  updated_at: string;
  registered_count: number;
  is_deadline_passed: boolean;
  is_registration_open: boolean;
  is_registered: boolean;
  my_ticket_code?: string;
  my_registration_id?: number | null;
}

export interface EventRegistrationRecord {
  id: number | string;
  event: number | string;
  event_title: string;
  event_date: string;
  event_venue: string;
  ticket_required: boolean;
  user?: number | null;
  student?: number | null;
  attendee_name: string;
  attendee_email: string;
  attendee_phone: string;
  class_name: string;
  section: string;
  roll_no?: number | null;
  admission_no?: string;
  notes: string;
  ticket_code: string;
  status: string;
  registered_at: string;
}

export interface CommunityPostRecord {
  id: number | string;
  kind: PostKind;
  title: string;
  body: string;
  audience: string;
  channels: string[];
  author?: number | null;
  author_name: string;
  created_at: string;
  updated_at: string;
}

type Page<T> = { next?: string | null; results?: T[] } | T[];

function unwrapPage<T>(payload: Page<T>): T[] {
  return Array.isArray(payload) ? payload : payload.results || [];
}

export const communityApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // Events
    getEvents: build.query<SchoolEventRecord[], { search?: string; kind?: string; activity_status?: string; status?: string } | void>({
      query: (args) => {
        const params = new URLSearchParams();
        if (args?.search) params.append('search', args.search);
        if (args?.kind && args.kind !== 'All') params.append('kind', args.kind);
        if (args?.activity_status && args.activity_status !== 'all') params.append('activity_status', args.activity_status);
        if (args?.status) params.append('status', args.status);
        const query = params.toString() ? `?${params.toString()}` : '';
        return `/events/${query}`;
      },
      transformResponse: (res: Page<SchoolEventRecord>) => unwrapPage(res),
      providesTags: ['CommunityEvent'],
    }),

    createEvent: build.mutation<SchoolEventRecord, Partial<SchoolEventRecord>>({
      query: (body) => ({
        url: '/events/',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['CommunityEvent'],
    }),

    updateEvent: build.mutation<SchoolEventRecord, { id: number | string; data: Partial<SchoolEventRecord> }>({
      query: ({ id, data }) => ({
        url: `/events/${id}/`,
        method: 'PATCH',
        body: data,
      }),
      invalidatesTags: ['CommunityEvent', 'EventRegistration'],
    }),

    deleteEvent: build.mutation<void, number | string>({
      query: (id) => ({
        url: `/events/${id}/`,
        method: 'DELETE',
      }),
      invalidatesTags: ['CommunityEvent', 'EventRegistration'],
    }),

    // Event Registration
    registerForEvent: build.mutation<EventRegistrationRecord, { eventId: number | string; data: Partial<EventRegistrationRecord> }>({
      query: ({ eventId, data }) => ({
        url: `/events/${eventId}/register/`,
        method: 'POST',
        body: data,
      }),
      invalidatesTags: ['CommunityEvent', 'EventRegistration'],
    }),

    cancelEventRegistration: build.mutation<{ detail: string }, number | string>({
      query: (eventId) => ({
        url: `/events/${eventId}/cancel_registration/`,
        method: 'POST',
      }),
      invalidatesTags: ['CommunityEvent', 'EventRegistration'],
    }),

    getEventRegistrations: build.query<EventRegistrationRecord[], number | string>({
      query: (eventId) => `/events/${eventId}/registrations/`,
      transformResponse: (res: Page<EventRegistrationRecord>) => unwrapPage(res),
      providesTags: ['EventRegistration'],
    }),

    getMyRegistrations: build.query<EventRegistrationRecord[], void>({
      query: () => '/event-registrations/my_registrations/',
      transformResponse: (res: Page<EventRegistrationRecord>) => unwrapPage(res),
      providesTags: ['EventRegistration'],
    }),

    // Community Feed Posts
    getCommunityPosts: build.query<CommunityPostRecord[], { kind?: string; search?: string } | void>({
      query: (args) => {
        const params = new URLSearchParams();
        if (args?.kind) params.append('kind', args.kind);
        if (args?.search) params.append('search', args.search);
        const query = params.toString() ? `?${params.toString()}` : '';
        return `/community-posts/${query}`;
      },
      transformResponse: (res: Page<CommunityPostRecord>) => unwrapPage(res),
      providesTags: ['CommunityPost'],
    }),

    createCommunityPost: build.mutation<CommunityPostRecord, Partial<CommunityPostRecord>>({
      query: (body) => ({
        url: '/community-posts/',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['CommunityPost'],
    }),

    deleteCommunityPost: build.mutation<void, number | string>({
      query: (id) => ({
        url: `/community-posts/${id}/`,
        method: 'DELETE',
      }),
      invalidatesTags: ['CommunityPost'],
    }),
  }),
});

export const {
  useGetEventsQuery,
  useCreateEventMutation,
  useUpdateEventMutation,
  useDeleteEventMutation,
  useRegisterForEventMutation,
  useCancelEventRegistrationMutation,
  useGetEventRegistrationsQuery,
  useLazyGetEventRegistrationsQuery,
  useGetMyRegistrationsQuery,
  useGetCommunityPostsQuery,
  useCreateCommunityPostMutation,
  useDeleteCommunityPostMutation,
} = communityApi;
