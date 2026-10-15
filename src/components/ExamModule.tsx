import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Award,
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  Edit3,
  Eye,
  FileText,
  GraduationCap,
  Layers,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Ticket,
  Trash2,
  User,
  Users,
} from 'lucide-react';
import { GRADE_CARDS } from '../data/mockData';
import {
  ExamSchedule,
  ExamScheduleItemRecord,
  ExamTimetableRecord,
  HallTicketRecord,
  Student,
} from '../types';
import type { AuthUser } from '../utils/auth';
import { emitNotification } from '../services/notificationBus';
import MarksEntry from './MarksEntry';
import ParentExamResults from './ParentExamResults';
import {
  ACADEMIC_STRUCTURE_CHANGED_EVENT,
  loadAcademicStructure,
  type AcademicClass,
  type AcademicSection,
  type AcademicSubject,
} from '../services/academicStructure';
import {
  useGetExamsQuery,
  useGetExamSchedulesQuery,
  useCreateExamScheduleMutation,
  useUpdateExamScheduleMutation,
  usePublishExamScheduleMutation,
  useUnpublishExamScheduleMutation,
  useDeleteExamScheduleMutation,
  useGenerateHallTicketsMutation,
  useReleaseHallTicketsMutation,
  useGetHallTicketsQuery,
} from '../store/api/examApi';

const BROADCAST_STORAGE_KEY = 'erp_exam_notification_broadcasts';

type ExamApiRecord = {
  id: number;
  name: string;
  class_name: string;
  section: string;
  subject: string;
  date: string;
  time: string;
  end_time?: string | null;
  max_marks: number;
};

const toSchedule = (exam: ExamApiRecord): ExamSchedule => ({
  id: String(exam.id),
  examName: exam.name,
  class: exam.class_name,
  section: exam.section,
  subject: exam.subject,
  date: exam.date,
  time: exam.time ? exam.time.slice(0, 5) : '',
  maxMarks: exam.max_marks,
});

interface SubjectFormRow {
  subjectId: number;
  subjectName: string;
  examDate: string;
  startTime: string;
  endTime: string;
  maxMarks: number;
}

