import React, { useEffect, useMemo, useState } from 'react';
import { Clock, Calendar, MapPin, User, Bell, Shield, BookOpen, AlertCircle, FileText, ArrowRight, Printer } from 'lucide-react';
import { DayOfWeek, TimetableSlot, SchoolTimingConfig, TimetableNotification } from './types';
import { generatePeriodsList, DAYS_OF_WEEK } from './utils';
import TimetableGrid from './TimetableGrid';
import { Student } from '../../types';
import { loadVisibleSubjects, SubjectVisibility } from '../../services/subjectVisibility';

interface TimetableViewProps {
  user: any; // AuthUser
  students: Student[];
  slots: TimetableSlot[];
  timingConfig: SchoolTimingConfig;
  notifications: TimetableNotification[];
}

export default function TimetableView({
  user,
  students,
  slots,
  timingConfig,
  notifications
}: TimetableViewProps) {
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>('Monday');
  const [displayMode, setDisplayMode] = useState<'daily' | 'weekly'>('weekly');
  const [subjectVisibility, setSubjectVisibility] = useState<SubjectVisibility | null>(null);
  const [subjectVisibilityError, setSubjectVisibilityError] = useState('');

  useEffect(() => {
    let active = true;
    loadVisibleSubjects()
      .then((payload) => {
        if (!active) return;
        setSubjectVisibility(payload);
        setSubjectVisibilityError('');
      })
      .catch((error) => {
        if (!active) return;
        setSubjectVisibility(null);
        setSubjectVisibilityError(error instanceof Error ? error.message : 'Assigned subjects could not be loaded.');
      });
    return () => { active = false; };
  }, [user.id, user.role]);

  // 1. Resolve perspective variables based on user role
  const linkedChildren = useMemo(() => {
    if (user.role !== 'Parent') return [];
    const linkedStudentIds = Array.isArray(user.parentStudentIds)
      ? user.parentStudentIds.map(String)
      : [];
    const matched = students.filter((student) => linkedStudentIds.includes(String(student.id)));
    return matched.length > 0 ? matched : students;
  }, [user.role, user.parentStudentIds, students]);

  const [selectedChildId, setSelectedChildId] = useState<string>('all');

  const activeChild = useMemo(() => {
    if (user.role !== 'Parent') return null;
    if (selectedChildId !== 'all') {
      return linkedChildren.find((c) => String(c.id) === selectedChildId) || linkedChildren[0] || null;
    }
    return linkedChildren[0] || null;
  }, [user.role, selectedChildId, linkedChildren]);

  let userClass = '';
  let userSection = '';
  let teacherId = '';
  let headingText = 'My Academic Schedule';
  let subtitleText = 'Weekly and daily academic timetables, school hours, and live alerts.';

  // If Parent, find child's class and section
  if (user.role === 'Parent') {
    if (activeChild) {
      userClass = activeChild.class;
      userSection = activeChild.section;
      headingText = selectedChildId === 'all' && linkedChildren.length > 1
        ? `Ward Timetable: ${activeChild.name} (Select Child to Switch)`
        : `Ward Timetable: ${activeChild.name}`;
      subtitleText = `Viewing official academic schedule for ${activeChild.name} (${activeChild.class}-${activeChild.section}).`;
    } else {
      headingText = "Child's Class Timetable";
    }
  }

  // If Student, find their class and section
  if (user.role === 'Student') {
    const student = students.find(s => s.id === user.studentId || s.name === user.name);
    if (student) {
      userClass = student.class;
      userSection = student.section;
    }
    headingText = userClass && userSection ? `My Class Timetable (${userClass}-${userSection})` : 'My Class Timetable';
    subtitleText = `Track your daily periods, subjects, instructors, and class venues.`;
  }

  // Resolve the authenticated teacher from the server-provided teacherId
  // (from /subjects/visible/) or from persisted timetable assignments.
  if (user.role === 'Teacher') {
    teacherId = String(subjectVisibility?.teacherId || '');
    // Fallback: match by teacher name from the actual timetable slots
    if (!teacherId) {
      const assignedSlot = slots.find((slot) => slot.teacherName.trim().toLowerCase() === String(user.name || '').trim().toLowerCase());
      teacherId = String(assignedSlot?.teacherId || '');
    }
    if (!teacherId && slots.length > 0 && slots[0].teacherId) {
      teacherId = String(slots[0].teacherId);
    }
    headingText = `Teacher Lecture Schedule: ${user.name}`;
    subtitleText = `Track your assigned lecture hours, class periods, and room assignments.`;
  }

  // Filter notifications relevant to this user
  const relevantNotifications = notifications.filter(notif => {
    if (user.role === 'Student' || user.role === 'Parent') {
      return !notif.targetClass || notif.targetClass === userClass;
    }
    if (user.role === 'Teacher') {
      return notif.targetRole === 'Teacher' || !notif.targetRole || notif.targetRole === 'all';
    }
    return true;
  });

  const allBlocks = generatePeriodsList(timingConfig);
  const activeDays = timingConfig.workingDays;

  // Filter slots for daily timeline view
  const activeDayClassSlots = slots.filter(s => 
    s.class === userClass && 
    s.section === userSection && 
    s.day === selectedDay && 
    s.published
  );

  const activeDayTeacherSlots = slots.filter(s => 
    (!teacherId || String(s.teacherId) === String(teacherId)) && 
    s.day === selectedDay
  );

  const perspectivePublishedSlots = useMemo(() => {
    if (user.role === 'Teacher') {
      return slots.filter((slot) => !teacherId || String(slot.teacherId) === String(teacherId));
    }
    const published = slots.filter((slot) => slot.published);
    return published.filter((slot) => slot.class === userClass && slot.section === userSection);
  }, [slots, teacherId, user.role, userClass, userSection]);
  const scheduledSubjectNames = useMemo(
    () => new Set(perspectivePublishedSlots.map((slot) => slot.subject.trim().toLocaleLowerCase())),
    [perspectivePublishedSlots],
  );

  return (
    <div className="space-y-6 animate-fade-in" id="timetable-view-portal">
      {/* Portal Header Card */}
      <div className="portal-header-card flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shrink-0">
            <Clock className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="portal-pill-badge indigo mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block"></span>
              Active Session Timetable
            </div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight leading-tight">{headingText}</h2>
            <p className="text-sm text-slate-500 mt-0.5">{subtitleText}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Child Switcher for Parents with multiple children */}
          {user.role === 'Parent' && linkedChildren.length > 1 && (
            <div className="bg-slate-50 px-3 py-2 rounded-2xl border border-slate-200 flex items-center gap-2">
              <label className="text-xs font-bold text-slate-500">
                Child:
              </label>
              <select
                value={selectedChildId}
                onChange={(e) => setSelectedChildId(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                <option value="all">All Linked Children</option>
                {linkedChildren.map((w) => (
                  <option key={w.id} value={String(w.id)}>
                    {w.name} ({w.class} {w.section ? `- ${w.section}` : ''})
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={() => setDisplayMode(displayMode === 'daily' ? 'weekly' : 'daily')}
            className="portal-btn-secondary text-xs"
          >
            <Calendar className="w-3.5 h-3.5 text-slate-500" />
            {displayMode === 'daily' ? 'Weekly Grid' : 'Daily Agenda'}
          </button>
          <button
            onClick={() => window.print()}
            className="portal-btn-secondary text-xs"
          >
            <Printer className="w-3.5 h-3.5 text-slate-500" />
            Print
          </button>
        </div>
      </div>

      {/* Quick Child Switcher Pills */}
      {user.role === 'Parent' && linkedChildren.length > 1 && (
        <div className="portal-card px-5 py-4 flex flex-wrap items-center gap-2.5">
          <span className="text-xs font-bold text-slate-500 mr-1">Switch Ward:</span>
          {linkedChildren.map((child) => {
            const isSelected = activeChild?.id === child.id;
            return (
              <button
                key={child.id}
                type="button"
                onClick={() => setSelectedChildId(String(child.id))}
                className={`px-3 py-1.5 rounded-2xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-50 text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200'
                }`}
              >
                <span>{child.name}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono font-bold ${isSelected ? 'bg-white/25 text-white' : 'bg-slate-200 text-slate-600'}`}>
                  {child.class}-{child.section}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main schedule view */}
        <div className="lg:col-span-3 space-y-5">
          {displayMode === 'weekly' ? (
            <TimetableGrid
              slots={user.role === 'Teacher' ? slots : slots.filter(s => s.published)}
              timingConfig={timingConfig}
              viewMode={user.role === 'Teacher' ? 'teacher' : 'class'}
              selectedClass={userClass}
              selectedSection={userSection}
              selectedTeacherId={teacherId}
              selectedSubject=""
              selectedDay="Monday"
              canEdit={false}
            />
          ) : (
            // DAILY AGENDA VIEW
            <div className="portal-card p-6 space-y-5">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Daily Class Timeline</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Chronological layout of classes and breaks for <span className="font-semibold text-slate-700">{selectedDay}</span>.</p>
                </div>
                {/* Day selector */}
                <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-2xl">
                  {activeDays.map(d => (
                    <button
                      key={d}
                      onClick={() => setSelectedDay(d)}
                      className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-all ${
                        selectedDay === d 
                          ? 'bg-white text-indigo-700 shadow-sm' 
                          : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'
                      }`}
                    >
                      {d.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Timeline blocks */}
              <div className="space-y-3">
                {allBlocks.map((block, idx) => {
                  if (block.type === 'break') {
                    return (
                      <div key={idx} className="flex items-center gap-4 p-3.5 bg-amber-50/60 border border-amber-100 border-dashed rounded-2xl justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-[10px] font-mono shrink-0">
                            REC
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-slate-700">Recess Break</h4>
                            <p className="text-[10px] text-slate-500 font-mono mt-0.5">{block.timeLabel}</p>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full">
                          {timingConfig.breakDuration} mins
                        </span>
                      </div>
                    );
                  }

                  if (block.type === 'lunch') {
                    return (
                      <div key={idx} className="flex items-center gap-4 p-3.5 bg-emerald-50/60 border border-emerald-100 border-dashed rounded-2xl justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-[10px] font-mono shrink-0">
                            LUN
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-slate-700">Lunch Break Recess</h4>
                            <p className="text-[10px] text-slate-500 font-mono mt-0.5">{block.timeLabel}</p>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full">
                          {timingConfig.lunchDuration} mins
                        </span>
                      </div>
                    );
                  }

                  // Resolve scheduled slots
                  const slot = user.role === 'Teacher' 
                    ? activeDayTeacherSlots.find(s => s.period === block.periodNumber)
                    : activeDayClassSlots.find(s => s.period === block.periodNumber);

                  return (
                    <div
                      key={idx}
                      className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${
                        slot 
                          ? 'bg-white border-indigo-100/60 hover:border-indigo-200 hover:shadow-sm' 
                          : 'bg-slate-50/40 border-slate-100 border-dashed'
                      }`}
                    >
                      <div className={`w-12 h-12 rounded-2xl flex flex-col items-center justify-center font-bold border shrink-0 ${
                        slot 
                          ? 'bg-indigo-50 text-indigo-700 border-indigo-100' 
                          : 'bg-slate-50 text-slate-400 border-slate-100'
                      }`}>
                        <span className="text-[8px] text-slate-400 font-mono leading-none">PD</span>
                        <span className="text-lg font-black mt-0.5 leading-none">{block.periodNumber}</span>
                      </div>

                      <div className="flex-1 min-w-0">
                        {slot ? (
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="text-sm font-bold text-slate-800">{slot.subject}</h4>
                              <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
                                {block.timeLabel}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5">
                              {user.role === 'Teacher' ? (
                                <span className="flex items-center gap-1 text-xs font-bold text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-100">
                                  Class: {slot.class} - {slot.section}
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-xs text-slate-500">
                                  <User className="w-3.5 h-3.5 text-slate-400" />
                                  {slot.teacherName}
                                </span>
                              )}
                              <span className="flex items-center gap-1 text-xs text-slate-500">
                                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                                {slot.classroom}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <h4 className="text-sm font-semibold text-slate-400">Unscheduled Slot</h4>
                            <p className="text-xs text-slate-400 font-mono mt-0.5">{block.timeLabel}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar panels */}
        <div className="space-y-5">
          {/* My Subjects card */}
          <div className="portal-card p-5 space-y-4">
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
                <BookOpen className="h-4 w-4 text-indigo-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">My Subjects</h3>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Assigned subjects from Academic Setup. Green = published period exists.
                </p>
              </div>
            </div>
            <div className="border-t border-slate-100 pt-3">
              {subjectVisibilityError ? (
                <p className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                  {subjectVisibilityError}
                </p>
              ) : subjectVisibility === null ? (
                <p className="text-xs font-semibold text-slate-400">Loading assigned subjects…</p>
              ) : subjectVisibility.subjects.length === 0 ? (
                <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-800">
                  No subjects assigned yet. Admin must configure subjects for this class/teacher.
                </p>
              ) : (
                <div className="space-y-2">
                  {subjectVisibility.subjects.map((subject) => {
                    const scheduled = scheduledSubjectNames.has(subject.name.trim().toLocaleLowerCase());
                    return (
                      <div key={subject.id} className="rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-2.5 hover:bg-indigo-50/40 hover:border-indigo-100 transition-all">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-bold text-slate-800">{subject.name}</span>
                          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide ${
                            scheduled ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-slate-200 text-slate-500'
                          }`}>
                            {scheduled ? 'Published' : 'Pending'}
                          </span>
                        </div>
                        {subject.scopes.length > 0 && (
                          <p className="mt-1 truncate text-[10px] text-slate-500">
                            {subject.scopes.map((scope) => `${scope.className}-${scope.sectionName}`).join(', ')}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Timetable Notifications */}
          <div className="portal-card p-5 space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                <Bell className="w-4 h-4 text-amber-500" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">Timetable Broadcasts</h3>
            </div>
            <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
              {relevantNotifications.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-xs">
                  No active timetable alerts.
                </div>
              ) : (
                relevantNotifications.map(notif => (
                  <div key={notif.id} className="p-3.5 bg-amber-50/60 border border-amber-100 rounded-2xl space-y-1">
                    <div className="flex justify-between items-start">
                      <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full uppercase tracking-wide">
                        REVISED
                      </span>
                      <span className="text-[9px] text-slate-400 font-mono">
                        {new Date(notif.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <h4 className="text-xs font-bold text-slate-800 leading-tight">{notif.title}</h4>
                    <p className="text-[10px] text-slate-500 leading-relaxed">{notif.message}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* School Timings summary Card */}
          <div className="portal-card p-5 space-y-4 bg-gradient-to-br from-indigo-50/60 to-violet-50/40">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4 text-indigo-600" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-800">School Timing Rules</h4>
                <p className="text-[10px] text-slate-500 mt-0.5">Official hours of attendance & operations.</p>
              </div>
            </div>

            <div className="space-y-2 text-xs border-t border-indigo-100 pt-3">
              {[
                { label: 'Class Starts', value: `${timingConfig.startTime} AM` },
                { label: 'Duration/Period', value: `${timingConfig.periodDuration} Mins` },
                { label: 'Morning Recess', value: `${timingConfig.breakDuration} Mins` },
                { label: 'Lunch Hour', value: `${timingConfig.lunchDuration} Mins` },
                { label: 'Weekly Classes', value: `${activeDays.length} Days` },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-center py-1.5 border-b border-indigo-100/70 last:border-0">
                  <span className="text-slate-500 font-medium">{label}</span>
                  <span className="font-bold text-slate-800 font-mono">{value}</span>
                </div>
              ))}
            </div>
            <div className="text-[10px] text-indigo-500/80 leading-normal border-t border-indigo-100 pt-2">
              Attendance rosters lock 15 minutes after the first period bell.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
