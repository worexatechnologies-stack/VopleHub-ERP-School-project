import { baseApi } from './baseApi';

export interface SchoolRecord {
  id: number;
  schoolName: string;
  code: string;
  subdomain?: string;
  logoIcon?: string;
  logoImageUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  theme?: string;
  is_active?: boolean;
  isDemo?: boolean;
  studentCount?: number;
}

export interface SchoolRecordCounts {
  students: number;
  teachers: number;
}

export interface HallTicketSettings {
  layout: 'classic' | 'compact';
  heading: string;
  accentColor: string;
  showWatermark: boolean;
  showInstructions: boolean;
  footerNote: string;
  logoImageUrl: string;
  showAdmissionNo: boolean;
  showClassSection: boolean;
  showRollNumber: boolean;
  showExamDate: boolean;
  showExamTimings: boolean;
  showMaxMarks: boolean;
  showVenue: boolean;
  showSignatures: boolean;
  controllerSignatureImage: string;
  invigilatorSignatures: Record<string, string>;
  instructions: string[];
  labels: {
    officialBadge: string;
    ticketNumber: string;
    academicSession: string;
    candidateName: string;
    admissionNo: string;
    classSection: string;
    rollNumber: string;
    papersTitle: string;
    subject: string;
    examDate: string;
    examTimings: string;
    maxMarks: string;
    venue: string;
    instructionsTitle: string;
    candidateSignature: string;
    schoolSeal: string;
    controllerSignature: string;
  };
}

type Page<T> = { next?: string | null; results?: T[] } | T[];

export interface PaginatedResult<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

async function fetchAllPages<T>(
  url: string,
  baseQuery: any
): Promise<{ data: T[] } | { error: any }> {
  const rows: T[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const sep = url.includes('?') ? '&' : '?';
    const result = await baseQuery(`${url}${sep}page=${page}`);
    if (result.error) return { error: result.error };
    const payload = result.data as Page<T>;
    if (Array.isArray(payload)) return { data: payload };
    rows.push(...(payload.results || []));
    if (!payload.next) return { data: rows };
  }
  return { data: rows };
}

export interface SchoolDocumentItem {
  id: number;
  docType: 'student' | 'teacher';
  studentId?: number;
  studentName?: string;
  admissionNo?: string;
  className?: string;
  sectionName?: string;
  teacherId?: number;
  teacherName?: string;
  qualification?: string;
  department?: string;
  name: string;
  category: string;
  status: 'Pending' | 'Verified' | 'Rejected';
  remarks?: string;
  fileType: string;
  fileName: string;
  uploadedAt: string;
  verifiedAt?: string | null;
  verifiedByName?: string | null;
  downloadUrl: string;
}

export interface SchoolDocumentsQueueResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: SchoolDocumentItem[];
  documents: SchoolDocumentItem[];
  studentDocuments: SchoolDocumentItem[];
  teacherDocuments: SchoolDocumentItem[];
  summary: {
    totalDocs: number;
    totalPending: number;
    totalVerified: number;
    totalRejected: number;
    totalStudentDocs: number;
    totalTeacherDocs: number;
  };
}

export const schoolApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getPlatformSettings: build.query<Record<string, unknown>, void>({
      query: () => '/super-admin/settings/',
    }),
    savePlatformSetting: build.mutation<{ key: string; value: unknown }, { key: string; value: unknown }>({
      query: (body) => ({ url: '/super-admin/settings/', method: 'PUT', body }),
    }),
    getSchoolsPage: build.query<PaginatedResult<SchoolRecord>, { page: number; page_size?: number; search?: string; is_active?: boolean; is_demo?: boolean; ordering?: string }>({
      query: (params) => ({ url: '/schools/', params }),
      providesTags: ['School'],
    }),
    getSchools: build.query<SchoolRecord[], void>({
      queryFn: (_arg, _api, _extra, baseQuery) => fetchAllPages<SchoolRecord>('/schools/', baseQuery),
      providesTags: ['School'],
    }),
    getSchoolRecordCounts: build.query<Record<string, SchoolRecordCounts>, void>({
      query: () => '/schools/school-counts/',
      providesTags: ['SchoolCounts', 'Teacher', 'School'],
      keepUnusedDataFor: 0,
    }),
    getSchoolDocumentsQueue: build.query<SchoolDocumentsQueueResponse, { page?: number; page_size?: number; school_id?: number; status?: string; docType?: 'student' | 'teacher'; search?: string } | void>({
      query: (params) => ({ url: '/school/documents/queue/', params: params || { page: 1, page_size: 25 } }),
      providesTags: ['StudentDocumentQueue', 'Teacher'],
    }),
    getHallTicketSettings: build.query<HallTicketSettings, void>({
      query: () => '/schools/hall-ticket-settings/',
      providesTags: ['School'],
    }),
    updateHallTicketSettings: build.mutation<HallTicketSettings, FormData>({
      query: (body) => ({ url: '/schools/hall-ticket-settings/', method: 'PATCH', body }),
      invalidatesTags: ['School'],
    }),
    createSchool: build.mutation<SchoolRecord, FormData>({
      query: (body) => ({ url: '/schools/', method: 'POST', body }),
      invalidatesTags: ['School'],
    }),
    updateSchool: build.mutation<SchoolRecord, { id: number; body: FormData | Partial<SchoolRecord> | Record<string, unknown> }>({
      query: ({ id, body }) => ({ url: `/schools/${id}/`, method: 'PATCH', body }),
      invalidatesTags: ['School'],
    }),
    deleteSchool: build.mutation<{ detail: string }, { id: number; confirmation: string }>({
      query: ({ id, confirmation }) => ({
        url: `/schools/${id}/`,
        method: 'DELETE',
        body: { confirmation },
      }),
      invalidatesTags: ['School'],
    }),
  }),
});

export const {
  useGetPlatformSettingsQuery,
  useSavePlatformSettingMutation,
  useGetSchoolsQuery,
  useGetSchoolsPageQuery,
  useGetSchoolRecordCountsQuery,
  useGetSchoolDocumentsQueueQuery,
  useGetHallTicketSettingsQuery,
  useUpdateHallTicketSettingsMutation,
  useCreateSchoolMutation,
  useUpdateSchoolMutation,
  useDeleteSchoolMutation,
} = schoolApi;
