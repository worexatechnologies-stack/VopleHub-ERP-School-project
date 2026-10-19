import React, { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  FileText,
  GraduationCap,
  MessageSquare,
  Target,
  TrendingUp,
  UserRoundCheck,
  Users,
  ShieldCheck,
  ArrowRight,
  FolderCheck,
  Clock,
  ArrowUpRight,
  Activity,
  Check,
  CheckSquare,
  Wallet,
  Layers,
  ChevronRight,
  Calendar
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { loadVisibleSubjects, SubjectVisibility } from '../services/subjectVisibility';
import { store } from '../store';
import { attendanceApi } from '../store/api/attendanceApi';
import { authApi } from '../store/api/authApi';
import { studentApi } from '../store/api/studentApi';
import { loadTimetableSlots } from '../services/timetable';
import type { TimetableSlot } from './timetable/types';
import { homeworkApi, HomeworkRecord } from '../store/api/homeworkApi';

type PortalRole = 'Teacher' | 'Student' | 'Parent';

interface RoleDashboardProps {
  role: PortalRole;
  userName: string;
  onNavigateToTab: (tabId: string) => void;
  isGlass?: boolean;
}

interface Stat {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone: string;
}

function StatCard({ stat, isGlass }: { stat: Stat; isGlass: boolean; key?: string }) {
  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className={`rounded-2xl border p-5 transition-shadow hover:shadow-md ${
        isGlass ? 'border-white/10 bg-slate-900/55' : 'border-slate-200/80 bg-white shadow-xs'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`text-[10px] font-extrabold uppercase tracking-[0.14em] ${isGlass ? 'text-slate-400' : 'text-slate-500'}`}>{stat.label}</p>
          <p className={`mt-2 text-2xl font-extrabold ${isGlass ? 'text-white' : 'text-slate-900'}`}>{stat.value}</p>
          <p className="mt-2 text-xs font-semibold text-emerald-600">{stat.detail}</p>
        </div>
        <span className={`rounded-2xl p-3 shadow-xs ${stat.tone}`}><stat.icon className="h-5 w-5" /></span>
      </div>
    </motion.div>
  );
}

function Panel({ children, isGlass, className = '' }: { children: ReactNode; isGlass: boolean; className?: string }) {
  return <section className={`rounded-2xl border p-6 ${isGlass ? 'border-white/10 bg-slate-900/55' : 'border-slate-200 bg-white shadow-sm'} ${className}`}>{children}</section>;
}

function EmptyPanel({ title, detail, action, onClick, isGlass }: { title: string; detail: string; action: string; onClick: () => void; isGlass: boolean }) {
  return (
    <button onClick={onClick} className={`w-full rounded-xl border border-dashed p-6 text-left transition hover:border-indigo-300 ${isGlass ? 'border-white/10 hover:bg-white/5' : 'border-slate-200 hover:bg-slate-50'}`}>
      <p className={`text-sm font-extrabold ${isGlass ? 'text-white' : 'text-slate-900'}`}>{title}</p>
      <p className={`mt-1 text-xs ${isGlass ? 'text-slate-400' : 'text-slate-500'}`}>{detail}</p>
      <p className="mt-4 text-xs font-bold text-indigo-600">{action}</p>
    </button>
  );
}

function SubjectList({ visibility, error, isGlass }: { visibility: SubjectVisibility | null; error: string; isGlass: boolean }) {
  if (error) return <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">{error}</p>;
  if (!visibility) return <p className={`mt-4 text-xs ${isGlass ? 'text-slate-400' : 'text-slate-500'}`}>Loading assigned subjects...</p>;
  if (!visibility.subjects.length) {
    return <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-800">No subjects are assigned yet. Ask the School Admin to complete the class and teacher subject assignment.</p>;
  }
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      {visibility.subjects.map((subject) => (
        <div key={subject.id} className={`rounded-xl border px-3 py-3 ${isGlass ? 'border-white/10 bg-white/5' : 'border-slate-100 bg-slate-50'}`}>
          <p className={`text-xs font-extrabold ${isGlass ? 'text-white' : 'text-slate-800'}`}>{subject.name}</p>
          <p className={`mt-1 text-[10px] ${isGlass ? 'text-slate-400' : 'text-slate-500'}`}>
            {subject.scopes.length
              ? subject.scopes.map((scope) => `${scope.className}-${scope.sectionName}`).join(', ')
              : 'Subject assigned; class/section assignment is still required'}
          </p>
        </div>
      ))}
    </div>
  );
}

type AttendanceRecord = { studentId: number; date: string; period?: number; subjectName?: string; status: 'Present' | 'Absent' | 'Late' | 'Half-day' };
type ExamResult = { exam_name: string; subject: string; max_marks: number; marks_obtained: string | number | null; status: string };

function AttendanceRingGauge({ percentage, totalSessions }: { percentage: number; totalSessions: number }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (Math.min(100, Math.max(0, percentage)) / 100) * circumference;
  const strokeColor = percentage >= 85 ? '#10b981' : percentage >= 75 ? '#6366f1' : '#f59e0b';

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-20 w-20 shrink-0 flex items-center justify-center">
        <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 88 88">
          <circle
            cx="44"
            cy="44"
            r={radius}
            className="stroke-slate-100"
            strokeWidth="7"
            fill="transparent"
          />
          <circle
            cx="44"
            cy="44"
            r={radius}
            stroke={strokeColor}
            strokeWidth="7"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="transparent"
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-base font-black text-slate-900 leading-none">{percentage}%</span>
          <span className="text-[8px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">Present</span>
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-bold text-slate-900">
          {percentage >= 85 ? 'High Attendance Standing' : percentage >= 75 ? 'Satisfactory Record' : 'Needs Regularity Focus'}
        </p>
        <p className="text-[11px] text-slate-500 font-medium">
          {totalSessions > 0 ? `${totalSessions} daily sessions on file` : 'Daily class registers active'}
        </p>
        <div className="pt-0.5">
          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold ${
            percentage >= 75 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {percentage >= 75 ? 'Meets Academic Threshold' : 'Attention Advised (<75%)'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function RoleDashboard({ role, userName, onNavigateToTab, isGlass = false }: RoleDashboardProps) {
  const title = isGlass ? 'text-white' : 'text-slate-900';
  const muted = isGlass ? 'text-slate-400' : 'text-slate-500';
  const firstName = userName.split(' ')[0] || userName;
  const [subjectVisibility, setSubjectVisibility] = useState<SubjectVisibility | null>(null);
  const [subjectError, setSubjectError] = useState('');
  // Real data fetched from the API
  const [timetableSlots, setTimetableSlots] = useState<TimetableSlot[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [examResults, setExamResults] = useState<ExamResult[]>([]);
  const [myResults, setMyResults] = useState<ExamResult[]>([]);
  const [myStudentId, setMyStudentId] = useState<number | null>(null);
  const [dataError, setDataError] = useState('');
  const [homeworkRecords, setHomeworkRecords] = useState<HomeworkRecord[]>([]);

  // Fetch visible subjects
  useEffect(() => {
    let active = true;
    loadVisibleSubjects()
      .then((payload) => {
        if (!active) return;
        setSubjectVisibility(payload);
        setSubjectError('');
      })
      .catch((error) => {
        if (!active) return;
        setSubjectVisibility(null);
        setSubjectError(error instanceof Error ? error.message : 'Assigned subjects could not be loaded.');
      });
    return () => { active = false; };
  }, [role, userName]);

  // Fetch timetable slots — backend already role-scopes this endpoint.
  useEffect(() => {
    let active = true;
    loadTimetableSlots()
      .then((rows) => { if (active) setTimetableSlots(role === 'Teacher' ? rows : rows.filter(s => s.published)); })
      .catch(() => { if (active) setTimetableSlots([]); });
    return () => { active = false; };
  }, [role]);

  // Fetch homework — backend already role-scopes this endpoint.
  useEffect(() => {
    let active = true;
    store.dispatch(homeworkApi.endpoints.getHomework.initiate(undefined))
      .unwrap()
      .then((rows) => {
        if (!active) return;
        const list = Array.isArray(rows) ? rows : (rows as any)?.results || [];
        setHomeworkRecords(list);
      })
      .catch(() => { if (active) setHomeworkRecords([]); });
    return () => { active = false; };
  }, [role]);

  // Fetch attendance for parent or student
  useEffect(() => {
    if (role !== 'Parent' && role !== 'Student') return;
    let active = true;
    store.dispatch(attendanceApi.endpoints.getAttendance.initiate(undefined))
      .unwrap()
      .then((payload) => {
        if (!active) return;
        const rows = (payload || []) as any;
        setAttendanceRecords(rows);
      })
      .catch(() => { if (active) setAttendanceRecords([]); });
    return () => { active = false; };
  }, [role]);

  // For student: fetch own student ID from /auth/me/ then results + attendance
  useEffect(() => {
    if (role !== 'Student') return;
    let active = true;
    store.dispatch(authApi.endpoints.getCurrentUser.initiate(undefined))
      .unwrap()
      .then((me) => {
        if (!active) return;
        const studentId = Number(me.studentId);
        setMyStudentId(Number.isFinite(studentId) && studentId > 0 ? studentId : null);
        if (Number.isFinite(studentId) && studentId > 0) {
          store.dispatch(studentApi.endpoints.getStudentResults.initiate(String(studentId)))
            .unwrap()
            .then((results) => { if (active) setMyResults((results || []) as any); })
            .catch(() => { if (active) setMyResults([]); });
        }
      })
      .catch(() => { if (active) setMyStudentId(null); });
    return () => { active = false; };
  }, [role]);

  type ParentWard = { id: number | string; name: string; class: string; section?: string; admissionNo?: string };
  const [wards, setWards] = useState<ParentWard[]>([]);
  const [selectedWardId, setSelectedWardId] = useState<string>('all');

  // For parent: fetch linked wards list and exam results
  useEffect(() => {
    if (role !== 'Parent') return;
    let active = true;
    store.dispatch(studentApi.endpoints.getStudents.initiate(undefined))
      .unwrap()
      .then((payload) => {
        if (!active) return;
        const rows = (payload || []) as any;
        setWards(rows);
      })
      .catch(() => { if (active) setWards([]); });

    store.dispatch(authApi.endpoints.getCurrentUser.initiate(undefined))
      .unwrap()
      .then((me) => {
        const parentStudentIds = me.parentStudentIds?.map(Number).filter((id: number) => Number.isFinite(id) && id > 0) || [];
        if (active && parentStudentIds.length) {
          Promise.all(parentStudentIds.map((id: number) =>
            store.dispatch(studentApi.endpoints.getStudentResults.initiate(String(id))).unwrap()
          ))
            .then((groups) => { if (active) setExamResults((groups || []).flat() as any); })
            .catch(() => { if (active) setExamResults([]); });
        } else if (active) {
          setExamResults([]);
        }
      })
      .catch(() => { if (active) setExamResults([]); });
    return () => { active = false; };
  }, [role]);

  const activeWard = useMemo(() => {
    if (selectedWardId === 'all') return null;
    return wards.find((w) => String(w.id) === selectedWardId) || null;
  }, [wards, selectedWardId]);

  const assignedSubjectCount = subjectVisibility?.subjects.length || 0;
  const assignedScopeCount = useMemo(() => new Set(
    (subjectVisibility?.subjects || []).flatMap((subject) => subject.scopes.map((scope) => scope.sectionId)),
  ).size, [subjectVisibility]);

  // Compute real attendance for the current role
  const roleAttendance = useMemo(() => {
    if (role === 'Parent' && activeWard) {
      return attendanceRecords.filter((r) => String(r.studentId) === String(activeWard.id));
    }
    return attendanceRecords;
  }, [role, activeWard, attendanceRecords]);

  const studentPresent = roleAttendance.filter((r) => r.status === 'Present').length;
  const studentTotal = roleAttendance.length;
  const studentAttendanceRate = studentTotal ? Math.round((studentPresent / studentTotal) * 100) : 0;

  const roleExamResults = useMemo(() => {
    if (role === 'Parent' && activeWard) {
      return examResults.filter(
        (r: any) =>
          String(r.student) === String(activeWard.id) ||
          (r.student_name && r.student_name.toLowerCase() === activeWard.name.toLowerCase())
      );
    }
    return examResults;
  }, [role, activeWard, examResults]);

  // Homework filtered for Parent's active ward
  const parentWardHomework = useMemo(() => {
    if (role !== 'Parent') return [];
    if (!activeWard) return homeworkRecords;
    const wardClassNum = (activeWard.class || '').replace(/\D/g, '');
    return homeworkRecords.filter((hw) => {
      const hwClass = (hw.className || '').toLowerCase().trim();
      if (['all', 'all classes', 'all-classes'].includes(hwClass)) return true;
      const hwNum = hwClass.replace(/\D/g, '');
      if (wardClassNum && hwNum && wardClassNum === hwNum) {
        if (!hw.sectionName || hw.sectionName.toLowerCase() === 'all' || !activeWard.section) return true;
        return hw.sectionName.toLowerCase().trim() === activeWard.section.toLowerCase().trim();
      }
      return false;
    });
  }, [role, activeWard, homeworkRecords]);

  // Compute class periods today for teacher (unique sections from their timetable slots)
  const teacherSectionsToday = useMemo(() => {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }) as TimetableSlot['day'];
    const todaySlot = timetableSlots.find((s) => s.day === today);
    return todaySlot ? new Set(timetableSlots.filter((s) => s.day === today).map((s) => `${s.class}-${s.section}`)).size : 0;
  }, [timetableSlots]);

  const daysOfWeek: TimetableSlot['day'][] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const currentDayName = useMemo(() => {
    const d = new Date().toLocaleDateString('en-US', { weekday: 'long' }) as TimetableSlot['day'];
    return daysOfWeek.includes(d) ? d : 'Monday';
  }, []);
  const [selectedTeacherDay, setSelectedTeacherDay] = useState<TimetableSlot['day']>(currentDayName);

  const formattedToday = useMemo(() => {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }, []);

  if (role === 'Teacher') {
    const publishedSlotCount = timetableSlots.length;

    // Filter slots for the selected day in timetable
    const selectedDaySlots = timetableSlots
      .filter((slot) => slot.day === selectedTeacherDay)
      .sort((a, b) => a.period - b.period);

    // Compute slot count per day for the day selector tabs
    const slotCountByDay: Record<string, number> = {};
    daysOfWeek.forEach((d) => {
      slotCountByDay[d] = timetableSlots.filter((s) => s.day === d).length;
    });

    const isTodaySelected = selectedTeacherDay === currentDayName;

    const teacherPendingGradingCount = homeworkRecords.reduce((total, hw) => {
      const subs = hw.submissions || [];
      const pending = subs.filter((s) => s.marks_obtained === null || s.marks_obtained === undefined).length;
      return total + pending;
    }, 0);

    return (
      <div className="space-y-6 pb-12 font-sans" id="teacher-dashboard">
        {/* ── 1. Clean Institutional Faculty Header ── */}
        <div className="rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-7 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 text-indigo-600 shadow-2xs">
                <BookOpen className="w-6 h-6" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200/80">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
                    Faculty Academic Desk
                  </span>
                  <span className="text-xs text-slate-300">·</span>
                  <span className="text-xs font-semibold text-slate-500 font-mono">{formattedToday}</span>
                </div>
                <h1 className="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
                  Welcome back, {firstName}
                </h1>
                <p className="mt-1 text-xs sm:text-sm text-slate-500 max-w-xl font-medium">
                  Review your daily instructional timetable, record attendance rosters, and evaluate student marks.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0 self-start md:self-center">
              <button
                type="button"
                onClick={() => onNavigateToTab('attendance')}
                className="portal-btn-primary"
              >
                <CheckSquare className="w-4 h-4" />
                <span>Mark Attendance</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigateToTab('homework')}
                className="portal-btn-secondary"
              >
                <BookOpen className="w-4 h-4 text-indigo-600" />
                <span>Class Homework</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigateToTab('academic')}
                className="portal-btn-secondary"
              >
                <CalendarDays className="w-4 h-4 text-indigo-600" />
                <span>Master Timetable</span>
              </button>
            </div>
          </div>
        </div>

        {/* ── 2. Metric Stat Cards ── */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            stat={{
              label: "Today's Schedule",
              value: `${selectedDaySlots.length} Periods`,
              detail: isTodaySelected ? "Active instructional day" : `Classes for ${selectedTeacherDay}`,
              icon: Clock,
              tone: 'bg-indigo-50 text-indigo-600 border border-indigo-100',
            }}
            isGlass={isGlass}
          />
          <StatCard
            stat={{
              label: 'Class Homework',
              value: `${homeworkRecords.length} Tasks`,
              detail: teacherPendingGradingCount ? `${teacherPendingGradingCount} need grading` : 'All submissions graded',
              icon: BookOpen,
              tone: teacherPendingGradingCount > 0 ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-indigo-50 text-indigo-600 border border-indigo-100',
            }}
            isGlass={isGlass}
          />
          <StatCard
            stat={{
              label: 'Assigned Subjects',
              value: String(assignedSubjectCount),
              detail: assignedSubjectCount ? 'Curriculum active' : 'Subject setup pending',
              icon: BookOpen,
              tone: 'bg-indigo-50 text-indigo-600 border border-indigo-100',
            }}
            isGlass={isGlass}
          />
          <StatCard
            stat={{
              label: 'Class Scopes',
              value: String(assignedScopeCount),
              detail: assignedScopeCount ? `${assignedScopeCount} class sections` : 'No sections assigned',
              icon: Users,
              tone: 'bg-emerald-50 text-emerald-600 border border-emerald-100',
            }}
            isGlass={isGlass}
          />
        </div>

        {dataError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700 shadow-xs">
            {dataError}
          </div>
        )}

        {/* ── 3. Unified 2-Column Responsive Workspace ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* ── LEFT COLUMN (8 cols): Today's Schedule & Period Radar ── */}
          <div className="lg:col-span-8 space-y-6">
            <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-5">
              {/* Day Switcher Toolbar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-indigo-600" />
                    Teaching Schedule
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5 font-medium">
                    {isTodaySelected ? "Today's assigned periods" : `Scheduled periods for ${selectedTeacherDay}`}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-indigo-800 bg-indigo-50 px-3 py-1 rounded-xl border border-indigo-100">
                  <span>{selectedDaySlots.length}</span>
                  <span className="text-slate-400 font-normal">Period{selectedDaySlots.length === 1 ? '' : 's'}</span>
                </div>
              </div>

              {/* Day Selection Tabs with smooth sliding pill */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 bg-slate-100/70 p-1.5 rounded-2xl border border-slate-200/60">
                {[
                  { key: 'Monday', short: 'Mon' },
                  { key: 'Tuesday', short: 'Tue' },
                  { key: 'Wednesday', short: 'Wed' },
                  { key: 'Thursday', short: 'Thu' },
                  { key: 'Friday', short: 'Fri' },
                  { key: 'Saturday', short: 'Sat' },
                ].map(({ key, short }) => {
                  const isActive = selectedTeacherDay === key;
                  const count = slotCountByDay[key] || 0;
                  const isCurrent = key === currentDayName;

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedTeacherDay(key as TimetableSlot['day'])}
                      className={`relative py-2 px-1 text-center rounded-xl text-xs font-bold transition-all cursor-pointer select-none ${
                        isActive ? 'text-indigo-950 font-black' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="teacherSchedulePill"
                          transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                          className="absolute inset-0 rounded-xl bg-white shadow-xs border border-indigo-100"
                        />
                      )}
                      <div className="relative z-10 flex flex-col items-center">
                        <span className="flex items-center gap-1">
                          {short}
                          {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />}
                        </span>
                        <span className={`text-[10px] font-mono mt-0.5 ${isActive ? 'text-indigo-700 font-bold' : 'text-slate-400'}`}>
                          {count} {count === 1 ? 'class' : 'classes'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Animated Period List */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={selectedTeacherDay}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16 }}
                  className="space-y-3"
                >
                  {selectedDaySlots.length > 0 ? (
                    selectedDaySlots.map((slot) => (
                      <motion.div
                        key={slot.id}
                        whileHover={{ y: -1 }}
                        transition={{ duration: 0.12 }}
                        className="p-4 rounded-2xl border border-slate-200/80 bg-slate-50/50 hover:bg-white hover:border-indigo-200 hover:shadow-xs transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div className="w-11 h-11 rounded-2xl bg-indigo-600 text-white flex flex-col items-center justify-center shrink-0 shadow-xs">
                            <span className="text-[9px] font-black uppercase tracking-wider text-indigo-200 leading-none">P</span>
                            <span className="text-base font-black leading-none mt-0.5">{slot.period}</span>
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="text-sm font-black text-slate-900 truncate">
                                {slot.subject}
                              </h4>
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200/70">
                                Class {slot.class}-{slot.section}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 font-medium">
                              <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-600">
                                <Clock className="w-3 h-3 text-slate-400" />
                                {slot.time}
                              </span>
                              {slot.classroom && (
                                <>
                                  <span className="text-slate-300">·</span>
                                  <span className="text-[11px] text-slate-500 font-mono">Room {slot.classroom}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                          <button
                            type="button"
                            onClick={() => onNavigateToTab('attendance')}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-800 text-xs font-bold transition cursor-pointer"
                          >
                            <CheckSquare className="w-3.5 h-3.5 text-indigo-600" />
                            <span>Take Attendance</span>
                          </button>
                        </div>
                      </motion.div>
                    ))
                  ) : (
                    <div className="py-12 text-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50">
                      <CalendarDays className="w-8 h-8 text-slate-300 mx-auto" />
                      <p className="mt-2 text-xs font-bold text-slate-700">No teaching periods on {selectedTeacherDay}.</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Classes published in Academic Setup appear here automatically.
                      </p>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* ── Assigned Teaching Subjects Summary ── */}
            <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-indigo-600" />
                    My Teaching Subjects
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 font-medium">Curriculum assignments from Academic Setup</p>
                </div>
                <span className="rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 px-2.5 py-0.5 text-[10px] font-bold font-mono">
                  {assignedSubjectCount} Subjects
                </span>
              </div>

              {subjectError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                  {subjectError}
                </div>
              )}

              {!subjectVisibility ? (
                <p className="text-xs text-slate-400 py-4 text-center">Loading assigned curriculum...</p>
              ) : subjectVisibility.subjects.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-2xl">
                  No subjects assigned yet. The School Admin configures teacher assignments in Academic Setup.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {subjectVisibility.subjects.map((sub) => (
                    <div
                      key={sub.id}
                      className="p-3.5 rounded-2xl border border-slate-200/80 bg-slate-50/60 hover:bg-white hover:border-indigo-200 transition-all space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold text-slate-900">{sub.name}</span>
                        <span className="text-[10px] font-mono text-slate-400 font-bold">
                          {sub.scopes.length} {sub.scopes.length === 1 ? 'class' : 'classes'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {sub.scopes.length > 0 ? (
                          sub.scopes.map((scope) => (
                            <span
                              key={`${scope.classId}-${scope.sectionId}`}
                              className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 font-mono text-[10px] font-bold"
                            >
                              {scope.className}-{scope.sectionName}
                            </span>
                          ))
                        ) : (
                          <span className="text-[10px] text-slate-400 italic">Class assignment pending</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Assigned Homework & Grading Queue Panel ── */}
            <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-indigo-600" />
                    Assigned Homework & Grading Queue
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 font-medium">
                    Monitor active class homework, student submissions, and pending evaluations
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateToTab('homework')}
                  className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-700 transition cursor-pointer"
                >
                  <span>Manage All ({homeworkRecords.length})</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {homeworkRecords.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {homeworkRecords.slice(0, 4).map((hw) => {
                    const subs = hw.submissions || [];
                    const graded = subs.filter((s) => s.marks_obtained !== null && s.marks_obtained !== undefined).length;
                    const pending = subs.length - graded;

                    return (
                      <div
                        key={hw.id}
                        className="p-3.5 rounded-2xl border border-slate-200/80 bg-slate-50/60 hover:bg-white hover:border-indigo-200 hover:shadow-xs transition-all space-y-2 flex flex-col justify-between"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-indigo-50 text-indigo-700 border border-indigo-100 truncate">
                              {hw.subjectName}
                            </span>
                            <span className="text-[10px] font-mono text-slate-500 font-bold shrink-0">
                              Class {hw.className}{hw.sectionName ? `-${hw.sectionName}` : ''}
                            </span>
                          </div>
                          <h4 className="text-xs font-black text-slate-900 line-clamp-1">{hw.title}</h4>
                          <p className="text-[10px] text-slate-400 font-mono">Due: {hw.dueDate}</p>
                        </div>

                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                          <span className="font-bold text-slate-600">
                            {subs.length} Submissions
                          </span>
                          {pending > 0 ? (
                            <span className="text-[10px] font-black text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                              {pending} To Grade
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                              All Graded
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-6 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-2xl space-y-1">
                  <p className="font-bold text-slate-600">No active homework assignments right now.</p>
                  <p className="text-[11px]">Click "Manage All" to assign homework to your classes.</p>
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT COLUMN (4 cols): Quick Launch Desk & Faculty Clearance ── */}
          <div className="lg:col-span-4 space-y-6">
            {/* Quick Access Portal Desks */}
            <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-4">
              <div>
                <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-600" />
                  Faculty Quick Desks
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 font-medium">Daily teaching operations</p>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { id: 'attendance', label: 'Attendance', desc: 'Roster register', icon: CheckSquare },
                  { id: 'homework', label: 'Homework', desc: 'Tasks & grading', icon: BookOpen },
                  { id: 'student', label: 'Students', desc: 'Class directory', icon: Users },
                  { id: 'exams', label: 'Exams', desc: 'Grading desk', icon: FileText },
                  { id: 'salary-details', label: 'Payslips', desc: 'Salary records', icon: Wallet },
                  { id: 'teacher-documents', label: 'Documents', desc: 'Aadhaar / KYC', icon: FolderCheck },
                ].map((desk) => {
                  const DeskIcon = desk.icon;
                  return (
                    <motion.button
                      key={desk.id}
                      type="button"
                      whileHover={{ y: -2 }}
                      transition={{ duration: 0.12 }}
                      onClick={() => onNavigateToTab(desk.id)}
                      className="p-3 rounded-2xl border border-slate-200/80 bg-slate-50/60 hover:bg-white hover:border-indigo-200 hover:shadow-xs transition-all text-left space-y-1.5 cursor-pointer group select-none"
                    >
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center border shadow-2xs text-indigo-700 bg-indigo-50 border-indigo-100 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                        <DeskIcon className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-extrabold text-slate-900 group-hover:text-indigo-700 transition-colors">
                          {desk.label}
                        </p>
                        <p className="text-[10px] text-slate-400 font-medium">
                          {desk.desc}
                        </p>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* Official Records & Verification Status Card */}
            <div className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-3.5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-xs shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-black text-slate-900">Faculty Credentials & KYC</h4>
                  <p className="text-[11px] text-slate-500 font-medium">Official institutional record</p>
                </div>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="font-bold text-slate-700">Account Authorization</span>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">Verified</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="font-bold text-slate-700">Document Vault</span>
                  <button
                    type="button"
                    onClick={() => onNavigateToTab('teacher-documents')}
                    className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700 transition cursor-pointer"
                  >
                    Manage Files
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onNavigateToTab('salary-details')}
                className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition shadow-xs cursor-pointer"
              >
                <span>View Monthly Payslips</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (role === 'Student') {
    const activeHomeworkCount = homeworkRecords.filter((h) => h.status === 'Active').length;
    const stats: Stat[] = [
      { label: 'Attendance', value: `${studentAttendanceRate}%`, detail: studentTotal ? `${studentTotal} records on file` : 'Registers synchronized', icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-600 border border-emerald-100' },
      { label: 'Class Homework', value: String(homeworkRecords.length), detail: homeworkRecords.length ? `${activeHomeworkCount} active assignments` : 'No homework pending', icon: BookOpen, tone: 'bg-indigo-50 text-indigo-600 border border-indigo-100' },
      { label: 'Class subjects', value: String(assignedSubjectCount), detail: assignedSubjectCount ? 'Curriculum active' : 'Class subjects pending', icon: Layers, tone: 'bg-indigo-50 text-indigo-600 border border-indigo-100' },
      { label: 'Published results', value: String(myResults.length), detail: myResults.length ? 'Term scorecards live' : 'No published results', icon: FileText, tone: 'bg-indigo-50 text-indigo-600 border border-indigo-100' },
    ];

    // Filter today's timetable slots for the student
    const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const todayStudentSlots = timetableSlots
      .filter((s) => s.day === todayName)
      .sort((a, b) => a.period - b.period);

    return (
      <div className="space-y-6 animate-fade-in pb-12 font-sans" id="student-dashboard">
        {/* ── 1. Clean Institutional Student Hub Header ── */}
        <div className="rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-7 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 text-indigo-600 shadow-2xs">
                <GraduationCap className="w-6 h-6" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200/80">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
                    Student Academic Hub
                  </span>
                  <span className="text-xs text-slate-300">·</span>
                  <span className="text-xs font-semibold text-slate-500 font-mono">{formattedToday}</span>
                </div>
                <h1 className="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
                  Welcome, {firstName}
                </h1>
                <p className="mt-1 text-xs sm:text-sm text-slate-500 max-w-xl font-medium">
                  Your daily timetable, attendance metrics, and published exam marks are synchronized from the live campus database.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0 self-start sm:self-center">
              <button
                type="button"
                onClick={() => onNavigateToTab('academic')}
                className="portal-btn-primary"
              >
                <CalendarDays className="w-4 h-4" />
                <span>Open Timetable</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigateToTab('exams')}
                className="portal-btn-secondary"
              >
                <FileText className="w-4 h-4 text-indigo-600" />
                <span>My Reports</span>
              </button>
            </div>
          </div>
        </div>

        {/* Aadhaar Verification Quick Action Banner */}
        <div className={`rounded-3xl border p-5 sm:p-6 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
          isGlass
            ? 'border-indigo-500/30 bg-indigo-950/40 text-white'
            : 'border-indigo-100/90 bg-gradient-to-r from-indigo-50/70 via-white to-slate-50/50 shadow-xs'
        }`}>
          <div className="flex items-center gap-3.5">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-indigo-600 text-white shadow-md shadow-indigo-600/20">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-indigo-600">
                  Official Student Identity Record
                </span>
                <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[9px] font-bold text-indigo-700">
                  Aadhaar Verification
                </span>
              </div>
              <h3 className={`text-sm font-black ${isGlass ? 'text-white' : 'text-slate-900'}`}>
                Submit Aadhaar Card for Admin Verification
              </h3>
              <p className={`text-xs ${isGlass ? 'text-slate-300' : 'text-slate-500'}`}>
                Apply your 12-digit Aadhaar Card (Front &amp; Back) to complete identity KYC. The School Administration will review and confirm approval.
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigateToTab('student-documents')}
            className="portal-btn-primary shrink-0 self-start sm:self-center"
          >
            <FolderCheck className="h-4 w-4" />
            <span>My Documents</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* ── 2. Metric Stat Cards ── */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => <StatCard stat={stat} isGlass={isGlass} key={stat.label} />)}
        </div>

        {/* ── 3. Main 2-Column Responsive Workspace ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column (8 cols): Class Subjects & Today's Schedule Sneak Peek */}
          <div className="lg:col-span-8 space-y-6">
            {/* Today's Schedule Preview */}
            <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-indigo-600" />
                    Today's Class Schedule ({todayName})
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 font-medium">Daily assigned classroom periods</p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateToTab('academic')}
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-700 transition cursor-pointer"
                >
                  Full Timetable &rarr;
                </button>
              </div>

              {todayStudentSlots.length > 0 ? (
                <div className="space-y-2.5">
                  {todayStudentSlots.map((slot) => (
                    <motion.div
                      key={slot.id}
                      whileHover={{ y: -1 }}
                      transition={{ duration: 0.12 }}
                      className="p-3.5 rounded-2xl border border-slate-200/80 bg-slate-50/50 hover:bg-white hover:border-indigo-200 hover:shadow-xs transition-all flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex flex-col items-center justify-center shrink-0 shadow-2xs">
                          <span className="text-[8px] font-black uppercase text-indigo-200 leading-none">P</span>
                          <span className="text-xs font-black leading-none mt-0.5">{slot.period}</span>
                        </div>
                        <div>
                          <p className="text-xs font-black text-slate-900">{slot.subject}</p>
                          <div className="flex items-center gap-2 text-[11px] text-slate-400 font-medium">
                            <span className="font-mono">{slot.time}</span>
                            {slot.classroom && (
                              <>
                                <span>·</span>
                                <span className="font-mono">Room {slot.classroom}</span>
                              </>
                            )}
                            {slot.teacherName && (
                              <>
                                <span>·</span>
                                <span>{slot.teacherName}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <span className="rounded-md bg-indigo-50 border border-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700 font-mono">
                        Period {slot.period}
                      </span>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50">
                  <CalendarDays className="w-7 h-7 text-slate-300 mx-auto" />
                  <p className="mt-2 text-xs font-bold text-slate-700">No periods scheduled for today ({todayName}).</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Check the full weekly timetable for upcoming classes.</p>
                </div>
              )}
            </div>

            {/* Assigned Homework & Class Tasks Panel */}
            <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-indigo-600" />
                    Assigned Homework & Class Tasks
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 font-medium">Pending coursework and home assignments from your teachers</p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateToTab('homework')}
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-700 transition cursor-pointer flex items-center gap-1"
                >
                  <span>View All ({homeworkRecords.length})</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {homeworkRecords.length > 0 ? (
                <div className="space-y-3">
                  {homeworkRecords.slice(0, 4).map((hw) => {
                    const dueDate = new Date(hw.dueDate);
                    const isDueSoon = (dueDate.getTime() - Date.now()) < (3 * 86400000) && dueDate.getTime() >= Date.now();
                    const isPastDue = dueDate.getTime() < Date.now();
                    return (
                      <motion.div
                        key={hw.id}
                        whileHover={{ y: -1 }}
                        transition={{ duration: 0.12 }}
                        className="p-4 rounded-2xl border border-slate-200/80 bg-slate-50/50 hover:bg-white hover:border-indigo-200 hover:shadow-xs transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="rounded-md bg-indigo-50 border border-indigo-100 px-2 py-0.5 text-[10px] font-extrabold text-indigo-700 uppercase tracking-wider">
                              {hw.subjectName}
                            </span>
                            <span className="text-xs font-bold text-slate-900">{hw.title}</span>
                          </div>
                          <p className="text-xs text-slate-500 line-clamp-1">{hw.description}</p>
                          <div className="flex items-center gap-3 text-[11px] text-slate-400 font-medium pt-0.5">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-slate-400" />
                              Due: <span className="font-mono text-slate-600 font-bold">{hw.dueDate}</span>
                            </span>
                            {hw.maxMarks && (
                              <span>· Max Marks: <strong className="text-slate-700">{hw.maxMarks}</strong></span>
                            )}
                            {hw.teacherName && (
                              <span>· By: <span className="text-slate-700 font-semibold">{hw.teacherName}</span></span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
                          {isPastDue ? (
                            <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-rose-50 text-rose-600 border border-rose-100">
                              Overdue
                            </span>
                          ) : isDueSoon ? (
                            <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                              Due Soon
                            </span>
                          ) : (
                            <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
                              Active
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => onNavigateToTab('homework')}
                            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition shadow-2xs cursor-pointer"
                          >
                            Open Task
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-8 text-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50">
                  <CheckCircle2 className="w-7 h-7 text-emerald-500 mx-auto" />
                  <p className="mt-2 text-xs font-bold text-slate-700">No pending homework right now!</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">You are completely up to date with your classroom coursework.</p>
                </div>
              )}
            </div>

            {/* My Class Subjects Panel */}
            <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-indigo-600" />
                    My Class Curriculum
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 font-medium">Subjects assigned to your academic section</p>
                </div>
                <span className="rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 px-2.5 py-0.5 text-[10px] font-bold font-mono">
                  {assignedSubjectCount} Subjects
                </span>
              </div>

              <SubjectList visibility={subjectVisibility} error={subjectError} isGlass={isGlass} />
            </div>
          </div>

          {/* Right Column (4 cols): Exam Results & Quick Launch Desks */}
          <div className="lg:col-span-4 space-y-6">
            {/* Student Quick Desks */}
            <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-4">
              <div>
                <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-600" />
                  Student Quick Desks
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 font-medium">Instant student portal shortcuts</p>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { id: 'homework', label: 'Homework', desc: `${homeworkRecords.length} assignments`, icon: BookOpen },
                  { id: 'academic', label: 'Timetable', desc: 'Class schedule', icon: CalendarDays },
                  { id: 'exams', label: 'Report Cards', desc: 'Published marks', icon: FileText },
                  { id: 'student-documents', label: 'Documents', desc: 'Aadhaar / KYC', icon: FolderCheck },
                  { id: 'fees', label: 'School Fees', desc: 'Receipts & due', icon: CreditCard },
                  { id: 'communication', label: 'Notices', desc: 'School circulars', icon: Bell },
                ].map((desk) => {
                  const DeskIcon = desk.icon;
                  return (
                    <motion.button
                      key={desk.id}
                      type="button"
                      whileHover={{ y: -2 }}
                      transition={{ duration: 0.12 }}
                      onClick={() => onNavigateToTab(desk.id)}
                      className="p-3 rounded-2xl border border-slate-200/80 bg-slate-50/60 hover:bg-white hover:border-indigo-200 hover:shadow-xs transition-all text-left space-y-1.5 cursor-pointer group select-none"
                    >
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center border shadow-2xs text-indigo-700 bg-indigo-50 border-indigo-100 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                        <DeskIcon className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-extrabold text-slate-900 group-hover:text-indigo-700 transition-colors">
                          {desk.label}
                        </p>
                        <p className="text-[10px] text-slate-400 font-medium">
                          {desk.desc}
                        </p>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* Published Exam Results */}
            <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-indigo-600" />
                  Recent Scorecards
                </h3>
                <button
                  type="button"
                  onClick={() => onNavigateToTab('exams')}
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-700 transition cursor-pointer"
                >
                  View All &rarr;
                </button>
              </div>

              <div className="space-y-2.5">
                {myResults.length === 0 ? (
                  <EmptyPanel title="No published results" detail="Your school has not published exam marks yet." action="Open Exams Desk" onClick={() => onNavigateToTab('exams')} isGlass={isGlass} />
                ) : (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {myResults.slice(0, 6).map((result, index) => {
                      const marks = Number(result.marks_obtained ?? 0);
                      const percent = result.max_marks ? Math.round((marks / result.max_marks) * 100) : 0;
                      return (
                        <div key={`${result.exam_name}-${index}`} className="p-3 rounded-2xl border border-slate-100 bg-slate-50/70 hover:bg-white hover:border-indigo-200 transition-all flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold text-slate-900">{result.subject}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">{result.exam_name}</p>
                          </div>
                          <div className="text-right">
                            <span className="text-xs font-black text-slate-900 font-mono">{marks}/{result.max_marks}</span>
                            <span className={`block text-[10px] font-bold ${percent >= 75 ? 'text-emerald-600' : 'text-indigo-600'}`}>{percent}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Attendance Standing Gauge */}
            <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-3.5">
              <h3 className="text-sm font-black text-slate-900 flex items-center gap-2 pb-3 border-b border-slate-100">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Attendance Standing
              </h3>
              <AttendanceRingGauge percentage={studentAttendanceRate} totalSessions={studentTotal} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Parent role - Eye-catching Welcome & Portal Hub (Universal Indigo design)
  const greetingTime = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  })();

  const todayFormatted = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const parentQuickLinks = [
    {
      id: 'academic',
      title: "Child's Timetable",
      subtitle: 'View weekly schedules, periods, instructors & classroom venues.',
      icon: CalendarDays,
      badge: 'Academic',
    },
    {
      id: 'attendance',
      title: 'Ward Attendance',
      subtitle: 'Track daily class presence, session status and period registers.',
      icon: CheckCircle2,
      badge: 'Daily Tracker',
    },
    {
      id: 'homework',
      title: 'Class Homework',
      subtitle: 'View assigned class tasks, due dates, and ward completion marks.',
      icon: BookOpen,
      badge: 'Curriculum',
    },
    {
      id: 'fees',
      title: 'School Fee Desk',
      subtitle: 'Review term tuition fees, invoice ledgers & payment receipts.',
      icon: CreditCard,
      badge: 'Finance Desk',
    },
    {
      id: 'exams',
      title: 'Exam Reports',
      subtitle: 'Access published subject marks, grades & teacher evaluation feedback.',
      icon: FileText,
      badge: 'Report Cards',
    },
    {
      id: 'communication',
      title: 'Teacher Chat',
      subtitle: 'Direct 1-on-1 private messaging with your children’s assigned teachers.',
      icon: MessageSquare,
      badge: 'Direct Chat',
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in pb-12" id="parent-dashboard">
      {/* ── Clean Institutional Parent & Family Portal Header ── */}
      <section className="rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xs space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 text-indigo-600 shadow-2xs">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
                  <ShieldCheck className="w-3 h-3 text-indigo-600" />
                  Parent & Family Portal
                </span>
                <span className="text-xs text-slate-300">·</span>
                <span className="text-xs font-semibold text-slate-500">{todayFormatted}</span>
              </div>
              <h1 className="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
                {greetingTime}, {firstName}!
              </h1>
              <p className="mt-1 text-xs sm:text-sm text-slate-500 max-w-2xl font-medium">
                Welcome to your family dashboard. Monitor your children’s daily class attendance, examination marks, and school circulars.
              </p>
            </div>
          </div>
        </div>

        {/* Interactive Linked Children Switcher */}
        {wards.length > 0 && (
          <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 mr-1">
              Select Ward:
            </span>
            {wards.length > 1 && (
              <button
                type="button"
                onClick={() => setSelectedWardId('all')}
                className={`relative rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer select-none ${
                  selectedWardId === 'all'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                All Children
              </button>
            )}
            {wards.map((w) => {
              const isSelected = selectedWardId === String(w.id);
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setSelectedWardId(String(w.id))}
                  className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer select-none ${
                    isSelected
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  <GraduationCap className={`w-3.5 h-3.5 ${isSelected ? 'text-white' : 'text-indigo-600'}`} />
                  <span>{w.name}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-mono ${
                    isSelected ? 'bg-indigo-700 text-white' : 'bg-white border border-slate-200 text-slate-600'
                  }`}>
                    Class {w.class}{w.section ? `-${w.section}` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Key Insights Ribbon for Selected Ward ── */}
      <section className="grid gap-4 md:grid-cols-2">
        {/* Attendance Ring Overview */}
        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                Attendance Pulse · {activeWard ? activeWard.name : 'Combined Record'}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-600">
                Live Data
              </span>
            </div>
            <div className="mt-4">
              <AttendanceRingGauge percentage={studentAttendanceRate} totalSessions={studentTotal} />
            </div>
          </div>
          <button
            onClick={() => onNavigateToTab('attendance')}
            className="mt-5 inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-700 transition cursor-pointer self-start"
          >
            <span>View Full Attendance Register</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* School Fees Quick Desk */}
        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                Financial Desk · Tuition & Fees
              </span>
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-100">
                Secure Gateway
              </span>
            </div>
            <div className="mt-4 flex items-start gap-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100 shadow-xs">
                <CreditCard className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-extrabold text-slate-900">Term Invoices & Fee Ledger</h4>
                <p className="text-xs text-slate-500 font-medium leading-relaxed">
                  Review verified school fee dues, previous installment receipts, and make real-time fee payments.
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={() => onNavigateToTab('fees')}
            className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 shadow-xs transition cursor-pointer self-start"
          >
            <span>Access School Fee Desk</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </section>

      {/* ── Ward Homework & Class Tasks Preview ── */}
      <section className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
                <BookOpen className="w-4 h-4" />
              </span>
              <h2 className="text-base font-black text-slate-900 tracking-tight">
                Class Homework &amp; Coursework {activeWard ? `· ${activeWard.name}` : ''}
              </h2>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-1">
              Active assignments, project tasks, and curriculum deadlines from class teachers.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigateToTab('homework')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition cursor-pointer self-start sm:self-center"
          >
            <span>Open Homework Desk ({parentWardHomework.length})</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {parentWardHomework.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {parentWardHomework.slice(0, 3).map((hw) => {
              const dueDate = new Date(hw.dueDate);
              const isDueSoon = (dueDate.getTime() - Date.now()) < (3 * 86400000) && dueDate.getTime() >= Date.now();
              const isPastDue = dueDate.getTime() < Date.now();
              const isSchoolWide = (hw.className || '').toLowerCase().trim() === 'all classes';
              return (
                <div
                  key={hw.id}
                  className="p-4 rounded-2xl border border-slate-200/80 bg-slate-50/50 hover:bg-white hover:border-indigo-200 hover:shadow-xs transition-all flex flex-col justify-between gap-3"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-md bg-indigo-50 border border-indigo-100 px-2 py-0.5 text-[10px] font-extrabold text-indigo-700 uppercase tracking-wider">
                        {hw.subjectName}
                      </span>
                      {isSchoolWide ? (
                        <span className="text-[10px] font-bold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-md border border-violet-100">
                          School-Wide
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono font-bold text-slate-500">
                          Class {hw.className}{hw.sectionName ? `-${hw.sectionName}` : ''}
                        </span>
                      )}
                    </div>
                    <h4 className="text-xs font-black text-slate-900 line-clamp-1">{hw.title}</h4>
                    <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">{hw.description}</p>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-medium">
                    <span className="flex items-center gap-1 font-mono text-slate-600">
                      <Clock className="w-3 h-3 text-slate-400" />
                      Due {hw.dueDate}
                    </span>
                    {isPastDue ? (
                      <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-100">Overdue</span>
                    ) : isDueSoon ? (
                      <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">Due Soon</span>
                    ) : (
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">Active</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-8 text-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50">
            <CheckCircle2 className="w-7 h-7 text-emerald-500 mx-auto" />
            <p className="mt-2 text-xs font-bold text-slate-700">No active homework assignments for this class.</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Your child is all caught up with their coursework!</p>
          </div>
        )}
      </section>

      {/* ── Quick Access Portal Hub ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <div>
            <h2 className="text-lg font-black text-slate-900 tracking-tight">Parent Portals & Services</h2>
            <p className="text-xs text-slate-500 font-medium">
              Select any section below to view detailed records, timetables, and circulars for your children.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {parentQuickLinks.map((item) => {
            const Icon = item.icon;
            return (
              <motion.button
                key={item.id}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.99 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                onClick={() => onNavigateToTab(item.id)}
                className="group relative overflow-hidden rounded-3xl border border-slate-200/90 bg-white p-6 text-left shadow-xs transition-all hover:shadow-md hover:border-indigo-200 cursor-pointer select-none"
              >
                <div className="flex items-start justify-between gap-4">
                  <div
                    className="grid h-12 w-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100 shadow-xs transition-colors group-hover:bg-indigo-600 group-hover:text-white"
                  >
                    <Icon className="h-6 w-6" />
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-slate-600 group-hover:bg-indigo-50 group-hover:text-indigo-700 transition-colors">
                    {item.badge}
                  </span>
                </div>

                <div className="mt-5 space-y-1.5">
                  <h3 className="text-base font-extrabold text-slate-900 group-hover:text-indigo-600 transition-colors">
                    {item.title}
                  </h3>
                  <p className="text-xs leading-relaxed text-slate-500 font-medium">
                    {item.subtitle}
                  </p>
                </div>

                <div className="mt-5 flex items-center gap-1.5 text-xs font-extrabold text-indigo-600 group-hover:text-indigo-700 transition-colors">
                  <span>Open Section</span>
                  <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-1" />
                </div>
              </motion.button>
            );
          })}
        </div>
      </section>

      {/* ── Community & School Support Banner ── */}
      <section className="rounded-3xl border border-indigo-100 bg-gradient-to-r from-indigo-50/80 via-slate-50 to-white p-6 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-sm font-extrabold text-slate-900">Need assistance or have school queries?</h3>
          <p className="text-xs text-slate-600 font-medium">
            Use the <strong>Teacher Chat</strong> to reach out to assigned class teachers.
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={() => onNavigateToTab('communication')}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 shadow-xs transition cursor-pointer"
          >
            Chat with Teacher
          </button>
        </div>
      </section>
    </div>
  );
}