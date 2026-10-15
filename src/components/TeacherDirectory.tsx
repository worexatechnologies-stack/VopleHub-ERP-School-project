import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  Copy,
  Download,
  Edit,
  FileText,
  KeyRound,
  Mail,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UploadCloud,
  UserRoundCheck,
  XCircle,
  Clock,
  AlertCircle,
  X,
  Check,
  Eye,
  ExternalLink,
  Building2,
  CreditCard,
  GraduationCap,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Award,
  FileSpreadsheet,
} from 'lucide-react';
import ExcelImportModal from './ExcelImportModal';
import { emitNotification } from '../services/notificationBus';
import { apiDownload } from '../services/api';
import AuthenticatedImage from './AuthenticatedImage';
import { formatBytes, optimizeImageForUpload } from '../services/imageOptimizer';
import { copyToClipboard } from '../utils/clipboard';
import {
  ACADEMIC_STRUCTURE_CHANGED_EVENT,
  AcademicClass,
  AcademicSection,
  AcademicSubject,
  loadAcademicStructure,
} from '../services/academicStructure';
import { announceTeacherAssignmentsChanged } from '../services/teacherAssignments';
import {
  useGetTeachersQuery,
  useCreateTeacherMutation,
  useUpdateTeacherMutation,
  useDeleteTeacherMutation,
  useAddTeachingAssignmentMutation,
  useUploadTeacherDocumentMutation,
  useVerifyTeacherDocumentMutation,
  useDeleteTeacherDocumentMutation,
} from '../store/api/teacherApi';
import { useResetCredentialsMutation } from '../store/api/authApi';

interface TeacherRecord {
  id: string;
  userId?: number;
  name: string;
  email: string;
  phone: string;
  salary?: string | number | null;
  subjects: string[];
  subjectIds: number[];
  assignedSections: string[];
  assignedSectionIds: number[];
  teachingAssignments: TeachingAssignment[];
  joiningDate: string;
  qualification: string;
  documents: TeacherDocument[];
  status: 'Active' | 'Inactive';
  username: string;
  photoUrl?: string;
  photoFile?: File;
}

interface TeachingAssignment {
  id?: number;
  sectionId: number;
  subjectId: number;
  classId?: number;
  className?: string;
  sectionName?: string;
  subjectName?: string;
}

interface TeacherDocument {
  id: number;
  name: string;
  category?: string;
  status: 'Uploaded' | 'Pending' | 'Verified' | 'Rejected';
  remarks?: string;
  fileType: string;
  fileName?: string;
  downloadUrl?: string;
  uploadedAt?: string;
  verifiedAt?: string;
  verifiedByName?: string;
}

type Paginated<T> = { results?: T[] } | T[];
type TeacherCreationResponse = TeacherRecord & {
  loginCredentials: { username: string; password: string; userId: number; mustChangePassword: boolean };
  photoUrl?: string;
};

const collection = <T,>(payload: Paginated<T>): T[] => Array.isArray(payload) ? payload : payload.results || [];

const STORAGE_KEY = 'erp_teachers';

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  return Array.from({ length: 14 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (!error || typeof error !== 'object') return fallback;

  const data = (error as { data?: unknown }).data;
  if (typeof data === 'string') return data;
  if (!data || typeof data !== 'object') return fallback;

  const messages = (value: unknown): string[] => {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(messages);
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.detail === 'string') return [record.detail];
      return Object.values(record).flatMap(messages);
    }
    return [];
  };

  const extracted = messages(data);
  return extracted.length ? extracted.join(' ') : fallback;
}

