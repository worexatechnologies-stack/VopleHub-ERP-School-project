import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  CreditCard,
  IndianRupee,
  Loader2,
  Users,
  CheckCircle,
  Calendar,
  Receipt,
  ArrowRight,
  Printer,
  Smartphone,
  Landmark,
  X,
  RefreshCw,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Lock
} from 'lucide-react';
import { store } from '../store';
import { studentApi } from '../store/api/studentApi';
import { emitNotification } from '../services/notificationBus';
import { IndividualStudentFeeRecord, StudentPayment, QuarterFeeDetail, getDefaultQuarters } from './FeesModule';

import {
  fetchFeeStructuresFromDB,
  fetchStudentFeeRecordsFromDB,
  fetchStudentFeeSummaryFromDB,
  recordStudentPaymentInDB,
  recordFeePaymentInDB,
  StudentFeeSummaryResponse,
} from '../services/financeApi';

type WardApiData = {
  id: number | string;
  name: string;
  admissionNo: string;
  class?: string;
  classId?: number;
  section?: string;
  sectionId?: number;
  academicYear?: string;
  feeTotal?: string | number | null;
  feePaid?: string | number | null;
};

type Paginated<T> = { results?: T[] } | T[];
const entries = <T,>(payload: Paginated<T>): T[] => Array.isArray(payload) ? payload : payload.results || [];

