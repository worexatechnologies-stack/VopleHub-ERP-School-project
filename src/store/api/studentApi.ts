import { baseApi } from './baseApi';
import { waitForImportBatch } from './importQueue';
import type { Student, StudentDocument } from '../../types';

type Page<T> = { next?: string | null; results?: T[] } | T[];

function unwrapPage<T>(payload: Page<T>): T[] {
  return Array.isArray(payload) ? payload : payload.results || [];
}

export interface StudentApiRecord {
  id: string | number;
  admissionNo: string;
  name: string;
  class?: string;
  class_?: string;
  classId?: number;
  section?: string;
  sectionId?: number;
  rollNo: number;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  dob: string;
  gender: string;
  address?: string;
  medicalConditions?: string;
  medical_conditions?: string;
  qrCodeData?: string;
  status: 'Active' | 'Promoted' | 'TC_Issued';
  academicYear: string;
  attendancePercentage?: string | number | null;
  feeTotal?: string | number | null;
  feePaid?: string | number | null;
  gpa?: string | number | null;
  documents?: Student['documents'];
  history?: Student['history'];
  photoUrl?: string;
  bloodGroup?: string;
  aadhaar?: string;
  fatherName?: string;
  motherName?: string;
  loginCredentials?: {
    student?: { email: string; temporaryPassword?: string; userId: number };
    parent?: { email: string; temporaryPassword?: string; message?: string; created?: boolean; userId?: number };
  };
}

export function normalizeStudent(student: StudentApiRecord): Student {
  return {
    id: String(student.id),
    admissionNo: student.admissionNo,
    name: student.name,
    class: student.class || student.class_ || '',
    classId: student.classId,
    section: student.section || '',
    sectionId: student.sectionId,
    rollNo: student.rollNo,
    parentName: student.parentName,
    parentPhone: student.parentPhone,
    parentEmail: student.parentEmail,
    dob: student.dob,
    gender: student.gender,
    address: student.address || '',
    medicalConditions: student.medicalConditions || student.medical_conditions || '',
    qrCodeData: student.qrCodeData || `SCH-ERP-${student.id}`,
    status: student.status,
    academicYear: student.academicYear,
    attendancePercentage: student.attendancePercentage == null ? undefined : Number(student.attendancePercentage),
    feeTotal: student.feeTotal == null ? undefined : Number(student.feeTotal),
    feePaid: student.feePaid == null ? undefined : Number(student.feePaid),
    gpa: student.gpa == null ? undefined : Number(student.gpa),
    documents: student.documents,
    history: student.history,
    photoUrl: student.photoUrl,
    bloodGroup: student.bloodGroup,
    aadhaar: student.aadhaar,
    fatherName: student.fatherName,
    motherName: student.motherName,
  };
}

export interface StudentStats {
  totalStudents: number;
  activeStudents?: number;
  promotedStudents?: number;
  tcStudents?: number;
  boysCount: number;
  girlsCount: number;
  avgAttendance: number | null;
  totalFee: number;
  paidFee: number;
  feeStatusPercent: number;
}

export interface PaginatedStudentsResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Student[];
  totalPages: number;
  currentPage: number;
  pageSize: number;
}

const studentRosterTags = (students: Student[] | undefined) => [
  { type: 'StudentRoster' as const, id: 'LIST' },
  ...(students || []).map((student) => ({ type: 'StudentRoster' as const, id: String(student.id) })),
];

const studentRosterChanged = [
  { type: 'StudentRoster' as const, id: 'LIST' },
  { type: 'StudentStats' as const, id: 'LIST' },
];

