import { baseApi } from './baseApi';
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
      providesTags: ['Student'],
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
      providesTags: ['Student'],
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
      providesTags: ['Student'],
    }),
    getStudent: build.query<Student, string>({
      query: (id) => ({ url: `/students/${id}/` }),
      transformResponse: (response: StudentApiRecord) => normalizeStudent(response),
      providesTags: ['Student'],
    }),
    createStudent: build.mutation<StudentApiRecord, FormData>({
      query: (body) => ({ url: '/students/', method: 'POST', body }),
      invalidatesTags: ['Student', 'Auth', 'CredentialVault'],
    }),
    updateStudent: build.mutation<StudentApiRecord, { id: string; body: FormData }>({
      query: ({ id, body }) => ({ url: `/students/${id}/`, method: 'PATCH', body }),
      invalidatesTags: ['Student'],
    }),
    deleteStudent: build.mutation<void, string>({
      query: (id) => ({ url: `/students/${id}/`, method: 'DELETE' }),
      invalidatesTags: ['Student', 'Auth', 'CredentialVault'],
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
      invalidatesTags: ['Student', 'Auth', 'CredentialVault'],
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
      query: (arg) => {
        if (arg instanceof FormData) {
          return { url: '/students/bulk-import/', method: 'POST', body: arg };
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
          return { url: '/students/bulk-import/', method: 'POST', body: fd };
        }
        return {
          url: '/students/bulk-import/',
          method: 'POST',
          body: {
            students: arg.students,
            academicYear: arg.academicYear,
            jobId: arg.jobId,
            batchNumber: arg.batchNumber,
            totalBatches: arg.totalBatches,
            batchSize: arg.batchSize,
          },
        };
      },
      invalidatesTags: ['Student', 'Auth', 'CredentialVault'],
    }),
    getStudentDocuments: build.query<StudentDocument[], string>({
      query: (studentId) => ({ url: `/students/${studentId}/documents/` }),
      providesTags: ['Student'],
    }),
    uploadStudentDocument: build.mutation<StudentDocument, { studentId: string; body: FormData }>({
      query: ({ studentId, body }) => ({ url: `/students/${studentId}/documents/`, method: 'POST', body }),
      invalidatesTags: ['Student'],
    }),
    deleteStudentDocument: build.mutation<void, { studentId: string; docId: number }>({
      query: ({ studentId, docId }) => ({ url: `/students/${studentId}/documents/${docId}/`, method: 'DELETE' }),
      invalidatesTags: ['Student'],
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
      invalidatesTags: ['Student'],
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
      providesTags: ['Student'],
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
      invalidatesTags: ['Student', 'Fee' as any],
    }),
    getEnrollmentLinks: build.query<EnrollmentLinkItem[], void>({
      query: () => ({ url: '/enrollment-links/' }),
      transformResponse: (res: Page<EnrollmentLinkItem>) => unwrapPage(res),
      providesTags: ['Student'],
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
      invalidatesTags: ['Student'],
    }),
    deactivateEnrollmentLink: build.mutation<EnrollmentLinkItem, string | number>({
      query: (id) => ({
        url: `/enrollment-links/${id}/deactivate/`,
        method: 'POST',
      }),
      invalidatesTags: ['Student'],
    }),
    getEnrollmentApplications: build.query<EnrollmentApplicationItem[], { status?: string } | void>({
      query: (params) => ({
        url: '/enrollment-applications/',
        params: params?.status ? { status: params.status } : undefined,
      }),
      transformResponse: (res: Page<EnrollmentApplicationItem>) => unwrapPage(res),
      providesTags: ['Student'],
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
      invalidatesTags: ['Student', 'Fee' as any, 'Auth'],
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
      invalidatesTags: ['Student'],
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
      invalidatesTags: ['Student'],
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