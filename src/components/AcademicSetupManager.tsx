import { useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Edit3,
  GraduationCap,
  Layers3,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { getErrorData, getErrorMessage, getErrorStatus } from '../utils/apiError';
import { emitNotification } from '../services/notificationBus';
import {
  useGetAcademicYearsQuery,
  useCreateAcademicYearMutation,
  useUpdateAcademicYearMutation,
  useDeleteAcademicYearMutation,
  useGetClassesQuery,
  useCreateClassMutation,
  useUpdateClassMutation,
  useDeleteClassMutation,
  useGetSectionsQuery,
  useCreateSectionMutation,
  useUpdateSectionMutation,
  useDeleteSectionMutation,
  useGetSubjectsQuery,
  useCreateSubjectMutation,
  useUpdateSubjectMutation,
  useDeleteSubjectMutation,
} from '../store/api/academicApi';

export interface AcademicSetupManagerProps {
  /** Called after a successful database mutation so parent forms can reload their options. */
  onChanged?: () => void | Promise<void>;
  /** Opens teacher management after classes, subjects, and sections are ready. */
  onOpenTeachers?: () => void;
  className?: string;
}

interface AcademicYearRecord {
  id: number;
  name: string;
  startsOn: string;
  endsOn: string;
  is_active: boolean;
}

interface SubjectReference {
  id?: number;
}

interface ClassRecord {
  id: number;
  name: string;
  code: string;
  sortOrder: number;
  subjectIds?: number[];
  subjects?: Array<number | SubjectReference>;
}

interface SectionRecord {
  id: number;
  classId: number;
  name: string;
}

interface SubjectRecord {
  id: number;
  name: string;
}

interface YearForm {
  name: string;
  startsOn: string;
  endsOn: string;
  isActive: boolean;
}

interface ClassForm {
  name: string;
  code: string;
  sortOrder: number;
  subjectIds: number[];
}

interface SectionForm {
  classId: string;
  name: string;
}

type AcademicEntityKind = 'year' | 'class' | 'section' | 'subject';

interface DeleteReference {
  code: string;
  label: string;
  count: number;
  examples: string[];
  deletionPolicy: 'blocked' | 'cascade' | 'detach';
  message: string;
}

interface CascadeDeleteOption {
  kind: AcademicEntityKind;
  id: number;
  label: string;
  path: string;
  parameter: 'sections';
  summary: string;
}

interface SetupError {
  title: string;
  message: string;
  references?: DeleteReference[];
  actions?: string[];
  cascade?: CascadeDeleteOption;
}

const emptyYearForm = (): YearForm => ({
  name: '',
  startsOn: '',
  endsOn: '',
  isActive: false,
});

const emptyClassForm = (): ClassForm => ({
  name: '',
  code: '',
  sortOrder: 0,
  subjectIds: [],
});

const emptySectionForm = (): SectionForm => ({
  classId: '',
  name: '',
});

const inputClass = 'mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-100';
const labelClass = 'block text-[10px] font-extrabold uppercase tracking-wider text-slate-500';

function errorMessage(error: unknown): SetupError {
  return {
    title: 'The action could not be completed',
    message: getErrorMessage(error),
  };
}

const dependencyGuidance: Record<string, string> = {
  sections: 'In Step 4, delete the sections in this class after moving any students and teachers out of them.',
  students: 'Open Students and move the linked students to another class or section first.',
  teachers: 'Open Teachers, edit the linked teachers, and remove this section or subject from their assignments.',
  classes: 'In Step 3, edit the linked classes and deselect this subject first.',
  exams: 'Open Exams and remove or move the linked exam records first.',
  student_academic_history: 'Academic history must be retained. Rename or deactivate this academic year instead of deleting it.',
  legacy_student_assignments: 'Move the older student records to a current class and section first.',
  legacy_teacher_assignments: 'Open Teachers and replace the older text-based subject assignment first.',
  database_references: 'Remove or reassign the linked records, then try deleting again.',
};

function normalizedDeleteReference(value: unknown): DeleteReference | null {
  if (typeof value === 'string') {
    return {
      code: value.toLowerCase().replace(/\s+/g, '_'),
      label: value,
      count: 0,
      examples: [],
      deletionPolicy: 'blocked',
      message: '',
    };
  }
  if (!value || typeof value !== 'object') return null;
  const reference = value as Record<string, unknown>;
  if (typeof reference.code !== 'string' || typeof reference.label !== 'string') return null;
  return {
    code: reference.code,
    label: reference.label,
    count: typeof reference.count === 'number' && Number.isFinite(reference.count) ? reference.count : 0,
    examples: Array.isArray(reference.examples)
      ? reference.examples.filter((example): example is string => typeof example === 'string')
      : [],
    deletionPolicy: reference.deletionPolicy === 'cascade' || reference.deletionPolicy === 'detach'
      ? reference.deletionPolicy
      : 'blocked',
    message: typeof reference.message === 'string' ? reference.message : '',
  };
}

function deleteError(error: unknown, kind: AcademicEntityKind, id: number, label: string, path: string): SetupError {
  const status = getErrorStatus(error);
  if (status !== 409) return errorMessage(error);

  const errorData = getErrorData(error);
  const references = Array.isArray(errorData?.references)
    ? errorData.references.map(normalizedDeleteReference).filter((reference): reference is DeleteReference => reference !== null)
    : [];
  const blockedReferences = references.filter((reference) => reference.deletionPolicy === 'blocked');
  const actions = [...new Set(blockedReferences
    .map((reference) => reference.message || dependencyGuidance[reference.code])
    .filter(Boolean))];
  const canCascade = kind === 'class'
    && errorData?.canCascade === true
    && errorData?.cascadeParam === 'sections';
  const cascadeSummary = typeof errorData?.cascadeSummary === 'string'
    ? errorData.cascadeSummary
    : 'The class and its empty sections will be deleted. Teachers and subjects will be kept.';
  const detail = getErrorMessage(error);
  return {
    title: canCascade ? `Confirm deletion of ${label}` : `Cannot delete ${label}`,
    message: `${detail} Nothing was deleted.`,
    references,
    actions: actions.length
      ? actions
      : canCascade
        ? undefined
        : ['Remove or reassign the linked records, then try deleting again.'],
    cascade: canCascade ? { kind, id, label, path, parameter: 'sections', summary: cascadeSummary } : undefined,
  };
}

function classCodeFromName(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function classSubjectIds(classroom: ClassRecord): number[] {
  if (Array.isArray(classroom.subjectIds)) {
    return classroom.subjectIds.map(Number).filter(Number.isFinite);
  }
  if (!Array.isArray(classroom.subjects)) return [];
  return classroom.subjects
    .map((subject) => typeof subject === 'number' ? subject : Number(subject.id))
    .filter(Number.isFinite);
}

export default function AcademicSetupManager({ onChanged, onOpenTeachers, className = '' }: AcademicSetupManagerProps) {
  const { data: yearRows = [], isLoading: yearsLoading, refetch: refetchYears } = useGetAcademicYearsQuery();
  const { data: classRows = [], isLoading: classesLoading, refetch: refetchClasses } = useGetClassesQuery();
  const { data: sectionRows = [], isLoading: sectionsLoading, refetch: refetchSections } = useGetSectionsQuery();
  const { data: subjectRows = [], isLoading: subjectsLoading, refetch: refetchSubjects } = useGetSubjectsQuery();

  const [createYear] = useCreateAcademicYearMutation();
  const [updateYear] = useUpdateAcademicYearMutation();
  const [deleteYear] = useDeleteAcademicYearMutation();
  const [createClass] = useCreateClassMutation();
  const [updateClass] = useUpdateClassMutation();
  const [deleteClass] = useDeleteClassMutation();
  const [createSection] = useCreateSectionMutation();
  const [updateSection] = useUpdateSectionMutation();
  const [deleteSection] = useDeleteSectionMutation();
  const [createSubject] = useCreateSubjectMutation();
  const [updateSubject] = useUpdateSubjectMutation();
  const [deleteSubject] = useDeleteSubjectMutation();

  const academicYears = useMemo(
    () => [...yearRows].sort((left, right) => right.startsOn.localeCompare(left.startsOn)),
    [yearRows],
  );
  const classes = classRows;
  const sections = sectionRows;
  const subjects = subjectRows;

  const [yearForm, setYearForm] = useState<YearForm>(emptyYearForm);
  const [classForm, setClassForm] = useState<ClassForm>(emptyClassForm);
  const [sectionForm, setSectionForm] = useState<SectionForm>(emptySectionForm);
  const [subjectName, setSubjectName] = useState('');

  const [editingYearId, setEditingYearId] = useState<number | null>(null);
  const [editingClassId, setEditingClassId] = useState<number | null>(null);
  const [editingSectionId, setEditingSectionId] = useState<number | null>(null);
  const [editingSubjectId, setEditingSubjectId] = useState<number | null>(null);

  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState<SetupError | null>(null);
  const [success, setSuccess] = useState('');
  const sectionFormRef = useRef<HTMLFormElement>(null);
  const sectionNameRef = useRef<HTMLInputElement>(null);

  const isLoading = yearsLoading || classesLoading || sectionsLoading || subjectsLoading;

  const sortedClasses = useMemo(
    () => [...classes].sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.name.localeCompare(right.name, undefined, { numeric: true })),
    [classes],
  );

  const sortedSubjects = useMemo(
    () => [...subjects].sort((left, right) => left.name.localeCompare(right.name)),
    [subjects],
  );

  const sectionsByClass = useMemo(() => {
    const grouped = new Map<number, SectionRecord[]>();
    sections.forEach((section) => {
      const classSections = grouped.get(section.classId) || [];
      classSections.push(section);
      grouped.set(section.classId, classSections);
    });
    grouped.forEach((classSections) => classSections.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true })));
    return grouped;
  }, [sections]);

  const notifyParent = () => {
    if (!onChanged) return;
    try {
      void Promise.resolve(onChanged()).catch(() => undefined);
    } catch {
      // A parent refresh failure must not make a completed database mutation look unsuccessful.
    }
  };

  const mutate = async (
    action: string,
    successMessage: string,
    operation: () => Promise<unknown>,
    mapError: (mutationError: unknown) => SetupError = errorMessage,
  ) => {
    setBusyAction(action);
    setError(null);
    setSuccess('');
    try {
      await operation();
      setSuccess(successMessage);
      notifyParent();
      emitNotification({
        title: 'Academic Setup',
        message: successMessage,
        tone: 'success',
        source: 'academics',
      });
      return true;
    } catch (mutationError) {
      const err = mapError(mutationError);
      setError(err);
      emitNotification({
        title: 'Academic Setup Failed',
        message: err.message || 'Operation could not be completed.',
        tone: 'danger',
        source: 'academics',
      });
      return false;
    } finally {
      setBusyAction('');
    }
  };

  const refresh = async () => {
    setError(null);
    setSuccess('');
    try {
      await Promise.all([
        refetchYears(),
        refetchClasses(),
        refetchSections(),
        refetchSubjects(),
      ]);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  };

  const cancelYearEdit = () => {
    setEditingYearId(null);
    setYearForm(emptyYearForm());
  };

  const cancelClassEdit = () => {
    setEditingClassId(null);
    setClassForm(emptyClassForm());
  };

  const cancelSectionEdit = () => {
    setEditingSectionId(null);
    setSectionForm(emptySectionForm());
  };

  const cancelSubjectEdit = () => {
    setEditingSubjectId(null);
    setSubjectName('');
  };

  const focusSectionForm = (classroomId: number, classroomName: string) => {
    setEditingSectionId(null);
    setSectionForm({ classId: String(classroomId), name: '' });
    setSuccess(`Ready to add sections to ${classroomName}. Enter a section name below.`);
    window.requestAnimationFrame(() => {
      sectionFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      sectionNameRef.current?.focus({ preventScroll: true });
    });
  };

  const saveYear = async (event: FormEvent) => {
    event.preventDefault();
    if (editingYearId === null && academicYears.length >= 1) {
      setError({
        title: 'Batch limit reached',
        message: 'Only one batch is permitted per school. Please edit the existing batch as the year changes.',
      });
      return;
    }
    if (yearForm.endsOn <= yearForm.startsOn) {
      setError({ title: 'Check the academic-year dates', message: 'The end date must be after the start date.' });
      return;
    }
    const editing = editingYearId !== null;
    const saved = await mutate(
      'year-save',
      `Academic year ${editing ? 'updated' : 'created'} in the database.`,
      () => editing
        ? updateYear({ id: editingYearId!, name: yearForm.name.trim(), startsOn: yearForm.startsOn, endsOn: yearForm.endsOn, is_active: yearForm.isActive }).unwrap()
        : createYear({ name: yearForm.name.trim(), startsOn: yearForm.startsOn, endsOn: yearForm.endsOn, is_active: yearForm.isActive }).unwrap(),
    );
    if (saved) cancelYearEdit();
  };

  const saveClass = async (event: FormEvent) => {
    event.preventDefault();
    const editing = editingClassId !== null;
    let savedClass: ClassRecord | null = null;
    const saved = await mutate(
      'class-save',
      `Class ${editing ? 'updated' : 'created'} in the database.`,
      async () => {
        savedClass = editing
          ? await updateClass({ id: editingClassId!, name: classForm.name.trim(), code: classForm.code.trim(), sortOrder: classForm.sortOrder, subjectIds: classForm.subjectIds }).unwrap()
          : await createClass({ name: classForm.name.trim(), code: classForm.code.trim(), sortOrder: classForm.sortOrder, subjectIds: classForm.subjectIds }).unwrap();
      },
    );
    if (saved) {
      cancelClassEdit();
      if (!editing && savedClass) {
        const createdClass = savedClass as ClassRecord;
        focusSectionForm(createdClass.id, createdClass.name);
      }
    }
  };

  const saveSection = async (event: FormEvent) => {
    event.preventDefault();
    const editing = editingSectionId !== null;
    const selectedClassId = sectionForm.classId;
    const saved = await mutate(
      'section-save',
      editing
        ? 'Section updated in the database.'
        : 'Section created. The class remains selected so you can add another section.',
      () => editing
        ? updateSection({ id: editingSectionId!, classId: Number(sectionForm.classId), name: sectionForm.name.trim() }).unwrap()
        : createSection({ classId: Number(sectionForm.classId), name: sectionForm.name.trim() }).unwrap(),
    );
    if (saved) {
      if (editing) {
        cancelSectionEdit();
      } else {
        setSectionForm({ classId: selectedClassId, name: '' });
        window.requestAnimationFrame(() => sectionNameRef.current?.focus());
      }
    }
  };

  const saveSubject = async (event: FormEvent) => {
    event.preventDefault();
    const editing = editingSubjectId !== null;
    const saved = await mutate(
      'subject-save',
      `Subject ${editing ? 'updated' : 'created'} in the database.`,
      () => editing
        ? updateSubject({ id: editingSubjectId!, name: subjectName.trim() }).unwrap()
        : createSubject({ name: subjectName.trim() }).unwrap(),
    );
    if (saved) cancelSubjectEdit();
  };

  const clearEditor = (kind: AcademicEntityKind) => {
    if (kind === 'year') cancelYearEdit();
    else if (kind === 'class') cancelClassEdit();
    else if (kind === 'section') cancelSectionEdit();
    else cancelSubjectEdit();
  };

  const remove = async (kind: AcademicEntityKind, id: number, label: string, path: string) => {
    if (!window.confirm(`Delete ${label}? This removes it from the database. Records that are already in use may be protected.`)) return;
    const removed = await mutate(
      `${kind}-delete-${id}`,
      `${label} was deleted from the database.`,
      () => {
        if (kind === 'year') return deleteYear(id).unwrap();
        if (kind === 'class') return deleteClass({ id }).unwrap();
        if (kind === 'section') return deleteSection(id).unwrap();
        return deleteSubject(id).unwrap();
      },
      (mutationError) => deleteError(mutationError, kind, id, label, path),
    );
    if (removed) clearEditor(kind);
  };

  const confirmCascadeDelete = async (option: CascadeDeleteOption) => {
    const confirmed = window.confirm(
      `${option.summary}\n\nThis action cannot be undone. Students, teachers, subjects, and exams will never be deleted by this action. Continue?`,
    );
    if (!confirmed) return;

    const removed = await mutate(
      `${option.kind}-delete-${option.id}`,
      `${option.label} and its empty sections were deleted. Teacher and subject records were kept.`,
      () => deleteClass({ id: option.id, cascade: 'sections' }).unwrap(),
      (mutationError) => deleteError(mutationError, option.kind, option.id, option.label, option.path),
    );
    if (removed) clearEditor(option.kind);
  };

  const toggleClassSubject = (subjectId: number) => {
    setClassForm((current) => ({
      ...current,
      subjectIds: current.subjectIds.includes(subjectId)
        ? current.subjectIds.filter((id) => id !== subjectId)
        : [...current.subjectIds, subjectId],
    }));
  };

  if (isLoading && !academicYears.length && !classes.length && !sections.length && !subjects.length) {
    return (
      <div className={`flex min-h-52 items-center justify-center rounded-xl border border-slate-200 bg-white ${className}`}>
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-indigo-600" />
        <span className="text-sm font-semibold text-slate-600">Loading academic setup from the database…</span>
      </div>
    );
  }

  return (
    <section className={`space-y-6 ${className}`} aria-label="Academic setup manager">
      <header className="portal-header-card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-md shadow-indigo-100 shrink-0">
            <GraduationCap className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="portal-pill-badge indigo">School Admin</span>
              <span className="text-[11px] font-bold text-slate-400">Curriculum & Structure</span>
            </div>
            <h2 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">Academic Setup</h2>
            <p className="mt-0.5 text-xs text-slate-500 font-medium">
              School Admin controls every academic year, class, section, subject, and class-subject assignment saved in PostgreSQL.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={isLoading || Boolean(busyAction)}
          className="portal-btn-secondary inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 self-start sm:self-center"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </header>

      <nav aria-label="Academic setup steps" className="portal-card p-5">
        <div className="mb-3">
          <p className="text-sm font-extrabold text-slate-900">Set up academics in this sequential order</p>
          <p className="mt-0.5 text-xs text-slate-600">Follow steps 1 through 5 in order. The configured database records will automatically sync across student, teacher, exam, fee, and timetable screens.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <WorkflowStep
            step={1}
            title="Academic Year & Batch"
            detail={academicYears.length ? `${academicYears[0]?.name || 'Batch configured'} ${academicYears[0]?.is_active ? '• Active' : ''}` : 'Configure active batch'}
            onClick={() => document.getElementById('academic-years')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          />
          <WorkflowStep
            step={2}
            title="Create subjects"
            detail={`${subjects.length} ${subjects.length === 1 ? 'subject' : 'subjects'} created`}
            onClick={() => document.getElementById('academic-subjects')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          />
          <WorkflowStep
            step={3}
            title="Create classes"
            detail={`Assign subjects • ${classes.length} created`}
            onClick={() => document.getElementById('academic-classes')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          />
          <WorkflowStep
            step={4}
            title="Add sections"
            detail={`Select class • ${sections.length} created`}
            onClick={() => document.getElementById('academic-sections')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          />
          <WorkflowStep
            step={5}
            title="Assign teachers"
            detail="Open Teacher Profiles"
            onClick={() => {
              if (onOpenTeachers) onOpenTeachers();
              else document.getElementById('academic-teachers')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          />
        </div>
      </nav>

      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold">{error.title}</p>
            <p className="mt-1 break-words text-xs font-medium leading-5">{error.message}</p>
            {Boolean(error.references?.length) && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Linked records preventing deletion">
                {error.references?.map((reference) => (
                  <div key={reference.code} className="rounded-lg border border-rose-200 bg-white p-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-extrabold text-slate-900">{reference.label}</span>
                      {reference.count > 0 && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-extrabold text-slate-600">{reference.count}</span>}
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-extrabold uppercase ${
                        reference.deletionPolicy === 'blocked'
                          ? 'bg-rose-100 text-rose-700'
                          : reference.deletionPolicy === 'cascade'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-sky-100 text-sky-700'
                      }`}>
                        {reference.deletionPolicy === 'blocked' ? 'Action required' : reference.deletionPolicy === 'cascade' ? 'Deleted with class' : 'Assignment removed'}
                      </span>
                    </div>
                    {reference.message && <p className="mt-1 text-[11px] font-medium leading-4 text-slate-600">{reference.message}</p>}
                    {reference.examples.length > 0 && (
                      <p className="mt-1.5 text-[10px] font-semibold text-slate-500">Examples: {reference.examples.join(', ')}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {Boolean(error.actions?.length) && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-white/80 p-3">
                <p className="text-[10px] font-extrabold uppercase tracking-wide text-rose-700">What to do next</p>
                <ul className="mt-1.5 space-y-1 text-xs font-semibold leading-5">
                  {error.actions?.map((action) => <li key={action}>• {action}</li>)}
                </ul>
              </div>
            )}
            {error.cascade && (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
                <p className="text-xs font-bold leading-5">{error.cascade.summary}</p>
                <button
                  type="button"
                  onClick={() => void confirmCascadeDelete(error.cascade!)}
                  disabled={Boolean(busyAction)}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-xs font-extrabold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busyAction === `${error.cascade.kind}-delete-${error.cascade.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Confirm: delete class and empty sections
                </button>
              </div>
            )}
          </div>
          <button type="button" onClick={() => setError(null)} className="shrink-0 rounded-md p-1 hover:bg-rose-100" aria-label="Dismiss error"><X className="h-4 w-4" /></button>
        </div>
      )}
      {success && (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{success}</span>
          <button type="button" onClick={() => setSuccess('')} className="ml-auto" aria-label="Dismiss confirmation"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="space-y-6">
        {/* Step 1: Academic Year & Batch */}
        <article id="academic-years" className="scroll-mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50/70 p-4">
            <h3 className="flex items-center gap-2 text-sm font-extrabold text-slate-900">
              <StepBadge number={1} />
              <CalendarDays className="h-4 w-4 text-indigo-600" />
              Academic Year & Batch
            </h3>
            <p className="mt-1 text-[11px] text-slate-500">
              Configure the active school term and batch dates shown across academic selectors, student history, and reports.
            </p>
          </div>
          {(academicYears.length === 0 || editingYearId !== null) ? (
            <form onSubmit={saveYear} className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-3">
              <label className={`${labelClass} sm:col-span-3`}>
                Academic year / Batch name
                <input
                  required
                  maxLength={20}
                  value={yearForm.name}
                  onChange={(event) => setYearForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="e.g. Batch-2026 or 2026-2027"
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                Starts on
                <input
                  required
                  type="date"
                  value={yearForm.startsOn}
                  onChange={(event) => setYearForm((current) => ({ ...current, startsOn: event.target.value }))}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                Ends on
                <input
                  required
                  type="date"
                  value={yearForm.endsOn}
                  onChange={(event) => setYearForm((current) => ({ ...current, endsOn: event.target.value }))}
                  className={inputClass}
                />
              </label>
              <div className="flex items-center sm:pt-4">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={yearForm.isActive}
                    onChange={(event) => setYearForm((current) => ({ ...current, isActive: event.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  Set as active academic year
                </label>
              </div>
              <FormActions
                entityLabel="academic year"
                editing={editingYearId !== null}
                busy={busyAction === 'year-save'}
                onCancel={cancelYearEdit}
              />
            </form>
          ) : (
            <div className="border-b border-slate-100 bg-slate-50/60 p-4 text-xs text-slate-600 flex items-center justify-between">
              <span>Each school has one active batch/academic year. Click the edit button below to change the batch name or dates as the year changes.</span>
            </div>
          )}
          <div className="divide-y divide-slate-100">
            {academicYears.length ? academicYears.map((year) => (
              <div key={year.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
                    {year.name}
                    {year.is_active && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-extrabold uppercase text-emerald-700 border border-emerald-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                        Active
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    <span className="font-semibold text-slate-600">Term Duration:</span> {year.startsOn} to {year.endsOn}
                  </p>
                </div>
                <RowActions
                  label={year.name}
                  disabled={Boolean(busyAction)}
                  deleting={busyAction === `year-delete-${year.id}`}
                  onEdit={() => {
                    setEditingYearId(year.id);
                    setYearForm({ name: year.name, startsOn: year.startsOn, endsOn: year.endsOn, isActive: year.is_active });
                  }}
                  onDelete={() => void remove('year', year.id, `academic year ${year.name}`, `/academic-years/${year.id}/`)}
                />
              </div>
            )) : <EmptyRow text="No academic years have been created." />}
          </div>
        </article>

        {/* Step 2: Create Subjects */}
        <article id="academic-subjects" className="scroll-mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50/70 p-4">
            <h3 className="flex items-center gap-2 text-sm font-extrabold text-slate-900">
              <StepBadge number={2} />
              <BookOpen className="h-4 w-4 text-indigo-600" />
              Create Subjects
            </h3>
            <p className="mt-1 text-[11px] text-slate-500">
              Create subjects before assigning them to classes or teachers in subsequent steps.
            </p>
          </div>
          <form onSubmit={saveSubject} className="border-b border-slate-100 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={`${labelClass} sm:col-span-2`}>
                Subject name
                <input
                  required
                  maxLength={120}
                  value={subjectName}
                  onChange={(event) => setSubjectName(event.target.value)}
                  placeholder="Enter subject name (e.g. Mathematics, English, Science, Computer)"
                  className={inputClass}
                />
              </label>
              <div className="flex items-end">
                <FormActions
                  entityLabel="subject"
                  editing={editingSubjectId !== null}
                  busy={busyAction === 'subject-save'}
                  onCancel={cancelSubjectEdit}
                />
              </div>
            </div>
          </form>
          <div className="p-4">
            {sortedSubjects.length ? (
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {sortedSubjects.map((subject) => {
                  const assignedCount = classes.filter((classroom) => classSubjectIds(classroom).includes(subject.id)).length;
                  return (
                    <div
                      key={subject.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 transition hover:border-indigo-200 hover:bg-indigo-50/30"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold text-slate-900">{subject.name}</p>
                        <p className="mt-0.5 text-[10px] font-semibold text-slate-500">
                          Assigned to {assignedCount} {assignedCount === 1 ? 'class' : 'classes'}
                        </p>
                      </div>
                      <RowActions
                        compact
                        label={subject.name}
                        disabled={Boolean(busyAction)}
                        deleting={busyAction === `subject-delete-${subject.id}`}
                        onEdit={() => { setEditingSubjectId(subject.id); setSubjectName(subject.name); }}
                        onDelete={() => void remove('subject', subject.id, `subject ${subject.name}`, `/subjects/${subject.id}/`)}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyRow text="No subjects have been created yet. Enter a subject name above to create your first subject." />
            )}
          </div>
        </article>

        {/* Step 3: Create Classes and Choose Their Subjects */}
        <article id="academic-classes" className="scroll-mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50/70 p-4">
            <h3 className="flex items-center gap-2 text-sm font-extrabold text-slate-900">
              <StepBadge number={3} />
              <Layers3 className="h-4 w-4 text-indigo-600" />
              Create Classes and Choose Their Subjects
            </h3>
            <p className="mt-1 text-[11px] text-slate-500">
              Create one class at a time. The class code is generated from its name; display order controls dropdown and promotion order.
            </p>
          </div>
          <form onSubmit={saveClass} className="grid gap-3 border-b border-slate-100 p-4 md:grid-cols-3">
            <label className={labelClass}>
              Class name
              <input
                required
                maxLength={80}
                value={classForm.name}
                onChange={(event) => {
                  const name = event.target.value;
                  setClassForm((current) => ({
                    ...current,
                    name,
                    code: editingClassId === null ? classCodeFromName(name) : current.code,
                  }));
                }}
                placeholder="Enter class name (e.g. Class 1, Grade 10)"
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              Unique class code
              <input
                required
                maxLength={80}
                value={classForm.code}
                onChange={(event) => setClassForm((current) => ({ ...current, code: event.target.value }))}
                placeholder="Enter unique code"
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              Display / promotion order
              <input
                required
                type="number"
                min={0}
                value={classForm.sortOrder}
                onChange={(event) => setClassForm((current) => ({ ...current, sortOrder: Number(event.target.value) || 0 }))}
                className={inputClass}
              />
            </label>
            <fieldset className="md:col-span-3">
              <legend className={labelClass}>
                Subjects taught in this class
                {classForm.subjectIds.length > 0 && (
                  <span className="ml-2 font-bold text-indigo-600 lowercase">
                    ({classForm.subjectIds.length} selected)
                  </span>
                )}
              </legend>
              {sortedSubjects.length ? (
                <div className="mt-2 grid max-h-44 gap-2 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {sortedSubjects.map((subject) => (
                    <label key={subject.id} className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-indigo-50">
                      <input
                        type="checkbox"
                        checked={classForm.subjectIds.includes(subject.id)}
                        onChange={() => toggleClassSubject(subject.id)}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="truncate">{subject.name}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                  Create subjects in Step 2 first, then assign them here.
                </p>
              )}
            </fieldset>
            <FormActions
              entityLabel="class"
              editing={editingClassId !== null}
              busy={busyAction === 'class-save'}
              onCancel={cancelClassEdit}
            />
          </form>
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {sortedClasses.length ? sortedClasses.map((classroom) => {
              const assignedSubjectIds = classSubjectIds(classroom);
              const assignedSubjects = sortedSubjects.filter((subject) => assignedSubjectIds.includes(subject.id));
              const classSections = sectionsByClass.get(classroom.id) || [];
              return (
                <div key={classroom.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-extrabold text-slate-900">{classroom.name}</p>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Order {classroom.sortOrder} | Code: {classroom.code}</p>
                    </div>
                    <RowActions
                      compact
                      label={classroom.name}
                      disabled={Boolean(busyAction)}
                      deleting={busyAction === `class-delete-${classroom.id}`}
                      onEdit={() => {
                        setEditingClassId(classroom.id);
                        setClassForm({ name: classroom.name, code: classroom.code, sortOrder: classroom.sortOrder, subjectIds: assignedSubjectIds });
                      }}
                      onDelete={() => void remove('class', classroom.id, `class ${classroom.name}`, `/classes/${classroom.id}/`)}
                    />
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-2">
                    <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
                      Sections <span className="text-slate-400">({classSections.length})</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => focusSectionForm(classroom.id, classroom.name)}
                      disabled={Boolean(busyAction)}
                      className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-extrabold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                    >
                      <Plus className="h-3 w-3" /> Add section
                    </button>
                  </div>
                  <div className="mt-2 flex min-h-7 flex-wrap gap-1.5">
                    {classSections.length ? classSections.map((section) => (
                      <span key={section.id} className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-extrabold text-emerald-800">
                        {section.name}
                      </span>
                    )) : (
                      <button type="button" onClick={() => focusSectionForm(classroom.id, classroom.name)} className="text-left text-xs font-semibold text-amber-700 hover:underline">
                        No sections yet — click to add
                      </button>
                    )}
                  </div>
                  <p className="mt-3 text-[10px] font-extrabold uppercase tracking-wide text-slate-500">Subjects ({assignedSubjects.length})</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {assignedSubjects.length ? assignedSubjects.map((subject) => (
                      <span key={subject.id} className="rounded-full border border-indigo-100 bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-700">
                        {subject.name}
                      </span>
                    )) : (
                      <span className="text-xs italic text-slate-400">No subjects assigned</span>
                    )}
                  </div>
                </div>
              );
            }) : <div className="md:col-span-2 xl:col-span-3"><EmptyRow text="No classes have been created yet." /></div>}
          </div>
        </article>

        {/* Step 4: Add Sections to Each Class */}
        <article id="academic-sections" className="scroll-mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50/70 p-4">
            <h3 className="flex items-center gap-2 text-sm font-extrabold text-slate-900">
              <StepBadge number={4} />
              <GraduationCap className="h-4 w-4 text-indigo-600" />
              Add Sections to Each Class
            </h3>
            <p className="mt-1 text-[11px] text-slate-500">
              Select a class, enter one section name, and create it. The class stays selected so you can quickly add the next section.
            </p>
          </div>
          <form ref={sectionFormRef} onSubmit={saveSection} className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2">
            <label className={labelClass}>
              Class
              <select required value={sectionForm.classId} onChange={(event) => setSectionForm((current) => ({ ...current, classId: event.target.value }))} className={inputClass}>
                <option value="">Select a class</option>
                {sortedClasses.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name}</option>)}
              </select>
            </label>
            <label className={labelClass}>
              Section name
              <input ref={sectionNameRef} required maxLength={20} value={sectionForm.name} onChange={(event) => setSectionForm((current) => ({ ...current, name: event.target.value }))} placeholder="Example: A, B, Rose" className={inputClass} />
            </label>
            <FormActions entityLabel="section" editing={editingSectionId !== null} busy={busyAction === 'section-save'} disabled={!sortedClasses.length} onCancel={cancelSectionEdit} />
          </form>
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {sortedClasses.length ? sortedClasses.map((classroom) => {
              const classSections = sectionsByClass.get(classroom.id) || [];
              return (
                <div key={classroom.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                    <p className="text-sm font-extrabold text-slate-900">{classroom.name}</p>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                      {classSections.length} {classSections.length === 1 ? 'section' : 'sections'}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {classSections.length ? classSections.map((section) => (
                      <div key={section.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                        <span className="text-xs font-bold text-slate-800">Section {section.name}</span>
                        <RowActions
                          compact
                          label={`${classroom.name} ${section.name}`}
                          disabled={Boolean(busyAction)}
                          deleting={busyAction === `section-delete-${section.id}`}
                          onEdit={() => {
                            setEditingSectionId(section.id);
                            setSectionForm({ classId: String(section.classId), name: section.name });
                          }}
                          onDelete={() => void remove('section', section.id, `section ${classroom.name} ${section.name}`, `/sections/${section.id}/`)}
                        />
                      </div>
                    )) : (
                      <button
                        type="button"
                        onClick={() => focusSectionForm(classroom.id, classroom.name)}
                        className="w-full rounded-lg border border-dashed border-indigo-200 bg-indigo-50/60 px-3 py-2 text-left text-xs font-bold text-indigo-700 hover:bg-indigo-50"
                      >
                        <Plus className="mr-1 inline h-3.5 w-3.5" /> Add the first section to {classroom.name}
                      </button>
                    )}
                  </div>
                </div>
              );
            }) : <div className="md:col-span-2 xl:col-span-3"><EmptyRow text="Create a class before creating sections." /></div>}
          </div>
        </article>

        {/* Step 5: Assign Existing Teachers */}
        <article id="academic-teachers" className="scroll-mt-4 rounded-xl border border-indigo-200 bg-indigo-50/60 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <StepBadge number={5} />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-extrabold text-slate-900">Assign Existing Teachers</h3>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                After academic years, subjects, classes, and sections are ready, open <strong>Teacher Profiles</strong> from the left menu and edit each teacher. Select every subject and section that teacher handles; one teacher can have multiple assignments.
              </p>
              <p className="mt-2 text-xs font-bold text-indigo-700">Timetable teacher choices, class attendance, and subject marks appear only after those teacher assignments are saved.</p>
              {onOpenTeachers && (
                <button
                  type="button"
                  onClick={onOpenTeachers}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-xs font-extrabold text-white shadow-sm transition hover:bg-indigo-700"
                >
                  Open Teacher Profiles
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

function WorkflowStep({ step, title, detail, onClick }: { step: number; title: string; detail: string; onClick?: () => void }) {
  const content = (
    <>
      <StepBadge number={step} />
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-xs font-extrabold text-slate-900">{title}</span>
        <span className="mt-0.5 block truncate text-[10px] font-semibold text-slate-500">{detail}</span>
      </span>
      {onClick && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-indigo-500" />}
    </>
  );

  return onClick ? (
    <button type="button" onClick={onClick} className="flex min-w-0 items-center gap-2 rounded-lg border border-indigo-100 bg-white p-3 transition hover:border-indigo-300 hover:shadow-sm">
      {content}
    </button>
  ) : (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-indigo-100 bg-white p-3">{content}</div>
  );
}

function StepBadge({ number }: { number: number }) {
  return <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-black text-white">{number}</span>;
}

function FormActions({ entityLabel, editing, busy, disabled = false, onCancel }: { entityLabel: string; editing: boolean; busy: boolean; disabled?: boolean; onCancel: () => void }) {
  return (
    <div className="mt-1 flex items-center justify-end gap-2 sm:col-span-2 md:col-span-2">
      {editing && (
        <button type="button" onClick={onCancel} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          <X className="h-3.5 w-3.5" /> Cancel
        </button>
      )}
      <button type="submit" disabled={busy || disabled} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : editing ? <Save className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        {busy ? 'Saving…' : editing ? 'Save changes' : `Create ${entityLabel}`}
      </button>
    </div>
  );
}

function RowActions({ label, deleting, disabled, compact = false, onEdit, onDelete }: {
  label: string;
  deleting: boolean;
  disabled: boolean;
  compact?: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const padding = compact ? 'p-1.5' : 'p-2';
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button type="button" onClick={onEdit} disabled={disabled} title={`Edit ${label}`} aria-label={`Edit ${label}`} className={`rounded-md border border-slate-200 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-40 ${padding}`}>
        <Edit3 className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={onDelete} disabled={disabled} title={`Delete ${label}`} aria-label={`Delete ${label}`} className={`rounded-md border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-40 ${padding}`}>
        {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="p-4 text-center text-xs text-slate-500">{text}</p>;
}
