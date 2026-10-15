import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, Clock, BookOpen, User, MapPin, Copy, Save, Trash2, Send, AlertTriangle, CheckCircle2, RefreshCw, Layers, Plus } from 'lucide-react';
import { DayOfWeek, TimetableSlot, SchoolTimingConfig } from './types';
import { 
  DAYS_OF_WEEK,
  checkTeacherConflicts, checkClassroomConflicts, generatePeriodsList 
} from './utils';
import TimetableGrid from './TimetableGrid';
import {
  ACADEMIC_STRUCTURE_CHANGED_EVENT,
  AcademicClass,
  AcademicSection,
  AcademicSubject,
  loadAcademicStructure,
} from '../../services/academicStructure';
import { store } from '../../store';
import { teacherApi } from '../../store/api/teacherApi';
import { getErrorMessage } from '../../utils/apiError';
import {
  announceTeacherAssignmentsChanged,
  TEACHER_ASSIGNMENTS_CHANGED_EVENT,
} from '../../services/teacherAssignments';

interface TeacherOption {
  id: string | number;
  name: string;
  subjects?: string[];
  subjectIds?: number[];
  assignedSectionIds?: number[];
  assignedSections?: string[];
  teachingAssignments?: Array<{ sectionId: number; subjectId: number }>;
  status?: 'Active' | 'Inactive';
}

type TeacherPage = TeacherOption[] | { results?: TeacherOption[]; next?: string | null };

function normalizeTeacherOption(teacher: TeacherOption): TeacherOption {
  return {
    ...teacher,
    subjectIds: (teacher.subjectIds || []).map(Number),
    assignedSectionIds: (teacher.assignedSectionIds || []).map(Number),
    teachingAssignments: (teacher.teachingAssignments || []).map((assignment) => ({
      sectionId: Number(assignment.sectionId),
      subjectId: Number(assignment.subjectId),
    })).filter((assignment) => (
      Number.isFinite(assignment.sectionId) && Number.isFinite(assignment.subjectId)
    )),
  };
}

async function loadTeacherOptions(): Promise<TeacherOption[]> {
  const records = await store.dispatch(teacherApi.endpoints.getTeachers.initiate(undefined)).unwrap();
  return (records as unknown as TeacherOption[]).map(normalizeTeacherOption);
}

interface TimetableEditorProps {
  schoolId: string;
  currentAcademicYear: string;
  slots: TimetableSlot[];
  timingConfig: SchoolTimingConfig;
  onUpdateSlots: (updated: TimetableSlot[]) => Promise<void>;
  onPublishSlots: (sectionId: number) => Promise<void>;
  onUpdateTimingConfig: (updated: SchoolTimingConfig) => void;
  onAddNotification: (title: string, message: string, targetClass?: string, targetRole?: string) => void;
}