export const studentApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getStudents: build.query<
      Student[],
      {
        page?: number;
        page_size?: number;
        search?: string;
        class_name?: string;
        section?: string;
        academic_year?: string;
        status?: string;
      } | void
    >({
      query: (params) => {
        if (!params) return { url: '/students/' };
        const sp = new URLSearchParams();
        if (params.page) sp.append('page', String(params.page));
        if (params.page_size) sp.append('page_size', String(params.page_size));
        if (params.search) sp.append('search', params.search);
        if (params.class_name && params.class_name !== 'All') sp.append('class_name', params.class_name);
        if (params.section && params.section !== 'All') sp.append('section', params.section);
        if (params.academic_year && params.academic_year !== 'All') sp.append('academic_year', params.academic_year);
        if (params.status && params.status !== 'All') sp.append('status', params.status);
        const qs = sp.toString();
        return { url: `/students/${qs ? `?${qs}` : ''}` };
      },
      transformResponse: (response: Page<StudentApiRecord>) => unwrapPage(response).map(normalizeStudent),
      providesTags: (students) => studentRosterTags(students),
    }),
    getStudentStats: build.query<
      StudentStats,
      {
        academic_year?: string;
        class_name?: string;
        section?: string;
      } | void
    >({
      query: (params) => {
        if (!params) return { url: '/students/stats/' };
        const sp = new URLSearchParams();
        if (params.academic_year && params.academic_year !== 'All') sp.append('academic_year', params.academic_year);
        if (params.class_name && params.class_name !== 'All') sp.append('class_name', params.class_name);
        if (params.section && params.section !== 'All') sp.append('section', params.section);
        const qs = sp.toString();
        return { url: `/students/stats/${qs ? `?${qs}` : ''}` };
      },
      providesTags: [{ type: 'StudentStats', id: 'LIST' }],
    }),
    getStudentsPaginated: build.query<
      PaginatedStudentsResponse,
      {
        page?: number;
        page_size?: number;
        search?: string;
        class_name?: string;
        section?: string;
        academic_year?: string;
        status?: string;
        ordering?: string;
      } | void
    >({
      query: (params) => {
        const p = params || {};
        const sp = new URLSearchParams();
        sp.append('page', String(p.page || 1));
        sp.append('page_size', String(p.page_size || 100));
        if (p.search) sp.append('search', p.search);
        if (p.class_name && p.class_name !== 'All') sp.append('class_name', p.class_name);
        if (p.section && p.section !== 'All') sp.append('section', p.section);
        if (p.academic_year && p.academic_year !== 'All') sp.append('academic_year', p.academic_year);
        if (p.status && p.status !== 'All') sp.append('status', p.status);
        if (p.ordering) sp.append('ordering', p.ordering);
        const qs = sp.toString();
        return { url: `/students/?${qs}` };
      },
      transformResponse: (
        response: { count?: number; next?: string | null; previous?: string | null; results?: StudentApiRecord[] } | StudentApiRecord[],
        _meta,
        arg
      ) => {
        const pageSize = (arg && arg.page_size) || 100;
        const page = (arg && arg.page) || 1;
        if (Array.isArray(response)) {
          return {
            count: response.length,
            next: null,
            previous: null,
            results: response.map(normalizeStudent),
            totalPages: Math.max(1, Math.ceil(response.length / pageSize)),
            currentPage: page,
            pageSize,
          };
        }
        const count = response.count ?? (response.results?.length || 0);
        const results = (response.results || []).map(normalizeStudent);
        return {
          count,
          next: response.next ?? null,
          previous: response.previous ?? null,
          results,
          totalPages: Math.max(1, Math.ceil(count / pageSize)),
          currentPage: page,
          pageSize,
        };
      },
      providesTags: (response) => studentRosterTags(response?.results),
    }),
    getStudent: build.query<Student, string>({
      query: (id) => ({ url: `/students/${id}/` }),
      transformResponse: (response: StudentApiRecord) => normalizeStudent(response),
      providesTags: (_response, _error, id) => [{ type: 'Student', id }],
    }),
    createStudent: build.mutation<StudentApiRecord, FormData>({
      query: (body) => ({ url: '/students/', method: 'POST', body }),
      invalidatesTags: [
        ...studentRosterChanged,
        'SchoolCounts',
        { type: 'FeeRecords', id: 'LIST' },
        { type: 'FeeSummaries', id: 'LIST' },
        { type: 'FeeRevenue', id: 'LIST' },
        'Auth',
        'CredentialVault',
      ],
    }),
    updateStudent: build.mutation<StudentApiRecord, { id: string; body: FormData }>({
      query: ({ id, body }) => ({ url: `/students/${id}/`, method: 'PATCH', body }),
      invalidatesTags: (response, _error, { id, body }) => {
        const studentId = String(response?.id ?? id);
        const changedFields = new Set(Array.from(body.keys()));
        const affectsRosterMembership = [
          'name', 'class_', 'section', 'sectionId', 'rollNo', 'parentName', 'parentPhone', 'parentEmail',
          'status', 'academicYear', 'gender', 'admissionNo',
        ].some((field) => changedFields.has(field));
        const affectsStats = [
          'class_', 'section', 'sectionId', 'status', 'academicYear', 'gender',
          'attendancePercentage', 'feeTotal', 'feePaid',
        ].some((field) => changedFields.has(field));
        const affectsFeeViews = [
          'feeTotal', 'feePaid', 'name', 'admissionNo', 'class_', 'section', 'sectionId', 'academicYear', 'status',
        ].some((field) => changedFields.has(field));
        const affectsFeeFiltering = ['class_', 'section', 'sectionId', 'academicYear'].some((field) => changedFields.has(field));

        return [
          { type: 'Student', id: studentId },
          { type: 'StudentRoster', id: studentId },
          ...(affectsRosterMembership ? [{ type: 'StudentRoster' as const, id: 'LIST' }] : []),
          ...(affectsStats
            ? [{ type: 'StudentStats' as const, id: 'LIST' }]
            : []),
          ...(affectsFeeViews
            ? [
                { type: 'FeeRecords' as const, id: affectsFeeFiltering ? 'LIST' : studentId },
                { type: 'FeeSummary' as const, id: studentId },
                { type: 'FeeSummaries' as const, id: affectsFeeFiltering ? 'LIST' : studentId },
                ...(['name', 'admissionNo'].some((field) => changedFields.has(field))
                  ? [{ type: 'FeeRevenue' as const, id: 'LIST' }]
                  : []),
              ]
            : []),
        ];
      },
    }),
    deleteStudent: build.mutation<void, string>({
      query: (id) => ({ url: `/students/${id}/`, method: 'DELETE' }),
      invalidatesTags: (_response, _error, id) => [
        ...studentRosterChanged,
        'SchoolCounts',
        { type: 'Student', id },
        { type: 'FeeRecords', id: 'LIST' },
        { type: 'FeeSummary', id },
        { type: 'FeeSummaries', id: 'LIST' },
        { type: 'FeeRevenue', id: 'LIST' },
        'Auth',
        'CredentialVault',
      ],
    }),
    deleteAllStudents: build.mutation<
      { success: boolean; deletedCount: number; message: string },
      { adminPassword: string; adminEmail?: string }
    >({
      query: (body) => ({
        url: '/students/delete-all/',
        method: 'POST',
        body,
      }),
      invalidatesTags: [
        ...studentRosterChanged,
        'SchoolCounts',
        'Student',
        { type: 'FeeRecords', id: 'LIST' },
        'FeeSummary',
        { type: 'FeeSummaries', id: 'LIST' },
        { type: 'FeeRevenue', id: 'LIST' },
        'Auth',
        'CredentialVault',
      ],
    }),
    bulkImportStudents: build.mutation<
      BulkImportResponse,
      {
        students?: any[];
        file?: File;
        academicYear?: string;
        columnMapping?: Record<string, number>;
        jobId?: string;
        batchNumber?: number;
        totalBatches?: number;
        batchSize?: number;
      } | FormData
    >({
      queryFn: async (arg, api, _extraOptions, baseQuery) => {
        if (arg instanceof FormData) {
          return baseQuery({ url: '/students/bulk-import/', method: 'POST', body: arg }) as any;
        }
        if (arg.file) {
          const fd = new FormData();
          fd.append('file', arg.file);
          if (arg.academicYear) fd.append('academicYear', arg.academicYear);
          if (arg.columnMapping) fd.append('column_mapping', JSON.stringify(arg.columnMapping));
          if (arg.jobId) fd.append('jobId', arg.jobId);
          if (arg.batchNumber != null) fd.append('batchNumber', String(arg.batchNumber));
          if (arg.totalBatches != null) fd.append('totalBatches', String(arg.totalBatches));
          if (arg.batchSize != null) fd.append('batchSize', String(arg.batchSize));
          return baseQuery({ url: '/students/bulk-import/', method: 'POST', body: fd }) as any;
        }
        const submitted = await baseQuery({
          url: '/students/bulk-import/',
          method: 'POST',
          body: {
            students: arg.students,
            academicYear: arg.academicYear,
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
          `/students/bulk-import/status/?jobId=${encodeURIComponent(accepted.jobId)}&batchNumber=${accepted.batchNumber}`,
          accepted,
          api.signal,
        );
      },
      invalidatesTags: [
        ...studentRosterChanged,
        'SchoolCounts',
        { type: 'FeeRecords', id: 'LIST' },
        { type: 'FeeSummaries', id: 'LIST' },
        { type: 'FeeRevenue', id: 'LIST' },
        'Auth',
        'CredentialVault',
      ],
    }),
    getStudentDocuments: build.query<StudentDocument[], string>({
      query: (studentId) => ({ url: `/students/${studentId}/documents/` }),
      providesTags: (_response, _error, studentId) => [{ type: 'StudentDocument', id: studentId }],
    }),
    uploadStudentDocument: build.mutation<StudentDocument, { studentId: string; body: FormData }>({
      query: ({ studentId, body }) => ({ url: `/students/${studentId}/documents/`, method: 'POST', body }),
      invalidatesTags: (_response, _error, { studentId }) => [
        { type: 'StudentDocument', id: studentId },
        { type: 'StudentDocumentQueue', id: 'LIST' },
      ],
    }),
    deleteStudentDocument: build.mutation<void, { studentId: string; docId: number }>({
      query: ({ studentId, docId }) => ({ url: `/students/${studentId}/documents/${docId}/`, method: 'DELETE' }),
      invalidatesTags: (_response, _error, { studentId }) => [
        { type: 'StudentDocument', id: studentId },
        { type: 'StudentDocumentQueue', id: 'LIST' },
      ],
    }),
    verifyStudentDocument: build.mutation<
      StudentDocument,
      { studentId: string; docId: number; status: 'Verified' | 'Rejected' | 'Pending'; remarks?: string }
    >({
      query: ({ studentId, docId, ...patch }) => ({
        url: `/students/${studentId}/documents/${docId}/`,
        method: 'PATCH',
        body: patch,
      }),
      invalidatesTags: (_response, _error, { studentId }) => [
        { type: 'StudentDocument', id: studentId },
        { type: 'StudentDocumentQueue', id: 'LIST' },
      ],
    }),
    getStudentResults: build.query<unknown[], string>({
      query: (studentId) => ({ url: `/students/${studentId}/results/` }),
    }),
    getPromotionEligibility: build.query<
      {
        studentId: string | number;
        name: string;
        admissionNo: string;
        currentClass: string;
        currentSection: string;
        academicYear: string;
        status: string;
        feeTotal: number;
        feePaid: number;
        feePercentage: number;
        minRequired: number;
        shortfall: number;
        isEligible: boolean;
      },
      string
    >({
      query: (studentId) => ({ url: `/students/${studentId}/promotion-eligibility/` }),
      providesTags: (_response, _error, studentId) => [{ type: 'Student', id: studentId }],
    }),
    promoteStudent: build.mutation<
      StudentApiRecord,
      {
        id: string | number;
        nextClass: string;
        nextSection?: string;
        nextAcademicYear?: string;
        adminApproved?: boolean;
        allowFeeWaiver?: boolean;
        waiverReason?: string;
      }
    >({
      query: ({ id, ...body }) => ({
        url: `/students/${id}/promote/`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (response, _error, { id }) => [
        ...studentRosterChanged,
        { type: 'Student', id: String(response?.id ?? id) },
        { type: 'FeeRecords', id: 'LIST' },
        { type: 'FeeSummary', id: String(response?.id ?? id) },
        { type: 'FeeSummaries', id: String(response?.id ?? id) },
        { type: 'FeeRevenue', id: 'LIST' },
      ],
    }),
    getEnrollmentLinks: build.query<EnrollmentLinkItem[], void>({
      query: () => ({ url: '/enrollment-links/' }),
      transformResponse: (res: Page<EnrollmentLinkItem>) => unwrapPage(res),
      providesTags: [{ type: 'EnrollmentLinks', id: 'LIST' }],
    }),
    createEnrollmentLink: build.mutation<
      EnrollmentLinkItem,
      { title?: string; targetClass?: string; academicYear?: string; durationMinutes?: number }
    >({
      query: (body) => ({
        url: '/enrollment-links/',
        method: 'POST',
        body,
      }),
      invalidatesTags: [{ type: 'EnrollmentLinks', id: 'LIST' }],
    }),
    deactivateEnrollmentLink: build.mutation<EnrollmentLinkItem, string | number>({
      query: (id) => ({
        url: `/enrollment-links/${id}/deactivate/`,
        method: 'POST',
      }),
      invalidatesTags: [{ type: 'EnrollmentLinks', id: 'LIST' }],
    }),
    getEnrollmentApplications: build.query<EnrollmentApplicationItem[], { status?: string } | void>({
      query: (params) => ({
        url: '/enrollment-applications/',
        params: params?.status ? { status: params.status } : undefined,
      }),
      transformResponse: (res: Page<EnrollmentApplicationItem>) => unwrapPage(res),
      providesTags: [{ type: 'EnrollmentApplications', id: 'LIST' }],
    }),
    approveEnrollmentApplication: build.mutation<
      { message: string; student: StudentApiRecord; application: EnrollmentApplicationItem },
      { id: number | string; admissionNo?: string; rollNo?: number; className?: string; section?: string }
    >({
      query: ({ id, ...body }) => ({
        url: `/enrollment-applications/${id}/approve/`,
        method: 'POST',
        body,
      }),
      invalidatesTags: [
        ...studentRosterChanged,
        'SchoolCounts',
        { type: 'EnrollmentApplications', id: 'LIST' },
        { type: 'FeeRecords', id: 'LIST' },
        { type: 'FeeSummaries', id: 'LIST' },
        { type: 'FeeRevenue', id: 'LIST' },
        'Auth',
      ],
    }),
    rejectEnrollmentApplication: build.mutation<
      EnrollmentApplicationItem,
      { id: number | string; remarks?: string }
    >({
      query: ({ id, ...body }) => ({
        url: `/enrollment-applications/${id}/reject/`,
        method: 'POST',
        body,
      }),
      invalidatesTags: [{ type: 'EnrollmentApplications', id: 'LIST' }],
    }),
    verifyEnrollmentLink: build.query<VerifyEnrollmentResponse, string>({
      query: (token) => ({
        url: `/enrollment/verify/?token=${encodeURIComponent(token)}`,
      }),
    }),
    submitEnrollmentApplication: build.mutation<SubmitEnrollmentResponse, FormData | Record<string, any>>({
      query: (body) => ({
        url: '/enrollment/submit/',
        method: 'POST',
        body,
      }),
      invalidatesTags: [{ type: 'EnrollmentApplications', id: 'LIST' }],
    }),
  }),
});

