import {
  ArrowUpRight,
  CreditCard,
  GraduationCap,
  UserCheck,
  Users,
  Wallet,
  Clock,
  Plus,
  CheckSquare,
  School,
  BookOpen,
  FileCheck,
  FileText,
  CheckCircle2,
  AlertCircle,
  Eye,
  Download,
  RefreshCw,
  Search,
  Filter,
  Check,
  X,
  ShieldCheck,
  ZoomIn,
  ZoomOut,
  RotateCw,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  User,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Student, UserRole } from '../types';
import RoleDashboard from './RoleDashboard';
import { useGetTeachersQuery, useGetTeacherStatsQuery, useVerifyTeacherDocumentMutation } from '../store/api/teacherApi';
import { useGetClassesQuery, useGetSectionsQuery } from '../store/api/academicApi';
import { useGetSchoolRevenueQuery } from '../store/api/financeApi';
import { useGetStudentStatsQuery, useVerifyStudentDocumentMutation } from '../store/api/studentApi';
import { useGetSchoolDocumentsQueueQuery, type SchoolDocumentItem } from '../store/api/schoolApi';
import { apiDownload } from '../services/api';

interface DashboardProps {
  onNavigateToTab: (tabId: string) => void;
  isGlass?: boolean;
  role?: UserRole;
  userName?: string;
  students?: Student[];
  schoolName?: string;
  currentAcademicYear?: string;
}

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];

const asAmount = (value: unknown): number | null => {
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) ? amount : null;
};

const metricAccents = [
  { leftBorder: 'border-l-blue-500',    iconBg: 'bg-blue-50',    iconText: 'text-blue-500',    hoverBg: 'group-hover:bg-blue-500',    label: 'text-blue-500',    cardHover: 'hover:border-blue-200'    },
  { leftBorder: 'border-l-emerald-500', iconBg: 'bg-emerald-50', iconText: 'text-emerald-500', hoverBg: 'group-hover:bg-emerald-500', label: 'text-emerald-600', cardHover: 'hover:border-emerald-200' },
  { leftBorder: 'border-l-amber-500',   iconBg: 'bg-amber-50',   iconText: 'text-amber-500',   hoverBg: 'group-hover:bg-amber-500',   label: 'text-amber-600',   cardHover: 'hover:border-amber-200'   },
  { leftBorder: 'border-l-violet-500',  iconBg: 'bg-violet-50',  iconText: 'text-violet-500',  hoverBg: 'group-hover:bg-violet-500',  label: 'text-violet-600',  cardHover: 'hover:border-violet-200'  },
];

