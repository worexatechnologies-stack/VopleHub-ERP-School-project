import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Search,
  Camera,
  QrCode,
  Mail,
  Smartphone,
  BarChart3,
  Clock,
  History,
  BookOpen,
  User,
  Lock,
  Layers,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Database,
  Calendar,
  Filter,
  X,
  CheckCheck,
  RotateCcw,
  Users,
  Grid3X3,
  ListFilter,
  ArrowRight,
  ArrowLeft,
  GraduationCap,
  Building2,
  Check,
  SlidersHorizontal,
  Send,
} from 'lucide-react';
import { Student } from '../types';
import { emitNotification } from '../services/notificationBus';
import {
  AttendanceStatus,
  useGetAttendanceQuery,
  useGetAttendanceReportQuery,
  useMarkAttendanceMutation,
  useBulkMarkAttendanceMutation,
} from '../store/api/attendanceApi';
import { useGetClassesQuery, useGetSectionsQuery } from '../store/api/academicApi';

interface AttendanceModuleProps {
  students: Student[];
}

interface PeriodSummary {
  period: number;
  timeLabel: string;
  subjectId: number | null;
  subjectName: string;
  teacherId: number | null;
  teacherName: string;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  halfDayCount: number;
  totalStudents: number;
  isEditable: boolean;
}

interface AuditLogEntry {
  id: number;
  studentId: number;
  studentName?: string;
  period: number;
  subjectName?: string;
  dayOfWeek?: string;
  old_status: AttendanceStatus | null;
  new_status: AttendanceStatus;
  changedByName: string;
  reason?: string;
  created_at: string;
}

const DEFAULT_PERIOD_TIMES = [
  '09:00 - 09:45',
  '09:45 - 10:30',
  '10:45 - 11:30',
  '11:30 - 12:15',
  '01:00 - 01:45',
  '01:45 - 02:30',
];

const normalizeToISO = (dateStr: string): string => {
  if (!dateStr) return new Date().toISOString().slice(0, 10);
  if (dateStr.includes('-')) {
    const parts = dateStr.split('-');
    if (parts[0].length === 4) {
      return dateStr;
    } else if (parts[2].length === 4) {
      const day = parts[0].padStart(2, '0');
      const month = parts[1].padStart(2, '0');
      const year = parts[2];
      return `${year}-${month}-${day}`;
    }
  }
  return dateStr;
};

const parseDateObj = (dateStr: string): Date => {
  const iso = normalizeToISO(dateStr);
  const parts = iso.split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }
  return new Date();
};

const formatCleanClass = (name: string): string => {
  if (!name) return 'Class';
  const trimmed = name.trim();
  const withoutPrefix = trimmed.replace(/^class\s*[-_]?\s*/i, '').trim();
  return `Class ${withoutPrefix || trimmed}`;
};

const formatCleanSection = (name: string): string => {
  if (!name) return 'Section';
  const trimmed = name.trim();
  const withoutPrefix = trimmed.replace(/^(section|sec)\s*[-_]?\s*/i, '').trim();
  return `Section ${withoutPrefix || trimmed}`;
};