function loadTeachers(): TeacherRecord[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((teacher: any) => ({
      id: teacher.id || `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: teacher.name || 'Unnamed Teacher',
      email: teacher.email || '',
      phone: teacher.phone || '',
      subjects: Array.isArray(teacher.subjects) ? teacher.subjects : Array.isArray(teacher.assignedSubjects) ? teacher.assignedSubjects : [],
      subjectIds: Array.isArray(teacher.subjectIds) ? teacher.subjectIds.map(Number) : [],
      assignedSections: Array.isArray(teacher.assignedSections) ? teacher.assignedSections : [],
      assignedSectionIds: Array.isArray(teacher.assignedSectionIds) ? teacher.assignedSectionIds.map(Number) : [],
      teachingAssignments: Array.isArray(teacher.teachingAssignments) ? teacher.teachingAssignments.map((assignment: any) => ({
        ...assignment,
        sectionId: Number(assignment.sectionId),
        subjectId: Number(assignment.subjectId),
      })) : [],
      joiningDate: teacher.joiningDate || new Date().toISOString().slice(0, 10),
      qualification: teacher.qualification || '',
      salary: teacher.salary != null ? teacher.salary : '',
      documents: Array.isArray(teacher.documents) ? teacher.documents : [],
      status: teacher.status === 'Inactive' ? 'Inactive' : 'Active',
      username: teacher.username || teacher.email || '',
      photoUrl: teacher.photoUrl || '',
    }));
  } catch {
    return [];
  }
}

function loadLoginUsers(): any[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('sa_users') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function TeacherDirectory() {
  // Never flash a previous tenant's cached directory while the authenticated
  // school-scoped API is loading.
  const [teachers, setTeachers] = useState<TeacherRecord[]>(() => (
    localStorage.getItem('school_erp_api_token') ? [] : loadTeachers()
  ));
  const [loginUsers, setLoginUsers] = useState<any[]>(loadLoginUsers);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Inactive'>('All');
  const [isAdding, setIsAdding] = useState(false);
  const [isExcelImportOpen, setIsExcelImportOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<{ username: string; password: string; name: string } | null>(null);
  const [copiedCredentials, setCopiedCredentials] = useState(false);
  const [copiedTeacherId, setCopiedTeacherId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    salary: '',
    subjectIds: [] as number[],
    assignedSectionIds: [] as number[],
    teachingAssignments: [] as TeachingAssignment[],
    joiningDate: new Date().toISOString().slice(0, 10),
    qualification: '',
    status: 'Active' as 'Active' | 'Inactive',
  });
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string>('');
  const [photoSummary, setPhotoSummary] = useState('');
  const [documentsTeacherId, setDocumentsTeacherId] = useState<string | null>(null);
  const [teacherDocumentName, setTeacherDocumentName] = useState('Qualification Certificate');
  const [teacherDocumentFile, setTeacherDocumentFile] = useState<File | null>(null);
  const [isDocumentUploading, setIsDocumentUploading] = useState(false);
  const [rejectingDocId, setRejectingDocId] = useState<number | null>(null);
  const [rejectRemarks, setRejectRemarks] = useState<string>('');
  const [isVerifyingDocId, setIsVerifyingDocId] = useState<number | null>(null);
  interface PreviewDocState {
    doc: TeacherDocument;
    url: string;
    isPdf: boolean;
    index: number;
    total: number;
    scale: number;
    rotation: number;
  }
  const [previewDoc, setPreviewDoc] = useState<PreviewDocState | null>(null);
  const [isDownloadingDocId, setIsDownloadingDocId] = useState<number | null>(null);
  const [isPreviewLoadingDocId, setIsPreviewLoadingDocId] = useState<number | null>(null);
  const [showPreviewRejectInput, setShowPreviewRejectInput] = useState(false);
  const [previewRejectRemarks, setPreviewRejectRemarks] = useState('');
  const [academicClasses, setAcademicClasses] = useState<AcademicClass[]>([]);
  const [academicSections, setAcademicSections] = useState<AcademicSection[]>([]);
  const [academicSubjects, setAcademicSubjects] = useState<AcademicSubject[]>([]);
  const [academicStructureError, setAcademicStructureError] = useState('');
  const [teacherListError, setTeacherListError] = useState('');
  const isServerBacked = Boolean(localStorage.getItem('school_erp_api_token'));
  const classOptions = academicClasses;
  const sectionOptions = academicSections;
  const sectionLabel = (section: AcademicSection) => {
    const classroom = classOptions.find((item) => item.id === section.classId);
    return `${classroom?.name || 'Class'}-${section.name}`;
  };
  const buildTeachingAssignments = (sectionIds: number[], subjectIds: number[]): TeachingAssignment[] => {
    const uniqueAssignments = new Map<string, TeachingAssignment>();
    sectionIds.forEach((sectionId) => {
      const section = sectionOptions.find((item) => item.id === sectionId);
      const classroom = classOptions.find((item) => item.id === section?.classId);
      if (!classroom) return;
      subjectIds
        .filter((subjectId) => (classroom.subjectIds || []).includes(subjectId))
        .forEach((subjectId) => uniqueAssignments.set(`${sectionId}:${subjectId}`, { sectionId, subjectId }));
    });
    return Array.from(uniqueAssignments.values());
  };

  const updateAssignedSections = (sectionIds: number[]) => {
    const assignedSectionIds = Array.from(new Set(sectionIds));
    setForm((current) => ({
      ...current,
      assignedSectionIds,
      teachingAssignments: buildTeachingAssignments(assignedSectionIds, current.subjectIds),
    }));
  };

  const updateSubjectIds = (subjectIds: number[]) => {
    const uniqueSubjectIds = Array.from(new Set(subjectIds));
    setForm((current) => ({
      ...current,
      subjectIds: uniqueSubjectIds,
      teachingAssignments: buildTeachingAssignments(current.assignedSectionIds, uniqueSubjectIds),
    }));
  };

  const availableTeacherSubjects = academicSubjects.filter((subject) =>
    form.assignedSectionIds.some((sectionId) => {
      const section = sectionOptions.find((s) => s.id === sectionId);
      if (!section) return false;
      const classroom = classOptions.find((c) => c.id === section.classId);
      return (classroom?.subjectIds || []).includes(subject.id);
    })
  );

  const { data: serverTeacherRows = [], error: teachersApiError, refetch: refetchTeachers } = useGetTeachersQuery(undefined, { skip: !isServerBacked });
  const [createTeacherMutation] = useCreateTeacherMutation();
  const [updateTeacherMutation] = useUpdateTeacherMutation();
  const [deleteTeacherMutation] = useDeleteTeacherMutation();
  const [addTeachingAssignmentMutation] = useAddTeachingAssignmentMutation();
  const [uploadTeacherDocMutation] = useUploadTeacherDocumentMutation();
  const [verifyTeacherDocMutation] = useVerifyTeacherDocumentMutation();
  const [deleteTeacherDocMutation] = useDeleteTeacherDocumentMutation();
  const [resetCredentialsMutation] = useResetCredentialsMutation();

  useEffect(() => {
    if (!isServerBacked || !serverTeacherRows.length) return;
    const serverTeachers: TeacherRecord[] = serverTeacherRows.map((teacher) => ({
      id: String(teacher.id),
      userId: teacher.userId,
      name: teacher.name,
      email: teacher.email,
      phone: teacher.phone,
      subjects: Array.isArray(teacher.subjects) ? teacher.subjects : [],
      subjectIds: Array.isArray(teacher.subjectIds) ? teacher.subjectIds.map(Number) : [],
      assignedSections: Array.isArray(teacher.assignedSections) ? teacher.assignedSections : [],
      assignedSectionIds: Array.isArray(teacher.assignedSectionIds) ? teacher.assignedSectionIds.map(Number) : [],
      teachingAssignments: (teacher.teachingAssignments || []).map((assignment) => ({
        ...assignment,
        sectionId: Number(assignment.sectionId),
        subjectId: Number(assignment.subjectId),
      })),
      joiningDate: teacher.joiningDate,
      qualification: teacher.qualification,
      salary: teacher.salary != null ? teacher.salary : '',
      documents: (teacher.documents || []).map((doc) => ({
        id: doc.id,
        name: doc.name,
        category: doc.category,
        status: (doc.status === 'Uploaded' || doc.status === 'Pending' || doc.status === 'Verified' || doc.status === 'Rejected' ? doc.status : 'Uploaded') as TeacherDocument['status'],
        remarks: doc.remarks,
        fileType: doc.fileType,
        fileName: doc.fileName,
        downloadUrl: doc.downloadUrl,
        uploadedAt: doc.uploadedAt,
        verifiedAt: doc.verifiedAt,
        verifiedByName: doc.verifiedByName,
      })),
      status: teacher.status,
      username: teacher.username || teacher.email,
      photoUrl: teacher.photoUrl || '',
    }));
    saveTeachers(serverTeachers);
    setTeacherListError('');
  }, [isServerBacked, serverTeacherRows]);

  useEffect(() => {
    if (teachersApiError) {
      setTeacherListError(
        teachersApiError instanceof Error ? teachersApiError.message : 'Could not load teacher profiles.',
      );
    }
  }, [teachersApiError]);

  useEffect(() => {
    if (!isServerBacked) return;
    const load = () => loadAcademicStructure()
      .then(({ classes, sections, subjects }) => {
        setAcademicClasses(classes);
        setAcademicSections(sections);
        setAcademicSubjects(subjects);
        setAcademicStructureError('');
      })
      .catch((error) => setAcademicStructureError(error instanceof Error ? error.message : 'Could not load classes and sections.'));
    void load();
    window.addEventListener(ACADEMIC_STRUCTURE_CHANGED_EVENT, load);
    return () => window.removeEventListener(ACADEMIC_STRUCTURE_CHANGED_EVENT, load);
  }, [isServerBacked]);

  const filtered = useMemo(() => teachers.filter((teacher) => {
    const query = search.toLowerCase();
    const subjects = Array.isArray(teacher.subjects) ? teacher.subjects : [];
    const assignedSections = Array.isArray(teacher.assignedSections) ? teacher.assignedSections : [];
    const matchesSearch = [teacher.name, teacher.email, teacher.phone, subjects.join(' '), assignedSections.join(' ')].join(' ').toLowerCase().includes(query);
    const matchesStatus = statusFilter === 'All' || teacher.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [teachers, search, statusFilter]);
  const documentsTeacher = teachers.find((teacher) => teacher.id === documentsTeacherId) || null;

  const saveTeachers = (next: TeacherRecord[]) => {
    setTeachers(next);
    if (!isServerBacked) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const saveLoginUsers = (next: any[]) => {
    setLoginUsers(next);
    localStorage.setItem('sa_users', JSON.stringify(next));
  };

  const getTeacherLogin = (teacher: TeacherRecord) => (
    loginUsers.find((user: any) => (
      String(user.email || '').toLowerCase() === teacher.email.toLowerCase() &&
      user.role === 'Teacher'
    ))
  );

  const copyTeacherCredentials = async (teacher: TeacherRecord) => {
    const success = await copyToClipboard(`Login ID: ${teacher.email}`);
    if (success) {
      setCopiedTeacherId(teacher.id);
      setTimeout(() => setCopiedTeacherId(null), 2500);
    }
  };

  const copyCreatedCredentials = async () => {
    if (!createdCredentials) return;
    const text = `Email: ${createdCredentials.username}\nPassword: ${createdCredentials.password}`;
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedCredentials(true);
      setTimeout(() => setCopiedCredentials(false), 2500);
    }
  };

  const resetForm = () => {
    setForm({
      name: '',
      email: '',
      password: '',
      phone: '',
      salary: '',
      subjectIds: [],
      assignedSectionIds: [],
      teachingAssignments: [],
      joiningDate: new Date().toISOString().slice(0, 10),
      qualification: '',
      status: 'Active',
    });
    setPhotoFile(null);
    setPhotoPreview('');
    setPhotoSummary('');
    setEditingId(null);
    setIsAdding(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const teachingAssignments = form.teachingAssignments.map(({ sectionId, subjectId }) => ({ sectionId, subjectId }));
    const selectedSubjects = academicSubjects.filter((subject) => form.subjectIds.includes(subject.id));
    const subjects = selectedSubjects.map((subject) => subject.name);
    const assignedSectionRecords = sectionOptions.filter((section) => form.assignedSectionIds.includes(section.id));
    const assignedSections = assignedSectionRecords.map(sectionLabel);
    const { password: _manualPassword, ...teacherProfileForm } = form;

    if (!teachingAssignments.length) {
      alert('Add at least one exact class-section and subject assignment for this teacher.');
      return;
    }
    const invalidAssignment = teachingAssignments.some((assignment) => {
      const section = sectionOptions.find((item) => item.id === assignment.sectionId);
      const classroom = classOptions.find((item) => item.id === section?.classId);
      return !section || !classroom || !(classroom.subjectIds || []).includes(assignment.subjectId);
    });
    if (invalidAssignment) {
      alert('A selected subject is no longer assigned to that class. Refresh Academic Setup and choose the exact assignment again.');
      return;
    }

    if (editingId) {
      const trimmedPhone = form.phone.trim();
      if (trimmedPhone) {
        const phoneExists = teachers.some(
          (teacher) => teacher.id !== editingId && teacher.phone && teacher.phone.trim().replace(/\s+/g, '') === trimmedPhone.replace(/\s+/g, '')
        );
        if (phoneExists) {
          alert('Phone number already exists.');
          return;
        }
      }
      if (form.password && form.password.length < 8) {
        alert('New permanent password must be at least 8 characters.');
        return;
      }
      if (isServerBacked) {
        try {
          const body = new FormData();
          body.append('phone', form.phone);
          if (form.salary !== '') body.append('salary', form.salary);
          body.append('subjectIds', JSON.stringify(form.subjectIds));
          body.append('assignedSectionIds', JSON.stringify(form.assignedSectionIds));
          body.append('teachingAssignments', JSON.stringify(teachingAssignments));
          body.append('joiningDate', form.joiningDate);
          body.append('qualification', form.qualification);
          body.append('status', form.status);
          if (photoFile) body.append('photo', photoFile);
          const saved = await updateTeacherMutation({ id: Number(editingId), body }).unwrap();
          const current = teachers.find((teacher) => teacher.id === editingId);
          const serverTeacher: TeacherRecord = {
            ...current,
            ...saved,
            id: String(saved.id),
            salary: saved.salary != null ? saved.salary : form.salary,
            assignedSectionIds: Array.isArray(saved.assignedSectionIds) ? saved.assignedSectionIds.map(Number) : form.assignedSectionIds,
            assignedSections: Array.isArray(saved.assignedSections) ? saved.assignedSections : assignedSections,
            subjectIds: Array.isArray(saved.subjectIds) ? saved.subjectIds.map(Number) : form.subjectIds,
            subjects: Array.isArray(saved.subjects) ? saved.subjects : subjects,
            teachingAssignments: Array.isArray(saved.teachingAssignments) ? saved.teachingAssignments.map((assignment) => ({
              ...assignment,
              sectionId: Number(assignment.sectionId),
              subjectId: Number(assignment.subjectId),
            })) : teachingAssignments,
            documents: Array.isArray(saved.documents) ? saved.documents.map((doc) => ({
              id: doc.id,
              name: doc.name,
              status: (doc.status === 'Uploaded' || doc.status === 'Pending' || doc.status === 'Verified' ? doc.status : 'Uploaded') as TeacherDocument['status'],
              fileType: doc.fileType,
              downloadUrl: doc.downloadUrl,
            })) : current?.documents || [],
            username: current?.username || saved.email || saved.username || '',
          };
          saveTeachers(teachers.map((teacher) => teacher.id === editingId ? serverTeacher : teacher));
          announceTeacherAssignmentsChanged();
          emitNotification({ title: 'Teacher updated', message: `${form.name}'s teacher profile was updated.`, tone: 'success', source: 'teachers' });
          resetForm();
        } catch (error) {
          alert(getApiErrorMessage(error, 'Teacher profile could not be updated.'));
        }
        return;
      }
      const updated = teachers.map((teacher) => teacher.id === editingId ? {
        ...teacher,
        ...teacherProfileForm,
        subjects,
        assignedSections,
        photoUrl: photoPreview || teacher.photoUrl,
        photoFile: photoFile || undefined,
      } : teacher);
      saveTeachers(updated);
      const users = loadLoginUsers();
      saveLoginUsers(users.map((user: any) => (
        String(user.email).toLowerCase() === form.email.toLowerCase()
          ? {
              ...user,
              name: form.name,
              password: form.password || user.password,
              status: form.status,
              locked: form.status === 'Inactive',
              forceReset: false,
          }
          : user
      )));
      emitNotification({ title: 'Teacher updated', message: `${form.name}'s teacher profile${form.password ? ' and permanent password' : ''} was updated.`, tone: 'success', source: 'teachers' });
      resetForm();
      return;
    }

    const trimmedEmail = form.email.trim();
    if (trimmedEmail) {
      const emailExists = teachers.some((teacher) => teacher.email && teacher.email.trim().toLowerCase() === trimmedEmail.toLowerCase());
      if (emailExists) {
        alert('Email already exists.');
        return;
      }
    }

    const trimmedPhone = form.phone.trim();
    if (trimmedPhone) {
      const phoneExists = teachers.some((teacher) => teacher.phone && teacher.phone.trim().replace(/\s+/g, '') === trimmedPhone.replace(/\s+/g, ''));
      if (phoneExists) {
        alert('Phone number already exists.');
        return;
      }
    }

    if (!isServerBacked && !editingId && (!form.password || form.password.length < 8)) {
      alert('Please enter a permanent password with at least 8 characters.');
      return;
    }

    const username = `teacher-${form.email.split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase() || Date.now()}`;
    const password = form.password;
    if (isServerBacked) {
      try {
        const body = new FormData();
        body.append('name', form.name);
        if (form.email) body.append('email', form.email);
        if (form.password) body.append('password', form.password);
        body.append('phone', form.phone);
        if (form.salary) body.append('salary', form.salary);
        body.append('subjectIds', JSON.stringify(form.subjectIds));
        body.append('assignedSectionIds', JSON.stringify(form.assignedSectionIds));
        body.append('teachingAssignments', JSON.stringify(teachingAssignments));
        body.append('joiningDate', form.joiningDate);
        if (form.qualification) body.append('qualification', form.qualification);
        body.append('status', form.status);
        if (photoFile) body.append('photo', photoFile);
        const created = await createTeacherMutation(body).unwrap();
        const credentials = created.loginCredentials;
        const serverTeacher: TeacherRecord = {
          ...created,
          id: String(created.id),
          salary: created.salary != null ? created.salary : form.salary,
          userId: credentials?.userId,
          username: credentials?.username || created.email,
          subjectIds: Array.isArray(created.subjectIds) ? created.subjectIds.map(Number) : form.subjectIds,
          assignedSectionIds: Array.isArray(created.assignedSectionIds) ? created.assignedSectionIds.map(Number) : form.assignedSectionIds,
          subjects: Array.isArray(created.subjects) ? created.subjects : subjects,
          assignedSections: Array.isArray(created.assignedSections) ? created.assignedSections : assignedSections,
          documents: Array.isArray(created.documents) ? created.documents.map((doc) => ({
            id: doc.id,
            name: doc.name,
            status: (doc.status === 'Uploaded' || doc.status === 'Pending' || doc.status === 'Verified' ? doc.status : 'Uploaded') as TeacherDocument['status'],
            fileType: doc.fileType,
            downloadUrl: doc.downloadUrl,
          })) : [],
          teachingAssignments: Array.isArray(created.teachingAssignments) ? created.teachingAssignments.map((assignment) => ({
            ...assignment,
            sectionId: Number(assignment.sectionId),
            subjectId: Number(assignment.subjectId),
          })) : teachingAssignments,
          photoUrl: created.photoUrl || photoPreview || undefined,
        };
        saveTeachers([serverTeacher, ...teachers.filter((teacher) => teacher.id !== serverTeacher.id)]);
        announceTeacherAssignmentsChanged();
        setCreatedCredentials({
          username: credentials?.username || created.email,
          password: credentials?.password || '',
          name: created.name,
        });
        emitNotification({ title: 'Teacher login created', message: `${created.name}'s verified login credentials are ready.`, tone: 'success', source: 'teachers' });
        resetForm();
        return;
      } catch (error) {
        alert(getApiErrorMessage(
          error,
          'Teacher account could not be saved to the server. Please check the API connection and try again.',
        ));
        return;
      }
    }
    const newTeacher: TeacherRecord = {
      id: `t-${Date.now()}`,
      ...teacherProfileForm,
      subjects,
      subjectIds: form.subjectIds,
      assignedSections,
      assignedSectionIds: form.assignedSectionIds,
      teachingAssignments,
      username,
      photoUrl: photoPreview || undefined,
      photoFile: photoFile || undefined,
      documents: [],
    };

    const users = loadLoginUsers();
    users.push({
      email: form.email,
      password,
      name: form.name,
      role: 'Teacher',
      schoolId: 'school-default',
      status: 'Active',
      locked: false,
      forceReset: false,
      permissions: ['view_students', 'mark_attendance', 'manage_lessons', 'submit_grades', 'chat_parents'],
    });
    saveLoginUsers(users);

    saveTeachers([newTeacher, ...teachers]);
    setCreatedCredentials({ username: form.email, password, name: form.name });
    emitNotification({ title: 'Teacher login created', message: `${form.name}'s teacher account was created and credentials are ready.`, tone: 'success', source: 'teachers' });
    resetForm();
  };

  const resetTeacherCredentials = async (teacher: TeacherRecord) => {
    if (!isServerBacked || !teacher.userId) {
      alert('This teacher does not have a server-linked account. Refresh the page and try again.');
      return;
    }
    try {
      const credentials = await resetCredentialsMutation(teacher.userId).unwrap();
      setCreatedCredentials({ username: credentials.loginId, password: credentials.temporaryPassword, name: teacher.name });
      emitNotification({ title: 'Teacher credentials reset', message: `A new temporary password was generated for ${teacher.name}.`, tone: 'success', source: 'teachers' });
    } catch (error) {
      alert(error instanceof Error ? `Could not reset teacher credentials: ${error.message}` : 'Could not reset teacher credentials.');
    }
  };

  const updateTeacherDocuments = (teacherId: string, documents: TeacherDocument[]) => {
    saveTeachers(teachers.map((teacher) => teacher.id === teacherId ? { ...teacher, documents } : teacher));
  };

  const uploadTeacherDocument = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!documentsTeacher || !teacherDocumentFile) return;
    if (!isServerBacked) {
      alert('Teacher document upload is available when connected to the server.');
      return;
    }
    setIsDocumentUploading(true);
    try {
      const body = new FormData();
      body.append('name', teacherDocumentName.trim() || teacherDocumentFile.name);
      body.append('category', teacherDocumentName.trim() || 'Identity Proof');
      body.append('file', teacherDocumentFile);
      const uploaded = await uploadTeacherDocMutation({ teacherId: Number(documentsTeacher.id), body }).unwrap();
      const normalizedDoc: TeacherDocument = {
        id: uploaded.id,
        name: uploaded.name,
        category: uploaded.category || teacherDocumentName,
        status: (uploaded.status === 'Uploaded' || uploaded.status === 'Pending' || uploaded.status === 'Verified' || uploaded.status === 'Rejected' ? uploaded.status : 'Uploaded') as TeacherDocument['status'],
        remarks: uploaded.remarks,
        fileType: uploaded.fileType,
        fileName: uploaded.fileName,
        downloadUrl: uploaded.downloadUrl,
        uploadedAt: uploaded.uploadedAt || new Date().toISOString(),
        verifiedAt: uploaded.verifiedAt,
        verifiedByName: uploaded.verifiedByName,
      };
      updateTeacherDocuments(documentsTeacher.id, [normalizedDoc, ...documentsTeacher.documents]);
      setTeacherDocumentFile(null);
      const input = document.getElementById('teacher-document-file') as HTMLInputElement | null;
      if (input) input.value = '';
      alert(`Document "${uploaded.name}" uploaded securely for ${documentsTeacher.name}.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Teacher document upload failed.');
    } finally {
      setIsDocumentUploading(false);
    }
  };

  const getDocCategoryIcon = (category: string = '', name: string = '') => {
    const text = `${category || ''} ${name || ''}`.toLowerCase();
    if (text.includes('aadhaar') || text.includes('adhar') || text.includes('identity') || text.includes('voter')) {
      return <ShieldCheck className="h-5 w-5 text-indigo-600" />;
    }
    if (text.includes('pan')) {
      return <CreditCard className="h-5 w-5 text-violet-600" />;
    }
    if (text.includes('passbook') || text.includes('cheque') || text.includes('bank') || text.includes('salary')) {
      return <Building2 className="h-5 w-5 text-emerald-600" />;
    }
    if (text.includes('degree') || text.includes('certificate') || text.includes('graduation') || text.includes('qualification') || text.includes('diploma') || text.includes('bed') || text.includes('med')) {
      return <GraduationCap className="h-5 w-5 text-blue-600" />;
    }
    return <FileText className="h-5 w-5 text-amber-600" />;
  };

  const getDocCategoryTheme = (category: string = '', name: string = '') => {
    const text = `${category || ''} ${name || ''}`.toLowerCase();
    if (text.includes('aadhaar') || text.includes('adhar') || text.includes('identity')) {
      return { bg: 'bg-indigo-50/80', border: 'border-indigo-100', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200/60' };
    }
    if (text.includes('pan')) {
      return { bg: 'bg-violet-50/80', border: 'border-violet-100', badge: 'bg-violet-50 text-violet-700 border-violet-200/60' };
    }
    if (text.includes('passbook') || text.includes('cheque') || text.includes('bank')) {
      return { bg: 'bg-emerald-50/80', border: 'border-emerald-100', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200/60' };
    }
    if (text.includes('degree') || text.includes('certificate') || text.includes('graduation')) {
      return { bg: 'bg-blue-50/80', border: 'border-blue-100', badge: 'bg-blue-50 text-blue-700 border-blue-200/60' };
    }
    return { bg: 'bg-amber-50/80', border: 'border-amber-100', badge: 'bg-amber-50 text-amber-700 border-amber-200/60' };
  };

  const viewTeacherDocument = async (teacherDocument: TeacherDocument, docList?: TeacherDocument[]) => {
    if (!teacherDocument.downloadUrl) {
      alert('This document does not have a valid view or download URL.');
      return;
    }
    const list = docList || (documentsTeacher ? documentsTeacher.documents : []);
    const currentIndex = list.findIndex((d) => d.id === teacherDocument.id);
    setIsPreviewLoadingDocId(teacherDocument.id);
    try {
      const { blob, filename, contentType } = await apiDownload(teacherDocument.downloadUrl);
      const isPdf = contentType.includes('pdf') || (teacherDocument.fileType || '').toUpperCase() === 'PDF' || (teacherDocument.fileName || '').toLowerCase().endsWith('.pdf');
      const url = URL.createObjectURL(blob);
      setPreviewDoc((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return {
          doc: {
            ...teacherDocument,
            fileName: filename || teacherDocument.fileName,
          },
          url,
          isPdf,
          index: currentIndex >= 0 ? currentIndex : 0,
          total: list.length || 1,
          scale: 1,
          rotation: 0,
        };
      });
      setShowPreviewRejectInput(false);
      setPreviewRejectRemarks('');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Teacher document could not be loaded for preview.');
    } finally {
      setIsPreviewLoadingDocId(null);
    }
  };

  const navigatePreview = (direction: 'next' | 'prev') => {
    if (!documentsTeacher || !previewDoc) return;
    const list = documentsTeacher.documents;
    if (list.length <= 1) return;
    const newIndex = direction === 'next'
      ? (previewDoc.index + 1) % list.length
      : (previewDoc.index - 1 + list.length) % list.length;
    const targetDoc = list[newIndex];
    if (targetDoc) {
      void viewTeacherDocument(targetDoc, list);
    }
  };

  const closeDocPreview = () => {
    if (previewDoc?.url) {
      URL.revokeObjectURL(previewDoc.url);
    }
    setPreviewDoc(null);
    setShowPreviewRejectInput(false);
    setPreviewRejectRemarks('');
  };

  const zoomIn = () => setPreviewDoc((p) => p ? { ...p, scale: Math.min(3, p.scale + 0.25) } : null);
  const zoomOut = () => setPreviewDoc((p) => p ? { ...p, scale: Math.max(0.5, p.scale - 0.25) } : null);
  const resetZoom = () => setPreviewDoc((p) => p ? { ...p, scale: 1, rotation: 0 } : null);
  const rotateDoc = () => setPreviewDoc((p) => p ? { ...p, rotation: (p.rotation + 90) % 360 } : null);

  const downloadTeacherDocument = async (teacherDocument: TeacherDocument) => {
    if (!teacherDocument.downloadUrl) {
      alert('This document does not have a download URL.');
      return;
    }
    setIsDownloadingDocId(teacherDocument.id);
    try {
      const { blob, filename } = await apiDownload(teacherDocument.downloadUrl);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename || teacherDocument.fileName || `${teacherDocument.name}.${teacherDocument.fileType.toLowerCase()}`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Teacher document download failed.');
    } finally {
      setIsDownloadingDocId(null);
    }
  };

  const deleteTeacherDocument = async (document: TeacherDocument) => {
    if (!documentsTeacher || !confirm(`Delete "${document.name}"?`)) return;
    try {
      await deleteTeacherDocMutation({ teacherId: Number(documentsTeacher.id), docId: document.id }).unwrap();
      updateTeacherDocuments(documentsTeacher.id, documentsTeacher.documents.filter((item) => item.id !== document.id));
      if (previewDoc && previewDoc.doc.id === document.id) {
        closeDocPreview();
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Teacher document deletion failed.');
    }
  };

  const verifyTeacherDocument = async (document: TeacherDocument) => {
    if (!documentsTeacher) return;
    setIsVerifyingDocId(document.id);
    try {
      if (isServerBacked) {
        await verifyTeacherDocMutation({
          teacherId: Number(documentsTeacher.id),
          docId: document.id,
          status: 'Verified',
          remarks: 'Verified & Approved by School Admin',
        }).unwrap();
      }
      const updatedDocs = documentsTeacher.documents.map((d) =>
        d.id === document.id
          ? {
              ...d,
              status: 'Verified' as const,
              remarks: 'Verified & Approved by School Admin',
              verifiedAt: new Date().toISOString(),
            }
          : d
      );
      updateTeacherDocuments(documentsTeacher.id, updatedDocs);
      if (previewDoc && previewDoc.doc.id === document.id) {
        setPreviewDoc((prev) => prev ? {
          ...prev,
          doc: {
            ...prev.doc,
            status: 'Verified' as const,
            remarks: 'Verified & Approved by School Admin',
            verifiedAt: new Date().toISOString(),
          }
        } : null);
      }
      emitNotification({
        title: 'Document Verified',
        message: `Verified "${document.name}" for ${documentsTeacher.name}.`,
        tone: 'success',
        source: 'teachers',
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to verify document.');
    } finally {
      setIsVerifyingDocId(null);
    }
  };

  const rejectTeacherDocument = async (document: TeacherDocument, customRemarks?: string) => {
    if (!documentsTeacher) return;
    setIsVerifyingDocId(document.id);
    try {
      const remarks = (customRemarks !== undefined ? customRemarks : rejectRemarks).trim() || 'Document rejected. Please re-upload legible copy.';
      if (isServerBacked) {
        await verifyTeacherDocMutation({
          teacherId: Number(documentsTeacher.id),
          docId: document.id,
          status: 'Rejected',
          remarks,
        }).unwrap();
      }
      const updatedDocs = documentsTeacher.documents.map((d) =>
        d.id === document.id
          ? {
              ...d,
              status: 'Rejected' as const,
              remarks,
              verifiedAt: new Date().toISOString(),
            }
          : d
      );
      updateTeacherDocuments(documentsTeacher.id, updatedDocs);
      if (previewDoc && previewDoc.doc.id === document.id) {
        setPreviewDoc((prev) => prev ? {
          ...prev,
          doc: {
            ...prev.doc,
            status: 'Rejected' as const,
            remarks,
            verifiedAt: new Date().toISOString(),
          }
        } : null);
      }
      setRejectingDocId(null);
      setRejectRemarks('');
      setShowPreviewRejectInput(false);
      setPreviewRejectRemarks('');
      emitNotification({
        title: 'Document Rejected',
        message: `Rejected "${document.name}" for ${documentsTeacher.name}. Reason: ${remarks}`,
        tone: 'warning',
        source: 'teachers',
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to reject document.');
    } finally {
      setIsVerifyingDocId(null);
    }
  };

  const startEdit = (teacher: TeacherRecord) => {
    const legacySectionIds = teacher.assignedSectionIds?.length
      ? teacher.assignedSectionIds
      : sectionOptions.filter((section) => teacher.assignedSections.includes(sectionLabel(section))).map((section) => section.id);
    const legacySubjectIds = teacher.subjectIds?.length
      ? teacher.subjectIds
      : academicSubjects.filter((subject) => teacher.subjects.includes(subject.name)).map((subject) => subject.id);
    const teachingAssignments = teacher.teachingAssignments?.length
      ? teacher.teachingAssignments.map(({ sectionId, subjectId }) => ({ sectionId, subjectId }))
      : (legacySectionIds.length === 1 || legacySubjectIds.length === 1)
        ? legacySectionIds.flatMap((sectionId) => {
            const section = sectionOptions.find((item) => item.id === sectionId);
            const classroom = classOptions.find((item) => item.id === section?.classId);
            return legacySubjectIds
              .filter((subjectId) => (classroom?.subjectIds || []).includes(subjectId))
              .map((subjectId) => ({ sectionId, subjectId }));
          })
        : [];
    setEditingId(teacher.id);
    setIsAdding(true);
    setForm({
      name: teacher.name,
      email: teacher.email,
      password: '',
      phone: teacher.phone,
      salary: teacher.salary != null ? String(teacher.salary) : '',
      subjectIds: Array.from(new Set(teachingAssignments.map((assignment) => assignment.subjectId))),
      assignedSectionIds: Array.from(new Set(teachingAssignments.map((assignment) => assignment.sectionId))),
      teachingAssignments,
      joiningDate: teacher.joiningDate,
      qualification: teacher.qualification,
      status: teacher.status,
    });
    setPhotoFile(null);
    setPhotoPreview(teacher.photoUrl || '');
    setPhotoSummary('');

    const scrollToTop = () => {
      const pageEl = document.getElementById('teacher-profiles-page');
      if (pageEl) {
        pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      const mainEl = document.querySelector('main');
      if (mainEl) {
        mainEl.scrollTo({ top: 0, behavior: 'smooth' });
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    scrollToTop();
    setTimeout(scrollToTop, 50);
  };

  const toggleStatus = async (teacher: TeacherRecord) => {
    const nextStatus = teacher.status === 'Active' ? 'Inactive' : 'Active';
    if (isServerBacked) {
      try {
        const body = new FormData();
        body.append('status', nextStatus);
        const saved = await updateTeacherMutation({ id: Number(teacher.id), body }).unwrap();
        saveTeachers(teachers.map((item) => item.id === teacher.id ? {
          ...item,
          ...saved,
          id: String(saved.id),
          documents: Array.isArray(saved.documents) ? saved.documents.map((doc) => ({
            id: doc.id,
            name: doc.name,
            status: (doc.status === 'Uploaded' || doc.status === 'Pending' || doc.status === 'Verified' ? doc.status : 'Uploaded') as TeacherDocument['status'],
            fileType: doc.fileType,
            downloadUrl: doc.downloadUrl,
          })) : item.documents,
        } : item));
        announceTeacherAssignmentsChanged();
        emitNotification({ title: `Teacher ${nextStatus.toLowerCase()}`, message: `${teacher.name}'s login is now ${nextStatus.toLowerCase()}.`, tone: nextStatus === 'Active' ? 'success' : 'warning', source: 'teachers' });
      } catch (error) {
        alert(error instanceof Error ? error.message : 'Teacher status could not be updated.');
      }
      return;
    }
    saveTeachers(teachers.map((item) => item.id === teacher.id ? { ...item, status: nextStatus } : item));
    const users = loadLoginUsers();
    saveLoginUsers(users.map((user: any) => (
      String(user.email).toLowerCase() === teacher.email.toLowerCase()
        ? { ...user, status: nextStatus, locked: nextStatus === 'Inactive' }
        : user
    )));
    emitNotification({ title: `Teacher ${nextStatus.toLowerCase()}`, message: `${teacher.name}'s login is now ${nextStatus.toLowerCase()}.`, tone: nextStatus === 'Active' ? 'success' : 'warning', source: 'teachers' });
  };

  const deleteTeacher = async (teacher: TeacherRecord) => {
    if (!confirm(`Delete teacher profile for ${teacher.name}? This will also remove their login from this system.`)) return;

    if (isServerBacked) {
      try {
        await deleteTeacherMutation(Number(teacher.id)).unwrap();
      } catch (error) {
        alert(error instanceof Error ? error.message : 'Teacher profile could not be deleted from the server.');
        return;
      }
    }

    saveTeachers(teachers.filter((item) => item.id !== teacher.id));
    const users = loadLoginUsers();
    saveLoginUsers(users.filter((user: any) => (
      String(user.email).toLowerCase() !== teacher.email.toLowerCase()
    )));
    emitNotification({ title: 'Teacher deleted', message: `${teacher.name}'s profile and login were removed.`, tone: 'warning', source: 'teachers' });
  };

  return (
    <section className="space-y-5 animate-fade-in" id="teacher-profiles-page">
      <header className="portal-header-card flex flex-col lg:flex-row justify-between lg:items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-md shadow-indigo-100 shrink-0">
            <UserRoundCheck className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="portal-pill-badge indigo">School Admin</span>
              <span className="text-[11px] font-bold text-slate-400">Faculty Management</span>
            </div>
            <h1 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">Teacher Profiles</h1>
            <p className="text-xs text-slate-500 font-medium mt-0.5">Create teacher profiles with verified, server-generated login credentials.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 self-start lg:self-center">
          <button
            onClick={() => setIsExcelImportOpen(true)}
            className="portal-btn-secondary !text-xs !py-2 !px-3.5 flex items-center gap-2 !border-emerald-200 !bg-emerald-50/80 hover:!bg-emerald-100/90 !text-emerald-800 transition-all cursor-pointer"
            title="Import faculty from Excel (.xlsx, .xls) or Google Sheets"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span>Import via Excel / Sheet</span>
          </button>
          <button onClick={() => { resetForm(); setIsAdding(true); }} className="portal-btn-primary inline-flex items-center gap-2 cursor-pointer whitespace-nowrap">
            <Plus className="h-4 w-4" />
            <span>Create Teacher Profile</span>
          </button>
        </div>
      </header>

      {teacherListError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700">
          Teacher profiles could not be loaded from the school database: {teacherListError}
        </div>
      )}

      {createdCredentials && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="flex-1">
              <h2 className="text-sm font-extrabold">Teacher login credentials</h2>
              <p className="mt-1 text-xs">Share securely with {createdCredentials.name}. This temporary password is shown once and must be changed after sign-in.</p>
              <div className="mt-3 grid gap-2 rounded-xl bg-white p-3 text-xs font-mono sm:grid-cols-2">
                <span>Email: {createdCredentials.username}</span>
                <span>Password: {createdCredentials.password}</span>
              </div>
              <button
                type="button"
                onClick={copyCreatedCredentials}
                className={`mt-3 inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-white transition-all duration-150 cursor-pointer ${
                  copiedCredentials
                    ? 'bg-emerald-700 ring-2 ring-emerald-300 shadow-sm'
                    : 'bg-emerald-600 hover:bg-emerald-700 active:scale-95 shadow-sm'
                }`}
              >
                {copiedCredentials ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-200" />
                    Copied credentials!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Copy credentials
                  </>
                )}
              </button>
            </div>
            <button onClick={() => { setCreatedCredentials(null); setCopiedCredentials(false); }} className="text-xs font-bold text-emerald-700 hover:text-emerald-900 cursor-pointer">Dismiss</button>
          </div>
        </div>
      )}

      {isAdding && (
        <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-extrabold text-slate-900">{editingId ? 'Edit teacher profile' : 'Teacher profile & login creation'}</h2>
          {!editingId && (
            <p className="mt-1 text-xs text-slate-500">This creates the teacher profile and a secure Teacher login. The generated password is shown once after creation.</p>
          )}
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Profile Photo</label>
              <div className="flex items-center gap-3">
                {photoPreview ? <AuthenticatedImage src={photoPreview} alt="Teacher preview" className="h-12 w-12 rounded-full border border-slate-200 object-cover" /> : <span className="grid h-12 w-12 place-items-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-600">Photo</span>}
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => {
                  const file = event.target.files?.[0] || null;
                  if (!file) { setPhotoFile(null); setPhotoPreview(''); setPhotoSummary(''); return; }
                  try {
                    const optimized = await optimizeImageForUpload(file);
                    setPhotoFile(optimized.file);
                    setPhotoPreview(optimized.previewUrl);
                    setPhotoSummary(`${optimized.width}×${optimized.height} WebP · ${formatBytes(optimized.originalBytes)} → ${formatBytes(optimized.optimizedBytes)}`);
                  } catch (error) {
                    alert(error instanceof Error ? error.message : 'Photo optimization failed.');
                    event.target.value = '';
                  }
                }} className="block w-full text-xs text-slate-500 file:mr-2 file:rounded-md file:border-0 file:bg-indigo-50 file:px-2 file:py-1.5 file:text-xs file:font-bold file:text-indigo-700" />
              </div>
              <p className="mt-1 text-[10px] text-slate-500">JPEG, PNG, or WebP.</p>
            </div>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Teacher name" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            <input required type="email" disabled={!!editingId} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" className="rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-100" />
            <div className="flex gap-2">
              <input
                required={!editingId}
                type="text"
                minLength={8}
                disabled={Boolean(editingId && isServerBacked)}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={editingId && isServerBacked ? 'Use Reset credentials' : editingId ? 'New permanent password (optional)' : 'Permanent password'}
                className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-100"
              />
              <button
                type="button"
                onClick={() => setForm({ ...form, password: generatePassword() })}
                className="rounded-xl border border-slate-200 px-3 py-2 text-[10px] font-bold text-slate-600 hover:bg-slate-50"
                title="Generate strong password"
              >
                Generate
              </button>
            </div>
            <input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            <input type="number" min="0" step="any" value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} placeholder="Salary (e.g. 50000)" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            <div className="md:col-span-3">
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Assigned classes and sections *</label>
              <p className="mb-3 text-[10px] text-slate-500">Select any number of classes and sections. Selecting a class assigns all its current sections.</p>
              {academicStructureError && <p className="mb-3 rounded-lg bg-rose-50 p-2 text-xs font-semibold text-rose-700">{academicStructureError}</p>}
              {!classOptions.length ? (
                <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">No classes exist. Create classes and sections in Academic Setup first.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {classOptions.map((classroom) => {
                    const classSections = sectionOptions.filter((section) => section.classId === classroom.id);
                    const sectionIds = classSections.map((section) => section.id);
                    const allSelected = Boolean(sectionIds.length) && sectionIds.every((id) => form.assignedSectionIds.includes(id));
                    return (
                      <div key={classroom.id} className="rounded-xl border border-slate-200 p-3">
                        <label className="flex items-center gap-2 text-xs font-extrabold text-slate-800">
                          <input
                            type="checkbox"
                            disabled={!sectionIds.length}
                            checked={allSelected}
                            onChange={() => updateAssignedSections(
                              allSelected
                                ? form.assignedSectionIds.filter((id) => !sectionIds.includes(id))
                                : Array.from(new Set([...form.assignedSectionIds, ...sectionIds])),
                            )}
                          />
                          {classroom.name} <span className="font-normal text-slate-400">(all sections)</span>
                        </label>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {classSections.length ? classSections.map((section) => (
                            <label key={section.id} className="flex items-center gap-1 rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-slate-700">
                              <input
                                type="checkbox"
                                checked={form.assignedSectionIds.includes(section.id)}
                                onChange={(event) => updateAssignedSections(
                                  event.target.checked
                                    ? [...form.assignedSectionIds, section.id]
                                    : form.assignedSectionIds.filter((id) => id !== section.id),
                                )}
                              />
                              {section.name}
                            </label>
                          )) : <span className="text-[10px] text-slate-400">No sections</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="md:col-span-3">
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Assigned subjects *</label>
              <p className="mb-2 text-[10px] text-slate-500">Subjects are limited to those assigned to the selected classes in Academic Setup.</p>
              {availableTeacherSubjects.length ? (
                <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 p-3">
                  {availableTeacherSubjects.map((subject) => (
                    <label key={subject.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={form.subjectIds.includes(subject.id)}
                        onChange={(event) => updateSubjectIds(
                          event.target.checked
                            ? [...form.subjectIds, subject.id]
                            : form.subjectIds.filter((id) => id !== subject.id),
                        )}
                      />
                      {subject.name}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">Select at least one class section above. If no subjects appear, assign subjects to that class in Academic Setup.</p>
              )}
              {form.teachingAssignments.length > 0 && (
                <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">Teaching assignments to be created</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {form.teachingAssignments.map((assignment) => {
                      const section = sectionOptions.find((item) => item.id === assignment.sectionId);
                      const subject = academicSubjects.find((item) => item.id === assignment.subjectId);
                      return (
                        <span key={`${assignment.sectionId}-${assignment.subjectId}`} className="rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-indigo-800">
                          {section ? sectionLabel(section) : 'Section'} · {subject?.name || 'Subject'}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <input required type="date" value={form.joiningDate} onChange={(e) => setForm({ ...form, joiningDate: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            <input value={form.qualification} onChange={(e) => setForm({ ...form, qualification: e.target.value })} placeholder="Qualification" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as 'Active' | 'Inactive' })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={resetForm} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600">Cancel</button>
            <button type="submit" className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white">{editingId ? 'Save changes' : 'Create teacher login'}</button>
          </div>
        </form>
      )}

      <div className="portal-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search teacher, subject, section..." className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
            <option>All</option>
            <option>Active</option>
            <option>Inactive</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Teacher</th>
                <th className="px-4 py-3">Subjects</th>
                <th className="px-4 py-3">Assigned Sections</th>
                <th className="px-4 py-3">Login Details</th>
                <th className="px-4 py-3">Qualification</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">No teacher profiles created yet.</td></tr>
              ) : filtered.map((teacher) => (
                <tr key={teacher.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {teacher.photoUrl ? (
                        <AuthenticatedImage src={teacher.photoUrl} alt={teacher.name} className="h-10 w-10 rounded-full border border-slate-200 object-cover" />
                      ) : (
                        <div className="grid h-10 w-10 place-items-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-700 border border-indigo-100">
                          {teacher.name.slice(0, 1)}
                        </div>
                      )}
                      <div>
                        <p className="font-extrabold text-slate-900">{teacher.name}</p>
                        <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Mail className="h-3 w-3" /> {teacher.email}</p>
                        <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Phone className="h-3 w-3" /> {teacher.phone}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{(teacher.subjects || []).join(', ') || '-'}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{(teacher.assignedSections || []).join(', ') || '-'}</td>
                  <td className="px-4 py-3">
                    {(() => {
                      return (
                        <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-[11px] text-slate-700">
                          <p><span className="font-extrabold text-slate-900">Login ID:</span> {teacher.email}</p>
                          <p className="mt-1"><span className="font-extrabold text-slate-900">Password:</span> shown once only</p>
                          <button
                            type="button"
                            onClick={() => copyTeacherCredentials(teacher)}
                            className={`mt-2 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold text-white transition-all cursor-pointer ${
                              copiedTeacherId === teacher.id
                                ? 'bg-emerald-600 ring-1 ring-emerald-400'
                                : 'bg-indigo-600 hover:bg-indigo-700'
                            }`}
                          >
                            {copiedTeacherId === teacher.id ? (
                              <>
                                <Check className="h-3 w-3" />
                                Copied!
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" />
                                Copy
                              </>
                            )}
                          </button>
                          {isServerBacked && teacher.userId && (
                            <button onClick={() => resetTeacherCredentials(teacher)} className="ml-2 mt-2 inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2 py-1 text-[10px] font-bold text-indigo-700 hover:bg-indigo-100">
                              <KeyRound className="h-3 w-3" />
                              Reset credentials
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    <p>{teacher.qualification || '-'}</p>
                    {teacher.salary != null && teacher.salary !== '' && (
                      <p className="mt-1 font-semibold text-emerald-700">Salary: ₹{Number(teacher.salary).toLocaleString('en-IN')}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-extrabold ${teacher.status === 'Active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {teacher.status === 'Active' ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                      {teacher.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {(() => {
                      const hasPending = teacher.documents.some((d) => d.status === 'Pending' || d.status === 'Uploaded');
                      const allVerified = teacher.documents.length > 0 && teacher.documents.every((d) => d.status === 'Verified');
                      return (
                        <button
                          onClick={() => setDocumentsTeacherId(teacher.id)}
                          className={`relative mr-2 rounded-lg border p-2 transition-all ${
                            hasPending
                              ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                              : allVerified
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              : 'border-indigo-200 text-indigo-600 hover:bg-indigo-50'
                          }`}
                          title={`Documents (${teacher.documents.length})${hasPending ? ' • Pending Verification' : allVerified ? ' • All Verified' : ''}`}
                        >
                          <FileText className="h-4 w-4" />
                          {hasPending && (
                            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                            </span>
                          )}
                        </button>
                      );
                    })()}
                    <button onClick={() => startEdit(teacher)} className="mr-2 rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50" title="Edit teacher details"><Edit className="h-4 w-4" /></button>
                    <button onClick={() => toggleStatus(teacher)} className="mr-2 rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50" title="Toggle status"><UserRoundCheck className="h-4 w-4" /></button>
                    <button onClick={() => deleteTeacher(teacher)} className="rounded-lg border border-red-200 p-2 text-red-600 hover:bg-red-50" title="Delete teacher"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Teacher Documents Verification Modal */}
      {documentsTeacher && (() => {
        const totalDocs = documentsTeacher.documents.length;
        const verifiedDocs = documentsTeacher.documents.filter((d) => d.status === 'Verified').length;
        const pendingDocs = documentsTeacher.documents.filter((d) => d.status === 'Pending' || d.status === 'Uploaded').length;
        const rejectedDocs = documentsTeacher.documents.filter((d) => d.status === 'Rejected').length;
        const percentVerified = totalDocs > 0 ? Math.round((verifiedDocs / totalDocs) * 100) : 0;

        return createPortal(
          <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex min-h-full items-center justify-center p-3 sm:p-5 animate-fade-in" role="presentation">
            <div className="w-full max-w-3xl max-h-[85vh] my-auto flex flex-col rounded-3xl bg-white shadow-2xl overflow-hidden border border-slate-200/80">
              {/* Sleek Modal Header with Integrated Stats */}
              <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50/80 via-indigo-50/20 to-white px-6 pt-4 pb-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="relative shrink-0">
                      {documentsTeacher.photoUrl ? (
                        <AuthenticatedImage
                          src={documentsTeacher.photoUrl}
                          alt={documentsTeacher.name}
                          className="h-11 w-11 rounded-2xl object-cover border border-slate-200 shadow-2xs"
                        />
                      ) : (
                        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-700 font-extrabold text-white text-sm shadow-2xs">
                          {documentsTeacher.name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${documentsTeacher.status === 'Active' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-extrabold text-slate-900 truncate">{documentsTeacher.name}</h2>
                        <span className="shrink-0 rounded-md bg-indigo-50 border border-indigo-200/70 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                          Staff Documents
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-0.5">
                        {documentsTeacher.email}
                        {documentsTeacher.phone && <span> • {documentsTeacher.phone}</span>}
                        {documentsTeacher.salary ? <span className="font-semibold text-emerald-700"> • ₹{Number(documentsTeacher.salary).toLocaleString('en-IN')}/mo</span> : null}
                      </p>
                    </div>
                  </div>

                  {/* Header right: Stat pills & Close button */}
                  <div className="flex items-center gap-2.5 shrink-0">
                    <div className="hidden sm:flex items-center gap-2 rounded-xl border border-slate-200/90 bg-white px-3 py-1.5 text-xs font-semibold shadow-2xs">
                      <span className="text-slate-600 font-bold">{totalDocs} Total</span>
                      <span className="text-slate-200">|</span>
                      <span className={pendingDocs > 0 ? 'text-amber-600 font-bold' : 'text-slate-400'}>
                        {pendingDocs} Pending
                      </span>
                      <span className="text-slate-200">|</span>
                      <span className={verifiedDocs > 0 ? 'text-emerald-600 font-bold' : 'text-slate-400'}>
                        {verifiedDocs} Verified
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => { setDocumentsTeacherId(null); setRejectingDocId(null); }}
                      className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                      title="Close modal"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                {/* Slim Verification Progress Bar */}
                <div className="mt-3.5 flex items-center gap-3">
                  <div className="h-1.5 flex-1 rounded-full bg-slate-200/70 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        percentVerified === 100
                          ? 'bg-emerald-500'
                          : 'bg-indigo-600'
                      }`}
                      style={{ width: `${percentVerified}%` }}
                    />
                  </div>
                  <span className={`text-[11px] font-extrabold shrink-0 ${percentVerified === 100 ? 'text-emerald-700' : 'text-indigo-700'}`}>
                    {percentVerified}% Verified
                  </span>
                </div>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3.5 bg-slate-50/40">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                    Submitted Documents ({totalDocs})
                  </h3>
                  <span className="text-[11px] text-slate-400 font-medium">
                    Click "View" for preview & zoom studio
                  </span>
                </div>

                {documentsTeacher.documents.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center">
                    <FileText className="mx-auto h-10 w-10 text-slate-300" />
                    <p className="mt-2 text-xs font-bold text-slate-700">No documents submitted yet</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Teacher can submit Aadhaar card, Passbook, PAN etc. through their Staff Portal, or you can upload on their behalf below.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {documentsTeacher.documents.map((teacherDocument) => {
                      const isVerified = teacherDocument.status === 'Verified';
                      const isRejected = teacherDocument.status === 'Rejected';
                      const isRejectingThis = rejectingDocId === teacherDocument.id;
                      const theme = getDocCategoryTheme(teacherDocument.category, teacherDocument.name);

                      return (
                        <div
                          key={teacherDocument.id}
                          className={`rounded-2xl border transition-all duration-150 bg-white p-3.5 shadow-2xs hover:shadow-xs ${
                            isVerified
                              ? 'border-slate-200/90 hover:border-slate-300'
                              : isRejected
                              ? 'border-rose-200/90 bg-rose-50/15'
                              : 'border-amber-200/90 bg-amber-50/15'
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            {/* Left: Icon, Title, and Metadata */}
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${theme.bg} ${theme.border} border shadow-2xs`}>
                                {getDocCategoryIcon(teacherDocument.category, teacherDocument.name)}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h4 className="font-bold text-sm text-slate-900 leading-snug truncate">
                                    {teacherDocument.name}
                                  </h4>
                                  {teacherDocument.category && teacherDocument.category.toLowerCase().trim() !== teacherDocument.name.toLowerCase().trim() && (
                                    <span className="rounded-md bg-slate-100 text-slate-600 px-1.5 py-0.5 text-[10px] font-semibold">
                                      {teacherDocument.category}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5 font-normal">
                                  <span className="text-slate-600 font-medium truncate max-w-[180px] sm:max-w-[240px]">
                                    {teacherDocument.fileName || 'Uploaded file'}
                                  </span>
                                  <span>•</span>
                                  <span className="uppercase font-semibold text-[10px] text-slate-400">{teacherDocument.fileType}</span>
                                  {teacherDocument.uploadedAt && (
                                    <>
                                      <span>•</span>
                                      <span>{new Date(teacherDocument.uploadedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                    </>
                                  )}
                                  {isVerified && (
                                    <>
                                      <span>•</span>
                                      <span className="text-emerald-700 font-semibold inline-flex items-center gap-0.5">
                                        <Check className="h-3 w-3 inline text-emerald-600" /> Verified
                                        {teacherDocument.verifiedAt ? ` on ${new Date(teacherDocument.verifiedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
                                      </span>
                                    </>
                                  )}
                                </p>
                              </div>
                            </div>

                            {/* Right: Status Pill & Action Group */}
                            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                              {/* Status Badge */}
                              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                                isVerified
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/90'
                                  : isRejected
                                  ? 'bg-rose-50 text-rose-700 border border-rose-200/90'
                                  : 'bg-amber-50 text-amber-700 border border-amber-200/90'
                              }`}>
                                {isVerified ? (
                                  <><CheckCircle2 className="h-3 w-3 text-emerald-600" /> Verified</>
                                ) : isRejected ? (
                                  <><AlertCircle className="h-3 w-3 text-rose-600" /> Rejected</>
                                ) : (
                                  <><Clock className="h-3 w-3 text-amber-600" /> Pending</>
                                )}
                              </span>

                              {/* Action Buttons Toolbar */}
                              <div className="flex items-center gap-1 border-l border-slate-200 pl-2">
                                <button
                                  type="button"
                                  onClick={() => void viewTeacherDocument(teacherDocument, documentsTeacher.documents)}
                                  disabled={isPreviewLoadingDocId === teacherDocument.id}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 text-xs font-bold transition-all shadow-2xs disabled:opacity-50"
                                  title="View full preview"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  {isPreviewLoadingDocId === teacherDocument.id ? 'Loading...' : 'View'}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => void downloadTeacherDocument(teacherDocument)}
                                  disabled={isDownloadingDocId === teacherDocument.id}
                                  className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-2xs"
                                  title="Download file"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                </button>

                                {!isVerified && (
                                  <button
                                    type="button"
                                    onClick={() => verifyTeacherDocument(teacherDocument)}
                                    disabled={isVerifyingDocId === teacherDocument.id}
                                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 text-xs font-bold transition-all shadow-2xs disabled:opacity-50"
                                    title="Verify and approve document"
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                    Verify
                                  </button>
                                )}

                                {!isRejected && (
                                  <button
                                    type="button"
                                    onClick={() => { setRejectingDocId(teacherDocument.id); setRejectRemarks(''); }}
                                    disabled={isVerifyingDocId === teacherDocument.id}
                                    className="rounded-lg border border-rose-200 bg-rose-50/70 p-1.5 text-rose-600 hover:bg-rose-100 transition-colors shadow-2xs"
                                    title="Reject document with feedback"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => void deleteTeacherDocument(teacherDocument)}
                                  className="rounded-lg border border-transparent p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                  title="Delete document"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Rejection Remarks display */}
                          {isRejected && teacherDocument.remarks && !isRejectingThis && (
                            <div className="mt-2.5 rounded-xl bg-rose-50 border border-rose-200/80 px-3 py-2 text-xs text-rose-900 flex items-start gap-2">
                              <AlertCircle className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" />
                              <div>
                                <span className="font-bold text-rose-800">Rejection Reason: </span>
                                <span className="text-rose-700">{teacherDocument.remarks}</span>
                              </div>
                            </div>
                          )}

                          {/* Inline Rejection Form */}
                          {isRejectingThis && (
                            <div className="mt-2.5 rounded-xl border border-rose-200 bg-rose-50/70 p-3 animate-in fade-in">
                              <label className="block text-xs font-bold text-rose-900 mb-1">
                                Rejection feedback (visible to teacher):
                              </label>

                              <div className="flex flex-wrap gap-1.5 mb-2">
                                {[
                                  'Scan is blurry / illegible',
                                  'Incorrect document uploaded',
                                  'Missing back side / incomplete',
                                  'Name does not match profile',
                                ].map((preset) => (
                                  <button
                                    key={preset}
                                    type="button"
                                    onClick={() => setRejectRemarks(preset)}
                                    className="rounded-lg border border-rose-200 bg-white px-2 py-0.5 text-[11px] font-medium text-rose-700 hover:bg-rose-100 transition-colors"
                                  >
                                    {preset}
                                  </button>
                                ))}
                              </div>

                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={rejectRemarks}
                                  onChange={(e) => setRejectRemarks(e.target.value)}
                                  placeholder="Type reason or select a preset above..."
                                  className="flex-1 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                                />
                                <button
                                  type="button"
                                  onClick={() => { setRejectingDocId(null); setRejectRemarks(''); }}
                                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => rejectTeacherDocument(teacherDocument)}
                                  disabled={isVerifyingDocId === teacherDocument.id}
                                  className="rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50 transition-colors shadow-2xs"
                                >
                                  Confirm
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Upload on behalf form */}
                <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs">
                  <div className="flex items-center gap-2 mb-1">
                    <UploadCloud className="h-4 w-4 text-indigo-600" />
                    <h4 className="text-xs font-extrabold text-slate-900">Upload Document on Teacher's Behalf</h4>
                  </div>
                  <p className="text-[11px] text-slate-500">Attach PDF, JPEG, or PNG up to 5 MB</p>

                  <form onSubmit={uploadTeacherDocument} className="mt-3 grid gap-2.5 sm:grid-cols-[1.2fr_1.5fr_auto] sm:items-end">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Category</label>
                      <select
                        value={teacherDocumentName}
                        onChange={(e) => setTeacherDocumentName(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-1.5 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      >
                        <option>Aadhaar Card</option>
                        <option>Bank Passbook</option>
                        <option>PAN Card</option>
                        <option>Qualification Certificate</option>
                        <option>Experience Certificate</option>
                        <option>Address Proof</option>
                        <option>Other Supporting Document</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Select File</label>
                      <input
                        id="teacher-document-file"
                        type="file"
                        accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                        required
                        onChange={(e) => setTeacherDocumentFile(e.target.files?.[0] || null)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-2 py-1 text-xs font-medium text-slate-800 file:mr-2 file:rounded-lg file:border-0 file:bg-indigo-100/70 file:px-2.5 file:py-1 file:text-xs file:font-bold file:text-indigo-700"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isDocumentUploading || !teacherDocumentFile}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50 shadow-xs transition-colors"
                    >
                      <UploadCloud className="h-3.5 w-3.5" />
                      {isDocumentUploading ? 'Uploading...' : 'Upload File'}
                    </button>
                  </form>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="border-t border-slate-100 px-6 py-3 bg-slate-50 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  {totalDocs} document{totalDocs !== 1 ? 's' : ''} on record • {verifiedDocs} approved
                </span>
                <button
                  type="button"
                  onClick={() => { setDocumentsTeacherId(null); setRejectingDocId(null); }}
                  className="rounded-xl border border-slate-200 bg-white px-5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors shadow-2xs"
                >
                  Done
                </button>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}

      {/* Fullscreen in-app Document Preview Studio Modal */}
      {previewDoc && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-950/85 backdrop-blur-md flex min-h-full items-center justify-center p-2 sm:p-5 animate-fade-in duration-150" role="presentation">
          <div className="flex h-full max-h-[88vh] w-full max-w-5xl my-auto flex-col rounded-3xl border border-slate-700/60 bg-slate-900 text-white shadow-2xl overflow-hidden">
            {/* Studio Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/95 px-5 py-3.5">
              {/* Left: Info */}
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-500/20 text-indigo-400 font-mono text-xs font-bold border border-indigo-500/30">
                  {previewDoc.isPdf ? 'PDF' : 'IMG'}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-white truncate">
                      {previewDoc.doc.name}
                    </h3>
                    <span className="shrink-0 rounded-md bg-slate-800 border border-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                      {previewDoc.doc.category}
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                      previewDoc.doc.status === 'Verified'
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                        : previewDoc.doc.status === 'Rejected'
                        ? 'bg-rose-950 text-rose-400 border border-rose-800'
                        : 'bg-amber-950 text-amber-400 border border-amber-800'
                    }`}>
                      {previewDoc.doc.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 truncate mt-0.5">
                    {previewDoc.doc.fileName || 'document'}
                    {previewDoc.doc.uploadedAt && ` • Uploaded ${new Date(previewDoc.doc.uploadedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                    {documentsTeacher && ` • Teacher: ${documentsTeacher.name}`}
                  </p>
                </div>
              </div>

              {/* Center: Carousel Pager */}
              {previewDoc.total > 1 && (
                <div className="flex items-center gap-1 rounded-2xl bg-slate-800/80 border border-slate-700/80 px-2 py-1">
                  <button
                    type="button"
                    onClick={() => navigatePreview('prev')}
                    className="rounded-xl p-1 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                    title="Previous Document"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="px-2 text-xs font-bold text-slate-200">
                    {previewDoc.index + 1} / {previewDoc.total}
                  </span>
                  <button
                    type="button"
                    onClick={() => navigatePreview('next')}
                    className="rounded-xl p-1 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                    title="Next Document"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* Right: Actions */}
              <div className="flex items-center gap-1.5 shrink-0">
                {!previewDoc.isPdf && (
                  <div className="hidden sm:flex items-center gap-1 mr-1 border-r border-slate-800 pr-2">
                    <button
                      type="button"
                      onClick={zoomOut}
                      className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                      title="Zoom Out"
                    >
                      <ZoomOut className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={resetZoom}
                      className="rounded-xl px-2 py-1 text-[11px] font-mono text-slate-300 hover:bg-slate-800 transition-colors"
                      title="Reset Zoom"
                    >
                      {Math.round(previewDoc.scale * 100)}%
                    </button>
                    <button
                      type="button"
                      onClick={zoomIn}
                      className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                      title="Zoom In"
                    >
                      <ZoomIn className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={rotateDoc}
                      className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                      title="Rotate 90°"
                    >
                      <RotateCw className="h-4 w-4" />
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void downloadTeacherDocument(previewDoc.doc)}
                  disabled={isDownloadingDocId === previewDoc.doc.id}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition-colors"
                  title="Download file to computer"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{isDownloadingDocId === previewDoc.doc.id ? 'Downloading...' : 'Download'}</span>
                </button>
                <a
                  href={previewDoc.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition-colors"
                  title="Open in new browser tab"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">New Tab</span>
                </a>
                <button
                  type="button"
                  onClick={closeDocPreview}
                  className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors ml-1"
                  title="Close preview"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Document Viewer Canvas */}
            <div className="flex-1 overflow-auto bg-slate-950 p-2 sm:p-4 flex items-center justify-center relative">
              {previewDoc.isPdf ? (
                <iframe
                  src={previewDoc.url}
                  title={previewDoc.doc.name}
                  className="h-full min-h-[62vh] w-full rounded-2xl border border-slate-800 bg-white"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center overflow-auto p-4 select-none">
                  <img
                    src={previewDoc.url}
                    alt={previewDoc.doc.name}
                    style={{
                      transform: `scale(${previewDoc.scale}) rotate(${previewDoc.rotation}deg)`,
                      transition: 'transform 0.15s ease-out',
                    }}
                    className="max-h-[66vh] max-w-full object-contain rounded-xl shadow-2xl border border-slate-800 cursor-grab"
                  />
                </div>
              )}
            </div>

            {/* Verification Dock & Footer */}
            <div className="flex flex-col border-t border-slate-800 bg-slate-900/95 px-5 py-3">
              {/* In-viewer Rejection Form (replaces prompt) */}
              {showPreviewRejectInput && (
                <div className="mb-3 rounded-2xl border border-rose-800/80 bg-rose-950/70 p-3.5 animate-in fade-in">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-rose-300">Rejection Feedback for Teacher:</span>
                    <button
                      type="button"
                      onClick={() => setShowPreviewRejectInput(false)}
                      className="text-xs text-rose-400 hover:text-rose-200"
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {[
                      'Scan is blurry / illegible',
                      'Wrong document type uploaded',
                      'Missing back side of card',
                      'Details not matching school records',
                    ].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setPreviewRejectRemarks(preset)}
                        className="rounded-lg border border-rose-700 bg-rose-900/60 px-2 py-0.5 text-[11px] font-medium text-rose-200 hover:bg-rose-800 transition-colors"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={previewRejectRemarks}
                      onChange={(e) => setPreviewRejectRemarks(e.target.value)}
                      placeholder="Enter specific remarks..."
                      className="flex-1 rounded-xl border border-rose-700 bg-slate-900 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        void rejectTeacherDocument(previewDoc.doc, previewRejectRemarks);
                      }}
                      className="rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-rose-500 transition-colors shadow-xs"
                    >
                      Confirm Reject
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-slate-400">Current Status:</span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      previewDoc.doc.status === 'Verified'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                        : previewDoc.doc.status === 'Rejected'
                        ? 'bg-rose-950 text-rose-300 border border-rose-800'
                        : 'bg-amber-950 text-amber-300 border border-amber-800'
                    }`}
                  >
                    {previewDoc.doc.status}
                  </span>
                  {previewDoc.doc.remarks && (
                    <span className="text-xs text-slate-400 truncate max-w-sm">
                      ({previewDoc.doc.remarks})
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {previewDoc.doc.status !== 'Verified' && (
                    <button
                      type="button"
                      onClick={() => void verifyTeacherDocument(previewDoc.doc)}
                      disabled={isVerifyingDocId === previewDoc.doc.id}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 transition-colors shadow-sm disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" />
                      {isVerifyingDocId === previewDoc.doc.id ? 'Approving...' : 'Approve & Verify'}
                    </button>
                  )}

                  {!showPreviewRejectInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowPreviewRejectInput(true);
                        setPreviewRejectRemarks('');
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-rose-800/80 bg-rose-950/60 px-3.5 py-2 text-xs font-bold text-rose-300 hover:bg-rose-900/60 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                      {previewDoc.doc.status === 'Rejected' ? 'Edit Rejection' : 'Reject'}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={closeDocPreview}
                    className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Universal Smart Excel / Google Sheets Import Modal */}
      <ExcelImportModal
        isOpen={isExcelImportOpen}
        onClose={() => setIsExcelImportOpen(false)}
        entityType="teachers"
        onImportSuccess={() => {
          refetchTeachers?.();
        }}
      />
    </section>
  );
}
