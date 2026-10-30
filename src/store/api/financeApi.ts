import { baseApi } from './baseApi';

export interface BackendFeeQuarter {
  id: number;
  fee_structure_id: number;
  target_class?: string;
  academic_year: string;
  quarter_number: number;
  quarter_code: string;
  quarter_name: string;
  assigned_amount: number | string;
  paid_amount: number | string;
  remaining_amount: number | string;
  payment_status: string;
  due_date?: string;
}

export interface BackendFeeStructure {
  id?: number;
  name: string;
  academic_year: string;
  academic_year_id?: number;
  level: string;
  target_class?: string;
  target_class_id?: number;
  target_section?: string;
  target_section_id?: number;
  target_student_id?: string;
  items: any[];
  quarters: any[];
  quarter_records?: BackendFeeQuarter[];
}

export interface BackendStudentFeeRecord {
  id?: number;
  student_id_str: string;
  student_name: string;
  admission_no: string;
  class_name: string;
  section_name: string;
  academic_year: string;
  scholarship?: number;
  discount?: number;
  transport_charges?: number;
  hostel_charges?: number;
  fine_amount?: number;
  installments_paid?: number;
  custom_items?: any[];
  custom_quarters?: any[];
  payment_history: any[];
}

export interface BackendQuarterSummary {
  quarterId?: number;
  quarter: string;
  name: string;
  requiredAmount: number;
  amountPaid: number;
  remainingAmount: number;
  dueDate: string;
  status: 'PAID' | 'PARTIALLY_PAID' | 'PAYMENT_DUE' | 'OVERDUE';
}

export interface StudentFeeSummaryResponse {
  studentId: number;
  studentName: string;
  admissionNo: string;
  class: string;
  classId?: number;
  section: string;
  sectionId?: number;
  academicYear: string;
  hasStructure: boolean;
  feeStructureId?: number | null;
  feeStructureName?: string | null;
  totalFees: number;
  totalPaid: number;
  balanceDue: number;
  quartersPaid: number;
  totalQuarters: number;
  paymentStatus: 'PAID' | 'PARTIALLY_PAID' | 'UNPAID' | 'UNCONFIGURED';
  quarters: BackendQuarterSummary[];
  payments: any[];
  breakdown: any[];
  scholarship?: number;
  discount?: number;
  transportCharges?: number;
  hostelCharges?: number;
  fineAmount?: number;
}

export interface SchoolRevenueSummary {
  totalRevenue: number;
  totalInvoiced: number;
  pendingReceivables: number;
  collectionRate: number;
  monthlyDistribution: Array<{ month: string; amount: number }>;
  recentPayments: Array<{
    id: number;
    receiptNo: string;
    studentName: string;
    admissionNo: string;
    amountPaid: number;
    paymentDate: string;
    paymentMethod: string;
    category: string;
  }>;
  studentsCount: number;
  paidCount: number;
  partialCount: number;
  unpaidCount: number;
  lastUpdated: string;
}

type Page<T> = { results?: T[]; next?: string | null } | T[];

async function fetchAllPages<T>(url: string, baseQuery: any): Promise<{ data: T[] } | { error: any }> {
  const rows: T[] = [];
  let page = 1;
  while (true) {
    const sep = url.includes('?') ? '&' : '?';
    const result = await baseQuery(`${url}${sep}page=${page}`);
    if (result.error) return { error: result.error };
    const payload = result.data as Page<T>;
    if (Array.isArray(payload)) return { data: payload };
    rows.push(...(payload.results || []));
    if (!payload.next) return { data: rows };
    page += 1;
  }
}

function unwrapResults<T>(payload: Page<T>): T[] {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.results)) return payload.results;
  return [];
}