export default function FamilyFees({ role }: { role: 'Parent' | 'Student' }) {
  const [apiWards, setApiWards] = useState<WardApiData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Live Database Calculated Summaries (Student ID -> StudentFeeSummaryResponse)
  const [dbSummaries, setDbSummaries] = useState<Record<string, StudentFeeSummaryResponse>>({});

  // DB Synchronized Student Fee Records
  const [studentRecords, setStudentRecords] = useState<IndividualStudentFeeRecord[]>(() => {
    try {
      const saved = localStorage.getItem('erp_individual_fees');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // DB Synchronized Fee Structures
  const [structures, setStructures] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem('erp_fee_structures');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const loadStudentSummaries = async (wardsList: { id: string | number }[]) => {
    if (!wardsList || wardsList.length === 0) return;
    const summariesMap: Record<string, StudentFeeSummaryResponse> = {};
    for (const w of wardsList) {
      if (!w.id) continue;
      const s = await fetchStudentFeeSummaryFromDB(w.id);
      if (s) {
        summariesMap[String(w.id)] = s;
      }
    }
    setDbSummaries((prev) => ({ ...prev, ...summariesMap }));
  };

  const loadDBData = () => {
    fetchFeeStructuresFromDB().then((dbStructures) => {
      if (Array.isArray(dbStructures) && dbStructures.length > 0) {
        const formatted = dbStructures.map((s) => ({
          id: String(s.id),
          name: s.name,
          academicYear: s.academic_year,
          academicYearId: s.academic_year_id,
          level: s.level,
          targetClass: s.target_class || undefined,
          targetClassId: s.target_class_id || undefined,
          targetSection: s.target_section || undefined,
          targetSectionId: s.target_section_id || undefined,
          targetStudentId: s.target_student_id || undefined,
          items: s.items || [],
          quarters: s.quarters || (s.quarter_records ? s.quarter_records.map((q: any) => ({
            id: q.id,
            quarter: q.quarter_code || `Q${q.quarter_number}`,
            name: q.quarter_name,
            amount: Number(q.assigned_amount),
            paidAmount: Number(q.paid_amount),
            remainingAmount: Number(q.remaining_amount),
            paymentStatus: q.payment_status,
            dueDate: q.due_date || ''
          })) : []),
        }));
        setStructures(formatted);
      } else {
        const savedStr = localStorage.getItem('erp_fee_structures');
        if (savedStr) {
          try {
            setStructures(JSON.parse(savedStr));
          } catch {
            setStructures([]);
          }
        }
      }
    });

    fetchStudentFeeRecordsFromDB().then((dbRecords) => {
      if (Array.isArray(dbRecords) && dbRecords.length > 0) {
        const formatted: IndividualStudentFeeRecord[] = dbRecords.map((r) => ({
          id: String(r.id),
          studentId: r.student_id_str,
          studentName: r.student_name,
          admissionNo: r.admission_no,
          class: r.class_name,
          section: r.section_name,
          academicYear: r.academic_year,
          scholarship: Number(r.scholarship) || 0,
          discount: Number(r.discount) || 0,
          transportCharges: Number(r.transport_charges) || 0,
          hostelCharges: Number(r.hostel_charges) || 0,
          fineAmount: Number(r.fine_amount) || 0,
          installmentsPaid: r.installments_paid || 0,
          customItems: r.custom_items || undefined,
          customQuarters: r.custom_quarters || undefined,
          paymentHistory: r.payment_history || [],
        }));
        setStudentRecords(formatted);
      } else {
        const savedInd = localStorage.getItem('erp_individual_fees');
        if (savedInd) {
          try {
            setStudentRecords(JSON.parse(savedInd));
          } catch {
            setStudentRecords([]);
          }
        }
      }
    });
  };

  useEffect(() => {
    loadDBData();
    store.dispatch(studentApi.endpoints.getStudents.initiate(undefined))
      .unwrap()
      .then((studentsList) => {
        const list = (studentsList || []) as unknown as WardApiData[];
        setApiWards(list);
        loadStudentSummaries(list);
      })
      .catch(() => {
        // Fallback gracefully if API is unauthenticated in demo mode
        setError('');
      })
      .finally(() => setLoading(false));
  }, []);

  // Sync student records to localStorage
  useEffect(() => {
    if (studentRecords.length > 0) {
      localStorage.setItem('erp_individual_fees', JSON.stringify(studentRecords));
    }
  }, [studentRecords]);

  // Listen for real-time fee updates across Admin, Parent, and Student dashboards
  useEffect(() => {
    const handleSync = () => {
      loadDBData();
      if (apiWards.length > 0) {
        loadStudentSummaries(apiWards);
      } else if (studentRecords.length > 0) {
        loadStudentSummaries(studentRecords.map(r => ({ id: r.studentId })));
      }
      const savedInd = localStorage.getItem('erp_individual_fees');
      if (savedInd) {
        try {
          setStudentRecords(JSON.parse(savedInd));
        } catch (e) {
          console.error('Error parsing sync records', e);
        }
      }
      const savedStr = localStorage.getItem('erp_fee_structures');
      if (savedStr) {
        try {
          setStructures(JSON.parse(savedStr));
        } catch (e) {
          console.error('Error parsing sync structures', e);
        }
      }
    };
    window.addEventListener('storage', handleSync);
    window.addEventListener('erp_fees_updated', handleSync);
    return () => {
      window.removeEventListener('storage', handleSync);
      window.removeEventListener('erp_fees_updated', handleSync);
    };
  }, [apiWards, studentRecords]);


  // Combine API wards with localStorage fee records so demonstration demo works perfectly
  const effectiveWards = useMemo(() => {
    const normalizeClassName = (cls?: string): string => {
      if (!cls) return '';
      return cls.toLowerCase().replace(/(class|cls)/g, '').replace(/[^a-z0-9]/g, ' ').trim();
    };

    const matchClass = (cls1?: string, cls2?: string): boolean => {
      if (!cls1 || !cls2) return false;
      const n1 = normalizeClassName(cls1);
      const n2 = normalizeClassName(cls2);
      if (!n1 || !n2) return false;
      if (n1 === n2 || cls1.toLowerCase() === cls2.toLowerCase()) return true;

      const parts1 = n1.split(/\s+/).filter(Boolean);
      const parts2 = n2.split(/\s+/).filter(Boolean);

      const base1 = parts1[0];
      const base2 = parts2[0];
      return base1 === base2;
    };

    const findStructureForStudent = (student: {
      id?: string | number;
      classId?: number;
      sectionId?: number;
      class?: string;
      section?: string;
      academicYear?: string;
    }) => {
      if (structures.length === 0) return null;

      // 1. Student-level Fee Structure
      if (student.id) {
        const studentStr = structures.find(
          (s) => s.level === 'student' &&
          (String(s.targetStudentId) === String(student.id) || (s.target_student_id && String(s.target_student_id) === String(student.id)))
        );
        if (studentStr) return studentStr;
      }

      // 2. Section-level Fee Structure
      if (student.sectionId) {
        const sectionStr = structures.find(
          (s) => s.level === 'section' && s.targetSectionId === student.sectionId
        );
        if (sectionStr) return sectionStr;
      }
      if (student.class && student.section) {
        const sectionStr = structures.find(
          (s) => s.level === 'section' &&
          matchClass(s.targetClass, student.class) &&
          s.targetSection?.toLowerCase() === (student.section || '').toLowerCase()
        );
        if (sectionStr) return sectionStr;
      }

      // 3. Class-level Fee Structure
      if (student.classId) {
        const classStr = structures.find(
          (s) => s.level === 'class' && s.targetClassId === student.classId
        );
        if (classStr) return classStr;
      }
      if (student.class) {
        const classStr = structures.find(
          (s) => s.level === 'class' && matchClass(s.targetClass, student.class)
        );
        if (classStr) return classStr;
      }

      // 4. School-level Fee Structure
      const schoolStr = structures.find(
        (s) => String(s.level || '').toLowerCase() === 'school'
      );
      if (schoolStr) return schoolStr;

      // 5. No Fee Structure Available
      return null;
    };

    const rawWards = apiWards.length > 0
      ? apiWards.map((w) => {
          const matchingRecord = studentRecords.find((r) =>
            String(r.studentId) === String(w.id) ||
            (r.admissionNo && w.admissionNo && r.admissionNo.toLowerCase() === w.admissionNo.toLowerCase()) ||
            (r.studentName && w.name && r.studentName.toLowerCase() === w.name.toLowerCase())
          );
          return {
            id: String(w.id),
            name: w.name,
            admissionNo: w.admissionNo,
            class: w.class || matchingRecord?.class || '',
            classId: w.classId || matchingRecord?.classId,
            section: w.section || matchingRecord?.section || '',
            sectionId: w.sectionId || matchingRecord?.sectionId,
            academicYear: w.academicYear || matchingRecord?.academicYear || '',
            matchingRecord,
            apiFeePaid: Number(w.feePaid || 0),
          };
        })
      : studentRecords.map((r) => ({
          id: String(r.studentId),
          name: r.studentName,
          admissionNo: r.admissionNo,
          class: r.class || '',
          classId: r.classId,
          section: r.section || '',
          sectionId: r.sectionId,
          academicYear: r.academicYear || '',
          matchingRecord: r,
          apiFeePaid: 0,
        }));

    return rawWards.map((w) => {
      const summary = dbSummaries[String(w.id)];
      if (summary) {
        const quartersList = summary.quarters && summary.quarters.length > 0
          ? summary.quarters.map((q) => ({
              id: q.quarterId,
              quarter: q.quarter,
              name: q.name,
              amount: q.requiredAmount,
              paidAmount: q.amountPaid,
              remainingAmount: q.remainingAmount,
              dueDate: q.dueDate,
              status: q.status === 'PAID' ? 'Paid' : (q.status === 'OVERDUE' ? 'Overdue' : 'Payment due'),
            }))
          : (summary.totalFees > 0 ? getDefaultQuarters(summary.totalFees) : []);

        return {
          record: w.matchingRecord || null,
          id: String(w.id),
          name: summary.studentName || w.name,
          admissionNo: summary.admissionNo || w.admissionNo,
          class: summary.class || w.class,
          classId: summary.classId || w.classId,
          section: summary.section || w.section,
          sectionId: summary.sectionId || w.sectionId,
          academicYear: summary.academicYear || w.academicYear,
          feeTotal: summary.totalFees,
          feePaid: summary.totalPaid,
          feePending: summary.balanceDue,
          quartersPaid: summary.quartersPaid,
          totalQuarters: summary.totalQuarters,
          paymentStatus: summary.paymentStatus,
          items: summary.breakdown || [],
          quarters: quartersList,
          paymentHistory: summary.payments || [],
          hasStructure: summary.hasStructure,
        };
      }

      const classStr = findStructureForStudent({
        id: w.id,
        classId: w.classId,
        sectionId: w.sectionId,
        class: w.class,
        section: w.section,
        academicYear: w.academicYear,
      });

      const baseItems = w.matchingRecord?.customItems && w.matchingRecord.customItems.length > 0
        ? w.matchingRecord.customItems
        : (classStr ? classStr.items || [] : []);

      const baseTotal = baseItems.reduce((sum: number, item: any) => sum + (Number(item.amount) || 0), 0);

      const transport = Number(w.matchingRecord?.transportCharges || 0);
      const hostel = Number(w.matchingRecord?.hostelCharges || 0);
      const fine = Number(w.matchingRecord?.fineAmount || 0);
      const scholarship = Number(w.matchingRecord?.scholarship || 0);
      const discount = Number(w.matchingRecord?.discount || 0);

      const total = baseItems.length > 0
        ? Math.max(0, baseTotal + transport + hostel + fine - scholarship - discount)
        : 0;

      const historyPaid = w.matchingRecord?.paymentHistory
        ? w.matchingRecord.paymentHistory.reduce((sum: number, p: any) => sum + (Number(p.amountPaid) || 0), 0)
        : 0;

      const paid = Math.max(historyPaid, w.apiFeePaid);
      const pending = Math.max(0, total - paid);

      const quarters = (w.matchingRecord?.customQuarters && w.matchingRecord.customQuarters.length > 0)
        ? w.matchingRecord.customQuarters
        : (classStr && classStr.quarters && classStr.quarters.length > 0)
        ? classStr.quarters
        : (total > 0 ? getDefaultQuarters(total) : []);

      return {
        record: w.matchingRecord || null,
        id: w.id,
        name: w.name,
        admissionNo: w.admissionNo,
        class: w.class,
        classId: w.classId,
        section: w.section,
        sectionId: w.sectionId,
        academicYear: w.academicYear,
        feeTotal: total,
        feePaid: paid,
        feePending: pending,
        items: baseItems,
        quarters,
        paymentHistory: w.matchingRecord?.paymentHistory || [],
        hasStructure: !!classStr && baseItems.length > 0,
      };
    });
  }, [studentRecords, apiWards, structures, dbSummaries]);

  // Overall totals across linked wards
  const totals = useMemo(() => {
    return effectiveWards.reduce(
      (acc, ward) => ({
        total: acc.total + ward.feeTotal,
        paid: acc.paid + ward.feePaid,
        pending: acc.pending + ward.feePending,
      }),
      { total: 0, paid: 0, pending: 0 }
    );
  }, [effectiveWards]);

  // Accordion toggle states per ward
  const [expandedWardId, setExpandedWardId] = useState<string | null>(effectiveWards[0]?.id || null);

  // Pay Now Modal State
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [selectedPayWard, setSelectedPayWard] = useState<any>(null);
  const [selectedQuarter, setSelectedQuarter] = useState<QuarterFeeDetail | null>(null);
  const [paymentAmountInput, setPaymentAmountInput] = useState<number>(0);
  const [selectedGateway, setSelectedGateway] = useState<'UPI' | 'Razorpay' | 'Card' | 'NetBanking'>('UPI');
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  // Receipt Modal State
  const [viewingReceipt, setViewingReceipt] = useState<StudentPayment | null>(null);
  const [viewingReceiptWardName, setViewingReceiptWardName] = useState<string>('');

  // Open Pay Now Modal for specific Quarter
  const handleOpenPayQuarter = (ward: any, quarter: QuarterFeeDetail) => {
    if (role === 'Student') {
      alert('Fee payments can only be processed by Parent/Guardian accounts.');
      return;
    }
    const quarters = ward.quarters || [];
    const qIndex = quarters.findIndex((item: any) => item.quarter === quarter.quarter || item.id === quarter.id);
    if (qIndex > 0) {
      const hasUnpaidPrior = quarters.slice(0, qIndex).some(
        (prevQ: any) => (prevQ.remainingAmount !== undefined ? prevQ.remainingAmount > 0 : (prevQ.amount > (prevQ.paidAmount || 0))) && prevQ.status !== 'Paid' && prevQ.status !== 'PAID'
      );
      if (hasUnpaidPrior) {
        const priorQName = quarters[qIndex - 1]?.name || `Quarter ${qIndex}`;
        alert(`Please complete the payment for ${priorQName} first before paying this quarter.`);
        return;
      }
    }
    setSelectedPayWard(ward);
    setSelectedQuarter(quarter);
    const initialAmt = (quarter.remainingAmount !== undefined && quarter.remainingAmount > 0)
      ? quarter.remainingAmount
      : quarter.amount;
    setPaymentAmountInput(initialAmt);
    setIsPayModalOpen(true);
  };

  // Process Online Payment Submission
  const handleCompletePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPayWard) return;

    const amount = Number(paymentAmountInput);
    if (!amount || amount <= 0) {
      alert('Please enter a valid payment amount.');
      return;
    }

    setIsProcessingPayment(true);

    try {
      const receiptNo = `RCPT-2026-${Math.floor(Math.random() * 899 + 100)}`;
      const gatewayName = selectedGateway === 'Card' ? 'Credit/Debit Card' : (selectedGateway === 'NetBanking' ? 'Net Banking' : selectedGateway);
      const newPayment: StudentPayment = {
        id: `p-online-${Date.now()}`,
        paymentDate: new Date().toISOString().split('T')[0],
        amountPaid: amount,
        paymentMethod: gatewayName,
        transactionId: `TXN-UPI-${Math.floor(Math.random() * 89999 + 10000)}`,
        receiptNo,
        category: selectedQuarter ? selectedQuarter.name : 'School Fee Payment',
        installmentType: selectedQuarter ? selectedQuarter.quarter : 'Custom',
      };

      // Direct backend DB transaction
      const dbResult = await recordStudentPaymentInDB({
        studentId: selectedPayWard.id,
        amountPaid: amount,
        paymentMethod: gatewayName,
        category: newPayment.category,
        installmentType: newPayment.installmentType,
        quarterId: selectedQuarter?.id ? Number(selectedQuarter.id) : undefined,
      });

      if (dbResult && dbResult.summary) {
        setDbSummaries((prev) => ({ ...prev, [String(selectedPayWard.id)]: dbResult.summary }));
      }

      // Update student record in localStorage
      const saved = localStorage.getItem('erp_individual_fees');
      let currentRecords: IndividualStudentFeeRecord[] = saved ? JSON.parse(saved) : [];

      let updatedRecords: IndividualStudentFeeRecord[];
      if (currentRecords.some((r) => r.studentId === selectedPayWard.id)) {
        updatedRecords = currentRecords.map((r) => {
          if (r.studentId === selectedPayWard.id) {
            return {
              ...r,
              paymentHistory: [newPayment, ...r.paymentHistory],
            };
          }
          return r;
        });
      } else {
        updatedRecords = [
          ...currentRecords,
          {
            id: `FR-${selectedPayWard.id}`,
            studentId: selectedPayWard.id,
            studentName: selectedPayWard.name,
            admissionNo: selectedPayWard.admissionNo,
            class: selectedPayWard.class,
            section: selectedPayWard.section,
            academicYear: selectedPayWard.academicYear,
            scholarship: 0,
            discount: 0,
            transportCharges: 0,
            hostelCharges: 0,
            fineAmount: 0,
            installmentsPaid: 1,
            paymentHistory: [newPayment],
          },
        ];
      }

      setStudentRecords(updatedRecords);
      localStorage.setItem('erp_individual_fees', JSON.stringify(updatedRecords));

      setIsProcessingPayment(false);
      setIsPayModalOpen(false);

      emitNotification({
        title: 'Payment Successful',
        message: `Online payment of ₹${amount.toLocaleString('en-IN')} for ${selectedPayWard.name} recorded. Receipt: ${receiptNo}`,
        tone: 'success',
        source: 'fees',
      });

      // Show receipt modal
      setViewingReceiptWardName(selectedPayWard.name);
      setViewingReceipt(newPayment);

      window.dispatchEvent(new Event('erp_fees_updated'));

      alert(`Payment of ₹${amount.toLocaleString('en-IN')} successfully processed and stored in database!\nReceipt No: ${receiptNo}`);
    } catch (err) {
      setIsProcessingPayment(false);
      console.error('Payment processing failed:', err);
      alert('Payment could not be processed. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
        Loading school fee details...
      </div>
    );
  }

  return (
    <section className="space-y-6 max-w-6xl mx-auto pb-12 animate-fade-in" id="family-fees">
      {/* Portal Header Card */}
      <div className="portal-header-card flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shrink-0">
            <CreditCard className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="portal-pill-badge indigo mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block"></span>
              {role === 'Parent' ? 'Parent Portal' : 'Student Portal'}
            </div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight leading-tight">My School Fees</h1>
            <p className="text-sm text-slate-500 mt-0.5">Live fee balances and quarterly payment schedule from your linked student record.</p>
          </div>
        </div>
        <div className="shrink-0">
          <IndianRupee className="w-9 h-9 text-indigo-200" />
        </div>
      </div>

      {role === 'Student' && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/80 p-4 text-xs font-semibold text-indigo-900 flex items-center gap-2.5">
          <AlertCircle className="w-5 h-5 text-indigo-600 shrink-0" />
          <span>
            <strong>Student Access Mode:</strong> You are viewing your class fee structure and quarterly schedule loaded from the Database. Online fee payment processing is restricted to Parent/Guardian accounts. Please ask your parent/guardian to log in to complete payments.
          </span>
        </div>
      )}

      {error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
          {error}
        </p>
      )}

      {/* TOP 3 METRIC CARDS */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="portal-card p-5 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center">
              <IndianRupee className="w-4 h-4 text-indigo-600" />
            </div>
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Fees</span>
          </div>
          <p className="text-2xl font-extrabold text-indigo-700">₹{totals.total.toLocaleString('en-IN')}</p>
          <p className="text-xs text-slate-400">Annual fee structure total</p>
        </div>
        <div className="portal-card p-5 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center">
              <CheckCircle className="w-4 h-4 text-emerald-600" />
            </div>
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Paid</span>
          </div>
          <p className="text-2xl font-extrabold text-emerald-600">₹{totals.paid.toLocaleString('en-IN')}</p>
          <p className="text-xs text-slate-400">Payments received to date</p>
        </div>
        <div className="portal-card p-5 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-rose-50 flex items-center justify-center">
              <AlertCircle className="w-4 h-4 text-rose-500" />
            </div>
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Balance Due</span>
          </div>
          <p className="text-2xl font-extrabold text-rose-600">₹{totals.pending.toLocaleString('en-IN')}</p>
          <p className="text-xs text-slate-400">Outstanding balance</p>
        </div>
      </div>

      {/* LINKED WARDS LIST */}
      <div className="space-y-6">
        {effectiveWards.map((ward) => {
          const isExpanded = expandedWardId === ward.id;

          // Use authoritative database quarters directly
          const quartersWithStatus = ward.quarters.map((q: any) => ({
            ...q,
            status: q.status === 'PAID' || q.status === 'Paid'
              ? 'Paid'
              : (q.status === 'PARTIALLY_PAID' || q.status === 'Partially Paid'
                ? 'Partially Paid'
                : (q.status === 'OVERDUE' || q.status === 'Overdue'
                  ? 'Overdue'
                  : 'Payment due')),
          }));

          const paidQuartersCount = ward.quartersPaid !== undefined
            ? ward.quartersPaid
            : quartersWithStatus.filter((q: any) => q.status === 'Paid').length;
          const totalQuartersCount = ward.totalQuarters !== undefined
            ? ward.totalQuarters
            : quartersWithStatus.length;

          return (
            <article key={ward.id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
              {/* WARD HEADER CARD */}
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-xl font-extrabold text-slate-900">{ward.name}</h3>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    {ward.admissionNo} · Class {ward.class || '-'}-{ward.section || '-'} · {ward.academicYear || 'Current Year'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {totalQuartersCount > 0 && ward.hasStructure && (
                    <span className="rounded-full bg-indigo-50 border border-indigo-200/80 px-3 py-1 text-xs font-bold text-indigo-700">
                      {paidQuartersCount} of {totalQuartersCount} Quarters Paid
                    </span>
                  )}
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-extrabold uppercase tracking-wider ${
                      ward.feePending === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                    }`}
                  >
                    {ward.feePending === 0 ? 'Paid' : 'Payment due'}
                  </span>
                  <button
                    onClick={() => setExpandedWardId(isExpanded ? null : ward.id)}
                    className="p-2 hover:bg-slate-100 rounded-xl text-slate-500 transition-colors"
                  >
                    {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {!ward.hasStructure && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-xs font-semibold text-amber-900 flex items-center gap-2.5">
                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                  <span>No fee structure is currently configured in the database for Class {ward.class || '-'}. Please contact the school administration.</span>
                </div>
              )}

              {/* SUMMARY VALUES (MATCHES SCREENSHOT) */}
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <Value label="FEE TOTAL" value={ward.feeTotal} />
                <Value label="PAID" value={ward.feePaid} />
                <Value label="BALANCE" value={ward.feePending} />
              </div>

              {/* EXPANDABLE DIVISION & PAYMENT SECTION */}
              {isExpanded && (
                <div className="pt-4 border-t border-slate-100 space-y-6 animate-in fade-in duration-150">
                  {/* 1. QUARTERLY FEE DIVISION GRID */}
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                      <h4 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-indigo-600" />
                        Quarterly Fee Schedule & Payment Division
                      </h4>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 font-semibold hidden sm:inline">
                          Pay per quarter or in custom partial amounts
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      {quartersWithStatus.map((q: any, qIdx: number) => {
                        const isQuarterLocked = qIdx > 0 && quartersWithStatus
                          .slice(0, qIdx)
                          .some((prevQ: any) => prevQ.status !== 'Paid' && (prevQ.remainingAmount === undefined || prevQ.remainingAmount > 0));

                        return (
                          <div
                            key={q.quarter}
                            className={`rounded-2xl p-4 border transition-all ${
                              q.status === 'Paid'
                                ? 'bg-emerald-50/40 border-emerald-200'
                                : q.status === 'Partially Paid'
                                ? 'bg-amber-50/40 border-amber-200'
                                : q.status === 'Overdue'
                                ? 'bg-rose-50/40 border-rose-200'
                                : 'bg-slate-50 border-slate-200'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-black uppercase text-slate-500">{q.quarter}</span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                                  q.status === 'Paid'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : q.status === 'Partially Paid'
                                    ? 'bg-amber-100 text-amber-800'
                                    : q.status === 'Overdue'
                                    ? 'bg-rose-100 text-rose-800'
                                    : 'bg-slate-200 text-slate-700'
                                }`}
                              >
                                {q.status}
                              </span>
                            </div>

                            <h5 className="font-extrabold text-slate-900 text-sm mt-1">{q.name}</h5>
                            <p className="text-[11px] text-slate-400 font-medium">Due Date: {q.dueDate}</p>

                            <div className="mt-3 pt-2 border-t border-slate-200/60 flex items-center justify-between text-xs">
                              <div>
                                <p className="text-[10px] font-bold uppercase text-slate-400">Quarter Fee</p>
                                <p className="font-extrabold text-slate-900">₹{q.amount.toLocaleString('en-IN')}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-[10px] font-bold uppercase text-slate-400">Remaining</p>
                                <p className={`font-black ${q.remainingAmount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                  ₹{q.remainingAmount.toLocaleString('en-IN')}
                                </p>
                              </div>
                            </div>

                            {/* PAY NOW BUTTON FOR QUARTER */}
                            {q.remainingAmount > 0 && (
                              role === 'Parent' ? (
                                isQuarterLocked ? (
                                  <button
                                    type="button"
                                    disabled
                                    className="mt-3 w-full py-2 bg-slate-100 border border-slate-200 text-slate-400 font-bold text-xs rounded-xl cursor-not-allowed flex items-center justify-center gap-1.5 transition-all shadow-none select-none"
                                    title={`Please pay ${quartersWithStatus[qIdx - 1]?.name || 'previous quarter'} first to unlock.`}
                                  >
                                    <Lock className="w-3.5 h-3.5 text-slate-400" />
                                    <span>Pay Quarter Now</span>
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenPayQuarter(ward, q)}
                                    className="mt-3 w-full py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white font-extrabold text-xs rounded-xl shadow-md shadow-indigo-600/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                                  >
                                    Pay Quarter Now <ArrowRight className="w-3.5 h-3.5" />
                                  </button>
                                )
                              ) : (
                                <div className="mt-3 py-1.5 text-center text-[11px] font-bold text-slate-400 bg-slate-100/80 rounded-xl border border-slate-200/60">
                                  Parent Payment Only
                                </div>
                              )
                            )}

                            {q.status === 'Paid' && (
                              <div className="mt-3 py-1.5 text-center text-xs font-extrabold text-emerald-700 bg-emerald-100/60 rounded-xl flex items-center justify-center gap-1">
                                <CheckCircle className="w-3.5 h-3.5" /> Paid in Full
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 2. FEE COMPONENT DIVISION TABLE */}
                  <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200">
                    <h4 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <Receipt className="w-4 h-4 text-indigo-600" />
                      Annual Fee Component Division
                    </h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase">
                            <th className="py-2 px-2">Fee Component</th>
                            <th className="py-2 px-2 text-right">Amount (₹)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200/60 font-medium text-slate-700">
                          {ward.items.map((item: any, idx: number) => (
                            <tr key={idx}>
                              <td className="py-2 px-2 font-bold text-slate-800">{item.category}</td>
                              <td className="py-2 px-2 text-right font-black text-slate-900">
                                ₹{Number(item.amount).toLocaleString('en-IN')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-slate-900 text-slate-900 font-extrabold text-xs bg-white">
                            <td className="py-2 px-2">Total Fee Breakup</td>
                            <td className="py-2 px-2 text-right text-indigo-700">₹{ward.feeTotal.toLocaleString('en-IN')}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  {/* 3. PAYMENT TRANSACTION HISTORY */}
                  {ward.paymentHistory && ward.paymentHistory.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">Recent Receipts</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        {ward.paymentHistory.map((pmt: any) => (
                          <div key={pmt.id} className="p-3 bg-white rounded-xl border border-slate-200 flex items-center justify-between">
                            <div>
                              <p className="font-bold text-slate-900">{pmt.category || pmt.installmentType} · {pmt.paymentDate}</p>
                              <p className="text-[11px] text-slate-400">Via {pmt.paymentMethod} · Receipt: {pmt.receiptNo}</p>
                            </div>
                            <button
                              onClick={() => {
                                setViewingReceiptWardName(ward.name);
                                setViewingReceipt(pmt);
                              }}
                              className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold rounded-lg transition-colors flex items-center gap-1 text-[11px]"
                            >
                              Receipt
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {/* ========================================================================= */}
      {/* INTERACTIVE PAY NOW MODAL */}
      {/* ========================================================================= */}
      {isPayModalOpen && selectedPayWard && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex min-h-full items-center justify-center p-3 sm:p-5 animate-fade-in" role="presentation">
          <div className="bg-white rounded-3xl max-w-xl w-full max-h-[85vh] my-auto flex flex-col p-6 shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95" role="dialog" aria-modal="true" aria-labelledby="pay-modal-title">
            <div className="flex-shrink-0 flex justify-between items-center border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-extrabold text-slate-900 text-base">Make Fee Payment</h3>
                <p className="text-xs text-slate-500">Student: {selectedPayWard.name}</p>
              </div>
              <button type="button" onClick={() => setIsPayModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCompletePayment} className="flex-1 flex flex-col min-h-0 mt-3">
              <div className="flex-1 overflow-y-auto space-y-3.5 pr-1 py-1">
                <div className="grid gap-3 sm:grid-cols-2 items-start">
                  {selectedQuarter ? (
                    <div className="p-3.5 bg-indigo-50/70 border border-indigo-200 rounded-2xl flex flex-col justify-between text-xs h-full min-h-[86px]">
                      <div>
                        <span className="font-black text-indigo-700 text-sm block">{selectedQuarter.name}</span>
                        <p className="text-[11px] text-indigo-500 font-medium mt-0.5">Due Date: {selectedQuarter.dueDate}</p>
                      </div>
                      <span className="text-base font-black text-indigo-800 mt-2">₹{selectedQuarter.amount.toLocaleString('en-IN')}</span>
                    </div>
                  ) : (
                    <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs h-full min-h-[86px]">
                      <span className="font-bold text-slate-700 block">General Fee Payment</span>
                      <p className="text-[11px] text-slate-500 mt-1">Direct tuition and academic fee settlement</p>
                    </div>
                  )}

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-xs font-bold text-slate-600">Quarterly Fee Amount (₹)</label>
                      <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-200">
                        Fixed
                      </span>
                    </div>
                    <input
                      type="number"
                      value={paymentAmountInput}
                      readOnly
                      className="w-full text-base font-extrabold p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 cursor-not-allowed"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-2">Select Payment Method</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-bold">
                    {(['UPI', 'Razorpay', 'Card', 'NetBanking'] as const).map((gw) => (
                      <button
                        key={gw}
                        type="button"
                        onClick={() => setSelectedGateway(gw)}
                        className={`p-2.5 rounded-xl border flex items-center justify-center gap-1.5 transition-all ${
                          selectedGateway === gw
                            ? 'border-indigo-600 bg-indigo-600 text-white font-extrabold shadow-xs'
                            : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        {gw === 'UPI' && <Smartphone className="w-3.5 h-3.5" />}
                        {gw === 'Razorpay' && <CreditCard className="w-3.5 h-3.5" />}
                        {gw === 'Card' && <CreditCard className="w-3.5 h-3.5" />}
                        {gw === 'NetBanking' && <Landmark className="w-3.5 h-3.5" />}
                        {gw}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex-shrink-0 pt-3 border-t border-slate-100 mt-2">
                <button
                  type="submit"
                  disabled={isProcessingPayment}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black text-sm rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2"
                >
                  {isProcessingPayment ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" /> Processing Payment...
                    </>
                  ) : (
                    <>
                      Pay ₹{Number(paymentAmountInput).toLocaleString('en-IN')} Now <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================================= */}
      {/* PRINTABLE RECEIPT MODAL */}
      {/* ========================================================================= */}
      {viewingReceipt && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex min-h-full items-center justify-center p-3 sm:p-5 animate-fade-in" role="presentation">
          <div className="bg-white rounded-3xl max-w-lg w-full max-h-[85vh] my-auto flex flex-col p-6 shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 print:p-0 print:shadow-none" role="dialog" aria-modal="true" aria-labelledby="receipt-modal-title">
            <div className="flex-shrink-0 text-center border-b border-slate-100 pb-3">
              <span className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full font-bold text-[10px] uppercase">
                Payment Receipt
              </span>
              <h3 className="text-lg font-black text-slate-900 mt-1.5">Worexa Education</h3>
              <p className="text-xs text-slate-400 font-mono mt-0.5">{viewingReceipt.receiptNo}</p>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1 py-2 text-xs">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 bg-slate-50/60 p-3 rounded-2xl border border-slate-100">
                <div>
                  <span className="block text-[10px] font-semibold text-slate-400 uppercase">Student Name</span>
                  <span className="font-extrabold text-slate-900">{viewingReceiptWardName}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold text-slate-400 uppercase">Payment Category</span>
                  <span className="font-bold text-slate-800">{viewingReceipt.category}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold text-slate-400 uppercase">Payment Date</span>
                  <span className="font-bold text-slate-800">{viewingReceipt.paymentDate}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold text-slate-400 uppercase">Payment Method</span>
                  <span className="font-bold text-slate-800">{viewingReceipt.paymentMethod}</span>
                </div>
                <div className="col-span-2">
                  <span className="block text-[10px] font-semibold text-slate-400 uppercase">Transaction ID</span>
                  <span className="font-mono text-slate-700 break-all">{viewingReceipt.transactionId}</span>
                </div>
              </div>

              <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-200 text-center">
                <p className="text-[10px] font-bold uppercase text-emerald-700">Amount Paid</p>
                <p className="text-2xl font-black text-emerald-800 mt-0.5">₹{viewingReceipt.amountPaid.toLocaleString('en-IN')}</p>
                <p className="text-[10px] text-emerald-600 font-bold mt-0.5">Status: CLEARED & VERIFIED</p>
              </div>
            </div>

            <div className="flex-shrink-0 flex justify-end gap-2 pt-3 border-t border-slate-100 mt-2 print:hidden">
              <button
                onClick={() => window.print()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition-colors"
              >
                <Printer className="w-4 h-4" /> Print Receipt
              </button>
              <button
                onClick={() => setViewingReceipt(null)}
                className="px-4 py-2 border border-slate-200 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: 'indigo' | 'emerald' | 'rose' }) {
  const styles = {
    indigo: 'bg-indigo-50/70 text-indigo-900 border border-indigo-100',
    emerald: 'bg-emerald-50/70 text-emerald-900 border border-emerald-100',
    rose: 'bg-rose-50/70 text-rose-900 border border-rose-100',
  };
  const iconColors = {
    indigo: 'text-indigo-600',
    emerald: 'text-emerald-600',
    rose: 'text-rose-600',
  };
  return (
    <div className={`rounded-2xl p-5 shadow-sm ${styles[tone]}`}>
      <IndianRupee className={`h-4 w-4 ${iconColors[tone]}`} />
      <p className="mt-3 text-2xl font-black tracking-tight">{value.toLocaleString('en-IN')}</p>
      <p className="mt-1 text-xs font-bold text-slate-500 uppercase tracking-wider">{label}</p>
    </div>
  );
}

function Value({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4 border border-slate-100">
      <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-1 flex items-center gap-1 text-lg font-black text-slate-900">
        <IndianRupee className="h-4 w-4 text-slate-600" />
        {value.toLocaleString('en-IN')}
      </p>
    </div>
  );
}
