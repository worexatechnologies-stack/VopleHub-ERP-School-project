import { baseApi } from './baseApi';

export type AttendanceStatus = 'Present' | 'Absent' | 'Late' | 'Half-day';

export interface AttendanceRecord {
  id: number;
  studentId: number;
  studentName?: string;
  date: string;
  dayOfWeek?: string;
  period: number;
  timeLabel?: string;
  subjectId?: number | null;
  subjectName?: string;
  teacherId?: number | null;
  teacherName?: string;
  status: AttendanceStatus;
  markedByName?: string;
  schoolId?: number;
  updated_at?: string;
}

export interface AttendanceAuditLog {
  id: number;
  studentId: number;
  studentName?: string;
  period: number;
  subjectName?: string;
  dayOfWeek?: string;
  old_status: AttendanceStatus | null;
  new_status: AttendanceStatus;
  changedByName: string;
  reason?: string;
  created_at: string;
}

export interface PeriodSummaryReport {
  period: number;
  timeLabel: string;
  subjectId: number | null;
  subjectName: string;
  teacherId: number | null;
  teacherName: string;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  halfDayCount: number;
  totalStudents: number;
  isEditable: boolean;
}

export interface DayOfWeekAnalysis {
  day: string;
  total: number;
  present: number;
  absent: number;
  late: number;
  halfDay: number;
  attendanceRate: number;
}

export interface AttendanceAnalyticsResponse {
  totalDbRecords: number;
  dayOfWeekAnalysis: DayOfWeekAnalysis[];
  subjectAnalysis: { subjectId: number; subjectName: string; totalSessions: number; attendanceRate: number }[];
  periodAnalysis: { period: number; totalRecords: number; attendanceRate: number }[];
}

type Page<T> = { next?: string | null; results?: T[] } | T[];

function unwrapPage<T>(payload: Page<T>): T[] {
  return Array.isArray(payload) ? payload : payload.results || [];
}

export const attendanceApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getAttendance: build.query<AttendanceRecord[], { date?: string; day_of_week?: string; period?: number; subject_id?: number; class_name?: string; section?: string; student_id?: number; status?: AttendanceStatus } | void>({
      query: (params) => ({
        url: '/attendance/',
        params: params ? {
          date: params.date,
          day_of_week: params.day_of_week,
          period: params.period,
          subject_id: params.subject_id,
          class_name: params.class_name,
          section: params.section,
          student_id: params.student_id,
          status: params.status,
        } : undefined,
      }),
      transformResponse: (response: Page<AttendanceRecord>) => unwrapPage(response),
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: 'Attendance' as const, id })),
              { type: 'Attendance', id: 'LIST' },
            ]
          : [{ type: 'Attendance', id: 'LIST' }],
    }),
    markAttendance: build.mutation<AttendanceRecord, { studentId: number; date: string; period?: number; subjectId?: number; status: AttendanceStatus; reason?: string }>({
      query: (body) => ({
        url: '/attendance/mark/',
        method: 'PUT',
        body,
      }),
      invalidatesTags: [{ type: 'Attendance', id: 'LIST' }],
    }),
    bulkMarkAttendance: build.mutation<
      { success: boolean; count: number; message: string },
      {
        studentIds?: number[];
        periods?: number[];
        date: string;
        status?: AttendanceStatus;
        items?: Array<{ studentId: number; period: number; status: AttendanceStatus; subjectId?: number }>;
      }
    >({
      query: (body) => ({
        url: '/attendance/bulk-mark/',
        method: 'POST',
        body,
      }),
      invalidatesTags: [{ type: 'Attendance', id: 'LIST' }],
    }),
    getAttendanceReport: build.query<PeriodSummaryReport[], { date?: string; class_name?: string; section?: string }>({
      query: (params) => ({
        url: '/attendance/report/',
        params,
      }),
      providesTags: [{ type: 'Attendance', id: 'LIST' }],
    }),
    getAttendanceAnalytics: build.query<AttendanceAnalyticsResponse, { class_name?: string; section?: string } | void>({
      query: (params) => ({
        url: '/attendance/analytics/',
        params: params ? { class_name: params.class_name, section: params.section } : undefined,
      }),
      providesTags: [{ type: 'Attendance', id: 'LIST' }],
    }),
    getAuditLogs: build.query<AttendanceAuditLog[], { studentId?: number; date?: string; day_of_week?: string; period?: number } | void>({
      query: (params) => ({
        url: '/attendance/audit-logs/',
        params: params ? { studentId: params.studentId, date: params.date, day_of_week: params.day_of_week, period: params.period } : undefined,
      }),
      transformResponse: (response: Page<AttendanceAuditLog>) => unwrapPage(response),
      providesTags: ['Attendance'],
    }),
  }),
});

export const {
  useGetAttendanceQuery,
  useMarkAttendanceMutation,
  useBulkMarkAttendanceMutation,
  useGetAttendanceReportQuery,
  useGetAttendanceAnalyticsQuery,
  useGetAuditLogsQuery,
} = attendanceApi;