export const financeApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getSchoolRevenue: build.query<SchoolRevenueSummary, { academicYear?: string; className?: string } | void>({
      query: (args) => {
        const params = new URLSearchParams();
        if (args && typeof args === 'object' && args.academicYear) {
          params.append('academic_year', args.academicYear);
        }
        if (args && typeof args === 'object' && args.className) {
          params.append('class_name', args.className);
        }
        const query = params.toString() ? `?${params.toString()}` : '';
        return `/fee-structures/school-revenue/${query}`;
      },
      providesTags: [{ type: 'FeeRevenue', id: 'LIST' }, { type: 'StudentStats', id: 'LIST' }],
    }),

    getFeeStructures: build.query<
      BackendFeeStructure[],
      { targetClass?: string; academicYear?: string; targetClassId?: number; targetSectionId?: number } | void
    >({
      queryFn: (args, _api, _extra, baseQuery) => {
        const params = new URLSearchParams();
        if (args && typeof args === 'object') {
          if (args.targetClassId) params.append('target_class_id', String(args.targetClassId));
          else if (args.targetClass && args.targetClass !== 'All') params.append('target_class', args.targetClass);
          if (args.targetSectionId) params.append('target_section_id', String(args.targetSectionId));
          if (args.academicYear) params.append('academic_year', args.academicYear);
        }
        const query = params.toString() ? `?${params.toString()}` : '';
        return fetchAllPages<BackendFeeStructure>(`/fee-structures/${query}`, baseQuery);
      },
      providesTags: [{ type: 'FeeStructures', id: 'LIST' }],
    }),

    resolveFeeStructure: build.query<
      BackendFeeStructure | null,
      {
        studentId?: string | number;
        classId?: number;
        sectionId?: number;
        academicYear?: string;
        academicYearId?: number;
      }
    >({
      query: (params) => {
        const urlParams = new URLSearchParams();
        if (params.studentId) urlParams.append('student_id', String(params.studentId));
        if (params.classId) urlParams.append('class_id', String(params.classId));
        if (params.sectionId) urlParams.append('section_id', String(params.sectionId));
        if (params.academicYear) urlParams.append('academic_year', params.academicYear);
        if (params.academicYearId) urlParams.append('academic_year_id', String(params.academicYearId));
        const query = urlParams.toString() ? `?${urlParams.toString()}` : '';
        return `/fee-structures/resolve/${query}`;
      },
      transformResponse: (res: any) => {
        if (res && 'id' in res && res.id) {
          return res as BackendFeeStructure;
        }
        return null;
      },
      providesTags: [{ type: 'FeeStructures', id: 'LIST' }],
    }),

    getFeeStructuresByTeacher: build.query<BackendFeeStructure[], { teacherId?: string | number } | void>({
      query: (args) => {
        const teacherId = args && typeof args === 'object' ? args.teacherId : undefined;
        const query = teacherId ? `?teacher_id=${teacherId}` : '';
        return `/fee-structures/by-teacher/${query}`;
      },
      transformResponse: (response: Page<BackendFeeStructure>) => unwrapResults(response),
      providesTags: [{ type: 'FeeStructures', id: 'LIST' }],
    }),

    getFeeQuarters: build.query<BackendFeeQuarter[], { targetClass?: string; academicYear?: string } | void>({
      queryFn: (args, _api, _extra, baseQuery) => {
        const params = new URLSearchParams();
        if (args && typeof args === 'object') {
          if (args.targetClass && args.targetClass !== 'All') params.append('target_class', args.targetClass);
          if (args.academicYear) params.append('academic_year', args.academicYear);
        }
        const query = params.toString() ? `?${params.toString()}` : '';
        return fetchAllPages<BackendFeeQuarter>(`/fee-quarters/${query}`, baseQuery);
      },
      providesTags: [{ type: 'FeeQuarters', id: 'LIST' }],
    }),

    createFeeStructure: build.mutation<BackendFeeStructure, Partial<BackendFeeStructure>>({
      query: (body) => ({
        url: '/fee-structures/',
        method: 'POST',
        body,
      }),
      invalidatesTags: [
        { type: 'FeeStructures', id: 'LIST' },
        { type: 'FeeQuarters', id: 'LIST' },
        { type: 'FeeSummaries', id: 'LIST' },
      ],
    }),

    updateFeeStructure: build.mutation<BackendFeeStructure, { id: number | string; body: Partial<BackendFeeStructure> }>({
      query: ({ id, body }) => ({
        url: `/fee-structures/${id}/`,
        method: 'PUT',
        body,
      }),
      invalidatesTags: [
        { type: 'FeeStructures', id: 'LIST' },
        { type: 'FeeQuarters', id: 'LIST' },
        { type: 'FeeSummaries', id: 'LIST' },
      ],
    }),

    deleteFeeStructure: build.mutation<void, number | string>({
      query: (id) => ({
        url: `/fee-structures/${id}/`,
        method: 'DELETE',
      }),
      invalidatesTags: [
        { type: 'FeeStructures', id: 'LIST' },
        { type: 'FeeQuarters', id: 'LIST' },
        { type: 'FeeSummaries', id: 'LIST' },
      ],
    }),

    getStudentFeeRecords: build.query<BackendStudentFeeRecord[], { className?: string; studentId?: string } | void>({
      queryFn: (args, _api, _extra, baseQuery) => {
        const params = new URLSearchParams();
        if (args && typeof args === 'object') {
          if (args.className && args.className !== 'All') params.append('class_name', args.className);
          if (args.studentId) params.append('student_id', args.studentId);
        }
        const query = params.toString() ? `?${params.toString()}` : '';
        return fetchAllPages<BackendStudentFeeRecord>(`/fee-records/${query}`, baseQuery);
      },
      providesTags: (records) => [
        { type: 'FeeRecords', id: 'LIST' },
        ...(records || []).map((record) => ({ type: 'FeeRecords' as const, id: String(record.student_id_str) })),
      ],
    }),

    getStudentFeeSummary: build.query<StudentFeeSummaryResponse, { studentId: number | string; academicYear?: string }>({
      query: ({ studentId, academicYear }) => {
        const params = new URLSearchParams();
        params.append('student_id', String(studentId));
        if (academicYear) params.append('academic_year', academicYear);
        return `/fee-structures/student-summary/?${params.toString()}`;
      },
      providesTags: (_res, _err, arg) => [{ type: 'FeeSummary', id: String(arg.studentId) }],
    }),

    getStudentFeeSummaries: build.query<
      StudentFeeSummaryResponse[],
      { classId?: number; sectionId?: number; academicYear?: string } | void
    >({
      query: (args) => {
        const urlParams = new URLSearchParams();
        if (args && typeof args === 'object') {
          if (args.classId) urlParams.append('class_id', String(args.classId));
          if (args.sectionId) urlParams.append('section_id', String(args.sectionId));
          if (args.academicYear) urlParams.append('academic_year', args.academicYear);
        }
        const query = urlParams.toString() ? `?${urlParams.toString()}` : '';
        return `/fee-structures/student-summaries/${query}`;
      },
      transformResponse: (response: Page<StudentFeeSummaryResponse>) => unwrapResults(response),
      providesTags: (summaries) => [
        { type: 'FeeSummaries', id: 'LIST' },
        ...(summaries || []).map((summary) => ({ type: 'FeeSummaries' as const, id: String(summary.studentId) })),
      ],
    }),

    recordStudentPayment: build.mutation<
      { message: string; payment: any; summary: StudentFeeSummaryResponse },
      {
        studentId: number | string;
        amountPaid: number;
        paymentMethod: string;
        category?: string;
        installmentType?: string;
        quarterId?: number;
      }
    >({
      query: (body) => ({
        url: '/fee-structures/record-student-payment/',
        method: 'POST',
        body,
      }),
      invalidatesTags: (_res, _err, arg) => [
        { type: 'FeeRecords', id: String(arg.studentId) },
        { type: 'FeeSummary', id: String(arg.studentId) },
        { type: 'FeeSummaries', id: String(arg.studentId) },
        { type: 'FeeRevenue', id: 'LIST' },
        { type: 'StudentRoster', id: String(arg.studentId) },
        { type: 'StudentStats', id: 'LIST' },
      ],
    }),

    recordFeePayment: build.mutation<
      any,
      {
        recordId: number;
        studentId?: number | string;
        body: {
          amount_paid: number;
          payment_method: string;
          category?: string;
          installment_type?: string;
          quarter_id?: number;
        };
      }
    >({
      query: ({ recordId, body }) => ({
        url: `/fee-records/${recordId}/record-payment/`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_res, _err, arg) => [
        { type: 'FeeRecords', id: arg.studentId ? String(arg.studentId) : 'LIST' },
        ...(arg.studentId
          ? [
              { type: 'FeeSummary' as const, id: String(arg.studentId) },
              { type: 'FeeSummaries' as const, id: String(arg.studentId) },
            ]
          : []),
        { type: 'FeeRevenue', id: 'LIST' },
        ...(arg.studentId
          ? [{ type: 'StudentRoster' as const, id: String(arg.studentId) }]
          : [{ type: 'StudentRoster' as const, id: 'LIST' }]),
        { type: 'StudentStats', id: 'LIST' },
      ],
    }),

    updateStudentFeeRecord: build.mutation<
      { message: string; record: BackendStudentFeeRecord; summary?: StudentFeeSummaryResponse },
      {
        recordId?: number | string;
        studentId?: number | string;
        custom_items?: any[];
        custom_quarters?: any[];
        scholarship?: number;
        discount?: number;
        transport_charges?: number;
        hostel_charges?: number;
        fine_amount?: number;
        payment_history?: any[];
      }
    >({
      query: (body) => ({
        url: '/fee-records/update-student-fee/',
        method: 'POST',
        body: {
          record_id: body.recordId,
          student_id: body.studentId,
          ...body,
        },
      }),
      invalidatesTags: (_res, _err, arg) => [
        { type: 'FeeRecords', id: arg.studentId ? String(arg.studentId) : 'LIST' },
        ...(arg.studentId
          ? [
              { type: 'FeeSummary' as const, id: String(arg.studentId) },
              { type: 'FeeSummaries' as const, id: String(arg.studentId) },
            ]
          : []),
        { type: 'FeeRevenue', id: 'LIST' },
        ...(arg.studentId
          ? [{ type: 'StudentRoster' as const, id: String(arg.studentId) }]
          : [{ type: 'StudentRoster' as const, id: 'LIST' }]),
        { type: 'StudentStats', id: 'LIST' },
      ],
    }),
  }),
});

export const {
  useGetSchoolRevenueQuery,
  useGetFeeStructuresQuery,
  useLazyGetFeeStructuresQuery,
  useResolveFeeStructureQuery,
  useLazyResolveFeeStructureQuery,
  useGetFeeStructuresByTeacherQuery,
  useGetFeeQuartersQuery,
  useCreateFeeStructureMutation,
  useUpdateFeeStructureMutation,
  useDeleteFeeStructureMutation,
  useGetStudentFeeRecordsQuery,
  useLazyGetStudentFeeRecordsQuery,
  useGetStudentFeeSummaryQuery,
  useLazyGetStudentFeeSummaryQuery,
  useGetStudentFeeSummariesQuery,
  useLazyGetStudentFeeSummariesQuery,
  useRecordStudentPaymentMutation,
  useRecordFeePaymentMutation,
  useUpdateStudentFeeRecordMutation,
} = financeApi;
