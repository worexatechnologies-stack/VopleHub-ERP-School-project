import {
  ArrowUpRight,
  CalendarDays,
  CreditCard,
  GraduationCap,
  UserCheck,
  Users,
  Wallet,
  Clock,
  Plus,
  CheckSquare,
  School,
  ShieldCheck,
  BookOpen,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import type { Student, UserRole } from '../types';
import RoleDashboard from './RoleDashboard';
import { useGetTeachersQuery, useGetTeacherStatsQuery } from '../store/api/teacherApi';
import { useGetClassesQuery, useGetSectionsQuery } from '../store/api/academicApi';
import { useGetSchoolRevenueQuery } from '../store/api/financeApi';
import { useGetStudentStatsQuery } from '../store/api/studentApi';

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

  // Fetch real teachers, classes, and sections from PostgreSQL API
  const { data: teachersData = [] } = useGetTeachersQuery();
  const { data: teacherStats } = useGetTeacherStatsQuery();
  const { data: classesData = [] } = useGetClassesQuery();
  const { data: sectionsData = [] } = useGetSectionsQuery();

  // Fetch authoritative, real-time school revenue from PostgreSQL database
  const { data: revenueData, isFetching: isRevenueFetching } = useGetSchoolRevenueQuery(
    currentAcademicYear ? { academicYear: currentAcademicYear } : undefined,
    {
      refetchOnFocus: true,
      refetchOnReconnect: true,
      refetchOnMountOrArgChange: true,
    }
  );

  const { data: studentStats } = useGetStudentStatsQuery(
    currentAcademicYear ? { academic_year: currentAcademicYear } : undefined
  );

  const teachersList = useMemo(() => {
    return Array.isArray(teachersData) ? teachersData : (teachersData as any).results || [];
  }, [teachersData]);

  const activeTeachers = useMemo(() => {
    return teachersList.filter((t: any) => t.status === 'Active' || !t.status);
  }, [teachersList]);

  const activeTeachersCount = teacherStats?.activeTeachers ?? activeTeachers.length;

  if (role === 'Teacher' || role === 'Student' || role === 'Parent') {
    return <RoleDashboard role={role} userName={userName} onNavigateToTab={onNavigateToTab} isGlass={isGlass} />;
  }

  // Student metrics
  const activeStudents = useMemo(() => students.filter((student) => student.status === 'Active'), [students]);
  const promotedStudents = useMemo(() => students.filter((student) => student.status === 'Promoted'), [students]);
  const authoritativeStudentCount = studentStats?.totalStudents ?? students.length;
  const activeStudentsCount = studentStats?.activeStudents ?? studentStats?.totalStudents ?? activeStudents.length;
  const promotedStudentsCount = studentStats?.promotedStudents ?? promotedStudents.length;

  // Fallback revenue calculations from students prop while hydrating
  const fallbackFeeTotal = useMemo(() => {
    return activeStudents.reduce((sum, student) => sum + (asAmount(student.feeTotal) ?? 0), 0);
  }, [activeStudents]);

  const fallbackFeePaid = useMemo(() => {
    return activeStudents.reduce((sum, student) => sum + (asAmount(student.feePaid) ?? 0), 0);
  }, [activeStudents]);

  // Authoritative database values
  const totalRevenue = revenueData?.totalRevenue ?? fallbackFeePaid;
  const totalInvoiced = revenueData?.totalInvoiced ?? fallbackFeeTotal;
  const pendingReceivables = revenueData?.pendingReceivables ?? Math.max(0, fallbackFeeTotal - fallbackFeePaid);
  const collectionRate = revenueData?.collectionRate ?? (totalInvoiced > 0 ? Math.round((totalRevenue / totalInvoiced) * 100) : 0);

  // Monthly revenue collection distribution from PostgreSQL
  const chartValues = useMemo(() => {
    if (revenueData?.monthlyDistribution && revenueData.monthlyDistribution.length > 0) {
      return revenueData.monthlyDistribution.slice(0, 8);
    }
    return months.map((month, index) => ({
      month,
      amount: index === months.length - 1 ? totalRevenue : 0,
    }));
  }, [revenueData, totalRevenue]);

  // Max amount in monthly chart for proportional height
  const maxMonthlyAmount = useMemo(() => {
    const amounts = chartValues.map((v) => v.amount);
    return Math.max(...amounts, 1);
  }, [chartValues]);

  // Student to Teacher Ratio
  const studentTeacherRatio = useMemo(() => {
    if (activeTeachersCount === 0) return `${activeStudentsCount}:0`;
    const ratio = Math.round(activeStudentsCount / activeTeachersCount);
    return `${ratio}:1`;
  }, [activeStudentsCount, activeTeachersCount]);

  const adminName = userName.trim() || 'Admin';
  const displayAdminName = adminName.toLocaleLowerCase() === schoolName.trim().toLocaleLowerCase() ? 'School Admin' : adminName;
  const dateLabel = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(now);
  const timeLabel = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now);

  const surface = isGlass ? 'border-white/10 bg-slate-900/55 shadow-black/20' : 'border-slate-200/80 bg-white shadow-slate-200/60';
  const title = isGlass ? 'text-white' : 'text-slate-900';
  const muted = isGlass ? 'text-slate-400' : 'text-slate-500';
  const soft = isGlass ? 'bg-white/[.045] border-white/10' : 'bg-slate-50/80 border-slate-100';

  // Key metrics cards (Universal Indigo & Slate scheme)
  const metrics = [
    {
      label: 'Active Students',
      value: activeStudentsCount.toLocaleString('en-IN'),
      note: `${authoritativeStudentCount.toLocaleString('en-IN')} total on record (${promotedStudentsCount.toLocaleString('en-IN')} promoted)`,
      icon: Users,
      tab: 'student',
    },
    {
      label: 'Teaching Faculty',
      value: `${activeTeachersCount} Teachers`,
      note: `${studentTeacherRatio} Student-Teacher ratio`,
      icon: UserCheck,
      tab: 'teachers',
    },
    {
      label: 'Revenue Collected',
      value: `₹${totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
      note: totalInvoiced ? `${collectionRate}% of ₹${totalInvoiced.toLocaleString('en-IN')} billed` : 'No fee dues billed',
      icon: CreditCard,
      tab: 'fees',
    },
    {
      label: 'Academic Classes',
      value: `${classesData.length} Classes`,
      note: `${sectionsData.length} active class sections`,
      icon: GraduationCap,
      tab: 'academic-setup',
    },
  ];

  return (
    <section className="space-y-6 animate-fade-in" id="dashboard-module">
      {/* ----------------------------------------------------
          INSTITUTIONAL ADMINISTRATIVE EXECUTIVE HEADER
          ---------------------------------------------------- */}
      <div className="portal-header-card">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          {/* Left: School Identity & Greeting */}
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 text-indigo-600 shadow-2xs">
              <School className="w-6 h-6" />
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {schoolName}
                </span>
              </div>

              <h1 className="mt-1 text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                Welcome back, {displayAdminName}
              </h1>
            </div>
          </div>


        </div>

        {/* Operational Quick Action Bar (Direct ERP shortcuts) */}
        <div className="mt-6 pt-5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
            <span>Quick Actions:</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigateToTab('student')}
              className="portal-btn-primary"
            >
              <Plus className="w-4 h-4" />
              <span>Enroll Student</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigateToTab('fees')}
              className="portal-btn-secondary"
            >
              <CreditCard className="w-4 h-4 text-indigo-600" />
              <span>Collect Fee</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigateToTab('attendance')}
              className="portal-btn-secondary"
            >
              <CheckSquare className="w-4 h-4 text-indigo-600" />
              <span>Take Attendance</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigateToTab('teachers')}
              className="portal-btn-secondary"
            >
              <UserCheck className="w-4 h-4 text-indigo-600" />
              <span>Staff Directory</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigateToTab('academic-setup')}
              className="portal-btn-secondary"
            >
              <GraduationCap className="w-4 h-4 text-indigo-600" />
              <span>Academic Setup</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigateToTab('homework')}
              className="portal-btn-secondary"
            >
              <BookOpen className="w-4 h-4 text-indigo-600" />
              <span>Class Homework</span>
            </button>
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------
          KEY METRICS ROW (Clean Institutional Cards)
          ---------------------------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, value, note, icon: Icon, tab }) => (
          <motion.button
            key={label}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.99 }}
            transition={{ duration: 0.12 }}
            onClick={() => onNavigateToTab(tab)}
            className="portal-card group cursor-pointer text-left select-none p-5 block w-full relative"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
                <p className="mt-1.5 text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">{value}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors shrink-0">
                <Icon className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium truncate max-w-[200px]">{note}</span>
              <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 transition-colors shrink-0" />
            </div>
          </motion.button>
        ))}
      </div>

      {/* ----------------------------------------------------
          CORE PANELS: REVENUE & FACULTY (SIDE-BY-SIDE)
          ---------------------------------------------------- */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* REVENUE & FEE COLLECTIONS */}
        <div className="portal-card p-6 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-white/10">
              <div>
                <div className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
                    <Wallet className="h-4 w-4" />
                  </span>
                  <div className="flex items-center gap-2">
                    <h2 className={`text-base font-extrabold ${title}`}>Revenue & Fee Collections</h2>
                    <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-extrabold text-emerald-700 border border-emerald-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live DB
                    </span>
                  </div>
                </div>
                <p className={`mt-0.5 text-xs ${muted}`}>Authoritative PostgreSQL revenue, invoices, and payment receipts.</p>
              </div>
              <button
                onClick={() => onNavigateToTab('fees')}
                className="portal-btn-secondary"
              >
                <span>Fee Ledger</span>
                <ArrowUpRight className="h-3.5 w-3.5 text-indigo-600" />
              </button>
            </div>

            {/* Financial Highlights */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
                <span className={`text-[10px] font-extrabold uppercase tracking-wider ${muted}`}>Total Revenue Made</span>
                <p className="mt-1 text-2xl font-black text-slate-900">
                  ₹{totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </p>
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-1.5 py-0.5 mt-1 inline-block">
                  {collectionRate}% Collected
                </span>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
                <span className={`text-[10px] font-extrabold uppercase tracking-wider ${muted}`}>Pending Receivables</span>
                <p className="mt-1 text-2xl font-black text-slate-900">
                  ₹{pendingReceivables.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </p>
                <span className={`text-[10px] font-semibold ${muted} mt-1 inline-block`}>
                  from ₹{totalInvoiced.toLocaleString('en-IN')} total
                </span>
              </div>
            </div>

            {/* Collections Momentum Bar Chart */}
            <div className="mt-5">
              <div className="flex items-center justify-between mb-2">
                <span className={`text-[10px] font-extrabold uppercase tracking-wider ${muted}`}>
                  Monthly Receipts Momentum (PostgreSQL Records)
                </span>
                {revenueData?.lastUpdated && (
                  <span className={`text-[9px] font-mono flex items-center gap-1 ${muted}`}>
                    <Clock className="h-3 w-3" /> Real-time
                  </span>
                )}
              </div>
              <div className="flex h-36 items-end gap-2 border-b border-slate-200/70 pb-px">
                {chartValues.map((item) => {
                  const proportionalHeight = maxMonthlyAmount > 0 && item.amount > 0
                    ? Math.max(16, Math.round((item.amount / maxMonthlyAmount) * 85))
                    : 8;
                  const hasAmount = item.amount > 0;

                  return (
                    <div className="group flex h-full flex-1 flex-col justify-end" key={item.month}>
                      <div className="relative flex flex-1 items-end justify-center">
                        <span
                          className="pointer-events-none absolute -top-2 hidden -translate-y-full rounded-md px-2 py-1 text-[10px] font-bold bg-slate-900 text-white group-hover:block z-10 shadow-md font-mono"
                        >
                          ₹{item.amount.toLocaleString('en-IN')}
                        </span>
                        <div
                          style={{ height: `${proportionalHeight}%` }}
                          className={`w-full max-w-8 rounded-t-lg transition-all duration-200 ${
                            hasAmount
                              ? 'bg-indigo-600 group-hover:bg-indigo-500'
                              : 'bg-slate-100'
                          }`}
                        />
                      </div>
                      <span className={`pt-2 text-center text-[10px] font-bold ${hasAmount ? 'text-indigo-600 font-extrabold' : muted}`}>
                        {item.month}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className={`mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs ${muted}`}>
            <span>Total Invoiced: <strong className={title}>₹{totalInvoiced.toLocaleString('en-IN')}</strong></span>
            <span>Fee Health: <strong className="text-emerald-700 font-bold">{collectionRate >= 80 ? 'Excellent' : collectionRate >= 50 ? 'Moderate' : 'Active Cycle'}</strong></span>
          </div>
        </div>

        {/* TEACHING FACULTY & STAFF */}
        <div className="portal-card p-6 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
                    <UserCheck className="h-4 w-4" />
                  </span>
                  <h2 className={`text-base font-extrabold ${title}`}>Teaching Faculty & Staff</h2>
                </div>
                <p className={`mt-0.5 text-xs ${muted}`}>
                  {activeTeachers.length} active faculty members · {studentTeacherRatio} Student-to-Teacher ratio.
                </p>
              </div>
              <button
                onClick={() => onNavigateToTab('teachers')}
                className="portal-btn-secondary"
              >
                <span>Teacher Directory</span>
                <ArrowUpRight className="h-3.5 w-3.5 text-indigo-600" />
              </button>
            </div>

            {/* Teachers List Preview */}
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[220px] overflow-y-auto pr-1">
              {teachersList.length > 0 ? (
                teachersList.slice(0, 6).map((teacher: any) => {
                  const subjectCount = Array.isArray(teacher.subjects) ? teacher.subjects.length : 0;
                  const rawName = teacher.name || 'Teacher';
                  const formattedName = rawName
                    .trim()
                    .split(/\s+/)
                    .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                    .join(' ');

                  return (
                    <div
                      key={teacher.id}
                      className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 border border-indigo-100 text-xs font-black text-indigo-700 shadow-2xs">
                          {formattedName.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className={`truncate text-xs font-black tracking-tight ${title}`}>
                            {formattedName}
                          </p>
                          <p className={`truncate text-[10px] font-medium ${muted}`}>
                            {teacher.qualification || 'Faculty Member'}
                          </p>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="rounded-md border bg-white border-slate-200/80 text-slate-700 px-1.5 py-0.5 text-[9px] font-bold shadow-2xs">
                          {subjectCount} {subjectCount === 1 ? 'subj' : 'subjs'}
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="sm:col-span-2 p-6 text-center rounded-2xl border border-dashed border-slate-200 text-xs text-slate-400">
                  No teachers recorded yet. Click Teacher Directory to add faculty.
                </div>
              )}
            </div>
          </div>

          <div className={`mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs ${muted}`}>
            <span>Total Faculty: <strong className={title}>{teachersList.length} Teachers</strong></span>
            <button
              onClick={() => onNavigateToTab('academic')}
              className="text-xs font-bold text-indigo-600 hover:underline cursor-pointer"
            >
              View Schedules & Timetables →
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
