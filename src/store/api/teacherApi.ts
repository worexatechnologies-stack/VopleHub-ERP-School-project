import { baseApi } from './baseApi';
import { waitForImportBatch } from './importQueue';

export interface TeacherApiDocument {
  id: number;
  name: string;
  category?: string;
  status: 'Pending' | 'Verified' | 'Rejected' | 'Uploaded' | string;
  remarks?: string;
  fileType: string;
  fileName?: string;
  downloadUrl?: string;
  uploadedAt?: string;
  verifiedAt?: string;
  verifiedByName?: string;
}

export interface TeacherApiAssignment {
  id?: number;
  sectionId: number;
  subjectId: number;
  classId?: number;
  className?: string;
  sectionName?: string;
  subjectName?: string;
}

export interface TeacherRecord {
  id: number;
  userId?: number;
  name: string;
  email: string;
  phone: string;
  subjects: string[];
  subjectIds?: number[];
  assignedSections: string[];
  assignedSectionIds?: number[];
  managedClasses?: Array<{ id: number; name: string; code?: string }>;
  managedClassIds?: number[];
  managedSectionIds?: number[];
  qualification: string;
  salary?: string | number | null;
  joiningDate: string;
  status: 'Active' | 'Inactive';
  isOnline?: boolean;
  photoUrl?: string;
  username?: string;
  teachingAssignments?: TeacherApiAssignment[];
  documents?: TeacherApiDocument[];
}

export interface TeacherCredentials {
  username: string;
  password: string;
  userId: number;
  mustChangePassword: boolean;
}

export interface TeacherCreationResponse extends TeacherRecord {
  loginCredentials?: TeacherCredentials;
  photoUrl?: string;
}

type Page<T> = { next?: string | null; results?: T[] } | T[];

