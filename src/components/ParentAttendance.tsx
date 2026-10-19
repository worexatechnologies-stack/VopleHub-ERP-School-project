import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Calendar,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  GraduationCap,
  Loader2,
  TrendingUp,
  User,
  Users,
  XCircle
} from 'lucide-react';
import { useGetAttendanceQuery, type AttendanceRecord, type AttendanceStatus } from '../store/api/attendanceApi';
import { useGetStudentsQuery } from '../store/api/studentApi';

function formatLocalDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(str: string): Date {
  const parts = (str || '').split('-').map(Number);
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
  }
  return new Date();
}

export default function ParentAttendance() {
  // Queries
  const { data: wards = [], isLoading: wardsLoading } = useGetStudentsQuery();
  const { data: allRecords = [], isLoading: attendanceLoading } = useGetAttendanceQuery();

  // Selected Ward
  const [selectedWardId, setSelectedWardId] = useState<string>('');

  React.useEffect(() => {
    if (wards.length > 0) {
      if (!selectedWardId || !wards.some(w => String(w.id) === selectedWardId)) {
        setSelectedWardId(String(wards[0].id));
      }
    }
  }, [wards, selectedWardId]);

  // Today's date ISO string (e.g. "2026-08-29") to cap future dates
  const todayString = useMemo(() => formatLocalDate(new Date()), []);

  // Selected Date for the "Particular Day" Inspector (strictly capped at today)
  const [selectedDate, setSelectedDate] = useState<string>(() => formatLocalDate(new Date()));

  const isSelectedTodayOrFuture = selectedDate >= todayString;

  // Selected Ward details
  const activeWard = useMemo(() => {
    if (wards.length === 0) return null;
    return wards.find(w => String(w.id) === selectedWardId) || wards[0] || null;
  }, [wards, selectedWardId]);

  // Filter records strictly by active ward
  const wardFilteredRecords = useMemo(() => {
    if (!activeWard) return [];
    return allRecords.filter(r => String(r.studentId) === String(activeWard.id));
  }, [allRecords, activeWard]);

  // Map of date string -> AttendanceRecord[]
  const recordsByDate = useMemo(() => {
    const map = new Map<string, AttendanceRecord[]>();
    wardFilteredRecords.forEach(r => {
      const list = map.get(r.date) || [];
      list.push(r);
      map.set(r.date, list);
    });
    // Sort each day's records by period ascending
    map.forEach(list => list.sort((a, b) => a.period - b.period));
    return map;
  }, [wardFilteredRecords]);

  // Sorted list of all recorded dates (most recent first)
  const recordedDates = useMemo(() => {
    return Array.from(recordsByDate.keys()).sort((a, b) => b.localeCompare(a));
  }, [recordsByDate]);

  // If selectedDate has no records but there are recorded dates, let user pick from available or keep today
  const selectedDayRecords = useMemo(() => {
    return recordsByDate.get(selectedDate) || [];
  }, [recordsByDate, selectedDate]);

  // Stats for the selected particular day
  const dayStats = useMemo(() => {
    const total = selectedDayRecords.length;
    const present = selectedDayRecords.filter(r => r.status === 'Present').length;
    const absent = selectedDayRecords.filter(r => r.status === 'Absent').length;
    const late = selectedDayRecords.filter(r => r.status === 'Late').length;
    const halfDay = selectedDayRecords.filter(r => r.status === 'Half-day').length;

    let daySummary: 'Full Present' | 'Partial Absence' | 'Full Absent' | 'No Records' = 'No Records';
    if (total > 0) {
      if (present === total) daySummary = 'Full Present';
      else if (absent === total) daySummary = 'Full Absent';
      else daySummary = 'Partial Absence';
    }

    return { total, present, absent, late, halfDay, daySummary };
  }, [selectedDayRecords]);

  // Overall statistics for the selected ward
  const overallStats = useMemo(() => {
    const total = wardFilteredRecords.length;
    const present = wardFilteredRecords.filter(r => r.status === 'Present').length;
    const absent = wardFilteredRecords.filter(r => r.status === 'Absent').length;
    const late = wardFilteredRecords.filter(r => r.status === 'Late').length;
    const halfDay = wardFilteredRecords.filter(r => r.status === 'Half-day').length;
    const rate = total > 0 ? Math.round(((present + halfDay * 0.5) / total) * 100) : 0;
    return { total, present, absent, late, halfDay, rate };
  }, [wardFilteredRecords]);

  // Subject-wise statistics
  const subjectStats = useMemo(() => {
    const map = new Map<string, { total: number; present: number; absent: number; late: number; halfDay: number }>();
    wardFilteredRecords.forEach(r => {
      const subj = r.subjectName || `Period ${r.period}`;
      const item = map.get(subj) || { total: 0, present: 0, absent: 0, late: 0, halfDay: 0 };
      item.total += 1;
      if (r.status === 'Present') item.present += 1;
      else if (r.status === 'Absent') item.absent += 1;
      else if (r.status === 'Late') item.late += 1;
      else if (r.status === 'Half-day') item.halfDay += 1;
      map.set(subj, item);
    });

    return Array.from(map.entries()).map(([name, s]) => ({
      name,
      total: s.total,
      present: s.present,
      absent: s.absent,
      rate: Math.round(((s.present + s.halfDay * 0.5) / s.total) * 100),
    }));
  }, [wardFilteredRecords]);

  // Day navigation helpers (strictly capped at todayString)
  const handleShiftDay = (days: number) => {
    const curr = parseLocalDate(selectedDate);
    curr.setDate(curr.getDate() + days);
    const newDateStr = formatLocalDate(curr);
    if (newDateStr > todayString) {
      setSelectedDate(todayString);
    } else {
      setSelectedDate(newDateStr);
    }
  };

  const handleSetToday = () => {
    setSelectedDate(todayString);
  };

  const handleSetYesterday = () => {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yStr = formatLocalDate(y);
    setSelectedDate(yStr > todayString ? todayString : yStr);
  };

  const isLoading = wardsLoading || attendanceLoading;

  if (isLoading) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-rose-500" />
        <p className="text-sm font-semibold">Loading ward attendance records...</p>
      </div>
    );
  }

  return (
    <section className="space-y-6 animate-fade-in pb-12" id="parent-ward-attendance">
      {/* Header Banner */}
      <header className="portal-header-card flex flex-col lg:flex-row justify-between lg:items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-md shadow-indigo-100 shrink-0">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="portal-pill-badge indigo">Parent Portal</span>
              <span className="text-[11px] font-bold text-slate-400">Daily Period Tracker</span>
            </div>
            <h1 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">Ward Attendance</h1>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              View day-by-day attendance logs for your child. See exactly which periods they were present, absent, or late on any particular date.
            </p>
          </div>
        </div>

        {/* Ward Switcher if multiple children */}
        {wards.length > 1 && (
          <div className="bg-slate-50 p-2.5 rounded-2xl border border-slate-200/80 self-start lg:self-center">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 px-1">
              Select Child
            </label>
            <select
              value={selectedWardId}
              onChange={e => setSelectedWardId(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 shadow-2xs focus:outline-none focus:ring-2 focus:ring-indigo-400 cursor-pointer"
            >
              {wards.map(w => (
                <option key={w.id} value={String(w.id)}>
                  {w.name} ({w.class} {w.section ? `- ${w.section}` : ''})
                </option>
              ))}
            </select>
          </div>
        )}
      </header>

      {/* Ward Profile Strip */}
      {activeWard && (
        <div className="portal-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="h-12 w-12 rounded-2xl bg-rose-50 text-rose-600 border border-rose-100 flex items-center justify-center font-black text-lg">
              {activeWard.name ? activeWard.name.charAt(0).toUpperCase() : 'S'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-slate-900">{activeWard.name}</h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-extrabold text-slate-600">
                  {activeWard.class} {activeWard.section ? `(${activeWard.section})` : ''}
                </span>
              </div>
              <p className="text-xs font-semibold text-slate-500 mt-0.5">
                Admission No: <span className="font-mono text-slate-700">{activeWard.admissionNo || '—'}</span>
                {activeWard.rollNo ? ` · Roll No: ${activeWard.rollNo}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-xl border border-slate-100">
            <TrendingUp className="h-4 w-4 text-emerald-600" />
            <div className="text-right">
              <span className="text-xs font-bold text-slate-500 block">Overall Attendance Rate</span>
              <span className="text-base font-black text-emerald-700">{overallStats.rate}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Overall Attendance Metrics Row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Overall Attendance"
          value={`${overallStats.rate}%`}
          detail={`${overallStats.present} of ${overallStats.total} periods attended`}
          icon={<CalendarDays className="h-5 w-5" />}
          tone="indigo"
        />
        <MetricCard
          label="Periods Present"
          value={overallStats.present}
          detail="Classes fully attended"
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="emerald"
        />
        <MetricCard
          label="Periods Absent"
          value={overallStats.absent}
          detail="Classes missed"
          icon={<XCircle className="h-5 w-5" />}
          tone="rose"
        />
        <MetricCard
          label="Late / Half-Day"
          value={overallStats.late + overallStats.halfDay}
          detail={`${overallStats.late} late arrivals · ${overallStats.halfDay} half-day`}
          icon={<Clock className="h-5 w-5" />}
          tone="amber"
        />
      </div>

      {/* --- PARTICULAR DAY ATTENDANCE INSPECTOR --- */}
      <div className="space-y-4">
        <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-sm space-y-6">
          {/* Day Selector Navigation Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
            <div>
              <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <Calendar className="h-5 w-5 text-rose-500" />
                Daily Period Breakdown
              </h2>
              <p className="text-xs font-semibold text-slate-500 mt-0.5">
                Select any date to see exact period-wise status (Present / Absent).
              </p>
            </div>

            {/* Date Pickers & Navigation Controls (Date cannot exceed today) */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => handleShiftDay(-1)}
                  title="Previous Day"
                  className="p-1.5 rounded-lg hover:bg-white text-slate-600 hover:text-slate-900 transition-all cursor-pointer"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <input
                  type="date"
                  max={todayString}
                  value={selectedDate}
                  onChange={e => {
                    const val = e.target.value;
                    if (val) {
                      if (val > todayString) {
                        setSelectedDate(todayString);
                      } else {
                        setSelectedDate(val);
                      }
                    }
                  }}
                  className="bg-transparent border-0 text-xs font-black text-slate-800 px-2.5 py-1 focus:outline-none cursor-pointer"
                />
                <button
                  type="button"
                  onClick={() => handleShiftDay(1)}
                  disabled={isSelectedTodayOrFuture}
                  title={isSelectedTodayOrFuture ? 'Date cannot exceed today' : 'Next Day'}
                  className={`p-1.5 rounded-lg transition-all ${
                    isSelectedTodayOrFuture
                      ? 'opacity-25 cursor-not-allowed text-slate-400'
                      : 'hover:bg-white text-slate-600 hover:text-slate-900 cursor-pointer'
                  }`}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={handleSetToday}
                className={`rounded-xl px-3 py-2 text-xs font-black transition-all cursor-pointer ${
                  selectedDate === todayString
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Today
              </button>
              <button
                type="button"
                onClick={handleSetYesterday}
                className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-200 transition-all cursor-pointer"
              >
                Yesterday
              </button>
            </div>
          </div>

          {/* Selected Day Status Summary Banner */}
          <div className="rounded-2xl bg-gradient-to-r from-slate-50 via-slate-50 to-indigo-50/40 p-5 border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Selected Date Log
              </span>
              <h3 className="text-xl font-black text-slate-900 mt-0.5">
                {parseLocalDate(selectedDate).toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </h3>
            </div>

            {/* Day Status Pill */}
            <div>
              {dayStats.total === 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3.5 py-2 text-xs font-extrabold text-slate-600 border border-slate-200">
                  <AlertCircle className="h-4 w-4 text-slate-400" />
                  No Attendance Logged For This Date
                </span>
              ) : dayStats.daySummary === 'Full Present' ? (
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 px-4 py-2 text-xs font-black text-emerald-800 border border-emerald-200 shadow-sm">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Full Day Present ({dayStats.present}/{dayStats.total} Periods)
                </span>
              ) : dayStats.daySummary === 'Full Absent' ? (
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-rose-50 px-4 py-2 text-xs font-black text-rose-800 border border-rose-200 shadow-sm">
                  <XCircle className="h-4 w-4 text-rose-600" />
                  Full Day Absent (0/{dayStats.total} Periods Attended)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-amber-50 px-4 py-2 text-xs font-black text-amber-800 border border-amber-200 shadow-sm">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  Partial Day ({dayStats.present}/{dayStats.total} Present · {dayStats.absent} Absent)
                </span>
              )}
            </div>
          </div>

          {/* Period-by-Period Grid for the Selected Day */}
          {selectedDayRecords.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-10 text-center text-slate-500">
              <Calendar className="mx-auto h-8 w-8 text-slate-400 mb-2" />
              <p className="text-sm font-extrabold text-slate-800">
                No classes or attendance records recorded on this day.
              </p>
              <p className="text-xs text-slate-500 mt-1">
                This date might be a weekend, holiday, or attendance has not yet been marked by teachers.
              </p>
              {recordedDates.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs">
                  <span className="font-bold text-slate-400">Jump to recent recorded date:</span>
                  {recordedDates.slice(0, 4).map(d => (
                    <button
                      key={d}
                      onClick={() => setSelectedDate(d)}
                      className="rounded-lg bg-indigo-50 px-2.5 py-1 font-extrabold text-indigo-700 hover:bg-indigo-100 border border-indigo-100"
                    >
                      {new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-bold text-slate-500 px-1">
                <span>Period Breakdown ({selectedDayRecords.length} Sessions)</span>
                <span className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {dayStats.present} Present
                  </span>
                  <span className="flex items-center gap-1 text-rose-700">
                    <XCircle className="h-3.5 w-3.5" /> {dayStats.absent} Absent
                  </span>
                  {dayStats.late > 0 && (
                    <span className="flex items-center gap-1 text-amber-700">
                      <Clock className="h-3.5 w-3.5" /> {dayStats.late} Late
                    </span>
                  )}
                </span>
              </div>

              {/* Period Cards Grid */}
              <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                {selectedDayRecords.map(record => {
                  const isPresent = record.status === 'Present';
                  const isAbsent = record.status === 'Absent';
                  const isLate = record.status === 'Late';
                  const isHalfDay = record.status === 'Half-day';

                  return (
                    <div
                      key={record.id}
                      className={`rounded-2xl border p-4 transition-all shadow-sm flex flex-col justify-between space-y-3 ${
                        isAbsent
                          ? 'bg-rose-50/50 border-rose-300 ring-1 ring-rose-200'
                          : isLate
                          ? 'bg-amber-50/40 border-amber-200'
                          : isHalfDay
                          ? 'bg-purple-50/40 border-purple-200'
                          : 'bg-white border-slate-200/90 hover:border-emerald-300'
                      }`}
                    >
                      {/* Card Top: Period # and Status Badge */}
                      <div className="flex items-center justify-between">
                        <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-mono text-[11px] font-black text-slate-800">
                          Period {record.period}
                        </span>
                        <StatusBadge status={record.status} />
                      </div>

                      {/* Card Middle: Subject & Teacher */}
                      <div>
                        <h4 className="text-base font-black text-slate-900 leading-snug">
                          {record.subjectName || `Subject Period ${record.period}`}
                        </h4>
                        {record.timeLabel && (
                          <p className="text-[11px] font-semibold text-slate-400 mt-0.5 flex items-center gap-1">
                            <Clock className="h-3 w-3" /> {record.timeLabel}
                          </p>
                        )}
                        {record.teacherName && (
                          <p className="text-xs font-medium text-slate-500 mt-1.5 flex items-center gap-1">
                            <User className="h-3.5 w-3.5 text-slate-400" />
                            <span>{record.teacherName}</span>
                          </p>
                        )}
                      </div>

                      {/* Card Bottom: Informative Note if Absent */}
                      {isAbsent ? (
                        <div className="rounded-xl bg-rose-100/70 p-2 text-[11px] font-bold text-rose-800 flex items-center gap-1.5">
                          <XCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                          <span>Ward was absent for this period.</span>
                        </div>
                      ) : isPresent ? (
                        <div className="text-[11px] font-semibold text-emerald-700 flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          <span>Attended on time</span>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>


        {/* Subject-Wise Summary */}
        {subjectStats.length > 0 && (
          <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <BookOpen className="h-5 w-5 text-indigo-600" />
              <h3 className="text-base font-black text-slate-900">Subject-Wise Attendance Breakdown</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {subjectStats.map(st => (
                <div
                  key={st.name}
                  className="rounded-2xl bg-slate-50 p-4 border border-slate-200 flex flex-col justify-between space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-xs text-slate-900 truncate" title={st.name}>
                      {st.name}
                    </span>
                    <span
                      className={`text-[10px] font-black px-2.5 py-0.5 rounded-full ${
                        st.rate >= 90
                          ? 'bg-emerald-100 text-emerald-800'
                          : st.rate >= 75
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {st.rate}%
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Total: <strong className="text-slate-700">{st.total}</strong> · Attended:{' '}
                    <strong className="text-emerald-700">{st.present}</strong>
                    {st.absent > 0 && (
                      <span>
                        {' '}
                        · Missed: <strong className="text-rose-700">{st.absent}</strong>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: React.ReactNode;
  tone: 'indigo' | 'emerald' | 'rose' | 'amber';
}) {
  const styles = {
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    rose: 'bg-rose-50 text-rose-600 border-rose-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
  };

  return (
    <div className="portal-card p-5">
      <div className="flex items-center justify-between">
        <div className={`inline-flex rounded-xl p-2.5 border ${styles[tone]}`}>{icon}</div>
        <span className="text-2xl font-black text-slate-900">{value}</span>
      </div>
      <p className="mt-3 text-xs font-bold text-slate-800">{label}</p>
      <p className="text-[11px] text-slate-400 font-medium mt-0.5">{detail}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: AttendanceStatus }) {
  const style =
    status === 'Present'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : status === 'Absent'
      ? 'bg-rose-50 text-rose-700 border-rose-200'
      : status === 'Late'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-purple-50 text-purple-700 border-purple-200';

  const Icon = status === 'Present' ? CheckCircle2 : status === 'Absent' ? XCircle : AlertCircle;

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-extrabold border ${style}`}>
      <Icon className="h-3.5 w-3.5" />
      {status}
    </span>
  );
}
