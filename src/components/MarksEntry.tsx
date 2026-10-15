import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Award,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit3,
  FilePenLine,
  FileText,
  GraduationCap,
  Info,
  Layers,
  Lock,
  LockKeyhole,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  RotateCcw,
  Star,
  X,
  User,
  Users,
} from 'lucide-react';
import { ExamSchedule, Student } from '../types';
import type { AuthUser } from '../utils/auth';
import { emitNotification } from '../services/notificationBus';
import AuthenticatedImage from './AuthenticatedImage';
import {
  useGetExamSchedulesQuery,
  useGetMarksSheetQuery,
  useSaveMarksSheetMutation,
  usePublishMarksSheetMutation,
  useExtendMarksEntryMutation,
  useResetMarksEntryMutation,
  type ExamTimetableRecord,
} from '../store/api/examApi';

export default function MarksEntry({
  user,
  students = [],
}: {
  user: AuthUser;
  students?: Student[];
  exams?: ExamSchedule[];
}) {
  const isAdmin = user.role === 'School Admin' || user.role === 'Super Admin';
  const isTeacher = user.role === 'Teacher';

  // 1. Fetch all Exam Schedules
  const { data: schedules = [], isLoading: schedulesLoading, refetch: refetchSchedules } = useGetExamSchedulesQuery();

  // Admin Navigation Levels: 'exams' (blocks) -> 'sections' -> 'sheet'
  const [adminViewLevel, setAdminViewLevel] = useState<'exams' | 'sections' | 'sheet'>('exams');
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);
  const [selectedSection, setSelectedSection] = useState<string>('');

  // Search & Feedback State
  const [searchQuery, setSearchQuery] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Teacher Filter Preferences ('assigned' vs 'all')
  const [teacherViewFilter, setTeacherViewFilter] = useState<'assigned' | 'all'>('assigned');

  // List of schedules assigned to current teacher
  const teacherAssignedSchedules = useMemo(() => {
    if (!isTeacher) return schedules;
    return schedules.filter(
      (s) =>
        s.is_teacher_assigned ||
        (s.teacher_assigned_sections && s.teacher_assigned_sections.length > 0) ||
        (s.teacher_assigned_subjects && s.teacher_assigned_subjects.length > 0)
    );
  }, [schedules, isTeacher]);

  const teacherDisplayedSchedules = useMemo(() => {
    if (!isTeacher) return schedules;
    if (teacherViewFilter === 'assigned' && teacherAssignedSchedules.length > 0) {
      return teacherAssignedSchedules;
    }
    return schedules;
  }, [schedules, isTeacher, teacherViewFilter, teacherAssignedSchedules]);

  // Selected schedule object
  const activeSchedule: ExamTimetableRecord | null = useMemo(() => {
    if (!schedules.length) return null;
    if (selectedScheduleId) {
      return schedules.find((s) => s.id === selectedScheduleId) || schedules[0];
    }
    if (isTeacher && teacherAssignedSchedules.length > 0) {
      return teacherAssignedSchedules[0];
    }
    return schedules[0];
  }, [schedules, selectedScheduleId, isTeacher, teacherAssignedSchedules]);

  // Set default schedule
  useEffect(() => {
    if (schedules.length && !selectedScheduleId) {
      if (isTeacher) {
        const assigned = schedules.find(
          (s) =>
            s.is_teacher_assigned ||
            (s.teacher_assigned_sections && s.teacher_assigned_sections.length > 0) ||
            (s.teacher_assigned_subjects && s.teacher_assigned_subjects.length > 0)
        );
        if (assigned) {
          setSelectedScheduleId(assigned.id);
          if (assigned.teacher_assigned_sections && assigned.teacher_assigned_sections.length > 0) {
            setSelectedSection(assigned.teacher_assigned_sections[0]);
          }
          return;
        }
      }
      setSelectedScheduleId(schedules[0].id);
    }
  }, [schedules, selectedScheduleId, isTeacher]);

  // When activeSchedule changes for a teacher, if they have an assigned section in that schedule, make sure it is chosen
  useEffect(() => {
    if (isTeacher && activeSchedule) {
      const assignedSecs = activeSchedule.teacher_assigned_sections || [];
      if (assignedSecs.length > 0) {
        if (!selectedSection || !assignedSecs.includes(selectedSection)) {
          setSelectedSection(assignedSecs[0]);
        }
      }
    }
  }, [isTeacher, activeSchedule?.id, activeSchedule?.teacher_assigned_sections, selectedSection]);

  // 2. Fetch Marks Sheet data for the selected schedule and section
  const {
    data: sheetData,
    isLoading: sheetLoading,
    refetch: refetchSheet,
  } = useGetMarksSheetQuery(
    {
      scheduleId: activeSchedule?.id || 0,
      section: selectedSection,
    },
    {
      skip: !activeSchedule?.id,
    }
  );

  // Set default section from sheet data if not selected
  useEffect(() => {
    if (sheetData) {
      if (!selectedSection && sheetData.section) {
        setSelectedSection(sheetData.section);
      }
    }
  }, [sheetData, selectedSection]);

  // Local editable marks state: map of `studentId-subjectName` -> marks string
  const [localMarks, setLocalMarks] = useState<Record<string, string>>({});

  // Populate local marks whenever sheetData changes
  useEffect(() => {
    if (!sheetData?.students) {
      setLocalMarks({});
      return;
    }
    const initialMap: Record<string, string> = {};
    sheetData.students.forEach((student) => {
      sheetData.subjects.forEach((subject) => {
        const entry = student.marks?.[subject.subject_name];
        const key = `${student.student_id}-${subject.subject_name}`;
        initialMap[key] = entry && entry.marks_obtained !== null && entry.marks_obtained !== undefined ? String(entry.marks_obtained) : '';
      });
    });
    setLocalMarks(initialMap);
    setSavedMessage('');
    setErrorMessage('');
  }, [sheetData]);

  const [saveMarksMutation, { isLoading: isSaving }] = useSaveMarksSheetMutation();
  const [publishMarksMutation, { isLoading: isPublishing }] = usePublishMarksSheetMutation();
  const [extendMarksMutation, { isLoading: isExtending }] = useExtendMarksEntryMutation();
  const [resetMarksMutation, { isLoading: isResetting }] = useResetMarksEntryMutation();

  // Admin Extension Modal State
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [extensionTargetSection, setExtensionTargetSection] = useState<string>('all');
  const [extensionDays, setExtensionDays] = useState<number>(3);
  const [customDeadline, setCustomDeadline] = useState<string>('');
  const [extensionReason, setExtensionReason] = useState<string>('');

  // Available sections for the active schedule
  const availableSections = useMemo(() => {
    const set = new Set<string>();
    if (sheetData?.all_sections && sheetData.all_sections.length > 0) {
      sheetData.all_sections.forEach((s) => set.add(s));
    }
    if (sheetData?.sections && sheetData.sections.length > 0) {
      sheetData.sections.forEach((s) => set.add(s));
    }
    if (set.size === 0) {
      set.add('A');
      set.add('B');
    }
    return Array.from(set).sort();
  }, [sheetData]);

  // Section-specific extension metadata for the target section in modal
  const targetSectionExtension = useMemo(() => {
    if (extensionTargetSection === 'all') return null;
    const exts = sheetData?.section_extensions || (activeSchedule?.section_extensions as any) || {};
    return exts[extensionTargetSection] || null;
  }, [extensionTargetSection, sheetData, activeSchedule]);

  const currentTargetDeadline = useMemo(() => {
    if (extensionTargetSection !== 'all' && targetSectionExtension?.deadline) {
      return targetSectionExtension.deadline;
    }
    return sheetData?.marks_entry_deadline || activeSchedule?.marks_entry_deadline;
  }, [extensionTargetSection, targetSectionExtension, sheetData, activeSchedule]);

  const isTargetExtended = useMemo(() => {
    if (extensionTargetSection !== 'all') {
      return !!targetSectionExtension?.extended;
    }
    return !!(sheetData?.marks_entry_extended || activeSchedule?.marks_entry_extended);
  }, [extensionTargetSection, targetSectionExtension, sheetData, activeSchedule]);

  const formatDeadline = (isoString?: string | null) => {
    if (!isoString) return 'Standard 3 days';
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleExtendDeadline = async () => {
    if (!activeSchedule) return;
    setErrorMessage('');
    setSavedMessage('');
    try {
      const payload: any = {
        scheduleId: activeSchedule.id,
        reason: extensionReason.trim() || 'Extension granted by school administrator',
      };
      if (extensionTargetSection && extensionTargetSection !== 'all') {
        payload.section = extensionTargetSection;
      }
      if (customDeadline) {
        payload.deadline = new Date(customDeadline).toISOString();
      } else {
        payload.extension_days = extensionDays;
      }
      const res = await extendMarksMutation(payload).unwrap();
      const scopeDesc = extensionTargetSection && extensionTargetSection !== 'all'
        ? `Section ${extensionTargetSection}`
        : 'All Sections';
      setSavedMessage(res.detail || `Marks entry deadline for ${activeSchedule.class_name} (${scopeDesc}) extended successfully.`);
      emitNotification({
        title: 'Marks Entry Extended',
        message: `${activeSchedule.name} (${activeSchedule.class_name} - ${scopeDesc}) marks entry extended.`,
        tone: 'success',
        source: 'marks-entry',
      });
      setShowExtendModal(false);
      setExtensionReason('');
      setCustomDeadline('');
      void refetchSheet();
      void refetchSchedules();
    } catch (err: any) {
      setErrorMessage(err?.data?.detail || err?.message || 'Failed to extend marks entry deadline.');
    }
  };

  const handleResetDeadline = async () => {
    if (!activeSchedule) return;
    const isSectionSpecific = extensionTargetSection && extensionTargetSection !== 'all';
    const scopeLabel = isSectionSpecific
      ? `Section ${extensionTargetSection}`
      : `all sections of ${activeSchedule.class_name}`;

    if (!window.confirm(`Reset marks entry deadline for ${scopeLabel} to the standard 3-day post-exam window?`)) return;
    setErrorMessage('');
    setSavedMessage('');
    try {
      const res = await resetMarksMutation({
        scheduleId: activeSchedule.id,
        section: isSectionSpecific ? extensionTargetSection : undefined,
      }).unwrap();
      setSavedMessage(res.detail || 'Marks entry deadline reset to default 3 days.');
      setShowExtendModal(false);
      void refetchSheet();
      void refetchSchedules();
    } catch (err: any) {
      setErrorMessage(err?.data?.detail || err?.message || 'Failed to reset marks entry deadline.');
    }
  };

  const handleMarkChange = (studentId: number, subjectName: string, value: string) => {
    const key = `${studentId}-${subjectName}`;
    setLocalMarks((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleKeyDown = (e: React.KeyboardEvent, studentIndex: number, subjectName: string) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = studentIndex + 1;
      const nextInput = document.getElementById(`teacher-mark-${nextIndex}-${subjectName}`);
      if (nextInput) {
        nextInput.focus();
        (nextInput as HTMLInputElement).select?.();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = studentIndex - 1;
      const prevInput = document.getElementById(`teacher-mark-${prevIndex}-${subjectName}`);
      if (prevInput) {
        prevInput.focus();
        (prevInput as HTMLInputElement).select?.();
      }
    }
  };

  // Completion statistics for teacher's editable subjects in current sheet
  const teacherStats = useMemo(() => {
    if (!sheetData?.students || !sheetData?.subjects) {
      return { total: 0, entered: 0, percentage: 0, subjectStats: [], hasEditable: false, allComplete: false };
    }
    const editableSubs = sheetData.subjects.filter((sub) => sub.can_edit);
    if (editableSubs.length === 0) {
      return { total: 0, entered: 0, percentage: 0, subjectStats: [], hasEditable: false, allComplete: false };
    }

    const totalMarks = sheetData.students.length * editableSubs.length;
    let enteredMarks = 0;

    const subjectStats = editableSubs.map((sub) => {
      let subEntered = 0;
      sheetData.students.forEach((s) => {
        const val = localMarks[`${s.student_id}-${sub.subject_name}`];
        if (val !== undefined && val.trim() !== '') {
          subEntered += 1;
        }
      });
      enteredMarks += subEntered;
      return {
        name: sub.subject_name,
        maxMarks: sub.max_marks,
        entered: subEntered,
        total: sheetData.students.length,
        isComplete: sheetData.students.length > 0 && subEntered === sheetData.students.length,
      };
    });

    const percentage = totalMarks > 0 ? Math.round((enteredMarks / totalMarks) * 100) : 0;
    return {
      total: totalMarks,
      entered: enteredMarks,
      percentage,
      subjectStats,
      hasEditable: true,
      allComplete: totalMarks > 0 && enteredMarks === totalMarks,
    };
  }, [sheetData, localMarks]);

  // Helper to compute a student's total marks obtained across teacher's editable subjects
  const getStudentTotalStats = (studentId: number) => {
    if (!sheetData?.subjects) return { total: 0, max: 0, count: 0, allEntered: false };
    const editableSubs = sheetData.subjects.filter((sub) => sub.can_edit);
    if (editableSubs.length === 0) return { total: 0, max: 0, count: 0, allEntered: false };
    let total = 0;
    let max = 0;
    let count = 0;
    editableSubs.forEach((sub) => {
      const val = localMarks[`${studentId}-${sub.subject_name}`];
      if (val !== undefined && val.trim() !== '' && !isNaN(Number(val))) {
        total += Number(val);
        count += 1;
      }
      max += sub.max_marks;
    });
    return { total, max, count, allEntered: count === editableSubs.length };
  };

  // Save (Teacher or Admin)
  const handleSave = async (status: 'draft' | 'submitted') => {
    if (!activeSchedule || !selectedSection || !sheetData) return;
    setErrorMessage('');
    setSavedMessage('');

    // Build entries payload
    const entries: Array<{
      student_id: number;
      subject_name: string;
      marks_obtained: string | number | null;
    }> = [];

    // Filter to subjects this user can edit
    const editableSubjectNames = new Set(
      sheetData.subjects.filter((sub) => sub.can_edit).map((sub) => sub.subject_name)
    );

    for (const student of sheetData.students) {
      for (const subject of sheetData.subjects) {
        if (editableSubjectNames.has(subject.subject_name)) {
          const key = `${student.student_id}-${subject.subject_name}`;
          const val = localMarks[key] !== undefined ? localMarks[key] : '';
          
          if (val.trim() !== '') {
            const num = Number(val);
            if (!Number.isFinite(num) || num < 0 || num > subject.max_marks) {
              setErrorMessage(`Marks for ${student.student_name} in ${subject.subject_name} must be between 0 and ${subject.max_marks}.`);
              return;
            }
          }

          entries.push({
            student_id: student.student_id,
            subject_name: subject.subject_name,
            marks_obtained: val.trim() === '' ? null : Number(val),
          });
        }
      }
    }

    try {
      const res = await saveMarksMutation({
        scheduleId: activeSchedule.id,
        section: selectedSection,
        status,
        entries,
      }).unwrap();

      if (status === 'submitted') {
        setSavedMessage(
          isTeacher
            ? `Marks for your subjects have been submitted. They are now available in the Admin panel for verification.`
            : `Marks verified and saved.`
        );
        emitNotification({
          title: 'Marks Submitted',
          message: `${activeSchedule.name} (${activeSchedule.class_name} - ${selectedSection}) marks saved.`,
          tone: 'success',
          source: 'marks-entry',
        });
      } else {
        setSavedMessage(`Draft marks saved successfully.`);
        emitNotification({
          title: 'Draft Saved',
          message: `Marks draft for ${activeSchedule.class_name} - ${selectedSection} saved.`,
          tone: 'success',
          source: 'marks-entry',
        });
      }

      void refetchSheet();
      void refetchSchedules();
    } catch (err: any) {
      setErrorMessage(err?.data?.detail || err?.message || 'Failed to save marks.');
    }
  };

  // Publish (Admin Only)
  const handlePublish = async () => {
    if (!activeSchedule || !selectedSection) return;
    if (
      !window.confirm(
        `Are you sure you want to officially publish marks for ${activeSchedule.name} (${activeSchedule.class_name} - ${selectedSection})? Results will be immediately visible on Parent & Student report cards.`
      )
    ) {
      return;
    }

    setErrorMessage('');
    setSavedMessage('');
    try {
      const res = await publishMarksMutation({
        scheduleId: activeSchedule.id,
        section: selectedSection,
      }).unwrap();

      setSavedMessage(res.detail || 'Marks published successfully to students and parents.');
      emitNotification({
        title: 'Report Cards Published',
        message: `${activeSchedule.name} (${activeSchedule.class_name} - ${selectedSection}) marks are now live!`,
        tone: 'success',
        source: 'marks-entry',
      });

      void refetchSheet();
      void refetchSchedules();
    } catch (err: any) {
      setErrorMessage(err?.data?.detail || err?.message || 'Failed to publish marks.');
    }
  };

  // If user is neither Admin nor Teacher
  if (!isAdmin && !isTeacher) {
    return (
      <div className="portal-card p-12 text-center">
        <LockKeyhole className="mx-auto h-10 w-10 text-indigo-500" />
        <h3 className="mt-3 text-base font-extrabold text-slate-900">Marks Entry Workspace</h3>
        <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
          Marks entry is reserved for subject teachers and administrators. You can view published exam report cards
          under the Report Cards tab.
        </p>
      </div>
    );
  }

  // Filter students by search
  const displayedStudents = useMemo(() => {
    if (!sheetData?.students) return [];
    if (!searchQuery.trim()) return sheetData.students;
    const q = searchQuery.toLowerCase();
    return sheetData.students.filter(
      (s) =>
        s.student_name.toLowerCase().includes(q) ||
        s.admission_no.toLowerCase().includes(q) ||
        String(s.roll_no).includes(q)
    );
  }, [sheetData, searchQuery]);

  return (
    <div className="space-y-6 animate-fade-in" id="marks-entry-container">
      {/* Toast Messages */}
      {savedMessage && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 font-bold shadow-xs">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>{savedMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 font-bold shadow-xs">
          <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. ADMIN PANEL VIEW (Simple 3-Level Block Flow)                           */}
      {/* ========================================================================= */}
      {isAdmin && (
        <div className="space-y-6">
          {/* Breadcrumb Navigation for Admin */}
          <div className="portal-card flex items-center justify-between px-5 py-3.5">
            <div className="flex items-center gap-2 text-xs font-bold">
              <button
                onClick={() => {
                  setAdminViewLevel('exams');
                  setSelectedSection('');
                }}
                className={`transition hover:text-indigo-600 cursor-pointer ${
                  adminViewLevel === 'exams' ? 'text-indigo-700 font-black' : 'text-slate-500'
                }`}
              >
                1. Select Exam
              </button>

              {activeSchedule && (
                <>
                  <span className="text-slate-300">/</span>
                  <button
                    onClick={() => {
                      setAdminViewLevel('sections');
                    }}
                    className={`transition hover:text-indigo-600 cursor-pointer ${
                      adminViewLevel === 'sections' ? 'text-indigo-700 font-black' : 'text-slate-500'
                    }`}
                  >
                    2. {activeSchedule.name} ({activeSchedule.class_name})
                  </button>
                </>
              )}

              {selectedSection && adminViewLevel === 'sheet' && (
                <>
                  <span className="text-slate-300">/</span>
                  <span className="text-indigo-700 font-black">
                    3. Section {selectedSection} Marks Sheet
                  </span>
                </>
              )}
            </div>

            {adminViewLevel !== 'exams' && (
              <button
                onClick={() => {
                  if (adminViewLevel === 'sheet') setAdminViewLevel('sections');
                  else if (adminViewLevel === 'sections') setAdminViewLevel('exams');
                }}
                className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-indigo-600 transition cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
            )}
          </div>

          {/* LEVEL 1: EXAM BLOCKS */}
          {adminViewLevel === 'exams' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-black text-slate-900">Choose Exam to Manage Marks</h3>
                <p className="text-xs text-slate-500">
                  Click on an exam block to select a section and view/verify student marks across all subjects.
                </p>
              </div>

              {schedules.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-400">
                  <Award className="mx-auto h-10 w-10 text-slate-300 mb-2" />
                  <p className="text-sm font-bold text-slate-700">No Exam Schedules Found</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Create and publish an exam timetable under "Exam Schedule" first.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {schedules.map((sched) => (
                    <div
                      key={sched.id}
                      onClick={() => {
                        setSelectedScheduleId(sched.id);
                        setAdminViewLevel('sections');
                      }}
                      className="group relative cursor-pointer rounded-3xl border-2 border-slate-200/90 bg-white p-5 shadow-xs transition-all hover:-translate-y-0.5 hover:border-indigo-500 hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[10px] font-black uppercase text-indigo-700">
                            {sched.class_name}
                          </span>
                          <h4 className="text-base font-black text-slate-900 group-hover:text-indigo-600 transition">
                            {sched.name}
                          </h4>
                          <p className="text-xs font-semibold text-slate-500">
                            {sched.items?.length || 0} Subjects · Academic Year {sched.academic_year || '2026-2027'}
                          </p>
                          <div className="pt-1 flex items-center gap-1.5">
                            {sched.marks_entry_extended ? (
                              <span className="rounded-full bg-purple-100 text-purple-800 px-2 py-0.5 text-[9px] font-black uppercase flex items-center gap-1">
                                <ShieldCheck className="h-2.5 w-2.5 text-purple-600" /> Deadline Extended
                              </span>
                            ) : (
                              <span className="rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 text-[9px] font-bold flex items-center gap-1">
                                <Clock className="h-2.5 w-2.5 text-slate-500" /> 3-Day Window
                              </span>
                            )}
                          </div>
                        </div>
                        <ChevronRight className="h-5 w-5 text-slate-300 group-hover:text-indigo-600 transition" />
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] font-bold">
                        <span className="text-slate-400">Click to view sections</span>
                        <span className="text-indigo-600 flex items-center gap-1">
                          Open Marks <ChevronRight className="h-3 w-3" />
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* LEVEL 2: SECTIONS SELECTION */}
          {adminViewLevel === 'sections' && activeSchedule && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-black text-slate-900">
                  {activeSchedule.name} — Select Section ({activeSchedule.class_name})
                </h3>
                <p className="text-xs text-slate-500">
                  Select a section to view student rows and all subject marks entered by teachers.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {availableSections.map((sec) => {
                  const secExt = (sheetData?.section_extensions as any)?.[sec] || (activeSchedule?.section_extensions as any)?.[sec];
                  const isSecExtended = !!secExt?.extended;
                  const isScheduleExtended = activeSchedule.marks_entry_extended;

                  return (
                    <div
                      key={sec}
                      className="group relative rounded-3xl border-2 border-slate-200/90 bg-white p-5 shadow-xs transition-all hover:border-indigo-500 hover:shadow-md space-y-3"
                    >
                      <div
                        onClick={() => {
                          setSelectedSection(sec);
                          setExtensionTargetSection(sec);
                          setAdminViewLevel('sheet');
                        }}
                        className="cursor-pointer space-y-2 text-center"
                      >
                        <Users className="mx-auto h-8 w-8 text-indigo-500 group-hover:scale-110 transition-transform" />
                        <h4 className="text-lg font-black text-slate-900">Section {sec}</h4>
                        <p className="text-xs font-semibold text-slate-500">
                          {activeSchedule.class_name} · {activeSchedule.items?.length || 0} Subjects
                        </p>
                      </div>

                      {/* Section Deadline Status Badge */}
                      <div className="pt-1 flex flex-col items-center gap-1.5 text-center">
                        {isSecExtended ? (
                          <span className="rounded-full bg-purple-100 text-purple-900 border border-purple-200 px-2.5 py-0.5 text-[10px] font-black uppercase flex items-center gap-1">
                            <ShieldCheck className="h-3 w-3 text-purple-600" />
                            Section {sec} Extended
                          </span>
                        ) : isScheduleExtended ? (
                          <span className="rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200 px-2.5 py-0.5 text-[10px] font-black uppercase flex items-center gap-1">
                            <ShieldCheck className="h-3 w-3 text-indigo-600" />
                            Class Extended
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-100 text-slate-600 px-2.5 py-0.5 text-[10px] font-bold flex items-center gap-1">
                            <Clock className="h-3 w-3 text-slate-500" /> Standard 3-Day Window
                          </span>
                        )}
                        <span className="text-[11px] text-slate-500 font-medium">
                          Deadline: {formatDeadline(secExt?.deadline || activeSchedule.marks_entry_deadline)}
                        </span>
                      </div>

                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSection(sec);
                            setExtensionTargetSection(sec);
                            setShowExtendModal(true);
                          }}
                          className="rounded-xl border border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-800 px-2.5 py-1 text-[11px] font-bold transition cursor-pointer flex items-center gap-1 shadow-2xs"
                        >
                          <Clock className="h-3 w-3 text-purple-600" />
                          Extend {sec}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSection(sec);
                            setExtensionTargetSection(sec);
                            setAdminViewLevel('sheet');
                          }}
                          className="inline-flex items-center gap-1 rounded-xl bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-700 hover:bg-indigo-600 hover:text-white transition cursor-pointer"
                        >
                          View Marks <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* LEVEL 3: STUDENT ROWS & CURRENT MARKS DATA */}
          {adminViewLevel === 'sheet' && activeSchedule && (
            <div className="portal-card overflow-hidden space-y-4">
              {/* Header Bar */}
              <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row justify-between sm:items-center gap-4 bg-slate-50/50">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="rounded-full bg-indigo-100 px-3 py-0.5 text-[11px] font-black text-indigo-800">
                      {activeSchedule.class_name} — Section {selectedSection}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-0.5 text-[11px] font-bold text-slate-600">
                      {activeSchedule.name}
                    </span>
                    {sheetData?.all_published ? (
                      <span className="rounded-full bg-emerald-100 px-3 py-0.5 text-[11px] font-black text-emerald-800 flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Published to Parents
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-3 py-0.5 text-[11px] font-black text-amber-800 flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-amber-600" /> Pending Admin Verification
                      </span>
                    )}
                    {sheetData?.marks_entry_extended ? (
                      <span className="rounded-full bg-purple-100 px-3 py-0.5 text-[11px] font-black text-purple-800 flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5 text-purple-600" /> Deadline Extended: {formatDeadline(sheetData.marks_entry_deadline)}
                      </span>
                    ) : (
                      <span className="rounded-full bg-indigo-50 border border-indigo-100 px-3 py-0.5 text-[11px] font-bold text-indigo-700 flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-indigo-600" /> Teacher Window: 3 Days Post-Exam
                      </span>
                    )}
                  </div>
                  <h4 className="font-sans font-black text-slate-900 text-base mt-1.5">
                    Student Marks Sheet ({displayedStudents.length} Students)
                  </h4>
                  <p className="text-xs text-slate-500 font-medium">
                    All subject marks entered by teachers. You can verify, modify values, and click Publish.
                  </p>
                </div>

                {/* Search Bar & Switch Section */}
                <div className="flex items-center gap-2.5">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search student or roll no..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="rounded-xl border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-400 w-48 sm:w-56"
                    />
                  </div>

                  {/* Section Switcher */}
                  {(sheetData?.all_sections || []).length > 1 && (
                    <select
                      value={selectedSection}
                      onChange={(e) => {
                        setSelectedSection(e.target.value);
                        setExtensionTargetSection(e.target.value);
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 shadow-2xs focus:outline-none cursor-pointer"
                    >
                      {sheetData?.all_sections.map((s) => (
                        <option key={s} value={s}>
                          Section {s}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {/* Class, Section & Assigned Teachers Context Banner */}
              <div className="mx-5 p-4 rounded-2xl bg-gradient-to-r from-slate-50 via-indigo-50/40 to-purple-50/30 border border-slate-200/90 shadow-2xs">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2.5">
                      <div className="h-10 w-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-black text-sm shadow-xs shadow-indigo-500/30">
                        {activeSchedule.class_name.replace(/[^0-9]/g, '') || activeSchedule.class_name.slice(0, 2)}
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Class & Section</div>
                        <div className="text-sm font-black text-slate-900 flex items-center gap-1.5">
                          <span>{activeSchedule.class_name}</span>
                          <span className="text-slate-300">·</span>
                          <span className="text-indigo-700">Section {selectedSection}</span>
                        </div>
                      </div>
                    </div>

                    <div className="h-8 w-px bg-slate-200 hidden sm:block" />

                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                        <GraduationCap className="h-3 w-3 text-indigo-500" />
                        Assigned Subject Teachers for Section {selectedSection} ({sheetData?.section_teachers?.length || 0}):
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap mt-1">
                        {sheetData?.section_teachers && sheetData.section_teachers.length > 0 ? (
                          sheetData.section_teachers.map((t, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1 rounded-lg bg-white border border-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-700 shadow-2xs"
                            >
                              <User className="h-2.5 w-2.5 text-indigo-600" />
                              <span className="font-black text-slate-900">{t.teacher_name}</span>
                              {t.subject_name && (
                                <span className="text-[10px] text-indigo-600 font-semibold">({t.subject_name})</span>
                              )}
                            </span>
                          ))
                        ) : (
                          <span className="text-[11px] italic text-slate-400 font-medium">
                            No teachers assigned specifically to Section {selectedSection}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-start md:self-center">
                    <button
                      type="button"
                      onClick={() => {
                        setExtensionTargetSection(selectedSection);
                        setShowExtendModal(true);
                      }}
                      className="rounded-xl border border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-800 px-3 py-1.5 text-xs font-black transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                    >
                      <Clock className="h-3.5 w-3.5 text-purple-600" />
                      Extend Deadline (Section {selectedSection})
                    </button>
                  </div>
                </div>
              </div>

              {/* Roster & Subject Columns Table */}
              {displayedStudents.length === 0 ? (
                <div className="p-12 text-center text-slate-400">
                  <Users className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                  <p className="text-sm font-bold text-slate-700">No students enrolled in Section {selectedSection}</p>
                </div>
              ) : (
                <div className="overflow-x-auto px-5">
                  <table className="w-full text-left text-xs min-w-[760px]">
                    <thead className="bg-slate-100 text-slate-800 font-bold uppercase text-[10px] tracking-wider rounded-xl">
                      <tr>
                        <th className="p-3.5 rounded-l-xl">Candidate Name</th>
                        <th className="p-3.5">Roll No</th>
                        <th className="p-3.5">Admission No</th>
                        {/* Dynamic Subject Columns with Teacher Names */}
                        {sheetData?.subjects.map((sub) => (
                          <th key={sub.subject_name} className="p-3 text-center border-x border-slate-200/50">
                            <div className="font-black text-slate-900">{sub.subject_name}</div>
                            <div className="text-[9px] font-semibold text-slate-500 lowercase">
                              (max: {sub.max_marks})
                            </div>
                            <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-indigo-50 border border-indigo-200/60 px-1.5 py-0.5 text-[9px] font-bold text-indigo-700">
                              <User className="h-2.5 w-2.5 text-indigo-500 shrink-0" />
                              <span className="truncate max-w-[90px]">{sub.teacher_name || 'Unassigned'}</span>
                            </div>
                          </th>
                        ))}
                        <th className="p-3.5 text-center rounded-r-xl">Total Marks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {displayedStudents.map((student) => {
                        let studentTotal = 0;
                        let maxTotal = 0;

                        return (
                          <tr key={student.student_id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="p-3.5">
                              <div className="flex items-center gap-2.5">
                                {student.photo_url ? (
                                  <AuthenticatedImage
                                    src={student.photo_url}
                                    alt={student.student_name}
                                    className="h-8 w-8 rounded-full object-cover border border-slate-200"
                                  />
                                ) : (
                                  <div className="h-8 w-8 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-xs">
                                    {student.student_name.slice(0, 1)}
                                  </div>
                                )}
                                <span className="font-black text-slate-900">{student.student_name}</span>
                              </div>
                            </td>
                            <td className="p-3.5 font-mono font-bold text-indigo-700">#{student.roll_no || '—'}</td>
                            <td className="p-3.5 font-mono text-slate-600 text-[11px]">{student.admission_no || '—'}</td>

                            {/* Subject Marks Inputs (Editable by Admin) */}
                            {sheetData?.subjects.map((sub) => {
                              const key = `${student.student_id}-${sub.subject_name}`;
                              const currentVal = localMarks[key] !== undefined ? localMarks[key] : '';
                              if (currentVal.trim() !== '') {
                                const num = Number(currentVal);
                                if (Number.isFinite(num)) {
                                  studentTotal += num;
                                  maxTotal += sub.max_marks;
                                }
                              }

                              return (
                                <td key={sub.subject_name} className="p-3.5 text-center">
                                  <input
                                    type="number"
                                    min="0"
                                    max={sub.max_marks}
                                    step="0.5"
                                    placeholder="0"
                                    value={currentVal}
                                    onChange={(e) =>
                                      handleMarkChange(student.student_id, sub.subject_name, e.target.value)
                                    }
                                    className="w-20 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-center text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                  />
                                </td>
                              );
                            })}

                            <td className="p-3.5 text-center font-mono font-black text-indigo-700 text-xs">
                              {studentTotal} {maxTotal > 0 ? `/ ${maxTotal}` : ''}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Footer Action Bar for Admin */}
              <div className="p-5 border-t border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="text-xs text-slate-500 font-medium">
                  <span>
                    Admin can edit any mark above. Click <strong>"Save Modifications"</strong> to update or{' '}
                    <strong>"Publish Marks"</strong> to release to students & parents.
                  </span>
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShowExtendModal(true)}
                    className="rounded-2xl border border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-800 px-4 py-2.5 text-xs font-black transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                  >
                    <Clock className="h-3.5 w-3.5 text-purple-600" />
                    Extend Teacher Deadline
                  </button>

                  <button
                    type="button"
                    disabled={isSaving || displayedStudents.length === 0}
                    onClick={() => handleSave('draft')}
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100 transition shadow-2xs cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Save className="h-3.5 w-3.5" />
                    Save Modifications
                  </button>

                  <button
                    type="button"
                    disabled={isPublishing || displayedStudents.length === 0}
                    onClick={handlePublish}
                    className="rounded-2xl bg-indigo-600 px-5 py-2.5 text-xs font-black text-white hover:bg-indigo-700 shadow-xs shadow-indigo-500/20 transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {isPublishing ? 'Publishing...' : 'Verify & Publish Marks to Parents'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. TEACHER PANEL VIEW (User-Friendly Workspace & Assigned Classes)       */}
      {/* ========================================================================= */}
      {isTeacher && (
        <div className="space-y-6">
          {/* Header Card */}
          <div className="portal-card p-6 space-y-4">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="portal-pill-badge indigo">
                    Teacher Marks Portal
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-600">
                    Logged in as: {user.name}
                  </span>
                </div>
                <h3 className="font-sans font-black text-slate-900 text-lg mt-2 flex items-center gap-2">
                  <FilePenLine className="h-5 w-5 text-indigo-600" />
                  Subject Marks Entry Workspace
                </h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  View your assigned classes, enter student marks within the 3-day post-exam window, and submit them for administrative verification.
                </p>
              </div>

              {/* Quick Exam Selector Dropdown */}
              <div className="flex items-center gap-2.5">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Active Exam:
                  </label>
                  <select
                    value={activeSchedule?.id || ''}
                    onChange={(e) => setSelectedScheduleId(Number(e.target.value))}
                    className="rounded-2xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 shadow-2xs focus:outline-none focus:ring-2 focus:ring-indigo-400 cursor-pointer"
                  >
                    {schedules.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.class_name}) {s.is_teacher_assigned ? '★ Assigned' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* "My Assigned Classes & Sections" Card Deck */}
            <div className="pt-2 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-slate-100 pt-3">
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    <GraduationCap className="h-4 w-4 text-indigo-600" />
                    My Assigned Classes & Sections
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Click any card below to open its student marks sheet.
                  </p>
                </div>

                {/* Filter Tab: Assigned Classes vs All Classes */}
                {schedules.length > 0 && (
                  <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-[11px] font-bold self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => setTeacherViewFilter('assigned')}
                      className={`px-3 py-1 rounded-lg transition cursor-pointer ${
                        teacherViewFilter === 'assigned'
                          ? 'bg-white text-indigo-700 shadow-2xs font-black'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Assigned to Me ({teacherAssignedSchedules.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setTeacherViewFilter('all')}
                      className={`px-3 py-1 rounded-lg transition cursor-pointer ${
                        teacherViewFilter === 'all'
                          ? 'bg-white text-indigo-700 shadow-2xs font-black'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      All School Exams ({schedules.length})
                    </button>
                  </div>
                )}
              </div>

              {teacherDisplayedSchedules.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-400">
                  <GraduationCap className="mx-auto h-7 w-7 text-slate-300 mb-1.5" />
                  <p className="text-xs font-bold text-slate-700">No Assigned Classes Found</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    No classes are currently assigned to your account. Click "All School Exams" above to browse other schedules.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {teacherDisplayedSchedules.map((sched) => {
                    const isAssigned = sched.is_teacher_assigned || (sched.teacher_assigned_sections && sched.teacher_assigned_sections.length > 0);
                    const assignedSecs = sched.teacher_assigned_sections && sched.teacher_assigned_sections.length > 0
                      ? sched.teacher_assigned_sections
                      : (sched.sections && sched.sections.length > 0 ? sched.sections : ['A']);
                    const assignedSubs = sched.teacher_assigned_subjects || [];

                    return assignedSecs.map((sec) => {
                      const isCardActive = activeSchedule?.id === sched.id && selectedSection === sec;
                      const secExt = sched.section_extensions?.[sec];
                      const isExtended = !!(secExt?.extended || sched.marks_entry_extended);

                      return (
                        <div
                          key={`${sched.id}-${sec}`}
                          onClick={() => {
                            setSelectedScheduleId(sched.id);
                            setSelectedSection(sec);
                            const el = document.getElementById('teacher-marks-workspace');
                            if (el) el.scrollIntoView({ behavior: 'smooth' });
                          }}
                          className={`group relative cursor-pointer rounded-2xl border-2 p-3.5 transition-all hover:-translate-y-0.5 shadow-2xs ${
                            isCardActive
                              ? 'border-indigo-600 bg-gradient-to-br from-indigo-50/70 via-white to-purple-50/40 ring-2 ring-indigo-500/20'
                              : 'border-slate-200/90 bg-white hover:border-indigo-400 hover:shadow-xs'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="rounded-full bg-indigo-100 text-indigo-800 px-2.5 py-0.5 text-[10px] font-black uppercase">
                                  {sched.class_name} — Section {sec}
                                </span>
                                {isAssigned ? (
                                  <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[9px] font-black flex items-center gap-1">
                                    <Check className="h-2.5 w-2.5 text-emerald-600" /> Assigned
                                  </span>
                                ) : (
                                  <span className="rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 text-[9px] font-bold">
                                    Other
                                  </span>
                                )}
                              </div>
                              <h5 className="text-sm font-black text-slate-900 group-hover:text-indigo-600 transition">
                                {sched.name}
                              </h5>
                              <p className="text-[10px] font-semibold text-slate-500">
                                Academic Year {sched.academic_year || '2026-2027'}
                              </p>
                            </div>

                            <div className={`p-1.5 rounded-xl transition ${isCardActive ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400 group-hover:text-indigo-600'}`}>
                              <FilePenLine className="h-4 w-4" />
                            </div>
                          </div>

                          {/* Assigned Subjects Pills */}
                          {assignedSubs.length > 0 && (
                            <div className="mt-2.5 pt-2 border-t border-slate-100/90">
                              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1">
                                <BookOpen className="h-2.5 w-2.5 text-indigo-500" /> Your Subjects:
                              </div>
                              <div className="flex items-center gap-1 flex-wrap">
                                {assignedSubs.map((sub) => (
                                  <span
                                    key={sub}
                                    className="rounded-md bg-indigo-50 border border-indigo-200/80 px-2 py-0.5 text-[10px] font-black text-indigo-700"
                                  >
                                    {sub}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Deadline & Action */}
                          <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px]">
                            <div>
                              {isExtended ? (
                                <span className="inline-flex items-center gap-1 rounded-md bg-purple-50 text-purple-700 px-1.5 py-0.5 text-[9px] font-black">
                                  <ShieldCheck className="h-2.5 w-2.5 text-purple-600" /> Deadline Extended
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 font-semibold">
                                  <Clock className="h-2.5 w-2.5 text-slate-400" /> 3-Day Window
                                </span>
                              )}
                            </div>

                            <span className={`font-black text-xs flex items-center gap-0.5 ${isCardActive ? 'text-indigo-700' : 'text-slate-600 group-hover:text-indigo-600'}`}>
                              {isCardActive ? (
                                <span className="flex items-center gap-1 text-indigo-700">
                                  <Check className="h-3.5 w-3.5 text-indigo-600" /> Active Sheet
                                </span>
                              ) : (
                                <span className="flex items-center gap-0.5">
                                  Enter Marks <ChevronRight className="h-3.5 w-3.5" />
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                      );
                    });
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Marks Entry Workspace for Active Schedule */}
          {activeSchedule && (
            <div id="teacher-marks-workspace" className="portal-card overflow-hidden space-y-4">
              {/* Workspace Header */}
              <div className="p-5 border-b border-slate-100 bg-slate-50/60 flex flex-col md:flex-row justify-between md:items-center gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="rounded-full bg-indigo-600 text-white px-3 py-0.5 text-[11px] font-black">
                      {activeSchedule.class_name} — Section {selectedSection}
                    </span>
                    <span className="rounded-full bg-slate-200/80 px-2.5 py-0.5 text-[11px] font-bold text-slate-700">
                      {activeSchedule.name}
                    </span>
                    {sheetData?.all_published ? (
                      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-black text-emerald-800 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Verified by Admin
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-black text-amber-800 flex items-center gap-1">
                        <Clock className="h-3 w-3 text-amber-600" /> Draft / Pending Verification
                      </span>
                    )}
                  </div>
                  <h4 className="font-sans font-black text-slate-900 text-base">
                    Student Marks Sheet ({displayedStudents.length} Students)
                  </h4>
                  <p className="text-xs text-slate-500 font-medium">
                    Only your assigned subjects are unlocked for grading. Colleague subjects are displayed in read-only mode.
                  </p>
                </div>

                {/* Section Switcher Tabs & Search Input */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  {/* Section Switcher Pills */}
                  {(sheetData?.all_sections || ['A']).length > 1 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Section:</span>
                      {(sheetData?.all_sections || ['A']).map((sec) => {
                        const isAssigned = (activeSchedule?.teacher_assigned_sections || []).includes(sec);
                        const isSelected = selectedSection === sec;
                        return (
                          <button
                            key={sec}
                            type="button"
                            onClick={() => setSelectedSection(sec)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-black transition flex items-center gap-1 cursor-pointer shadow-2xs ${
                              isSelected
                                ? 'bg-indigo-600 text-white shadow-indigo-500/20'
                                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <span>Section {sec}</span>
                            {isAssigned && (
                              <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-black uppercase ${
                                isSelected ? 'bg-indigo-500 text-white' : 'bg-emerald-100 text-emerald-800'
                              }`}>
                                Assigned
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Student Search */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search candidate..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="rounded-xl border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-400 w-48 sm:w-56"
                    />
                  </div>
                </div>
              </div>

              {/* Deadline & 3-Day Window Banner */}
              {sheetData && (
                <div className="mx-5">
                  <div
                    className={`rounded-2xl p-4 border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs ${
                      sheetData.overall_marks_entry_open
                        ? sheetData.marks_entry_extended
                          ? 'bg-purple-50/80 border-purple-200 text-purple-900'
                          : 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
                        : 'bg-rose-50/80 border-rose-200 text-rose-900'
                    }`}
                  >
                    <div className="flex items-start sm:items-center gap-3">
                      {sheetData.overall_marks_entry_open ? (
                        sheetData.marks_entry_extended ? (
                          <ShieldCheck className="h-5 w-5 text-purple-600 shrink-0 mt-0.5 sm:mt-0" />
                        ) : (
                          <Clock className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5 sm:mt-0" />
                        )
                      ) : (
                        <Lock className="h-5 w-5 text-rose-600 shrink-0 mt-0.5 sm:mt-0" />
                      )}
                      <div>
                        <div className="font-black text-sm flex items-center gap-2 flex-wrap">
                          {sheetData.overall_marks_entry_open ? (
                            sheetData.marks_entry_extended ? (
                              <span>
                                Marks Entry Deadline Extended by Administrator{' '}
                                <span className="text-purple-700 font-black">
                                  {sheetData.section_extended ? `(Section ${selectedSection})` : `(Class ${activeSchedule?.class_name})`}
                                </span>
                              </span>
                            ) : (
                              <span>Marks Entry Window Active (3 Days Post-Exam)</span>
                            )
                          ) : (
                            <span>Marks Entry Period Closed for Section {selectedSection}</span>
                          )}
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase ${
                              sheetData.overall_marks_entry_open
                                ? sheetData.marks_entry_extended
                                  ? 'bg-purple-200 text-purple-900'
                                  : 'bg-emerald-200 text-emerald-900'
                                : 'bg-rose-200 text-rose-900'
                            }`}
                          >
                            {sheetData.overall_marks_entry_open
                              ? sheetData.marks_entry_extended
                                ? sheetData.section_extended ? `Section ${selectedSection} Extended` : 'Extended'
                                : 'Open'
                              : 'Locked'}
                          </span>
                        </div>
                        <p className="text-[11px] font-medium mt-0.5 opacity-90">
                          {sheetData.overall_marks_entry_open ? (
                            <>
                              Teachers have 3 days following exam completion to enter marks.
                              {sheetData.marks_entry_deadline && ` Window closes: ${formatDeadline(sheetData.marks_entry_deadline)}`}
                              {sheetData.overall_days_remaining !== undefined && sheetData.overall_days_remaining !== null && (
                                <strong className="ml-1 text-slate-800">({sheetData.overall_days_remaining}d remaining)</strong>
                              )}
                              {sheetData.marks_entry_extension_reason && (
                                <span className="block mt-0.5 italic text-purple-700">
                                  Reason: {sheetData.marks_entry_extension_reason}
                                </span>
                              )}
                            </>
                          ) : (
                            <>
                              Marks entry period for {activeSchedule.class_name} (Section {selectedSection}) has ended.
                              Please contact the School Administrator if you require an extension.
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Progress & Assigned Subjects Status Bar */}
              {sheetData && (
                <div className="mx-5 p-4 rounded-2xl bg-gradient-to-r from-indigo-50/70 via-purple-50/40 to-slate-50 border border-indigo-100 shadow-2xs space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <BookOpen className="h-4 w-4 text-indigo-600 shrink-0" />
                      <span className="text-xs font-black text-slate-900">Your Assigned Subjects in this Section:</span>
                      {sheetData.teacher_subjects.length === 0 ? (
                        <span className="text-amber-700 font-semibold italic text-xs">
                          (No subjects assigned to your account in this section)
                        </span>
                      ) : (
                        sheetData.teacher_subjects.map((sub) => (
                          <span
                            key={sub}
                            className="rounded-lg bg-indigo-600 px-2.5 py-0.5 text-[11px] font-black text-white shadow-2xs"
                          >
                            {sub}
                          </span>
                        ))
                      )}
                    </div>

                    {teacherStats.hasEditable && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-extrabold text-slate-800">
                          {teacherStats.entered} / {teacherStats.total} Marks Entered ({teacherStats.percentage}%)
                        </span>
                        {teacherStats.allComplete ? (
                          <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[10px] font-black flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Completed
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[10px] font-bold">
                            In Progress
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Progress Bar Track */}
                  {teacherStats.hasEditable && (
                    <div className="w-full bg-slate-200/70 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-2 transition-all duration-300 rounded-full ${
                          teacherStats.allComplete ? 'bg-emerald-500' : 'bg-indigo-600'
                        }`}
                        style={{ width: `${Math.min(100, Math.max(0, teacherStats.percentage))}%` }}
                      />
                    </div>
                  )}

                  {/* Per-subject breakdown chips */}
                  {teacherStats.hasEditable && teacherStats.subjectStats.length > 0 && (
                    <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5 text-[11px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        {teacherStats.subjectStats.map((sub) => (
                          <div
                            key={sub.name}
                            className={`rounded-xl border px-2.5 py-1 text-[11px] font-bold flex items-center gap-1.5 shadow-2xs ${
                              sub.isComplete
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                                : 'bg-white border-slate-200 text-slate-700'
                            }`}
                          >
                            <span className="font-black">{sub.name}</span>
                            <span className="text-[10px] text-slate-500 font-semibold">(max {sub.maxMarks})</span>
                            <span className={`text-[10px] px-1.5 py-0.2 rounded-md font-black ${
                              sub.isComplete ? 'bg-emerald-200 text-emerald-900' : 'bg-slate-100 text-slate-700'
                            }`}>
                              {sub.entered} / {sub.total}
                            </span>
                          </div>
                        ))}
                      </div>

                      <span className="text-[10px] text-slate-500 font-medium italic">
                        💡 Tip: Press <strong>Enter</strong> or <strong>↓</strong> to move to the next student.
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Student Roster Marks Grid */}
              {displayedStudents.length === 0 ? (
                <div className="p-12 text-center text-slate-400 space-y-2">
                  <Users className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="text-sm font-bold text-slate-700">No students found in Section {selectedSection}</p>
                </div>
              ) : (
                <div className="overflow-x-auto px-5">
                  <table className="w-full text-left text-xs min-w-[720px]">
                    <thead className="bg-slate-100 text-slate-800 font-bold uppercase text-[10px] tracking-wider rounded-xl">
                      <tr>
                        <th className="p-3.5 rounded-l-xl">Candidate</th>
                        <th className="p-3.5">Roll No</th>
                        <th className="p-3.5">Admission No</th>

                        {/* All subjects in the exam with assigned teachers */}
                        {sheetData?.subjects.map((sub) => (
                          <th
                            key={sub.subject_name}
                            className={`p-3 text-center border-x border-slate-200/60 ${
                              sub.can_edit ? 'bg-indigo-50/90 text-indigo-950 font-black' : 'text-slate-700'
                            }`}
                          >
                            <div className="font-black text-slate-900">{sub.subject_name}</div>
                            <div className="text-[9px] font-semibold text-slate-500 lowercase">
                              (max: {sub.max_marks})
                            </div>
                            <div
                              className={`mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold border shadow-2xs ${
                                sub.can_edit
                                  ? 'bg-indigo-600 text-white border-indigo-700'
                                  : 'bg-white text-slate-700 border-slate-200'
                              }`}
                            >
                              <User className={`h-2.5 w-2.5 ${sub.can_edit ? 'text-white' : 'text-indigo-600'}`} />
                              <span className="truncate max-w-[90px]">{sub.teacher_name || 'Unassigned'}</span>
                              {sub.can_edit && (
                                <span className="text-[8px] bg-indigo-500 text-white px-1 rounded-sm uppercase tracking-wider ml-0.5">
                                  You
                                </span>
                              )}
                            </div>
                            {!sub.can_edit && sub.marks_entry_open === false && (
                              <div className="text-[9px] text-rose-600 font-bold flex items-center justify-center gap-0.5 mt-0.5">
                                <Lock className="h-2.5 w-2.5" /> closed
                              </div>
                            )}
                          </th>
                        ))}

                        {/* Total Column across teacher's subjects */}
                        <th className="p-3 text-center bg-indigo-50/50 text-indigo-950 font-black border-l border-slate-200/60 rounded-r-xl">
                          <div>Total</div>
                          <div className="text-[9px] font-semibold text-slate-500 lowercase">
                            (your subjects)
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {displayedStudents.map((student, index) => {
                        const studentStats = getStudentTotalStats(student.student_id);

                        return (
                          <tr key={student.student_id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="p-3.5">
                              <div className="flex items-center gap-2.5">
                                {student.photo_url ? (
                                  <AuthenticatedImage
                                    src={student.photo_url}
                                    alt={student.student_name}
                                    className="h-8 w-8 rounded-full object-cover border border-slate-200"
                                  />
                                ) : (
                                  <div className="h-8 w-8 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-xs">
                                    {student.student_name.slice(0, 1)}
                                  </div>
                                )}
                                <span className="font-extrabold text-slate-900">{student.student_name}</span>
                              </div>
                            </td>
                            <td className="p-3.5 font-mono font-bold text-indigo-700">#{student.roll_no || '—'}</td>
                            <td className="p-3.5 font-mono text-slate-600 text-[11px]">{student.admission_no || '—'}</td>

                            {/* Subjects in Exam */}
                            {sheetData?.subjects.map((sub) => {
                              const key = `${student.student_id}-${sub.subject_name}`;
                              const currentVal = localMarks[key] !== undefined ? localMarks[key] : '';
                              const numVal = Number(currentVal);
                              const isEntered = currentVal.trim() !== '';
                              const isInvalid = isEntered && (isNaN(numVal) || numVal < 0 || numVal > sub.max_marks);

                              return (
                                <td key={sub.subject_name} className="p-3 text-center">
                                  {sub.can_edit ? (
                                    /* Teacher Can Edit this subject */
                                    <div className="relative inline-block">
                                      <input
                                        id={`teacher-mark-${index}-${sub.subject_name}`}
                                        type="number"
                                        min="0"
                                        max={sub.max_marks}
                                        step="0.5"
                                        placeholder="0"
                                        value={currentVal}
                                        onKeyDown={(e) => handleKeyDown(e, index, sub.subject_name)}
                                        onChange={(e) =>
                                          handleMarkChange(student.student_id, sub.subject_name, e.target.value)
                                        }
                                        className={`w-22 rounded-xl border-2 px-2.5 py-1.5 text-center text-xs font-black transition-all focus:outline-none focus:ring-2 shadow-2xs ${
                                          isInvalid
                                            ? 'border-rose-400 bg-rose-50 text-rose-900 ring-2 ring-rose-200'
                                            : isEntered
                                              ? 'border-emerald-400 bg-emerald-50/20 text-slate-900 focus:ring-emerald-400'
                                              : 'border-slate-200 bg-white text-slate-900 focus:border-indigo-400 focus:ring-indigo-300'
                                        }`}
                                      />
                                      {isInvalid && (
                                        <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-rose-600 px-1.5 py-0.5 text-[9px] font-bold text-white shadow-xs z-10">
                                          Max: {sub.max_marks}
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    /* Other Subject or Locked (Disabled / Read-only) */
                                    <div
                                      title={sub.marks_entry_open === false ? "Marks entry window closed for this subject." : `Managed by ${sub.teacher_name || 'fellow teacher'}`}
                                      className="w-20 mx-auto rounded-xl border border-slate-200/80 bg-slate-100/70 py-1.5 text-center text-xs font-semibold text-slate-500 flex items-center justify-center gap-1"
                                    >
                                      {sub.marks_entry_open === false && sheetData.teacher_subjects.includes(sub.subject_name) && (
                                        <Lock className="h-3 w-3 text-rose-500 shrink-0" />
                                      )}
                                      <span>{currentVal !== '' ? currentVal : '—'}</span>
                                    </div>
                                  )}
                                </td>
                              );
                            })}

                            {/* Total Marks for this student across teacher's subjects */}
                            <td className="p-3.5 text-center font-mono text-xs border-l border-slate-100 bg-indigo-50/20">
                              <span className="font-black text-indigo-900">
                                {studentStats.total}
                              </span>
                              {studentStats.max > 0 && (
                                <span className="text-[10px] text-slate-400 ml-0.5">
                                  / {studentStats.max}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Footer Action Bar for Teacher */}
              <div className="p-5 border-t border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="text-xs text-slate-500 font-medium">
                  {sheetData?.overall_marks_entry_open ? (
                    <span>
                      Drafts can be saved at any time. When finished grading, click <strong>"Submit Marks to Admin"</strong> to flag marks ready for verification.
                    </span>
                  ) : (
                    <span className="text-rose-600 font-bold flex items-center gap-1">
                      <Lock className="h-3.5 w-3.5" /> Marks entry is locked. 3-day deadline passed. Request admin for extension.
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    disabled={isSaving || displayedStudents.length === 0 || !sheetData?.overall_marks_entry_open}
                    onClick={() => handleSave('draft')}
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100 transition shadow-2xs cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {isSaving ? 'Saving...' : 'Save Draft'}
                  </button>
                  <button
                    type="button"
                    disabled={isSaving || displayedStudents.length === 0 || !sheetData?.overall_marks_entry_open}
                    onClick={() => handleSave('submitted')}
                    className="rounded-2xl bg-indigo-600 px-5 py-2.5 text-xs font-black text-white hover:bg-indigo-700 shadow-xs shadow-indigo-500/20 transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Submit Marks to Admin
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. ADMIN EXTEND MARKS ENTRY MODAL */}
      {/* ========================================================================= */}
      {showExtendModal && activeSchedule && createPortal(
        <div
          className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex min-h-full items-center justify-center p-3 sm:p-4 animate-fade-in"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-3xl my-auto bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95">

            {/* ── Header ── */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-purple-50/60 to-white">
              <div className="flex items-center gap-2.5">
                <div className="rounded-xl bg-purple-100 p-1.5 text-purple-700 flex-shrink-0">
                  <Clock className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-sm leading-tight">Extend Marks Entry Period</h3>
                  <p className="text-[11px] text-slate-400 leading-tight mt-0.5">Grant teachers extra days to submit marks for a class or section.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowExtendModal(false)}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition cursor-pointer flex-shrink-0 ml-3"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* ── Body: compact 2-col flat grid — zero scroll ── */}
            <div className="grid grid-cols-2 gap-3 p-3">

              {/* LEFT: Target + Status */}
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1">
                    <Layers className="h-3 w-3 text-purple-600" /> Target Selection
                  </span>
                  <span className="text-[10px] font-bold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200">Scope</span>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Class &amp; Exam</label>
                    <select
                      value={activeSchedule.id}
                      onChange={(e) => { const newId = Number(e.target.value); setSelectedScheduleId(newId); }}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-purple-400 cursor-pointer"
                    >
                      {schedules.map((s) => (
                        <option key={s.id} value={s.id}>{s.class_name} — {s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Section</label>
                    <select
                      value={extensionTargetSection}
                      onChange={(e) => setExtensionTargetSection(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-purple-400 cursor-pointer"
                    >
                      <option value="all">🌐 All Sections</option>
                      {availableSections.map((sec) => (
                        <option key={sec} value={sec}>📌 Section {sec}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="border-t border-slate-200 pt-1.5 space-y-1">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-slate-400">Deadline:</span>
                    <span className="font-extrabold text-purple-700">{formatDeadline(currentTargetDeadline)}</span>
                  </div>
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-slate-400">Status:</span>
                    {isTargetExtended ? (
                      <span className="font-bold text-purple-700 flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3 text-purple-600" />
                        {extensionTargetSection === 'all' ? 'Extended (All)' : `Extended (Sec ${extensionTargetSection})`}
                      </span>
                    ) : (
                      <span className="text-slate-500 flex items-center gap-1">
                        <Clock className="h-3 w-3 text-slate-400" /> Standard (3-Day)
                      </span>
                    )}
                  </div>
                  {(targetSectionExtension?.reason || (extensionTargetSection === 'all' && activeSchedule.marks_entry_extension_reason)) && (
                    <p className="text-[10px] italic text-purple-600 truncate">
                      "{targetSectionExtension?.reason || activeSchedule.marks_entry_extension_reason}"
                    </p>
                  )}
                </div>
              </div>

              {/* RIGHT: Extension Config */}
              <div className="rounded-xl bg-purple-50/40 border border-purple-100 p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-purple-900 flex items-center gap-1">
                    <Clock className="h-3 w-3 text-purple-600" /> Extension Duration
                  </span>
                  <span className="text-[10px] font-medium text-slate-400">Quick Select</span>
                </div>

                <div className="grid grid-cols-5 gap-1">
                  {[1, 2, 3, 5, 7].map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => { setExtensionDays(days); setCustomDeadline(''); }}
                      className={`rounded-lg py-1.5 text-[11px] font-black transition cursor-pointer border text-center ${
                        extensionDays === days && !customDeadline
                          ? 'bg-purple-600 text-white border-purple-600 shadow-xs shadow-purple-500/30'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      +{days}d
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-purple-100">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Date &amp; Time</label>
                    <input
                      type="datetime-local"
                      value={customDeadline}
                      onChange={(e) => setCustomDeadline(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-purple-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Reason</label>
                    <input
                      type="text"
                      placeholder="e.g. Evaluation delay..."
                      value={extensionReason}
                      onChange={(e) => setExtensionReason(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-purple-400"
                    />
                  </div>
                </div>
              </div>

            </div>

            {/* ── Footer ── */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50/60">
              {isTargetExtended ? (
                <button
                  type="button"
                  disabled={isResetting}
                  onClick={handleResetDeadline}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-bold text-rose-700 hover:bg-rose-100 transition cursor-pointer flex items-center gap-1.5"
                >
                  <RotateCcw className="h-3 w-3" />
                  {isResetting ? 'Resetting...' : extensionTargetSection === 'all' ? 'Reset Class (3 Days)' : `Reset Sec ${extensionTargetSection}`}
                </button>
              ) : <div />}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowExtendModal(false)}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isExtending}
                  onClick={handleExtendDeadline}
                  className="rounded-lg bg-purple-600 px-4 py-1.5 text-[11px] font-black text-white hover:bg-purple-700 shadow-xs shadow-purple-500/20 transition cursor-pointer flex items-center gap-1.5"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {isExtending
                    ? 'Extending...'
                    : extensionTargetSection === 'all'
                      ? 'Confirm Extension (All)'
                      : `Confirm Extension (Sec ${extensionTargetSection})`}
                </button>
              </div>
            </div>

          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
