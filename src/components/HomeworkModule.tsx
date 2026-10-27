import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  BookOpen,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  Plus,
  Search,
  Filter,
  FileText,
  Paperclip,
  Send,
  User,
  Users,
  Award,
  ChevronRight,
  ExternalLink,
  Edit,
  Trash2,
  X,
  CheckSquare,
  GraduationCap,
  ArrowLeft,
  Bell,
  Check,
  Globe2,
  UploadCloud,
  Image as ImageIcon,
  Download,
  Eye,
  File,
  Camera,
  CheckCircle,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import { AuthUser } from '../utils/auth';
import { Student } from '../types';
import {
  useGetHomeworkQuery,
  useCreateHomeworkMutation,
  useUpdateHomeworkMutation,
  useDeleteHomeworkMutation,
  useSubmitHomeworkMutation,
  useGradeSubmissionMutation,
  HomeworkRecord,
  HomeworkSubmission,
  HomeworkAttachment,
} from '../store/api/homeworkApi';
import { useGetTeachersQuery, TeacherRecord } from '../store/api/teacherApi';
import { useGetStudentsQuery } from '../store/api/studentApi';
import { loadAcademicStructure, AcademicClass, AcademicSection, AcademicSubject } from '../services/academicStructure';
import { emitNotification } from '../services/notificationBus';
import { chatSocket } from '../services/chatSocket';

interface HomeworkModuleProps {
  user: AuthUser | null;
  students?: Student[];
  onNavigateToTab?: (tab: string) => void;
}

// Utility: Format bytes into readable string
const formatFileSize = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Utility: Check if an attachment is an image
const isImageAttachment = (att?: HomeworkAttachment): boolean => {
  if (!att) return false;
  if (att.type && att.type.startsWith('image/')) return true;
  if (att.url && att.url.startsWith('data:image/')) return true;
  const ext = (att.name || '').split('.').pop()?.toLowerCase();
  return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext || '');
};

// Utility: Compress & convert File to Base64 (resizes large camera photos on canvas)
const readFileAsAttachment = (file: File): Promise<HomeworkAttachment> => {
  return new Promise((resolve) => {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const MAX_DIM = 1600;
          let { width, height } = img;
          if (width > MAX_DIM || height > MAX_DIM) {
            if (width > height) {
              height = Math.round((height * MAX_DIM) / width);
              width = MAX_DIM;
            } else {
              width = Math.round((width * MAX_DIM) / height);
              height = MAX_DIM;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            const quality = 0.85;
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            // approximate size from base64 length
            const approxSize = Math.round((dataUrl.length * 3) / 4);
            resolve({
              name: file.name,
              url: dataUrl,
              type: 'image/jpeg',
              size: approxSize,
            });
            return;
          }
          resolve({
            name: file.name,
            url: reader.result as string,
            type: file.type || 'image/jpeg',
            size: file.size,
          });
        };
        img.onerror = () => {
          resolve({
            name: file.name,
            url: reader.result as string,
            type: file.type,
            size: file.size,
          });
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          name: file.name,
          url: reader.result as string,
          type: file.type || 'application/octet-stream',
          size: file.size,
        });
      };
      reader.readAsDataURL(file);
    }
  });
};