export interface EnrollmentLinkItem {
  id: string;
  token: string;
  title: string;
  targetClass: string;
  academicYear: string;
  durationMinutes: number;
  createdAt: string;
  firstOpenedAt: string | null;
  is_active: boolean;
  isExpired: boolean;
  remainingSeconds: number;
  applicationCount: number;
  schoolName: string;
  schoolCode: string;
}

export interface EnrollmentApplicationItem {
  id: number;
  applicationNo: string;
  name: string;
  className: string;
  section: string;
  dob: string;
  gender: string;
  bloodGroup: string;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  address: string;
  aadhaarNo: string;
  medicalConditions: string;
  academicYear: string;
  provisionalUsername: string;
  provisionalEmail: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  submittedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  rejectionRemarks: string;
  createdStudentId: number | null;
  hasPhoto: boolean;
  photoUrl?: string;
  hasDocument?: boolean;
  documentUrl?: string;
  documentName?: string;
  documentCategory?: string;
}

export interface VerifyEnrollmentResponse {
  valid: boolean;
  token: string;
  title: string;
  schoolName: string;
  schoolCode: string;
  targetClass: string;
  academicYear: string;
  durationMinutes: number;
  remainingSeconds: number;
  firstOpenedAt: string;
  availableClasses: string[];
  availableSections: string[];
}

