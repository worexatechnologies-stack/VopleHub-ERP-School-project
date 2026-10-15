import { baseApi } from './baseApi';

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

type Page<T> = { next?: string | null; results?: T[] } | T[];

function unwrapPage<T>(payload: Page<T>): T[] {
  return Array.isArray(payload) ? payload : payload.results || [];
}

export const staffSalaryApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getStaffSalaries: build.query<StaffSalaryPayment[], { month?: number; year?: number; teacherId?: number } | void>({
      query: (params) => ({
        url: '/staff-salaries/',
        params: params || undefined,
      }),
      transformResponse: (response: Page<StaffSalaryPayment>) => unwrapPage(response),
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
  useGetStaffSalariesQuery,
  useGetStaffSalaryQuery,
  usePayStaffSalaryMutation,
  useUpdateStaffSalaryMutation,
  useDeleteStaffSalaryMutation,
} = staffSalaryApi;