export default function TimetableEditor({
  schoolId,
  currentAcademicYear,
  slots,
  timingConfig,
  onUpdateSlots,
  onPublishSlots,
  onUpdateTimingConfig,
  onAddNotification
}: TimetableEditorProps) {
  // State for selections
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>('Monday');
  const [viewMode, setViewMode] = useState<'class' | 'teacher' | 'subject' | 'daily'>('class');

  // Secondary views filters
  const [filterTeacherId, setFilterTeacherId] = useState('');
  const [filterSubject, setFilterSubject] = useState('');
  const [academicClasses, setAcademicClasses] = useState<AcademicClass[]>([]);
  const [academicSections, setAcademicSections] = useState<AcademicSection[]>([]);
  const [academicSubjects, setAcademicSubjects] = useState<AcademicSubject[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [teacherLoadError, setTeacherLoadError] = useState('');

  // Modals / Panels toggles
  const [showConfigPanel, setShowConfigPanel] = useState(false);
  const [editingSlot, setEditingSlot] = useState<{ day: DayOfWeek; period: number; slot?: TimetableSlot } | null>(null);
  const [showCopyModal, setShowCopyModal] = useState(false);

  // Copy modal form
  const [copyToClass, setCopyToClass] = useState('');
  const [copyToSection, setCopyToSection] = useState('');

  // School timing config editing state
  const [configDays, setConfigDays] = useState<DayOfWeek[]>(timingConfig.workingDays);
  const [configStartTime, setConfigStartTime] = useState(timingConfig.startTime);
  const [configDuration, setConfigDuration] = useState(timingConfig.periodDuration);
  const [configTotalPeriods, setConfigTotalPeriods] = useState(timingConfig.totalPeriods);
  const [configBreakPeriod, setConfigBreakPeriod] = useState(timingConfig.breakPeriod);
  const [configBreakDuration, setConfigBreakDuration] = useState(timingConfig.breakDuration);
  const [configLunchPeriod, setConfigLunchPeriod] = useState(timingConfig.lunchPeriod);
  const [configLunchDuration, setConfigLunchDuration] = useState(timingConfig.lunchDuration);

  // Single Slot form state
  const [slotSubject, setSlotSubject] = useState('');
  const [slotTeacherId, setSlotTeacherId] = useState('');
  const [slotClassroom, setSlotClassroom] = useState('');
  const [assignmentTeacherId, setAssignmentTeacherId] = useState('');
  const [isAssigningTeacher, setIsAssigningTeacher] = useState(false);
  const [assignmentError, setAssignmentError] = useState('');
  const [isSavingTimetable, setIsSavingTimetable] = useState(false);

  // Conflict validation errors
  const [validationAlerts, setValidationAlerts] = useState<{ type: 'error' | 'warning'; msg: string }[]>([]);
  const selectedClassRecord = academicClasses.find((classroom) => classroom.name === selectedClass);
  const selectedSectionOptions = academicSections.filter((section) => section.classId === selectedClassRecord?.id);
  const copyClassRecord = academicClasses.find((classroom) => classroom.name === copyToClass);
  const copySectionOptions = academicSections.filter((section) => section.classId === copyClassRecord?.id);
  const selectedClassSubjectIds = new Set(selectedClassRecord?.subjectIds || []);
  const selectedClassSubjects = academicSubjects.filter((subject) => selectedClassSubjectIds.has(subject.id));
  const selectedSectionRecord = selectedSectionOptions.find((section) => section.name === selectedSection);
  const selectedSubjectRecord = selectedClassSubjects.find((subject) => subject.name === slotSubject);
  const activeTeachers = teachers.filter((teacher) => teacher.status !== 'Inactive');
  const eligibleTeachers = activeTeachers.filter((teacher) => {
    if (!selectedSectionRecord || !selectedSubjectRecord) return false;
    // 1. Explicit teaching assignment exists
    const hasExplicit = (teacher.teachingAssignments || []).some((assignment) => (
      Number(assignment.sectionId) === Number(selectedSectionRecord.id)
      && Number(assignment.subjectId) === Number(selectedSubjectRecord.id)
    ));
    if (hasExplicit) return true;

    // 2. Teacher is assigned to this section and this subject in profile
    const hasSection = (
      (teacher.assignedSectionIds || []).map(Number).includes(Number(selectedSectionRecord.id))
      || (teacher.assignedSections || []).some((s) => {
        const clean = s.trim().toLowerCase();
        const secName = selectedSectionRecord.name.trim().toLowerCase();
        const clsName = selectedClass.trim().toLowerCase();
        return clean === secName || clean === `${clsName}-${secName}` || clean === `${clsName} - ${secName}` || clean === `${clsName} ${secName}`;
      })
    );
    const hasSubject = (
      (teacher.subjectIds || []).map(Number).includes(Number(selectedSubjectRecord.id))
      || (teacher.subjects || []).some((sub) => sub.trim().toLowerCase() === selectedSubjectRecord.name.trim().toLowerCase())
    );

    return hasSection && hasSubject;
  });
  const teachersAvailableForAssignment = activeTeachers.filter(
    (teacher) => !eligibleTeachers.some((eligible) => String(eligible.id) === String(teacher.id)),
  );

  useEffect(() => {
    let active = true;
    const load = () => Promise.all([loadAcademicStructure(), loadTeacherOptions()])
      .then(([{ classes, sections, subjects }, teacherRows]) => {
        if (!active) return;
        setAcademicClasses(classes);
        setAcademicSections(sections);
        setAcademicSubjects(subjects);
        setTeachers(teacherRows);
        setTeacherLoadError('');
        setFilterTeacherId(String(teacherRows.find((teacher) => teacher.status !== 'Inactive')?.id || ''));
        const classroom = classes[0];
        const classSections = classroom ? sections.filter((section) => section.classId === classroom.id) : [];
        setSelectedClass(classroom?.name || '');
        setSelectedSection(classSections[0]?.name || '');
        setCopyToClass(classroom?.name || '');
        setCopyToSection(classSections[0]?.name || '');
        const classSubjectIds = new Set(classroom?.subjectIds || []);
        setFilterSubject(subjects.find((subject) => classSubjectIds.has(subject.id))?.name || '');
      })
      .catch((error) => {
        if (!active) return;
        setTeacherLoadError(error instanceof Error ? error.message : 'Could not load teachers.');
      });
    const refreshTeachers = () => loadTeacherOptions()
      .then((teacherRows) => {
        if (!active) return;
        setTeachers(teacherRows);
        setTeacherLoadError('');
      })
      .catch((error) => {
        if (!active) return;
        setTeacherLoadError(error instanceof Error ? error.message : 'Could not refresh teachers.');
      });
    void load();
    window.addEventListener(ACADEMIC_STRUCTURE_CHANGED_EVENT, load);
    window.addEventListener(TEACHER_ASSIGNMENTS_CHANGED_EVENT, refreshTeachers);
    return () => {
      active = false;
      window.removeEventListener(ACADEMIC_STRUCTURE_CHANGED_EVENT, load);
      window.removeEventListener(TEACHER_ASSIGNMENTS_CHANGED_EVENT, refreshTeachers);
    };
  }, [schoolId]);

  // Update config state when prop changes
  useEffect(() => {
    setConfigDays(timingConfig.workingDays);
    setConfigStartTime(timingConfig.startTime);
    setConfigDuration(timingConfig.periodDuration);
    setConfigTotalPeriods(timingConfig.totalPeriods);
    setConfigBreakPeriod(timingConfig.breakPeriod);
    setConfigBreakDuration(timingConfig.breakDuration);
    setConfigLunchPeriod(timingConfig.lunchPeriod);
    setConfigLunchDuration(timingConfig.lunchDuration);
  }, [timingConfig]);

  // Real-time slot editing conflict detection
  useEffect(() => {
    if (!editingSlot) return;

    const alerts: { type: 'error' | 'warning'; msg: string }[] = [];
    const targetDay = editingSlot.day;
    const targetPeriod = editingSlot.period;
    const currentId = editingSlot.slot?.id;

    // Check teacher conflicts
    if (slotTeacherId) {
      const teacherObj = teachers.find((teacher) => String(teacher.id) === slotTeacherId);
      const conflicts = checkTeacherConflicts(slots, slotTeacherId, targetDay, targetPeriod, currentId);
      if (conflicts.length > 0) {
        alerts.push({
          type: 'error',
          msg: `CONFLICT: ${teacherObj?.name} is already teaching ${conflicts[0].class}-${conflicts[0].section} (${conflicts[0].subject}) on ${targetDay} at Period ${targetPeriod}!`
        });
      }
    }

    // Check duplicate subject on the same day for this class/section
    if (slotSubject) {
      const duplicateSubject = slots.find(s => 
        s.class === selectedClass && 
        s.section === selectedSection && 
        s.day === targetDay && 
        s.subject.toLowerCase() === slotSubject.toLowerCase() && 
        s.id !== currentId
      );
      if (duplicateSubject) {
        alerts.push({
          type: 'warning',
          msg: `WARNING: ${slotSubject} is already scheduled on ${targetDay} (Period ${duplicateSubject.period}). Are you sure you want to schedule it twice?`
        });
      }
    }

    setValidationAlerts(alerts);
  }, [slotSubject, slotTeacherId, editingSlot, slots, selectedClass, selectedSection, teachers]);

  // Calculate subject tally for active class/section
  const subjectTally = React.useMemo(() => {
    const tally: { [subject: string]: number } = {};
    slots
      .filter(s => s.class === selectedClass && s.section === selectedSection && s.schoolId === schoolId)
      .forEach(s => {
        tally[s.subject] = (tally[s.subject] || 0) + 1;
      });
    return Object.entries(tally).sort((a, b) => b[1] - a[1]);
  }, [slots, selectedClass, selectedSection, schoolId]);

  // Handle Save Timing Configuration
  const handleSaveConfig = () => {
    const updated: SchoolTimingConfig = {
      workingDays: configDays,
      startTime: configStartTime,
      periodDuration: Number(configDuration),
      totalPeriods: Number(configTotalPeriods),
      breakPeriod: Number(configBreakPeriod),
      breakDuration: Number(configBreakDuration),
      lunchPeriod: Number(configLunchPeriod),
      lunchDuration: Number(configLunchDuration),
      academicYear: currentAcademicYear
    };
    onUpdateTimingConfig(updated);
    setShowConfigPanel(false);
    onAddNotification(
      'School Timings Updated',
      `School schedule configuration modified. Start time: ${configStartTime}, Period duration: ${configDuration} mins.`,
      undefined,
      'all'
    );
  };

  // Open Edit cell modal
  const handleCellClick = (day: DayOfWeek, period: number, existingSlot?: TimetableSlot) => {
    setEditingSlot({ day, period, slot: existingSlot });
    if (existingSlot) {
      setSlotSubject(existingSlot.subject);
      setSlotTeacherId(existingSlot.teacherId);
      setSlotClassroom(existingSlot.classroom);
    } else {
      setSlotSubject('');
      setSlotTeacherId('');
      setSlotClassroom('');
    }
    setAssignmentTeacherId('');
    setAssignmentError('');
  };

  const handleAddTeachingAssignment = async () => {
    if (!selectedSectionRecord || !selectedSubjectRecord || !assignmentTeacherId) return;
    setIsAssigningTeacher(true);
    setAssignmentError('');
    try {
      const updated = await store.dispatch(teacherApi.endpoints.addTeachingAssignment.initiate({
        teacherId: Number(assignmentTeacherId),
        sectionId: selectedSectionRecord.id,
        subjectId: selectedSubjectRecord.id,
      })).unwrap();
      const normalized = normalizeTeacherOption(updated as unknown as TeacherOption);
      setTeachers((current) => current.map((teacher) => (
        String(teacher.id) === String(normalized.id) ? normalized : teacher
      )));
      setSlotTeacherId(String(normalized.id));
      setAssignmentTeacherId('');
      announceTeacherAssignmentsChanged();
    } catch (error) {
      setAssignmentError(getErrorMessage(error, 'Could not assign this teacher.'));
    } finally {
      setIsAssigningTeacher(false);
    }
  };

  // Save/Schedule Period
  const handleSaveSlot = async () => {
    if (!editingSlot) return;

    if (!currentAcademicYear) {
      alert('Create and activate an academic year before saving timetable periods.');
      return;
    }

    const teacherObj = teachers.find((teacher) => String(teacher.id) === slotTeacherId);

    if (!slotSubject.trim()) {
      alert('Please select a subject before saving this timetable period.');
      return;
    }
    if (!slotTeacherId) {
      alert('Please select an instructor before saving this timetable period.');
      return;
    }
    if (!selectedSectionRecord || !selectedSubjectRecord || !teacherObj) {
      alert('The selected section, subject, or teacher is no longer available. Refresh and choose the assignment again.');
      return;
    }

    // Auto-link teaching assignment if teacher is assigned directly
    const hasAssignment = (teacherObj.teachingAssignments || []).some(
      (a) => Number(a.sectionId) === Number(selectedSectionRecord.id) && Number(a.subjectId) === Number(selectedSubjectRecord.id)
    );
    if (!hasAssignment) {
      try {
        await store.dispatch(teacherApi.endpoints.addTeachingAssignment.initiate({
          teacherId: Number(teacherObj.id),
          sectionId: selectedSectionRecord.id,
          subjectId: selectedSubjectRecord.id,
        })).unwrap();
        announceTeacherAssignmentsChanged();
      } catch {
        // Proceed even if assignment already logged
      }
    }
    const periodTime = generatePeriodsList(timingConfig).find((block) => (
      block.type === 'class' && block.periodNumber === editingSlot.period
    ))?.timeLabel;
    if (!periodTime) {
      alert('This period is outside the configured school timing rules. Update the timing rules and try again.');
      return;
    }

    // Prevent save if there are errors (but let warnings through)
    const hasError = validationAlerts.some(a => a.type === 'error');
    if (hasError) {
      alert('Cannot save slot due to a scheduling conflict. Please assign another teacher or room.');
      return;
    }

    const matchedSlot = editingSlot.slot || slots.find(s => 
      s.class === selectedClass && 
      s.section === selectedSection && 
      s.day === editingSlot.day && 
      s.period === editingSlot.period
    );

    const newSlot: TimetableSlot = {
      id: matchedSlot?.id || `slot-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      schoolId,
      academicYear: currentAcademicYear,
      class: selectedClass,
      section: selectedSection,
      sectionId: selectedSectionRecord.id,
      day: editingSlot.day,
      period: editingSlot.period,
      time: periodTime,
      subject: slotSubject,
      subjectId: selectedSubjectRecord.id,
      teacherId: slotTeacherId,
      teacherName: teacherObj?.name || 'Unassigned',
      classroom: slotClassroom.trim() || 'Default',
      published: false // initially Draft
    };

    let updatedSlots = [];
    if (matchedSlot) {
      // Update
      updatedSlots = slots.map(s => s.id === matchedSlot.id ? newSlot : s);
    } else {
      // Create
      updatedSlots = [...slots, newSlot];
    }

    setIsSavingTimetable(true);
    try {
      await onUpdateSlots(updatedSlots);
      setEditingSlot(null);
    } catch (error) {
      alert(getErrorMessage(error, 'The timetable period could not be saved.'));
    } finally {
      setIsSavingTimetable(false);
    }
  };

  // Delete Period Slot
  const handleDeleteSlot = async () => {
    const slotToDelete = editingSlot?.slot || slots.find(s =>
      s.class === selectedClass &&
      s.section === selectedSection &&
      s.day === editingSlot?.day &&
      s.period === editingSlot?.period
    );
    if (!slotToDelete) return;
    const updated = slots.filter(s => s.id !== slotToDelete.id);
    setIsSavingTimetable(true);
    try {
      await onUpdateSlots(updated);
      setEditingSlot(null);
    } catch (error) {
      alert(getErrorMessage(error, 'The timetable period could not be deleted.'));
    } finally {
      setIsSavingTimetable(false);
    }
  };

  // Copy entire Timetable to another class/section
  const handleCopyTimetable = async () => {
    if (copyToClass === selectedClass && copyToSection === selectedSection) {
      alert('Cannot copy to the same class and section.');
      return;
    }
    const targetSection = copySectionOptions.find((section) => section.name === copyToSection);
    if (!targetSection) {
      alert('Choose a valid destination section.');
      return;
    }

    const sourceSlots = slots.filter(s => 
      s.class === selectedClass && 
      s.section === selectedSection && 
      s.schoolId === schoolId && 
      s.academicYear === currentAcademicYear
    );

    if (sourceSlots.length === 0) {
      alert(`No slots found in ${selectedClass}-${selectedSection} to copy!`);
      return;
    }

    if (!window.confirm(`Copy all ${sourceSlots.length} periods from ${selectedClass}-${selectedSection} to ${copyToClass}-${copyToSection}? This will replace existing slots in target and attempt to auto-resolve conflicts.`)) {
      return;
    }

    // 1. Remove target slots
    let cleanSlots = slots.filter(s => 
      !(s.class === copyToClass && s.section === copyToSection && s.schoolId === schoolId && s.academicYear === currentAcademicYear)
    );

    let copiedCount = 0;
    let conflictCount = 0;

    // 2. Clone slots with conflict checks
    sourceSlots.forEach(src => {
      // Check if teacher has conflict in copyToClass period
      const teachConflicts = checkTeacherConflicts(cleanSlots, src.teacherId, src.day, src.period);
      const roomConflicts = checkClassroomConflicts(cleanSlots, src.classroom, src.day, src.period);
      const teacher = teachers.find((item) => String(item.id) === src.teacherId);
      const teacherCanTeachTarget = Boolean(
        teacher
        && (teacher.teachingAssignments || []).some((assignment) => (
          assignment.sectionId === targetSection.id
          && assignment.subjectId === src.subjectId
        )),
      );

      if (teachConflicts.length > 0 || roomConflicts.length > 0 || !teacherCanTeachTarget) {
        // Teacher or Room busy! Leave this slot blank or warn
        conflictCount++;
      } else {
        // Safe to copy!
        cleanSlots.push({
          ...src,
          id: `slot-copy-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          class: copyToClass,
          section: copyToSection,
          sectionId: targetSection.id,
          published: false // saved as draft
        });
        copiedCount++;
      }
    });

    if (copiedCount === 0) {
      alert('No periods can be copied. Assign the source teachers and subjects to the destination section first.');
      return;
    }

    setIsSavingTimetable(true);
    try {
      await onUpdateSlots(cleanSlots);
      setShowCopyModal(false);
      alert(`Timetable Copied Successfully!\n\n- ${copiedCount} periods copied to ${copyToClass}-${copyToSection} as Drafts.\n- ${conflictCount} periods omitted automatically due to active teacher or room conflicts at those slots.`);
      onAddNotification(
        'Timetable Cloned',
        `Schedule from ${selectedClass}-${selectedSection} copied to ${copyToClass}-${copyToSection}.`,
        copyToClass,
        'all'
      );
    } catch (error) {
      alert(error instanceof Error ? error.message : 'The timetable could not be copied.');
    } finally {
      setIsSavingTimetable(false);
    }
  };

  // Publish timetable for active class/section
  const handlePublishTimetable = async () => {
    const classSlots = slots.filter(s => 
      s.class === selectedClass && 
      s.section === selectedSection && 
      s.schoolId === schoolId && 
      s.academicYear === currentAcademicYear
    );

    if (classSlots.length === 0) {
      alert('Nothing to publish.');
      return;
    }

    if (!selectedSectionRecord) {
      alert('Select a valid class section before publishing.');
      return;
    }
    setIsSavingTimetable(true);
    try {
      await onPublishSlots(selectedSectionRecord.id);
      alert(`Timetable for ${selectedClass}-${selectedSection} is now PUBLISHED and LIVE across all user dashboards!`);
      onAddNotification(
        `Timetable Published: ${selectedClass}-${selectedSection}`,
        `New live class timetable published for ${selectedClass} - Section ${selectedSection}. Check schedules!`,
        selectedClass,
        'all'
      );
    } catch (error) {
      alert(getErrorMessage(error, 'The timetable could not be published.'));
    } finally {
      setIsSavingTimetable(false);
    }
  };

  return (
    <div className="space-y-6" id="timetable-admin-editor">
      {/* Upper Dashboard Sub-Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-lg border border-indigo-100">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Timetable Administration Panel</h2>
            <p className="text-xs text-slate-500 mt-0.5">Manual mode: select each class/section, then add subjects and teachers period-by-period.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowConfigPanel(true)}
            className="text-xs font-bold bg-white text-slate-700 hover:bg-slate-50 border border-slate-200 p-2 rounded-lg flex items-center gap-1.5 shadow-2xs transition-all"
            id="btn-edit-school-timings"
          >
            <Clock className="w-3.5 h-3.5 text-slate-500" />
            School Timing Rules
          </button>
          <button
            onClick={handlePublishTimetable}
            disabled={isSavingTimetable}
            className="text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-400 p-2 rounded-lg flex items-center gap-1.5 shadow-xs transition-all"
            id="btn-publish-timetable"
          >
            <Send className="w-3.5 h-3.5" />
            {isSavingTimetable ? 'Saving...' : 'Publish Live'}
          </button>
        </div>
      </div>

      {/* Main filter select blocks */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Structure View Mode</label>
          <select
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as any)}
            className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg mt-1 font-semibold focus:outline-indigo-500"
          >
            <option value="class">Class & Section View</option>
            <option value="teacher">Teacher Schedule</option>
            <option value="subject">Subject Audit</option>
          </select>
        </div>

        {viewMode === 'class' || viewMode === 'daily' ? (
          <>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Select Class</label>
              <select
                value={selectedClass}
                onChange={(e) => {
                  const classroom = academicClasses.find((item) => item.name === e.target.value);
                  const firstSection = academicSections.find((section) => section.classId === classroom?.id);
                  const classSubjectIds = new Set(classroom?.subjectIds || []);
                  const firstSubject = academicSubjects.find((subject) => classSubjectIds.has(subject.id));
                  setSelectedClass(e.target.value);
                  setSelectedSection(firstSection?.name || '');
                  setFilterSubject(firstSubject?.name || '');
                  setSlotSubject('');
                  setSlotTeacherId('');
                }}
                className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg mt-1 font-semibold focus:outline-indigo-500"
              >
                {!academicClasses.length && <option value="">No classes created</option>}
                {academicClasses.map((classroom) => <option key={classroom.id} value={classroom.name}>{classroom.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Select Section</label>
              <select
                value={selectedSection}
                onChange={(e) => setSelectedSection(e.target.value)}
                className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg mt-1 font-semibold focus:outline-indigo-500"
              >
                {!selectedSectionOptions.length && <option value="">No sections created</option>}
                {selectedSectionOptions.map((section) => <option key={section.id} value={section.name}>Section {section.name}</option>)}
              </select>
            </div>
            {viewMode === 'daily' && (
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Select Day</label>
                <select
                  value={selectedDay}
                  onChange={(e) => setSelectedDay(e.target.value as DayOfWeek)}
                  className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg mt-1 font-semibold focus:outline-indigo-500"
                >
                  {DAYS_OF_WEEK.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            )}
          </>
        ) : null}

        {viewMode === 'teacher' ? (
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Select Instructor</label>
            <select
              value={filterTeacherId}
              onChange={(e) => setFilterTeacherId(e.target.value)}
              className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg mt-1 font-semibold focus:outline-indigo-500"
            >
              {activeTeachers.length === 0 ? (
                 <option value="">No teachers created yet</option>
              ) : activeTeachers.map((teacher) => <option key={teacher.id} value={String(teacher.id)}>{teacher.name}</option>)}
            </select>
          </div>
        ) : null}

        {viewMode === 'subject' ? (
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Select Subject</label>
            <select
              value={filterSubject}
              onChange={(e) => setFilterSubject(e.target.value)}
              className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg mt-1 font-semibold focus:outline-indigo-500"
            >
              {!selectedClassSubjects.length && <option value="">No subjects assigned to this class</option>}
              {selectedClassSubjects.map((subject) => <option key={subject.id} value={subject.name}>{subject.name}</option>)}
            </select>
          </div>
        ) : null}
      </div>

      {/* Main body: Grid with Subject tally counter */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Core grid view */}
        <div className="lg:col-span-3 space-y-4">
          <TimetableGrid
            slots={slots}
            timingConfig={timingConfig}
            viewMode={viewMode}
            selectedClass={selectedClass}
            selectedSection={selectedSection}
            selectedTeacherId={filterTeacherId}
            selectedSubject={filterSubject}
            selectedDay={selectedDay}
            canEdit={true}
            onCellClick={handleCellClick}
          />
        </div>

        {/* Sidebar analytics */}
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-600 mb-3 flex items-center gap-1.5">
              <BookOpen className="w-4 h-4 text-indigo-500" />
              Weekly Allocations Tally
            </h3>
            <p className="text-[10px] text-slate-400 mb-4">Total class periods scheduled per subject this week for {selectedClass}-{selectedSection}.</p>

            <div className="space-y-2.5">
              {subjectTally.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-xs italic">
                  No periods scheduled.
                </div>
              ) : (
                subjectTally.map(([sub, count]) => {
                  const percent = Math.min((count / 8) * 100, 100);
                  return (
                    <div key={sub} className="space-y-1">
                      <div className="flex justify-between items-center text-xs font-medium">
                        <span className="text-slate-700 truncate">{sub}</span>
                        <span className="text-slate-900 font-mono font-bold bg-slate-100 border border-slate-200/50 px-1.5 py-0.2 rounded">{count} Periods</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${percent}%` }}></div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="bg-slate-900 text-white p-4 rounded-xl shadow-xs border border-slate-800 space-y-3">
            <h4 className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Timing Rules Active</h4>
            <div className="space-y-1.5 text-xs font-mono text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-400">Days:</span>
                <span>{timingConfig.workingDays.length} Days/wk</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Class Starts:</span>
                <span>{timingConfig.startTime} AM</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Duration:</span>
                <span>{timingConfig.periodDuration} Mins</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Recess Break:</span>
                <span>After Pd {timingConfig.breakPeriod}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Lunch Break:</span>
                <span>After Pd {timingConfig.lunchPeriod}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL 1: School Timing Config Panel */}
      {showConfigPanel && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex min-h-full items-center justify-center p-3 sm:p-4 animate-fade-in" role="presentation">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col p-4 sm:p-5 overflow-hidden my-auto animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-start pb-2.5 border-b border-slate-100 flex-shrink-0">
              <div>
                <h3 className="text-base font-bold text-slate-800">Configure School Operating Hours</h3>
                <p className="text-xs text-slate-400 mt-0.5">Define timings, durations, and recess rules to auto-calculate blocks.</p>
              </div>
              <button 
                onClick={() => setShowConfigPanel(false)} 
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors text-lg font-bold cursor-pointer"
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            <div className="space-y-2.5 py-2.5 overflow-y-auto flex-1 pr-1">
              {/* Working Days */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">School Working Days</label>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {DAYS_OF_WEEK.map(day => {
                    const active = configDays.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => {
                          if (active) {
                            setConfigDays(configDays.filter(d => d !== day));
                          } else {
                            setConfigDays([...configDays, day]);
                          }
                        }}
                        className={`text-xs font-bold py-1.5 px-2 rounded-lg border text-center transition-all cursor-pointer ${
                          active 
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs' 
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Start Time, Period Duration, Total Periods (3 columns in 1 row) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Start Time (24h format)</label>
                  <input
                    type="time"
                    value={configStartTime}
                    onChange={(e) => setConfigStartTime(e.target.value)}
                    className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg mt-1 font-semibold focus:outline-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Period Duration (Mins)</label>
                  <input
                    type="number"
                    min="15"
                    step="5"
                    value={configDuration}
                    onChange={(e) => setConfigDuration(Number(e.target.value))}
                    className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg mt-1 font-semibold focus:outline-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Periods Per Day</label>
                  <input
                    type="number"
                    min="2"
                    max="12"
                    value={configTotalPeriods}
                    onChange={(e) => setConfigTotalPeriods(Number(e.target.value))}
                    className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg mt-1 font-semibold focus:outline-indigo-500"
                  />
                </div>
              </div>

              {/* Recess & Lunch breaks in 2 side-by-side cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-0.5">
                {/* Short break (Recess) */}
                <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-2.5 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                    <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Recess Break</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500">After Period</label>
                      <input
                        type="number"
                        min="1"
                        max={configTotalPeriods - 1}
                        value={configBreakPeriod}
                        onChange={(e) => setConfigBreakPeriod(Number(e.target.value))}
                        className="w-full text-xs p-1.5 bg-white border border-slate-200 rounded-lg mt-0.5 font-semibold focus:outline-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500">Duration (Mins)</label>
                      <input
                        type="number"
                        min="5"
                        step="5"
                        value={configBreakDuration}
                        onChange={(e) => setConfigBreakDuration(Number(e.target.value))}
                        className="w-full text-xs p-1.5 bg-white border border-slate-200 rounded-lg mt-0.5 font-semibold focus:outline-indigo-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Lunch Break */}
                <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-2.5 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Lunch Break</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500">After Period</label>
                      <input
                        type="number"
                        min="1"
                        max={configTotalPeriods - 1}
                        value={configLunchPeriod}
                        onChange={(e) => setConfigLunchPeriod(Number(e.target.value))}
                        className="w-full text-xs p-1.5 bg-white border border-slate-200 rounded-lg mt-0.5 font-semibold focus:outline-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500">Duration (Mins)</label>
                      <input
                        type="number"
                        min="10"
                        step="5"
                        value={configLunchDuration}
                        onChange={(e) => setConfigLunchDuration(Number(e.target.value))}
                        className="w-full text-xs p-1.5 bg-white border border-slate-200 rounded-lg mt-0.5 font-semibold focus:outline-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-2.5 border-t border-slate-100 flex-shrink-0">
              <span className="text-[11px] text-slate-400 hidden sm:inline">Changes apply dynamically across all class grids</span>
              <div className="flex gap-2 ml-auto">
                <button
                  onClick={() => setShowConfigPanel(false)}
                  className="text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 px-4 py-2 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveConfig}
                  className="text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save Timing Rules
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL 2: Add / Edit Period Slot */}
      {editingSlot && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex min-h-full items-center justify-center p-3 sm:p-4 animate-fade-in" role="presentation">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col p-4 sm:p-5 overflow-hidden my-auto animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-start pb-2.5 border-b border-slate-100 flex-shrink-0">
              <div>
                <h3 className="text-base font-bold text-slate-800">
                  {editingSlot.slot ? 'Edit Period Allocation' : 'Assign New Period Slot'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Class: {selectedClass} {selectedSection} • {editingSlot.day} Period {editingSlot.period}
                </p>
              </div>
              <button 
                onClick={() => setEditingSlot(null)} 
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors text-lg font-bold cursor-pointer"
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            <div className="space-y-3 py-2.5 overflow-y-auto flex-1 pr-1">
              {/* Subject & Teacher in 2 columns */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Subject */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Select Subject</label>
                  <select
                    value={slotSubject}
                    onChange={(e) => {
                      setSlotSubject(e.target.value);
                      setSlotTeacherId('');
                      setAssignmentTeacherId('');
                      setAssignmentError('');
                    }}
                    className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg mt-1 font-semibold focus:outline-indigo-500"
                  >
                    <option value="">-- Choose Subject --</option>
                    {selectedClassSubjects.map((subject) => <option key={subject.id} value={subject.name}>{subject.name}</option>)}
                  </select>
                </div>

                {/* Teacher */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Assigned Teacher</label>
                  <select
                    value={slotTeacherId}
                    onChange={(e) => setSlotTeacherId(e.target.value)}
                    className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg mt-1 font-semibold focus:outline-indigo-500 truncate"
                  >
                    <option value="">-- Choose Instructor --</option>
                    {eligibleTeachers.length > 0 && (
                      <optgroup label="Assigned in Teacher Profile">
                        {eligibleTeachers.map((teacher) => (
                          <option key={teacher.id} value={String(teacher.id)}>
                            {teacher.name}{teacher.subjects?.length ? ` (${teacher.subjects.join('/')})` : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {teachersAvailableForAssignment.length > 0 && (
                      <optgroup label={eligibleTeachers.length > 0 ? "Other School Teachers" : "All School Teachers"}>
                        {teachersAvailableForAssignment.map((teacher) => (
                          <option key={teacher.id} value={String(teacher.id)}>
                            {teacher.name}{teacher.subjects?.length ? ` (${teacher.subjects.join('/')})` : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              </div>

              {teacherLoadError && (
                <p className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-[11px] font-semibold text-rose-700">
                  Teachers could not be loaded: {teacherLoadError}
                </p>
              )}
              {slotSubject && selectedSectionRecord && !teacherLoadError && (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-bold text-slate-700">
                      {eligibleTeachers.length > 0 ? (
                        <span className="text-emerald-700 font-semibold flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 inline shrink-0" />
                          {eligibleTeachers.length} teacher{eligibleTeachers.length === 1 ? '' : 's'} assigned to {selectedClass} - {selectedSection} for {slotSubject}.
                        </span>
                      ) : (
                        <span className="text-amber-800">
                          No teacher specifically designated for {selectedClass} - {selectedSection} ({slotSubject}) in profiles. You can pick any teacher above, or link one below:
                        </span>
                      )}
                    </p>
                  </div>
                  {teachersAvailableForAssignment.length > 0 ? (
                    <div className="mt-2.5 flex flex-col gap-2 sm:flex-row items-stretch sm:items-center">
                      <select
                        value={assignmentTeacherId}
                        onChange={(event) => {
                          setAssignmentTeacherId(event.target.value);
                          setAssignmentError('');
                        }}
                        className="min-w-0 flex-1 max-w-full rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 truncate"
                      >
                        <option value="">Quick-link an existing teacher...</option>
                        {teachersAvailableForAssignment.map((teacher) => (
                          <option key={teacher.id} value={String(teacher.id)}>
                            {teacher.name} — {teacher.subjects?.length ? teacher.subjects.join(', ') : 'General'} ({teacher.assignedSections?.length || 0} classes assigned)
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleAddTeachingAssignment}
                        disabled={!assignmentTeacherId || isAssigningTeacher}
                        className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 transition-colors cursor-pointer"
                      >
                        {isAssigningTeacher ? 'Assigning...' : 'Assign & use'}
                      </button>
                    </div>
                  ) : activeTeachers.length === 0 ? (
                    <p className="mt-2 text-[11px] text-amber-700">Create an active teacher profile first.</p>
                  ) : null}
                  <p className="mt-1.5 text-[10px] leading-4 text-slate-500">
                    Adds this class-section and subject to the teacher's profile assignments.
                  </p>
                  {assignmentError && <p className="mt-1.5 text-[11px] font-semibold text-rose-700">{assignmentError}</p>}
                </div>
              )}

              {/* CONFLICT WARNINGS AREA */}
              {validationAlerts.length > 0 && (
                <div className="p-2.5 bg-rose-50 border border-rose-100 rounded-xl space-y-1.5">
                  {validationAlerts.map((alert, idx) => (
                    <div key={idx} className="flex gap-2 text-xs font-semibold items-start leading-tight">
                      {alert.type === 'error' ? (
                        <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      )}
                      <span className={alert.type === 'error' ? 'text-rose-700' : 'text-amber-700'}>{alert.msg}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-between items-center gap-2 pt-2.5 border-t border-slate-100 flex-shrink-0">
              {editingSlot.slot ? (
                <button
                  onClick={handleDeleteSlot}
                  disabled={isSavingTimetable}
                  className="text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 border border-rose-100/50 px-3.5 py-2 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Period
                </button>
              ) : <div />}

              <div className="flex gap-2">
                <button
                  onClick={() => setEditingSlot(null)}
                  className="text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 px-4 py-2 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveSlot}
                  disabled={isSavingTimetable || validationAlerts.some(a => a.type === 'error')}
                  className="text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-lg flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  {isSavingTimetable ? 'Saving...' : 'Save Period'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL 3: Copy Timetable Modal */}
      {showCopyModal && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex min-h-full items-center justify-center p-3 sm:p-4 animate-fade-in" role="presentation">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col p-4 sm:p-5 overflow-hidden my-auto animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-start pb-2.5 border-b border-slate-100 flex-shrink-0">
              <div>
                <h3 className="text-base font-bold text-slate-800">Copy Class Timetable</h3>
                <p className="text-xs text-slate-400 mt-0.5">Duplicates entire slot maps across class sections in a single click.</p>
              </div>
              <button 
                onClick={() => setShowCopyModal(false)} 
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors text-lg font-bold cursor-pointer"
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            <div className="space-y-3 py-2.5 overflow-y-auto flex-1 pr-1">
              <div className="p-3 bg-indigo-50 border border-indigo-100/50 rounded-xl text-xs text-indigo-700 font-medium">
                Copying weekly plan from <span className="font-bold">{selectedClass} - {selectedSection}</span> to another class. Conflict solver will auto-clear slots where target teacher/room is already busy.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Destination Class</label>
                  <select
                    value={copyToClass}
                    onChange={(e) => {
                      const classroom = academicClasses.find((item) => item.name === e.target.value);
                      const firstSection = academicSections.find((section) => section.classId === classroom?.id);
                      setCopyToClass(e.target.value);
                      setCopyToSection(firstSection?.name || '');
                    }}
                    className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg mt-1 font-semibold focus:outline-indigo-500"
                  >
                    {academicClasses.map((classroom) => <option key={classroom.id} value={classroom.name}>{classroom.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Destination Section</label>
                  <select
                    value={copyToSection}
                    onChange={(e) => setCopyToSection(e.target.value)}
                    className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg mt-1 font-semibold focus:outline-indigo-500"
                  >
                    {copySectionOptions.map((section) => <option key={section.id} value={section.name}>Section {section.name}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2.5 border-t border-slate-100 flex-shrink-0">
              <button
                onClick={() => setShowCopyModal(false)}
                className="text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 px-4 py-2 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleCopyTimetable}
                disabled={isSavingTimetable}
                className="text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-400 px-4 py-2 rounded-lg flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                Execute Copy
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