export default function ExamModule({
  user,
  students = [],
  schoolName,
}: {
  user: AuthUser;
  students?: Student[];
  schoolName?: string;
}) {
  const [activeTab, setActiveTab] = useState<'schedule' | 'hallticket' | 'marks' | 'marks-entry'>('schedule');
  const [schedules, setSchedules] = useState<ExamSchedule[]>([]);
  const [requestError, setRequestError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showCreator, setShowCreator] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null);

  // Form state
  const [examName, setExamName] = useState('');
  const [selectedClassId, setSelectedClassId] = useState<number | ''>('');
  const [subjectRows, setSubjectRows] = useState<SubjectFormRow[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filter state for schedules list
  const [selectedClassFilter, setSelectedClassFilter] = useState('ALL');

  // Hall Tickets Tab State
  const [selectedScheduleIdForTickets, setSelectedScheduleIdForTickets] = useState<number | null>(null);
  const [ticketSearchQuery, setTicketSearchQuery] = useState('');
  const [ticketSectionFilter, setTicketSectionFilter] = useState('ALL');
  const [selectedWardId, setSelectedWardId] = useState<string>(() => {
    return students.length > 0 ? String(students[0].id) : 'all';
  });

  const [academicClasses, setAcademicClasses] = useState<AcademicClass[]>([]);
  const [academicSections, setAcademicSections] = useState<AcademicSection[]>([]);
  const [academicSubjects, setAcademicSubjects] = useState<AcademicSubject[]>([]);

  const isAdmin = user.role === 'School Admin' || user.role === 'Super Admin';
  const isTeacher = user.role === 'Teacher';
  const isParent = user.role === 'Parent';
  const isStudent = user.role === 'Student';

  const { data: examRows = [], isLoading: examsLoading } = useGetExamsQuery();
  const { data: timetableRecords = [], isLoading: timetablesLoading, error: timetablesError, refetch: refetchSchedules } = useGetExamSchedulesQuery();

  const [createScheduleMutation] = useCreateExamScheduleMutation();
  const [updateScheduleMutation] = useUpdateExamScheduleMutation();
  const [publishScheduleMutation] = usePublishExamScheduleMutation();
  const [unpublishScheduleMutation] = useUnpublishExamScheduleMutation();
  const [deleteScheduleMutation] = useDeleteExamScheduleMutation();
  const [generateHallTicketsMutation, { isLoading: isGeneratingTickets }] = useGenerateHallTicketsMutation();
  const [releaseHallTicketsMutation, { isLoading: isReleasingTickets }] = useReleaseHallTicketsMutation();

  // Active schedule for hall tickets
  const activeScheduleForTickets = useMemo(() => {
    if (!timetableRecords.length) return null;
    if (selectedScheduleIdForTickets) {
      return timetableRecords.find((t) => t.id === selectedScheduleIdForTickets) || timetableRecords[0];
    }
    return timetableRecords[0];
  }, [timetableRecords, selectedScheduleIdForTickets]);

  const {
    data: hallTicketsData,
    isLoading: hallTicketsLoading,
    refetch: refetchHallTickets,
  } = useGetHallTicketsQuery(activeScheduleForTickets?.id || 0, {
    skip: !activeScheduleForTickets?.id || isTeacher,
  });

  useEffect(() => {
    if (examRows.length) {
      setSchedules(examRows.map(toSchedule));
    }
  }, [examRows]);

  useEffect(() => {
    if (timetablesError) {
      setRequestError(timetablesError instanceof Error ? timetablesError.message : 'Unable to load exam timetables.');
    }
  }, [timetablesError]);

  useEffect(() => {
    if (timetableRecords.length && !selectedScheduleIdForTickets) {
      setSelectedScheduleIdForTickets(timetableRecords[0].id);
    }
  }, [timetableRecords, selectedScheduleIdForTickets]);

  useEffect(() => {
    let active = true;
    const refreshAcademicStructure = () => {
      loadAcademicStructure()
        .then(({ classes, sections, subjects }) => {
          if (!active) return;
          setAcademicClasses(classes);
          setAcademicSections(sections);
          setAcademicSubjects(subjects);
        })
        .catch(() => undefined);
    };

    refreshAcademicStructure();
    window.addEventListener(ACADEMIC_STRUCTURE_CHANGED_EVENT, refreshAcademicStructure);
    return () => {
      active = false;
      window.removeEventListener(ACADEMIC_STRUCTURE_CHANGED_EVENT, refreshAcademicStructure);
    };
  }, []);

  const selectedClassObj = useMemo(() => {
    return academicClasses.find((c) => c.id === selectedClassId);
  }, [academicClasses, selectedClassId]);

  const activeWard = useMemo(() => {
    if (!students.length) return null;
    if (selectedWardId === 'all') return students[0];
    return students.find((s) => String(s.id) === selectedWardId) || students[0];
  }, [students, selectedWardId]);

  // When selected class changes during new schedule creation, populate subject rows
  const handleClassSelect = (classIdNum: number | '') => {
    setSelectedClassId(classIdNum);
    setRequestError('');
    if (!classIdNum) {
      setSubjectRows([]);
      return;
    }
    const classroom = academicClasses.find((c) => c.id === classIdNum);
    if (!classroom) {
      setSubjectRows([]);
      return;
    }
    const assignedSubIds = new Set(classroom.subjectIds || []);
    const assignedSubs = academicSubjects.filter((s) => assignedSubIds.has(s.id));
    setSubjectRows(
      assignedSubs.map((s) => ({
        subjectId: s.id,
        subjectName: s.name,
        examDate: '',
        startTime: '09:00',
        endTime: '12:00',
        maxMarks: 100,
      }))
    );
  };

  const updateSubjectRow = (index: number, field: keyof SubjectFormRow, value: any) => {
    setSubjectRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleEditSchedule = (timetable: ExamTimetableRecord) => {
    setEditingScheduleId(timetable.id);
    setExamName(timetable.name);
    setSelectedClassId(timetable.classroom);
    setShowCreator(true);
    setRequestError('');

    const classroom = academicClasses.find((c) => c.id === timetable.classroom);
    const assignedSubIds = new Set(classroom?.subjectIds || []);
    const allAssigned = academicSubjects.filter((s) => assignedSubIds.has(s.id));

    const rows: SubjectFormRow[] = allAssigned.map((sub) => {
      const existing = timetable.items.find(
        (item) => item.subject === sub.id || item.subject_name.toLowerCase() === sub.name.toLowerCase()
      );
      return {
        subjectId: sub.id,
        subjectName: sub.name,
        examDate: existing ? existing.exam_date : '',
        startTime: existing && existing.start_time ? existing.start_time.slice(0, 5) : '09:00',
        endTime: existing && existing.end_time ? existing.end_time.slice(0, 5) : '12:00',
        maxMarks: existing ? existing.max_marks : 100,
      };
    });

    setSubjectRows(
      rows.length
        ? rows
        : timetable.items.map((item) => ({
            subjectId: item.subject || 0,
            subjectName: item.subject_name,
            examDate: item.exam_date,
            startTime: item.start_time ? item.start_time.slice(0, 5) : '09:00',
            endTime: item.end_time ? item.end_time.slice(0, 5) : '12:00',
            maxMarks: item.max_marks,
          }))
    );
  };

  const cancelCreator = () => {
    setShowCreator(false);
    setEditingScheduleId(null);
    setExamName('');
    setSelectedClassId('');
    setSubjectRows([]);
    setRequestError('');
  };

  const validateForm = (isPublishing: boolean) => {
    if (!examName.trim()) {
      return 'Please enter an Exam Name.';
    }
    if (!selectedClassId) {
      return 'Please select a Class.';
    }
    if (subjectRows.length === 0) {
      return 'No subjects assigned to this class. Assign subjects in Academic Setup first.';
    }

    for (const row of subjectRows) {
      if (isPublishing) {
        if (!row.examDate) {
          return `Please provide the exam date for ${row.subjectName}.`;
        }
        if (!row.startTime || !row.endTime) {
          return `Please provide start and end times for ${row.subjectName}.`;
        }
      }
      if (row.startTime && row.endTime) {
        if (row.endTime <= row.startTime) {
          return `${row.subjectName}: End time (${row.endTime}) must be later than Start time (${row.startTime}).`;
        }
      }
      if (row.maxMarks <= 0) {
        return `${row.subjectName}: Maximum marks must be greater than 0.`;
      }
    }
    return null;
  };

  const handleSaveDraft = async () => {
    setRequestError('');
    const errorMsg = validateForm(false);
    if (errorMsg) {
      setRequestError(errorMsg);
      return;
    }
    setIsSubmitting(true);
    try {
      const itemsPayload: ExamScheduleItemRecord[] = subjectRows.map((row, index) => ({
        subject: row.subjectId || null,
        subject_name: row.subjectName,
        exam_date: row.examDate || new Date().toISOString().split('T')[0],
        start_time: row.startTime ? (row.startTime.length === 5 ? `${row.startTime}:00` : row.startTime) : '09:00:00',
        end_time: row.endTime ? (row.endTime.length === 5 ? `${row.endTime}:00` : row.endTime) : '12:00:00',
        max_marks: Number(row.maxMarks) || 100,
        order: index,
      }));

      const payload = {
        name: examName.trim(),
        classroom: Number(selectedClassId),
        items: itemsPayload,
      };

      if (editingScheduleId) {
        await updateScheduleMutation({ id: editingScheduleId, data: payload }).unwrap();
        emitNotification({
          title: 'Exam Draft Updated',
          message: `Timetable for ${selectedClassObj?.name || 'Class'} updated successfully.`,
          tone: 'success',
          source: 'exams',
        });
      } else {
        await createScheduleMutation(payload).unwrap();
        emitNotification({
          title: 'Exam Draft Saved',
          message: `Timetable for ${selectedClassObj?.name || 'Class'} saved as Draft.`,
          tone: 'success',
          source: 'exams',
        });
      }
      cancelCreator();
    } catch (err: any) {
      const msg =
        err?.data?.detail ||
        err?.data?.errors?.join(', ') ||
        (err instanceof Error ? err.message : 'Failed to save exam timetable draft.');
      setRequestError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePublishTimetable = async (scheduleIdToPublish?: number) => {
    setRequestError('');
    let targetId = scheduleIdToPublish;

    if (!targetId) {
      const errorMsg = validateForm(true);
      if (errorMsg) {
        setRequestError(errorMsg);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (!targetId) {
        const itemsPayload: ExamScheduleItemRecord[] = subjectRows.map((row, index) => ({
          subject: row.subjectId || null,
          subject_name: row.subjectName,
          exam_date: row.examDate,
          start_time: row.startTime.length === 5 ? `${row.startTime}:00` : row.startTime,
          end_time: row.endTime.length === 5 ? `${row.endTime}:00` : row.endTime,
          max_marks: Number(row.maxMarks) || 100,
          order: index,
        }));

        const payload = {
          name: examName.trim(),
          classroom: Number(selectedClassId),
          items: itemsPayload,
        };

        let savedRecord: ExamTimetableRecord;
        if (editingScheduleId) {
          savedRecord = await updateScheduleMutation({ id: editingScheduleId, data: payload }).unwrap();
        } else {
          savedRecord = await createScheduleMutation(payload).unwrap();
        }
        targetId = savedRecord.id;
      }

      const published = await publishScheduleMutation(targetId).unwrap();
      const body = `Official exam timetable for ${published.class_name} (${published.name}) has been published and sent to related students, parents, and teachers.`;

      emitNotification({
        title: 'Exam Timetable Published',
        message: body,
        tone: 'success',
        source: 'exams',
      });

      setSuccessMessage(`Exam timetable for ${published.class_name} successfully published and reached students, parents, and teachers!`);
      setTimeout(() => setSuccessMessage(''), 6000);
      cancelCreator();
    } catch (err: any) {
      const msg =
        err?.data?.detail ||
        err?.data?.errors?.join(', ') ||
        (err instanceof Error ? err.message : 'Failed to publish exam timetable.');
      setRequestError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnpublishTimetable = async (scheduleId: number) => {
    if (
      !window.confirm(
        'Revert this published timetable back to Draft? Students and parents will not be able to view it until re-published.'
      )
    ) {
      return;
    }
    setRequestError('');
    try {
      await unpublishScheduleMutation(scheduleId).unwrap();
      emitNotification({
        title: 'Timetable Reverted to Draft',
        message: 'The timetable is now in draft mode and hidden from students and parents.',
        tone: 'success',
        source: 'exams',
      });
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : 'Failed to unpublish timetable.');
    }
  };

  const handleDeleteSchedule = async (timetable: ExamTimetableRecord) => {
    if (
      !window.confirm(
        `Permanently delete ${timetable.name} for ${timetable.class_name}? This action cannot be undone.`
      )
    ) {
      return;
    }
    setRequestError('');
    try {
      await deleteScheduleMutation(timetable.id).unwrap();
      emitNotification({
        title: 'Timetable Deleted',
        message: `${timetable.name} has been removed.`,
        tone: 'success',
        source: 'exams',
      });
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : 'Failed to delete timetable.');
    }
  };

  // --- HALL TICKET GENERATION & DISTRIBUTION HANDLERS ---
  const handleGenerateHallTickets = async (scheduleId: number) => {
    setRequestError('');
    try {
      const res = await generateHallTicketsMutation(scheduleId).unwrap();
      emitNotification({
        title: 'Hall Tickets Generated',
        message: res.detail,
        tone: 'success',
        source: 'exams',
      });
      setSuccessMessage(res.detail);
      setTimeout(() => setSuccessMessage(''), 6000);
      void refetchHallTickets();
      void refetchSchedules();
    } catch (err: any) {
      const msg = err?.data?.detail || (err instanceof Error ? err.message : 'Failed to generate hall tickets.');
      setRequestError(msg);
    }
  };

  const handleReleaseHallTickets = async (scheduleId: number) => {
    if (
      !window.confirm(
        'Are you sure you want to approve and release hall tickets for this class? Admit cards will be officially distributed to all related Students and Parents.'
      )
    ) {
      return;
    }
    setRequestError('');
    try {
      const res = await releaseHallTicketsMutation(scheduleId).unwrap();
      emitNotification({
        title: 'Hall Tickets Approved & Distributed',
        message: res.detail,
        tone: 'success',
        source: 'exams',
      });
      setSuccessMessage(res.detail);
      setTimeout(() => setSuccessMessage(''), 6000);
      void refetchHallTickets();
      void refetchSchedules();
    } catch (err: any) {
      const msg = err?.data?.detail || (err instanceof Error ? err.message : 'Failed to release hall tickets.');
      setRequestError(msg);
    }
  };

  const handlePrint = (elementId: string) => {
    const printContent = document.getElementById(elementId);
    if (!printContent) {
      window.print();
      return;
    }
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Official Exam Hall Ticket</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
              @media print {
                body { -webkit-print-color-adjust: exact; print-color-adjust: exact; padding: 20px; }
                .no-print { display: none !important; }
              }
            </style>
          </head>
          <body class="bg-white p-6">
            ${printContent.innerHTML}
            <script>
              setTimeout(() => { window.print(); window.close(); }, 500);
            </script>
          </body>
        </html>
      `);
      win.document.close();
    } else {
      window.print();
    }
  };

  const filteredTimetables = useMemo(() => {
    if (selectedClassFilter === 'ALL') return timetableRecords;
    return timetableRecords.filter((t) => t.class_name === selectedClassFilter);
  }, [timetableRecords, selectedClassFilter]);

  const gradeCard = GRADE_CARDS[0];

  // Filtered Hall Tickets for Admin view
  const rawHallTickets: HallTicketRecord[] = useMemo(() => {
    return (hallTicketsData?.hall_tickets || []) as HallTicketRecord[];
  }, [hallTicketsData]);

  const filteredHallTickets = useMemo(() => {
    return rawHallTickets.filter((ticket) => {
      if (ticketSectionFilter !== 'ALL' && ticket.section !== ticketSectionFilter) {
        return false;
      }
      if (ticketSearchQuery.trim()) {
        const q = ticketSearchQuery.toLowerCase();
        const matchName = ticket.student_name?.toLowerCase().includes(q);
        const matchAdm = ticket.admission_no?.toLowerCase().includes(q);
        const matchNo = ticket.hall_ticket_no?.toLowerCase().includes(q);
        const matchRoll = String(ticket.roll_no).includes(q);
        if (!matchName && !matchAdm && !matchNo && !matchRoll) return false;
      }
      return true;
    });
  }, [rawHallTickets, ticketSectionFilter, ticketSearchQuery]);

  return (
    <div className="space-y-6 animate-fade-in pb-12" id="exam-module">
      {/* Header Banner */}
      <div className="portal-header-card flex flex-col lg:flex-row justify-between lg:items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-md shadow-indigo-100 shrink-0">
            <Award className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="portal-pill-badge indigo">
                {isAdmin
                  ? 'School Admin'
                  : isTeacher
                  ? 'Teacher View'
                  : isParent
                  ? 'Parent Portal'
                  : 'Student Portal'}
              </span>
              <span className="text-[11px] font-bold text-slate-400">Academic Assessment</span>
            </div>
            <h2 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">
              Examination Desk & Hall Tickets
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              {isAdmin
                ? 'Publish class-wide subject schedules, generate and approve official hall tickets for students and parents.'
                : isTeacher
                ? 'View assigned class exam datesheets, papers timetable, and record student marks.'
                : isParent
                ? 'View published exam schedules, official admit cards (hall tickets), and report cards for your children.'
                : 'View your published exam datesheet, papers schedule, and official hall ticket admit card.'}
            </p>
          </div>
        </div>

        {/* Local sub-navigation */}
        <div className="flex flex-wrap gap-1.5 bg-slate-100/80 p-1.5 rounded-2xl self-start lg:self-center border border-slate-200/70 shadow-2xs">
          <button
            onClick={() => setActiveTab('schedule')}
            className={`text-xs px-4 py-2 rounded-xl font-bold transition-all cursor-pointer ${
              activeTab === 'schedule' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Exam Schedule
          </button>

          {/* Hall Tickets Tab - Only for Admin, Student, and Parent (NOT Teachers) */}
          {!isTeacher && (
            <button
              onClick={() => setActiveTab('hallticket')}
              className={`text-xs px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'hallticket' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Ticket className="h-3.5 w-3.5 text-rose-500" />
              <span>Hall Tickets</span>
            </button>
          )}

          {(isAdmin || isTeacher) && (
            <button
              onClick={() => setActiveTab('marks-entry')}
              className={`text-xs px-4 py-2 rounded-xl font-bold transition-all cursor-pointer ${
                activeTab === 'marks-entry' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Marks Entry
            </button>
          )}

          {/* Report Cards Tab - Only for Admin, Student, and Parent (NOT Teachers) */}
          {!isTeacher && (
            <button
              onClick={() => setActiveTab('marks')}
              className={`text-xs px-4 py-2 rounded-xl font-bold transition-all cursor-pointer ${
                activeTab === 'marks' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Report Cards
            </button>
          )}
        </div>
      </div>

      {/* Success / Notification Banner */}
      {successMessage && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 font-bold shadow-xs">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Error Banner */}
      {requestError && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 font-bold shadow-xs">
          <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
          <span>{requestError}</span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 1: EXAM SCHEDULE                                                      */}
      {/* ========================================================================= */}
      {activeTab === 'schedule' && (
        <div className="portal-card p-6 space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-100 pb-4">
            <div>
              <h3 className="font-sans font-black text-slate-900 text-base">Class Exam Timetable & Schedule</h3>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                {isAdmin
                  ? 'Define exam dates and timings per subject. Once published, the schedule reaches all related students, parents, and teachers.'
                  : 'Published official examination schedules and paper timings.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {isAdmin && !showCreator && (
                <button
                  type="button"
                  onClick={() => {
                    setShowCreator(true);
                    setEditingScheduleId(null);
                    setExamName('');
                    setSelectedClassId('');
                    setSubjectRows([]);
                    setRequestError('');
                  }}
                  className="inline-flex items-center gap-1.5 rounded-2xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-indigo-700 transition shadow-xs cursor-pointer"
                >
                  <Plus className="h-4 w-4" /> Create Exam Timetable
                </button>
              )}
            </div>
          </div>

          {/* Schedule Creator / Editor Form (Admin only) */}
          {isAdmin && showCreator && (
            <div className="rounded-3xl border border-indigo-200 bg-slate-50/50 p-6 space-y-5 shadow-inner">
              <div className="flex items-center justify-between border-b border-indigo-100 pb-3">
                <h4 className="text-sm font-extrabold text-indigo-900 flex items-center gap-2">
                  <Layers className="h-4 w-4 text-indigo-600" />
                  {editingScheduleId ? 'Edit Exam Timetable' : 'Create New Class Exam Timetable'}
                </h4>
                <button onClick={cancelCreator} className="text-xs font-bold text-slate-500 hover:text-slate-800 cursor-pointer">
                  Cancel
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    Exam Title *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Midterm Assessment 2026"
                    value={examName}
                    onChange={(e) => setExamName(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    Select Target Class *
                  </label>
                  <select
                    value={selectedClassId}
                    disabled={Boolean(editingScheduleId)}
                    onChange={(e) => handleClassSelect(e.target.value ? Number(e.target.value) : '')}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-400 cursor-pointer"
                  >
                    <option value="">-- Choose Class --</option>
                    {academicClasses.map((cls) => (
                      <option key={cls.id} value={cls.id}>
                        {cls.name} ({cls.subjectIds?.length || 0} subjects assigned)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Subject Paper Rows */}
              {selectedClassId && (
                <div className="space-y-3 pt-2">
                  <h5 className="text-xs font-bold uppercase tracking-wider text-slate-700">Subject Papers & Timings</h5>
                  {subjectRows.length === 0 ? (
                    <p className="text-xs text-amber-700 bg-amber-50 p-3 rounded-xl border border-amber-200">
                      No subjects are assigned to this class yet. Please assign subjects in Academic Setup.
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider text-[10px]">
                          <tr>
                            <th className="p-3">Subject</th>
                            <th className="p-3">Exam Date *</th>
                            <th className="p-3">Start Time *</th>
                            <th className="p-3">End Time *</th>
                            <th className="p-3">Max Marks</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-medium">
                          {subjectRows.map((row, idx) => (
                            <tr key={row.subjectId || idx} className="hover:bg-slate-50">
                              <td className="p-3 font-bold text-slate-900">{row.subjectName}</td>
                              <td className="p-3">
                                <input
                                  type="date"
                                  value={row.examDate}
                                  onChange={(e) => updateSubjectRow(idx, 'examDate', e.target.value)}
                                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                />
                              </td>
                              <td className="p-3">
                                <input
                                  type="time"
                                  value={row.startTime}
                                  onChange={(e) => updateSubjectRow(idx, 'startTime', e.target.value)}
                                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                />
                              </td>
                              <td className="p-3">
                                <input
                                  type="time"
                                  value={row.endTime}
                                  onChange={(e) => updateSubjectRow(idx, 'endTime', e.target.value)}
                                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                />
                              </td>
                              <td className="p-3">
                                <input
                                  type="number"
                                  min="1"
                                  value={row.maxMarks}
                                  onChange={(e) => updateSubjectRow(idx, 'maxMarks', Number(e.target.value))}
                                  className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Form Action Buttons */}
              <div className="flex flex-wrap items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={cancelCreator}
                  className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSubmitting || !selectedClassId}
                  onClick={handleSaveDraft}
                  className="rounded-xl border border-indigo-200 bg-white px-4 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50 transition cursor-pointer disabled:opacity-50"
                >
                  Save as Draft
                </button>
                <button
                  type="button"
                  disabled={isSubmitting || !selectedClassId}
                  onClick={() => handlePublishTimetable()}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 shadow-xs transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Send className="h-3.5 w-3.5" />
                  Publish & Broadcast to Class
                </button>
              </div>
            </div>
          )}

          {/* Published & Draft Schedules Feed */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Class Filter:</span>
                <select
                  value={selectedClassFilter}
                  onChange={(e) => setSelectedClassFilter(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 shadow-2xs focus:outline-none cursor-pointer"
                >
                  <option value="ALL">All Classes ({timetableRecords.length})</option>
                  {academicClasses.map((cls) => (
                    <option key={cls.id} value={cls.name}>
                      {cls.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {filteredTimetables.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-400">
                <Calendar className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                <p className="text-sm font-bold text-slate-700">No exam schedules found</p>
                <p className="text-xs text-slate-500 mt-1">
                  {isAdmin
                    ? 'Click "Create Exam Timetable" above to create and publish schedules for classes.'
                    : 'Examination schedules will appear here once published by the school administration.'}
                </p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredTimetables.map((t) => {
                  const isPublished = t.status === 'published';
                  const hasTickets = t.hall_tickets_generated;
                  const isReleased = t.hall_tickets_released;

                  return (
                    <div
                      key={t.id}
                      className={`rounded-3xl border bg-white p-5 shadow-xs transition-all space-y-4 ${
                        isPublished ? 'border-slate-200 hover:border-indigo-300' : 'border-amber-200 bg-amber-50/20'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                                isPublished ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {t.status}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                              {t.class_name}
                            </span>
                          </div>
                          <h4 className="text-base font-black text-slate-900 mt-2">{t.name}</h4>
                          <p className="text-[11px] text-slate-500 font-semibold mt-0.5">
                            {t.items.length} Subject Papers Scheduled
                          </p>
                        </div>
                      </div>

                      {/* Hall Tickets Status Badge */}
                      <div className="rounded-2xl bg-slate-50 border border-slate-100 p-2.5 text-xs font-semibold">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-500 font-bold">Hall Tickets Status:</span>
                          {isReleased ? (
                            <span className="text-emerald-700 font-black flex items-center gap-1">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Distributed
                            </span>
                          ) : hasTickets ? (
                            <span className="text-amber-700 font-black flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5 text-amber-600" /> Pending Admin Approval
                            </span>
                          ) : isPublished ? (
                            <span className="text-indigo-700 font-bold">Ready to Generate</span>
                          ) : (
                            <span className="text-slate-400 italic">Publish schedule first</span>
                          )}
                        </div>

                        <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                          <span className="text-slate-500 font-bold">Marks Entry Window:</span>
                          {t.marks_entry_extended ? (
                            <span className="text-purple-700 font-black flex items-center gap-1">
                              <ShieldCheck className="h-3.5 w-3.5 text-purple-600" /> Extended by Admin
                            </span>
                          ) : isPublished ? (
                            <span className="text-indigo-700 font-bold flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5 text-indigo-600" /> 3 Days Post-Exam
                            </span>
                          ) : (
                            <span className="text-slate-400 italic">Upon exam completion</span>
                          )}
                        </div>
                      </div>

                      {/* Papers Preview */}
                      <div className="space-y-1.5 text-xs max-h-36 overflow-y-auto pr-1">
                        {t.items.map((item, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between bg-slate-50/70 p-2 rounded-xl text-[11px]"
                          >
                            <span className="font-bold text-slate-800">{item.subject_name}</span>
                            <span className="text-slate-500 font-mono">
                              {item.exam_date} ({item.start_time?.slice(0, 5)} - {item.end_time?.slice(0, 5)})
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Admin Actions */}
                      {isAdmin && (
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleEditSchedule(t)}
                              title="Edit Schedule"
                              className="p-2 rounded-xl bg-slate-100 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 transition cursor-pointer"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteSchedule(t)}
                              title="Delete Schedule"
                              className="p-2 rounded-xl bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-600 transition cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {isPublished ? (
                              <>
                                <button
                                  onClick={() => handleUnpublishTimetable(t.id)}
                                  className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                                >
                                  Unpublish
                                </button>
                                <button
                                  onClick={() => {
                                    setActiveTab('marks-entry');
                                  }}
                                  className="rounded-xl bg-purple-50 border border-purple-200 px-2.5 py-1.5 text-[11px] font-bold text-purple-700 hover:bg-purple-100 transition cursor-pointer flex items-center gap-1"
                                  title="Manage Marks & Extend Deadline"
                                >
                                  <Clock className="h-3 w-3 text-purple-600" />
                                  Marks Window
                                </button>
                                <button
                                  onClick={() => {
                                    setSelectedScheduleIdForTickets(t.id);
                                    setActiveTab('hallticket');
                                  }}
                                  className="rounded-xl bg-rose-500 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-rose-600 shadow-2xs transition cursor-pointer flex items-center gap-1"
                                >
                                  <Ticket className="h-3 w-3" /> Hall Tickets
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => handlePublishTimetable(t.id)}
                                className="rounded-xl bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-indigo-700 shadow-2xs transition cursor-pointer flex items-center gap-1"
                              >
                                <Send className="h-3 w-3" /> Publish Schedule
                              </button>
                            )}
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
      )}

      {/* ========================================================================= */}
      {/* TAB 2: HALL TICKETS (ADMIT CARDS)                                         */}
      {/* ========================================================================= */}
      {activeTab === 'hallticket' && !isTeacher && (
        <div className="space-y-6">
          {/* Top Control Bar */}
          <div className="portal-card p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-sans font-black text-slate-900 text-base flex items-center gap-2">
                  <Ticket className="h-5 w-5 text-rose-500" />
                  Official Examination Admit Cards / Hall Tickets
                </h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  {isAdmin
                    ? 'Generate and approve official hall tickets for published exam schedules. Once approved, hall tickets reach students and parents.'
                    : isParent
                    ? 'Download and print official examination hall tickets for your linked children.'
                    : 'Download and print your official examination hall ticket.'}
                </p>
              </div>

              {/* Schedule / Ward Switcher */}
              <div className="flex flex-wrap items-center gap-2">
                {isAdmin && (
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Select Exam Schedule:
                    </label>
                    <select
                      value={activeScheduleForTickets?.id || ''}
                      onChange={(e) => setSelectedScheduleIdForTickets(Number(e.target.value))}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 shadow-2xs focus:outline-none cursor-pointer"
                    >
                      {timetableRecords.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.class_name} — {t.name} ({t.status.toUpperCase()})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {isParent && students.length > 1 && (
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Select Child:
                    </label>
                    <select
                      value={selectedWardId}
                      onChange={(e) => setSelectedWardId(e.target.value)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 shadow-2xs focus:outline-none cursor-pointer"
                    >
                      {students.map((s) => (
                        <option key={s.id} value={String(s.id)}>
                          {s.name} ({s.class} {s.section ? `- ${s.section}` : ''})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Admin Workflow Status & Actions Bar */}
            {isAdmin && activeScheduleForTickets && (
              <div className="rounded-2xl border bg-slate-50 p-4 border-slate-200 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-600">Workflow State:</span>
                    {activeScheduleForTickets.status !== 'published' ? (
                      <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-black text-amber-800 flex items-center gap-1.5">
                        <AlertCircle className="h-3.5 w-3.5 text-amber-700" /> Schedule In Draft Mode
                      </span>
                    ) : activeScheduleForTickets.hall_tickets_released ? (
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-black text-emerald-800 flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Approved & Distributed
                      </span>
                    ) : activeScheduleForTickets.hall_tickets_generated ? (
                      <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-black text-amber-800 flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-amber-600" /> Awaiting Admin Approval
                      </span>
                    ) : (
                      <span className="rounded-full bg-indigo-100 px-3 py-1 text-[11px] font-black text-indigo-800">
                        Ready to Generate Hall Tickets
                      </span>
                    )}
                  </div>

                  {/* Actions for Admin */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Condition 1: If Draft, disabled with notice */}
                    {activeScheduleForTickets.status !== 'published' ? (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-amber-700 italic">
                          (Publish schedule first to generate hall tickets)
                        </span>
                        <button
                          onClick={() => handlePublishTimetable(activeScheduleForTickets.id)}
                          className="rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 shadow-2xs transition cursor-pointer"
                        >
                          Publish Schedule
                        </button>
                      </div>
                    ) : !activeScheduleForTickets.hall_tickets_generated ? (
                      /* Condition 2: Schedule Published -> Generate Hall Tickets */
                      <button
                        onClick={() => handleGenerateHallTickets(activeScheduleForTickets.id)}
                        disabled={isGeneratingTickets}
                        className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 shadow-xs transition cursor-pointer flex items-center gap-1.5"
                      >
                        <Ticket className="h-4 w-4" />
                        {isGeneratingTickets ? 'Generating...' : `Generate Hall Tickets for ${activeScheduleForTickets.class_name}`}
                      </button>
                    ) : !activeScheduleForTickets.hall_tickets_released ? (
                      /* Condition 3: Generated -> Await Admin Approval & Distribution */
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => handleGenerateHallTickets(activeScheduleForTickets.id)}
                          disabled={isGeneratingTickets}
                          className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                        >
                          Regenerate
                        </button>
                        <button
                          onClick={() => handleReleaseHallTickets(activeScheduleForTickets.id)}
                          disabled={isReleasingTickets}
                          className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-black text-white hover:bg-rose-700 shadow-md shadow-rose-500/20 transition cursor-pointer flex items-center gap-1.5"
                        >
                          <Send className="h-4 w-4" />
                          {isReleasingTickets ? 'Distributing...' : 'Approve & Distribute to Students & Parents'}
                        </button>
                      </div>
                    ) : (
                      /* Condition 4: Released -> Print All */
                      <button
                        onClick={() => handlePrint('hall-tickets-container')}
                        className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 shadow-xs transition cursor-pointer flex items-center gap-1.5"
                      >
                        <Printer className="h-4 w-4" /> Print All Hall Tickets
                      </button>
                    )}
                  </div>
                </div>

                {/* Filter inputs for Admin */}
                {rawHallTickets.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search student or roll no..."
                        value={ticketSearchQuery}
                        onChange={(e) => setTicketSearchQuery(e.target.value)}
                        className="rounded-xl border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-400 w-56"
                      />
                    </div>
                    <span className="text-xs font-bold text-slate-500">
                      Showing {filteredHallTickets.length} of {rawHallTickets.length} Admit Cards
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ======================================================================= */}
          {/* HALL TICKET CONTENT / ADMIT CARDS                                       */}
          {/* ======================================================================= */}
          <div id="hall-tickets-container" className="space-y-6">
            {/* Student & Parent View Pending Release State */}
            {(isStudent || isParent) && !hallTicketsData?.is_released && (
              <div className="rounded-3xl border border-dashed border-amber-300 bg-amber-50/50 p-12 text-center space-y-3">
                <Clock className="mx-auto h-10 w-10 text-amber-500 animate-pulse" />
                <h4 className="text-base font-black text-amber-900">Hall Tickets Pending Administrator Approval</h4>
                <p className="text-xs text-amber-700 max-w-md mx-auto leading-relaxed">
                  The examination schedule has been scheduled. Official admit cards (hall tickets) will be available here
                  once approved and released by the school administration.
                </p>
              </div>
            )}

            {/* Empty State */}
            {!hallTicketsLoading && rawHallTickets.length === 0 && (isAdmin || hallTicketsData?.is_released) && (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-400">
                <Ticket className="mx-auto h-10 w-10 text-slate-300 mb-2" />
                <p className="text-base font-bold text-slate-700">No hall tickets generated yet</p>
                <p className="text-xs text-slate-500 mt-1">
                  {isAdmin
                    ? 'Publish the exam schedule and click "Generate Hall Tickets" above to prepare admit cards.'
                    : 'Hall tickets will be available once issued by the school office.'}
                </p>
              </div>
            )}

            {/* Render Hall Tickets Cards */}
            <div className="grid gap-6">
              {(isParent && activeWard
                ? filteredHallTickets.filter((t) => String(t.student_id) === String(activeWard.id))
                : filteredHallTickets
              ).map((ticket) => {
                const ticketStudent = students.find((s) => String(s.id) === String(ticket.student_id));
                const ticketSchoolName =
                  ticket.school_name ||
                  activeScheduleForTickets?.school_name ||
                  (ticketStudent as any)?.school ||
                  (ticketStudent as any)?.schoolName ||
                  user?.schoolName ||
                  schoolName ||
                  '';

                return (
                <article
                  key={ticket.id}
                  id={`ticket-${ticket.id}`}
                  className="relative overflow-hidden rounded-3xl border-2 border-slate-300 bg-white p-6 sm:p-8 shadow-sm print:border print:shadow-none space-y-6"
                >
                  {/* Watermark Logo */}
                  <div className="absolute right-8 top-1/2 -translate-y-1/2 opacity-5 pointer-events-none select-none">
                    <GraduationCap className="h-96 w-96 text-slate-900" />
                  </div>

                  {/* Header Branding */}
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b-2 border-slate-900 pb-5">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-full">
                        Official Admit Card
                      </span>
                      {ticketSchoolName && (
                        <h1 className="text-xl sm:text-2xl font-black text-slate-950 uppercase tracking-tight mt-1.5">
                          {ticketSchoolName}
                        </h1>
                      )}
                      <h2 className={`${ticketSchoolName ? 'text-sm sm:text-base font-extrabold text-indigo-700 mt-0.5' : 'text-xl font-black text-slate-950 mt-1'} uppercase tracking-tight`}>
                        Examination Hall Ticket
                      </h2>
                      <p className="text-xs font-bold text-slate-600 mt-0.5">
                        {ticket.exam_name} · Academic Session {ticket.academic_year}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Hall Ticket No.</p>
                        <p className="font-mono text-sm font-black text-indigo-700">{ticket.hall_ticket_no}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handlePrint(`ticket-${ticket.id}`)}
                        title="Print this Hall Ticket"
                        className="no-print rounded-2xl border border-slate-200 bg-slate-50 p-2.5 text-slate-700 hover:bg-slate-100 transition shadow-2xs cursor-pointer"
                      >
                        <Printer className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Student Credentials Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Candidate Name</p>
                      <p className="text-sm font-black text-slate-900">{ticket.student_name}</p>
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Admission No</p>
                      <p className="font-mono text-xs font-extrabold text-slate-800">{ticket.admission_no || 'N/A'}</p>
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Class & Section</p>
                      <p className="text-xs font-extrabold text-slate-800">
                        {ticket.class_name} {ticket.section ? `- ${ticket.section}` : ''}
                      </p>
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Roll Number</p>
                      <p className="font-mono text-xs font-black text-indigo-700">#{ticket.roll_no}</p>
                    </div>
                  </div>

                  {/* Scheduled Papers Table */}
                  <div className="space-y-2">
                    <h5 className="text-[11px] font-black uppercase tracking-wider text-slate-700">
                      Admitted Subject Papers & Venue
                    </h5>
                    <div className="overflow-x-auto rounded-2xl border border-slate-200">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100 text-slate-800 font-bold uppercase text-[10px] tracking-wider">
                          <tr>
                            <th className="p-3">Subject Paper</th>
                            <th className="p-3">Exam Date</th>
                            <th className="p-3">Exam Timings</th>
                            <th className="p-3">Max Marks</th>
                            <th className="p-3">Assigned Venue</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-medium">
                          {ticket.papers.map((paper, pIdx) => (
                            <tr key={pIdx} className="hover:bg-slate-50">
                              <td className="p-3 font-black text-slate-900">{paper.subject_name}</td>
                              <td className="p-3 font-semibold text-slate-700">{paper.exam_date}</td>
                              <td className="p-3 font-mono font-bold text-indigo-700">
                                {paper.start_time} — {paper.end_time}
                              </td>
                              <td className="p-3 font-semibold text-slate-600">{paper.max_marks}</td>
                              <td className="p-3 font-semibold text-emerald-700">{paper.room_number || 'Main Hall'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Exam Instructions */}
                  <div className="rounded-2xl bg-slate-50 border border-slate-200/80 p-4 space-y-1.5 text-[11px] text-slate-600">
                    <p className="font-bold uppercase tracking-wider text-slate-800 text-[10px]">
                      Mandatory Examination Rules & Instructions:
                    </p>
                    <ul className="space-y-1 list-disc list-inside">
                      {ticket.instructions.map((ins, iIdx) => (
                        <li key={iIdx}>{ins}</li>
                      ))}
                    </ul>
                  </div>

                  {/* Footer Signatures */}
                  <div className="pt-6 border-t border-slate-200 flex items-end justify-between text-center text-xs">
                    <div>
                      <div className="h-10 w-32 border-b border-dashed border-slate-400 mx-auto" />
                      <p className="mt-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        Candidate Signature
                      </p>
                    </div>
                    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-2 text-indigo-800 text-[10px] font-bold flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4 text-indigo-600" />
                      Official School Authorized Seal
                    </div>
                    <div>
                      <div className="h-10 w-32 border-b border-dashed border-slate-400 mx-auto" />
                      <p className="mt-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        Controller of Examinations
                      </p>
                    </div>
                  </div>
                </article>
              );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: MARKS ENTRY (Admin / Teachers)                                      */}
      {/* ========================================================================= */}
      {activeTab === 'marks-entry' && (isAdmin || isTeacher) && (
        <MarksEntry user={user} students={students} />
      )}

      {/* ========================================================================= */}
      {/* TAB 4: OFFICIAL REPORT CARDS (Admin, Student, Parent ONLY - NOT Teacher)  */}
      {/* ========================================================================= */}
      {activeTab === 'marks' && !isTeacher && (
        <ParentExamResults
          user={user}
          students={students}
          schoolName={schoolName || user?.schoolName}
        />
      )}
    </div>
  );
}