export default function Dashboard({
  onNavigateToTab,
  isGlass = false,
  role = 'School Admin',
  userName = 'Admin',
  students = [],
  schoolName = 'Your School',
  currentAcademicYear = '',
}: DashboardProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const { data: teachersData = [] } = useGetTeachersQuery();
  const { data: teacherStats } = useGetTeacherStatsQuery();
  const { data: classesData = [] } = useGetClassesQuery();
  const { data: sectionsData = [] } = useGetSectionsQuery();
  const { data: revenueData, isFetching: isRevenueFetching } = useGetSchoolRevenueQuery(
    currentAcademicYear ? { academicYear: currentAcademicYear } : undefined,
    { refetchOnFocus: true, refetchOnReconnect: true, refetchOnMountOrArgChange: true }
  );
  const { data: studentStats } = useGetStudentStatsQuery(
    currentAcademicYear ? { academic_year: currentAcademicYear } : undefined
  );

  // ── Document Queue & Verification State ──
  const {
    data: docQueueData,
    isFetching: isFetchingDocs,
    refetch: refetchDocQueue,
  } = useGetSchoolDocumentsQueueQuery();

  const [verifyStudentDocMutation] = useVerifyStudentDocumentMutation();
  const [verifyTeacherDocMutation] = useVerifyTeacherDocumentMutation();

  const [docFilterTab, setDocFilterTab] = useState<'pending' | 'all' | 'student' | 'teacher' | 'verified'>('pending');
  const [docSearchQuery, setDocSearchQuery] = useState('');
  const [actionInProgressId, setActionInProgressId] = useState<string | null>(null);

  interface DashboardDocPreviewState {
    doc: SchoolDocumentItem;
    url: string;
    isPdf: boolean;
    scale: number;
    rotation: number;
  }
  const [previewDoc, setPreviewDoc] = useState<DashboardDocPreviewState | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const [rejectingDoc, setRejectingDoc] = useState<SchoolDocumentItem | null>(null);
  const [rejectRemarks, setRejectRemarks] = useState('');

  const handleVerifyDoc = async (doc: SchoolDocumentItem) => {
    setActionInProgressId(`${doc.docType}-${doc.id}`);
    try {
      if (doc.docType === 'student' && doc.studentId) {
        await verifyStudentDocMutation({
          studentId: String(doc.studentId),
          docId: doc.id,
          status: 'Verified',
          remarks: 'Verified & Approved by School Administration',
        }).unwrap();
      } else if (doc.docType === 'teacher' && doc.teacherId) {
        await verifyTeacherDocMutation({
          teacherId: doc.teacherId,
          docId: doc.id,
          status: 'Verified',
          remarks: 'Verified & Approved by School Administration',
        }).unwrap();
      }
      refetchDocQueue();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to verify document.');
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleOpenReject = (doc: SchoolDocumentItem) => {
    setRejectingDoc(doc);
    setRejectRemarks(doc.remarks || 'Document copy is blurry or incomplete. Please re-upload a clear copy showing both sides.');
  };

  const handleConfirmReject = async () => {
    if (!rejectingDoc) return;
    const doc = rejectingDoc;
    setActionInProgressId(`${doc.docType}-${doc.id}`);
    try {
      if (doc.docType === 'student' && doc.studentId) {
        await verifyStudentDocMutation({
          studentId: String(doc.studentId),
          docId: doc.id,
          status: 'Rejected',
          remarks: rejectRemarks.trim() || 'Document rejected by school administration.',
        }).unwrap();
      } else if (doc.docType === 'teacher' && doc.teacherId) {
        await verifyTeacherDocMutation({
          teacherId: doc.teacherId,
          docId: doc.id,
          status: 'Rejected',
          remarks: rejectRemarks.trim() || 'Document rejected by school administration.',
        }).unwrap();
      }
      setRejectingDoc(null);
      setRejectRemarks('');
      refetchDocQueue();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reject document.');
    } finally {
      setActionInProgressId(null);
    }
  };

  const handlePreviewDoc = async (doc: SchoolDocumentItem) => {
    if (!doc.downloadUrl) {
      alert('This document does not have a preview URL available.');
      return;
    }
    setPreviewLoadingId(doc.id);
    try {
      const previewUrl = doc.downloadUrl + (doc.downloadUrl.includes('?') ? '&view=1' : '?view=1');
      const { blob, filename, contentType } = await apiDownload(previewUrl);
      const isPdf = contentType.includes('pdf') || (doc.fileType || '').toUpperCase() === 'PDF' || (doc.fileName || '').toLowerCase().endsWith('.pdf');
      const url = URL.createObjectURL(blob);
      setPreviewDoc((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return {
          doc: {
            ...doc,
            fileName: filename || doc.fileName,
          },
          url,
          isPdf,
          scale: 1,
          rotation: 0,
        };
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to load document for preview.');
    } finally {
      setPreviewLoadingId(null);
    }
  };

  const handleDownloadDoc = async (doc: SchoolDocumentItem) => {
    if (!doc.downloadUrl) return;
    setDownloadingId(doc.id);
    try {
      const { blob, filename, contentType } = await apiDownload(doc.downloadUrl);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      let finalName = filename;
      if (!finalName || finalName === 'document' || !finalName.includes('.')) {
        if (doc.fileName && doc.fileName.includes('.')) {
          finalName = doc.fileName;
        } else {
          const ext = contentType.includes('pdf') ? 'pdf' : contentType.includes('png') ? 'png' : (contentType.includes('jpeg') || contentType.includes('jpg')) ? 'jpg' : (doc.fileType || 'pdf').toLowerCase();
          finalName = `${doc.fileName || doc.name || 'document'}.${ext}`;
        }
      }
      a.download = finalName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not download document. Please try again.');
    } finally {
      setDownloadingId(null);
    }
  };

  const closeDocPreview = () => {
    if (previewDoc?.url) {
      URL.revokeObjectURL(previewDoc.url);
    }
    setPreviewDoc(null);
  };

  const zoomIn = () => setPreviewDoc((prev) => (prev ? { ...prev, scale: Math.min(3, +(prev.scale + 0.25).toFixed(2)) } : null));
  const zoomOut = () => setPreviewDoc((prev) => (prev ? { ...prev, scale: Math.max(0.5, +(prev.scale - 0.25).toFixed(2)) } : null));
  const resetZoom = () => setPreviewDoc((prev) => (prev ? { ...prev, scale: 1, rotation: 0 } : null));
  const rotateDoc = () => setPreviewDoc((prev) => (prev ? { ...prev, rotation: (prev.rotation + 90) % 360 } : null));

  const docSummary = docQueueData?.summary || {
    totalDocs: 0,
    totalPending: 0,
    totalVerified: 0,
    totalRejected: 0,
    totalStudentDocs: 0,
    totalTeacherDocs: 0,
  };

  const filteredDocuments = useMemo(() => {
    const list = docQueueData?.documents || [];
    return list.filter((doc) => {
      if (docFilterTab === 'pending' && doc.status !== 'Pending') return false;
      if (docFilterTab === 'verified' && doc.status !== 'Verified') return false;
      if (docFilterTab === 'student' && doc.docType !== 'student') return false;
      if (docFilterTab === 'teacher' && doc.docType !== 'teacher') return false;

      if (docSearchQuery.trim()) {
        const q = docSearchQuery.toLowerCase();
        const personName = (doc.studentName || doc.teacherName || '').toLowerCase();
        const docName = (doc.name || '').toLowerCase();
        const cat = (doc.category || '').toLowerCase();
        const cls = (doc.className || '').toLowerCase();
        const file = (doc.fileName || '').toLowerCase();
        return personName.includes(q) || docName.includes(q) || cat.includes(q) || cls.includes(q) || file.includes(q);
      }
      return true;
    });
  }, [docQueueData, docFilterTab, docSearchQuery]);

  const teachersList = useMemo(() => Array.isArray(teachersData) ? teachersData : (teachersData as any).results || [], [teachersData]);
  const activeTeachers = useMemo(() => teachersList.filter((t: any) => t.status === 'Active' || !t.status), [teachersList]);
  const activeTeachersCount = teacherStats?.activeTeachers ?? activeTeachers.length;

  if (role === 'Teacher' || role === 'Student' || role === 'Parent') {
    return <RoleDashboard role={role} userName={userName} onNavigateToTab={onNavigateToTab} isGlass={isGlass} />;
  }

  const activeStudents   = useMemo(() => students.filter((s) => s.status === 'Active'),   [students]);
  const promotedStudents = useMemo(() => students.filter((s) => s.status === 'Promoted'), [students]);
  const authoritativeStudentCount = studentStats?.totalStudents ?? students.length;
  const activeStudentsCount   = studentStats?.activeStudents ?? studentStats?.totalStudents ?? activeStudents.length;
  const promotedStudentsCount = studentStats?.promotedStudents ?? promotedStudents.length;

  const fallbackFeeTotal = useMemo(() => activeStudents.reduce((sum, s) => sum + (asAmount(s.feeTotal) ?? 0), 0), [activeStudents]);
  const fallbackFeePaid  = useMemo(() => activeStudents.reduce((sum, s) => sum + (asAmount(s.feePaid)  ?? 0), 0), [activeStudents]);

  const totalRevenue       = revenueData?.totalRevenue       ?? fallbackFeePaid;
  const totalInvoiced      = revenueData?.totalInvoiced      ?? fallbackFeeTotal;
  const pendingReceivables = revenueData?.pendingReceivables ?? Math.max(0, fallbackFeeTotal - fallbackFeePaid);
  const collectionRate     = revenueData?.collectionRate     ?? (totalInvoiced > 0 ? Math.round((totalRevenue / totalInvoiced) * 100) : 0);

  const chartValues = useMemo(() => {
    if (revenueData?.monthlyDistribution && revenueData.monthlyDistribution.length > 0) {
      return revenueData.monthlyDistribution.slice(0, 8);
    }
    return months.map((month, i) => ({ month, amount: i === months.length - 1 ? totalRevenue : 0 }));
  }, [revenueData, totalRevenue]);

  const maxMonthlyAmount = useMemo(() => Math.max(...chartValues.map((v) => v.amount), 1), [chartValues]);

  const studentTeacherRatio = useMemo(() => {
    if (activeTeachersCount === 0) return `${activeStudentsCount}:0`;
    return `${Math.round(activeStudentsCount / activeTeachersCount)}:1`;
  }, [activeStudentsCount, activeTeachersCount]);

  const adminName        = userName.trim() || 'Admin';
  const displayAdminName = adminName.toLocaleLowerCase() === schoolName.trim().toLocaleLowerCase() ? 'School Admin' : adminName;

  const metrics = [
    { label: 'Active Students',   value: activeStudentsCount.toLocaleString('en-IN'),                                          note: `${authoritativeStudentCount.toLocaleString('en-IN')} total on record (${promotedStudentsCount.toLocaleString('en-IN')} promot...`, icon: Users,        tab: 'student'        },
    { label: 'Teaching Faculty',  value: `${activeTeachersCount} Teachers`,                                                     note: `${studentTeacherRatio} Student-Teacher ratio`,                                                                                     icon: UserCheck,    tab: 'teachers'       },
    { label: 'Revenue Collected', value: `\u20b9${totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,         note: totalInvoiced ? `${collectionRate}% of \u20b9${totalInvoiced.toLocaleString('en-IN')} billed` : 'No fee dues billed',               icon: CreditCard,   tab: 'fees'           },
    { label: 'Academic Classes',  value: `${classesData.length} Classes`,                                                       note: `${sectionsData.length} active class sections`,                                                                                     icon: GraduationCap,tab: 'academic-setup' },
  ];

  const avatarColors = [
    'bg-indigo-100 text-indigo-700',
    'bg-emerald-100 text-emerald-700',
    'bg-amber-100 text-amber-700',
    'bg-violet-100 text-violet-700',
    'bg-rose-100 text-rose-700',
    'bg-cyan-100 text-cyan-700',
  ];

  return (
    <section className="space-y-4 animate-fade-in" id="dashboard-module">

      {/* ═══════════════════════════════════════════
          HERO WELCOME HEADER
      ═══════════════════════════════════════════ */}
      <div className="relative overflow-hidden rounded-2xl bg-white border border-slate-200 shadow-sm" style={{minHeight: '160px'}}>

        {/* Right-side gradient wash — lavender/indigo tint */}
        <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-[55%]"
          style={{background: 'linear-gradient(to left, #e8eaf6 0%, #eef0fb 30%, transparent 100%)'}}>
        </div>
        <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-[40%]"
          style={{background: 'linear-gradient(to left, #dde3f8 0%, transparent 100%)'}}>
        </div>

        {/* ── Left Content ── */}
        <div className="relative z-10 px-7 py-6">
          {/* School tag */}
          <div className="flex items-center gap-2.5 mb-1.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-xs">
              <School className="w-4.5 h-4.5 w-[18px] h-[18px]" />
            </div>
            <span className="text-[11px] font-extrabold text-slate-500 uppercase tracking-widest">{schoolName}</span>
          </div>

          {/* Welcome heading */}
          <h1 className="text-[28px] sm:text-[34px] font-black text-slate-900 tracking-tight leading-tight mb-0">
            Welcome back, {displayAdminName}
          </h1>

          {/* Quick Actions */}
          <div className="mt-4 pt-3.5 border-t border-slate-100 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Quick Actions:</span>
            {/* Primary CTA */}
            <button type="button" onClick={() => onNavigateToTab('student')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold px-4 py-2 shadow shadow-indigo-200 transition-all duration-150 hover:shadow-md hover:shadow-indigo-200">
              <Plus className="w-3.5 h-3.5" /> Enroll Student
            </button>
            {([
              { label: 'Collect Fee',     icon: CreditCard,    tab: 'fees'           },
              { label: 'Take Attendance', icon: CheckSquare,   tab: 'attendance'     },
              { label: 'Staff Directory', icon: UserCheck,     tab: 'teachers'       },
              { label: 'Academic Setup',  icon: GraduationCap, tab: 'academic-setup' },
              { label: 'Class Homework',  icon: BookOpen,      tab: 'homework'       },
            ] as const).map(({ label, icon: Icon, tab }) => (
              <button key={tab} type="button" onClick={() => onNavigateToTab(tab)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 hover:border-indigo-300 text-slate-600 hover:text-indigo-700 text-[11px] font-semibold px-3.5 py-[7px] shadow-xs transition-all duration-150">
                <Icon className="w-3.5 h-3.5 text-indigo-500" /> {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════
          KPI METRIC CARDS
      ═══════════════════════════════════════════ */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, value, note, icon: Icon, tab }, i) => {
          const a = metricAccents[i];
          return (
            <motion.button key={label}
              whileHover={{ y: -2, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}
              whileTap={{ scale: 0.99 }}
              transition={{ duration: 0.13 }}
              onClick={() => onNavigateToTab(tab)}
              className={`group cursor-pointer text-left select-none block w-full p-5 rounded-2xl bg-white border border-l-4 border-slate-200 ${a.leftBorder} shadow-sm ${a.cardHover} transition-all duration-200`}>

              <div className="flex items-start justify-between gap-3 mb-2.5">
                <p className={`text-[10px] font-black uppercase tracking-widest ${a.label}`}>{label}</p>
                <div className={`w-9 h-9 rounded-xl ${a.iconBg} ${a.iconText} ${a.hoverBg} group-hover:text-white flex items-center justify-center transition-all duration-200 shrink-0`}>
                  <Icon className="w-[18px] h-[18px]" />
                </div>
              </div>

              <p className="text-[28px] font-black text-slate-900 tracking-tight leading-none">{value}</p>

              <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px]">
                <span className="text-slate-500 font-medium truncate max-w-[160px]">{note}</span>
                <ArrowUpRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 transition-colors shrink-0" />
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* ═══════════════════════════════════════════
          REVENUE & FACULTY PANELS
      ═══════════════════════════════════════════ */}
      <div className="grid gap-4 lg:grid-cols-2">

        {/* ── REVENUE & FEE COLLECTIONS ── */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 flex flex-col justify-between">
          <div>
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-600">
                    <Wallet className="h-4 w-4" />
                  </span>
                  <span className="text-[15px] font-extrabold text-slate-900">Revenue &amp; Fee Collections</span>
                  <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-extrabold text-emerald-700 border border-emerald-200">
                    <span className={`h-1.5 w-1.5 rounded-full ${isRevenueFetching ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`} />
                    {isRevenueFetching ? 'Syncing' : 'Live DB'}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">Authoritative PostgreSQL revenue, invoices, and payment receipts.</p>
              </div>
              <button onClick={() => onNavigateToTab('fees')}
                className="inline-flex items-center gap-1 rounded-xl bg-white hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 text-slate-700 hover:text-indigo-700 text-[11px] font-semibold px-3 py-1.5 transition-all duration-150 shrink-0">
                Fee Ledger <ArrowUpRight className="h-3.5 w-3.5 text-indigo-500" />
              </button>
            </div>

            {/* Financial highlights */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Total Revenue Made</p>
                <p className="mt-1 text-[22px] font-black text-slate-900 tracking-tight leading-none">
                  {'\u20b9'}{totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </p>
                <div className="flex items-center gap-1.5 mt-2">
                  <ArrowUpRight className="h-3 w-3 text-emerald-600" />
                  <span className="text-[10px] font-bold text-emerald-700">{collectionRate}% Collected</span>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Pending Receivables</p>
                <p className="mt-1 text-[22px] font-black text-slate-900 tracking-tight leading-none">
                  {'\u20b9'}{pendingReceivables.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </p>
                <p className="text-[10px] font-medium text-slate-500 mt-2">from {'\u20b9'}{totalInvoiced.toLocaleString('en-IN')} total</p>
              </div>
            </div>

            {/* Bar chart */}
            <div className="mt-5">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Monthly Receipts Momentum (PostgreSQL Records)</span>
                {revenueData?.lastUpdated && (
                  <span className="text-[9px] font-mono flex items-center gap-1 text-slate-400">
                    <Clock className="h-3 w-3" /> Real-time
                  </span>
                )}
              </div>
              <div className="flex h-32 items-end gap-1.5 border-b border-slate-200/70 pb-px">
                {chartValues.map((item) => {
                  const ph  = maxMonthlyAmount > 0 && item.amount > 0 ? Math.max(14, Math.round((item.amount / maxMonthlyAmount) * 85)) : 6;
                  const has = item.amount > 0;
                  return (
                    <div className="group flex h-full flex-1 flex-col justify-end" key={item.month}>
                      <div className="relative flex flex-1 items-end justify-center">
                        <span className="pointer-events-none absolute -top-2 hidden -translate-y-full rounded-md px-2 py-1 text-[10px] font-bold bg-slate-800 text-white group-hover:block z-10 shadow-lg font-mono whitespace-nowrap">
                          {'\u20b9'}{item.amount.toLocaleString('en-IN')}
                        </span>
                        <div style={{ height: `${ph}%` }}
                          className={`w-full max-w-7 rounded-t-md transition-all duration-200 ${has ? 'bg-indigo-400 group-hover:bg-indigo-500' : 'bg-slate-100'}`} />
                      </div>
                      <span className={`pt-1.5 text-center text-[9px] font-bold ${has ? 'text-indigo-600' : 'text-slate-400'}`}>{item.month}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Total Invoiced: <strong className="text-slate-900">{'\u20b9'}{totalInvoiced.toLocaleString('en-IN')}</strong></span>
            <span>Fee Health: <strong className="text-emerald-600">{collectionRate >= 80 ? 'Excellent' : collectionRate >= 50 ? 'Moderate' : 'Active Cycle'}</strong></span>
          </div>
        </div>

        {/* ── TEACHING FACULTY & STAFF ── */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 flex flex-col justify-between">
          <div>
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600">
                    <UserCheck className="h-4 w-4" />
                  </span>
                  <span className="text-[15px] font-extrabold text-slate-900">Teaching Faculty &amp; Staff</span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {activeTeachers.length} active faculty members {'\u00b7'} {studentTeacherRatio} Student-to-Teacher ratio.
                </p>
              </div>
              <button onClick={() => onNavigateToTab('teachers')}
                className="inline-flex items-center gap-1 rounded-xl bg-white hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 text-slate-700 hover:text-indigo-700 text-[11px] font-semibold px-3 py-1.5 transition-all duration-150 shrink-0">
                Teacher Directory <ArrowUpRight className="h-3.5 w-3.5 text-indigo-500" />
              </button>
            </div>

            {/* Teachers grid */}
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[240px] overflow-y-auto pr-0.5">
              {teachersList.length > 0 ? (
                teachersList.slice(0, 6).map((teacher: any) => {
                  const subjectCount  = Array.isArray(teacher.subjects) ? teacher.subjects.length : 0;
                  const rawName       = teacher.name || 'Teacher';
                  const formattedName = rawName.trim().split(/\s+/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
                  const colorClass    = avatarColors[(teacher.id ?? 0) % avatarColors.length];
                  return (
                    <div key={teacher.id}
                      className="rounded-xl border border-slate-100 bg-slate-50 hover:bg-indigo-50/40 hover:border-indigo-100 p-3 flex items-center justify-between gap-2.5 transition-colors duration-150">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-black ${colorClass}`}>
                          {formattedName.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-black text-slate-900 leading-tight">{formattedName}</p>
                          <p className="truncate text-[10px] font-medium text-slate-500">{teacher.qualification || 'Faculty Member'}</p>
                        </div>
                      </div>
                      <span className="rounded-lg border border-slate-200 bg-white text-slate-600 px-2 py-0.5 text-[9px] font-bold shrink-0">
                        {subjectCount} {subjectCount === 1 ? 'subj' : 'subjs'}
                      </span>
                    </div>
                  );
                })
              ) : (
                <div className="sm:col-span-2 p-8 text-center rounded-2xl border border-dashed border-slate-200 text-[11px] text-slate-400">
                  No teachers recorded yet. Click Teacher Directory to add faculty.
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Total Faculty: <strong className="text-slate-900">{teachersList.length} Teachers</strong></span>
            <button onClick={() => onNavigateToTab('academic')}
              className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer transition-colors">
              View Schedules &amp; Timetables {'\u2192'}
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════
          DOCUMENTS & IDENTITY VERIFICATION HUB
      ═══════════════════════════════════════════ */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden" id="admin-document-verification-hub">
        {/* Hub Header */}
        <div className="p-6 border-b border-slate-100 bg-linear-to-r from-slate-50/70 via-indigo-50/20 to-white">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-indigo-600 text-white shadow-md shadow-indigo-100">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-black text-slate-900">
                    Documents &amp; Identity Verification Hub
                  </h3>
                  {docSummary.totalPending > 0 ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-extrabold text-amber-800">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                      </span>
                      {docSummary.totalPending} Pending Approval
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-extrabold text-emerald-800">
                      <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                      All Verified
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  Authoritative student and faculty identity proofs, certificates, and official documents awaiting review.
                </p>
              </div>
            </div>

            {/* Actions & Refresh */}
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => refetchDocQueue()}
                disabled={isFetchingDocs}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors disabled:opacity-50"
                title="Refresh Documents"
              >
                <RefreshCw className={`h-3.5 w-3.5 text-indigo-600 ${isFetchingDocs ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigateToTab('student')}
                className="inline-flex items-center gap-1 rounded-xl bg-indigo-50 border border-indigo-100 hover:bg-indigo-100/70 text-indigo-700 px-3 py-1.5 text-xs font-bold transition-colors"
              >
                Students <ArrowUpRight className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => onNavigateToTab('teachers')}
                className="inline-flex items-center gap-1 rounded-xl bg-indigo-50 border border-indigo-100 hover:bg-indigo-100/70 text-indigo-700 px-3 py-1.5 text-xs font-bold transition-colors"
              >
                Teachers <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* Quick Metrics Strip */}
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-3">
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-700">Awaiting Verification</span>
              <p className="text-xl font-black text-amber-950 mt-0.5">{docSummary.totalPending}</p>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Verified &amp; Approved</span>
              <p className="text-xl font-black text-emerald-950 mt-0.5">{docSummary.totalVerified}</p>
            </div>
            <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3">
              <span className="text-[10px] font-black uppercase tracking-wider text-blue-700">Student Documents</span>
              <p className="text-xl font-black text-blue-950 mt-0.5">{docSummary.totalStudentDocs}</p>
            </div>
            <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-3">
              <span className="text-[10px] font-black uppercase tracking-wider text-violet-700">Teacher Documents</span>
              <p className="text-xl font-black text-violet-950 mt-0.5">{docSummary.totalTeacherDocs}</p>
            </div>
          </div>
        </div>

        {/* Filters and Search Bar */}
        <div className="px-6 py-3 border-b border-slate-100 bg-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          {/* Tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'pending', label: 'Needs Verification', count: docSummary.totalPending },
              { id: 'all', label: 'All Records', count: docSummary.totalDocs },
              { id: 'student', label: 'Students', count: docSummary.totalStudentDocs },
              { id: 'teacher', label: 'Teachers', count: docSummary.totalTeacherDocs },
              { id: 'verified', label: 'Verified', count: docSummary.totalVerified },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setDocFilterTab(tab.id as any)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                  docFilterTab === tab.id
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`rounded-full px-1.5 py-0.2 text-[10px] font-mono ${
                  docFilterTab === tab.id
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-200 text-slate-700'
                }`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={docSearchQuery}
              onChange={(e) => setDocSearchQuery(e.target.value)}
              placeholder="Search by name, doc, or roll..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-8 pr-3 py-1.5 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none transition-colors"
            />
            {docSearchQuery && (
              <button
                onClick={() => setDocSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Documents Table / Card List */}
        <div className="p-6">
          {filteredDocuments.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 mx-auto mb-3">
                <FileCheck className="h-6 w-6" />
              </div>
              <h4 className="text-sm font-extrabold text-slate-800">
                {docFilterTab === 'pending'
                  ? 'No Documents Pending Verification'
                  : 'No Matching Documents Found'}
              </h4>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                {docFilterTab === 'pending'
                  ? 'All student and teacher documents uploaded to the school portal have been verified.'
                  : 'Try clearing your search query or switching to another filter tab.'}
              </p>
              {docSearchQuery && (
                <button
                  onClick={() => setDocSearchQuery('')}
                  className="mt-3 text-xs font-bold text-indigo-600 hover:underline"
                >
                  Clear search query
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredDocuments.map((doc) => {
                const isStudent = doc.docType === 'student';
                const personName = isStudent ? (doc.studentName || 'Student') : (doc.teacherName || 'Teacher');
                const isPending = doc.status === 'Pending';
                const isVerified = doc.status === 'Verified';
                const isRejected = doc.status === 'Rejected';
                const isActionBusy = actionInProgressId === `${doc.docType}-${doc.id}`;

                return (
                  <div
                    key={`${doc.docType}-${doc.id}`}
                    className={`rounded-2xl border p-4 transition-all ${
                      isPending
                        ? 'border-amber-200/80 bg-amber-50/20 hover:border-amber-300'
                        : isRejected
                        ? 'border-rose-200/80 bg-rose-50/20 hover:border-rose-300'
                        : 'border-slate-200 bg-white hover:border-indigo-200'
                    }`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      {/* Left Person & Document Info */}
                      <div className="flex items-start gap-3.5">
                        {/* Person Avatar */}
                        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-sm font-black shadow-xs ${
                          isStudent
                            ? 'bg-blue-100 text-blue-700 border border-blue-200/60'
                            : 'bg-violet-100 text-violet-700 border border-violet-200/60'
                        }`}>
                          {personName.charAt(0).toUpperCase()}
                        </div>

                        <div>
                          {/* Person Name & Role Badge */}
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-sm font-black text-slate-900">
                              {personName}
                            </h4>
                            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                              isStudent
                                ? 'bg-blue-50 text-blue-700 border border-blue-200/70'
                                : 'bg-violet-50 text-violet-700 border border-violet-200/70'
                            }`}>
                              {isStudent
                                ? `Student · ${doc.className || 'SIS'}${doc.sectionName ? ` (${doc.sectionName})` : ''}`
                                : `Faculty · ${doc.qualification || 'Teaching Staff'}`}
                            </span>
                            {doc.admissionNo && (
                              <span className="font-mono text-[9px] text-slate-400">
                                #{doc.admissionNo}
                              </span>
                            )}
                          </div>

                          {/* Document Name & Format */}
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-slate-800">
                              {doc.name}
                            </span>
                            <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.2 text-[9px] font-mono font-bold text-slate-600 uppercase">
                              {doc.fileType || 'PDF'}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.2 text-[9px] font-medium text-slate-600">
                              {doc.category || 'Identity Proof'}
                            </span>
                          </div>

                          {/* Upload metadata */}
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-slate-400 font-medium">
                            {doc.fileName && (
                              <span className="truncate max-w-[200px] font-mono">
                                {doc.fileName}
                              </span>
                            )}
                            {doc.uploadedAt && (
                              <span>
                                Uploaded {new Date(doc.uploadedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                              </span>
                            )}
                            {doc.verifiedByName && (
                              <span className="text-emerald-700 font-semibold">
                                · Verified by {doc.verifiedByName}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right Status & Action Buttons */}
                      <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto shrink-0">
                        {/* Status Badge */}
                        {isVerified ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-extrabold text-emerald-800">
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                            Verified
                          </span>
                        ) : isRejected ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10px] font-extrabold text-rose-800">
                            <AlertCircle className="h-3 w-3 text-rose-600" />
                            Needs Attention
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-extrabold text-amber-800">
                            <Clock className="h-3 w-3 text-amber-600" />
                            Awaiting Approval
                          </span>
                        )}

                        {/* View Preview Button */}
                        <button
                          type="button"
                          onClick={() => handlePreviewDoc(doc)}
                          disabled={previewLoadingId === doc.id}
                          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
                          title="View Document Preview"
                        >
                          <Eye className="h-3.5 w-3.5 text-indigo-600" />
                          <span>{previewLoadingId === doc.id ? 'Loading...' : 'View'}</span>
                        </button>

                        {/* Download Button */}
                        <button
                          type="button"
                          onClick={() => handleDownloadDoc(doc)}
                          disabled={downloadingId === doc.id}
                          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
                          title="Download File"
                        >
                          <Download className="h-3.5 w-3.5 text-slate-500" />
                          <span>{downloadingId === doc.id ? '...' : 'Download'}</span>
                        </button>

                        {/* Approve Button */}
                        {!isVerified && (
                          <button
                            type="button"
                            onClick={() => handleVerifyDoc(doc)}
                            disabled={isActionBusy}
                            className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 text-xs font-extrabold shadow-xs shadow-emerald-200 transition-colors disabled:opacity-50"
                            title="Verify and Approve Document"
                          >
                            <Check className="h-3.5 w-3.5" />
                            <span>{isActionBusy ? 'Updating...' : 'Approve'}</span>
                          </button>
                        )}

                        {/* Reject Button */}
                        {!isRejected && (
                          <button
                            type="button"
                            onClick={() => handleOpenReject(doc)}
                            disabled={isActionBusy}
                            className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 px-2.5 py-1 text-xs font-bold transition-colors disabled:opacity-50"
                            title="Reject with Remarks"
                          >
                            <X className="h-3.5 w-3.5" />
                            <span>Reject</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Remarks banner if rejected */}
                    {isRejected && (
                      <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50/70 p-2.5 text-xs text-rose-800 flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
                        <div>
                          <span className="font-bold">Administrator Rejection Reason: </span>
                          <span>{doc.remarks || 'Document was rejected. Please upload a clearer version.'}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════
          INTERACTIVE DOCUMENT PREVIEW MODAL
      ═══════════════════════════════════════════ */}
      {previewDoc && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-950/70 backdrop-blur-sm flex min-h-full items-center justify-center p-3 sm:p-5 animate-fade-in" role="presentation">
          <div className="relative my-auto flex h-[88vh] w-full max-w-5xl flex-col rounded-3xl bg-white shadow-2xl overflow-hidden border border-slate-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-600 text-white">
                  {previewDoc.isPdf ? <FileText className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-black text-slate-900">
                      {previewDoc.doc.name}
                    </h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        previewDoc.doc.status === 'Verified'
                          ? 'bg-emerald-100 text-emerald-800'
                          : previewDoc.doc.status === 'Rejected'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {previewDoc.doc.status || 'Pending'}
                    </span>
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700 capitalize">
                      {previewDoc.doc.docType}
                    </span>
                  </div>
                  <p className="text-[11px] font-mono text-slate-400">
                    {previewDoc.doc.studentName || previewDoc.doc.teacherName} · {previewDoc.doc.fileName || 'document'} · {previewDoc.doc.category || 'Identity Proof'}
                  </p>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-2">
                <button
                  onClick={zoomOut}
                  className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 transition-colors"
                  title="Zoom Out"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <button
                  onClick={resetZoom}
                  className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                  title="Reset Zoom"
                >
                  {Math.round(previewDoc.scale * 100)}%
                </button>
                <button
                  onClick={zoomIn}
                  className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 transition-colors"
                  title="Zoom In"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
                <button
                  onClick={rotateDoc}
                  className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 transition-colors"
                  title="Rotate 90°"
                >
                  <RotateCw className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDownloadDoc(previewDoc.doc)}
                  className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 transition-colors"
                  title="Download File"
                >
                  <Download className="h-4 w-4" />
                </button>
                <a
                  href={previewDoc.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 transition-colors"
                  title="Open in new window"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
                <button
                  onClick={closeDocPreview}
                  className="rounded-xl bg-slate-200 p-2 text-slate-700 hover:bg-slate-300 transition-colors ml-2"
                  title="Close Preview"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-auto bg-slate-900/90 p-4 flex items-center justify-center">
              {previewDoc.isPdf ? (
                <iframe
                  src={previewDoc.url}
                  title={previewDoc.doc.name}
                  className="h-full w-full rounded-2xl bg-white shadow-lg border-0"
                />
              ) : (
                <div className="overflow-auto max-h-full max-w-full flex items-center justify-center">
                  <img
                    src={previewDoc.url}
                    alt={previewDoc.doc.name}
                    style={{
                      transform: `scale(${previewDoc.scale}) rotate(${previewDoc.rotation}deg)`,
                      transition: 'transform 0.15s ease-out',
                    }}
                    className="max-h-[75vh] max-w-full rounded-xl object-contain shadow-2xl"
                  />
                </div>
              )}
            </div>

            {/* Modal Footer with Direct Verification */}
            <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3 bg-slate-50 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <span>Applicant/Staff: <strong className="text-slate-800">{previewDoc.doc.studentName || previewDoc.doc.teacherName}</strong></span>
                <span>· Category: <strong className="text-slate-800">{previewDoc.doc.category || 'Identity'}</strong></span>
                {previewDoc.doc.verifiedAt && (
                  <span className="text-emerald-700">· Verified on {new Date(previewDoc.doc.verifiedAt).toLocaleDateString()}</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {previewDoc.doc.status !== 'Verified' && (
                  <button
                    onClick={async () => {
                      await handleVerifyDoc(previewDoc.doc);
                      setPreviewDoc((prev) => prev ? { ...prev, doc: { ...prev.doc, status: 'Verified' } } : null);
                    }}
                    className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-1.5 text-xs font-bold transition-colors inline-flex items-center gap-1"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Approve Document
                  </button>
                )}
                {previewDoc.doc.status !== 'Rejected' && (
                  <button
                    onClick={() => {
                      const doc = previewDoc.doc;
                      closeDocPreview();
                      handleOpenReject(doc);
                    }}
                    className="rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 px-3.5 py-1.5 text-xs font-bold transition-colors inline-flex items-center gap-1"
                  >
                    <X className="h-3.5 w-3.5" />
                    Reject Document
                  </button>
                )}
                <button
                  onClick={closeDocPreview}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ═══════════════════════════════════════════
          REJECTION REMARKS MODAL
      ═══════════════════════════════════════════ */}
      {rejectingDoc && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-950/70 backdrop-blur-sm flex min-h-full items-center justify-center p-4 animate-fade-in" role="presentation">
          <div className="relative my-auto w-full max-w-lg rounded-3xl bg-white shadow-2xl overflow-hidden border border-slate-200 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-rose-100 text-rose-600">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-black text-slate-900">
                  Reject Document Verification
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Specify feedback for <strong className="text-slate-800">{rejectingDoc.studentName || rejectingDoc.teacherName}</strong> regarding <strong className="text-slate-800">{rejectingDoc.name}</strong>.
                </p>
              </div>
              <button
                onClick={() => setRejectingDoc(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Quick remark presets */}
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1.5">
                Quick Feedback Presets
              </label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  'Document copy is blurry or unreadable.',
                  'Missing back side of identity card.',
                  'Document name does not match official record.',
                  'Expired certificate or invalid document.',
                ].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setRejectRemarks(preset)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800 transition-colors"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1.5">
                Administrator Remarks / Rejection Reason
              </label>
              <textarea
                value={rejectRemarks}
                onChange={(e) => setRejectRemarks(e.target.value)}
                rows={3}
                placeholder="Enter detailed reason for rejection so the user knows what to correct..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-rose-500 focus:bg-white focus:outline-none transition-colors"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setRejectingDoc(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReject}
                className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 text-xs font-bold transition-colors shadow-xs shadow-rose-200"
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
}