const getCleanSectionLetter = (name: string): string => {
  if (!name) return 'A';
  const cleaned = name
    .replace(/^(section|sec)\s*[-_]?\s*/i, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .trim();
  return cleaned || name.charAt(0).toUpperCase();
};

const getCleanClassNumber = (name: string): string => {
  if (!name) return '1';
  const cleaned = name
    .replace(/^class\s*[-_]?\s*/i, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .trim();
  return cleaned || name.charAt(0).toUpperCase();
};

const formatToISO = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function AttendanceModule({ students }: AttendanceModuleProps) {
  // Queries for real DB classes and sections
  const { data: dbClasses = [] } = useGetClassesQuery();
  const { data: dbSections = [] } = useGetSectionsQuery();

  // Navigation Steps: 'classes' -> 'sections' -> 'attendance'
  const [navStep, setNavStep] = useState<'classes' | 'sections' | 'attendance'>('classes');
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [selectedSection, setSelectedSection] = useState<string>('');

  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');
  const [attendanceDate, setAttendanceDate] = useState(() => formatToISO(new Date()));
  const [selectedPeriod, setSelectedPeriod] = useState<number>(1);
  const [search, setSearch] = useState('');

  const todayISO = useMemo(() => formatToISO(new Date()), []);
  const currentDateISO = useMemo(() => normalizeToISO(attendanceDate), [attendanceDate]);

  const isTodayOrFuture = useMemo(() => {
    return currentDateISO >= todayISO;
  }, [currentDateISO, todayISO]);

  // Day of week calculation (e.g. Thursday)
  const dayOfWeek = useMemo(() => {
    if (!attendanceDate) return '';
    try {
      const dateObj = parseDateObj(attendanceDate);
      return dateObj.toLocaleDateString('en-US', { weekday: 'long' });
    } catch {
      return '';
    }
  }, [attendanceDate]);

  // List of distinct class names from DB or students
  const classList = useMemo(() => {
    const fromStudents = students.map((s) => s.class).filter(Boolean);
    const fromDb = (Array.isArray(dbClasses) ? dbClasses : (dbClasses as any).results || []).map((c: any) => c.name);
    const combined = Array.from(new Set([...fromStudents, ...fromDb])).sort();
    return combined;
  }, [students, dbClasses]);

  // Dynamic sections available for the currently selected class
  const sectionList = useMemo(() => {
    if (!selectedClass) return [];
    const fromStudents = students
      .filter((s) => s.class === selectedClass)
      .map((s) => s.section)
      .filter(Boolean);

    // Find classId from DB classes if available
    const matchedClass = (Array.isArray(dbClasses) ? dbClasses : []).find(
      (c: any) => c.name.toLowerCase() === selectedClass.toLowerCase()
    );
    const fromDb = (Array.isArray(dbSections) ? dbSections : [])
      .filter((sec: any) => !matchedClass || sec.classId === matchedClass.id)
      .map((sec: any) => sec.name);

    const combined = Array.from(new Set([...fromStudents, ...fromDb])).sort();
    return combined.length > 0 ? combined : ['A', 'B'];
  }, [selectedClass, students, dbClasses, dbSections]);

  // Mode views in attendance screen: 'roster' | 'matrix' | 'analytics' | 'audit'
  const [viewMode, setViewMode] = useState<'roster' | 'matrix' | 'analytics' | 'audit'>('roster');

  // Period matrix summaries from backend (7 Periods)
  const [periodSummaries, setPeriodSummaries] = useState<PeriodSummary[]>([]);

  // All attendance records for the selected date
  const [allDateRecords, setAllDateRecords] = useState<{ id: number; studentId: number; period: number; status: AttendanceStatus }[]>([]);

  // Local state mapping for active period: studentId -> status
  const [records, setRecords] = useState<{ [studentId: string]: AttendanceStatus }>({});

  // Audit Logs view
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [loadingAuditLogs, setLoadingAuditLogs] = useState(false);

  // SMS notice log
  const [smsLogs, setSmsLogs] = useState<string[]>([]);

  // Quick Date Navigation (Prev Day / Next Day)
  const handleDateShift = (deltaDays: number) => {
    try {
      const dateObj = parseDateObj(attendanceDate);
      dateObj.setDate(dateObj.getDate() + deltaDays);
      const nextISO = formatToISO(dateObj);
      if (deltaDays > 0 && nextISO > todayISO) {
        return;
      }
      setAttendanceDate(nextISO);
    } catch {
      // ignore
    }
  };

  const isServerBacked = Boolean(localStorage.getItem('school_erp_api_token'));
  const { data: dateAttendanceData, refetch: refetchAttendance } = useGetAttendanceQuery(
    { date: currentDateISO },
    { skip: !isServerBacked }
  );
  const { data: reportData, refetch: refetchReport } = useGetAttendanceReportQuery(
    { date: currentDateISO, class_name: selectedClass, section: selectedSection },
    { skip: !isServerBacked || !selectedClass || !selectedSection }
  );
  const [markAttendanceMutation] = useMarkAttendanceMutation();
  const [bulkMarkAttendanceMutation, { isLoading: isBulkMarking }] = useBulkMarkAttendanceMutation();

  const refreshDateRecords = () => {
    if (isServerBacked) refetchAttendance();
  };

  const fetchReport = () => {
    if (isServerBacked && selectedClass && selectedSection) refetchReport();
  };

  useEffect(() => {
    if (dateAttendanceData) {
      const list = (dateAttendanceData || []).map((r) => ({
        id: r.id,
        studentId: Number(r.studentId),
        period: r.period,
        status: r.status,
      }));
      setAllDateRecords(list);
      const periodFiltered = list.filter((r) => r.period === selectedPeriod);
      setRecords(Object.fromEntries(periodFiltered.map((record) => [String(record.studentId), record.status])));
    }
  }, [dateAttendanceData, selectedPeriod]);

  useEffect(() => {
    if (reportData) {
      setPeriodSummaries(reportData as PeriodSummary[]);
    }
  }, [reportData]);

  // Base roster of students in Class & Section
  const baseSectionStudents = useMemo(() => {
    if (!selectedClass) return [];
    return students.filter(student =>
      student.class === selectedClass &&
      (!selectedSection || student.section === selectedSection)
    );
  }, [students, selectedClass, selectedSection]);

  // Day-level stats across all periods on this date
  const dayStats = useMemo(() => {
    let absentAnyCount = 0;
    let lateAnyCount = 0;
    let halfDayAnyCount = 0;
    let presentCount = 0;
    let unmarkedCount = 0;

    baseSectionStudents.forEach((student) => {
      const studentDayRecords = allDateRecords.filter((r) => r.studentId === Number(student.id));
      const hasAbsent = studentDayRecords.some((r) => r.status === 'Absent');
      const hasLate = studentDayRecords.some((r) => r.status === 'Late');
      const hasHalfDay = studentDayRecords.some((r) => r.status === 'Half-day');
      const hasPresent = studentDayRecords.some((r) => r.status === 'Present');
      const isUnmarked = studentDayRecords.length === 0 || !studentDayRecords.some((r) => ['Present', 'Absent', 'Late', 'Half-day'].includes(r.status));

      if (hasAbsent) absentAnyCount++;
      if (hasLate) lateAnyCount++;
      if (hasHalfDay) halfDayAnyCount++;
      if (hasPresent) presentCount++;
      if (isUnmarked) unmarkedCount++;
    });

    return {
      absentAnyCount,
      lateAnyCount,
      halfDayAnyCount,
      presentCount,
      unmarkedCount,
    };
  }, [baseSectionStudents, allDateRecords]);

  // Filtered students by Search Query and Day-Level Period Status
  const filteredStudents = useMemo(() => {
    return baseSectionStudents.filter((student) => {
      const matchesSearch =
        student.name.toLowerCase().includes(search.toLowerCase()) ||
        student.admissionNo.toLowerCase().includes(search.toLowerCase());

      const studentDayRecords = allDateRecords.filter((r) => r.studentId === Number(student.id));

      let matchesStatus = true;
      if (selectedStatusFilter === 'Absent') {
        // Show student if they are absent in ANY ONE of the periods today
        matchesStatus = studentDayRecords.some((r) => r.status === 'Absent');
      } else if (selectedStatusFilter === 'Late') {
        // Show student if they are late in ANY ONE of the periods today
        matchesStatus = studentDayRecords.some((r) => r.status === 'Late');
      } else if (selectedStatusFilter === 'Half-day') {
        // Show student if they have half-day in ANY ONE of the periods today
        matchesStatus = studentDayRecords.some((r) => r.status === 'Half-day');
      } else if (selectedStatusFilter === 'Present') {
        // Show student if they are present in ANY period today
        matchesStatus = studentDayRecords.some((r) => r.status === 'Present');
      } else if (selectedStatusFilter === 'Unmarked') {
        // Show student if they have no attendance marked today
        matchesStatus = studentDayRecords.length === 0 || !studentDayRecords.some((r) => ['Present', 'Absent', 'Late', 'Half-day'].includes(r.status));
      }

      return matchesSearch && matchesStatus;
    });
  }, [baseSectionStudents, search, allDateRecords, selectedStatusFilter]);

  const activePeriodSummary = useMemo(() => {
    return periodSummaries.find(p => p.period === selectedPeriod) || {
      period: selectedPeriod,
      timeLabel: DEFAULT_PERIOD_TIMES[selectedPeriod - 1] || `Period ${selectedPeriod}`,
      subjectId: null,
      subjectName: `Period ${selectedPeriod}`,
      teacherId: null,
      teacherName: '',
      presentCount: 0,
      absentCount: 0,
      lateCount: 0,
      halfDayCount: 0,
      totalStudents: baseSectionStudents.length,
      isEditable: true,
    };
  }, [periodSummaries, selectedPeriod, baseSectionStudents.length]);

  // Attendance update handler for a specific period
  const handleMarkPeriodStatus = (studentId: string, periodNumber: number, status: AttendanceStatus) => {
    const previousStatus = records[studentId];
    if (periodNumber === selectedPeriod) {
      setRecords(prev => ({ ...prev, [studentId]: status }));
    }

    // Optimistically update allDateRecords
    setAllDateRecords(prev => {
      const existingIdx = prev.findIndex(r => r.studentId === Number(studentId) && r.period === periodNumber);
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = { ...updated[existingIdx], status };
        return updated;
      } else {
        return [...prev, { id: Date.now(), studentId: Number(studentId), period: periodNumber, status }];
      }
    });

    if (isServerBacked) {
      const pSummary = periodSummaries.find(p => p.period === periodNumber) || activePeriodSummary;
      markAttendanceMutation({
        studentId: Number(studentId),
        date: currentDateISO,
        period: periodNumber,
        subjectId: pSummary.subjectId ?? undefined,
        status,
      })
        .unwrap()
        .then(() => {
          fetchReport();
          refreshDateRecords();
        })
        .catch((err: any) => {
          if (periodNumber === selectedPeriod) {
            setRecords((prev) => ({ ...prev, [studentId]: previousStatus }));
          }
          const errorMessage = err?.data?.detail || err?.message || 'Attendance could not be saved.';
          emitNotification({
            title: 'Action Failed',
            message: errorMessage,
            tone: 'danger',
            source: 'attendance',
          });
        });
    }

    // Trigger parent notice for all attendance statuses: Present, Absent, Late
    const student = students.find((s) => s.id === studentId);
    if (student) {
      const pSummary = periodSummaries.find((p) => p.period === periodNumber) || activePeriodSummary;
      const subjName = pSummary.subjectName || '';
      const isGeneric = !subjName || subjName.toLowerCase().startsWith('period');
      const targetDesc = isGeneric ? `Period ${periodNumber}` : `${subjName} (Period ${periodNumber})`;
      const teacherName = pSummary.teacherName || 'Faculty';
      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const textMessage = `[Attendance Alert] ${student.name} marked ${status.toUpperCase()} for ${targetDesc} today on ${dayOfWeek}, ${currentDateISO} at ${timestamp}. Teacher: ${teacherName}.`;
      setSmsLogs((prev) => [textMessage, ...prev]);
    }
  };

  // Quick Action: Mark all students for the active period as Present
  const handleMarkAllPresent = () => {
    baseSectionStudents.forEach((student) => {
      handleMarkPeriodStatus(student.id, selectedPeriod, 'Present');
    });
    emitNotification({
      title: 'Roll Call Saved',
      message: `Marked all ${baseSectionStudents.length} students as Present for Period ${selectedPeriod}.`,
      tone: 'success',
      source: 'attendance',
    });
  };

  // Quick Action: Mark all students in section for FULL DAY (All 6 Periods) as Present
  const handleMarkFullDayPresent = async () => {
    if (baseSectionStudents.length === 0) return;
    const periods = [1, 2, 3, 4, 5, 6];

    // Optimistically update all date records
    setAllDateRecords((prev) => {
      const studentIdSet = new Set(baseSectionStudents.map((s) => Number(s.id)));
      const remaining = prev.filter(
        (r) => !(studentIdSet.has(r.studentId) && periods.includes(r.period))
      );
      const newEntries = baseSectionStudents.flatMap((s) =>
        periods.map((p) => ({
          id: Date.now() + Math.random(),
          studentId: Number(s.id),
          period: p,
          status: 'Present' as AttendanceStatus,
        }))
      );
      return [...remaining, ...newEntries];
    });

    setRecords((prev) => {
      const next = { ...prev };
      baseSectionStudents.forEach((s) => {
        next[s.id] = 'Present';
      });
      return next;
    });

    emitNotification({
      title: 'Full Day Present Marked',
      message: `Marked all ${baseSectionStudents.length} students as Present for all 6 periods today.`,
      tone: 'success',
      source: 'attendance',
    });

    if (isServerBacked) {
      try {
        await bulkMarkAttendanceMutation({
          studentIds: baseSectionStudents.map((s) => Number(s.id)),
          periods,
          date: currentDateISO,
          status: 'Present',
        }).unwrap();
        fetchReport();
        refreshDateRecords();
      } catch (err: any) {
        const msg = err?.data?.detail || err?.message || 'Failed to save full day attendance.';
        emitNotification({
          title: 'Action Failed',
          message: msg,
          tone: 'danger',
          source: 'attendance',
        });
      }
    }
  };

  // Quick Action: Mark a single student for FULL DAY (All 6 Periods) as Present
  const handleMarkStudentFullDay = async (studentId: string, status: AttendanceStatus = 'Present') => {
    const sNum = Number(studentId);
    const periods = [1, 2, 3, 4, 5, 6];

    setAllDateRecords((prev) => {
      const remaining = prev.filter(
        (r) => !(r.studentId === sNum && periods.includes(r.period))
      );
      const newEntries = periods.map((p) => ({
        id: Date.now() + Math.random(),
        studentId: sNum,
        period: p,
        status,
      }));
      return [...remaining, ...newEntries];
    });

    setRecords((prev) => ({ ...prev, [studentId]: status }));

    const studentObj = students.find((s) => s.id === studentId);
    emitNotification({
      title: 'Full Day Roll Call',
      message: `Marked ${studentObj?.name || 'Student'} as ${status} for all 6 periods today.`,
      tone: 'success',
      source: 'attendance',
    });

    if (isServerBacked) {
      try {
        await bulkMarkAttendanceMutation({
          studentIds: [sNum],
          periods,
          date: currentDateISO,
          status,
        }).unwrap();
        fetchReport();
        refreshDateRecords();
      } catch (err: any) {
        const msg = err?.data?.detail || err?.message || 'Failed to save full day attendance.';
        emitNotification({
          title: 'Action Failed',
          message: msg,
          tone: 'danger',
          source: 'attendance',
        });
      }
    }
  };

  // Quick Action: Mark all students for the active period as Absent
  const handleMarkAllAbsent = () => {
    baseSectionStudents.forEach((student) => {
      handleMarkPeriodStatus(student.id, selectedPeriod, 'Absent');
    });
  };

  // Submit Attendance Action: Save records and return to sections
  const [isSubmittingAttendance, setIsSubmittingAttendance] = useState(false);

  const handleSubmitAttendance = async () => {
    if (baseSectionStudents.length === 0) return;
    setIsSubmittingAttendance(true);

    try {
      const studentIdSet = new Set(baseSectionStudents.map((s) => Number(s.id)));
      const existingDateRecords = allDateRecords.filter((r) => studentIdSet.has(r.studentId));

      const recordMap = new Map<string, AttendanceStatus>();
      existingDateRecords.forEach((r) => {
        recordMap.set(`${r.studentId}_${r.period}`, r.status);
      });

      // Ensure active selectedPeriod is filled for all students (defaulting unmarked to Present)
      baseSectionStudents.forEach((s) => {
        const key = `${s.id}_${selectedPeriod}`;
        const activeStatus = records[s.id] || recordMap.get(key) || 'Present';
        recordMap.set(key, activeStatus as AttendanceStatus);
      });

      const itemsToSubmit = Array.from(recordMap.entries()).map(([key, st]) => {
        const [sId, pNum] = key.split('_');
        return {
          studentId: Number(sId),
          period: Number(pNum),
          status: st,
        };
      });

      // Optimistically update local state
      setAllDateRecords((prev) => {
        const remaining = prev.filter(
          (r) => !(studentIdSet.has(r.studentId) && r.period === selectedPeriod)
        );
        const newEntries = itemsToSubmit
          .filter((item) => item.period === selectedPeriod)
          .map((item) => ({
            id: Date.now() + Math.random(),
            studentId: item.studentId,
            period: item.period,
            status: item.status,
          }));
        return [...remaining, ...newEntries];
      });

      setRecords((prev) => {
        const next = { ...prev };
        baseSectionStudents.forEach((s) => {
          if (!next[s.id]) next[s.id] = 'Present';
        });
        return next;
      });

      if (isServerBacked) {
        await bulkMarkAttendanceMutation({
          date: currentDateISO,
          items: itemsToSubmit,
        }).unwrap();
        fetchReport();
        refreshDateRecords();
      }

      // Log notices for students: Present, Absent, and Late
      const pSummary = periodSummaries.find((p) => p.period === selectedPeriod) || activePeriodSummary;
      const subjName = pSummary.subjectName || '';
      const isGeneric = !subjName || subjName.toLowerCase().startsWith('period');
      const targetDesc = isGeneric
        ? `Class ${selectedClass}-${selectedSection} (Period ${selectedPeriod})`
        : `${subjName} (Period ${selectedPeriod})`;

      itemsToSubmit
        .filter((item) => item.period === selectedPeriod)
        .forEach((item) => {
          const sObj = baseSectionStudents.find((s) => Number(s.id) === item.studentId);
          if (sObj) {
            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            setSmsLogs((prev) => [
              `[Attendance Alert] ${sObj.name} marked ${item.status.toUpperCase()} for ${targetDesc} today on ${dayOfWeek}, ${currentDateISO} at ${timeStr}.`,
              ...prev,
            ]);
          }
        });

      emitNotification({
        title: 'Attendance Submitted',
        message: `Attendance for ${formatCleanClass(selectedClass)} - ${formatCleanSection(selectedSection)} (Period ${selectedPeriod}) has been saved and submitted successfully.`,
        tone: 'success',
        source: 'attendance',
      });

      // Once submitted, navigate back to sections
      setTimeout(() => {
        setNavStep('sections');
      }, 350);
    } catch (err: any) {
      const msg = err?.data?.detail || err?.message || 'Failed to submit attendance.';
      emitNotification({
        title: 'Submission Failed',
        message: msg,
        tone: 'danger',
        source: 'attendance',
      });
    } finally {
      setIsSubmittingAttendance(false);
    }
  };

  // Stats for the active period
  const totalPresent = baseSectionStudents.filter((student) => records[student.id] === 'Present').length;
  const totalAbsent = baseSectionStudents.filter((student) => records[student.id] === 'Absent').length;
  const totalLate = baseSectionStudents.filter((student) => records[student.id] === 'Late').length;
  const totalUnmarked = Math.max(0, baseSectionStudents.length - (totalPresent + totalAbsent + totalLate));

  return (
    <div className="space-y-6 animate-fade-in" id="attendance-module">
      {/* Portal Header Card */}
      <div className="portal-header-card flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shrink-0">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="portal-pill-badge indigo mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block"></span>
              Daily Attendance Register
            </div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight leading-tight">Attendance Management</h2>
            <p className="text-sm text-slate-500 mt-0.5">Mark, track, and review daily student attendance across classes, sections, and periods.</p>
          </div>
        </div>

        {/* Date picker + back */}
        <div className="flex items-center gap-3 shrink-0">
          {navStep !== 'classes' && (
            <button
              onClick={() => {
                if (navStep === 'attendance') setNavStep('sections');
                else if (navStep === 'sections') setNavStep('classes');
              }}
              className="portal-btn-secondary text-xs"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </button>
          )}

          {/* Date Picker Control */}
          <div className="flex items-center gap-1 bg-slate-50 px-3 py-2 rounded-2xl border border-slate-200">
            <button
              onClick={() => handleDateShift(-1)}
              className="p-1 text-slate-500 hover:bg-white hover:text-indigo-600 rounded-lg transition"
              title="Previous Day"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <input
              type="date"
              max={todayISO}
              value={currentDateISO}
              onChange={(e) => {
                const val = normalizeToISO(e.target.value);
                if (val <= todayISO) setAttendanceDate(val);
                else setAttendanceDate(todayISO);
              }}
              className="text-xs bg-transparent font-extrabold text-slate-900 focus:outline-none cursor-pointer"
            />
            <button
              onClick={() => handleDateShift(1)}
              disabled={isTodayOrFuture}
              className="p-1 text-slate-500 hover:bg-white hover:text-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition"
              title={isTodayOrFuture ? 'Cannot select future dates' : 'Next Day'}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Breadcrumb Trail */}
      <div className="portal-card px-5 py-3 flex items-center gap-2 text-xs font-black">
        <button
          onClick={() => setNavStep('classes')}
          className={`px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 ${
            navStep === 'classes'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'
          }`}
        >
          <GraduationCap className="w-3.5 h-3.5" />
          <span>All Classes</span>
        </button>

        {selectedClass && (
          <>
            <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
            <button
              onClick={() => setNavStep('sections')}
              className={`px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 ${
                navStep === 'sections'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>{formatCleanClass(selectedClass)}</span>
            </button>
          </>
        )}

        {selectedClass && selectedSection && navStep === 'attendance' && (
          <>
            <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
            <span className="px-3 py-1.5 rounded-xl bg-indigo-600 text-white shadow-sm flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              <span>{formatCleanSection(selectedSection)}</span>
            </span>
          </>
        )}
      </div>

      {/* ----------------------------------------------------
          LEVEL 1: CLASS SELECTION GRID (STEP 1)
          ---------------------------------------------------- */}
      {navStep === 'classes' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-black text-slate-900">Select an Academic Class</h3>
              <p className="text-xs text-slate-500 font-medium">Choose a class to view its sections, daily timetable, and attendance records.</p>
            </div>
            <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">
              {classList.length} Classes Available
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {classList.map((className) => {
              const classStudents = students.filter((s) => s.class === className);
              const distinctSections = Array.from(new Set(classStudents.map((s) => s.section).filter(Boolean)));
              const sectionsCount = distinctSections.length || 1;

              return (
                <button
                  key={className}
                  onClick={() => {
                    setSelectedClass(className);
                    setNavStep('sections');
                  }}
                  className="group relative rounded-3xl border border-slate-200/90 bg-white p-6 text-left transition-all hover:-translate-y-1 hover:border-indigo-400 hover:shadow-xl shadow-sm flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-blue-600 text-white font-black text-xl shadow-md shadow-indigo-500/25 group-hover:scale-105 transition">
                        {getCleanClassNumber(className)}
                      </span>
                      <span className="rounded-full bg-indigo-50 border border-indigo-100/80 px-3 py-1 text-[11px] font-extrabold text-indigo-700">
                        {sectionsCount} {sectionsCount === 1 ? 'Section' : 'Sections'}
                      </span>
                    </div>

                    <h4 className="mt-5 text-lg font-black text-slate-900 group-hover:text-indigo-600 transition">
                      {formatCleanClass(className)}
                    </h4>
                    <p className="mt-1 text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-indigo-500" />
                      {classStudents.length} {classStudents.length === 1 ? 'Student Enrolled' : 'Students Enrolled'}
                    </p>
                  </div>

                  <div className="mt-6 pt-3.5 border-t border-slate-100 flex items-center justify-between text-xs font-extrabold text-indigo-600 group-hover:text-indigo-700">
                    <span>View Sections</span>
                    <ArrowRight className="w-4 h-4 transition group-hover:translate-x-1" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------
          LEVEL 2: SECTION SELECTION GRID (STEP 2)
          ---------------------------------------------------- */}
      {navStep === 'sections' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-black text-slate-900">{formatCleanClass(selectedClass)} — Select a Section</h3>
              <p className="text-xs text-slate-500 font-medium">Select a section to inspect period attendance and live student rosters.</p>
            </div>
            <button
              onClick={() => setNavStep('classes')}
              className="text-xs font-bold text-indigo-600 hover:underline flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Classes
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {sectionList.map((secName) => {
              const secStudents = students.filter((s) => s.class === selectedClass && s.section === secName);

              return (
                <button
                  key={secName}
                  onClick={() => {
                    setSelectedSection(secName);
                    setNavStep('attendance');
                  }}
                  className="group relative portal-card text-left transition-all hover:-translate-y-1 hover:border-indigo-400 hover:shadow-xl shadow-sm flex flex-col justify-between"
                  style={{ padding: '24px' }}
                >
                  <div>
                    <div className="flex items-center justify-between">
                      {/* Clean Single Letter Avatar (e.g. A, B, C) */}
                      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-blue-600 text-white font-black text-xl shadow-md shadow-indigo-500/25 group-hover:scale-105 transition">
                        {getCleanSectionLetter(secName)}
                      </span>

                      {/* Clean Badge */}
                      <span className="rounded-full bg-indigo-50 border border-indigo-100/80 px-3 py-1 text-[11px] font-extrabold text-indigo-700">
                        {formatCleanSection(secName)}
                      </span>
                    </div>

                    <h4 className="mt-5 text-lg font-black text-slate-900 group-hover:text-indigo-600 transition">
                      {formatCleanClass(selectedClass)} · {formatCleanSection(secName)}
                    </h4>
                    <p className="mt-1 text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-indigo-500" />
                      {secStudents.length} {secStudents.length === 1 ? 'Student Enrolled' : 'Students Enrolled'}
                    </p>
                  </div>

                  <div className="mt-6 pt-3.5 border-t border-slate-100 flex items-center justify-between text-xs font-extrabold text-indigo-600 group-hover:text-indigo-700">
                    <span>Open Attendance</span>
                    <ArrowRight className="w-4 h-4 transition group-hover:translate-x-1" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------
          LEVEL 3: SECTION ATTENDANCE DETAIL (STEP 3 - SIMPLE UI)
          ---------------------------------------------------- */}
      {navStep === 'attendance' && (
        <div className="space-y-6">
          {/* Timetable 6 Periods Strip */}
          <div className="portal-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-600" />
                <span className="text-xs font-black uppercase text-slate-900">
                  6-Period Timetable for {dayOfWeek} ({currentDateISO}):
                </span>
              </div>
              <span className="text-xs font-bold text-slate-600">
                {formatCleanClass(selectedClass)} · {formatCleanSection(selectedSection)}
              </span>
            </div>

            {/* 6 Period Buttons with live counts */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {[1, 2, 3, 4, 5, 6].map((pNum) => {
                const summary = periodSummaries.find((p) => p.period === pNum);
                const isSelected = selectedPeriod === pNum;
                const pPresent = summary ? summary.presentCount : 0;
                const pAbsent = summary ? summary.absentCount : 0;

                return (
                  <button
                    key={pNum}
                    onClick={() => setSelectedPeriod(pNum)}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-md ring-2 ring-indigo-300 scale-102'
                        : 'bg-slate-50 border-slate-200 text-slate-800 hover:bg-white hover:border-indigo-300'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] font-black uppercase">
                      <span>P{pNum}</span>
                      <span className={`font-mono ${isSelected ? 'text-indigo-200' : 'text-slate-400'}`}>
                        {DEFAULT_PERIOD_TIMES[pNum - 1].split(' ')[0]}
                      </span>
                    </div>

                    <p className="text-xs font-black truncate mt-1">
                      {summary?.subjectName || `Period ${pNum}`}
                    </p>

                    <div className={`mt-2 flex items-center justify-between text-[10px] font-bold ${
                      isSelected ? 'text-indigo-100' : 'text-slate-500'
                    }`}>
                      <span className={isSelected ? 'text-emerald-300' : 'text-emerald-600 font-extrabold'}>P: {pPresent}</span>
                      <span className={isSelected ? 'text-rose-300' : 'text-rose-600 font-extrabold'}>A: {pAbsent}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Main Attendance Content */}
          <div className="portal-card overflow-hidden">
            {/* Top Toolbar */}
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              {/* Search */}
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search student..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 pr-3 text-xs w-full py-2 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                />
              </div>

              {/* Status Filter Chips */}
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { label: 'All', value: 'all', count: baseSectionStudents.length },
                  { label: 'Present', value: 'Present', count: dayStats.presentCount },
                  { label: 'Absent', value: 'Absent', count: dayStats.absentAnyCount },
                  { label: 'Late', value: 'Late', count: dayStats.lateAnyCount },
                  { label: 'Unmarked', value: 'Unmarked', count: dayStats.unmarkedCount },
                ].map((chip) => (
                  <button
                    key={chip.value}
                    onClick={() => setSelectedStatusFilter(chip.value)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-extrabold border transition ${
                      selectedStatusFilter === chip.value
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {chip.label} ({chip.count})
                  </button>
                ))}
              </div>

              {/* Batch Actions & Submit Button */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleMarkFullDayPresent}
                  disabled={isBulkMarking || isSubmittingAttendance || baseSectionStudents.length === 0}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-black bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-700 hover:to-teal-800 text-white shadow-sm hover:shadow active:scale-95 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                  title="Mark all students in this class as Present for all 6 periods today"
                >
                  <CheckCheck className="w-3.5 h-3.5 text-emerald-100" />
                  Full Day Present
                </button>
                <button
                  onClick={handleMarkAllPresent}
                  disabled={isSubmittingAttendance}
                  className="px-3 py-1.5 rounded-xl text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <CheckCheck className="w-3.5 h-3.5 text-emerald-600" />
                  All Present (P{selectedPeriod})
                </button>
                <button
                  onClick={handleMarkAllAbsent}
                  disabled={isSubmittingAttendance}
                  className="px-3 py-1.5 rounded-xl text-xs font-black bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <XCircle className="w-3.5 h-3.5 text-rose-600" />
                  All Absent (P{selectedPeriod})
                </button>
                <button
                  onClick={handleSubmitAttendance}
                  disabled={isSubmittingAttendance || isBulkMarking || baseSectionStudents.length === 0}
                  className="px-4 py-1.5 rounded-xl text-xs font-black bg-gradient-to-r from-indigo-600 via-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 active:scale-95 text-white shadow-md shadow-indigo-500/25 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                  title="Submit attendance records and return to sections"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isSubmittingAttendance ? 'Submitting...' : 'Submit Attendance'}</span>
                </button>
              </div>
            </div>

            {/* Simple Student Roster with 7-Period Status Display */}
            <div className="divide-y divide-slate-100">
              {filteredStudents.length === 0 ? (
                <div className="p-12 text-center text-xs text-slate-400 font-medium">
                  No students matching search or filter criteria.
                </div>
              ) : (
                filteredStudents.map((student) => {
                  const studentDayRecords = allDateRecords.filter((r) => r.studentId === Number(student.id));
                  const presentCount = studentDayRecords.filter((r) => r.status === 'Present').length;
                  const absentCount = studentDayRecords.filter((r) => r.status === 'Absent').length;
                  const activePeriodRecord = studentDayRecords.find((r) => r.period === selectedPeriod);
                  const activeStatus = activePeriodRecord?.status;

                  return (
                    <div
                      key={student.id}
                      className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/70 transition"
                    >
                      {/* Left: Student Identity */}
                      <div className="flex items-center gap-3 min-w-[200px]">
                        <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 text-xs font-black text-white shrink-0">
                          {student.name.charAt(0)}
                        </div>
                        <div>
                          <p className="text-xs font-black text-slate-900">{student.name}</p>
                          <p className="text-[10px] font-mono text-slate-400">
                            Roll #{student.rollNo || '—'} · {student.admissionNo}
                          </p>
                        </div>
                      </div>

                      {/* Middle: 6 Periods Interactive Visual Display (P1 to P6) */}
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-extrabold uppercase text-slate-400 mr-1 hidden sm:inline">
                          Today's 6 Periods:
                        </span>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          {[1, 2, 3, 4, 5, 6].map((pNum) => {
                            const rec = studentDayRecords.find((r) => r.period === pNum);
                            const pStatus = rec?.status;
                            const isCurrent = selectedPeriod === pNum;

                            return (
                              <button
                                key={pNum}
                                onClick={() => {
                                  // Toggle status on click: Present -> Absent -> Late -> Present
                                  const nextStatus: AttendanceStatus =
                                    pStatus === 'Present' ? 'Absent' : pStatus === 'Absent' ? 'Late' : 'Present';
                                  handleMarkPeriodStatus(student.id, pNum, nextStatus);
                                }}
                                className={`px-2 py-1 rounded-lg text-[10px] font-black transition-all flex items-center gap-1 border ${
                                  pStatus === 'Present'
                                    ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                                    : pStatus === 'Absent'
                                      ? 'bg-rose-50 border-rose-300 text-rose-700'
                                      : pStatus === 'Late'
                                        ? 'bg-amber-50 border-amber-300 text-amber-700'
                                        : 'bg-slate-100 border-slate-200 text-slate-400 hover:bg-slate-200'
                                } ${isCurrent ? 'ring-2 ring-indigo-500 scale-105' : ''}`}
                                title={`Period ${pNum}: Click to toggle status`}
                              >
                                <span>P{pNum}:</span>
                                <span>{pStatus ? pStatus.charAt(0) : '—'}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Right: Summary for the day & Active Period 1-click button */}
                      <div className="flex items-center justify-between md:justify-end gap-3 shrink-0">
                        {/* Daily Total Summary Badge */}
                        <div className="text-right">
                          <span className="text-[11px] font-extrabold text-slate-800">
                            {presentCount}P / {absentCount}A
                          </span>
                          <span className="block text-[9px] font-bold text-slate-400">
                            {studentDayRecords.length}/6 Logged
                          </span>
                        </div>

                        {/* 1-Click Status Selector for Active Period & Full Day */}
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleMarkStudentFullDay(student.id, 'Present')}
                            className="px-2 py-1 rounded-lg text-[10px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300 transition flex items-center gap-1 mr-1 cursor-pointer"
                            title={`Mark ${student.name} Present for all 6 periods today`}
                          >
                            <Check className="w-3 h-3 text-emerald-600" />
                            Full Day
                          </button>
                          <button
                            onClick={() => handleMarkPeriodStatus(student.id, selectedPeriod, 'Present')}
                            className={`p-1.5 rounded-lg border transition ${
                              activeStatus === 'Present'
                                ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
                                : 'bg-white border-slate-200 text-slate-500 hover:bg-emerald-50 hover:text-emerald-700'
                            }`}
                            title={`Mark Present for Period ${selectedPeriod}`}
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleMarkPeriodStatus(student.id, selectedPeriod, 'Absent')}
                            className={`p-1.5 rounded-lg border transition ${
                              activeStatus === 'Absent'
                                ? 'bg-rose-600 border-rose-600 text-white shadow-xs'
                                : 'bg-white border-slate-200 text-slate-500 hover:bg-rose-50 hover:text-rose-700'
                            }`}
                            title={`Mark Absent for Period ${selectedPeriod}`}
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleMarkPeriodStatus(student.id, selectedPeriod, 'Late')}
                            className={`p-1.5 rounded-lg border transition ${
                              activeStatus === 'Late'
                                ? 'bg-amber-600 border-amber-600 text-white shadow-xs'
                                : 'bg-white border-slate-200 text-slate-500 hover:bg-amber-50 hover:text-amber-700'
                            }`}
                            title={`Mark Late for Period ${selectedPeriod}`}
                          >
                            <AlertCircle className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Sticky Submission Bottom Action Bar */}
            <div className="sticky bottom-4 z-20 mx-3 sm:mx-6 my-4 bg-slate-900/95 backdrop-blur-md text-white p-3.5 sm:px-6 rounded-2xl shadow-2xl border border-slate-700/60 flex flex-col sm:flex-row items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center shrink-0">
                  <CheckCheck className="w-4 h-4 text-indigo-400" />
                </div>
                <div>
                  <p className="text-xs font-black text-white">
                    {formatCleanClass(selectedClass)} · {formatCleanSection(selectedSection)} (Period {selectedPeriod})
                  </p>
                  <p className="text-[11px] text-slate-300 font-medium">
                    {baseSectionStudents.length} Students ·{' '}
                    <span className="text-emerald-400 font-bold">{dayStats.presentCount} Present</span>
                    {dayStats.absentAnyCount > 0 && (
                      <span className="text-rose-400 font-bold"> · {dayStats.absentAnyCount} Absent</span>
                    )}
                    {dayStats.unmarkedCount > 0 && (
                      <span className="text-amber-400 font-bold"> · {dayStats.unmarkedCount} Unmarked</span>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={() => setNavStep('sections')}
                  className="px-3.5 py-2 text-xs font-bold text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmitAttendance}
                  disabled={isSubmittingAttendance || isBulkMarking || baseSectionStudents.length === 0}
                  className="px-6 py-2 rounded-xl text-xs font-extrabold bg-gradient-to-r from-indigo-500 via-indigo-600 to-violet-600 hover:from-indigo-600 hover:to-violet-700 active:scale-95 text-white shadow-lg shadow-indigo-500/30 transition flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isSubmittingAttendance ? 'Submitting Attendance...' : 'Submit Attendance'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
