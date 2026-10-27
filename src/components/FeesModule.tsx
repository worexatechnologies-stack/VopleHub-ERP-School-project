import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  CreditCard,
  Landmark,
  CheckCircle,
  Bell,
  ArrowRight,
  ArrowLeft,
  ChevronRight,
  ShieldCheck,
  Download,
  AlertTriangle,
  Trash2,
  Edit,
  Plus,
  Filter,
  Receipt,
  BarChart3,
  TrendingUp,
  Calendar,
  BookOpen,
  Send,
  Printer,
  Share2,
  DollarSign,
  Wallet,
  Percent,
  RefreshCw,
  Search,
  Check,
  X,
  User,
  Users,
  PieChart as PieIcon,
  IndianRupee,
  Layers,
  FileSpreadsheet,
  Info,
  Smartphone,
  RotateCcw
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { Student } from '../types';
import { emitNotification } from '../services/notificationBus';
import {
  fetchFeeStructuresFromDB,
  fetchFeeQuartersFromDB,
  createFeeStructureInDB,
  updateFeeStructureInDB,
  deleteFeeStructureFromDB,
  fetchStudentFeeRecordsFromDB,
  recordFeePaymentInDB,
  recordStudentPaymentInDB,
  updateStudentFeeRecordInDB
} from '../services/financeApi';

import {
  AcademicClass,
  AcademicSection,
  AcademicYear,
  loadAcademicStructure,
} from '../services/academicStructure';
import { exportFeeInvoicesToExcel } from '../utils/feeInvoiceExport';

// ==========================================
// INTERFACES & MODEL TYPES
// ==========================================

export interface FeeCategory {
  id: string;
  name: string;
  description: string;
  isOptional: boolean;
}

export interface FeeStructureItem {
  category: string;
  amount: number;
  dueDate?: string;
}

export interface QuarterFeeDetail {
  id?: number | string;
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4' | string;
  name: string;
  amount: number;
  dueDate: string;
  paidAmount?: number;
  remainingAmount?: number;
  status?: string;
}

export const getDefaultQuarters = (totalFee: number): QuarterFeeDetail[] => {
  const qVal = Math.round(totalFee / 4);
  const q1 = qVal;
  const q2 = qVal;
  const q3 = qVal;
  const q4 = Math.max(0, totalFee - (q1 + q2 + q3));
  return [
    { quarter: 'Q1', name: 'Quarter 1 (Apr - Jun)', amount: q1, dueDate: '2026-04-15' },
    { quarter: 'Q2', name: 'Quarter 2 (Jul - Sep)', amount: q2, dueDate: '2026-07-15' },
    { quarter: 'Q3', name: 'Quarter 3 (Oct - Dec)', amount: q3, dueDate: '2026-10-15' },
    { quarter: 'Q4', name: 'Quarter 4 (Jan - Mar)', amount: q4, dueDate: '2027-01-15' },
  ];
};

export interface FeeStructure {
  id: string;
  name: string;
  academicYear: string;
  academicYearId?: number;
  level: 'school' | 'class' | 'section' | 'student';
  targetClass?: string;
  targetClassId?: number;
  targetSection?: string;
  targetSectionId?: number;
  targetStudentId?: string;
  items: FeeStructureItem[];
  quarters?: QuarterFeeDetail[];
  lateFeeRule?: {
    gracePeriodDays: number;
    amountPerDay: number;
  };
}

export interface StudentPayment {
  id: string;
  paymentDate: string;
  amountPaid: number;
  paymentMethod: 'UPI' | 'Razorpay' | 'Card' | 'NetBanking' | 'Cash' | 'Credit/Debit Card' | 'Net Banking';
  transactionId: string;
  receiptNo: string;
  category?: string;
  installmentType?: string;
  quarterId?: number | string;
}

export interface IndividualStudentFeeRecord {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  class: string;
  classId?: number;
  section: string;
  sectionId?: number;
  academicYear: string;
  customItems?: FeeStructureItem[]; // Custom fee component breakups for student
  customQuarters?: QuarterFeeDetail[]; // Custom quarter schedule for student
  scholarship?: number;
  discount?: number;
  transportCharges?: number;
  hostelCharges?: number;
  fineAmount?: number;
  installmentsPaid?: number;
  paymentHistory: StudentPayment[];
}

interface FeesModuleProps {
  user: {
    name: string;
    role: string;
    email: string;
    studentId?: string;
  } | null;
  students: Student[];
  currentAcademicYear: string;
  schoolName?: string;
  onAddLog: (message: string) => void;
}

// Helper to clean and normalize class identifier (e.g. 'Class - 1' -> '1', 'class-1' -> '1', '10' -> '10')
export const cleanClassNumber = (cls?: string): string => {
  if (!cls) return '';
  return cls.replace(/^class\s*[-_]?\s*/i, '').trim();
};

export const formatClassLabel = (cls?: string): string => {
  if (!cls) return '';
  const num = cleanClassNumber(cls);
  return num ? `Class ${num}` : cls;
};

export const matchClass = (cls1?: string, cls2?: string): boolean => {
  if (!cls1 || !cls2) return false;
  const n1 = cleanClassNumber(cls1).toLowerCase();
  const n2 = cleanClassNumber(cls2).toLowerCase();
  if (n1 && n2 && n1 === n2) return true;
  return cls1.trim().toLowerCase() === cls2.trim().toLowerCase();
};

export const matchAcademicYear = (y1?: string, y2?: string): boolean => {
  if (!y1 || !y2) return true;
  const c1 = y1.replace(/[^0-9]/g, '');
  const c2 = y2.replace(/[^0-9]/g, '');
  if (c1 === c2) return true;
  if (c1.slice(0, 4) && c2.slice(0, 4) && c1.slice(0, 4) === c2.slice(0, 4)) return true;
  return y1.trim().toLowerCase() === y2.trim().toLowerCase();
};

// DEFAULT COMPONENT BREAKUP (Total = ₹35,000)
const DEFAULT_FEE_BREAKUP: FeeStructureItem[] = [
  { category: 'Tuition Fee', amount: 20000, dueDate: '2026-08-31' },
  { category: 'Examination Fee', amount: 3000, dueDate: '2026-09-30' },
  { category: 'Library Fee', amount: 2000, dueDate: '2026-08-31' },
  { category: 'Activity Fee', amount: 5000, dueDate: '2026-10-31' },
  { category: 'Lab Fee', amount: 3000, dueDate: '2026-08-31' },
  { category: 'Sports Fee', amount: 2000, dueDate: '2026-11-30' },
];

