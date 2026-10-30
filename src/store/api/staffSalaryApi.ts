import { baseApi } from './baseApi';
import type { TeacherRecord } from './teacherApi';

export interface StaffSalaryPayment {
  id: number;
  teacherId: number;
  teacherName: string;
  teacherEmail: string;
  teacherPhone: string;
  teacherFixedSalary: string;
  month: number;
  year: number;
  amount: string;
  paymentDate: string;
  paymentMethod: string;
  referenceNumber: string;
  status: 'Paid' | 'Pending';
  receiptNumber: string;
  notes: string;
  paidByName?: string;
  createdAt: string;
}

export interface StaffSalaryPage {
  count: number;
  next: string | null;
  previous: string | null;
  results: StaffSalaryPayment[];
}

export interface PayStaffSalaryPayload {
  teacherId: number;
  month: number;
  year: number;
  amount: string | number;
  paymentDate?: string;
  paymentMethod?: string;
  referenceNumber?: string;
  status?: 'Paid' | 'Pending';
  notes?: string;
}

export interface StaffPayrollSummary {
  totalPayroll: string | number;
  totalPaid: string | number;
  totalPending: string | number;
  paidCount: number;
  totalCount: number;
  pendingCount: number;
}

export interface StaffPayrollRow {
  teacher: TeacherRecord;
  fixedSalary: number;
  payment: StaffSalaryPayment | null;
  isPaid: boolean;
}

export interface StaffPayrollPage {
  count: number;
  next: string | null;
  previous: string | null;
  results: StaffPayrollRow[];
  summary: StaffPayrollSummary;
}

export const staffSalaryApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getStaffPayrollSummary: build.query<StaffPayrollPage, { month: number; year: number; page: number; page_size?: number; search?: string; status?: string }>({
      query: (params) => ({ url: '/staff-salaries/payroll-summary/', params }),
      providesTags: ['StaffSalary'],
    }),
    getStaffSalaries: build.query<StaffSalaryPage, { month?: number; year?: number; teacherId?: number; page: number; page_size?: number }>({
      query: (params) => ({ url: '/staff-salaries/', params }),
      providesTags: ['StaffSalary'],
    }),
    getStaffSalary: build.query<StaffSalaryPayment, number>({
      query: (id) => ({ url: `/staff-salaries/${id}/` }),
      providesTags: ['StaffSalary'],
    }),
    payStaffSalary: build.mutation<StaffSalaryPayment, PayStaffSalaryPayload>({
      query: (body) => ({
        url: '/staff-salaries/',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['StaffSalary'],
    }),
    updateStaffSalary: build.mutation<StaffSalaryPayment, { id: number; body: Partial<PayStaffSalaryPayload> }>({
      query: ({ id, body }) => ({
        url: `/staff-salaries/${id}/`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['StaffSalary'],
    }),
    deleteStaffSalary: build.mutation<void, number>({
      query: (id) => ({
        url: `/staff-salaries/${id}/`,
        method: 'DELETE',
      }),
      invalidatesTags: ['StaffSalary'],
    }),
  }),
});

export const {
  useGetStaffPayrollSummaryQuery,
  useLazyGetStaffPayrollSummaryQuery,
  useGetStaffSalariesQuery,
  useGetStaffSalaryQuery,
  usePayStaffSalaryMutation,
  useUpdateStaffSalaryMutation,
  useDeleteStaffSalaryMutation,
} = staffSalaryApi;