export default function HomeworkModule({ user, students = [], onNavigateToTab }: HomeworkModuleProps) {
  const userRole = user?.role || 'Student';
  const isTeacher = userRole === 'Teacher';
  const isStudent = userRole === 'Student';
  const isParent = userRole === 'Parent';
  const isAdmin = userRole === 'School Admin' || userRole === 'Super Admin';

  // Fallback student fetch if students prop is empty
  const { data: rawStudentsFromApi = [] } = useGetStudentsQuery(undefined, { skip: students.length > 0 });
  const allStudents = useMemo<Student[]>(() => {
    if (students && students.length > 0) return students;
    return Array.isArray(rawStudentsFromApi) ? rawStudentsFromApi : (rawStudentsFromApi as any)?.results || [];
  }, [students, rawStudentsFromApi]);

  // Academic Structure State
  const [academicClasses, setAcademicClasses] = useState<AcademicClass[]>([]);
  const [academicSections, setAcademicSections] = useState<AcademicSection[]>([]);
  const [academicSubjects, setAcademicSubjects] = useState<AcademicSubject[]>([]);

  useEffect(() => {
    loadAcademicStructure()
      .then(({ classes, sections, subjects }) => {
        setAcademicClasses(classes);
        setAcademicSections(sections);
        setAcademicSubjects(subjects);
      })
      .catch((err) => console.warn('Could not load academic structure for homework:', err));
  }, []);

  // Filter States
  const [selectedClassFilter, setSelectedClassFilter] = useState<string>('All');
  const [selectedSectionFilter, setSelectedSectionFilter] = useState<string>('All');
  const [selectedSubjectFilter, setSelectedSubjectFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Completed' | 'Pending' | 'Submitted'>('All');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Parent Child Selection (if parent has multiple students)
  const parentChildren = useMemo(() => {
    if (!isParent) return [];
    if (user?.parentStudentIds && user.parentStudentIds.length > 0) {
      const idSet = new Set(user.parentStudentIds.map(String));
      const matched = allStudents.filter((s) => idSet.has(String(s.id)) || idSet.has(s.admissionNo));
      if (matched.length > 0) return matched;
    }
    // Fallback: match by email or name
    if (user?.email) {
      const byEmail = allStudents.filter(
        (s) => s.parentEmail && s.parentEmail.toLowerCase() === user.email.toLowerCase()
      );
      if (byEmail.length > 0) return byEmail;
    }
    return allStudents.slice(0, 2);
  }, [isParent, user, allStudents]);

  const [selectedChildId, setSelectedChildId] = useState<string>('');

  useEffect(() => {
    if (parentChildren.length > 0 && !selectedChildId) {
      setSelectedChildId(parentChildren[0].id);
    }
  }, [parentChildren, selectedChildId]);

  const activeChild = useMemo(() => {
    return parentChildren.find((c) => c.id === selectedChildId) || parentChildren[0] || null;
  }, [parentChildren, selectedChildId]);

  // Current Student Context (when logged in as Student)
  const currentStudent = useMemo(() => {
    if (!isStudent) return null;
    if (user?.studentId) {
      const found = allStudents.find((s) => s.id === user.studentId || s.admissionNo === user.studentId);
      if (found) return found;
    }
    if (user?.email) {
      const found = allStudents.find(
        (s) =>
          s.parentEmail?.toLowerCase() === user.email.toLowerCase() ||
          s.name.toLowerCase() === (user.name || '').toLowerCase()
      );
      if (found) return found;
    }
    return allStudents[0] || null;
  }, [isStudent, user, allStudents]);

  // RTK Query: Fetch Homework
  const { data: rawHomeworkData = [], isLoading, refetch } = useGetHomeworkQuery(undefined, {
    pollingInterval: 5000,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });

  useEffect(() => {
    const handleSync = () => {
      refetch();
    };
    window.addEventListener('homework:synced', handleSync);
    const unsub = chatSocket.on('homework.sync', handleSync);
    return () => {
      window.removeEventListener('homework:synced', handleSync);
      unsub();
    };
  }, [refetch]);
  const homeworkList = useMemo<HomeworkRecord[]>(() => {
    return Array.isArray(rawHomeworkData) ? rawHomeworkData : (rawHomeworkData as any)?.results || [];
  }, [rawHomeworkData]);

  // Dynamic list of all subjects for filter dropdown
  const availableFilterSubjects = useMemo(() => {
    const set = new Set<string>();
    academicSubjects.forEach((s) => {
      if (s.name && s.name.trim()) set.add(s.name.trim());
    });
    homeworkList.forEach((hw) => {
      if (hw.subjectName && hw.subjectName.trim()) set.add(hw.subjectName.trim());
    });
    if (set.size === 0) {
      ['English', 'Mathematics', 'Science', 'Social Studies', 'Hindi', 'Computer Science'].forEach((s) => set.add(s));
    }
    return Array.from(set).sort();
  }, [academicSubjects, homeworkList]);

  const [createHomework, { isLoading: isCreating }] = useCreateHomeworkMutation();
  const [updateHomework, { isLoading: isUpdating }] = useUpdateHomeworkMutation();
  const [deleteHomework] = useDeleteHomeworkMutation();
  const [submitHomework, { isLoading: isSubmitting }] = useSubmitHomeworkMutation();
  const [gradeSubmission, { isLoading: isGrading }] = useGradeSubmissionMutation();

  // Teacher Assignments & Scope
  const { data: teachersData = [] } = useGetTeachersQuery(undefined, { skip: !isTeacher && !isAdmin });
  const teacherList: TeacherRecord[] = useMemo(() => {
    return Array.isArray(teachersData) ? teachersData : (teachersData as any)?.results || [];
  }, [teachersData]);

  const currentTeacher = useMemo(() => {
    if (!isTeacher) return null;
    return (
      teacherList.find((t) => {
        if (t.userId && user?.id && Number(t.userId) === Number(user.id)) return true;
        if (t.email && user?.email && t.email.toLowerCase() === user.email.toLowerCase()) return true;
        if (t.name && user?.name && t.name.toLowerCase() === user.name.toLowerCase()) return true;
        return false;
      }) || null
    );
  }, [isTeacher, teacherList, user]);

  // Class Teacher detection: Classes where this teacher is assigned as the Class Teacher
  const managedClasses = useMemo<Array<{ id: number; name: string }>>(() => {
    if (!isTeacher || !currentTeacher) return [];
    const fromProfile = (currentTeacher as any).managedClasses || [];
    if (fromProfile.length > 0) return fromProfile;
    const list: Array<{ id: number; name: string }> = [];
    academicClasses.forEach((c) => {
      if (c.classTeacherId && c.classTeacherId === currentTeacher.id) {
        list.push({ id: c.id, name: c.name });
      }
    });
    return list;
  }, [isTeacher, currentTeacher, academicClasses]);

  const isClassTeacher = managedClasses.length > 0;

  interface TeacherScope {
    classes: string[];
    sectionsByClass: Record<string, string[]>;
    subjectsByClassSection: Record<string, string[]>;
    hasAssignments: boolean;
    displaySummary: string;
  }

  const teacherScope = useMemo<TeacherScope>(() => {
    if (!isTeacher || !currentTeacher) {
      return {
        classes: [],
        sectionsByClass: {},
        subjectsByClassSection: {},
        hasAssignments: false,
        displaySummary: '',
      };
    }

    const classesSet = new Set<string>();
    const sectionsMap: Record<string, Set<string>> = {};
    const subjectsMap: Record<string, Set<string>> = {};
    const summaryItems: string[] = [];

    (currentTeacher.teachingAssignments || []).forEach((ta) => {
      const cls = (ta.className || '').replace(/^Class\s*/i, '').trim();
      const sec = (ta.sectionName || '').trim();
      const subj = (ta.subjectName || '').trim();
      if (!cls) return;

      classesSet.add(cls);
      if (!sectionsMap[cls]) sectionsMap[cls] = new Set();
      if (sec) sectionsMap[cls].add(sec);

      if (subj) {
        const keySec = `${cls}_${sec || 'All'}`;
        if (!subjectsMap[keySec]) subjectsMap[keySec] = new Set();
        subjectsMap[keySec].add(subj);

        const keyAll = `${cls}_All`;
        if (!subjectsMap[keyAll]) subjectsMap[keyAll] = new Set();
        subjectsMap[keyAll].add(subj);

        summaryItems.push(`Class ${cls}-${sec || 'All'} (${subj})`);
      }
    });

    (currentTeacher.assignedSections || []).forEach((secLabel) => {
      const clean = String(secLabel).replace(/^Class\s*/i, '').trim();
      const parts = clean.split('-');
      if (parts.length >= 2) {
        const cls = parts[0].trim();
        const sec = parts[1].trim();
        if (cls) {
          classesSet.add(cls);
          if (!sectionsMap[cls]) sectionsMap[cls] = new Set();
          if (sec) sectionsMap[cls].add(sec);
        }
      } else if (clean) {
        classesSet.add(clean);
      }
    });

    classesSet.forEach((cls) => {
      if (!sectionsMap[cls] || sectionsMap[cls].size === 0) {
        sectionsMap[cls] = new Set(['All']);
      }
    });

    const finalSectionsByClass: Record<string, string[]> = {};
    Object.keys(sectionsMap).forEach((cls) => {
      finalSectionsByClass[cls] = Array.from(sectionsMap[cls]).sort();
    });

    const finalSubjectsByClassSection: Record<string, string[]> = {};
    Object.keys(subjectsMap).forEach((key) => {
      finalSubjectsByClassSection[key] = Array.from(subjectsMap[key]).sort();
    });

    const classesList = Array.from(classesSet).sort((a, b) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });

    const hasAssignments = classesList.length > 0 || (currentTeacher.subjects && currentTeacher.subjects.length > 0);
    const uniqueSummary = Array.from(new Set(summaryItems)).slice(0, 3).join(', ');

    return {
      classes: classesList,
      sectionsByClass: finalSectionsByClass,
      subjectsByClassSection: finalSubjectsByClassSection,
      hasAssignments,
      displaySummary: uniqueSummary || (currentTeacher.assignedSections || []).slice(0, 3).join(', '),
    };
  }, [isTeacher, currentTeacher]);

  // Modal States
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingHomework, setEditingHomework] = useState<HomeworkRecord | null>(null);
  const [viewingSubmissionsHw, setViewingSubmissionsHw] = useState<HomeworkRecord | null>(null);
  const [submitModalHw, setSubmitModalHw] = useState<HomeworkRecord | null>(null);
  const [submitChildId, setSubmitChildId] = useState<string>('');
  const [submissionText, setSubmissionText] = useState('');

  // File Upload States
  const [formAttachments, setFormAttachments] = useState<HomeworkAttachment[]>([]);
  const [submitAttachments, setSubmitAttachments] = useState<HomeworkAttachment[]>([]);
  const [isProcessingUpload, setIsProcessingUpload] = useState(false);
  const formFileInputRef = useRef<HTMLInputElement>(null);
  const submitFileInputRef = useRef<HTMLInputElement>(null);

  // Lightbox Media Preview Modal
  const [previewMedia, setPreviewMedia] = useState<HomeworkAttachment | null>(null);

  // Submissions Tracker Filter Tabs & Search
  const [submissionTab, setSubmissionTab] = useState<'all' | 'submitted' | 'pending' | 'graded'>('all');
  const [submissionSearch, setSubmissionSearch] = useState('');
  const [reminderSentMap, setReminderSentMap] = useState<Record<string, boolean>>({});

  // Form State for Create/Edit Homework
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formClass, setFormClass] = useState('1');
  const [formSection, setFormSection] = useState('All');
  const [formSubject, setFormSubject] = useState('English');
  const [formDueDate, setFormDueDate] = useState('');
  const [formMaxMarks, setFormMaxMarks] = useState<number>(20);
  const [formAttachmentName, setFormAttachmentName] = useState('');
  const [formAttachmentUrl, setFormAttachmentUrl] = useState('');
  const [formTeacherId, setFormTeacherId] = useState<number | null>(null);
  const [formTeacherName, setFormTeacherName] = useState<string>('');
  const [notifyClass, setNotifyClass] = useState(true);

  // Set default due date to tomorrow
  useEffect(() => {
    if (!formDueDate) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 2);
      setFormDueDate(tomorrow.toISOString().split('T')[0]);
    }
  }, [formDueDate]);

  // Dynamic options for homework creation modal
  const modalClassOptions = useMemo<string[]>(() => {
    if (isTeacher) {
      return teacherScope.classes;
    }
    const classNames = academicClasses.map((c) => c.name.replace(/^Class\s*/i, ''));
    if (isAdmin) {
      return ['All Classes', ...classNames];
    }
    return classNames;
  }, [isTeacher, isAdmin, teacherScope.classes, academicClasses]);

  const modalSectionOptions = useMemo<string[]>(() => {
    if (formClass === 'All Classes') {
      return ['All'];
    }
    if (isTeacher) {
      const secs = teacherScope.sectionsByClass[formClass] || [];
      if (secs.length > 1) {
        return ['All', ...secs];
      }
      return secs.length > 0 ? secs : ['All'];
    }
    return ['All', 'A', 'B', 'C', 'D'];
  }, [isTeacher, teacherScope.sectionsByClass, formClass]);

  const modalSubjectOptions = useMemo<string[]>(() => {
    if (isTeacher) {
      const keySec = `${formClass}_${formSection}`;
      const keyAll = `${formClass}_All`;
      const specific = teacherScope.subjectsByClassSection[keySec] || teacherScope.subjectsByClassSection[keyAll];
      if (specific && specific.length > 0) return specific;
      if (currentTeacher?.subjects && currentTeacher.subjects.length > 0) return currentTeacher.subjects;
      return [];
    }
    return academicSubjects.length > 0
      ? academicSubjects.map((s) => s.name)
      : ['English', 'Mathematics', 'Science', 'Social Studies', 'Hindi', 'Computer Science'];
  }, [isTeacher, formClass, formSection, teacherScope, currentTeacher, academicSubjects]);

  const handleFormClassChange = (newClass: string) => {
    setFormClass(newClass);
    if (newClass === 'All Classes') {
      setFormSection('All');
      return;
    }
    if (isTeacher) {
      const secs = teacherScope.sectionsByClass[newClass] || [];
      const newSec = secs.length === 1 ? secs[0] : (secs.length > 0 ? secs[0] : 'All');
      setFormSection(newSec);
      const subjs =
        teacherScope.subjectsByClassSection[`${newClass}_${newSec}`] ||
        teacherScope.subjectsByClassSection[`${newClass}_All`] ||
        currentTeacher?.subjects ||
        [];
      if (subjs.length > 0) {
        setFormSubject(subjs[0]);
      }
    }
  };

  const handleFormSectionChange = (newSec: string) => {
    setFormSection(newSec);
    if (isTeacher) {
      const subjs =
        teacherScope.subjectsByClassSection[`${formClass}_${newSec}`] ||
        teacherScope.subjectsByClassSection[`${formClass}_All`] ||
        currentTeacher?.subjects ||
        [];
      if (subjs.length > 0 && !subjs.includes(formSubject)) {
        setFormSubject(subjs[0]);
      }
    }
  };

  // Open Create Modal
  const openCreateModal = () => {
    setEditingHomework(null);
    setFormTitle('');
    setFormDescription('');
    setFormAttachments([]);

    if (isTeacher && teacherScope.classes.length > 0) {
      const firstClass = teacherScope.classes[0];
      setFormClass(firstClass);
      const secs = teacherScope.sectionsByClass[firstClass] || [];
      const firstSec = secs.length === 1 ? secs[0] : (secs.length > 0 ? secs[0] : 'All');
      setFormSection(firstSec);
      const subjs =
        teacherScope.subjectsByClassSection[`${firstClass}_${firstSec}`] ||
        teacherScope.subjectsByClassSection[`${firstClass}_All`] ||
        currentTeacher?.subjects ||
        [];
      setFormSubject(subjs[0] || 'English');
    } else {
      setFormClass(academicClasses[0]?.name ? academicClasses[0].name.replace(/^Class\s*/i, '') : '1');
      setFormSection('All');
      setFormSubject(academicSubjects[0]?.name || 'English');
    }

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    setFormDueDate(tomorrow.toISOString().split('T')[0]);
    setFormMaxMarks(20);
    setFormAttachmentName('');
    setFormAttachmentUrl('');
    setFormTeacherId(null);
    setFormTeacherName('');
    setNotifyClass(true);
    setIsCreateModalOpen(true);
  };

  // Open Edit Modal
  const openEditModal = (hw: HomeworkRecord) => {
    setEditingHomework(hw);
    setFormTitle(hw.title);
    setFormDescription(hw.description);
    setFormClass(hw.className);
    setFormSection(hw.sectionName || 'All');
    setFormSubject(hw.subjectName);
    setFormDueDate(hw.dueDate);
    setFormMaxMarks(hw.maxMarks || 20);
    setFormAttachmentName(hw.attachmentName || '');
    setFormAttachmentUrl(hw.attachmentUrl || '');
    setFormTeacherId(hw.teacherId ?? null);
    setFormTeacherName(hw.teacherName || '');

    // Populate attachments
    if (hw.attachments && hw.attachments.length > 0) {
      setFormAttachments(hw.attachments);
    } else if (hw.attachmentName) {
      setFormAttachments([
        {
          name: hw.attachmentName,
          url: hw.attachmentUrl || '',
          type: 'document',
        },
      ]);
    } else {
      setFormAttachments([]);
    }
    setIsCreateModalOpen(true);
  };

  // File Upload Handlers
  const handleUploadFiles = async (files: File[], target: 'form' | 'submit') => {
    if (!files || files.length === 0) return;
    setIsProcessingUpload(true);
    try {
      const uploaded: HomeworkAttachment[] = [];
      for (const file of files) {
        if (file.size > 15 * 1024 * 1024) {
          alert(`File "${file.name}" exceeds the 15MB size limit. Please upload a smaller file.`);
          continue;
        }
        const att = await readFileAsAttachment(file);
        uploaded.push(att);
      }
      if (target === 'form') {
        setFormAttachments((prev) => [...prev, ...uploaded]);
      } else {
        setSubmitAttachments((prev) => [...prev, ...uploaded]);
      }
    } catch (err) {
      console.error('File upload error:', err);
      alert('Failed to read files. Please try again.');
    } finally {
      setIsProcessingUpload(false);
    }
  };

  const handleDownloadAttachment = (att: HomeworkAttachment, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (!att.url) return;
    const link = document.createElement('a');
    link.href = att.url;
    link.download = att.name || 'attachment';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Save Homework (Create or Update)
  const handleSaveHomework = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formDescription.trim() || !formDueDate) {
      alert('Please fill out the title, description, and due date.');
      return;
    }

    const isAllClasses = formClass === 'All Classes' || formClass.toLowerCase() === 'all';
    const finalClassName = isAllClasses ? 'All Classes' : formClass;
    const finalSectionName = isAllClasses || formSection === 'All' ? '' : formSection;

    // Use primary attachment name/url if available
    const primaryName = formAttachments.length > 0 ? formAttachments[0].name : formAttachmentName.trim();
    const primaryUrl = formAttachments.length > 0 ? formAttachments[0].url : formAttachmentUrl.trim();

    try {
      const assignedTeacherId = isAdmin
        ? (formTeacherId ?? null)
        : (currentTeacher?.id ?? null);
      const assignedTeacherName = isAdmin
        ? (formTeacherName || (formTeacherId ? teacherList.find((t) => t.id === formTeacherId)?.name : `Admin (${user?.name || 'Administrator'})`))
        : (currentTeacher?.name || user?.name || 'Teacher');

      if (editingHomework) {
        await updateHomework({
          id: editingHomework.id,
          data: {
            title: formTitle.trim(),
            description: formDescription.trim(),
            className: finalClassName,
            sectionName: finalSectionName,
            subjectName: formSubject,
            dueDate: formDueDate,
            maxMarks: Number(formMaxMarks) || 20,
            teacherId: assignedTeacherId,
            teacherName: assignedTeacherName,
            attachmentName: primaryName,
            attachmentUrl: primaryUrl,
            attachments: formAttachments,
          },
        }).unwrap();

        emitNotification({
          title: 'Homework Updated',
          message: isAllClasses
            ? `Updated school-wide homework for All Classes: "${formTitle.trim()}"`
            : `Updated homework for Class ${formClass}: "${formTitle.trim()}"`,
          tone: 'info',
          source: 'academics',
        });
      } else {
        await createHomework({
          title: formTitle.trim(),
          description: formDescription.trim(),
          className: finalClassName,
          sectionName: finalSectionName,
          subjectName: formSubject,
          dueDate: formDueDate,
          maxMarks: Number(formMaxMarks) || 20,
          teacherId: assignedTeacherId,
          teacherName: assignedTeacherName,
          attachmentName: primaryName,
          attachmentUrl: primaryUrl,
          attachments: formAttachments,
          status: 'Active',
        }).unwrap();

        emitNotification({
          title: 'Homework Assigned & Dispatched',
          message: isAllClasses
            ? `Assigned school-wide homework for All Classes: "${formTitle.trim()}". Dispatched across the school!`
            : `Assigned new homework for Class ${formClass}: "${formTitle.trim()}". Notifications dispatched to students and parents!`,
          tone: 'success',
          source: 'academics',
        });
      }

      setIsCreateModalOpen(false);
      refetch();
    } catch (err: any) {
      console.error('Failed to save homework:', err);
      const errorMsg =
        err?.data?.detail ||
        (err?.data && typeof err.data === 'object' ? Object.values(err.data).flat().join(' ') : null) ||
        err?.message ||
        'Failed to save homework. Please check your network and try again.';
      alert(errorMsg);
    }
  };

  // Delete Homework
  const handleDeleteHomework = async (id: number, title: string) => {
    const confirmMessage = isAdmin
      ? `Are you sure you want to remove homework "${title}"? This will permanently remove the homework and all student submissions across the school.`
      : `Are you sure you want to delete homework "${title}"?`;
    if (!confirm(confirmMessage)) return;
    try {
      await deleteHomework(id).unwrap();
      emitNotification({
        title: 'Homework Removed',
        message: `Removed homework "${title}".`,
        tone: 'warning',
        source: 'academics',
      });
      refetch();
    } catch (err: any) {
      console.error('Failed to remove homework:', err);
      alert(err?.data?.detail || 'Failed to remove homework.');
    }
  };

  // Open Submission Modal (Student or Parent)
  const openSubmitModal = (hw: HomeworkRecord, targetStudent?: Student | null) => {
    setSubmitModalHw(hw);
    setSubmissionText('');
    setSubmitAttachments([]);
    if (isParent) {
      const child = targetStudent || activeChild || parentChildren[0];
      setSubmitChildId(child ? child.id : '');
    }
  };

  // Submit Homework (Student or Parent on behalf of child)
  const handleSubmitWork = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!submitModalHw) return;

    let targetChild = activeChild;
    if (isParent && submitChildId) {
      targetChild = parentChildren.find((c) => c.id === submitChildId) || activeChild;
    }

    const studentIdToUse = isStudent
      ? (currentStudent?.id || String(user?.id) || 'student-1')
      : (targetChild?.id || 'child-1');
    const studentNameToUse = isStudent
      ? (currentStudent?.name || user?.name || 'Student')
      : (targetChild?.name || 'Ward');
    const admissionNoToUse = isStudent
      ? (currentStudent?.admissionNo || '')
      : (targetChild?.admissionNo || '');

    try {
      await submitHomework({
        homeworkId: submitModalHw.id,
        studentId: studentIdToUse,
        studentName: studentNameToUse,
        admissionNo: admissionNoToUse,
        submissionText: submissionText.trim() || 'Completed tasks as assigned.',
        attachments: submitAttachments,
      }).unwrap();

      emitNotification({
        title: 'Homework Submitted',
        message: isParent
          ? `Successfully submitted "${submitModalHw.title}" on behalf of ${studentNameToUse}! Teacher has been notified.`
          : `Marked "${submitModalHw.title}" as completed! Teacher has been notified.`,
        tone: 'success',
        source: 'academics',
      });

      setSubmitModalHw(null);
      setSubmissionText('');
      setSubmitAttachments([]);
      refetch();
    } catch (err) {
      console.error('Failed to submit homework:', err);
      alert('Failed to submit homework. Please try again.');
    }
  };

  // Grade Homework (Teacher)
  const [gradeStudentId, setGradeStudentId] = useState('');
  const [gradeMarks, setGradeMarks] = useState<number>(0);
  const [gradeFeedback, setGradeFeedback] = useState('');
  const [justGradedStudentId, setJustGradedStudentId] = useState<string | null>(null);

  const handleSaveGrade = async (homeworkId: number, studentId: string, marks: number, feedback: string) => {
    try {
      await gradeSubmission({
        homeworkId,
        studentId,
        marksObtained: marks,
        teacherFeedback: feedback.trim(),
      }).unwrap();

      setJustGradedStudentId(studentId);
      setTimeout(() => setJustGradedStudentId(null), 2500);

      emitNotification({
        title: 'Submission Graded',
        message: `Awarded ${marks} marks. Score has been saved and student/parent notified.`,
        tone: 'success',
        source: 'academics',
      });

      refetch();
    } catch (err) {
      console.error('Failed to grade submission:', err);
      alert('Failed to record grade. Please try again.');
    }
  };

  // Clean class matching helper
  const matchClassNumber = (c1?: string, c2?: string) => {
    if (!c1 || !c2) return false;
    const clean1 = c1.replace(/^Class\s*/i, '').split('-')[0].trim().toLowerCase();
    const clean2 = c2.replace(/^Class\s*/i, '').split('-')[0].trim().toLowerCase();
    if (clean1 === 'all' || clean1 === 'all classes' || clean1 === 'all-classes') return true;
    if (clean2 === 'all' || clean2 === 'all classes' || clean2 === 'all-classes') return true;
    return clean1 === clean2;
  };

  const matchSection = (s1?: string, s2?: string) => {
    if (!s1 || !s2 || s1.toLowerCase() === 'all' || s2.toLowerCase() === 'all') return true;
    return s1.trim().toUpperCase() === s2.trim().toUpperCase();
  };

  // Send single or bulk reminders for pending submissions
  const handleSendReminder = (studentName: string, parentName?: string, studentId?: string) => {
    if (studentId) {
      setReminderSentMap((prev) => ({ ...prev, [studentId]: true }));
    }
    emitNotification({
      title: 'Homework Reminder Sent',
      message: `Direct reminder notification sent to ${studentName}${parentName ? ` and parent (${parentName})` : ''} for "${viewingSubmissionsHw?.title}".`,
      tone: 'info',
      source: 'academics',
    });
  };

  // Filtered Homework List
  const filteredHomework = useMemo(() => {
    return homeworkList.filter((hw) => {
      // 1. Role-specific filtering
      if (isStudent) {
        // Backend /api/v1/homework/ is already strictly scoped to the student
      } else if (isParent) {
        if (activeChild) {
          const isSchoolWide = ['all', 'all classes', 'all-classes'].includes((hw.className || '').trim().toLowerCase());
          if (!isSchoolWide && !matchClassNumber(hw.className, activeChild.class)) return false;
          if (!isSchoolWide && hw.sectionName && activeChild.section && !matchSection(hw.sectionName, activeChild.section)) {
            return false;
          }
        }
      } else {
        // Teacher or Admin manual filters
        if (selectedClassFilter === 'All Classes') {
          const isSchoolWide = ['all', 'all classes', 'all-classes'].includes((hw.className || '').trim().toLowerCase());
          if (!isSchoolWide) return false;
        } else if (selectedClassFilter !== 'All') {
          if (!matchClassNumber(hw.className, selectedClassFilter)) {
            return false;
          }
        }
        if (selectedSectionFilter !== 'All' && !matchSection(hw.sectionName, selectedSectionFilter)) {
          return false;
        }
      }

      // Subject Filter
      if (selectedSubjectFilter !== 'All' && hw.subjectName.toLowerCase() !== selectedSubjectFilter.toLowerCase()) {
        return false;
      }

      // Status Filter
      if (statusFilter === 'Active' && hw.status !== 'Active') return false;
      if (statusFilter === 'Completed' && hw.status !== 'Completed') return false;

      // Student/Parent submission status filter
      if ((isStudent || isParent) && (statusFilter === 'Pending' || statusFilter === 'Submitted')) {
        const targetStudentId = isStudent ? (currentStudent?.id || String(user?.id)) : activeChild?.id;
        const isSub = (hw.submissions || []).some(
          (s) =>
            String(s.student_id) === String(targetStudentId) ||
            (activeChild?.admissionNo && s.admission_no === activeChild.admissionNo)
        );
        if (statusFilter === 'Pending' && isSub) return false;
        if (statusFilter === 'Submitted' && !isSub) return false;
      }

      // Search Filter
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchTitle = hw.title.toLowerCase().includes(query);
        const matchDesc = hw.description.toLowerCase().includes(query);
        const matchSub = hw.subjectName.toLowerCase().includes(query);
        const matchTeacher = (hw.teacherName || '').toLowerCase().includes(query);
        if (!matchTitle && !matchDesc && !matchSub && !matchTeacher) return false;
      }

      return true;
    });
  }, [
    homeworkList,
    isStudent,
    currentStudent,
    isParent,
    activeChild,
    user,
    selectedClassFilter,
    selectedSectionFilter,
    selectedSubjectFilter,
    statusFilter,
    searchTerm,
  ]);

  // Aggregate KPI Statistics
  const stats = useMemo(() => {
    const total = filteredHomework.length;
    let pendingCount = 0;
    let submittedCount = 0;
    let dueSoonCount = 0;
    let pendingGradingCount = 0;
    let gradedCount = 0;
    let activeCount = 0;

    const now = new Date();
    const threeDaysLater = new Date();
    threeDaysLater.setDate(now.getDate() + 3);

    filteredHomework.forEach((hw) => {
      if (hw.status === 'Active') activeCount++;
      const dueDate = new Date(hw.dueDate);
      if (dueDate >= now && dueDate <= threeDaysLater) {
        dueSoonCount++;
      }

      const submissions = hw.submissions || [];
      submissions.forEach((s) => {
        if (s.marks_obtained !== null && s.marks_obtained !== undefined) {
          gradedCount++;
        } else {
          pendingGradingCount++;
        }
      });

      if (isStudent || isParent) {
        const targetStudentId = isStudent ? (currentStudent?.id || String(user?.id)) : activeChild?.id;
        const isSub = submissions.some(
          (s) =>
            String(s.student_id) === String(targetStudentId) ||
            (activeChild?.admissionNo && s.admission_no === activeChild.admissionNo)
        );
        if (isSub) submittedCount++;
        else pendingCount++;
      } else {
        const subCount = submissions.length;
        if (subCount > 0) submittedCount += subCount;
        if (hw.status === 'Active') pendingCount++;
      }
    });

    return { total, activeCount, pendingCount, submittedCount, dueSoonCount, pendingGradingCount, gradedCount };
  }, [filteredHomework, isStudent, isParent, currentStudent, activeChild, user]);

  // Complete Submissions Tracker Roster calculation (Who all submitted vs Pending)
  const fullSubmissionsRoster = useMemo(() => {
    if (!viewingSubmissionsHw) return [];
    const targetClass = (viewingSubmissionsHw.className || '').trim();
    const targetSection = (viewingSubmissionsHw.sectionName || '').trim();
    const isSchoolWide = ['all', 'all classes', 'all-classes'].includes(targetClass.toLowerCase());

    // 1. Get class-enrolled students
    const matchingClassStudents = allStudents.filter((st) => {
      if (isSchoolWide) return true;
      if (!matchClassNumber(st.class, targetClass)) return false;
      if (targetSection && targetSection.toLowerCase() !== 'all') {
        return matchSection(st.section, targetSection);
      }
      return true;
    });

    // 2. Build index of actual submissions
    const submissions = viewingSubmissionsHw.submissions || [];
    const submissionMap = new Map<string, HomeworkSubmission>();
    submissions.forEach((sub) => {
      if (sub.student_id) submissionMap.set(String(sub.student_id).toLowerCase(), sub);
      if (sub.admission_no) submissionMap.set(String(sub.admission_no).toLowerCase(), sub);
    });

    interface RosterStudentItem {
      studentId: string;
      studentName: string;
      admissionNo?: string;
      rollNo?: number;
      className?: string;
      sectionName?: string;
      parentName?: string;
      parentPhone?: string;
      parentEmail?: string;
      photoUrl?: string;
      submission?: HomeworkSubmission;
      status: 'Submitted' | 'Graded' | 'Pending';
    }

    const roster: RosterStudentItem[] = [];
    const matchedSubKeys = new Set<string>();

    matchingClassStudents.forEach((st) => {
      const sub =
        submissionMap.get(String(st.id).toLowerCase()) ||
        (st.admissionNo ? submissionMap.get(String(st.admissionNo).toLowerCase()) : undefined);

      if (sub) {
        if (sub.student_id) matchedSubKeys.add(String(sub.student_id).toLowerCase());
        if (sub.admission_no) matchedSubKeys.add(String(sub.admission_no).toLowerCase());
      }

      const status: 'Submitted' | 'Graded' | 'Pending' = sub
        ? sub.marks_obtained !== null && sub.marks_obtained !== undefined
          ? 'Graded'
          : 'Submitted'
        : 'Pending';

      roster.push({
        studentId: String(st.id),
        studentName: st.name,
        admissionNo: st.admissionNo,
        rollNo: st.rollNo,
        className: st.class,
        sectionName: st.section,
        parentName: st.parentName || (st as any).fatherName || (st as any).motherName,
        parentPhone: st.parentPhone,
        parentEmail: st.parentEmail,
        photoUrl: st.photoUrl,
        submission: sub,
        status,
      });
    });

    // 3. Catch submissions by students who might not match active catalog filter
    submissions.forEach((sub) => {
      const idKey = String(sub.student_id).toLowerCase();
      const admKey = sub.admission_no ? String(sub.admission_no).toLowerCase() : '';
      if (!matchedSubKeys.has(idKey) && (!admKey || !matchedSubKeys.has(admKey))) {
        const status: 'Submitted' | 'Graded' | 'Pending' =
          sub.marks_obtained !== null && sub.marks_obtained !== undefined ? 'Graded' : 'Submitted';
        roster.push({
          studentId: String(sub.student_id),
          studentName: sub.student_name,
          admissionNo: sub.admission_no,
          className: viewingSubmissionsHw.className,
          sectionName: viewingSubmissionsHw.sectionName,
          submission: sub,
          status,
        });
      }
    });

    // Sort: Submitted/Graded first, then pending by roll number / name
    return roster.sort((a, b) => {
      if (a.submission && !b.submission) return -1;
      if (!a.submission && b.submission) return 1;
      if (a.rollNo && b.rollNo) return a.rollNo - b.rollNo;
      return a.studentName.localeCompare(b.studentName);
    });
  }, [viewingSubmissionsHw, allStudents]);

  // Filtered roster for Submissions Tracker modal tabs & search
  const filteredSubmissionsRoster = useMemo(() => {
    return fullSubmissionsRoster.filter((item) => {
      if (submissionTab === 'submitted' && !item.submission) return false;
      if (submissionTab === 'pending' && item.submission) return false;
      if (submissionTab === 'graded' && item.status !== 'Graded') return false;

      if (submissionSearch.trim()) {
        const q = submissionSearch.toLowerCase();
        const matchName = item.studentName.toLowerCase().includes(q);
        const matchAdm = (item.admissionNo || '').toLowerCase().includes(q);
        const matchRoll = String(item.rollNo || '').includes(q);
        const matchParent = (item.parentName || '').toLowerCase().includes(q);
        if (!matchName && !matchAdm && !matchRoll && !matchParent) return false;
      }
      return true;
    });
  }, [fullSubmissionsRoster, submissionTab, submissionSearch]);

  const submissionRosterStats = useMemo(() => {
    const total = fullSubmissionsRoster.length;
    const submitted = fullSubmissionsRoster.filter((r) => !!r.submission).length;
    const pending = total - submitted;
    const graded = fullSubmissionsRoster.filter((r) => r.status === 'Graded').length;
    return { total, submitted, pending, graded };
  }, [fullSubmissionsRoster]);

  // Subject Color Themes
  const getSubjectColor = (subject: string) => {
    const sub = subject.toLowerCase();
    if (sub.includes('math')) return 'bg-blue-50 text-blue-700 border-blue-200';
    if (sub.includes('sci')) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (sub.includes('eng')) return 'bg-purple-50 text-purple-700 border-purple-200';
    if (sub.includes('soc') || sub.includes('hist') || sub.includes('geo'))
      return 'bg-amber-50 text-amber-700 border-amber-200';
    if (sub.includes('hin') || sub.includes('lang')) return 'bg-rose-50 text-rose-700 border-rose-200';
    if (sub.includes('comp') || sub.includes('it')) return 'bg-cyan-50 text-cyan-700 border-cyan-200';
    return 'bg-indigo-50 text-indigo-700 border-indigo-200';
  };

  // Due Date Badge Text & Color
  const getDueBadge = (dueDateStr: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDateStr);
    due.setHours(0, 0, 0, 0);

    const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return { text: `Overdue by ${Math.abs(diffDays)}d`, color: 'bg-rose-100 text-rose-800 border-rose-200' };
    }
    if (diffDays === 0) {
      return { text: 'Due Today', color: 'bg-amber-100 text-amber-800 border-amber-200 font-extrabold' };
    }
    if (diffDays === 1) {
      return { text: 'Due Tomorrow', color: 'bg-amber-50 text-amber-700 border-amber-200' };
    }
    return { text: `Due in ${diffDays} days`, color: 'bg-slate-100 text-slate-700 border-slate-200' };
  };

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-300">
      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {/* TOP HEADER & WELCOME CARD                                                  */}
      {/* ─────────────────────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-md shadow-indigo-100 shrink-0">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-100">
                {isStudent
                  ? 'Student Homework Desk'
                  : isParent
                  ? 'Parent Ward Monitor'
                  : isTeacher
                  ? 'Teacher Assignment Desk'
                  : 'Academic Homework'}
              </span>
              {isTeacher && teacherScope.hasAssignments && (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                  <Check className="w-3 h-3 text-emerald-600" />
                  <span>Authorized Classes: {teacherScope.classes.map((c) => `Class ${c}`).join(', ')}</span>
                </span>
              )}
              <span className="text-xs font-semibold text-slate-400">Class Curriculum</span>
            </div>
            <h1 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">
              {isStudent
                ? 'My Class Homework & Assignments'
                : isParent
                ? `${activeChild ? activeChild.name + '’s' : 'Ward'} Homework & Tasks`
                : 'Class Homework Management'}
            </h1>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              {isStudent
                ? `Track daily homework assigned by your teachers for Class ${currentStudent?.class || '1'} (${currentStudent?.section || 'Section B'}).`
                : isParent
                ? `Stay updated on homework deadlines, submit completed work with notebook photos on behalf of ${activeChild?.name || 'your child'}, and review teacher feedback.`
                : 'Assign daily class homework with worksheets & images, view complete submission rosters, and evaluate student work.'}
            </p>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex flex-wrap items-center gap-2.5 self-start md:self-center">
          {(isTeacher || isAdmin) && (
            <button
              type="button"
              onClick={openCreateModal}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-extrabold text-xs flex items-center gap-2 shadow-sm transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Assign Class Homework</span>
            </button>
          )}

          {isParent && parentChildren.length > 1 && (
            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
              <span className="text-[11px] font-bold text-slate-500 px-2">Ward:</span>
              {parentChildren.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedChildId(c.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    activeChild?.id === c.id
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {c.name} (Class {c.class}-{c.section})
                </button>
              ))}
            </div>
          )}

          {onNavigateToTab && (
            <button
              type="button"
              onClick={() => onNavigateToTab('communication')}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
              title="View all class notices and announcements"
            >
              <Bell className="w-3.5 h-3.5 text-slate-500" />
              <span>Notice Center</span>
            </button>
          )}
        </div>
      </div>

      {/* Teacher Authorization Notice if unassigned */}
      {isTeacher && !teacherScope.hasAssignments && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-3xl flex items-start gap-3 text-amber-900 shadow-2xs">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <h4 className="font-extrabold text-sm text-amber-800">No Teaching Classes Assigned</h4>
            <p className="text-amber-700 leading-relaxed">
              You do not have any classes or sections currently assigned to your teacher profile. School policy requires
              that homework can only be assigned by teachers assigned to those specific classes. Please contact your School
              Administrator to update your teaching schedule.
            </p>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {/* KPI METRIC CARDS                                                           */}
      {/* ─────────────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Card 1 */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            {isAdmin
              ? 'School Homeworks'
              : isTeacher
              ? 'My Class Tasks'
              : isStudent
              ? 'Assigned Tasks'
              : `${activeChild?.name || 'Ward'} Tasks`}
          </p>
          <div className="flex items-baseline justify-between">
            <h3 className="text-xl md:text-2xl font-black text-slate-900">{stats.total}</h3>
            <span className="text-[11px] font-bold text-slate-500">Curriculum</span>
          </div>
          <p className="text-[11px] text-slate-400">
            {isAdmin ? 'Total school assignments' : isTeacher ? 'Assigned to my classes' : 'Active academic syllabus'}
          </p>
        </div>

        {/* Card 2 */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600">
            {isAdmin ? 'Active Assignments' : isTeacher ? 'Submissions To Grade' : 'Pending To-Do'}
          </p>
          <div className="flex items-baseline justify-between">
            <h3 className="text-xl md:text-2xl font-black text-amber-600">
              {isAdmin ? stats.activeCount : isTeacher ? stats.pendingGradingCount : stats.pendingCount}
            </h3>
            <span className="text-[11px] font-bold text-amber-600">{isTeacher ? 'Needs Review' : 'Pending'}</span>
          </div>
          <p className="text-[11px] text-slate-400">
            {isAdmin ? 'Currently open tasks' : isTeacher ? 'Awaiting marks entry' : 'Requires completion'}
          </p>
        </div>

        {/* Card 3 */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
            {isAdmin ? 'Total Submissions' : isTeacher ? 'Graded Submissions' : 'Completed / Submitted'}
          </p>
          <div className="flex items-baseline justify-between">
            <h3 className="text-xl md:text-2xl font-black text-emerald-600">
              {isAdmin ? stats.submittedCount : isTeacher ? stats.gradedCount : stats.submittedCount}
            </h3>
            <span className="text-[11px] font-bold text-emerald-600">Done</span>
          </div>
          <p className="text-[11px] text-slate-400">
            {isAdmin ? `${stats.gradedCount} marked` : isTeacher ? 'Evaluated & recorded' : 'Finished & submitted'}
          </p>
        </div>

        {/* Card 4 */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-rose-600">
            {isAdmin ? 'Due This Week' : isTeacher ? 'Due This Week' : 'Urgent Deadlines'}
          </p>
          <div className="flex items-baseline justify-between">
            <h3 className="text-xl md:text-2xl font-black text-rose-600">{stats.dueSoonCount}</h3>
            <span className="text-[11px] font-bold text-rose-600">Upcoming</span>
          </div>
          <p className="text-[11px] text-slate-400">Immediate attention</p>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {/* FILTERS & SEARCH CONTROLS                                                  */}
      {/* ─────────────────────────────────────────────────────────────────────────── */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search by topic, subject, instructions, or teacher..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full text-xs pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          />
        </div>

        {/* Dropdowns */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Class Filter (only for Teacher/Admin) */}
          {(isTeacher || isAdmin) && (
            <select
              value={selectedClassFilter}
              onChange={(e) => setSelectedClassFilter(e.target.value)}
              className="p-2.5 rounded-xl border border-slate-200 font-bold text-slate-700 bg-slate-50 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            >
              <option value="All">All Classes (Full School)</option>
              {isAdmin && <option value="All Classes">🌐 School-Wide (All Classes)</option>}
              {isTeacher && teacherScope.classes.length > 0
                ? teacherScope.classes.map((c) => (
                    <option key={c} value={c}>
                      Class {c}
                    </option>
                  ))
                : academicClasses.map((c) => (
                    <option key={c.id} value={c.name.replace(/^Class\s*/i, '')}>
                      Class {c.name.replace(/^Class\s*/i, '')}
                    </option>
                  ))}
            </select>
          )}

          {/* Section Filter (Teacher/Admin) */}
          {(isTeacher || isAdmin) && (
            <select
              value={selectedSectionFilter}
              onChange={(e) => setSelectedSectionFilter(e.target.value)}
              className="p-2.5 rounded-xl border border-slate-200 font-bold text-slate-700 bg-slate-50 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            >
              <option value="All">All Sections</option>
              {isTeacher && selectedClassFilter !== 'All' && teacherScope.sectionsByClass[selectedClassFilter]
                ? teacherScope.sectionsByClass[selectedClassFilter].map((s) => (
                    <option key={s} value={s}>
                      Section {s}
                    </option>
                  ))
                : (
                    <>
                      <option value="A">Section A</option>
                      <option value="B">Section B</option>
                      <option value="C">Section C</option>
                    </>
                  )}
            </select>
          )}

          {/* Subject Filter */}
          <select
            value={selectedSubjectFilter}
            onChange={(e) => setSelectedSubjectFilter(e.target.value)}
            className="p-2.5 rounded-xl border border-slate-200 font-bold text-indigo-700 bg-indigo-50/50 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          >
            <option value="All">All Subjects</option>
            {availableFilterSubjects.map((subj) => (
              <option key={subj} value={subj}>
                {subj}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="p-2.5 rounded-xl border border-slate-200 font-bold text-slate-700 bg-slate-50 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          >
            <option value="All">All Statuses</option>
            <option value="Active">Active</option>
            {isStudent || isParent ? (
              <>
                <option value="Pending">Pending To-Do</option>
                <option value="Submitted">Completed / Submitted</option>
              </>
            ) : null}
            <option value="Completed">Completed Archive</option>
          </select>

          {(searchTerm ||
            selectedClassFilter !== 'All' ||
            selectedSectionFilter !== 'All' ||
            selectedSubjectFilter !== 'All' ||
            statusFilter !== 'All') && (
            <button
              onClick={() => {
                setSearchTerm('');
                setSelectedClassFilter('All');
                setSelectedSectionFilter('All');
                setSelectedSubjectFilter('All');
                setStatusFilter('All');
              }}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold transition-all cursor-pointer"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {/* HOMEWORK LISTING CARDS                                                     */}
      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {/* Class Teacher Role Active Banner */}
      {isTeacher && isClassTeacher && (
        <div className="p-4 bg-gradient-to-r from-amber-500/10 via-indigo-500/10 to-violet-500/10 border border-indigo-200/90 rounded-2xl flex items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-600 text-white rounded-xl shadow-xs shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-xs font-black text-indigo-950">
                  Class Teacher Role Active
                </p>
                <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[10px] font-extrabold uppercase tracking-wide">
                  Full Class Visibility
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-0.5 font-medium">
                You are the designated Class Teacher for: <strong className="text-indigo-950 font-extrabold">{managedClasses.map((c) => c.name).join(', ')}</strong>. You can view all homework across every subject (Mathematics, English, Hindi, Science, etc.) for your class.
              </p>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="bg-white p-12 rounded-3xl border border-slate-200 text-center text-slate-400 font-semibold space-y-2">
          <BookOpen className="w-8 h-8 animate-pulse text-indigo-400 mx-auto" />
          <p className="text-sm">Loading homework assignments from database...</p>
        </div>
      ) : filteredHomework.length === 0 ? (
        <div className="bg-white p-12 rounded-3xl border border-dashed border-slate-200 text-center space-y-3">
          <BookOpen className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="text-base font-extrabold text-slate-800">No Homework Found</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            {isStudent
              ? 'No active homework assignments for your class right now. Enjoy your free time or check back later!'
              : isParent
              ? 'No homework assignments found for your child matching the selected filters.'
              : 'No homework assignments created matching the selected filters. Click "+ Assign Class Homework" to publish one.'}
          </p>
          {(isTeacher || isAdmin) && (
            <button
              type="button"
              onClick={openCreateModal}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-xs transition-all cursor-pointer inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" /> Assign First Homework
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredHomework.map((hw) => {
            const dueBadge = getDueBadge(hw.dueDate);
            const subjectStyle = getSubjectColor(hw.subjectName);

            // RBAC Permissions check for this homework item
            const isAssignedByMe = isTeacher && currentTeacher && (
              hw.teacherId === currentTeacher.id ||
              (hw.teacherName && (hw.teacherName.toLowerCase() === currentTeacher.name.toLowerCase() || hw.teacherName.toLowerCase() === (user?.name || '').toLowerCase()))
            );

            const isClassTeacherForHw = isTeacher && managedClasses.some((mc) => {
              const normMc = mc.name.replace(/^Class\s*/i, '').trim().toLowerCase();
              const normHw = hw.className.replace(/^Class\s*/i, '').trim().toLowerCase();
              return normMc === normHw;
            });

            const canEditOrDelete = isAdmin || isAssignedByMe;

            // Student/Parent submission check
            const targetStudentId = isStudent
              ? (currentStudent?.id || String(user?.id))
              : (activeChild?.id || (parentChildren[0]?.id));
            const studentSubmission = (hw.submissions || []).find(
              (s) =>
                String(s.student_id) === String(targetStudentId) ||
                (activeChild?.admissionNo && s.admission_no === activeChild.admissionNo)
            );
            const isCompleted = !!studentSubmission;

            // Collect attachments (from attachments array or legacy fallback)
            const attachmentsList: HomeworkAttachment[] =
              hw.attachments && hw.attachments.length > 0
                ? hw.attachments
                : hw.attachmentName
                ? [{ name: hw.attachmentName, url: hw.attachmentUrl || '', type: 'document' }]
                : [];

            return (
              <div
                key={hw.id}
                className="bg-white rounded-3xl border border-slate-200 shadow-xs hover:border-indigo-300 transition-all p-5 flex flex-col justify-between space-y-4"
              >
                {/* Card Top: Subject & Due Date Badges */}
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`px-2.5 py-1 rounded-xl text-xs font-black border ${subjectStyle}`}>
                        {hw.subjectName}
                      </span>
                      {hw.className &&
                      (hw.className.toLowerCase() === 'all' ||
                        hw.className.toLowerCase() === 'all classes' ||
                        hw.className.toLowerCase() === 'all-classes') ? (
                        <span className="px-2.5 py-1 rounded-xl text-xs font-black bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-2xs flex items-center gap-1">
                          <Globe2 className="w-3.5 h-3.5" />
                          <span>School-Wide (All Classes)</span>
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
                          Class {hw.className} {hw.sectionName ? `· Sec ${hw.sectionName}` : '· All Sections'}
                        </span>
                      )}
                      {hw.maxMarks > 0 && (
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-extrabold bg-slate-50 text-slate-600 border border-slate-200 flex items-center gap-1">
                          <Award className="w-3 h-3 text-indigo-600" /> Max: {hw.maxMarks} M
                        </span>
                      )}
                      {isTeacher && isClassTeacherForHw && !isAssignedByMe && (
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-extrabold bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-1 shadow-2xs">
                          <ShieldCheck className="w-3 h-3 text-amber-600" />
                          <span>Class Teacher View</span>
                        </span>
                      )}
                      {hw.teacherName && (
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-slate-50 text-slate-600 border border-slate-200">
                          By: {hw.teacherName}
                        </span>
                      )}
                    </div>

                    <span className={`px-2.5 py-1 rounded-xl text-[11px] font-bold border shrink-0 ${dueBadge.color}`}>
                      {dueBadge.text}
                    </span>
                  </div>

                  {/* Title & Teacher */}
                  <div>
                    <h3 className="text-base font-extrabold text-slate-900 leading-snug">{hw.title}</h3>
                    <p className="text-xs text-slate-400 font-medium mt-0.5 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      Assigned by: <span className="text-slate-700 font-semibold">{hw.teacherName || 'Faculty'}</span>
                      {hw.assignedDate && <span className="text-slate-400">· {hw.assignedDate}</span>}
                    </p>
                  </div>

                  {/* Instructions */}
                  <div className="bg-slate-50/70 p-3.5 rounded-2xl border border-slate-100 text-xs text-slate-700 font-medium leading-relaxed whitespace-pre-line">
                    {hw.description}
                  </div>

                  {/* Attached Worksheets & Files (Teacher uploaded) */}
                  {attachmentsList.length > 0 && (
                    <div className="space-y-1.5 pt-0.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                        <Paperclip className="w-3 h-3 text-indigo-600" />
                        <span>Attached Reference Materials ({attachmentsList.length})</span>
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {attachmentsList.map((att, idx) => {
                          const isImg = isImageAttachment(att);
                          return (
                            <div
                              key={idx}
                              onClick={() => {
                                if (isImg) setPreviewMedia(att);
                                else if (att.url) handleDownloadAttachment(att);
                              }}
                              className="p-2 rounded-xl bg-indigo-50/60 border border-indigo-100/90 hover:bg-indigo-100/60 transition cursor-pointer flex items-center justify-between gap-2 text-xs"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {isImg ? (
                                  <img
                                    src={att.url}
                                    alt={att.name}
                                    className="w-7 h-7 rounded-lg object-cover border border-indigo-200 shrink-0"
                                  />
                                ) : (
                                  <div className="w-7 h-7 rounded-lg bg-indigo-200/80 text-indigo-700 flex items-center justify-center shrink-0">
                                    <FileText className="w-3.5 h-3.5" />
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <p className="font-bold text-indigo-950 truncate text-[11px]">{att.name}</p>
                                  {att.size ? (
                                    <p className="text-[9px] text-indigo-600 font-semibold">{formatFileSize(att.size)}</p>
                                  ) : (
                                    <p className="text-[9px] text-indigo-600 font-semibold">{isImg ? 'Photo' : 'Document'}</p>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {isImg ? (
                                  <Eye className="w-3.5 h-3.5 text-indigo-600" />
                                ) : (
                                  <Download className="w-3.5 h-3.5 text-indigo-600" />
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Student/Parent Specific Completion Status Box */}
                  {(isStudent || isParent) && (
                    <div className="pt-1">
                      {isCompleted ? (
                        <div className="p-3.5 bg-emerald-50 rounded-2xl border border-emerald-200 space-y-2 text-xs">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="font-extrabold text-emerald-950">
                                    {isStudent ? 'Completed & Submitted' : `Completed by ${activeChild?.name || 'Child'}`}
                                  </p>
                                  {studentSubmission.submitted_by && (
                                    <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-emerald-200/80 text-emerald-900">
                                      {studentSubmission.submitted_by}
                                    </span>
                                  )}
                                </div>
                                {studentSubmission.submitted_at && (
                                  <p className="text-[11px] text-emerald-700 mt-0.5">
                                    Submitted on {new Date(studentSubmission.submitted_at).toLocaleDateString()}
                                  </p>
                                )}
                                {studentSubmission.submission_text && (
                                  <p className="text-[11px] text-emerald-800 italic mt-1 bg-white/70 p-2 rounded-xl border border-emerald-100">
                                    “{studentSubmission.submission_text}”
                                  </p>
                                )}
                              </div>
                            </div>
                            <span className="px-2 py-0.5 bg-emerald-600 text-white rounded-lg font-black text-[10px] shrink-0">
                              {studentSubmission.status || 'Submitted'}
                            </span>
                          </div>

                          {/* Student/Parent Attached Submissions (Notebook scans/photos) */}
                          {studentSubmission.attachments && studentSubmission.attachments.length > 0 && (
                            <div className="pt-2 border-t border-emerald-200/70 space-y-1.5">
                              <p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-800 flex items-center gap-1">
                                <Camera className="w-3 h-3 text-emerald-600" />
                                <span>Uploaded Homework Files / Photos ({studentSubmission.attachments.length})</span>
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {studentSubmission.attachments.map((att, i) => {
                                  const isImg = isImageAttachment(att);
                                  return (
                                    <div
                                      key={i}
                                      onClick={() => {
                                        if (isImg) setPreviewMedia(att);
                                        else handleDownloadAttachment(att);
                                      }}
                                      className="p-1.5 bg-white rounded-xl border border-emerald-200 hover:border-emerald-400 transition cursor-pointer flex items-center gap-1.5 text-[11px] text-slate-800 font-bold shadow-2xs"
                                    >
                                      {isImg ? (
                                        <img
                                          src={att.url}
                                          alt={att.name}
                                          className="w-6 h-6 rounded-md object-cover border border-slate-200 shrink-0"
                                        />
                                      ) : (
                                        <FileText className="w-4 h-4 text-emerald-600 shrink-0" />
                                      )}
                                      <span className="max-w-[120px] truncate">{att.name}</span>
                                      {isImg ? (
                                        <Eye className="w-3 h-3 text-emerald-600 shrink-0 ml-1" />
                                      ) : (
                                        <Download className="w-3 h-3 text-emerald-600 shrink-0 ml-1" />
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Grading Score & Feedback */}
                          {studentSubmission.marks_obtained !== null && studentSubmission.marks_obtained !== undefined && (
                            <div className="pt-2 border-t border-emerald-200 flex flex-wrap items-center gap-2 font-bold">
                              <span className="px-2.5 py-1 bg-emerald-200 text-emerald-950 rounded-lg font-black text-xs">
                                Score: {studentSubmission.marks_obtained} / {hw.maxMarks} Marks
                              </span>
                              {studentSubmission.teacher_feedback && (
                                <span className="text-emerald-900 text-xs font-semibold">
                                  Remark: “{studentSubmission.teacher_feedback}”
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 flex items-center justify-between gap-2 text-xs text-amber-900">
                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                            <span>
                              {isStudent ? (
                                <>
                                  Status: <strong>Pending Submission</strong>
                                </>
                              ) : (
                                <>
                                  Status: <strong>Not yet completed by {activeChild?.name || 'child'}</strong>
                                </>
                              )}
                            </span>
                          </div>

                          {/* Instant Submit Button for Students AND Parents */}
                          <button
                            type="button"
                            onClick={() => openSubmitModal(hw, activeChild)}
                            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-xl text-xs transition cursor-pointer shrink-0 shadow-2xs flex items-center gap-1.5"
                          >
                            <CheckSquare className="w-3.5 h-3.5" />
                            <span>{isStudent ? 'Mark Done' : `Submit for ${activeChild?.name || 'Child'}`}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Teacher/Admin Submissions Progress Counter */}
                  {(isTeacher || isAdmin) && (
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-bold flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-indigo-600" />
                        Submissions:
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-slate-800">
                          {(hw.submissions || []).length} Submitted
                        </span>
                        {(() => {
                          const subs = hw.submissions || [];
                          const graded = subs.filter(
                            (s) => s.marks_obtained !== null && s.marks_obtained !== undefined
                          ).length;
                          const pending = subs.length - graded;
                          if (subs.length === 0) return null;
                          return (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100">
                              {graded} Graded {pending > 0 ? `· ${pending} Need Review` : ''}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  )}
                </div>

                {/* Card Bottom: Actions */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5 text-slate-400 text-[11px] font-semibold">
                    <Calendar className="w-3.5 h-3.5" />
                    Deadline: <strong className="text-slate-700">{hw.dueDate}</strong>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* Student Action */}
                    {isStudent && !isCompleted && (
                      <button
                        type="button"
                        onClick={() => openSubmitModal(hw)}
                        className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                      >
                        <CheckSquare className="w-3.5 h-3.5" />
                        <span>Submit Homework</span>
                      </button>
                    )}

                    {/* Parent Action: Parents can submit homework on behalf of child */}
                    {isParent && !isCompleted && (
                      <button
                        type="button"
                        onClick={() => openSubmitModal(hw, activeChild)}
                        className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                        title="Submit homework with photos on behalf of your child"
                      >
                        <CheckSquare className="w-3.5 h-3.5" />
                        <span>Submit Child's Homework</span>
                      </button>
                    )}

                    {/* Teacher/Admin Actions */}
                    {(isTeacher || isAdmin) && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setViewingSubmissionsHw(hw);
                            setSubmissionTab('all');
                            setSubmissionSearch('');
                          }}
                          className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer flex items-center gap-1 text-xs ${
                            (hw.submissions || []).some(
                              (s) => s.marks_obtained === null || s.marks_obtained === undefined
                            )
                              ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs'
                              : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700'
                          }`}
                          title="View student submissions & enter marks"
                        >
                          <Users className="w-3.5 h-3.5" />
                          <span>
                            {isTeacher ? 'Submissions & Grading' : 'Who Submitted'} ({(hw.submissions || []).length})
                          </span>
                        </button>

                        {canEditOrDelete ? (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditModal(hw)}
                              className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-all cursor-pointer"
                              title="Edit Homework"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDeleteHomework(hw.id, hw.title)}
                              className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl font-bold flex items-center gap-1 transition-all text-xs cursor-pointer shadow-2xs"
                              title={isAdmin ? "Remove Homework (Admin)" : "Delete Homework"}
                            >
                              <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                              <span>{isAdmin ? 'Remove Homework' : 'Delete'}</span>
                            </button>
                          </>
                        ) : (
                          <div
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-500 bg-slate-100/90 border border-slate-200 rounded-lg cursor-default"
                            title={`Assigned by ${hw.teacherName || 'Subject Teacher'}. Only the assigning teacher or Administrator can edit/remove.`}
                          >
                            <Lock className="w-3 h-3 text-slate-400" />
                            <span>Assigned by {hw.teacherName || 'Teacher'}</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {/* MODAL 1: ASSIGN / EDIT HOMEWORK (WITH FILE & IMAGE UPLOAD)                 */}
      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-hidden">
          <div className="bg-white rounded-3xl max-w-lg w-full border border-slate-200/80 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[calc(100vh-2rem)] sm:max-h-[90vh]">
            {/* Modal Header */}
            <div className="px-5 py-4 sm:px-6 sm:py-4.5 bg-gradient-to-r from-indigo-600 via-indigo-600 to-violet-600 text-white flex items-center justify-between shrink-0 shadow-xs">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2.5 bg-white/15 backdrop-blur-xs rounded-xl shadow-inner shrink-0">
                  <BookOpen className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-extrabold text-base tracking-tight truncate">
                    {editingHomework ? 'Edit Class Homework' : 'Assign New Class Homework'}
                  </h3>
                  <p className="text-xs text-indigo-100/90 truncate mt-0.5">
                    {editingHomework
                      ? 'Update assignment details, worksheet attachments, and instructions'
                      : 'Publishes task and sends automatic notifications with attachments'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1.5 hover:bg-white/20 active:scale-95 text-white/80 hover:text-white rounded-xl transition cursor-pointer shrink-0 ml-2"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveHomework} className="flex flex-col flex-1 min-h-0">
              <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4 text-xs">
                {/* Teacher Scope Warning */}
                {isTeacher && !teacherScope.hasAssignments && (
                  <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-2.5 text-amber-800">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-extrabold text-xs">No Teaching Classes Assigned</p>
                      <p className="mt-0.5 text-[11px] text-amber-700 leading-relaxed">
                        You are not currently assigned to teach any classes or sections. Under school policy, only class-taking
                        teachers can assign homework.
                      </p>
                    </div>
                  </div>
                )}

                {isTeacher && teacherScope.hasAssignments && (
                  <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-2xl flex flex-wrap items-center justify-between gap-2 text-indigo-900">
                    <div className="flex items-center gap-1.5">
                      <div className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                        <Check className="w-3 h-3 text-indigo-600 shrink-0" />
                      </div>
                      <span className="text-xs font-bold">Authorized Classes:</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {teacherScope.classes.map((c) => (
                        <span
                          key={c}
                          className="text-[11px] font-extrabold text-indigo-700 bg-white px-2 py-0.5 rounded-lg border border-indigo-200/80 shadow-2xs"
                        >
                          Class {c}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Class & Section */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1.5">
                      Class <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={formClass}
                      onChange={(e) => handleFormClassChange(e.target.value)}
                      required
                      disabled={isTeacher && !teacherScope.hasAssignments}
                      className="w-full p-2.5 rounded-xl border border-slate-200 font-bold text-slate-800 bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400 transition"
                    >
                      {modalClassOptions.map((c) => (
                        <option key={c} value={c}>
                          {c === 'All Classes' ? '🌐 All Classes (School-wide)' : `Class ${c}`}
                        </option>
                      ))}
                      {modalClassOptions.length === 0 && <option value="">No Classes Assigned</option>}
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1.5">Section</label>
                    <select
                      value={formSection}
                      onChange={(e) => handleFormSectionChange(e.target.value)}
                      disabled={(isTeacher && !teacherScope.hasAssignments) || formClass === 'All Classes'}
                      className="w-full p-2.5 rounded-xl border border-slate-200 font-bold text-slate-800 bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400 transition"
                    >
                      {formClass === 'All Classes' ? (
                        <option value="All">All Sections (School-wide)</option>
                      ) : (
                        modalSectionOptions.map((sec) => (
                          <option key={sec} value={sec}>
                            {sec === 'All' ? 'All Sections' : `Section ${sec}`}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                </div>

                {formClass === 'All Classes' && (
                  <div className="p-3 bg-gradient-to-r from-violet-50 to-indigo-50 border border-indigo-200 rounded-2xl flex items-start gap-2.5 text-indigo-900 shadow-2xs">
                    <Globe2 className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <p className="font-extrabold text-indigo-950">School-Wide Broadcast Homework</p>
                      <p className="text-[11px] text-indigo-700 mt-0.5 leading-relaxed">
                        This homework assignment will be published to all classes and sections across the entire school.
                      </p>
                    </div>
                  </div>
                )}

                {/* Admin: Assigning Teacher Select */}
                {isAdmin && (
                  <div>
                    <label className="block font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <User className="w-3.5 h-3.5 text-indigo-600" /> Assigning Teacher
                      </span>
                      <span className="text-[10px] font-normal text-slate-400">Associates teacher with this homework</span>
                    </label>
                    <select
                      value={formTeacherId ?? ''}
                      onChange={(e) => {
                        const val = e.target.value ? Number(e.target.value) : null;
                        setFormTeacherId(val);
                        const matched = teacherList.find((t) => t.id === val);
                        if (matched) {
                          setFormTeacherName(matched.name);
                        } else {
                          setFormTeacherName(`Admin (${user?.name || 'Administrator'})`);
                        }
                      }}
                      className="w-full p-2.5 rounded-xl border border-slate-200 font-bold text-slate-800 bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 focus:outline-none transition text-xs"
                    >
                      <option value="">Default: School Admin ({user?.name || 'Admin'})</option>
                      {teacherList.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.email})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Subject & Max Marks */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1.5">
                      Subject <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={formSubject}
                      onChange={(e) => setFormSubject(e.target.value)}
                      required
                      disabled={isTeacher && !teacherScope.hasAssignments}
                      className="w-full p-2.5 rounded-xl border border-slate-200 font-bold text-slate-800 bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400 transition"
                    >
                      {modalSubjectOptions.map((subj) => (
                        <option key={subj} value={subj}>
                          {subj}
                        </option>
                      ))}
                      {modalSubjectOptions.length === 0 && <option value="">No Subjects</option>}
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1.5">Max Marks</label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={formMaxMarks}
                      onChange={(e) => setFormMaxMarks(Number(e.target.value))}
                      disabled={isTeacher && !teacherScope.hasAssignments}
                      className="w-full p-2.5 rounded-xl border border-slate-200 font-bold text-slate-800 bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 focus:outline-none disabled:bg-slate-100 transition"
                    />
                  </div>
                </div>

                {/* Homework Title */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1.5">
                    Homework Title <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Chapter 4 - Algebraic Expressions & Problem Set"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    required
                    className="w-full p-2.5 rounded-xl border border-slate-200 font-bold text-slate-800 bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 focus:outline-none transition placeholder:font-normal placeholder:text-slate-400"
                  />
                </div>

                {/* Due Date */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1.5">
                    Submission Due Date <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={formDueDate}
                    onChange={(e) => setFormDueDate(e.target.value)}
                    required
                    className="w-full p-2.5 rounded-xl border border-slate-200 font-bold text-slate-800 bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 focus:outline-none transition"
                  />
                </div>

                {/* Instructions / Description */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1.5">
                    Task Instructions & Questions <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Detail the questions to answer, textbook pages to read, or project guidelines..."
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    required
                    className="w-full p-2.5 rounded-xl border border-slate-200 font-medium text-slate-800 bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 focus:outline-none transition placeholder:text-slate-400 resize-none"
                  />
                </div>

                {/* FILE & IMAGE UPLOAD ZONE */}
                <div className="space-y-2 pt-1 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <label className="font-bold text-slate-700 flex items-center gap-1.5">
                      <Paperclip className="w-4 h-4 text-indigo-600" />
                      <span>Upload Worksheets, Question Papers, or Images</span>
                    </label>
                    <span className="text-[10px] text-slate-400 font-semibold">(Optional)</span>
                  </div>

                  {/* Drop zone */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        handleUploadFiles(Array.from(e.dataTransfer.files), 'form');
                      }
                    }}
                    onClick={() => formFileInputRef.current?.click()}
                    className="border-2 border-dashed border-indigo-200 hover:border-indigo-400 bg-indigo-50/30 hover:bg-indigo-50/70 rounded-2xl p-4 text-center transition cursor-pointer group"
                  >
                    <input
                      ref={formFileInputRef}
                      type="file"
                      multiple
                      accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          handleUploadFiles(Array.from(e.target.files), 'form');
                          e.target.value = '';
                        }
                      }}
                    />
                    <UploadCloud className="w-8 h-8 text-indigo-500 mx-auto mb-1.5 group-hover:scale-110 transition-transform" />
                    <p className="text-xs font-bold text-slate-800">
                      Click to browse or drag & drop files here
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Upload question papers, diagrams, photos of whiteboard, or worksheets (PDF, JPG, PNG, DOCX)
                    </p>
                  </div>

                  {/* Attached files chips */}
                  {formAttachments.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 px-1">
                        <span>Attached Files ({formAttachments.length})</span>
                        <button
                          type="button"
                          onClick={() => setFormAttachments([])}
                          className="text-rose-600 hover:underline text-[10px] font-semibold"
                        >
                          Clear All
                        </button>
                      </div>

                      <div className="space-y-1.5">
                        {formAttachments.map((att, idx) => {
                          const isImg = isImageAttachment(att);
                          return (
                            <div
                              key={idx}
                              className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200 text-xs gap-2"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {isImg ? (
                                  <img
                                    src={att.url}
                                    alt={att.name}
                                    className="w-8 h-8 rounded-lg object-cover border border-slate-200 shrink-0 cursor-pointer"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPreviewMedia(att);
                                    }}
                                  />
                                ) : (
                                  <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                                    <FileText className="w-4 h-4" />
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <p className="font-bold text-slate-800 truncate text-[11px]">{att.name}</p>
                                  <p className="text-[10px] text-slate-400">{formatFileSize(att.size)}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {isImg && (
                                  <button
                                    type="button"
                                    onClick={() => setPreviewMedia(att)}
                                    className="p-1 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-white transition cursor-pointer"
                                    title="Preview Image"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setFormAttachments((prev) => prev.filter((_, i) => i !== idx))}
                                  className="p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-white transition cursor-pointer"
                                  title="Remove File"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Notification Toggle */}
                {!editingHomework && (
                  <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Bell className="w-4 h-4 text-indigo-600" />
                      <div>
                        <p className="font-bold text-slate-800 text-xs">Notify Students & Parents</p>
                        <p className="text-[10px] text-slate-400">
                          Sends push notifications & updates to all class parents and students.
                        </p>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={notifyClass}
                      onChange={(e) => setNotifyClass(e.target.checked)}
                      className="w-4 h-4 text-indigo-600 rounded-sm focus:ring-indigo-500 cursor-pointer"
                    />
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="p-4 sm:px-6 bg-slate-50/90 backdrop-blur-xs border-t border-slate-100 flex items-center justify-end gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl font-bold transition-all active:scale-95 cursor-pointer shadow-2xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating || isUpdating || isProcessingUpload || (isTeacher && !teacherScope.hasAssignments)}
                  className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 active:scale-95 disabled:opacity-50 disabled:pointer-events-none text-white rounded-xl font-extrabold shadow-md shadow-indigo-500/20 transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Send className="w-4 h-4" />
                  <span>{editingHomework ? 'Update Homework' : 'Publish & Notify Class'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {/* MODAL 2: STUDENT & PARENT SUBMISSION (WITH PHOTO & FILE UPLOADER)          */}
      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {submitModalHw && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-hidden">
          <div className="bg-white rounded-3xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[calc(100vh-2rem)] sm:max-h-[90vh]">
            <div className="p-4 sm:p-5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white flex items-center justify-between shrink-0 shadow-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 bg-white/10 rounded-xl shrink-0">
                  <CheckSquare className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-extrabold text-base truncate">
                    {isParent ? "Submit Child's Homework" : 'Submit Class Homework'}
                  </h3>
                  <p className="text-xs text-emerald-100 truncate">
                    {submitModalHw.subjectName} · {submitModalHw.title}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSubmitModalHw(null)}
                className="p-1.5 hover:bg-white/20 active:scale-95 rounded-xl transition cursor-pointer text-white/80 hover:text-white shrink-0 ml-2"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitWork} className="flex flex-col flex-1 min-h-0">
              <div className="p-5 sm:p-6 space-y-4 text-xs flex-1 overflow-y-auto">
                {/* Parent Child Selector if multiple children */}
                {isParent && parentChildren.length > 1 && (
                  <div className="bg-emerald-50/70 p-3 rounded-2xl border border-emerald-200 space-y-1.5">
                    <label className="font-extrabold text-emerald-950 block">Submitting On Behalf Of:</label>
                    <div className="flex flex-wrap gap-2">
                      {parentChildren.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSubmitChildId(c.id)}
                          className={`px-3 py-1.5 rounded-xl font-bold text-xs transition cursor-pointer ${
                            (submitChildId || activeChild?.id) === c.id
                              ? 'bg-emerald-600 text-white shadow-xs'
                              : 'bg-white text-slate-700 border border-emerald-200 hover:bg-emerald-100'
                          }`}
                        >
                          {c.name} (Class {c.class}-{c.section})
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Submitting for single child banner */}
                {isParent && parentChildren.length <= 1 && (
                  <div className="bg-emerald-50/60 p-3 rounded-2xl border border-emerald-200 flex items-center justify-between text-emerald-900">
                    <span className="font-bold">Submitting on behalf of:</span>
                    <span className="font-black bg-white px-2.5 py-1 rounded-lg border border-emerald-200 text-xs">
                      {activeChild?.name || 'Your Child'} (Class {activeChild?.class}-{activeChild?.section})
                    </span>
                  </div>
                )}

                {/* Homework Task Instructions */}
                <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-1">
                  <p className="font-bold text-slate-500 uppercase text-[10px] tracking-wider">
                    Teacher Instructions:
                  </p>
                  <p className="text-slate-800 font-medium leading-relaxed whitespace-pre-line">
                    {submitModalHw.description}
                  </p>
                </div>

                {/* Completion remarks / notes */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1.5">
                    {isParent ? 'Parent Remarks / Completion Notes:' : 'Submission Notes / Student Remarks:'}
                  </label>
                  <textarea
                    rows={3}
                    placeholder={
                      isParent
                        ? 'e.g. Rahul has completed all 10 exercises on pages 45-48 in his notebook under my supervision. Attached photos of the work.'
                        : 'e.g. Completed all exercises in my science notebook. Attached photos of answers.'
                    }
                    value={submissionText}
                    onChange={(e) => setSubmissionText(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 font-medium text-slate-800 bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 focus:outline-none transition placeholder:text-slate-400 resize-none"
                  />
                </div>

                {/* NOTEBOOK PHOTO & FILE UPLOADER */}
                <div className="space-y-2 pt-1 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <label className="font-bold text-slate-700 flex items-center gap-1.5">
                      <Camera className="w-4 h-4 text-emerald-600" />
                      <span>Upload Notebook Photos / Scanned Homework</span>
                    </label>
                    <span className="text-[10px] text-slate-400 font-semibold">(Recommended)</span>
                  </div>

                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        handleUploadFiles(Array.from(e.dataTransfer.files), 'submit');
                      }
                    }}
                    onClick={() => submitFileInputRef.current?.click()}
                    className="border-2 border-dashed border-emerald-300 hover:border-emerald-500 bg-emerald-50/40 hover:bg-emerald-50/80 rounded-2xl p-4 text-center transition cursor-pointer group"
                  >
                    <input
                      ref={submitFileInputRef}
                      type="file"
                      multiple
                      accept="image/*,application/pdf,.doc,.docx"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          handleUploadFiles(Array.from(e.target.files), 'submit');
                          e.target.value = '';
                        }
                      }}
                    />
                    <Camera className="w-8 h-8 text-emerald-600 mx-auto mb-1.5 group-hover:scale-110 transition-transform" />
                    <p className="text-xs font-bold text-slate-800">
                      Take photos of notebook pages or click to upload
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      Upload clear photos of written homework, solved worksheets, or PDF scans (JPG, PNG, PDF)
                    </p>
                  </div>

                  {/* Attached submission files list */}
                  {submitAttachments.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 px-1">
                        <span>Attached Files ({submitAttachments.length})</span>
                        <button
                          type="button"
                          onClick={() => setSubmitAttachments([])}
                          className="text-rose-600 hover:underline text-[10px] font-semibold"
                        >
                          Clear
                        </button>
                      </div>

                      <div className="space-y-1.5">
                        {submitAttachments.map((att, idx) => {
                          const isImg = isImageAttachment(att);
                          return (
                            <div
                              key={idx}
                              className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200 text-xs gap-2"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {isImg ? (
                                  <img
                                    src={att.url}
                                    alt={att.name}
                                    className="w-8 h-8 rounded-lg object-cover border border-slate-200 shrink-0 cursor-pointer"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPreviewMedia(att);
                                    }}
                                  />
                                ) : (
                                  <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
                                    <FileText className="w-4 h-4" />
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <p className="font-bold text-slate-800 truncate text-[11px]">{att.name}</p>
                                  <p className="text-[10px] text-slate-400">{formatFileSize(att.size)}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {isImg && (
                                  <button
                                    type="button"
                                    onClick={() => setPreviewMedia(att)}
                                    className="p-1 text-slate-400 hover:text-emerald-600 rounded-lg hover:bg-white transition cursor-pointer"
                                    title="Preview Image"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setSubmitAttachments((prev) => prev.filter((_, i) => i !== idx))}
                                  className="p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-white transition cursor-pointer"
                                  title="Remove File"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="p-4 sm:px-6 bg-slate-50/90 backdrop-blur-xs border-t border-slate-100 flex items-center justify-end gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setSubmitModalHw(null)}
                  className="px-4 py-2.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl font-bold transition-all active:scale-95 cursor-pointer shadow-2xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || isProcessingUpload}
                  className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 active:scale-95 disabled:opacity-50 disabled:pointer-events-none text-white rounded-xl font-extrabold shadow-md shadow-emerald-500/20 transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>{isParent ? "Confirm & Submit for Child" : 'Confirm Completion'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {/* MODAL 3: TEACHER SUBMISSION TRACKER ("WHO ALL SUBMITTED") & GRADING        */}
      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {viewingSubmissionsHw && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-hidden">
          <div className="bg-white rounded-3xl max-w-3xl w-full border border-slate-200 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[calc(100vh-2rem)] sm:max-h-[90vh]">
            {/* Header */}
            <div className="p-4 sm:p-5 bg-gradient-to-r from-indigo-600 via-indigo-600 to-violet-600 text-white flex items-center justify-between shrink-0 shadow-xs">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2.5 bg-white/15 backdrop-blur-xs rounded-xl shadow-inner shrink-0">
                  <Users className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-extrabold text-base tracking-tight truncate">Class Homework Submissions Tracker</h3>
                  <p className="text-xs text-indigo-100/90 truncate">
                    {viewingSubmissionsHw.subjectName} · Class {viewingSubmissionsHw.className}{' '}
                    {viewingSubmissionsHw.sectionName ? `(${viewingSubmissionsHw.sectionName})` : ''} · "
                    {viewingSubmissionsHw.title}"
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 bg-white/20 backdrop-blur-xs text-white rounded-xl font-black text-xs shrink-0">
                  Max Marks: {viewingSubmissionsHw.maxMarks}
                </span>
                <button
                  type="button"
                  onClick={() => setViewingSubmissionsHw(null)}
                  className="p-1.5 hover:bg-white/20 active:scale-95 text-white/80 hover:text-white rounded-xl transition cursor-pointer shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Sub-header Filter Tabs & Search */}
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs shrink-0">
              {/* Tabs */}
              <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setSubmissionTab('all')}
                  className={`px-3 py-1.5 rounded-lg font-extrabold transition cursor-pointer ${
                    submissionTab === 'all' ? 'bg-indigo-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  All Students ({submissionRosterStats.total})
                </button>
                <button
                  type="button"
                  onClick={() => setSubmissionTab('submitted')}
                  className={`px-3 py-1.5 rounded-lg font-extrabold transition cursor-pointer flex items-center gap-1 ${
                    submissionTab === 'submitted'
                      ? 'bg-emerald-600 text-white shadow-2xs'
                      : 'text-emerald-700 hover:bg-emerald-50'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Submitted ({submissionRosterStats.submitted})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSubmissionTab('pending')}
                  className={`px-3 py-1.5 rounded-lg font-extrabold transition cursor-pointer flex items-center gap-1 ${
                    submissionTab === 'pending'
                      ? 'bg-amber-600 text-white shadow-2xs'
                      : 'text-amber-700 hover:bg-amber-50'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Pending ({submissionRosterStats.pending})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSubmissionTab('graded')}
                  className={`px-3 py-1.5 rounded-lg font-extrabold transition cursor-pointer flex items-center gap-1 ${
                    submissionTab === 'graded'
                      ? 'bg-violet-600 text-white shadow-2xs'
                      : 'text-violet-700 hover:bg-violet-50'
                  }`}
                >
                  <Award className="w-3.5 h-3.5" />
                  <span>Graded ({submissionRosterStats.graded})</span>
                </button>
              </div>

              {/* Search */}
              <div className="relative flex-1 sm:max-w-xs">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Search student or roll no..."
                  value={submissionSearch}
                  onChange={(e) => setSubmissionSearch(e.target.value)}
                  className="w-full text-xs pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Scrollable Submissions List */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-3.5 text-xs flex-1">
              {filteredSubmissionsRoster.length === 0 ? (
                <div className="p-10 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-400 space-y-1">
                  <Users className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                  <p className="font-bold text-slate-700 text-sm">No students match this view</p>
                  <p className="text-xs text-slate-400">
                    Try switching tabs or clearing your search query.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredSubmissionsRoster.map((item) => {
                    const sub = item.submission;
                    const hasSub = !!sub;
                    const isGraded = sub?.marks_obtained !== null && sub?.marks_obtained !== undefined;

                    return (
                      <div
                        key={item.studentId}
                        className={`p-4 rounded-2xl border transition-all space-y-3 ${
                          hasSub
                            ? 'border-emerald-200/90 bg-emerald-50/20 hover:border-emerald-300'
                            : 'border-slate-200 bg-white hover:border-amber-300'
                        }`}
                      >
                        {/* Student Row Header */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-3 min-w-0">
                            {/* Avatar */}
                            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white font-black text-sm shrink-0 shadow-2xs">
                              {item.studentName.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="font-extrabold text-slate-900 text-sm truncate">
                                  {item.studentName}
                                </h4>
                                {item.rollNo && (
                                  <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-extrabold text-[10px]">
                                    Roll #{item.rollNo}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-400 mt-0.5">
                                {item.admissionNo ? `Adm: ${item.admissionNo} · ` : ''}
                                Class {item.className || viewingSubmissionsHw.className}
                                {item.sectionName ? `-${item.sectionName}` : ''}
                                {item.parentName ? ` · Parent: ${item.parentName}` : ''}
                              </p>
                            </div>
                          </div>

                          {/* Status Badge */}
                          <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                            {hasSub ? (
                              <div className="flex items-center gap-1.5">
                                {sub.submitted_by && (
                                  <span className="px-2.5 py-1 rounded-xl bg-violet-100 text-violet-800 font-extrabold text-[10px] border border-violet-200">
                                    {sub.submitted_by}
                                  </span>
                                )}
                                <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-xl font-extrabold text-[11px] border border-emerald-200 flex items-center gap-1">
                                  <Check className="w-3 h-3 text-emerald-600" />
                                  <span>{isGraded ? 'Graded' : 'Submitted'}</span>
                                </span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className="px-2.5 py-1 bg-amber-50 text-amber-800 rounded-xl font-extrabold text-[11px] border border-amber-200 flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-amber-600" />
                                  <span>Not Submitted</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleSendReminder(item.studentName, item.parentName, item.studentId)}
                                  disabled={reminderSentMap[item.studentId]}
                                  className={`px-2.5 py-1 rounded-xl font-extrabold text-[11px] transition cursor-pointer flex items-center gap-1 ${
                                    reminderSentMap[item.studentId]
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200'
                                  }`}
                                  title="Send push notification reminder to student & parents"
                                >
                                  <Bell className="w-3 h-3" />
                                  <span>{reminderSentMap[item.studentId] ? 'Reminder Sent' : 'Remind'}</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Submission Details & Attached Photos */}
                        {hasSub && (
                          <div className="space-y-2 pt-2 border-t border-slate-200/60">
                            {sub.submitted_at && (
                              <p className="text-[10px] text-slate-400 font-semibold">
                                Submitted on: {new Date(sub.submitted_at).toLocaleString()}
                              </p>
                            )}

                            {sub.submission_text && (
                              <div className="bg-white p-2.5 rounded-xl border border-slate-200 text-slate-800 italic leading-relaxed text-[11px]">
                                “{sub.submission_text}”
                              </div>
                            )}

                            {/* Attached notebook photos / scanned files */}
                            {sub.attachments && sub.attachments.length > 0 && (
                              <div className="space-y-1.5 pt-1">
                                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                                  <Camera className="w-3 h-3 text-emerald-600" />
                                  <span>Student Notebook Photos & Files ({sub.attachments.length}):</span>
                                </p>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                  {sub.attachments.map((att, attIdx) => {
                                    const isImg = isImageAttachment(att);
                                    return (
                                      <div
                                        key={attIdx}
                                        onClick={() => {
                                          if (isImg) setPreviewMedia(att);
                                          else handleDownloadAttachment(att);
                                        }}
                                        className="p-2 rounded-xl bg-white border border-slate-200 hover:border-indigo-400 transition cursor-pointer flex items-center justify-between gap-1.5 shadow-2xs group"
                                      >
                                        <div className="flex items-center gap-2 min-w-0">
                                          {isImg ? (
                                            <img
                                              src={att.url}
                                              alt={att.name}
                                              className="w-8 h-8 rounded-lg object-cover border border-slate-200 shrink-0 group-hover:scale-105 transition-transform"
                                            />
                                          ) : (
                                            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                                              <FileText className="w-4 h-4" />
                                            </div>
                                          )}
                                          <div className="min-w-0">
                                            <p className="font-extrabold text-slate-900 truncate text-[11px]">{att.name}</p>
                                            <p className="text-[9px] text-slate-400">{formatFileSize(att.size)}</p>
                                          </div>
                                        </div>
                                        {isImg ? (
                                          <Eye className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                                        ) : (
                                          <Download className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Inline Grading Form */}
                            <div className="pt-2.5 border-t border-slate-200/80 flex flex-wrap items-center gap-2">
                              <div className="flex items-center gap-1.5">
                                <label className="font-bold text-slate-600 text-[11px]">Marks:</label>
                                <input
                                  type="number"
                                  min="0"
                                  max={viewingSubmissionsHw.maxMarks}
                                  placeholder={`/ ${viewingSubmissionsHw.maxMarks}`}
                                  defaultValue={
                                    sub.marks_obtained !== null && sub.marks_obtained !== undefined
                                      ? sub.marks_obtained
                                      : ''
                                  }
                                  id={`grade-marks-${item.studentId}`}
                                  className="w-20 p-2 rounded-xl border border-slate-200 font-extrabold text-center bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                />
                              </div>

                              <input
                                type="text"
                                placeholder="Teacher feedback (e.g. Excellent work, neat handwriting)..."
                                defaultValue={sub.teacher_feedback || ''}
                                id={`grade-feedback-${item.studentId}`}
                                className="flex-1 min-w-[180px] p-2 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none text-xs"
                              />

                              <button
                                type="button"
                                onClick={() => {
                                  const marksInput = document.getElementById(
                                    `grade-marks-${item.studentId}`
                                  ) as HTMLInputElement;
                                  const feedbackInput = document.getElementById(
                                    `grade-feedback-${item.studentId}`
                                  ) as HTMLInputElement;
                                  const marksVal = Number(marksInput?.value || 0);
                                  const feedbackVal = feedbackInput?.value || '';
                                  handleSaveGrade(viewingSubmissionsHw.id, item.studentId, marksVal, feedbackVal);
                                }}
                                disabled={isGrading}
                                className={`px-3.5 py-2 rounded-xl font-bold transition cursor-pointer flex items-center gap-1 shadow-2xs ${
                                  justGradedStudentId === item.studentId
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                                }`}
                              >
                                {justGradedStudentId === item.studentId ? (
                                  <>
                                    <Check className="w-3.5 h-3.5" />
                                    <span>Saved!</span>
                                  </>
                                ) : (
                                  <>
                                    <Award className="w-3.5 h-3.5" />
                                    <span>Save Grade</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
              <span className="text-xs text-slate-500 font-bold">
                Showing {filteredSubmissionsRoster.length} of {fullSubmissionsRoster.length} students enrolled
              </span>
              <button
                type="button"
                onClick={() => setViewingSubmissionsHw(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl font-bold text-xs transition cursor-pointer"
              >
                Done / Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {/* LIGHTBOX MODAL: FULL RESOLUTION PREVIEW OF IMAGES & ATTACHMENTS            */}
      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {previewMedia && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setPreviewMedia(null)}
        >
          <div
            className="bg-slate-900 border border-slate-800 rounded-3xl max-w-4xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Lightbox Header */}
            <div className="p-4 bg-slate-950/60 border-b border-slate-800 flex items-center justify-between text-white shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <ImageIcon className="w-5 h-5 text-indigo-400 shrink-0" />
                <div className="min-w-0">
                  <p className="font-extrabold text-sm truncate">{previewMedia.name}</p>
                  <p className="text-[11px] text-slate-400">
                    {formatFileSize(previewMedia.size) || 'Attachment Preview'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleDownloadAttachment(previewMedia)}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMedia(null)}
                  className="p-1.5 hover:bg-white/10 rounded-xl text-slate-400 hover:text-white transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Lightbox Body */}
            <div className="p-4 flex-1 flex items-center justify-center overflow-auto bg-slate-950/40 min-h-[300px]">
              {isImageAttachment(previewMedia) ? (
                <img
                  src={previewMedia.url}
                  alt={previewMedia.name}
                  className="max-h-[75vh] max-w-full rounded-2xl object-contain shadow-2xl border border-slate-800"
                />
              ) : (
                <div className="p-10 text-center space-y-3">
                  <FileText className="w-16 h-16 text-indigo-400 mx-auto" />
                  <p className="font-bold text-slate-200 text-base">{previewMedia.name}</p>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    This document format cannot be rendered inline. Click below to download and view.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleDownloadAttachment(previewMedia)}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs inline-flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" /> Download File
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