function unwrapPage<T>(payload: Page<T>): T[] {
  return Array.isArray(payload) ? payload : payload.results || [];
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

export const teacherApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getTeachers: build.query<TeacherRecord[], void>({
      queryFn: (_arg, _api, _extra, baseQuery) => fetchAllPages<TeacherRecord>('/teachers/', baseQuery),
      providesTags: ['Teacher'],
    }),
    getTeacherStats: build.query<{ totalTeachers: number; activeTeachers: number }, void>({
      query: () => ({ url: '/teachers/stats/' }),
      providesTags: ['Teacher'],
    }),
    getTeacher: build.query<TeacherRecord, number>({
      query: (id) => `/teachers/${id}/`,
      providesTags: (_res, _err, id) => [{ type: 'Teacher', id }],
    }),
    getTeacherDocuments: build.query<TeacherApiDocument[], number>({
      query: (teacherId) => `/teachers/${teacherId}/documents/`,
      transformResponse: (res: Page<TeacherApiDocument>) => unwrapPage(res),
      providesTags: ['Teacher'],
    }),
    createTeacher: build.mutation<TeacherCreationResponse, FormData>({
      query: (body) => ({ url: '/teachers/', method: 'POST', body }),
      invalidatesTags: ['Teacher', 'Class', 'Section', 'Auth', 'CredentialVault'],
    }),
    updateTeacher: build.mutation<TeacherRecord, { id: number; body: FormData | Partial<TeacherRecord> }>({
      query: ({ id, body }) => ({ url: `/teachers/${id}/`, method: 'PATCH', body }),
      invalidatesTags: ['Teacher', 'Class', 'Section', 'Auth', 'CredentialVault'],
    }),
    deleteTeacher: build.mutation<void, number>({
      query: (id) => ({ url: `/teachers/${id}/`, method: 'DELETE' }),
      invalidatesTags: ['Teacher', 'Class', 'Section', 'Auth', 'CredentialVault'],
    }),
    addTeachingAssignment: build.mutation<TeacherRecord, { teacherId: number; sectionId: number; subjectId: number }>({
      query: ({ teacherId, sectionId, subjectId }) => ({
        url: `/teachers/${teacherId}/teaching-assignments/`,
        method: 'POST',
        body: { sectionId, subjectId },
      }),
      invalidatesTags: ['Teacher'],
    }),
    uploadTeacherDocument: build.mutation<TeacherApiDocument, { teacherId: number; body: FormData }>({
      query: ({ teacherId, body }) => ({ url: `/teachers/${teacherId}/documents/`, method: 'POST', body }),
      invalidatesTags: ['Teacher'],
    }),
    verifyTeacherDocument: build.mutation<
      TeacherApiDocument,
      { teacherId: number; docId: number; status: 'Verified' | 'Rejected' | 'Pending'; remarks?: string }
    >({
      query: ({ teacherId, docId, status, remarks }) => ({
        url: `/teachers/${teacherId}/documents/${docId}/`,
        method: 'PATCH',
        body: { status, remarks },
      }),
      invalidatesTags: ['Teacher'],
    }),
    deleteTeacherDocument: build.mutation<void, { teacherId: number; docId: number }>({
      query: ({ teacherId, docId }) => ({ url: `/teachers/${teacherId}/documents/${docId}/`, method: 'DELETE' }),
      invalidatesTags: ['Teacher'],
    }),
    bulkImportTeachers: build.mutation<
      {
        success: boolean;
        jobId?: string;
        batchNumber?: number;
        totalBatches?: number;
        durationMs?: number;
        totalProcessed?: number;
        attemptedRows?: number;
        createdCount: number;
        skippedCount: number;
        errorCategory?: string;
        detail?: string;
        createdTeachers?: TeacherRecord[];
        credentials?: Array<{ teacherId: number; name: string; email: string; password?: string }>;
        errors?: Array<{ row: number | string; name?: string; reason: string }>;
      },
      {
        teachers?: any[];
        file?: File;
        columnMapping?: Record<string, number>;
        jobId?: string;
        batchNumber?: number;
        totalBatches?: number;
        batchSize?: number;
      } | FormData
    >({
      queryFn: async (arg, api, _extraOptions, baseQuery) => {
        if (arg instanceof FormData) {
          return baseQuery({ url: '/teachers/bulk-import/', method: 'POST', body: arg }) as any;
        }
        if (arg.file) {
          const fd = new FormData();
          fd.append('file', arg.file);
          if (arg.columnMapping) fd.append('column_mapping', JSON.stringify(arg.columnMapping));
          if (arg.jobId) fd.append('jobId', arg.jobId);
          if (arg.batchNumber != null) fd.append('batchNumber', String(arg.batchNumber));
          if (arg.totalBatches != null) fd.append('totalBatches', String(arg.totalBatches));
          if (arg.batchSize != null) fd.append('batchSize', String(arg.batchSize));
          return baseQuery({ url: '/teachers/bulk-import/', method: 'POST', body: fd }) as any;
        }
        const submitted = await baseQuery({
          url: '/teachers/bulk-import/',
          method: 'POST',
          body: {
            teachers: arg.teachers,
            jobId: arg.jobId,
            batchNumber: arg.batchNumber,
            totalBatches: arg.totalBatches,
            batchSize: arg.batchSize,
            async_import: true,
          },
        });
        if (submitted.error) return { error: submitted.error };
        const accepted = submitted.data as { queued?: boolean; jobId?: string; batchNumber?: number };
        if (!accepted.queued || !accepted.jobId || !accepted.batchNumber) return { data: submitted.data };
        return waitForImportBatch(
          baseQuery,
          `/teachers/bulk-import/status/?jobId=${encodeURIComponent(accepted.jobId)}&batchNumber=${accepted.batchNumber}`,
          accepted,
          api.signal,
        );
      },
      invalidatesTags: ['Teacher', 'Class', 'Section', 'Auth', 'CredentialVault'],
    }),
  }),
});

export const {
  useGetTeachersQuery,
  useGetTeacherStatsQuery,
  useGetTeacherQuery,
  useGetTeacherDocumentsQuery,
  useCreateTeacherMutation,
  useBulkImportTeachersMutation,
  useUpdateTeacherMutation,
  useDeleteTeacherMutation,
  useAddTeachingAssignmentMutation,
  useUploadTeacherDocumentMutation,
  useVerifyTeacherDocumentMutation,
  useDeleteTeacherDocumentMutation,
} = teacherApi;
