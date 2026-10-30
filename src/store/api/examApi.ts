import { baseApi } from './baseApi';
import type { ExamTimetableRecord } from '../../types';

export type { ExamTimetableRecord };

export interface ExamRecord {
  id: number;
  schedule?: number | null;
  name: string;
  class_name: string;
  section: string;
  subject: string;
  date: string;
  time: string;
  end_time?: string | null;
  max_marks: number;
}

export interface ExamResultRecord {
  student: number;
  student_name: string;
  admission_no: string;
  exam_id: number;
  exam_name: string;
  subject: string;
  max_marks: number;
  exam_date: string;
  marks_obtained: string | number | null;
  remarks: string;
  status: 'draft' | 'submitted';
  submitted_at: string | null;
}

export interface Page<T> { count: number; next: string | null; previous: string | null; results: T[] }

export const examApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getExams: build.query<Page<ExamRecord>, { page?: number; page_size?: number } | void>({
      query: (params) => ({ url: '/exams/', params: params || { page: 1, page_size: 200 } }),
      providesTags: ['Exam'],
    }),
    createExam: build.mutation<ExamRecord, Omit<ExamRecord, 'id'>>({
      query: (body) => ({ url: '/exams/', method: 'POST', body }),
      invalidatesTags: ['Exam'],
    }),
    deleteExam: build.mutation<void, number>({
      query: (id) => ({ url: `/exams/${id}/`, method: 'DELETE' }),
      invalidatesTags: ['Exam', 'ExamResult'],
    }),
    getExamSchedules: build.query<Page<ExamTimetableRecord>, { page?: number; page_size?: number; class_name?: string; status?: string; ordering?: string } | void>({
      query: (params) => ({ url: '/exam-schedules/', params: params || { page: 1, page_size: 200 } }),
      providesTags: ['Exam'],
    }),
    createExamSchedule: build.mutation<ExamTimetableRecord, Partial<ExamTimetableRecord>>({
      query: (body) => ({ url: '/exam-schedules/', method: 'POST', body }),
      invalidatesTags: ['Exam'],
    }),
    updateExamSchedule: build.mutation<ExamTimetableRecord, { id: number; data: Partial<ExamTimetableRecord> }>({
      query: ({ id, data }) => ({ url: `/exam-schedules/${id}/`, method: 'PATCH', body: data }),
      invalidatesTags: ['Exam'],
    }),
    publishExamSchedule: build.mutation<ExamTimetableRecord, number>({
      query: (id) => ({ url: `/exam-schedules/${id}/publish/`, method: 'POST' }),
      invalidatesTags: ['Exam', 'ExamResult'],
    }),
    unpublishExamSchedule: build.mutation<ExamTimetableRecord, number>({
      query: (id) => ({ url: `/exam-schedules/${id}/unpublish/`, method: 'POST' }),
      invalidatesTags: ['Exam', 'ExamResult'],
    }),
    deleteExamSchedule: build.mutation<void, number>({
      query: (id) => ({ url: `/exam-schedules/${id}/`, method: 'DELETE' }),
      invalidatesTags: ['Exam', 'ExamResult'],
    }),
    generateHallTickets: build.mutation<{ detail: string; count: number; schedule: ExamTimetableRecord }, number>({
      query: (scheduleId) => ({ url: `/exam-schedules/${scheduleId}/generate-hall-tickets/`, method: 'POST' }),
      invalidatesTags: ['Exam'],
    }),
    releaseHallTickets: build.mutation<{ detail: string; released_at: string; schedule: ExamTimetableRecord }, number>({
      query: (scheduleId) => ({ url: `/exam-schedules/${scheduleId}/release-hall-tickets/`, method: 'POST' }),
      invalidatesTags: ['Exam', 'Notification'],
    }),
    getHallTickets: build.query<{ status: string; is_released: boolean; released_at?: string | null; message?: string; schedule_id?: number; schedule_name?: string; class_name?: string; hall_tickets: any[] }, number>({
      query: (scheduleId) => ({ url: `/exam-schedules/${scheduleId}/hall-tickets/` }),
      providesTags: ['Exam'],
    }),
    getMarksSheet: build.query<{
      schedule_id: number;
      schedule_name: string;
      class_name: string;
      academic_year: string;
      section: string;
      sections: string[];
      all_sections: string[];
      subjects: Array<{
        subject_name: string;
        max_marks: number;
        exam_date?: string | null;
        start_time?: string | null;
        end_time?: string | null;
        teacher_name?: string;
        can_edit: boolean;
        marks_entry_open?: boolean;
        marks_entry_completed?: boolean;
        marks_entry_expired?: boolean;
        marks_entry_extended?: boolean;
        marks_entry_deadline?: string | null;
        marks_entry_reason?: string;
        days_remaining?: number | null;
      }>;
      students: Array<{
        student_id: number;
        student_name: string;
        admission_no: string;
        roll_no: number;
        photo_url: string;
        marks: Record<string, { marks_obtained: string | number; remarks: string; status: string; can_edit: boolean }>;
      }>;
      is_admin: boolean;
      all_published: boolean;
      teacher_subjects: string[];
      assigned_teachers?: Array<{ teacher_id: number; teacher_name: string; teacher_email?: string; subject_name: string; section: string }>;
      section_teachers?: Array<{ teacher_id: number; teacher_name: string; teacher_email?: string; subject_name?: string; section?: string }>;
      section_extensions?: Record<string, any>;
      subject_extensions?: Record<string, any>;
      marks_entry_days?: number;
      marks_entry_deadline?: string | null;
      marks_entry_extended?: boolean;
      marks_entry_extension_reason?: string;
      marks_entry_extended_at?: string | null;
      overall_marks_entry_open?: boolean;
      overall_marks_entry_reason?: string;
      overall_days_remaining?: number | null;
      section_extended?: boolean;
    }, { scheduleId: number; section?: string }>({
      query: ({ scheduleId, section }) => ({
        url: `/exam-schedules/${scheduleId}/marks-sheet/${section ? `?section=${encodeURIComponent(section)}` : ''}`,
      }),
      providesTags: ['ExamResult', 'Exam'],
    }),
    saveMarksSheet: build.mutation<{ detail: string; updated: number }, { scheduleId: number; section: string; status?: 'draft' | 'submitted'; entries: Array<{ student_id: number; subject_name: string; marks_obtained: string | number | null; remarks?: string }> }>({
      query: ({ scheduleId, ...body }) => ({
        url: `/exam-schedules/${scheduleId}/save-marks-sheet/`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['ExamResult', 'Exam'],
    }),
    publishMarksSheet: build.mutation<{ detail: string; updated: number }, { scheduleId: number; section?: string }>({
      query: ({ scheduleId, section }) => ({
        url: `/exam-schedules/${scheduleId}/publish-marks-sheet/`,
        method: 'POST',
        body: { section },
      }),
      invalidatesTags: ['ExamResult', 'Exam', 'Notification'],
    }),
    extendMarksEntry: build.mutation<{
      detail: string;
      schedule_id: number;
      section?: string;
      subject?: string;
      marks_entry_deadline: string;
      marks_entry_extended: boolean;
      marks_entry_extension_reason: string;
      section_extensions?: Record<string, any>;
    }, {
      scheduleId: number;
      section?: string;
      subject?: string;
      extension_days?: number;
      deadline?: string;
      reason?: string;
    }>({
      query: ({ scheduleId, ...body }) => ({
        url: `/exam-schedules/${scheduleId}/extend-marks-entry/`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Exam', 'ExamResult', 'Notification'],
    }),
    resetMarksEntry: build.mutation<{ detail: string; schedule_id: number; section?: string; subject?: string }, { scheduleId: number; section?: string; subject?: string } | number>({
      query: (arg) => {
        const scheduleId = typeof arg === 'number' ? arg : arg.scheduleId;
        const section = typeof arg === 'object' ? arg.section : undefined;
        const subject = typeof arg === 'object' ? arg.subject : undefined;
        return {
          url: `/exam-schedules/${scheduleId}/reset-marks-entry/`,
          method: 'POST',
          body: { section, subject },
        };
      },
      invalidatesTags: ['Exam', 'ExamResult'],
    }),
    generateReportCards: build.mutation<{ detail: string; schedule_id: number; report_cards_generated: boolean }, number>({
      query: (scheduleId) => ({ url: `/exam-schedules/${scheduleId}/generate-report-cards/`, method: 'POST' }),
      invalidatesTags: ['Exam', 'ExamResult'],
    }),
    publishReportCards: build.mutation<{ detail: string; published_at: string; schedule: ExamTimetableRecord }, number>({
      query: (scheduleId) => ({ url: `/exam-schedules/${scheduleId}/publish-report-cards/`, method: 'POST' }),
      invalidatesTags: ['Exam', 'ExamResult', 'Notification'],
    }),
    getReportCards: build.query<{
      status: string;
      marks_published?: boolean;
      marks_published_at?: string | null;
      is_published: boolean;
      is_generated?: boolean;
      published_at?: string | null;
      message?: string;
      schedule_id?: number;
      schedule_name?: string;
      class_name?: string;
      report_cards: any[];
    }, number>({
      query: (scheduleId) => ({ url: `/exam-schedules/${scheduleId}/report-cards/` }),
      providesTags: ['Exam', 'ExamResult'],
    }),
    getExamResults: build.query<ExamResultRecord[], number>({
      query: (examId) => ({ url: `/exams/${examId}/results/` }),
      providesTags: ['ExamResult'],
    }),
    submitExamResults: build.mutation<{ updated: number }, { examId: number; results: Array<{ studentId: number; marksObtained?: number | null; remarks?: string; status?: string }> }>({
      query: ({ examId, results }) => ({
        url: `/exams/${examId}/results/submit/`,
        method: 'POST',
        body: { results },
      }),
      invalidatesTags: ['ExamResult'],
    }),
  }),
});

export const {
  useGetExamsQuery,
  useCreateExamMutation,
  useDeleteExamMutation,
  useGetExamSchedulesQuery,
  useCreateExamScheduleMutation,
  useUpdateExamScheduleMutation,
  usePublishExamScheduleMutation,
  useUnpublishExamScheduleMutation,
  useDeleteExamScheduleMutation,
  useGenerateHallTicketsMutation,
  useReleaseHallTicketsMutation,
  useGetHallTicketsQuery,
  useGetMarksSheetQuery,
  useSaveMarksSheetMutation,
  usePublishMarksSheetMutation,
  useExtendMarksEntryMutation,
  useResetMarksEntryMutation,
  useGenerateReportCardsMutation,
  usePublishReportCardsMutation,
  useGetReportCardsQuery,
  useGetExamResultsQuery,
  useSubmitExamResultsMutation,
} = examApi;
