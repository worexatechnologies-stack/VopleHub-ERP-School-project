import { store } from '../store';
import {
  financeApi,
  BackendFeeQuarter,
  BackendFeeStructure,
  BackendStudentFeeRecord,
  BackendQuarterSummary,
  StudentFeeSummaryResponse,
} from '../store/api/financeApi';

export type {
  BackendFeeQuarter,
  BackendFeeStructure,
  BackendStudentFeeRecord,
  BackendQuarterSummary,
  StudentFeeSummaryResponse,
};

export const fetchFeeStructuresFromDB = async (
  targetClass?: string,
  academicYear?: string,
  targetClassId?: number,
  targetSectionId?: number
): Promise<BackendFeeStructure[]> => {
  try {
    const res = await store
      .dispatch(
        financeApi.endpoints.getFeeStructures.initiate(
          { targetClass, academicYear, targetClassId, targetSectionId }
        )
      )
      .unwrap();
    return res || [];
  } catch (err) {
    console.warn('Backend fee-structures fetch fallback to local cache:', err);
    return [];
  }
};

export const resolveFeeStructureFromDB = async (params: {
  studentId?: string | number;
  classId?: number;
  sectionId?: number;
  academicYear?: string;
  academicYearId?: number;
}): Promise<BackendFeeStructure | null> => {
  try {
    const res = await store
      .dispatch(financeApi.endpoints.resolveFeeStructure.initiate(params))
      .unwrap();
    return res || null;
  } catch (err) {
    console.warn('Backend fee structure resolve error:', err);
    return null;
  }
};

export const fetchFeeStructuresByTeacherFromDB = async (
  teacherId?: string | number
): Promise<BackendFeeStructure[]> => {
  try {
    const res = await store
      .dispatch(financeApi.endpoints.getFeeStructuresByTeacher.initiate({ teacherId }))
      .unwrap();
    return res || [];
  } catch (err) {
    console.warn('Backend teacher fee structures fetch error:', err);
    return [];
  }
};

export const fetchFeeQuartersFromDB = async (
  targetClass?: string,
  academicYear?: string
): Promise<BackendFeeQuarter[]> => {
  try {
    const res = await store
      .dispatch(financeApi.endpoints.getFeeQuarters.initiate({ targetClass, academicYear }))
      .unwrap();
    return res || [];
  } catch (err) {
    console.warn('Backend fee-quarters fetch error:', err);
    return [];
  }
};

export const createFeeStructureInDB = async (
  data: Partial<BackendFeeStructure>
): Promise<BackendFeeStructure | null> => {
  try {
    return await store.dispatch(financeApi.endpoints.createFeeStructure.initiate(data)).unwrap();
  } catch (err) {
    console.warn('Backend fee structure save error:', err);
    return null;
  }
};

export const updateFeeStructureInDB = async (
  id: number | string,
  data: Partial<BackendFeeStructure>
): Promise<BackendFeeStructure | null> => {
  try {
    return await store.dispatch(financeApi.endpoints.updateFeeStructure.initiate({ id, body: data })).unwrap();
  } catch (err) {
    console.warn('Backend fee structure update error:', err);
    return null;
  }
};

export const deleteFeeStructureFromDB = async (id: number | string): Promise<unknown> => {
  try {
    return await store.dispatch(financeApi.endpoints.deleteFeeStructure.initiate(id)).unwrap();
  } catch (err) {
    console.warn('Backend fee structure delete error:', err);
    return null;
  }
};

export const fetchStudentFeeRecordsFromDB = async (
  className?: string,
  studentId?: string
): Promise<BackendStudentFeeRecord[]> => {
  try {
    const res = await store
      .dispatch(financeApi.endpoints.getStudentFeeRecords.initiate({ className, studentId }))
      .unwrap();
    return res || [];
  } catch (err) {
    console.warn('Backend fee-records fetch fallback to local cache:', err);
    return [];
  }
};

export const fetchStudentFeeSummaryFromDB = async (
  studentId: number | string,
  academicYear?: string
): Promise<StudentFeeSummaryResponse | null> => {
  try {
    const res = await store
      .dispatch(
        financeApi.endpoints.getStudentFeeSummary.initiate({ studentId, academicYear })
      )
      .unwrap();
    return res || null;
  } catch (err) {
    console.warn('Backend student fee summary fetch error:', err);
    return null;
  }
};

export const fetchStudentFeeSummariesFromDB = async (params: {
  classId?: number;
  sectionId?: number;
  academicYear?: string;
}): Promise<StudentFeeSummaryResponse[]> => {
  try {
    const res = await store
      .dispatch(financeApi.endpoints.getStudentFeeSummaries.initiate(params))
      .unwrap();
    return res || [];
  } catch (err) {
    console.warn('Backend student fee summaries fetch error:', err);
    return [];
  }
};

export const recordStudentPaymentInDB = async (paymentData: {
  studentId: number | string;
  amountPaid: number;
  paymentMethod: string;
  category?: string;
  installmentType?: string;
  quarterId?: number;
}): Promise<{ message: string; payment: any; summary: StudentFeeSummaryResponse } | null> => {
  try {
    return await store.dispatch(financeApi.endpoints.recordStudentPayment.initiate(paymentData)).unwrap();
  } catch (err) {
    console.warn('Backend record student payment error:', err);
    return null;
  }
};

export const recordFeePaymentInDB = async (
  recordId: number,
  paymentData: {
    amount_paid: number;
    payment_method: string;
    category?: string;
    installment_type?: string;
    quarter_id?: number;
  }
): Promise<any> => {
  try {
    return await store
      .dispatch(financeApi.endpoints.recordFeePayment.initiate({ recordId, body: paymentData }))
      .unwrap();
  } catch (err) {
    console.warn('Backend payment record error:', err);
    return null;
  }
};

export const updateStudentFeeRecordInDB = async (payload: {
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
}): Promise<any> => {
  try {
    return await store
      .dispatch(financeApi.endpoints.updateStudentFeeRecord.initiate(payload))
      .unwrap();
  } catch (err) {
    console.warn('Backend update student fee record error:', err);
    return null;
  }
};