export interface SubmitEnrollmentResponse {
  success: boolean;
  message: string;
  applicationNo: string;
  studentName: string;
  className: string;
  section: string;
  academicYear: string;
  credentials: {
    username: string;
    loginId: string;
    temporaryPassword: string;
    mustChangePassword: boolean;
    status: string;
    activationNotice: string;
  };
}

export interface BulkImportResponse {
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
  createdStudents?: StudentApiRecord[];
  credentials?: Array<{
    studentId: number | string;
    name: string;
    admissionNo: string;
    className: string;
    studentEmail?: string;
    studentPassword?: string;
    parentEmail?: string;
    parentPassword?: string;
  }>;
  errors?: Array<{
    row: number | string;
    name?: string;
    reason: string;
  }>;
}

export const {
  useGetStudentsQuery,
  useGetStudentStatsQuery,
  useGetStudentsPaginatedQuery,
  useGetStudentQuery,
  useCreateStudentMutation,
  useBulkImportStudentsMutation,
  useUpdateStudentMutation,
  useDeleteStudentMutation,
  useDeleteAllStudentsMutation,
  useGetStudentDocumentsQuery,
  useUploadStudentDocumentMutation,
  useDeleteStudentDocumentMutation,
  useVerifyStudentDocumentMutation,
  useGetStudentResultsQuery,
  useGetPromotionEligibilityQuery,
  useLazyGetPromotionEligibilityQuery,
  usePromoteStudentMutation,
  useGetEnrollmentLinksQuery,
  useCreateEnrollmentLinkMutation,
  useDeactivateEnrollmentLinkMutation,
  useGetEnrollmentApplicationsQuery,
  useApproveEnrollmentApplicationMutation,
  useRejectEnrollmentApplicationMutation,
  useVerifyEnrollmentLinkQuery,
  useLazyVerifyEnrollmentLinkQuery,
  useSubmitEnrollmentApplicationMutation,
} = studentApi;
