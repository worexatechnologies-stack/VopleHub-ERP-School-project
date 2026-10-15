import { baseApi } from './baseApi';

export interface TimetableSlotRecord {
  id: string;
  schoolId: string;
  academicYear: string;
  class: string;
  section: string;
  sectionId: number;
  day: string;
  period: number;
  time: string;
  subject: string;
  subjectId: number;
  teacherId: string;
  teacherName: string;
  classroom: string;
  published: boolean;
}

type Page<T> = { next?: string | null; results?: T[] } | T[];

function unwrapPage<T>(payload: Page<T>): T[] {
  return Array.isArray(payload) ? payload : payload.results || [];
}

export const timetableApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getTimetableSlots: build.query<TimetableSlotRecord[], { academicYear?: string; sectionId?: number; page_size?: number } | void>({
      query: (params) => ({
        url: '/timetable-slots/',
        params: {
          ...(params?.academicYear ? { academicYear: params.academicYear } : {}),
          ...(params?.sectionId ? { sectionId: params.sectionId } : {}),
          page_size: params?.page_size ?? 500,
        },
      }),
      transformResponse: (response: Page<TimetableSlotRecord>) => unwrapPage(response),
      providesTags: ['Timetable'],
    }),
    createTimetableSlot: build.mutation<TimetableSlotRecord, Partial<TimetableSlotRecord>>({
      query: (body) => ({ url: '/timetable-slots/', method: 'POST', body }),
      invalidatesTags: ['Timetable'],
    }),
    updateTimetableSlot: build.mutation<TimetableSlotRecord, { id: string; body: Partial<TimetableSlotRecord> }>({
      query: ({ id, body }) => ({ url: `/timetable-slots/${id}/`, method: 'PATCH', body }),
      invalidatesTags: ['Timetable'],
    }),
    deleteTimetableSlot: build.mutation<void, string>({
      query: (id) => ({ url: `/timetable-slots/${id}/`, method: 'DELETE' }),
      invalidatesTags: ['Timetable'],
    }),
    publishTimetable: build.mutation<{ updated: number; slots: TimetableSlotRecord[] }, { academicYear: string; sectionId: number }>({
      query: (body) => ({ url: '/timetable-slots/publish/', method: 'POST', body }),
      invalidatesTags: ['Timetable'],
    }),
  }),
});

export const {
  useGetTimetableSlotsQuery,
  useCreateTimetableSlotMutation,
  useUpdateTimetableSlotMutation,
  useDeleteTimetableSlotMutation,
  usePublishTimetableMutation,
} = timetableApi;