export default function FeesModule({
  user,
  students,
  currentAcademicYear,
  schoolName = 'Worexa Education',
  onAddLog
}: FeesModuleProps) {
  const currentUserRole = user?.role || 'School Admin';
  const currentStudentId = user?.studentId || '';

  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [academicClasses, setAcademicClasses] = useState<AcademicClass[]>([]);
  const [academicSections, setAcademicSections] = useState<AcademicSection[]>([]);
  const [isAcademicStructureLoading, setIsAcademicStructureLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setIsAcademicStructureLoading(true);
    loadAcademicStructure()
      .then(({ years, classes, sections }) => {
        if (!active) return;
        setAcademicYears(years);
        setAcademicClasses(classes);
        setAcademicSections(sections);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setIsAcademicStructureLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const academicYearOptions = Array.from(new Set([
    currentAcademicYear,
    ...academicYears.map((year) => year.name),
  ].filter(Boolean)));

  const activeAcademicYear = currentAcademicYear
    || academicYears.find((year) => year.is_active)?.name
    || academicYearOptions[0]
    || '2026-27';

  // ------------------------------------------
  // PERSISTENCE STATE (STORAGE)
  // ------------------------------------------
  const [structures, setStructures] = useState<FeeStructure[]>(() => {
    const saved = localStorage.getItem('erp_fee_structures');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {}
    }
    return [];
  });

  useEffect(() => {
    localStorage.setItem('erp_fee_structures', JSON.stringify(structures));
  }, [structures]);

  const [studentRecords, setStudentRecords] = useState<IndividualStudentFeeRecord[]>(() => {
    const saved = localStorage.getItem('erp_individual_fees');
    let parsed: IndividualStudentFeeRecord[] = [];
    if (saved) {
      try {
        parsed = JSON.parse(saved);
      } catch (e) {}
    }

    const currentStudentIds = new Set(students.map((st) => st.id));
    const seeded: IndividualStudentFeeRecord[] = Array.isArray(parsed)
      ? parsed.filter((r) => currentStudentIds.has(r.studentId))
      : [];

    // Ensure every student in props has a record
    students.forEach((st) => {
      if (!seeded.some((r) => r.studentId === st.id)) {
        seeded.push({
          id: `FR-${st.id}`,
          studentId: st.id,
          studentName: st.name,
          admissionNo: st.admissionNo || `ADM-${st.id.slice(-4).toUpperCase()}`,
          class: st.class || '',
          classId: st.classId,
          section: st.section || '',
          sectionId: st.sectionId,
          academicYear: st.academicYear || activeAcademicYear,
          customItems: undefined,
          scholarship: 0,
          discount: 0,
          transportCharges: 0,
          hostelCharges: 0,
          fineAmount: 0,
          installmentsPaid: 0,
          paymentHistory: []
        });
      }
    });

    return seeded;
  });

  useEffect(() => {
    localStorage.setItem('erp_individual_fees', JSON.stringify(studentRecords));
  }, [studentRecords]);

  // Compiled present clean classes for selection & overview (only from created classes/students/structures)
  const availableClasses = useMemo(() => {
    const classMap = new Map<string, string>();
    academicClasses.forEach((c) => {
      if (c.name) {
        const clean = cleanClassNumber(c.name);
        if (clean) classMap.set(clean, clean);
      }
    });
    studentRecords.forEach((r) => {
      if (r.class) {
        const clean = cleanClassNumber(r.class);
        if (clean) classMap.set(clean, clean);
      }
    });
    students.forEach((s) => {
      if (s.class) {
        const clean = cleanClassNumber(s.class);
        if (clean) classMap.set(clean, clean);
      }
    });
    structures.forEach((st) => {
      if (st.targetClass) {
        const clean = cleanClassNumber(st.targetClass);
        if (clean) classMap.set(clean, clean);
      }
    });
    return Array.from(classMap.keys()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [academicClasses, studentRecords, students, structures]);

  // Synchronize student list when props update
  useEffect(() => {
    setStudentRecords((current) => {
      let changed = false;
      const studentsById = new Map(students.map((st) => [st.id, st]));
      const validCurrent = current.filter((r) => studentsById.has(r.studentId));
      if (validCurrent.length !== current.length) {
        changed = true;
      }
      const updated = validCurrent.map((record) => {
        const st = studentsById.get(record.studentId);
        if (!st) return record;
        const nextClass = st.class || record.class;
        const nextClassId = st.classId || record.classId;
        const nextSection = st.section || record.section;
        const nextSectionId = st.sectionId || record.sectionId;
        const nextYear = st.academicYear || record.academicYear;
        const nextAdmission = st.admissionNo || record.admissionNo;
        if (
          record.studentName === st.name &&
          record.admissionNo === nextAdmission &&
          record.class === nextClass &&
          record.classId === nextClassId &&
          record.section === nextSection &&
          record.sectionId === nextSectionId &&
          record.academicYear === nextYear
        ) {
          return record;
        }
        changed = true;
        return {
          ...record,
          studentName: st.name,
          admissionNo: nextAdmission,
          class: nextClass,
          classId: nextClassId,
          section: nextSection,
          sectionId: nextSectionId,
          academicYear: nextYear,
        };
      });

      students.forEach((st) => {
        if (!updated.some((r) => r.studentId === st.id)) {
          updated.push({
            id: `FR-${st.id}`,
            studentId: st.id,
            studentName: st.name,
            admissionNo: st.admissionNo || `ADM-${st.id.slice(-4).toUpperCase()}`,
            class: st.class || '1',
            classId: st.classId,
            section: st.section || 'A',
            sectionId: st.sectionId,
            academicYear: st.academicYear || activeAcademicYear,
            scholarship: 0,
            discount: 0,
            transportCharges: 0,
            hostelCharges: 0,
            fineAmount: 0,
            installmentsPaid: 0,
            paymentHistory: []
          });
          changed = true;
        }
      });

      return changed ? updated : current;
    });
  }, [students, activeAcademicYear]);

  // ------------------------------------------
  // HELPER CALCULATION FUNCTIONS (SIMPLE & INTUITIVE)
  // ------------------------------------------

  // Get itemized component breakdown for a student using 4-tier ID hierarchy
  const getStudentItemizedBreakdown = (record: IndividualStudentFeeRecord): FeeStructureItem[] => {
    if (record.customItems && record.customItems.length > 0) {
      return record.customItems;
    }

    // 1. Student-level Fee Structure
    const studentStr = structures.find(s =>
      s.level === 'student' &&
      (s.targetStudentId === record.studentId || s.targetStudentId === record.admissionNo) &&
      (!s.academicYear || matchAcademicYear(s.academicYear, record.academicYear))
    );
    if (studentStr && studentStr.items && studentStr.items.length > 0) return studentStr.items;

    // 2. Section-level Fee Structure (ID matching first)
    const sectionStr = structures.find(s =>
      s.level === 'section' &&
      ((s.targetSectionId && record.sectionId && s.targetSectionId === record.sectionId) ||
       (matchClass(s.targetClass, record.class) && s.targetSection?.toLowerCase() === record.section?.toLowerCase())) &&
      (!s.academicYear || matchAcademicYear(s.academicYear, record.academicYear))
    ) || structures.find(s =>
      s.level === 'section' &&
      ((s.targetSectionId && record.sectionId && s.targetSectionId === record.sectionId) ||
       (matchClass(s.targetClass, record.class) && s.targetSection?.toLowerCase() === record.section?.toLowerCase()))
    );
    if (sectionStr && sectionStr.items && sectionStr.items.length > 0) return sectionStr.items;

    // 3. Class-level Fee Structure (ID matching first)
    const classStr = structures.find(s =>
      s.level === 'class' &&
      ((s.targetClassId && record.classId && s.targetClassId === record.classId) ||
       matchClass(s.targetClass, record.class)) &&
      (!s.academicYear || matchAcademicYear(s.academicYear, record.academicYear))
    ) || structures.find(s =>
      s.level === 'class' &&
      ((s.targetClassId && record.classId && s.targetClassId === record.classId) ||
       matchClass(s.targetClass, record.class))
    );
    if (classStr && classStr.items && classStr.items.length > 0) return classStr.items;

    // 4. School-level Fee Structure
    const schoolStr = structures.find(s =>
      s.level === 'school' &&
      (!s.academicYear || matchAcademicYear(s.academicYear, record.academicYear))
    ) || structures.find(s => s.level === 'school');
    if (schoolStr && schoolStr.items && schoolStr.items.length > 0) return schoolStr.items;

    return [];
  };

  // Get quarterly fee division schedule for a student using 4-tier ID hierarchy
  const getStudentQuarters = (record: IndividualStudentFeeRecord, totalFee: number): QuarterFeeDetail[] => {
    if (record.customQuarters && record.customQuarters.length > 0) {
      return record.customQuarters;
    }
    const studentStr = structures.find(s =>
      s.level === 'student' &&
      (s.targetStudentId === record.studentId || s.targetStudentId === record.admissionNo) &&
      (!s.academicYear || matchAcademicYear(s.academicYear, record.academicYear))
    );
    if (studentStr && studentStr.quarters && studentStr.quarters.length > 0) return studentStr.quarters;

    const sectionStr = structures.find(s =>
      s.level === 'section' &&
      ((s.targetSectionId && record.sectionId && s.targetSectionId === record.sectionId) ||
       (matchClass(s.targetClass, record.class) && s.targetSection?.toLowerCase() === record.section?.toLowerCase())) &&
      (!s.academicYear || matchAcademicYear(s.academicYear, record.academicYear))
    ) || structures.find(s =>
      s.level === 'section' &&
      ((s.targetSectionId && record.sectionId && s.targetSectionId === record.sectionId) ||
       (matchClass(s.targetClass, record.class) && s.targetSection?.toLowerCase() === record.section?.toLowerCase()))
    );
    if (sectionStr && sectionStr.quarters && sectionStr.quarters.length > 0) return sectionStr.quarters;

    const classStr = structures.find(s =>
      s.level === 'class' &&
      ((s.targetClassId && record.classId && s.targetClassId === record.classId) ||
       matchClass(s.targetClass, record.class)) &&
      (!s.academicYear || matchAcademicYear(s.academicYear, record.academicYear))
    ) || structures.find(s =>
      s.level === 'class' &&
      ((s.targetClassId && record.classId && s.targetClassId === record.classId) ||
       matchClass(s.targetClass, record.class))
    );
    if (classStr && classStr.quarters && classStr.quarters.length > 0) return classStr.quarters;

    const schoolStr = structures.find(s =>
      s.level === 'school' &&
      (!s.academicYear || matchAcademicYear(s.academicYear, record.academicYear))
    ) || structures.find(s => s.level === 'school');
    if (schoolStr && schoolStr.quarters && schoolStr.quarters.length > 0) return schoolStr.quarters;

    if (totalFee > 0) {
      return getDefaultQuarters(totalFee);
    }
    return [];
  };

  // Comprehensive Fee Summary calculation
  const getStudentFeeSummary = (record: IndividualStudentFeeRecord) => {
    const items = getStudentItemizedBreakdown(record);
    const baseComponentsTotal = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

    const transport = Number(record.transportCharges) || 0;
    const hostel = Number(record.hostelCharges) || 0;
    const fine = Number(record.fineAmount) || 0;
    const scholarship = Number(record.scholarship) || 0;
    const discount = Number(record.discount) || 0;

    const totalFee = Math.max(0, baseComponentsTotal + transport + hostel + fine - scholarship - discount);
    const amountPaid = record.paymentHistory.reduce((sum, p) => sum + (Number(p.amountPaid) || 0), 0);
    const pendingBalance = Math.max(0, totalFee - amountPaid);
    const quarters = getStudentQuarters(record, totalFee);

    let status: 'Paid' | 'Partially Paid' | 'Unpaid' = 'Unpaid';
    if (pendingBalance === 0 && totalFee > 0) {
      status = 'Paid';
    } else if (amountPaid > 0) {
      status = 'Partially Paid';
    }

    return {
      items,
      quarters,
      baseComponentsTotal,
      transport,
      hostel,
      fine,
      scholarship,
      discount,
      totalFee,
      amountPaid,
      pendingBalance,
      status
    };
  };

  // ------------------------------------------
  // ADMIN PORTAL STATE & CONTROL
  // ------------------------------------------
  const isAdmin = ['Super Admin', 'School Admin', 'Principal', 'Accountant'].includes(currentUserRole);
  const [activeAdminTab, setActiveAdminTab] = useState<'analytics' | 'structures' | 'tracking' | 'reports'>('analytics');

  // Fee Structure Creator Modal State
  const [isStructureModalOpen, setIsStructureModalOpen] = useState(false);
  const [editingStructureId, setEditingStructureId] = useState<string | null>(null);
  const [structureForm, setStructureForm] = useState<{
    name: string;
    academicYear: string;
    academicYearId?: number;
    level: 'school' | 'class' | 'section' | 'student';
    targetClass: string;
    targetClassId?: number;
    targetSection: string;
    targetSectionId?: number;
    targetStudentId: string;
    items: FeeStructureItem[];
    quarters: QuarterFeeDetail[];
  }>({
    name: '',
    academicYear: activeAcademicYear,
    level: 'class',
    targetClass: '10',
    targetSection: 'A',
    targetStudentId: '',
    items: [...DEFAULT_FEE_BREAKUP],
    quarters: getDefaultQuarters(DEFAULT_FEE_BREAKUP.reduce((s, i) => s + i.amount, 0)),
  });

  // Calculate live structure total in creator form
  const structureFormTotal = useMemo(() => {
    return structureForm.items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  }, [structureForm.items]);

  // Helper to open structure creator
  const openCreateStructureModal = (structureToEdit?: FeeStructure) => {
    if (structureToEdit) {
      const tot = structureToEdit.items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
      setEditingStructureId(structureToEdit.id);
      setStructureForm({
        name: structureToEdit.name,
        academicYear: structureToEdit.academicYear,
        academicYearId: structureToEdit.academicYearId,
        level: structureToEdit.level,
        targetClass: structureToEdit.targetClass || (academicClasses[0]?.name || '10'),
        targetClassId: structureToEdit.targetClassId || academicClasses[0]?.id,
        targetSection: structureToEdit.targetSection || 'A',
        targetSectionId: structureToEdit.targetSectionId,
        targetStudentId: structureToEdit.targetStudentId || '',
        items: structureToEdit.items.map((it) => ({ ...it })),
        quarters: structureToEdit.quarters ? structureToEdit.quarters.map(q => ({ ...q })) : getDefaultQuarters(tot),
      });
    } else {
      const firstClass = academicClasses[0];
      const defaultClsName = firstClass?.name || availableClasses[0] || '10';
      const defaultClsId = firstClass?.id;
      setEditingStructureId(null);
      setStructureForm({
        name: `${formatClassLabel(defaultClsName)} Fee Structure`,
        academicYear: activeAcademicYear,
        academicYearId: undefined,
        level: 'class',
        targetClass: defaultClsName,
        targetClassId: defaultClsId,
        targetSection: 'A',
        targetStudentId: '',
        items: [...DEFAULT_FEE_BREAKUP],
        quarters: getDefaultQuarters(25000),
      });
    }
    setIsStructureModalOpen(true);
  };

  // Save structure and assign to matching student records
  const handleSaveStructure = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!structureForm.name.trim()) {
      alert('Please enter a structure name.');
      return;
    }
    if (structureForm.items.length === 0) {
      alert('Please add at least one fee component.');
      return;
    }

    const payload = {
      name: structureForm.name,
      academic_year: structureForm.academicYear,
      academic_year_id: structureForm.academicYearId,
      level: structureForm.level,
      target_class: structureForm.targetClass,
      target_class_id: structureForm.targetClassId,
      target_section: structureForm.targetSection,
      target_section_id: structureForm.targetSectionId,
      target_student_id: structureForm.targetStudentId,
      items: structureForm.items,
      quarters: structureForm.quarters,
    };

    let dbSaved: any = null;
    if (editingStructureId && !editingStructureId.startsWith('fs-')) {
      dbSaved = await updateFeeStructureInDB(editingStructureId, payload);
    } else {
      dbSaved = await createFeeStructureInDB(payload);
    }

    // Refresh DB fee structures
    const dbStructures = await fetchFeeStructuresFromDB();
    if (Array.isArray(dbStructures) && dbStructures.length > 0) {
      const formatted: FeeStructure[] = dbStructures.map((s) => ({
        id: String(s.id),
        name: s.name,
        academicYear: s.academic_year,
        academicYearId: s.academic_year_id,
        level: s.level as any,
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
      localStorage.setItem('erp_fee_structures', JSON.stringify(formatted));
    } else {
      let updatedStructures: FeeStructure[];
      const newId = (dbSaved && dbSaved.id) ? String(dbSaved.id) : (editingStructureId || `fs-${Date.now()}`);
      const newStructure: FeeStructure = {
        id: newId,
        name: structureForm.name,
        academicYear: structureForm.academicYear,
        academicYearId: structureForm.academicYearId,
        level: structureForm.level,
        targetClass: structureForm.targetClass,
        targetClassId: structureForm.targetClassId,
        targetSection: structureForm.targetSection,
        targetSectionId: structureForm.targetSectionId,
        targetStudentId: structureForm.targetStudentId,
        items: structureForm.items,
        quarters: dbSaved?.quarters || structureForm.quarters,
      };

      if (editingStructureId) {
        updatedStructures = structures.map((s) => (s.id === editingStructureId ? newStructure : s));
      } else {
        updatedStructures = [newStructure, ...structures];
      }

      setStructures(updatedStructures);
      localStorage.setItem('erp_fee_structures', JSON.stringify(updatedStructures));
    }

    // Auto assign/update corresponding student records
    setStudentRecords((current) =>
      current.map((r) => {
        let isTargeted = false;
        if (structureForm.level === 'school') {
          isTargeted = true;
        } else if (
          structureForm.level === 'class' &&
          ((structureForm.targetClassId && r.classId && structureForm.targetClassId === r.classId) || matchClass(r.class, structureForm.targetClass))
        ) {
          isTargeted = true;
        } else if (
          structureForm.level === 'section' &&
          ((structureForm.targetSectionId && r.sectionId && structureForm.targetSectionId === r.sectionId) ||
           (matchClass(r.class, structureForm.targetClass) && (!structureForm.targetSection || r.section?.toLowerCase() === structureForm.targetSection.toLowerCase())))
        ) {
          isTargeted = true;
        } else if (structureForm.level === 'student' && r.studentId === structureForm.targetStudentId) {
          isTargeted = true;
        }

        if (isTargeted) {
          return {
            ...r,
            customItems: structureForm.items.map((it) => ({ ...it })),
            customQuarters: structureForm.quarters.map((q) => ({ ...q })),
          };
        }
        return r;
      })
    );

    onAddLog(`[Fees Management] Created/Updated fee structure "${structureForm.name}" with total ₹${structureFormTotal.toLocaleString('en-IN')}`);
    emitNotification({
      title: 'Fee Structure Saved',
      message: `Fee structure "${structureForm.name}" (Total: ₹${structureFormTotal.toLocaleString('en-IN')}) assigned to students and stored in database.`,
      tone: 'success',
      source: 'fees',
    });

    window.dispatchEvent(new Event('erp_fees_updated'));
    setIsStructureModalOpen(false);
  };

  // Delete structure
  const handleDeleteStructure = async (id: string) => {
    const targetStr = structures.find((s) => s.id === id);
    const name = targetStr ? targetStr.name : 'Fee Structure';
    if (window.confirm(`Are you sure you want to delete "${name}"? This will automatically delete all associated quarters.`)) {
      if (!id.startsWith('fs-')) {
        await deleteFeeStructureFromDB(id);
      }
      
      // Refresh DB fee structures
      const dbStructures = await fetchFeeStructuresFromDB();
      if (Array.isArray(dbStructures) && dbStructures.length > 0) {
        const formatted: FeeStructure[] = dbStructures.map((s) => ({
          id: String(s.id),
          name: s.name,
          academicYear: s.academic_year,
          academicYearId: s.academic_year_id,
          level: s.level as any,
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
        localStorage.setItem('erp_fee_structures', JSON.stringify(formatted));
      } else {
        setStructures([]);
        localStorage.setItem('erp_fee_structures', JSON.stringify([]));
      }

      onAddLog(`[Fees Management] Removed fee structure "${name}" (${id})`);
      emitNotification({
        title: 'Fee Structure Deleted',
        message: `Fee structure "${name}" and all associated quarters were permanently deleted.`,
        tone: 'danger',
        source: 'fees',
      });
      window.dispatchEvent(new Event('erp_fees_updated'));
    }
  };

  // ------------------------------------------
  // STUDENT FEE MODAL & PAYMENT STATE
  // ------------------------------------------
  const [selectedRecord, setSelectedRecord] = useState<IndividualStudentFeeRecord | null>(null);
  const [isLedgerModalOpen, setIsLedgerModalOpen] = useState(false);
  const [isEditBreakupModalOpen, setIsEditBreakupModalOpen] = useState(false);
  const [isCashPaymentModalOpen, setIsCashPaymentModalOpen] = useState(false);

  // Editing student fee & concessions state
  const [editingBreakupItems, setEditingBreakupItems] = useState<FeeStructureItem[]>([]);
  const [editingScholarship, setEditingScholarship] = useState<number>(0);
  const [editingDiscount, setEditingDiscount] = useState<number>(0);
  const [editingTransport, setEditingTransport] = useState<number>(0);
  const [editingHostel, setEditingHostel] = useState<number>(0);
  const [editingFine, setEditingFine] = useState<number>(0);
  const [isSavingStudentFee, setIsSavingStudentFee] = useState<boolean>(false);

  // Recording payment state
  const [paymentAmountInput, setPaymentAmountInput] = useState<number>(5000);
  const [paymentMethodInput, setPaymentMethodInput] = useState<string>('Cash');
  const [paymentDateInput, setPaymentDateInput] = useState<string>(new Date().toISOString().split('T')[0]);
  const [paymentCategoryInput, setPaymentCategoryInput] = useState<string>('Tuition Fee');
  const [paymentRefInput, setPaymentRefInput] = useState<string>('');
  const [isRecordingPayment, setIsRecordingPayment] = useState<boolean>(false);

  // Backward compatibility aliases
  const [cashAmountInput, setCashAmountInput] = useState<number>(5000);
  const [cashCategoryInput, setCashCategoryInput] = useState<string>('Tuition Fee');

  // Open Structure Modal for a specific class (1-click from Section Ledger)
  const openSetClassFeeModal = (targetClass: string) => {
    const clean = cleanClassNumber(targetClass);
    const existing = structures.find(s => s.level === 'class' && matchClass(s.targetClass, clean));
    if (existing) {
      openCreateStructureModal(existing);
    } else {
      const clsObj = academicClasses.find(c => matchClass(c.name, clean));
      setEditingStructureId(null);
      setStructureForm({
        name: `Class ${clean} Fee Structure`,
        academicYear: activeAcademicYear,
        academicYearId: undefined,
        level: 'class',
        targetClass: clsObj ? clsObj.name : `Class ${clean}`,
        targetClassId: clsObj ? clsObj.id : undefined,
        targetSection: 'A',
        targetSectionId: undefined,
        targetStudentId: '',
        items: [...DEFAULT_FEE_BREAKUP],
        quarters: getDefaultQuarters(DEFAULT_FEE_BREAKUP.reduce((s, i) => s + i.amount, 0)),
      });
      setIsStructureModalOpen(true);
    }
  };

  // Open Edit Breakup & Concessions for specific student
  const openEditBreakupModal = (record: IndividualStudentFeeRecord) => {
    setSelectedRecord(record);
    const currentItems = getStudentItemizedBreakdown(record);
    setEditingBreakupItems(currentItems.length > 0 ? currentItems.map((it) => ({ ...it })) : [...DEFAULT_FEE_BREAKUP]);
    setEditingScholarship(Number(record.scholarship) || 0);
    setEditingDiscount(Number(record.discount) || 0);
    setEditingTransport(Number(record.transportCharges) || 0);
    setEditingHostel(Number(record.hostelCharges) || 0);
    setEditingFine(Number(record.fineAmount) || 0);
    setIsEditBreakupModalOpen(true);
  };

  // Save student breakup & concessions directly to PostgreSQL DB and sync website state
  const handleSaveStudentBreakup = async () => {
    if (!selectedRecord) return;
    setIsSavingStudentFee(true);
    try {
      const scholarship = Math.max(0, Number(editingScholarship) || 0);
      const discount = Math.max(0, Number(editingDiscount) || 0);
      const transportCharges = Math.max(0, Number(editingTransport) || 0);
      const hostelCharges = Math.max(0, Number(editingHostel) || 0);
      const fineAmount = Math.max(0, Number(editingFine) || 0);

      // Persist directly to PostgreSQL database via REST endpoint
      await updateStudentFeeRecordInDB({
        studentId: selectedRecord.studentId,
        recordId: selectedRecord.id,
        custom_items: editingBreakupItems,
        scholarship,
        discount,
        transport_charges: transportCharges,
        hostel_charges: hostelCharges,
        fine_amount: fineAmount,
      });

      const updated = studentRecords.map((r) => {
        if (r.studentId === selectedRecord.studentId) {
          return {
            ...r,
            customItems: editingBreakupItems.map(it => ({ ...it })),
            scholarship,
            discount,
            transportCharges,
            hostelCharges,
            fineAmount,
          };
        }
        return r;
      });

      setStudentRecords(updated);
      localStorage.setItem('erp_individual_fees', JSON.stringify(updated));
      const newRecord = updated.find((r) => r.studentId === selectedRecord.studentId) || null;
      setSelectedRecord(newRecord);
      setIsEditBreakupModalOpen(false);

      const itemsTotal = editingBreakupItems.reduce((s, i) => s + (Number(i.amount) || 0), 0);
      const calculatedTotal = Math.max(0, itemsTotal + transportCharges + hostelCharges + fineAmount - scholarship - discount);

      onAddLog(`[Fees Ledger] Updated fee structure in DB for ${selectedRecord.studentName} (${selectedRecord.admissionNo}): Total ₹${calculatedTotal.toLocaleString('en-IN')}`);
      emitNotification({
        title: 'Fee Updated in Database',
        message: `Saved fee adjustments for ${selectedRecord.studentName} to database. Total: ₹${calculatedTotal.toLocaleString('en-IN')}`,
        tone: 'success',
        source: 'fees',
      });
      window.dispatchEvent(new Event('erp_fees_updated'));
    } catch (err) {
      console.error('Error saving student fee breakdown:', err);
      alert('Failed to save fee structure to database. Please check server logs.');
    } finally {
      setIsSavingStudentFee(false);
    }
  };

  // Open Payment modal pre-filled
  const openPaymentModal = (record: IndividualStudentFeeRecord) => {
    setSelectedRecord(record);
    const summary = getStudentFeeSummary(record);
    const amount = summary.pendingBalance > 0 ? summary.pendingBalance : 5000;
    setPaymentAmountInput(amount);
    setCashAmountInput(amount);
    setPaymentCategoryInput('Tuition Fee');
    setCashCategoryInput('Tuition Fee');
    setPaymentMethodInput('Cash');
    setPaymentDateInput(new Date().toISOString().split('T')[0]);
    setPaymentRefInput('');
    setIsCashPaymentModalOpen(true);
  };

  // Record Payment (Cash, UPI, Cheque, Card, NetBanking) and persist to PostgreSQL
  const handleRecordPayment = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedRecord) return;
    const amount = Number(paymentAmountInput || cashAmountInput);
    if (!amount || amount <= 0) {
      alert('Please enter a valid payment amount.');
      return;
    }

    setIsRecordingPayment(true);
    try {
      const receiptNo = `RCPT-2026-${Math.floor(Math.random() * 899 + 100)}`;
      const txnMethod = paymentMethodInput || 'Cash';
      const txnId = paymentRefInput.trim() || `TXN-${txnMethod.toUpperCase().replace(/\s+/g, '')}-${Math.floor(Math.random() * 89999 + 10000)}`;
      const payDate = paymentDateInput || new Date().toISOString().split('T')[0];
      const category = paymentCategoryInput || cashCategoryInput || 'Tuition Fee';

      const newPayment: StudentPayment = {
        id: `p-${Date.now()}`,
        paymentDate: payDate,
        amountPaid: amount,
        paymentMethod: txnMethod as any,
        transactionId: txnId,
        receiptNo,
        category,
        installmentType: `${txnMethod} Payment`,
      };

      // Persist to backend PostgreSQL DB
      if (selectedRecord.studentId) {
        await recordStudentPaymentInDB({
          studentId: selectedRecord.studentId,
          amountPaid: amount,
          paymentMethod: txnMethod,
          category,
          installmentType: `${txnMethod} Payment`,
        });
      } else if (selectedRecord.id && !isNaN(Number(selectedRecord.id))) {
        await recordFeePaymentInDB(Number(selectedRecord.id), {
          amount_paid: amount,
          payment_method: txnMethod,
          category,
          installment_type: `${txnMethod} Payment`,
        });
      }

      const updated = studentRecords.map((r) => {
        if (r.studentId === selectedRecord.studentId) {
          return {
            ...r,
            paymentHistory: [newPayment, ...r.paymentHistory],
          };
        }
        return r;
      });

      setStudentRecords(updated);
      localStorage.setItem('erp_individual_fees', JSON.stringify(updated));
      const newRecord = updated.find((r) => r.studentId === selectedRecord.studentId) || null;
      setSelectedRecord(newRecord);
      setIsCashPaymentModalOpen(false);

      onAddLog(`[Fees Collection] Recorded ${txnMethod} payment of ₹${amount.toLocaleString('en-IN')} for ${selectedRecord.studentName}. Receipt: ${receiptNo}`);
      emitNotification({
        title: 'Payment Saved to Database',
        message: `Recorded ${txnMethod} payment of ₹${amount.toLocaleString('en-IN')} from ${selectedRecord.studentName}. Receipt: ${receiptNo}`,
        tone: 'success',
        source: 'fees',
      });
      window.dispatchEvent(new Event('erp_fees_updated'));
    } catch (err) {
      console.error('Error saving payment to database:', err);
      alert('Failed to record payment in database. Please check your connection.');
    } finally {
      setIsRecordingPayment(false);
    }
  };

  const handleRecordCashPayment = handleRecordPayment;

  // Send Reminder Alert
  const handleSendReminder = (record: IndividualStudentFeeRecord) => {
    const summary = getStudentFeeSummary(record);
    if (summary.pendingBalance <= 0) {
      alert(`${record.studentName}'s fee balance is already paid in full.`);
      return;
    }
    emitNotification({
      title: 'Fee Reminder Sent',
      message: `Fee reminder broadcasted to ${record.studentName}'s parent. Outstanding Balance: ₹${summary.pendingBalance.toLocaleString('en-IN')}`,
      tone: 'warning',
      source: 'fees',
    });
    onAddLog(`[Fees Alert] Sent balance payment reminder to parent of ${record.studentName} (${record.admissionNo})`);
    alert(`Fee reminder sent to parent of ${record.studentName} for balance ₹${summary.pendingBalance.toLocaleString('en-IN')}.`);
  };

  // Receipt Modal State
  const [viewingReceipt, setViewingReceipt] = useState<StudentPayment | null>(null);
  const [viewingReceiptRecord, setViewingReceiptRecord] = useState<IndividualStudentFeeRecord | null>(null);

  // Print Receipt Helper
  const handlePrintReceipt = (payment: StudentPayment, record: IndividualStudentFeeRecord) => {
    setViewingReceipt(payment);
    setViewingReceiptRecord(record);
  };

  // Search and Filters for Tracking Table
  const [searchTerm, setSearchTerm] = useState('');
  const [classFilter, setClassFilter] = useState('All');
  const [sectionFilter, setSectionFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [quarterFilter, setQuarterFilter] = useState('All');
  const [yearFilter, setYearFilter] = useState(activeAcademicYear);
  const [selectedOverviewClass, setSelectedOverviewClass] = useState<string>('All');
  const [selectedTrackingClass, setSelectedTrackingClass] = useState<string | null>(null);
  const [selectedTrackingSection, setSelectedTrackingSection] = useState<string>('All');

  useEffect(() => {
    if (availableClasses.length > 0) {
      if (selectedOverviewClass !== 'All' && !availableClasses.some((c) => matchClass(c, selectedOverviewClass))) {
        setSelectedOverviewClass(availableClasses[0]);
      }
    } else {
      setSelectedOverviewClass('All');
    }
  }, [availableClasses]);


  // Fetch persistent records from Django DB on mount & listen for real-time fee updates
  useEffect(() => {
    const loadFromDB = () => {
      fetchFeeStructuresFromDB().then((dbStructures) => {
        if (Array.isArray(dbStructures) && dbStructures.length > 0) {
          const formatted: FeeStructure[] = dbStructures.map((s) => ({
            id: String(s.id),
            name: s.name,
            academicYear: s.academic_year,
            academicYearId: s.academic_year_id,
            level: s.level as any,
            targetClass: s.target_class || undefined,
            targetClassId: s.target_class_id || undefined,
            targetSection: s.target_section || undefined,
            targetSectionId: s.target_section_id || undefined,
            targetStudentId: s.target_student_id || undefined,
            items: s.items || [],
            quarters: (s.quarters && s.quarters.length > 0) ? s.quarters : (s.quarter_records ? s.quarter_records.map((q: any) => ({
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
          localStorage.setItem('erp_fee_structures', JSON.stringify(formatted));
        } else {
          setStructures([]);
        }
      });

      fetchStudentFeeRecordsFromDB().then((dbRecords) => {
        if (Array.isArray(dbRecords) && dbRecords.length > 0) {
          setStudentRecords((current) => {
            const map = new Map<string, IndividualStudentFeeRecord>();
            current.forEach((r) => map.set(r.studentId, r));

            const validStudentIds = new Set(students.map((st) => st.id));

            dbRecords.forEach((r) => {
              const stId = r.student_id_str;
              if (validStudentIds.size > 0 && !validStudentIds.has(stId)) {
                return;
              }
              const existing = map.get(stId);
              map.set(stId, {
                id: String(r.id),
                studentId: stId,
                studentName: r.student_name || existing?.studentName || '',
                admissionNo: r.admission_no || existing?.admissionNo || '',
                class: r.class_name || existing?.class || '',
                classId: existing?.classId,
                section: r.section_name || existing?.section || '',
                sectionId: existing?.sectionId,
                academicYear: r.academic_year || existing?.academicYear || activeAcademicYear,
                scholarship: Number(r.scholarship) || 0,
                discount: Number(r.discount) || 0,
                transportCharges: Number(r.transport_charges) || 0,
                hostelCharges: Number(r.hostel_charges) || 0,
                fineAmount: Number(r.fine_amount) || 0,
                installmentsPaid: r.installments_paid || 0,
                customItems: r.custom_items || undefined,
                customQuarters: r.custom_quarters || undefined,
                paymentHistory: r.payment_history || [],
              });
            });

            return Array.from(map.values());
          });
        }
      });
    };

    loadFromDB();

    const handleSync = () => {
      loadFromDB();
    };
    window.addEventListener('storage', handleSync);
    window.addEventListener('erp_fees_updated', handleSync);
    return () => {
      window.removeEventListener('storage', handleSync);
      window.removeEventListener('erp_fees_updated', handleSync);
    };
  }, []);

  // Reset Demo Modal State
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);

  const handleConfirmReset = () => {
    localStorage.removeItem('erp_individual_fees');
    localStorage.removeItem('erp_fee_structures');
    setStudentRecords([]);
    window.dispatchEvent(new Event('erp_fees_updated'));
    emitNotification({
      title: 'Demo Reset Successful',
      message: 'Fee schedule and payment history restored to default demo state.',
      tone: 'info',
      source: 'fees',
    });
    setIsResetModalOpen(false);
  };

  // Helper to send specific Quarter Reminder to Parent
  const handleSendQuarterReminder = (record: IndividualStudentFeeRecord, quarterName: string, quarterAmount: number) => {
    emitNotification({
      title: 'Quarter Fee Reminder Sent',
      message: `Fee reminder broadcasted to ${record.studentName}'s parent for ${quarterName} (₹${quarterAmount.toLocaleString('en-IN')}).`,
      tone: 'warning',
      source: 'fees',
    });
    onAddLog(`[Quarter Alert] Sent ${quarterName} payment reminder to parent of ${record.studentName} (${record.admissionNo})`);
    alert(`Reminder sent to parent of ${record.studentName} for ${quarterName} (₹${quarterAmount.toLocaleString('en-IN')}).`);
  };

  // Helper to compute quarter allocation and statuses for a student
  const getStudentQuartersWithStatus = (summary: ReturnType<typeof getStudentFeeSummary>, paymentHistory: StudentPayment[]) => {
    const directMap = new Map<string, number>();
    let generalPaid = 0;

    (paymentHistory || []).forEach((p) => {
      const amt = Number(p.amountPaid) || 0;
      if (p.quarterId) {
        directMap.set(String(p.quarterId), (directMap.get(String(p.quarterId)) || 0) + amt);
      } else {
        generalPaid += amt;
      }
    });

    let runningPaid = generalPaid;
    let paidQuartersCount = 0;

    const quartersWithStatus = summary.quarters.map((q) => {
      const qAmt = Number(q.amount) || 0;
      const directAmt = q.id ? (directMap.get(String(q.id)) || 0) : 0;
      let qPaid = directAmt;

      if (qPaid < qAmt && runningPaid > 0) {
        const needed = qAmt - qPaid;
        const alloc = Math.min(needed, runningPaid);
        qPaid += alloc;
        runningPaid -= alloc;
      }

      const remaining = Math.max(0, qAmt - qPaid);
      let qStatus: 'Paid' | 'Partially Paid' | 'Unpaid' = 'Unpaid';
      let isQPaid = false;

      if (qPaid >= qAmt && qAmt > 0) {
        qStatus = 'Paid';
        isQPaid = true;
        paidQuartersCount++;
      } else if (qPaid > 0) {
        qStatus = 'Partially Paid';
      } else {
        qStatus = 'Unpaid';
      }

      return {
        ...q,
        paidAmount: qPaid,
        remainingAmount: remaining,
        isPaid: isQPaid,
        status: qStatus,
      };
    });

    return { quartersWithStatus, paidQuartersCount };
  };

  // Helper to match status and quarter filters accurately
  const matchQuarterAndStatusFilter = (
    currStatusFilter: string,
    currQuarterFilter: string,
    summaryStatus: 'Paid' | 'Partially Paid' | 'Unpaid',
    quartersWithStatus: Array<{ isPaid: boolean; status: 'Paid' | 'Partially Paid' | 'Unpaid'; paidAmount: number }>
  ): boolean => {
    if (currQuarterFilter === 'All' || !currQuarterFilter) {
      if (currStatusFilter !== 'All' && summaryStatus !== currStatusFilter) {
        return false;
      }
      return true;
    }

    let qIdx = -1;
    if (currQuarterFilter === 'Q1' || currQuarterFilter === 'Quarter 1' || currQuarterFilter === 'Q1_unpaid') qIdx = 0;
    else if (currQuarterFilter === 'Q2' || currQuarterFilter === 'Quarter 2' || currQuarterFilter === 'Q2_unpaid') qIdx = 1;
    else if (currQuarterFilter === 'Q3' || currQuarterFilter === 'Quarter 3' || currQuarterFilter === 'Q3_unpaid') qIdx = 2;
    else if (currQuarterFilter === 'Q4' || currQuarterFilter === 'Quarter 4' || currQuarterFilter === 'Q4_unpaid') qIdx = 3;

    const targetQ = qIdx >= 0 && qIdx < quartersWithStatus.length ? quartersWithStatus[qIdx] : null;
    if (!targetQ) return false;

    if (currQuarterFilter.endsWith('_unpaid')) {
      return targetQ.status === 'Unpaid' || !targetQ.isPaid;
    }

    if (currStatusFilter === 'All') {
      return true;
    }
    if (currStatusFilter === 'Paid') {
      return targetQ.isPaid || targetQ.status === 'Paid';
    }
    if (currStatusFilter === 'Partially Paid') {
      return targetQ.status === 'Partially Paid';
    }
    if (currStatusFilter === 'Unpaid') {
      return targetQ.status === 'Unpaid';
    }

    return true;
  };

  // Filtered Students List for Admin Tracking Table
  const filteredStudentSummaries = useMemo(() => {
    return studentRecords
      .map((r) => {
        const summary = getStudentFeeSummary(r);
        const { quartersWithStatus, paidQuartersCount } = getStudentQuartersWithStatus(summary, r.paymentHistory);

        return {
          record: r,
          summary,
          paidQuartersCount,
          quartersWithStatus,
        };
      })
      .filter(({ record, summary, quartersWithStatus }) => {
        // Search term
        const search = searchTerm.toLowerCase().trim();
        if (search) {
          const matchName = record.studentName.toLowerCase().includes(search);
          const matchAdm = record.admissionNo.toLowerCase().includes(search);
          const matchId = record.studentId.toLowerCase().includes(search);
          if (!matchName && !matchAdm && !matchId) return false;
        }

        // Class filter
        if (classFilter !== 'All' && record.class !== classFilter) return false;
        // Section filter
        if (sectionFilter !== 'All' && record.section !== sectionFilter) return false;
        // Academic Year filter
        if (yearFilter && record.academicYear !== yearFilter) return false;

        // Combined Status & Quarter Filter
        return matchQuarterAndStatusFilter(statusFilter, quarterFilter, summary.status, quartersWithStatus);
      });
  }, [studentRecords, searchTerm, classFilter, sectionFilter, yearFilter, statusFilter, quarterFilter, structures]);

  // Class Overview Summary Data for Tracking Screen
  const trackingClassOverviewData = useMemo(() => {
    const classMap = new Map<string, {
      className: string;
      cleanClass: string;
      sections: Set<string>;
      totalStudents: number;
      totalExpected: number;
      totalCollected: number;
      totalPending: number;
    }>();

    studentRecords.forEach((r) => {
      const cleanCls = r.class ? r.class.replace(/^class\s*[-_]?/i, '') : 'Unassigned';
      const key = cleanCls;
      const summary = getStudentFeeSummary(r);

      const entry = classMap.get(key) || {
        className: formatClassLabel(cleanCls),
        cleanClass: cleanCls,
        sections: new Set<string>(),
        totalStudents: 0,
        totalExpected: 0,
        totalCollected: 0,
        totalPending: 0,
      };

      if (r.section) entry.sections.add(r.section.toUpperCase());
      entry.totalStudents += 1;
      entry.totalExpected += summary.totalFee;
      entry.totalCollected += summary.amountPaid;
      entry.totalPending += summary.pendingBalance;

      classMap.set(key, entry);
    });

    return Array.from(classMap.values()).sort((a, b) => a.cleanClass.localeCompare(b.cleanClass, undefined, { numeric: true }));
  }, [studentRecords, structures]);

  // Unique sections for currently selected tracking class detail view
  const selectedClassSections = useMemo(() => {
    if (!selectedTrackingClass) return [];
    const classStudents = studentRecords.filter((r) => matchClass(r.class, selectedTrackingClass));
    const secSet = new Set<string>();
    classStudents.forEach((r) => {
      if (r.section) secSet.add(r.section.toUpperCase());
    });
    return Array.from(secSet).sort();
  }, [studentRecords, selectedTrackingClass]);

  // Section Groups for Selected Tracking Class Detail View
  const classDetailSectionGroups = useMemo(() => {
    if (!selectedTrackingClass) return [];

    const classStudents = studentRecords.filter((r) => matchClass(r.class, selectedTrackingClass));

    const map = new Map<string, typeof filteredStudentSummaries>();
    classStudents.forEach((r) => {
      const sec = r.section ? r.section.toUpperCase() : 'A';
      if (selectedTrackingSection !== 'All' && sec !== selectedTrackingSection) return;

      const summary = getStudentFeeSummary(r);

      // Search term filter
      const search = searchTerm.toLowerCase().trim();
      if (search) {
        const matchName = r.studentName.toLowerCase().includes(search);
        const matchAdm = r.admissionNo.toLowerCase().includes(search);
        const matchId = r.studentId.toLowerCase().includes(search);
        if (!matchName && !matchAdm && !matchId) return;
      }

      // Quarter & status filter
      const { quartersWithStatus, paidQuartersCount } = getStudentQuartersWithStatus(summary, r.paymentHistory);
      if (!matchQuarterAndStatusFilter(statusFilter, quarterFilter, summary.status, quartersWithStatus)) {
        return;
      }

      const item = {
        record: r,
        summary,
        paidQuartersCount,
        quartersWithStatus,
      };

      const sectionTitle = `${formatClassLabel(r.class)} - Section ${sec}`;
      const list = map.get(sectionTitle) || [];
      list.push(item);
      map.set(sectionTitle, list);
    });

    return Array.from(map.entries()).map(([sectionTitle, students]) => {
      const totalExpected = students.reduce((sum, s) => sum + s.summary.totalFee, 0);
      const totalCollected = students.reduce((sum, s) => sum + s.summary.amountPaid, 0);
      const totalPending = Math.max(0, totalExpected - totalCollected);
      return {
        sectionTitle,
        students,
        totalExpected,
        totalCollected,
        totalPending,
      };
    }).sort((a, b) => a.sectionTitle.localeCompare(b.sectionTitle, undefined, { numeric: true }));
  }, [studentRecords, structures, selectedTrackingClass, selectedTrackingSection, searchTerm, statusFilter, quarterFilter]);


  // Aggregated Overall School / Class Statistics

  const overallStats = useMemo(() => {
    const targetStudents = selectedOverviewClass === 'All'
      ? studentRecords
      : studentRecords.filter((r) => matchClass(r.class, selectedOverviewClass));

    let totalExpected = 0;
    let totalCollected = 0;
    let paidCount = 0;
    let partialCount = 0;
    let unpaidCount = 0;

    targetStudents.forEach((r) => {
      const summary = getStudentFeeSummary(r);
      totalExpected += summary.totalFee;
      totalCollected += summary.amountPaid;

      if (summary.status === 'Paid') paidCount++;
      else if (summary.status === 'Partially Paid') partialCount++;
      else unpaidCount++;
    });

    const totalPending = Math.max(0, totalExpected - totalCollected);

    return {
      totalExpected,
      totalCollected,
      totalPending,
      totalStudents: targetStudents.length,
      paidCount,
      partialCount,
      unpaidCount,
    };
  }, [studentRecords, structures, selectedOverviewClass]);

  // Aggregated Quarterly Fee Set & Collection Distribution Stats
  const quarterlyStats = useMemo(() => {
    if (selectedOverviewClass !== 'All') {
      const classStr = structures.find((s) => s.level === 'class' && matchClass(s.targetClass, selectedOverviewClass))
        || structures.find((s) => s.level === 'school');

      if (!classStr || !classStr.quarters || classStr.quarters.length === 0) {
        return [];
      }

      const targetStudents = studentRecords.filter((r) => matchClass(r.class, selectedOverviewClass));

      const qMap = classStr.quarters.map((q, idx) => ({
        quarter: q.quarter || `Q${idx + 1}`,
        name: q.name || `Quarter ${idx + 1}`,
        dueDate: q.dueDate || '2026-04-15',
        perStudentAmount: Number(q.amount) || 0,
        expected: (Number(q.amount) || 0) * targetStudents.length,
        collected: 0,
        pending: 0,
      }));

      targetStudents.forEach((r) => {
        const summary = getStudentFeeSummary(r);
        let runningPaid = summary.amountPaid;

        qMap.forEach((qItem, idx) => {
          const studentQ = summary.quarters[idx];
          const qAmt = studentQ ? Number(studentQ.amount) || qItem.perStudentAmount : qItem.perStudentAmount;

          if (runningPaid >= qAmt) {
            qMap[idx].collected += qAmt;
            runningPaid -= qAmt;
          } else if (runningPaid > 0) {
            qMap[idx].collected += runningPaid;
            runningPaid = 0;
          }
        });
      });

      qMap.forEach((qItem) => {
        qItem.pending = Math.max(0, qItem.expected - qItem.collected);
      });

      return qMap;
    }

    // "All Classes (School-Wide)" view
    const defaultTemplates: QuarterFeeDetail[] = [
      { quarter: 'Q1', name: 'Quarter 1 (Apr - Jun)', amount: 0, dueDate: '2026-04-15' },
      { quarter: 'Q2', name: 'Quarter 2 (Jul - Sep)', amount: 0, dueDate: '2026-07-15' },
      { quarter: 'Q3', name: 'Quarter 3 (Oct - Dec)', amount: 0, dueDate: '2026-10-15' },
      { quarter: 'Q4', name: 'Quarter 4 (Jan - Mar)', amount: 0, dueDate: '2027-01-15' },
    ];

    const qMap = defaultTemplates.map((q, idx) => ({
      quarter: q.quarter,
      name: q.name,
      dueDate: q.dueDate,
      perStudentAmount: 0,
      expected: 0,
      collected: 0,
      pending: 0,
    }));

    studentRecords.forEach((r) => {
      const summary = getStudentFeeSummary(r);
      let runningPaid = summary.amountPaid;

      qMap.forEach((qItem, idx) => {
        const studentQ = summary.quarters[idx];
        const qAmt = studentQ ? Number(studentQ.amount) || 0 : 0;
        qMap[idx].expected += qAmt;
        if (studentQ && studentQ.dueDate) qMap[idx].dueDate = studentQ.dueDate;

        if (runningPaid >= qAmt) {
          qMap[idx].collected += qAmt;
          runningPaid -= qAmt;
        } else if (runningPaid > 0) {
          qMap[idx].collected += runningPaid;
          runningPaid = 0;
        }
      });
    });

    qMap.forEach((qItem) => {
      qItem.perStudentAmount = studentRecords.length > 0 ? Math.round(qItem.expected / studentRecords.length) : 0;
      qItem.pending = Math.max(0, qItem.expected - qItem.collected);
    });

    return qMap;
  }, [studentRecords, structures, selectedOverviewClass]);

  // Aggregated Fee Component Distribution Stats
  const componentDistributionStats = useMemo(() => {
    const map = new Map<string, { category: string; totalAmount: number; studentCount: number }>();

    const targetStudents = selectedOverviewClass === 'All'
      ? studentRecords
      : studentRecords.filter((r) => matchClass(r.class, selectedOverviewClass));

    targetStudents.forEach((r) => {
      const items = getStudentItemizedBreakdown(r);
      items.forEach((it) => {
        const cur = map.get(it.category) || { category: it.category, totalAmount: 0, studentCount: 0 };
        cur.totalAmount += Number(it.amount) || 0;
        cur.studentCount += 1;
        map.set(it.category, cur);
      });
    });

    return Array.from(map.values());
  }, [studentRecords, structures, selectedOverviewClass]);


  // Class-wise Report Summary Data for Chart & Table
  const classReportData = useMemo(() => {
    const map = new Map<string, { className: string; expected: number; collected: number; pending: number }>();
    studentRecords.forEach((r) => {
      const key = formatClassLabel(r.class);
      const sum = getStudentFeeSummary(r);
      const cur = map.get(key) || { className: key, expected: 0, collected: 0, pending: 0 };
      cur.expected += sum.totalFee;
      cur.collected += sum.amountPaid;
      cur.pending += sum.pendingBalance;
      map.set(key, cur);
    });
    return Array.from(map.values()).sort((a, b) => a.className.localeCompare(b.className, undefined, { numeric: true }));
  }, [studentRecords, structures]);

  // Status Pie Chart Data
  const statusPieData = useMemo(() => [
    { name: 'Fully Paid', value: overallStats.paidCount, color: '#10b981' },
    { name: 'Partially Paid', value: overallStats.partialCount, color: '#f59e0b' },
    { name: 'Unpaid', value: overallStats.unpaidCount, color: '#ef4444' },
  ], [overallStats]);

  // Handler: Export complete fee invoice data to Excel (.xlsx) for reconciliation & tallying
  const handleExportToExcel = () => {
    try {
      exportFeeInvoicesToExcel({
        schoolName,
        academicYear: activeAcademicYear,
        selectedClass: selectedOverviewClass,
        studentRecords,
        structures,
        getStudentFeeSummary,
        quarterlyStats,
        componentDistributionStats,
        classReportData,
      });
      emitNotification({
        title: 'Fees Invoices Exported',
        message: 'Complete fee invoice ledger, quarterly collections, and receipts tally exported to Excel (.xlsx).',
        tone: 'success',
        source: 'fees',
      });
    } catch (error: any) {
      console.error('Failed to export fee invoices:', error);
      emitNotification({
        title: 'Export Failed',
        message: 'Could not generate the Excel sheet. Please try again.',
        tone: 'danger',
        source: 'fees',
      });
    }
  };

  // Handler: Export specific class fee tracking ledger to Excel (.xlsx)
  const handleExportTrackingClassToExcel = () => {
    try {
      exportFeeInvoicesToExcel({
        schoolName,
        academicYear: activeAcademicYear,
        selectedClass: selectedTrackingClass || 'All',
        studentRecords,
        structures,
        getStudentFeeSummary,
        quarterlyStats,
        componentDistributionStats,
        classReportData,
      });
      emitNotification({
        title: 'Class Ledger Exported',
        message: `${formatClassLabel(selectedTrackingClass || '')} fee invoice ledger downloaded to Excel (.xlsx).`,
        tone: 'success',
        source: 'fees',
      });
    } catch (error: any) {
      console.error('Failed to export class fee ledger:', error);
      emitNotification({
        title: 'Export Failed',
        message: 'Could not generate the Excel sheet.',
        tone: 'danger',
        source: 'fees',
      });
    }
  };

  // ------------------------------------------
  // PARENT & STUDENT CHECKOUT PORTAL STATE
  // ------------------------------------------
  const resolvedStudentId = currentUserRole === 'Parent' ? currentStudentId : (currentUserRole === 'Student' ? currentStudentId : '');
  const activeStudentFeeRecord = studentRecords.find((r) => r.studentId === resolvedStudentId) || studentRecords[0];

  const activeStudentSummary = activeStudentFeeRecord ? getStudentFeeSummary(activeStudentFeeRecord) : null;

  const [paymentOption, setPaymentOption] = useState<'full' | 'half' | 'quarter' | 'custom'>('full');
  const [customAmountInput, setCustomAmountInput] = useState<number>(10000);
  const [selectedGateway, setSelectedGateway] = useState<'UPI' | 'Razorpay' | 'Card' | 'NetBanking'>('UPI');
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  // Compute payment payable amount based on selection
  const selectedPayableAmount = useMemo(() => {
    if (!activeStudentSummary) return 0;
    const pending = activeStudentSummary.pendingBalance;
    if (pending <= 0) return 0;
    if (paymentOption === 'full') return pending;
    if (paymentOption === 'half') return Math.min(pending, Math.round(pending / 2));
    if (paymentOption === 'quarter') return Math.min(pending, Math.round(pending / 4));
    return Math.min(pending, Math.max(1, customAmountInput));
  }, [activeStudentSummary, paymentOption, customAmountInput]);

  // Handle Online Student Payment Submission
  const handleStudentPayNow = () => {
    if (!activeStudentFeeRecord || !activeStudentSummary) return;
    if (currentUserRole === 'Student') {
      alert('Fee payments can only be processed by Parent/Guardian accounts.');
      return;
    }
    if (selectedPayableAmount <= 0) {
      alert('Your fee balance is already paid in full!');
      return;
    }

    setIsProcessingPayment(true);

    setTimeout(() => {
      const receiptNo = `RCPT-2026-${Math.floor(Math.random() * 899 + 100)}`;
      const gatewayName = selectedGateway === 'Card' ? 'Credit/Debit Card' : (selectedGateway === 'NetBanking' ? 'Net Banking' : selectedGateway);
      const newPayment: StudentPayment = {
        id: `p-online-${Date.now()}`,
        paymentDate: new Date().toISOString().split('T')[0],
        amountPaid: selectedPayableAmount,
        paymentMethod: gatewayName as any,
        transactionId: `TXN-ONLINE-${Math.floor(Math.random() * 89999 + 10000)}`,
        receiptNo,
        category: 'Tuition & Academic Fees',
        installmentType: paymentOption.toUpperCase(),
      };

      const updated = studentRecords.map((r) => {
        if (r.studentId === activeStudentFeeRecord.studentId) {
          return {
            ...r,
            paymentHistory: [newPayment, ...r.paymentHistory],
          };
        }
        return r;
      });

      setStudentRecords(updated);
      setIsProcessingPayment(false);

      onAddLog(`[Fees Checkout] ONLINE PAYMENT SUCCESS: Received ₹${selectedPayableAmount.toLocaleString('en-IN')} from ${activeStudentFeeRecord.studentName} via ${selectedGateway}. Receipt: ${receiptNo}`);
      emitNotification({
        title: 'Payment Successful',
        message: `₹${selectedPayableAmount.toLocaleString('en-IN')} paid successfully via ${selectedGateway}. Receipt No: ${receiptNo}`,
        tone: 'success',
        source: 'fees',
      });

      // Auto view receipt
      setViewingReceipt(newPayment);
      setViewingReceiptRecord(updated.find((r) => r.studentId === activeStudentFeeRecord.studentId) || activeStudentFeeRecord);
    }, 1200);
  };

  // =========================================================================
  // RENDER: STUDENT / PARENT VIEW
  // =========================================================================
  if (!isAdmin) {
    if (!activeStudentFeeRecord || !activeStudentSummary) {
      return (
        <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 shadow-sm">
          <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-slate-800">No Student Fee Record Found</h3>
          <p className="text-sm text-slate-500 mt-1">Please ask your School Admin to link your account to a student profile.</p>
        </div>
      );
    }

    return (
      <div className="space-y-6 max-w-6xl mx-auto pb-10">
        {/* Header Banner */}
        <header className="rounded-3xl bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
          <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 opacity-10 pointer-events-none">
            <IndianRupee className="w-64 h-64 text-white" />
          </div>
          <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <span className="px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-[11px] font-bold tracking-wider uppercase">
                {currentUserRole} Portal · {activeStudentFeeRecord.academicYear}
              </span>
              <h1 className="text-2xl sm:text-3xl font-extrabold mt-2">{activeStudentFeeRecord.studentName}</h1>
              <p className="text-indigo-100 text-xs sm:text-sm mt-1">
                Admission No: <span className="font-semibold text-white">{activeStudentFeeRecord.admissionNo}</span> · Class {activeStudentFeeRecord.class}-{activeStudentFeeRecord.section}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsResetModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 active:scale-95 text-white text-xs font-bold rounded-xl transition-all border border-white/30 backdrop-blur-xs shadow-sm cursor-pointer"
                title="Reset fee schedule & payment history back to default demo state"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Demo</span>
              </button>
              <span
                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider ${
                  activeStudentSummary.status === 'Paid'
                    ? 'bg-emerald-400/30 text-emerald-100 border border-emerald-300/40'
                    : activeStudentSummary.status === 'Partially Paid'
                    ? 'bg-amber-400/30 text-amber-100 border border-amber-300/40'
                    : 'bg-rose-400/30 text-rose-100 border border-rose-300/40'
                }`}
              >
                Status: {activeStudentSummary.status}
              </span>
            </div>
          </div>
        </header>

        {/* 1. FEE SUMMARY CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Fee</p>
              <p className="text-2xl font-black text-slate-800 mt-1">₹{activeStudentSummary.totalFee.toLocaleString('en-IN')}</p>
              <p className="text-xs text-slate-500 mt-0.5">Annual Fee Component Structure</p>
            </div>
            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
              <Wallet className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Amount Paid</p>
              <p className="text-2xl font-black text-emerald-600 mt-1">₹{activeStudentSummary.amountPaid.toLocaleString('en-IN')}</p>
              <p className="text-xs text-slate-500 mt-0.5">Cleared Payments</p>
            </div>
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
              <CheckCircle className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Remaining Balance</p>
              <p className="text-2xl font-black text-rose-600 mt-1">₹{activeStudentSummary.pendingBalance.toLocaleString('en-IN')}</p>
              <p className="text-xs text-slate-500 mt-0.5">Outstanding Payable</p>
            </div>
            <div className="p-3 bg-rose-50 text-rose-600 rounded-xl">
              <AlertTriangle className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* MAIN GRID: BREAKDOWN & CHECKOUT */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT 2 COLS: BREAKDOWN & HISTORY */}
          <div className="lg:col-span-2 space-y-6">
            {/* 2. FEE BREAKDOWN TABLE */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2 mb-4">
                <Receipt className="w-5 h-5 text-indigo-600" />
                Fee Component Breakdown
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase">
                      <th className="py-3 px-2">Fee Component</th>
                      <th className="py-3 px-2">Due Date</th>
                      <th className="py-3 px-2 text-right">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                    {activeStudentSummary.items.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-2 font-bold text-slate-800">{item.category}</td>
                        <td className="py-3 px-2 text-slate-500">{item.dueDate || '2026-08-31'}</td>
                        <td className="py-3 px-2 text-right font-black text-slate-900">₹{Number(item.amount).toLocaleString('en-IN')}</td>
                      </tr>
                    ))}
                    {activeStudentSummary.transport > 0 && (
                      <tr className="bg-amber-50/50">
                        <td className="py-3 px-2 font-bold text-amber-900">Transport Add-on</td>
                        <td className="py-3 px-2 text-slate-500">-</td>
                        <td className="py-3 px-2 text-right font-black text-amber-900">+₹{activeStudentSummary.transport.toLocaleString('en-IN')}</td>
                      </tr>
                    )}
                    {activeStudentSummary.hostel > 0 && (
                      <tr className="bg-purple-50/50">
                        <td className="py-3 px-2 font-bold text-purple-900">Hostel Add-on</td>
                        <td className="py-3 px-2 text-slate-500">-</td>
                        <td className="py-3 px-2 text-right font-black text-purple-900">+₹{activeStudentSummary.hostel.toLocaleString('en-IN')}</td>
                      </tr>
                    )}
                    {activeStudentSummary.scholarship > 0 && (
                      <tr className="bg-emerald-50/50">
                        <td className="py-3 px-2 font-bold text-emerald-900">Scholarship Grant</td>
                        <td className="py-3 px-2 text-slate-500">-</td>
                        <td className="py-3 px-2 text-right font-black text-emerald-900">-₹{activeStudentSummary.scholarship.toLocaleString('en-IN')}</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-900 text-slate-900 font-extrabold text-sm bg-slate-50">
                      <td colSpan={2} className="py-3 px-2">Total Fee Amount</td>
                      <td className="py-3 px-2 text-right text-indigo-700">₹{activeStudentSummary.totalFee.toLocaleString('en-IN')}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* 3. PAYMENT HISTORY TABLE */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2 mb-4">
                <Calendar className="w-5 h-5 text-indigo-600" />
                Payment History
              </h3>
              {activeStudentFeeRecord.paymentHistory.length === 0 ? (
                <div className="p-6 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-500 text-xs">
                  No payments recorded yet. Use the Pay Now panel to make an online payment.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase">
                        <th className="py-2.5 px-2">Date</th>
                        <th className="py-2.5 px-2">Method</th>
                        <th className="py-2.5 px-2">Receipt No</th>
                        <th className="py-2.5 px-2 text-right">Amount Paid</th>
                        <th className="py-2.5 px-2 text-center">Receipt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeStudentFeeRecord.paymentHistory.map((pmt) => (
                        <tr key={pmt.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-2 font-medium text-slate-700">{pmt.paymentDate}</td>
                          <td className="py-2.5 px-2">
                            <span className="px-2 py-0.5 bg-slate-100 rounded text-[11px] font-bold text-slate-700">
                              {pmt.paymentMethod}
                            </span>
                          </td>
                          <td className="py-2.5 px-2 font-mono text-slate-600">{pmt.receiptNo}</td>
                          <td className="py-2.5 px-2 text-right font-black text-emerald-600">₹{pmt.amountPaid.toLocaleString('en-IN')}</td>
                          <td className="py-2.5 px-2 text-center">
                            <button
                              onClick={() => handlePrintReceipt(pmt, activeStudentFeeRecord)}
                              className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg font-bold text-[11px] transition-colors inline-flex items-center gap-1"
                            >
                              <Receipt className="w-3 h-3" /> View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT 1 COL: FLEXIBLE CHECKOUT & PAY NOW */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-lg p-6 space-y-5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-indigo-600" />
                  Pay Fees Now
                </h3>
                <span className="text-xs font-black text-rose-600 bg-rose-50 px-2.5 py-1 rounded-full">
                  Due: ₹{activeStudentSummary.pendingBalance.toLocaleString('en-IN')}
                </span>
              </div>

              {currentUserRole === 'Student' ? (
                <div className="p-6 text-center bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <ShieldCheck className="w-10 h-10 text-indigo-500 mx-auto" />
                  <h4 className="font-extrabold text-slate-900 text-sm">Parent Payment Portal</h4>
                  <p className="text-xs text-slate-500">
                    Fee payments and online transactions are enabled for Parent/Guardian logins.
                  </p>
                </div>
              ) : activeStudentSummary.pendingBalance <= 0 ? (
                <div className="p-6 text-center bg-emerald-50 rounded-2xl border border-emerald-200">
                  <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                  <h4 className="font-extrabold text-emerald-900 text-sm">Fee Fully Cleared!</h4>
                  <p className="text-xs text-emerald-700 mt-1">Thank you. All school fees for this academic year have been paid.</p>
                </div>
              ) : (
                <>
                  {/* Step 1: Installment Selection */}
                  <div>
                    <label className="block text-xs font-bold text-slate-600 uppercase mb-2">Select Payment Option</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setPaymentOption('full')}
                        className={`p-3 rounded-xl border text-left text-xs font-bold transition-all ${
                          paymentOption === 'full'
                            ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 ring-2 ring-indigo-500/20'
                            : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <p>Full Amount</p>
                        <p className="text-indigo-600 font-extrabold mt-0.5">₹{activeStudentSummary.pendingBalance.toLocaleString('en-IN')}</p>
                      </button>

                      <button
                        type="button"
                        onClick={() => setPaymentOption('half')}
                        className={`p-3 rounded-xl border text-left text-xs font-bold transition-all ${
                          paymentOption === 'half'
                            ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 ring-2 ring-indigo-500/20'
                            : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <p>Half-Yearly</p>
                        <p className="text-indigo-600 font-extrabold mt-0.5">₹{Math.round(activeStudentSummary.pendingBalance / 2).toLocaleString('en-IN')}</p>
                      </button>

                      <button
                        type="button"
                        onClick={() => setPaymentOption('quarter')}
                        className={`p-3 rounded-xl border text-left text-xs font-bold transition-all ${
                          paymentOption === 'quarter'
                            ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 ring-2 ring-indigo-500/20'
                            : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <p>Quarterly</p>
                        <p className="text-indigo-600 font-extrabold mt-0.5">₹{Math.round(activeStudentSummary.pendingBalance / 4).toLocaleString('en-IN')}</p>
                      </button>

                      <button
                        type="button"
                        onClick={() => setPaymentOption('custom')}
                        className={`p-3 rounded-xl border text-left text-xs font-bold transition-all ${
                          paymentOption === 'custom'
                            ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 ring-2 ring-indigo-500/20'
                            : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <p>Custom Amount</p>
                        <p className="text-indigo-600 font-extrabold mt-0.5">Enter ₹</p>
                      </button>
                    </div>

                    {paymentOption === 'custom' && (
                      <div className="mt-3">
                        <label className="block text-[11px] font-bold text-slate-500 mb-1">Enter Custom Partial Amount (₹)</label>
                        <input
                          type="number"
                          value={customAmountInput}
                          onChange={(e) => setCustomAmountInput(Math.max(1, Number(e.target.value) || 0))}
                          className="w-full text-xs font-bold p-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                          max={activeStudentSummary.pendingBalance}
                        />
                      </div>
                    )}
                  </div>

                  {/* Step 2: Payment Method */}
                  <div>
                    <label className="block text-xs font-bold text-slate-600 uppercase mb-2">Select Payment Method</label>
                    <div className="grid grid-cols-2 gap-2 text-xs font-bold">
                      {(['UPI', 'Razorpay', 'Card', 'NetBanking'] as const).map((gw) => (
                        <button
                          key={gw}
                          type="button"
                          onClick={() => setSelectedGateway(gw)}
                          className={`p-2.5 rounded-xl border flex items-center justify-center gap-1.5 transition-all ${
                            selectedGateway === gw
                              ? 'border-indigo-600 bg-indigo-600 text-white font-extrabold'
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

                  {/* Step 3: Summary & Pay Now Button */}
                  <div className="pt-3 border-t border-slate-100 space-y-3">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500 font-semibold">Total Payable Now:</span>
                      <span className="text-xl font-black text-indigo-600">₹{selectedPayableAmount.toLocaleString('en-IN')}</span>
                    </div>

                    <button
                      type="button"
                      disabled={isProcessingPayment || selectedPayableAmount <= 0}
                      onClick={handleStudentPayNow}
                      className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black text-sm rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2"
                    >
                      {isProcessingPayment ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" /> Processing Payment...
                        </>
                      ) : (
                        <>
                          Pay ₹{selectedPayableAmount.toLocaleString('en-IN')} Now <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // RENDER: SCHOOL ADMIN / ACCOUNTANT PORTAL VIEW
  // =========================================================================
  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="portal-header-card flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-md shadow-indigo-100 shrink-0">
            <IndianRupee className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="portal-pill-badge indigo">School Admin</span>
              <span className="text-[11px] font-bold text-slate-400">Finance & Collections</span>
            </div>
            <h1 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">
              Fee & Finance Management
            </h1>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Simple Fee Structures · Dynamic Components · Flexible Installment Payments · Financial Tracking
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-center">
          <button
            type="button"
            onClick={handleExportToExcel}
            className="portal-btn-secondary inline-flex items-center gap-2 cursor-pointer text-xs"
            title="Export complete fee invoices ledger to Excel (.xlsx) for reconciliation and tallying"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Export to Excel</span>
          </button>
          <button
            type="button"
            onClick={() => setIsResetModalOpen(true)}
            className="portal-btn-secondary inline-flex items-center gap-1.5 cursor-pointer text-xs"
            title="Reset fee schedule & payment history back to default demo state"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset Demo
          </button>
          {currentUserRole !== 'Teacher' && (
            <button
              onClick={() => openCreateStructureModal()}
              className="portal-btn-primary inline-flex items-center gap-2 cursor-pointer text-xs"
            >
              <Plus className="w-4 h-4" /> Create Fee Structure
            </button>
          )}
        </div>
      </div>

      {/* Admin Navigation Tabs */}
      <div className="flex bg-slate-100/80 p-1.5 rounded-2xl border border-slate-200/70 shadow-2xs overflow-x-auto gap-1">
        <button
          onClick={() => setActiveAdminTab('analytics')}
          className={`py-2 px-4 rounded-xl font-bold text-xs flex items-center gap-2 transition-all whitespace-nowrap cursor-pointer ${
            activeAdminTab === 'analytics'
              ? 'bg-white text-indigo-700 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <BarChart3 className="w-4 h-4" /> Financial Overview
        </button>

        <button
          onClick={() => setActiveAdminTab('tracking')}
          className={`py-2 px-4 rounded-xl font-bold text-xs flex items-center gap-2 transition-all whitespace-nowrap cursor-pointer ${
            activeAdminTab === 'tracking'
              ? 'bg-white text-indigo-700 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Users className="w-4 h-4" /> Student Fee Tracking ({filteredStudentSummaries.length})
        </button>

        <button
          onClick={() => setActiveAdminTab('structures')}
          className={`py-2 px-4 rounded-xl font-bold text-xs flex items-center gap-2 transition-all whitespace-nowrap cursor-pointer ${
            activeAdminTab === 'structures'
              ? 'bg-white text-indigo-700 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Layers className="w-4 h-4" /> Fee Structures ({structures.length})
        </button>

        <button
          onClick={() => setActiveAdminTab('reports')}
          className={`py-2 px-4 rounded-xl font-bold text-xs flex items-center gap-2 transition-all whitespace-nowrap cursor-pointer ${
            activeAdminTab === 'reports'
              ? 'bg-white text-indigo-700 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" /> Class Reports
        </button>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* TAB 1: FINANCIAL OVERVIEW & STATS */}
      {/* ------------------------------------------------------------------- */}
      {activeAdminTab === 'analytics' && (
        <div className="space-y-6">
          {/* CLASS SELECTION BLOCKS GRID */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-600" />
                  Class Financial Overview
                </h3>
                <p className="text-xs text-slate-500">Click on any class block below to view its complete financial overview</p>
              </div>
              <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100 self-start sm:self-auto">
                Selected: {selectedOverviewClass === 'All' ? 'All Classes (School-Wide)' : formatClassLabel(selectedOverviewClass)}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 pt-1">
              {/* Individual Class Blocks */}
              {availableClasses.length === 0 ? (
                <div className="col-span-full py-8 px-4 text-center bg-slate-50/70 rounded-2xl border border-dashed border-slate-200">
                  <Layers className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-sm font-extrabold text-slate-700">No classes created yet</p>
                  <p className="text-xs text-slate-500 mt-1">Create classes in Academic Setup to configure class fee structures and view financial overviews.</p>
                </div>
              ) : (
                availableClasses.map((cls) => {
                  const isSelected = matchClass(selectedOverviewClass, cls);
                  const classStr = structures.find((s) => s.level === 'class' && matchClass(s.targetClass, cls));
                  const classStudents = studentRecords.filter((r) => matchClass(r.class, cls));
                  const totalPerStudent = classStr ? classStr.items.reduce((s, i) => s + (Number(i.amount) || 0), 0) : 0;

                  return (
                    <button
                      key={cls}
                      type="button"
                      onClick={() => setSelectedOverviewClass(cls)}
                      className={`p-3.5 rounded-2xl border text-left transition-all relative overflow-hidden cursor-pointer ${
                        isSelected
                          ? 'bg-gradient-to-br from-indigo-50 to-violet-50 border-indigo-600 ring-2 ring-indigo-500/20 shadow-md'
                          : 'bg-slate-50/70 border-slate-200 hover:border-slate-300 hover:bg-slate-100/80'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                          classStr
                            ? (isSelected ? 'bg-indigo-600 text-white' : 'bg-emerald-100 text-emerald-800')
                            : 'bg-slate-200 text-slate-600'
                        }`}>
                          {classStr ? `₹${totalPerStudent.toLocaleString('en-IN')}` : 'No Fee Set'}
                        </span>
                        {isSelected && (
                          <CheckCircle className="w-4 h-4 text-indigo-600 shrink-0" />
                        )}
                      </div>
                      <h4 className="font-extrabold text-slate-900 text-sm mt-2">{formatClassLabel(cls)}</h4>
                      <p className="text-[11px] font-semibold text-slate-500 mt-0.5">
                        {classStudents.length} {classStudents.length === 1 ? 'Student' : 'Students'}
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* KPI CARDS GRID */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Expected Fees</span>
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                  <Wallet className="w-5 h-5" />
                </div>
              </div>
              <p className="text-2xl font-black text-slate-900 mt-2">₹{overallStats.totalExpected.toLocaleString('en-IN')}</p>
              <p className="text-xs text-slate-500 mt-1">Across all {overallStats.totalStudents} enrolled students</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Collected</span>
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                  <CheckCircle className="w-5 h-5" />
                </div>
              </div>
              <p className="text-2xl font-black text-emerald-600 mt-2">₹{overallStats.totalCollected.toLocaleString('en-IN')}</p>
              <p className="text-xs text-slate-500 mt-1">
                {overallStats.totalExpected > 0
                  ? Math.round((overallStats.totalCollected / overallStats.totalExpected) * 100)
                  : 0}% of expected total
              </p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Pending Balance</span>
                <div className="p-2 bg-rose-50 text-rose-600 rounded-lg">
                  <AlertTriangle className="w-5 h-5" />
                </div>
              </div>
              <p className="text-2xl font-black text-rose-600 mt-2">₹{overallStats.totalPending.toLocaleString('en-IN')}</p>
              <p className="text-xs text-slate-500 mt-1">Outstanding dues remaining</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Student Breakdown</span>
                <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                  <Users className="w-5 h-5" />
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-black text-xs">
                  {overallStats.paidCount} Paid
                </span>
                <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-black text-xs">
                  {overallStats.partialCount} Partial
                </span>
                <span className="px-2 py-0.5 bg-rose-100 text-rose-800 rounded font-black text-xs">
                  {overallStats.unpaidCount} Unpaid
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1.5">{overallStats.totalStudents} total students</p>
            </div>
          </div>

          {/* QUARTERLY FEE SET & DISTRIBUTION SECTION */}
          <div className="space-y-6">
            {/* 1. Quarterly Fee Schedule Grid */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-indigo-600 shrink-0" />
                    Quarterly Fee Set & Collection Distribution
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {selectedOverviewClass === 'All'
                      ? 'School-wide quarterly fee schedules and collection distribution'
                      : `${formatClassLabel(selectedOverviewClass)} specific quarterly fee schedule and collection status`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <div className="h-9 inline-flex items-center gap-1.5 bg-slate-100 pl-2.5 pr-1.5 rounded-xl border border-slate-200/80 shrink-0">
                    <span className="text-[11px] font-bold text-slate-500 whitespace-nowrap">Class:</span>
                    <select
                      value={selectedOverviewClass}
                      onChange={(e) => setSelectedOverviewClass(e.target.value)}
                      className="h-7 text-xs font-black px-2 rounded-lg border border-slate-200 bg-white text-indigo-950 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer shadow-2xs"
                    >
                      <option value="All">All Classes (School-Wide)</option>
                      {availableClasses.map((c) => (
                        <option key={c} value={c}>{formatClassLabel(c)}</option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={handleExportToExcel}
                    className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-2xs hover:shadow active:scale-98 transition-all cursor-pointer whitespace-nowrap shrink-0"
                    title="Export fee invoice ledger, quarterly collections, and receipts tally to Excel (.xlsx)"
                  >
                    <FileSpreadsheet className="w-4 h-4 shrink-0" />
                    <span>Export to Excel</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      openCreateStructureModal();
                      if (selectedOverviewClass !== 'All') {
                        setStructureForm((prev) => ({
                          ...prev,
                          name: `${formatClassLabel(selectedOverviewClass)} Fee Structure`,
                          level: 'class',
                          targetClass: selectedOverviewClass,
                        }));
                      }
                    }}
                    className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-2xs hover:shadow active:scale-98 transition-all cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Edit className="w-3.5 h-3.5 shrink-0" />
                    <span>{selectedOverviewClass === 'All' ? 'Edit Fee Structures' : `Edit ${formatClassLabel(selectedOverviewClass)} Fee`}</span>
                  </button>
                </div>
              </div>

              {quarterlyStats.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 space-y-2">
                  <Calendar className="w-8 h-8 text-slate-400 mx-auto" />
                  <h4 className="font-extrabold text-slate-700 text-sm">No Fee Structure Configured</h4>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    {selectedOverviewClass === 'All'
                      ? 'No active fee structures found. Click "Edit Fee Structures" or "Create New Fee Structure" to assign fees to classes.'
                      : `No fee structure configured for Class ${selectedOverviewClass}. Click "Edit ${formatClassLabel(selectedOverviewClass)} Fee" to create one.`}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {quarterlyStats.map((q) => {
                    return (
                      <div key={q.quarter} className="bg-slate-50/70 p-4 rounded-2xl border border-slate-200/80 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="px-2.5 py-0.5 bg-indigo-100 text-indigo-800 rounded-full font-black text-[10px]">
                            {q.quarter}
                          </span>
                          <span className="text-[11px] font-bold text-slate-500">
                            Due: {q.dueDate}
                          </span>
                        </div>

                        <div>
                          <h4 className="font-extrabold text-slate-900 text-sm">{q.name}</h4>
                          {q.perStudentAmount > 0 && (
                            <p className="text-[11px] font-semibold text-slate-500 mt-0.5">
                              Amount: <span className="font-bold text-slate-900">₹{q.perStudentAmount.toLocaleString('en-IN')} / student</span>
                            </p>
                          )}
                        </div>

                        <div className="pt-2 border-t border-slate-200/60 grid grid-cols-3 gap-1 text-center text-xs">
                          <div>
                            <p className="text-[9px] font-bold uppercase text-slate-400">Expected</p>
                            <p className="font-extrabold text-slate-900">₹{q.expected.toLocaleString('en-IN')}</p>
                          </div>
                          <div>
                            <p className="text-[9px] font-bold uppercase text-slate-400">Collected</p>
                            <p className="font-extrabold text-emerald-600">₹{q.collected.toLocaleString('en-IN')}</p>
                          </div>
                          <div>
                            <p className="text-[9px] font-bold uppercase text-slate-400">Pending</p>
                            <p className="font-extrabold text-rose-600">₹{q.pending.toLocaleString('en-IN')}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 2. Fee Component Distribution Breakdown */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <Receipt className="w-5 h-5 text-indigo-600" />
                Fee Component Distribution Summary
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-400 font-bold uppercase">
                      <th className="py-3 px-4">Fee Component</th>
                      <th className="py-3 px-4 text-center">Assigned Students</th>
                      <th className="py-3 px-4 text-right">Total Allocated (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                    {componentDistributionStats.map((item) => (
                      <tr key={item.category} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-extrabold text-slate-900">{item.category}</td>
                        <td className="py-3 px-4 text-center font-bold text-slate-600">{item.studentCount} Students</td>
                        <td className="py-3 px-4 text-right font-black text-indigo-700">
                          ₹{item.totalAmount.toLocaleString('en-IN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB 2: STUDENT-WISE FEE TRACKING & LEDGERS */}
      {/* ------------------------------------------------------------------- */}
      {activeAdminTab === 'tracking' && (
        <div className="space-y-4">
          {/* STEP 1: CLASS SELECTION OVERVIEW CARDS (WHEN NO CLASS IS SELECTED) */}
          {selectedTrackingClass === null ? (
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                    <Layers className="w-5 h-5 text-indigo-600" />
                    Student Fee Tracking — Select Class
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">Select a class below to view its section ledgers, fee statuses, and student records</p>
                </div>
                <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 px-3 py-1 rounded-xl border border-indigo-100 self-start sm:self-auto">
                  {trackingClassOverviewData.length} Classes Enrolled
                </span>
              </div>

              {trackingClassOverviewData.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-400 font-medium">
                  No active student records found.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pt-2">
                  {trackingClassOverviewData.map((c) => (
                    <div
                      key={c.cleanClass}
                      onClick={() => {
                        setSelectedTrackingClass(c.cleanClass);
                        setSelectedTrackingSection('All');
                      }}
                      className="bg-white p-5 rounded-2xl border border-slate-200 hover:border-indigo-500 hover:shadow-lg hover:-translate-y-0.5 transition-all cursor-pointer group space-y-4"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                            <Users className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="font-black text-slate-900 text-base">{c.className}</h4>
                            <p className="text-[11px] font-semibold text-slate-500">{c.totalStudents} {c.totalStudents === 1 ? 'Student' : 'Students'}</p>
                          </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-indigo-600 transition-colors" />
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-md">
                          Sections: {c.sections.size > 0 ? Array.from(c.sections).join(', ') : 'Default'}
                        </span>
                      </div>

                      <div className="pt-3 border-t border-slate-100 grid grid-cols-3 gap-1 text-center text-xs">
                        <div>
                          <p className="text-[9px] font-bold uppercase text-slate-400">Expected</p>
                          <p className="font-extrabold text-slate-900 mt-0.5">₹{c.totalExpected.toLocaleString('en-IN')}</p>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold uppercase text-slate-400">Collected</p>
                          <p className="font-extrabold text-emerald-600 mt-0.5">₹{c.totalCollected.toLocaleString('en-IN')}</p>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold uppercase text-slate-400">Pending</p>
                          <p className="font-extrabold text-rose-600 mt-0.5">₹{c.totalPending.toLocaleString('en-IN')}</p>
                        </div>
                      </div>

                      <div className="pt-1 flex items-center justify-end text-[11px] font-extrabold text-indigo-600 group-hover:underline gap-1">
                        View Class Sections & Details →
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* STEP 2: CLASS DETAIL VIEW WITH SECTION TABS & SEARCH */
            <div className="space-y-4">
              {/* NAVIGATION HEADER & FILTERS BAR */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTrackingClass(null);
                        setSelectedTrackingSection('All');
                      }}
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-all flex items-center gap-1.5 text-xs font-extrabold cursor-pointer"
                    >
                      <ArrowLeft className="w-4 h-4 text-slate-600" /> Back to All Classes
                    </button>
                    <div>
                      <h3 className="text-base font-extrabold text-slate-900">
                        {formatClassLabel(selectedTrackingClass)} Fee Tracking & Section Ledgers
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">Managing student fee ledgers and offline cash collections for {formatClassLabel(selectedTrackingClass)}</p>
                    </div>
                  </div>

                  {/* SECTION SELECTION PILLS */}
                  {selectedClassSections.length > 1 && (
                    <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-xl self-start sm:self-auto">
                      <button
                        type="button"
                        onClick={() => setSelectedTrackingSection('All')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all ${
                          selectedTrackingSection === 'All'
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        All Sections
                      </button>
                      {selectedClassSections.map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => setSelectedTrackingSection(sec)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all ${
                            selectedTrackingSection === sec
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Section {sec}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* SEARCH & FILTERS BAR */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  {/* Search Input */}
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="text"
                      placeholder="Search by student name, admission no, or ID..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full text-xs pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>

                  {/* Dropdown Filters */}
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="text-xs p-2.5 rounded-xl border border-slate-200 font-medium text-slate-700 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    >
                      <option value="All">All Statuses</option>
                      <option value="Paid">Paid</option>
                      <option value="Partially Paid">Partially Paid</option>
                      <option value="Unpaid">Unpaid</option>
                    </select>

                    <select
                      value={quarterFilter}
                      onChange={(e) => setQuarterFilter(e.target.value)}
                      className="text-xs p-2.5 rounded-xl border border-slate-200 font-bold text-indigo-700 bg-indigo-50/50 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    >
                      <option value="All">All Quarters</option>
                      <option value="Q1">Quarter 1</option>
                      <option value="Q2">Quarter 2</option>
                      <option value="Q3">Quarter 3</option>
                      <option value="Q4">Quarter 4</option>
                    </select>

                    {(searchTerm || statusFilter !== 'All' || quarterFilter !== 'All') && (
                      <button
                        onClick={() => {
                          setSearchTerm('');
                          setStatusFilter('All');
                          setQuarterFilter('All');
                        }}
                        className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-xl transition-all"
                      >
                        Reset Filters
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={handleExportTrackingClassToExcel}
                      className="h-9 px-3.5 inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all shadow-2xs cursor-pointer whitespace-nowrap"
                      title={`Export ${formatClassLabel(selectedTrackingClass)} fee invoices & ledger to Excel (.xlsx)`}
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>Export Class Ledger</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* CLASS SECTION LEDGER TABLES */}
              {classDetailSectionGroups.length === 0 ? (
                <div className="bg-white p-10 rounded-2xl border border-slate-200 shadow-sm text-center text-slate-400 font-medium">
                  No student fee records found matching your filters in {formatClassLabel(selectedTrackingClass)}.
                </div>
              ) : (
                <div className="space-y-6">
                  {classDetailSectionGroups.map(({ sectionTitle, students, totalExpected, totalCollected, totalPending }) => (
                    <div key={sectionTitle} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden space-y-0">
                      {/* CLASS SECTION HEADER BAR */}
                      <div className="bg-slate-50/90 p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2.5 bg-indigo-100 text-indigo-700 rounded-xl shadow-xs">
                            <Users className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-extrabold text-slate-900 text-sm">{sectionTitle}</h4>
                              <span className="px-2 py-0.5 bg-slate-200/80 text-slate-700 rounded-md text-[10px] font-black uppercase">
                                {students.length} Enrolled
                              </span>
                            </div>
                            <p className="text-[11px] font-semibold text-slate-500 mt-0.5">
                              Class fee tracking, concessions & collection ledger
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <button
                            type="button"
                            onClick={() => openSetClassFeeModal(selectedTrackingClass || '')}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-extrabold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                            title="Configure Fee Structure for this Class"
                          >
                            <Edit className="w-3.5 h-3.5" />
                            <span>Configure Class Fee</span>
                          </button>
                          <span className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl font-bold text-slate-700">
                            Expected: <strong className="text-slate-900">₹{totalExpected.toLocaleString('en-IN')}</strong>
                          </span>
                          <span className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-xl font-bold text-emerald-800">
                            Collected: <strong>₹{totalCollected.toLocaleString('en-IN')}</strong>
                          </span>
                          <span className="px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-xl font-bold text-rose-800">
                            Pending: <strong>₹{totalPending.toLocaleString('en-IN')}</strong>
                          </span>
                        </div>
                      </div>

                      {/* NOTICE IF CLASS HAS NO FEE STRUCTURE CONFIGURED */}
                      {totalExpected === 0 && (
                        <div className="p-3 bg-amber-50/90 border-b border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-amber-900 px-4">
                          <div className="flex items-center gap-2">
                            <Info className="w-4 h-4 text-amber-600 flex-shrink-0" />
                            <span>
                              <strong>Fee structure not set for this class yet.</strong> Standard fees show as ₹0 until configured. Click <strong>Configure Class Fee</strong> to apply standard tuition & exams, or configure per student below.
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => openSetClassFeeModal(selectedTrackingClass || '')}
                            className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs self-start sm:self-auto flex-shrink-0 cursor-pointer shadow-xs"
                          >
                            Set Class Fee Now
                          </button>
                        </div>
                      )}

                      {/* CLASS STUDENT LEDGER TABLE */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="bg-slate-100/60 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                              <th className="py-3.5 px-4">Student</th>
                              <th className="py-3.5 px-4 text-right">Total Fee (₹)</th>
                              <th className="py-3.5 px-4 text-right">Paid (₹)</th>
                              <th className="py-3.5 px-4 text-right">Pending (₹)</th>
                              <th className="py-3.5 px-4 text-center">Fee Status</th>
                              <th className="py-3.5 px-4 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {students.map(({ record, summary, paidQuartersCount }) => (
                              <tr key={record.id} className="hover:bg-slate-50/80 transition-colors">
                                <td className="py-3.5 px-4">
                                  <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-extrabold text-slate-700 text-xs">
                                      {record.studentName.charAt(0)}
                                    </div>
                                    <div>
                                      <p className="font-extrabold text-slate-900">{record.studentName}</p>
                                      <p className="text-[11px] text-slate-400">Adm: {record.admissionNo}</p>
                                    </div>
                                  </div>
                                </td>
                                <td className="py-3.5 px-4 text-right font-black text-slate-900">
                                  {summary.totalFee > 0 ? (
                                    <div>
                                      <span className="text-slate-900">₹{summary.totalFee.toLocaleString('en-IN')}</span>
                                      {(summary.scholarship > 0 || summary.discount > 0 || summary.transport > 0 || summary.hostel > 0 || summary.fine > 0) && (
                                        <p className="text-[10px] text-indigo-600 font-semibold">
                                          {[
                                            summary.scholarship > 0 ? `-₹${summary.scholarship} Sch.` : '',
                                            summary.discount > 0 ? `-₹${summary.discount} Disc.` : '',
                                            summary.transport > 0 ? `+₹${summary.transport} Trp.` : '',
                                          ].filter(Boolean).join(' ')}
                                        </p>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="inline-flex items-center gap-1.5">
                                      <span className="text-slate-400 font-bold">₹0</span>
                                      <button
                                        type="button"
                                        onClick={() => openEditBreakupModal(record)}
                                        className="px-2 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded text-[10px] font-bold cursor-pointer"
                                        title="Configure fee for this student"
                                      >
                                        Set Fee
                                      </button>
                                    </div>
                                  )}
                                </td>
                                <td className="py-3.5 px-4 text-right font-black text-emerald-600">
                                  ₹{summary.amountPaid.toLocaleString('en-IN')}
                                </td>
                                <td className="py-3.5 px-4 text-right font-black">
                                  {summary.pendingBalance > 0 ? (
                                    <span className="text-rose-600">₹{summary.pendingBalance.toLocaleString('en-IN')}</span>
                                  ) : (
                                    <span className="text-emerald-600">₹0</span>
                                  )}
                                </td>
                                <td className="py-3.5 px-4 text-center">
                                  <span
                                    className={`px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider ${
                                      summary.totalFee === 0
                                        ? 'bg-slate-100 text-slate-600'
                                        : summary.status === 'Paid'
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : summary.status === 'Partially Paid'
                                        ? 'bg-amber-100 text-amber-700'
                                        : 'bg-rose-100 text-rose-700'
                                    }`}
                                  >
                                    {summary.totalFee === 0 ? 'Fee Not Set' : summary.status}
                                  </span>
                                  <p className="text-[10px] font-bold text-slate-400 mt-1">
                                    {summary.totalFee > 0
                                      ? `${paidQuartersCount}/${summary.quarters.length || 4} Quarters Paid`
                                      : 'No schedule active'}
                                  </p>
                                </td>
                                <td className="py-3.5 px-4 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => openEditBreakupModal(record)}
                                      className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                                      title="Edit Fee Components, Concessions & Charges"
                                    >
                                      <Edit className="w-3.5 h-3.5" />
                                      <span>Edit Fee</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => openPaymentModal(record)}
                                      className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                                      title="Record Student Payment (Cash, UPI, Cheque, Card)"
                                    >
                                      <Plus className="w-3.5 h-3.5" />
                                      <span>Payment</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedRecord(record);
                                        setIsLedgerModalOpen(true);
                                      }}
                                      className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold transition-all cursor-pointer"
                                      title="View Student Ledger & History"
                                    >
                                      Ledger
                                    </button>

                                    {summary.pendingBalance > 0 && (
                                      <button
                                        type="button"
                                        onClick={() => handleSendReminder(record)}
                                        className="px-2 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg transition-all cursor-pointer"
                                        title="Send Fee Reminder to Parent"
                                      >
                                        <Bell className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}



      {/* ------------------------------------------------------------------- */}
      {/* TAB 3: FEE STRUCTURES (MANAGEMENT) */}
      {/* ------------------------------------------------------------------- */}
      {activeAdminTab === 'structures' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-slate-200">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">Active Fee Structures</h3>
              <p className="text-xs text-slate-500">Configure component breakups and assign them to school, classes, or students</p>
            </div>
            <button
              onClick={() => openCreateStructureModal()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold rounded-xl shadow-sm transition-all flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" /> Add Structure
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {structures.map((str) => {
              const totalAmount = str.items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
              return (
                <div key={str.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="px-2.5 py-0.5 bg-indigo-50 text-indigo-700 font-bold rounded-full text-[10px] uppercase">
                        Target: {str.level.toUpperCase()} {str.targetClass ? `(Class ${str.targetClass})` : ''}
                      </span>
                      <h4 className="text-base font-extrabold text-slate-900 mt-1">{str.name}</h4>
                      <p className="text-xs text-slate-400">Academic Year: {str.academicYear}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-bold text-slate-400">Total Fee</p>
                      <p className="text-xl font-black text-indigo-600">₹{totalAmount.toLocaleString('en-IN')}</p>
                    </div>
                  </div>

                  {/* Components List */}
                  <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 space-y-1.5">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Component Breakup</p>
                    {str.items.map((it, idx) => (
                      <div key={idx} className="flex justify-between items-center text-xs font-medium text-slate-700">
                        <span>{it.category}</span>
                        <span className="font-bold text-slate-900">₹{Number(it.amount).toLocaleString('en-IN')}</span>
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                    <button
                      onClick={() => openCreateStructureModal(str)}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-all flex items-center gap-1"
                    >
                      <Edit className="w-3.5 h-3.5" /> Edit & Assign
                    </button>
                    <button
                      onClick={() => handleDeleteStructure(str.id)}
                      className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                      title="Delete this fee structure"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB 4: CLASS FINANCIAL REPORTS */}
      {/* ------------------------------------------------------------------- */}
      {activeAdminTab === 'reports' && (
        <div className="space-y-4">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">Class-Level Financial Summary</h3>
                <p className="text-xs text-slate-500">Aggregated collection progress by class</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportToExcel}
                  className="h-9 px-3.5 inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition-all shadow-2xs cursor-pointer whitespace-nowrap"
                  title="Export complete fee invoices ledger to Excel (.xlsx) for reconciliation"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Export to Excel</span>
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="h-9 px-3.5 inline-flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer whitespace-nowrap"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Report</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase">
                    <th className="py-3 px-4">Class</th>
                    <th className="py-3 px-4 text-right">Expected Revenue (₹)</th>
                    <th className="py-3 px-4 text-right">Collected (₹)</th>
                    <th className="py-3 px-4 text-right">Pending Dues (₹)</th>
                    <th className="py-3 px-4 text-center">Collection %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {classReportData.map((row) => {
                    const percent = row.expected > 0 ? Math.round((row.collected / row.expected) * 100) : 0;
                    return (
                      <tr key={row.className} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-black text-slate-900">{row.className}</td>
                        <td className="py-3 px-4 text-right font-bold text-slate-800">₹{row.expected.toLocaleString('en-IN')}</td>
                        <td className="py-3 px-4 text-right font-black text-emerald-600">₹{row.collected.toLocaleString('en-IN')}</td>
                        <td className="py-3 px-4 text-right font-black text-rose-600">₹{row.pending.toLocaleString('en-IN')}</td>
                        <td className="py-3 px-4 text-center">
                          <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 font-black rounded-full text-xs">
                            {percent}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {classReportData.length > 0 && (
                  <tfoot className="bg-slate-50 border-t-2 border-slate-200 font-extrabold text-xs">
                    {(() => {
                      const totalExp = classReportData.reduce((s, r) => s + r.expected, 0);
                      const totalCol = classReportData.reduce((s, r) => s + r.collected, 0);
                      const totalPen = Math.max(0, totalExp - totalCol);
                      const totalPct = totalExp > 0 ? Math.round((totalCol / totalExp) * 100) : 0;
                      return (
                        <tr>
                          <td className="py-3 px-4 font-black text-slate-900">Total (All Classes)</td>
                          <td className="py-3 px-4 text-right font-black text-slate-900">₹{totalExp.toLocaleString('en-IN')}</td>
                          <td className="py-3 px-4 text-right font-black text-emerald-600">₹{totalCol.toLocaleString('en-IN')}</td>
                          <td className="py-3 px-4 text-right font-black text-rose-600">₹{totalPen.toLocaleString('en-IN')}</td>
                          <td className="py-3 px-4 text-center">
                            <span className="px-2.5 py-1 bg-indigo-600 text-white font-black rounded-full text-xs">
                              {totalPct}%
                            </span>
                          </td>
                        </tr>
                      );
                    })()}
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: STUDENT FEE LEDGER SLIDE-OVER */}
      {/* ========================================================================= */}
      {isLedgerModalOpen && selectedRecord && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex justify-end animate-fade-in" role="presentation">
          <div className="w-full max-w-2xl bg-white h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200 overflow-hidden">
            {/* Ledger Header */}
            <div className="flex-shrink-0 flex items-start justify-between border-b border-slate-100 p-6 pb-4">
              <div>
                <span className="px-2.5 py-0.5 bg-indigo-50 text-indigo-700 rounded-full font-bold text-[10px] uppercase">
                  Student Fee Ledger
                </span>
                <h2 className="text-xl font-extrabold text-slate-900 mt-1">{selectedRecord.studentName}</h2>
                <p className="text-xs text-slate-500">
                  Admission: <span className="font-bold text-slate-700">{selectedRecord.admissionNo}</span> · Class {selectedRecord.class}-{selectedRecord.section} · Year {selectedRecord.academicYear}
                </p>
              </div>
              <button
                onClick={() => setIsLedgerModalOpen(false)}
                className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Financial Summary Cards */}
            {(() => {
              const summary = getStudentFeeSummary(selectedRecord);
              return (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                      <p className="text-[10px] font-bold uppercase text-slate-400">Total Fee</p>
                      <p className="text-lg font-black text-slate-900 mt-1">₹{summary.totalFee.toLocaleString('en-IN')}</p>
                    </div>
                    <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-200">
                      <p className="text-[10px] font-bold uppercase text-emerald-600">Paid Amount</p>
                      <p className="text-lg font-black text-emerald-700 mt-1">₹{summary.amountPaid.toLocaleString('en-IN')}</p>
                    </div>
                    <div className="bg-rose-50 p-4 rounded-xl border border-rose-200">
                      <p className="text-[10px] font-bold uppercase text-rose-600">Remaining</p>
                      <p className="text-lg font-black text-rose-700 mt-1">₹{summary.pendingBalance.toLocaleString('en-IN')}</p>
                    </div>
                  </div>

                  {/* Quarterly Fee Status & Reminders */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
                        <Calendar className="w-4 h-4 text-indigo-600" />
                        Quarterly Fee Division & Status
                      </h3>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {(() => {
                        let runningPaid = summary.amountPaid;
                        return summary.quarters.map((q) => {
                          const qAmt = Number(q.amount) || 0;
                          let qStatus: 'Paid' | 'Payment due' | 'Overdue' = 'Payment due';
                          let qPaid = 0;
                          if (runningPaid >= qAmt) {
                            qStatus = 'Paid';
                            qPaid = qAmt;
                            runningPaid -= qAmt;
                          } else if (runningPaid > 0) {
                            qPaid = runningPaid;
                            qStatus = 'Payment due';
                            runningPaid = 0;
                          } else {
                            const today = new Date().toISOString().split('T')[0];
                            qStatus = q.dueDate && today > q.dueDate ? 'Overdue' : 'Payment due';
                          }
                          const remaining = Math.max(0, qAmt - qPaid);

                          return (
                            <div key={q.quarter} className={`p-3 rounded-xl border text-xs space-y-1.5 ${qStatus === 'Paid' ? 'bg-emerald-50/50 border-emerald-200' : (qStatus === 'Overdue' ? 'bg-rose-50/50 border-rose-200' : 'bg-slate-50 border-slate-200')}`}>
                              <div className="flex justify-between items-center">
                                <span className="font-extrabold text-slate-900">{q.quarter} ({q.name})</span>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${qStatus === 'Paid' ? 'bg-emerald-100 text-emerald-800' : (qStatus === 'Overdue' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800')}`}>
                                  {qStatus}
                                </span>
                              </div>
                              <div className="flex justify-between items-center text-slate-600">
                                <span>Amount: <strong className="text-slate-900">₹{qAmt.toLocaleString('en-IN')}</strong></span>
                                <span>Due: <strong>{q.dueDate}</strong></span>
                              </div>
                              {remaining > 0 ? (
                                <div className="pt-1 flex items-center justify-between border-t border-slate-200/60">
                                  <span className="font-bold text-rose-600">Remaining: ₹{remaining.toLocaleString('en-IN')}</span>
                                  <button
                                    onClick={() => handleSendQuarterReminder(selectedRecord, `${q.quarter} (${q.name})`, remaining)}
                                    className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-bold text-[10px] transition-all flex items-center gap-1 shadow-xs"
                                  >
                                    <Bell className="w-3 h-3" /> Notify Parent
                                  </button>
                                </div>
                              ) : (
                                <div className="pt-1 text-emerald-700 font-bold text-[11px] flex items-center gap-1">
                                  <CheckCircle className="w-3.5 h-3.5" /> Quarter Cleared
                                </div>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>

                  {/* Component Breakdown */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-extrabold text-slate-900">Fee Component Breakdown</h3>
                      <button
                        onClick={() => openEditBreakupModal(selectedRecord)}
                        className="px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-lg transition-all flex items-center gap-1"
                      >
                        <Edit className="w-3.5 h-3.5" /> Edit Breakup
                      </button>
                    </div>

                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2 text-xs">
                      {summary.items.map((it, idx) => (
                        <div key={idx} className="flex justify-between items-center font-medium text-slate-700">
                          <span>{it.category}</span>
                          <span className="font-bold text-slate-900">₹{Number(it.amount).toLocaleString('en-IN')}</span>
                        </div>
                      ))}
                      <div className="border-t border-slate-200 pt-2 font-extrabold flex justify-between text-slate-900">
                        <span>Total Component Fee</span>
                        <span className="text-indigo-600">₹{summary.baseComponentsTotal.toLocaleString('en-IN')}</span>
                      </div>
                    </div>
                  </div>

                  {/* Payment History */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-extrabold text-slate-900">Payment Transactions</h3>
                    {selectedRecord.paymentHistory.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">No payments recorded for this student yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {selectedRecord.paymentHistory.map((pmt) => (
                          <div key={pmt.id} className="p-3 bg-white rounded-xl border border-slate-200 flex items-center justify-between text-xs">
                            <div>
                              <p className="font-bold text-slate-900">{pmt.paymentMethod} · {pmt.paymentDate}</p>
                              <p className="text-[11px] text-slate-400">Receipt: {pmt.receiptNo} (Txn: {pmt.transactionId})</p>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-black text-emerald-600 text-sm">₹{pmt.amountPaid.toLocaleString('en-IN')}</span>
                              <button
                                onClick={() => handlePrintReceipt(pmt, selectedRecord)}
                                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600"
                                title="Print Receipt"
                              >
                                <Printer className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  </div>

                  {/* Action Footer */}
                  <div className="flex-shrink-0 p-4 px-6 border-t border-slate-100 flex gap-2 justify-end bg-white">
                    <button
                      onClick={() => openPaymentModal(selectedRecord)}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
                    >
                      + Record Payment
                    </button>
                    <button
                      onClick={() => setIsLedgerModalOpen(false)}
                      className="px-4 py-2 border border-slate-200 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: MANAGE STUDENT FEE & CONCESSIONS */}
      {/* ========================================================================= */}
      {isEditBreakupModalOpen && selectedRecord && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex min-h-full items-center justify-center p-3 sm:p-5 animate-fade-in" role="presentation">
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] flex flex-col p-4 sm:p-6 shadow-2xl border border-slate-100 overflow-hidden my-auto animate-in fade-in zoom-in-95">
            {/* Header */}
            <div className="flex justify-between items-center border-b border-slate-100 pb-3 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 bg-indigo-50 text-indigo-700 rounded-xl">
                  <Edit className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-sm sm:text-base">Manage Fee Structure & Concessions</h3>
                  <p className="text-xs text-slate-500">
                    Student: <strong className="text-slate-800">{selectedRecord.studentName}</strong> ({selectedRecord.admissionNo}) · Class {selectedRecord.class}-{selectedRecord.section}
                  </p>
                </div>
              </div>
              <button onClick={() => setIsEditBreakupModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Body */}
            <div className="space-y-4 py-3 overflow-y-auto flex-1 pr-1 text-xs">
              {/* SECTION 1: COMPONENT BREAKDOWN */}
              <div className="bg-slate-50/80 p-3.5 rounded-2xl border border-slate-200/80 space-y-2.5">
                <div className="flex justify-between items-center pb-1 border-b border-slate-200">
                  <div>
                    <label className="font-extrabold text-slate-900 uppercase text-[11px]">Fee Component Breakdown</label>
                    <p className="text-[10px] text-slate-500">Tuition, exams, library, sports & lab fees</p>
                  </div>
                  <span className="font-black text-indigo-700 text-xs">
                    Components Subtotal: ₹{editingBreakupItems.reduce((sum, i) => sum + (Number(i.amount) || 0), 0).toLocaleString('en-IN')}
                  </span>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {editingBreakupItems.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={item.category}
                        onChange={(e) => {
                          const copy = [...editingBreakupItems];
                          copy[idx].category = e.target.value;
                          setEditingBreakupItems(copy);
                        }}
                        className="flex-1 text-xs p-2 rounded-xl border border-slate-200 font-bold bg-white text-slate-800 focus:outline-indigo-500"
                        placeholder="Component Name (e.g. Tuition Fee)"
                      />
                      <div className="relative w-36">
                        <span className="absolute left-2.5 top-2 text-xs font-bold text-slate-400">₹</span>
                        <input
                          type="number"
                          value={item.amount}
                          onChange={(e) => {
                            const copy = [...editingBreakupItems];
                            copy[idx].amount = Number(e.target.value) || 0;
                            setEditingBreakupItems(copy);
                          }}
                          className="w-full text-xs pl-6 pr-2.5 py-2 rounded-xl border border-slate-200 font-extrabold bg-white text-slate-900 text-right focus:outline-indigo-500"
                          min={0}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditingBreakupItems(editingBreakupItems.filter((_, i) => i !== idx))}
                        className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg cursor-pointer transition-colors"
                        title="Remove Component"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setEditingBreakupItems([...editingBreakupItems, { category: 'Additional Fee', amount: 1000 }])}
                  className="w-full py-2 bg-white hover:bg-slate-100 border border-dashed border-slate-300 text-indigo-600 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Component Row
                </button>
              </div>

              {/* SECTION 2: CONCESSIONS, SCHOLARSHIPS & ADDITIONAL CHARGES */}
              <div className="bg-slate-50/80 p-3.5 rounded-2xl border border-slate-200/80 space-y-3">
                <div>
                  <label className="font-extrabold text-slate-900 uppercase text-[11px]">Concessions, Scholarships & Charges</label>
                  <p className="text-[10px] text-slate-500">Apply deductions (scholarships/discounts) or extra facilities (transport/hostel)</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {/* Scholarship */}
                  <div className="bg-emerald-50/70 p-2.5 rounded-xl border border-emerald-200/70 space-y-1">
                    <label className="block text-[10px] font-bold text-emerald-800 uppercase">Scholarship (₹ Deduction)</label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1.5 text-xs font-bold text-emerald-600">₹</span>
                      <input
                        type="number"
                        value={editingScholarship}
                        onChange={(e) => setEditingScholarship(Number(e.target.value) || 0)}
                        className="w-full pl-6 pr-2 py-1.5 bg-white rounded-lg border border-emerald-200 text-xs font-extrabold text-emerald-800 focus:outline-emerald-500"
                        min={0}
                      />
                    </div>
                  </div>

                  {/* Fee Discount */}
                  <div className="bg-emerald-50/70 p-2.5 rounded-xl border border-emerald-200/70 space-y-1">
                    <label className="block text-[10px] font-bold text-emerald-800 uppercase">Discount / Concession (₹)</label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1.5 text-xs font-bold text-emerald-600">₹</span>
                      <input
                        type="number"
                        value={editingDiscount}
                        onChange={(e) => setEditingDiscount(Number(e.target.value) || 0)}
                        className="w-full pl-6 pr-2 py-1.5 bg-white rounded-lg border border-emerald-200 text-xs font-extrabold text-emerald-800 focus:outline-emerald-500"
                        min={0}
                      />
                    </div>
                  </div>

                  {/* Transport Charges */}
                  <div className="bg-indigo-50/70 p-2.5 rounded-xl border border-indigo-200/70 space-y-1">
                    <label className="block text-[10px] font-bold text-indigo-800 uppercase">Transport Charges (₹)</label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1.5 text-xs font-bold text-indigo-600">₹</span>
                      <input
                        type="number"
                        value={editingTransport}
                        onChange={(e) => setEditingTransport(Number(e.target.value) || 0)}
                        className="w-full pl-6 pr-2 py-1.5 bg-white rounded-lg border border-indigo-200 text-xs font-extrabold text-indigo-800 focus:outline-indigo-500"
                        min={0}
                      />
                    </div>
                  </div>

                  {/* Hostel Charges */}
                  <div className="bg-indigo-50/70 p-2.5 rounded-xl border border-indigo-200/70 space-y-1">
                    <label className="block text-[10px] font-bold text-indigo-800 uppercase">Hostel / Boarding (₹)</label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1.5 text-xs font-bold text-indigo-600">₹</span>
                      <input
                        type="number"
                        value={editingHostel}
                        onChange={(e) => setEditingHostel(Number(e.target.value) || 0)}
                        className="w-full pl-6 pr-2 py-1.5 bg-white rounded-lg border border-indigo-200 text-xs font-extrabold text-indigo-800 focus:outline-indigo-500"
                        min={0}
                      />
                    </div>
                  </div>

                  {/* Fine / Late Fee */}
                  <div className="bg-amber-50/70 p-2.5 rounded-xl border border-amber-200/70 space-y-1 sm:col-span-2 lg:col-span-1">
                    <label className="block text-[10px] font-bold text-amber-800 uppercase">Late Fee / Fine (₹)</label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1.5 text-xs font-bold text-amber-600">₹</span>
                      <input
                        type="number"
                        value={editingFine}
                        onChange={(e) => setEditingFine(Number(e.target.value) || 0)}
                        className="w-full pl-6 pr-2 py-1.5 bg-white rounded-lg border border-amber-200 text-xs font-extrabold text-amber-800 focus:outline-amber-500"
                        min={0}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 3: LIVE CALCULATION SUMMARY BAR */}
              {(() => {
                const compSubtotal = editingBreakupItems.reduce((s, i) => s + (Number(i.amount) || 0), 0);
                const deductions = (Number(editingScholarship) || 0) + (Number(editingDiscount) || 0);
                const charges = (Number(editingTransport) || 0) + (Number(editingHostel) || 0) + (Number(editingFine) || 0);
                const netAnnualFee = Math.max(0, compSubtotal + charges - deductions);
                const alreadyPaid = (selectedRecord.paymentHistory || []).reduce((s, p) => s + (Number(p.amountPaid) || 0), 0);
                const newBalance = Math.max(0, netAnnualFee - alreadyPaid);

                return (
                  <div className="p-3.5 bg-slate-900 text-white rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-sm">
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Net Calculated Fee</p>
                      <p className="text-lg font-black text-white">₹{netAnnualFee.toLocaleString('en-IN')}</p>
                      <p className="text-[10px] text-slate-400">
                        Base: ₹{compSubtotal.toLocaleString('en-IN')} | Deductions: -₹{deductions.toLocaleString('en-IN')} | Charges: +₹{charges.toLocaleString('en-IN')}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 border-l border-slate-700 pl-4">
                      <div>
                        <p className="text-[10px] font-bold uppercase text-emerald-400">Paid So Far</p>
                        <p className="text-sm font-black text-emerald-400">₹{alreadyPaid.toLocaleString('en-IN')}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase text-rose-400">Pending Balance</p>
                        <p className="text-sm font-black text-rose-400">₹{newBalance.toLocaleString('en-IN')}</p>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Footer Buttons */}
            <div className="pt-3 border-t border-slate-100 flex justify-end gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => setIsEditBreakupModalOpen(false)}
                className="px-4 py-2 border border-slate-200 text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-50 cursor-pointer"
                disabled={isSavingStudentFee}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveStudentBreakup}
                disabled={isSavingStudentFee}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isSavingStudentFee ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving to Database...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Save & Sync to Database</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: RECORD STUDENT PAYMENT */}
      {/* ========================================================================= */}
      {isCashPaymentModalOpen && selectedRecord && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex min-h-full items-center justify-center p-3 sm:p-5 animate-fade-in" role="presentation">
          <form onSubmit={handleRecordPayment} className="bg-white rounded-3xl max-w-lg w-full max-h-[85vh] flex flex-col p-4 sm:p-6 shadow-2xl border border-slate-100 overflow-hidden my-auto animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 bg-emerald-50 text-emerald-700 rounded-xl">
                  <Wallet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-sm sm:text-base">Record Student Payment</h3>
                  <p className="text-xs text-slate-500">Persists directly to database and updates receipt ledger</p>
                </div>
              </div>
              <button type="button" onClick={() => setIsCashPaymentModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3.5 py-3 overflow-y-auto flex-1 pr-1 text-xs">
              {/* Student overview banner */}
              {(() => {
                const summary = getStudentFeeSummary(selectedRecord);
                return (
                  <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 flex items-center justify-between">
                    <div>
                      <p className="font-extrabold text-slate-900 text-xs sm:text-sm">{selectedRecord.studentName}</p>
                      <p className="text-[11px] text-slate-500">Adm: {selectedRecord.admissionNo} · Class {selectedRecord.class}-{selectedRecord.section}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold uppercase text-rose-600">Balance Due</p>
                      <p className="font-black text-rose-700 text-sm">₹{summary.pendingBalance.toLocaleString('en-IN')}</p>
                    </div>
                  </div>
                );
              })()}

              {/* Form Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Payment Method */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Payment Method</label>
                  <select
                    value={paymentMethodInput}
                    onChange={(e) => setPaymentMethodInput(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 font-bold bg-white text-slate-800 focus:outline-indigo-500"
                  >
                    <option value="Cash">Cash (Offline)</option>
                    <option value="UPI">UPI / Online / QR</option>
                    <option value="NetBanking">Net Banking / NEFT</option>
                    <option value="Cheque">Cheque / Demand Draft</option>
                    <option value="Card">Credit / Debit Card</option>
                  </select>
                </div>

                {/* Payment Date */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Payment Date</label>
                  <input
                    type="date"
                    value={paymentDateInput}
                    onChange={(e) => setPaymentDateInput(e.target.value)}
                    className="w-full p-2 rounded-xl border border-slate-200 font-bold bg-white text-slate-800 focus:outline-indigo-500"
                    required
                  />
                </div>

                {/* Amount Received */}
                <div className="sm:col-span-2">
                  <div className="flex justify-between items-center mb-1">
                    <label className="font-bold text-slate-700">Amount Received (₹)</label>
                    {(() => {
                      const summary = getStudentFeeSummary(selectedRecord);
                      if (summary.pendingBalance > 0) {
                        return (
                          <button
                            type="button"
                            onClick={() => {
                              setPaymentAmountInput(summary.pendingBalance);
                              setCashAmountInput(summary.pendingBalance);
                            }}
                            className="text-[11px] font-extrabold text-indigo-600 hover:underline cursor-pointer"
                          >
                            Fill Full Balance (₹{summary.pendingBalance.toLocaleString('en-IN')})
                          </button>
                        );
                      }
                      return null;
                    })()}
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-sm font-extrabold text-slate-400">₹</span>
                    <input
                      type="number"
                      value={paymentAmountInput}
                      onChange={(e) => {
                        const val = Number(e.target.value) || 0;
                        setPaymentAmountInput(val);
                        setCashAmountInput(val);
                      }}
                      className="w-full pl-8 pr-3 py-2.5 rounded-xl border border-slate-200 font-black text-slate-900 text-base focus:outline-indigo-500 bg-white"
                      min={1}
                      required
                    />
                  </div>
                </div>

                {/* Category / Description */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Fee Category / Description</label>
                  <input
                    type="text"
                    value={paymentCategoryInput}
                    onChange={(e) => {
                      setPaymentCategoryInput(e.target.value);
                      setCashCategoryInput(e.target.value);
                    }}
                    placeholder="e.g. Tuition Fee / Quarter Installment"
                    className="w-full p-2.5 rounded-xl border border-slate-200 font-bold bg-white text-slate-800 focus:outline-indigo-500"
                  />
                </div>

                {/* Reference ID / Cheque No */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Transaction Ref / Cheque No (Optional)</label>
                  <input
                    type="text"
                    value={paymentRefInput}
                    onChange={(e) => setPaymentRefInput(e.target.value)}
                    placeholder="e.g. CHQ-482910 or UPI Ref"
                    className="w-full p-2.5 rounded-xl border border-slate-200 font-medium bg-white text-slate-800 focus:outline-indigo-500"
                  />
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => setIsCashPaymentModalOpen(false)}
                className="px-4 py-2 border border-slate-200 text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-50 cursor-pointer"
                disabled={isRecordingPayment}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isRecordingPayment}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isRecordingPayment ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving Payment...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Save Payment & Print Receipt</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: CREATE / EDIT FEE STRUCTURE */}
      {/* ========================================================================= */}
      {isStructureModalOpen && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex min-h-full items-center justify-center p-3 sm:p-5 animate-fade-in" role="presentation">
          <form onSubmit={handleSaveStructure} className="bg-white rounded-3xl max-w-4xl w-full max-h-[85vh] flex flex-col p-4 sm:p-6 shadow-2xl border border-slate-100 overflow-hidden my-auto animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2.5 flex-shrink-0">
              <div>
                <h3 className="font-extrabold text-slate-900 text-sm sm:text-base">
                  {editingStructureId ? 'Edit Fee Structure' : 'Create New Fee Structure'}
                </h3>
                <p className="text-xs text-slate-500">Set component breakups and target assignment</p>
              </div>
              <button type="button" onClick={() => setIsStructureModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 py-2.5 overflow-y-auto flex-1 pr-1 text-xs">
              {/* Top Configuration Bar: Name, Level, Target */}
              <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-200/70 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                <div>
                  <label className="block font-bold text-slate-600 mb-1">Structure Name</label>
                  <input
                    type="text"
                    value={structureForm.name}
                    onChange={(e) => setStructureForm({ ...structureForm, name: e.target.value })}
                    placeholder="e.g. Class 10 Standard Fee Structure"
                    className="w-full p-2 rounded-lg border border-slate-200 font-bold bg-white focus:outline-indigo-500"
                    required
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-600 mb-1">Structure Level</label>
                  <select
                    value={structureForm.level}
                    onChange={(e) => {
                      const lvl = e.target.value as 'school' | 'class' | 'section' | 'student';
                      setStructureForm({
                        ...structureForm,
                        level: lvl,
                      });
                    }}
                    className="w-full p-2 rounded-lg border border-slate-200 font-bold bg-white focus:outline-indigo-500"
                  >
                    <option value="class">Class-Level Structure</option>
                    <option value="section">Section-Level Structure</option>
                    <option value="school">School-Wide Structure</option>
                    <option value="student">Student-Specific Custom Fee</option>
                  </select>
                </div>

                {(structureForm.level === 'class' || structureForm.level === 'section') && (
                  <div>
                    <label className="block font-bold text-slate-600 mb-1">Target Class</label>
                    <select
                      value={structureForm.targetClassId ? String(structureForm.targetClassId) : structureForm.targetClass}
                      onChange={(e) => {
                        const val = e.target.value;
                        const foundCls = academicClasses.find(c => String(c.id) === val || c.name === val);
                        const selClass = foundCls ? foundCls.name : val;
                        const selClassId = foundCls ? foundCls.id : undefined;
                        setStructureForm({
                          ...structureForm,
                          targetClass: selClass,
                          targetClassId: selClassId,
                          targetSectionId: undefined,
                          name: structureForm.name.includes('Fee Structure') ? `${formatClassLabel(selClass)} Fee Structure` : structureForm.name,
                        });
                      }}
                      className="w-full p-2 rounded-lg border border-slate-200 font-bold bg-white focus:outline-indigo-500"
                      required
                    >
                      <option value="">Select Class...</option>
                      {academicClasses.length > 0 ? (
                        academicClasses.map((cls) => (
                          <option key={cls.id} value={cls.id}>
                            {formatClassLabel(cls.name)}
                          </option>
                        ))
                      ) : (
                        availableClasses.map((cls) => (
                          <option key={cls} value={cls}>
                            {formatClassLabel(cls)}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                )}

                {structureForm.level === 'section' && (
                  <div className="sm:col-span-2 lg:col-span-1">
                    <label className="block font-bold text-slate-600 mb-1">Target Section</label>
                    <select
                      value={structureForm.targetSectionId ? String(structureForm.targetSectionId) : structureForm.targetSection}
                      onChange={(e) => {
                        const val = e.target.value;
                        const foundSec = academicSections.find(s => String(s.id) === val || s.name === val);
                        setStructureForm({
                          ...structureForm,
                          targetSection: foundSec ? foundSec.name : val,
                          targetSectionId: foundSec ? foundSec.id : undefined,
                        });
                      }}
                      className="w-full p-2 rounded-lg border border-slate-200 font-bold bg-white focus:outline-indigo-500"
                      required
                    >
                      <option value="">Select Section...</option>
                      {academicSections
                        .filter(s => !structureForm.targetClassId || s.classId === structureForm.targetClassId)
                        .map((sec) => (
                          <option key={sec.id} value={sec.id}>
                            Section {sec.name}
                          </option>
                        ))}
                    </select>
                  </div>
                )}

                {structureForm.level === 'student' && (
                  <div className="sm:col-span-2 lg:col-span-1">
                    <label className="block font-bold text-slate-600 mb-1">Target Student</label>
                    <select
                      value={structureForm.targetStudentId}
                      onChange={(e) => {
                        const stId = e.target.value;
                        const st = students.find(s => s.id === stId);
                        setStructureForm({
                          ...structureForm,
                          targetStudentId: stId,
                          targetClass: st?.class || structureForm.targetClass,
                          targetClassId: st?.classId,
                          targetSection: st?.section || structureForm.targetSection,
                          targetSectionId: st?.sectionId,
                          name: st ? `${st.name} Fee Structure` : structureForm.name,
                        });
                      }}
                      className="w-full p-2 rounded-lg border border-slate-200 font-bold bg-white focus:outline-indigo-500"
                      required
                    >
                      <option value="">Select Student...</option>
                      {students.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.name} ({st.admissionNo}) - Class {st.class}-{st.section}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Widescreen 2-Column Grid: Components on Left, Quarters Schedule on Right */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 pt-1">
                {/* Left Column: Fee Component Breakup */}
                <div className="space-y-2 bg-slate-50/50 p-3 rounded-xl border border-slate-200/70">
                  <div className="flex justify-between items-center pb-1 border-b border-slate-200/60">
                    <label className="font-extrabold text-slate-800 uppercase text-[11px]">Fee Component Breakup</label>
                    <span className="font-black text-indigo-600 text-xs">Total: ₹{structureFormTotal.toLocaleString('en-IN')}</span>
                  </div>

                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {structureForm.items.map((item, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={item.category}
                          onChange={(e) => {
                            const copy = [...structureForm.items];
                            copy[idx].category = e.target.value;
                            setStructureForm({ ...structureForm, items: copy });
                          }}
                          className="flex-1 p-1.5 rounded-lg border border-slate-200 font-bold bg-white text-xs"
                          placeholder="Category"
                        />
                        <div className="relative w-28">
                          <span className="absolute left-2 top-1.5 font-bold text-slate-400 text-xs">₹</span>
                          <input
                            type="number"
                            value={item.amount}
                            onChange={(e) => {
                              const copy = [...structureForm.items];
                              copy[idx].amount = Number(e.target.value) || 0;
                              setStructureForm({ ...structureForm, items: copy });
                            }}
                            className="w-full text-right pl-5 pr-2 py-1.5 rounded-lg border border-slate-200 font-bold bg-white text-xs"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const copy = structureForm.items.filter((_, i) => i !== idx);
                            setStructureForm({ ...structureForm, items: copy });
                          }}
                          className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg cursor-pointer transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setStructureForm({
                        ...structureForm,
                        items: [...structureForm.items, { category: 'Extra Fee', amount: 1000 }],
                      })
                    }
                    className="w-full py-1.5 bg-white hover:bg-slate-50 border border-dashed border-slate-300 text-slate-700 font-bold text-xs rounded-lg flex items-center justify-center gap-1 cursor-pointer transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Component Row
                  </button>
                </div>

                {/* Right Column: Quarterly Fee Schedule Editor */}
                <div className="space-y-2 bg-slate-50/50 p-3 rounded-xl border border-slate-200/70">
                  <div className="flex justify-between items-center pb-1 border-b border-slate-200/60">
                    <div>
                      <label className="font-extrabold text-slate-800 uppercase text-[11px]">Fee Payment Quarters</label>
                      <p className="text-[10px] text-slate-400">Installments & due dates</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const count = structureForm.quarters.length || 1;
                        const perQ = Math.floor(structureFormTotal / count);
                        const remainder = structureFormTotal - perQ * count;
                        const updated = structureForm.quarters.map((q, idx) => ({
                          ...q,
                          amount: idx === count - 1 ? perQ + remainder : perQ,
                        }));
                        setStructureForm({ ...structureForm, quarters: updated });
                      }}
                      className="text-[11px] font-bold text-indigo-600 hover:underline cursor-pointer"
                    >
                      Auto-Split Evenly
                    </button>
                  </div>

                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {structureForm.quarters.map((q, idx) => (
                      <div key={idx} className="p-2 bg-white rounded-xl border border-slate-200 space-y-1.5">
                        <div className="flex justify-between items-center gap-2">
                          <div className="flex items-center gap-1.5 flex-1">
                            <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-800 rounded font-black text-[9px]">
                              {q.quarter || `Q${idx + 1}`}
                            </span>
                            <input
                              type="text"
                              value={q.name}
                              onChange={(e) => {
                                const copy = [...structureForm.quarters];
                                copy[idx].name = e.target.value;
                                setStructureForm({ ...structureForm, quarters: copy });
                              }}
                              className="text-xs font-bold p-1 rounded-md border border-slate-200 bg-white text-slate-800 flex-1"
                              placeholder="Quarter Name"
                            />
                          </div>
                          {structureForm.quarters.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                const updated = structureForm.quarters.filter((_, i) => i !== idx);
                                setStructureForm({
                                  ...structureForm,
                                  quarters: updated.map((item, i) => ({ ...item, quarter: (`Q${i + 1}` as 'Q1' | 'Q2' | 'Q3' | 'Q4') })),
                                });
                              }}
                              className="p-1 text-rose-500 hover:bg-rose-100 rounded-md transition-colors cursor-pointer"
                              title="Remove Quarter"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[9px] font-bold text-slate-400 uppercase">Amount (₹)</label>
                            <input
                              type="number"
                              value={q.amount}
                              onChange={(e) => {
                                const copy = [...structureForm.quarters];
                                copy[idx].amount = Number(e.target.value) || 0;
                                setStructureForm({ ...structureForm, quarters: copy });
                              }}
                              className="w-full text-xs font-extrabold p-1 rounded-md border border-slate-200 bg-white text-slate-900"
                            />
                          </div>
                          <div>
                            <label className="block text-[9px] font-bold text-slate-400 uppercase">Due Date</label>
                            <input
                              type="date"
                              value={q.dueDate}
                              onChange={(e) => {
                                const copy = [...structureForm.quarters];
                                copy[idx].dueDate = e.target.value;
                                setStructureForm({ ...structureForm, quarters: copy });
                              }}
                              className="w-full text-xs p-1 rounded-md border border-slate-200 bg-white font-medium"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const current = structureForm.quarters;
                      const nextNum = current.length + 1;
                      const qTag = (`Q${nextNum}` as 'Q1' | 'Q2' | 'Q3' | 'Q4');
                      const newQuarter: QuarterFeeDetail = {
                        quarter: qTag,
                        name: `Quarter ${nextNum}`,
                        amount: 5000,
                        dueDate: '2026-10-15',
                      };
                      setStructureForm({
                        ...structureForm,
                        quarters: [...current, newQuarter],
                      });
                    }}
                    className="w-full py-1.5 bg-white hover:bg-slate-50 border border-dashed border-slate-300 text-indigo-600 font-bold text-xs rounded-lg flex items-center justify-center gap-1 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Quarter / Installment
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-slate-500">Total: ₹{structureFormTotal.toLocaleString('en-IN')}</span>
                {editingStructureId && (
                  <button
                    type="button"
                    onClick={() => handleDeleteStructure(editingStructureId)}
                    className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-xl transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete Structure
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsStructureModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold rounded-xl shadow-xs cursor-pointer"
                >
                  Save & Assign Structure
                </button>
              </div>
            </div>
          </form>
        </div>,
        document.body
      )}

      {/* ========================================================================= */}
      {/* MODAL 5: RECEIPT VIEWER / PRINT DIALOG */}
      {/* ========================================================================= */}
      {viewingReceipt && viewingReceiptRecord && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex min-h-full items-center justify-center p-3 sm:p-5 animate-fade-in" role="presentation">
          <div className="bg-white rounded-3xl max-w-lg w-full max-h-[85vh] flex flex-col p-4 sm:p-6 shadow-2xl space-y-3 print:shadow-none print:p-0 border border-slate-100 overflow-hidden my-auto animate-in fade-in zoom-in-95">
            <div className="text-center border-b border-slate-100 pb-2.5 flex-shrink-0">
              <span className="px-2.5 py-0.5 bg-indigo-50 text-indigo-700 rounded-full font-bold text-[10px] uppercase">
                Official Payment Receipt
              </span>
              <h3 className="text-base font-black text-slate-900 mt-1">{schoolName}</h3>
              <p className="text-xs text-slate-400 font-mono mt-0.5">{viewingReceipt.receiptNo}</p>
            </div>

            <div className="overflow-y-auto flex-1 pr-1 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs bg-slate-50/70 p-3 rounded-xl border border-slate-100">
                <div className="flex justify-between py-1 border-b border-slate-100/80 sm:pr-2">
                  <span className="text-slate-500 font-semibold">Student Name:</span>
                  <span className="font-extrabold text-slate-900">{viewingReceiptRecord.studentName}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100/80 sm:pl-2">
                  <span className="text-slate-500 font-semibold">Admission No:</span>
                  <span className="font-bold text-slate-800">{viewingReceiptRecord.admissionNo}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100/80 sm:pr-2">
                  <span className="text-slate-500 font-semibold">Class & Section:</span>
                  <span className="font-bold text-slate-800">{viewingReceiptRecord.class}-{viewingReceiptRecord.section}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100/80 sm:pl-2">
                  <span className="text-slate-500 font-semibold">Payment Date:</span>
                  <span className="font-bold text-slate-800">{viewingReceipt.paymentDate}</span>
                </div>
                <div className="flex justify-between py-1 sm:border-0 border-b border-slate-100/80 sm:pr-2">
                  <span className="text-slate-500 font-semibold">Method:</span>
                  <span className="font-bold text-slate-800">{viewingReceipt.paymentMethod}</span>
                </div>
                <div className="flex justify-between py-1 sm:pl-2">
                  <span className="text-slate-500 font-semibold">Txn ID:</span>
                  <span className="font-mono text-slate-700 truncate max-w-[120px]">{viewingReceipt.transactionId}</span>
                </div>
              </div>

              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-center">
                <p className="text-[10px] font-bold uppercase text-emerald-700">Amount Paid</p>
                <p className="text-xl font-black text-emerald-800">₹{viewingReceipt.amountPaid.toLocaleString('en-IN')}</p>
                <p className="text-[10px] text-emerald-600 font-bold mt-0.5">Status: CLEARED & VERIFIED</p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2.5 border-t border-slate-100 flex-shrink-0 print:hidden">
              <button
                onClick={() => window.print()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-4 h-4" /> Print Receipt
              </button>
              <button
                onClick={() => setViewingReceipt(null)}
                className="px-4 py-2 border border-slate-200 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================================= */}
      {/* RESET DEMO CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {isResetModalOpen && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex min-h-full items-center justify-center p-3 sm:p-5 animate-fade-in" role="presentation">
          <div className="bg-white rounded-3xl max-w-md w-full max-h-[85vh] flex flex-col p-4 sm:p-6 shadow-2xl space-y-3 animate-in fade-in zoom-in-95 duration-150 border border-slate-100 overflow-hidden my-auto">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2.5 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-50 rounded-xl text-amber-600 border border-amber-200">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-sm sm:text-base">Reset Demo Data</h3>
                  <p className="text-xs text-slate-500">Restore default demo fee status</p>
                </div>
              </div>
              <button onClick={() => setIsResetModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 pr-1 space-y-2 text-xs text-slate-600">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <p className="font-medium">
                  This action will clear custom payments & receipts and restore the initial default demo fee state:
                </p>
                <ul className="list-disc pl-4 space-y-1 font-semibold text-slate-700">
                  <li>Fee Total: <span className="font-bold text-slate-900">₹35,000</span></li>
                  <li>Paid Amount: <span className="font-bold text-emerald-700">₹10,000</span> (Quarter 1 Paid)</li>
                  <li>Balance Due: <span className="font-bold text-rose-700">₹25,000</span> (Quarters 2, 3, & 4 Due)</li>
                </ul>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2.5 border-t border-slate-100 flex-shrink-0">
              <button
                type="button"
                onClick={() => setIsResetModalOpen(false)}
                className="px-4 py-2 border border-slate-200 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReset}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" /> Reset to Default
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
