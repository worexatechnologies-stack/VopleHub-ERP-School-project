import React, { useState, useEffect, useMemo } from 'react';
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
} from '../store/api/homeworkApi';
import { useGetTeachersQuery, TeacherRecord } from '../store/api/teacherApi';
import { loadAcademicStructure, AcademicClass, AcademicSection, AcademicSubject } from '../services/academicStructure';
import { emitNotification } from '../services/notificationBus';

interface HomeworkModuleProps {
  user: AuthUser | null;
  students?: Student[];
  onNavigateToTab?: (tab: string) => void;
}

export default function HomeworkModule({ user, students = [], onNavigateToTab }: HomeworkModuleProps) {
  const userRole = user?.role || 'Student';
  const isTeacher = userRole === 'Teacher';
  const isStudent = userRole === 'Student';
  const isParent = userRole === 'Parent';
  const isAdmin = userRole === 'School Admin' || userRole === 'Super Admin';

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
      const matched = students.filter((s) => idSet.has(String(s.id)) || idSet.has(s.admissionNo));
      if (matched.length > 0) return matched;
    }
    // Fallback: match by email or name
    if (user?.email) {
      const byEmail = students.filter((s) => s.parentEmail && s.parentEmail.toLowerCase() === user.email.toLowerCase());
      if (byEmail.length > 0) return byEmail;
    }
    return students.slice(0, 2);
  }, [isParent, user, students]);

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
      const found = students.find((s) => s.id === user.studentId || s.admissionNo === user.studentId);
      if (found) return found;
    }
    if (user?.email) {
      const found = students.find((s) => s.parentEmail?.toLowerCase() === user.email.toLowerCase() || s.name.toLowerCase() === (user.name || '').toLowerCase());
      if (found) return found;
    }
    return students[0] || null;
  }, [isStudent, user, students]);

  // RTK Query: Fetch Homework
  const { data: rawHomeworkData = [], isLoading, refetch } = useGetHomeworkQuery();
  const homeworkList = useMemo<HomeworkRecord[]>(() => {
    return Array.isArray(rawHomeworkData) ? rawHomeworkData : (rawHomeworkData as any)?.results || [];
  }, [rawHomeworkData]);

  const [createHomework, { isLoading: isCreating }] = useCreateHomeworkMutation();
  const [updateHomework, { isLoading: isUpdating }] = useUpdateHomeworkMutation();
  const [deleteHomework] = useDeleteHomeworkMutation();
  const [submitHomework, { isLoading: isSubmitting }] = useSubmitHomeworkMutation();
  const [gradeSubmission, { isLoading: isGrading }] = useGradeSubmissionMutation();

  // Teacher Assignments & Scope (when logged in as Teacher)
  const { data: teachersData = [] } = useGetTeachersQuery(undefined, { skip: !isTeacher });
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

    // 1. Structured teaching assignments
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

    // 2. Assigned sections
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
  const [submissionText, setSubmissionText] = useState('');

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
    setIsCreateModalOpen(true);
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

    try {
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
            attachmentName: formAttachmentName.trim(),
            attachmentUrl: formAttachmentUrl.trim(),
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
          attachmentName: formAttachmentName.trim(),
          attachmentUrl: formAttachmentUrl.trim(),
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
    if (!confirm(`Are you sure you want to delete homework "${title}"?`)) return;
    try {
      await deleteHomework(id).unwrap();
      emitNotification({
        title: 'Homework Deleted',
        message: `Removed homework "${title}".`,
        tone: 'warning',
        source: 'academics',
      });
      refetch();
    } catch (err) {
      console.error('Failed to delete homework:', err);
      alert('Failed to delete homework.');
    }
  };

  // Submit Homework (Student or Parent on behalf of child)
  const handleSubmitWork = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!submitModalHw) return;

    const studentIdToUse = isStudent
      ? (currentStudent?.id || String(user?.id) || 'student-1')
      : (activeChild?.id || 'child-1');
    const studentNameToUse = isStudent
      ? (currentStudent?.name || user?.name || 'Student')
      : (activeChild?.name || 'Ward');
    const admissionNoToUse = isStudent
      ? (currentStudent?.admissionNo || '')
      : (activeChild?.admissionNo || '');

    try {
      await submitHomework({
        homeworkId: submitModalHw.id,
        studentId: studentIdToUse,
        studentName: studentNameToUse,
        admissionNo: admissionNoToUse,
        submissionText: submissionText.trim() || 'Completed tasks as assigned.',
      }).unwrap();

      emitNotification({
        title: 'Homework Submitted',
        message: `Marked "${submitModalHw.title}" as completed! Teacher has been notified.`,
        tone: 'success',
        source: 'academics',
      });

      setSubmitModalHw(null);
      setSubmissionText('');
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

  const handleSaveGrade = async (homeworkId: number) => {
    if (!gradeStudentId) return;
    try {
      await gradeSubmission({
        homeworkId,
        studentId: gradeStudentId,
        marksObtained: gradeMarks,
        teacherFeedback: gradeFeedback.trim(),
      }).unwrap();

      emitNotification({
        title: 'Submission Graded',
        message: `Awarded ${gradeMarks} marks to student.`,
        tone: 'success',
        source: 'academics',
      });

      setGradeStudentId('');
      setGradeFeedback('');
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

  // Filtered Homework List
  const filteredHomework = useMemo(() => {
    return homeworkList.filter((hw) => {
      // 1. Role-specific filtering
      if (isStudent) {
        // Backend /api/v1/homework/ is already strictly scoped to the authenticated student's class and section.
        // We do not drop items here so that network delays in students[] prop never blank out homework.
      } else if (isParent) {
        // If parent has selected a specific ward, filter by that ward's class and section (or school-wide homework)
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
        const isSub = (hw.submissions || []).some((s) => String(s.student_id) === String(targetStudentId));
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
        const isSub = submissions.some((s) => String(s.student_id) === String(targetStudentId));
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

  // Subject Color Themes
  const getSubjectColor = (subject: string) => {
    const sub = subject.toLowerCase();
    if (sub.includes('math')) return 'bg-blue-50 text-blue-700 border-blue-200';
    if (sub.includes('sci')) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (sub.includes('eng')) return 'bg-purple-50 text-purple-700 border-purple-200';
    if (sub.includes('soc') || sub.includes('hist') || sub.includes('geo')) return 'bg-amber-50 text-amber-700 border-amber-200';
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
                {isStudent ? 'Student Homework Desk' : isParent ? 'Parent Ward Monitor' : isTeacher ? 'Teacher Assignment Desk' : 'Academic Homework'}
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
                ? `Stay updated on homework deadlines and review teacher instructions for ${activeChild?.name || 'your child'}.`
                : 'Assign daily class homework, set submission due dates, and automatically notify students & parents.'}
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
                    activeChild?.id === c.id ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
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
              You do not have any classes or sections currently assigned to your teacher profile. School policy requires that homework can only be assigned by teachers assigned to those specific classes. Please contact your School Administrator to update your teaching schedule.
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
            {isAdmin ? 'School Homeworks' : isTeacher ? 'My Class Tasks' : isStudent ? 'Assigned Tasks' : `${activeChild?.name || 'Ward'} Tasks`}
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
            <span className="text-[11px] font-bold text-amber-600">
              {isTeacher ? 'Needs Review' : 'Pending'}
            </span>
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
            <option value="English">English</option>
            <option value="Mathematics">Mathematics</option>
            <option value="Science">Science</option>
            <option value="Social Studies">Social Studies</option>
            <option value="Hindi">Hindi</option>
            <option value="Computer Science">Computer Science</option>
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

          {(searchTerm || selectedClassFilter !== 'All' || selectedSectionFilter !== 'All' || selectedSubjectFilter !== 'All' || statusFilter !== 'All') && (
            <button
              onClick={() => {
                setSearchTerm('');
                setSelectedClassFilter('All');
                setSelectedSectionFilter('All');
                setSelectedSubjectFilter('All');
                setStatusFilter('All');
              }}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold transition-all"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {/* HOMEWORK LISTING CARDS                                                     */}
      {/* ─────────────────────────────────────────────────────────────────────────── */}
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

            // Student/Parent submission check
            const targetStudentId = isStudent ? (currentStudent?.id || String(user?.id)) : activeChild?.id;
            const studentSubmission = (hw.submissions || []).find((s) => String(s.student_id) === String(targetStudentId));
            const isCompleted = !!studentSubmission;

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
                      {hw.className && (hw.className.toLowerCase() === 'all' || hw.className.toLowerCase() === 'all classes' || hw.className.toLowerCase() === 'all-classes') ? (
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
                  <div className="bg-slate-50/70 p-3.5 rounded-2xl border border-slate-100 text-xs text-slate-700 font-medium leading-relaxed">
                    {hw.description}
                  </div>

                  {/* Attachment if present */}
                  {hw.attachmentName && (
                    <div className="flex items-center gap-2 p-2 bg-indigo-50/50 rounded-xl border border-indigo-100 text-xs text-indigo-900">
                      <Paperclip className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                      <span className="font-bold truncate">{hw.attachmentName}</span>
                      <span className="text-[10px] bg-indigo-200/60 text-indigo-800 px-1.5 py-0.5 rounded font-black ml-auto">
                        Attachment
                      </span>
                    </div>
                  )}

                  {/* Student/Parent Specific Completion Status Box */}
                  {(isStudent || isParent) && (
                    <div className="pt-1">
                      {isCompleted ? (
                        <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-200 flex items-start justify-between gap-2 text-xs">
                          <div className="flex items-start gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-extrabold text-emerald-900">
                                {isStudent ? 'Completed & Submitted' : `Completed by ${activeChild?.name}`}
                              </p>
                              {studentSubmission.submitted_at && (
                                <p className="text-[11px] text-emerald-700">
                                  Submitted on {new Date(studentSubmission.submitted_at).toLocaleDateString()}
                                </p>
                              )}
                              {studentSubmission.submission_text && (
                                <p className="text-[11px] text-emerald-800 italic mt-0.5">
                                  “{studentSubmission.submission_text}”
                                </p>
                              )}
                              {studentSubmission.marks_obtained !== null && studentSubmission.marks_obtained !== undefined && (
                                <div className="mt-1.5 pt-1 border-t border-emerald-200 flex items-center gap-2 font-bold">
                                  <span className="px-2 py-0.5 bg-emerald-200 text-emerald-900 rounded font-black text-[10px]">
                                    Score: {studentSubmission.marks_obtained} / {hw.maxMarks}
                                  </span>
                                  {studentSubmission.teacher_feedback && (
                                    <span className="text-emerald-800 text-[11px]">
                                      Teacher remarks: {studentSubmission.teacher_feedback}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
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
                                  Status: <strong>Not yet completed by {activeChild?.name}</strong>
                                </>
                              )}
                            </span>
                          </div>
                          {isStudent && (
                            <button
                              type="button"
                              onClick={() => {
                                setSubmitModalHw(hw);
                                setSubmissionText('');
                              }}
                              className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-lg text-xs transition cursor-pointer shrink-0"
                            >
                              Mark Done
                            </button>
                          )}
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
                          const graded = subs.filter((s) => s.marks_obtained !== null && s.marks_obtained !== undefined).length;
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
                        onClick={() => {
                          setSubmitModalHw(hw);
                          setSubmissionText('');
                        }}
                        className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                      >
                        <CheckSquare className="w-3.5 h-3.5" />
                        <span>Submit Homework</span>
                      </button>
                    )}

                    {/* Teacher/Admin Actions */}
                    {(isTeacher || isAdmin) && (
                      <>
                        <button
                          type="button"
                          onClick={() => setViewingSubmissionsHw(hw)}
                          className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer flex items-center gap-1 text-xs ${
                            (hw.submissions || []).some((s) => s.marks_obtained === null || s.marks_obtained === undefined)
                              ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs'
                              : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700'
                          }`}
                          title="View student submissions & enter marks"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>
                            {isTeacher ? 'Grade Submissions' : 'Review Submissions'} ({(hw.submissions || []).length})
                          </span>
                        </button>

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
                          className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg transition-all cursor-pointer"
                          title="Delete Homework"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
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
      {/* MODAL 1: ASSIGN / EDIT HOMEWORK (TEACHER & ADMIN)                          */}
      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-white/10 rounded-xl">
                  <BookOpen className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base">
                    {editingHomework ? 'Edit Class Homework' : 'Assign New Class Homework'}
                  </h3>
                  <p className="text-xs text-indigo-100 mt-0.5">
                    {editingHomework
                      ? 'Update assignment details and instructions'
                      : 'Publishes task and sends automatic notifications to students & parents'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1.5 hover:bg-white/20 rounded-xl transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveHomework} className="p-6 space-y-4 text-xs">
              {/* Teacher Scope Warning / Status */}
              {isTeacher && !teacherScope.hasAssignments && (
                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-2.5 text-amber-800">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-extrabold text-xs">No Teaching Classes Assigned</p>
                    <p className="mt-0.5 text-[11px] text-amber-700 leading-relaxed">
                      You are not currently assigned to teach any classes or sections. Under school policy, only class-taking teachers can assign homework for their classes. Please contact the administrator to assign your class schedule.
                    </p>
                  </div>
                </div>
              )}

              {isTeacher && teacherScope.hasAssignments && (
                <div className="p-2.5 bg-indigo-50/70 border border-indigo-100 rounded-xl flex items-center justify-between text-indigo-900">
                  <div className="flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                    <span className="text-[11px] font-bold">Authorized Teaching Classes:</span>
                  </div>
                  <span className="text-[11px] font-extrabold text-indigo-700 bg-white px-2 py-0.5 rounded-lg border border-indigo-200">
                    {teacherScope.classes.map((c) => `Class ${c}`).join(', ')}
                  </span>
                </div>
              )}

              {/* Class & Section Row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Target Class *</label>
                  <select
                    value={formClass}
                    onChange={(e) => handleFormClassChange(e.target.value)}
                    required
                    disabled={isTeacher && !teacherScope.hasAssignments}
                    className="w-full p-2.5 rounded-xl border border-slate-200 font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    {modalClassOptions.map((c) => (
                      <option key={c} value={c}>
                        {c === 'All Classes' ? '🌐 All Classes (School-wide)' : `Class ${c}`}
                      </option>
                    ))}
                    {modalClassOptions.length === 0 && (
                      <option value="">No Classes Assigned</option>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Section</label>
                  <select
                    value={formSection}
                    onChange={(e) => handleFormSectionChange(e.target.value)}
                    disabled={(isTeacher && !teacherScope.hasAssignments) || formClass === 'All Classes'}
                    className="w-full p-2.5 rounded-xl border border-slate-200 font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
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
                      This homework assignment will be published to all classes and sections across the entire school. All students and parents will receive instant notifications.
                    </p>
                  </div>
                </div>
              )}

              {/* Subject & Max Marks */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Subject *</label>
                  <select
                    value={formSubject}
                    onChange={(e) => setFormSubject(e.target.value)}
                    required
                    disabled={isTeacher && !teacherScope.hasAssignments}
                    className="w-full p-2.5 rounded-xl border border-slate-200 font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    {modalSubjectOptions.map((subj) => (
                      <option key={subj} value={subj}>
                        {subj}
                      </option>
                    ))}
                    {modalSubjectOptions.length === 0 && (
                      <option value="">No Subjects</option>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Max Marks</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={formMaxMarks}
                    onChange={(e) => setFormMaxMarks(Number(e.target.value))}
                    disabled={isTeacher && !teacherScope.hasAssignments}
                    className="w-full p-2.5 rounded-xl border border-slate-200 font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:bg-slate-100"
                  />
                </div>
              </div>

              {/* Homework Title */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">Homework Title *</label>
                <input
                  type="text"
                  placeholder="e.g. Chapter 4 - Algebraic Expressions & Problem Set"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  required
                  className="w-full p-2.5 rounded-xl border border-slate-200 font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              {/* Due Date */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">Submission Due Date *</label>
                <input
                  type="date"
                  value={formDueDate}
                  onChange={(e) => setFormDueDate(e.target.value)}
                  required
                  className="w-full p-2.5 rounded-xl border border-slate-200 font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              {/* Instructions / Description */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">Task Instructions & Questions *</label>
                <textarea
                  rows={3}
                  placeholder="Detail the questions to answer, textbook pages to read, or project guidelines..."
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  required
                  className="w-full p-2.5 rounded-xl border border-slate-200 font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              {/* Optional Attachment Link */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">Worksheet / Reference Document Name (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Math_Worksheet_Unit4.pdf"
                  value={formAttachmentName}
                  onChange={(e) => setFormAttachmentName(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              {/* Notification Banner */}
              <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl flex items-center gap-2 text-indigo-900">
                <Bell className="w-4 h-4 text-indigo-600 shrink-0" />
                <span className="text-[11px]">
                  <strong>Automatic Notifications:</strong>{' '}
                  {formClass === 'All Classes'
                    ? 'All enrolled students and their registered parents in every class across the school will receive an instant notification in their portal.'
                    : `All enrolled students and their registered parents in Class ${formClass} will receive an instant notification in their portal.`}
                </span>
              </div>

              {/* Modal Buttons */}
              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating || isUpdating || (isTeacher && !teacherScope.hasAssignments)}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-extrabold shadow-sm transition cursor-pointer flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{editingHomework ? 'Update Homework' : 'Publish & Notify Class'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {/* MODAL 2: STUDENT SUBMIT / MARK DONE                                       */}
      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {submitModalHw && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-white/10 rounded-xl">
                  <CheckSquare className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base">Submit Class Homework</h3>
                  <p className="text-xs text-emerald-100">{submitModalHw.subjectName} · {submitModalHw.title}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSubmitModalHw(null)}
                className="p-1.5 hover:bg-white/20 rounded-xl transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitWork} className="p-6 space-y-4 text-xs">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1">
                <p className="font-bold text-slate-500 uppercase text-[10px]">Homework Instructions:</p>
                <p className="text-slate-800 font-medium">{submitModalHw.description}</p>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Submission Notes / Completion Remarks:
                </label>
                <textarea
                  rows={3}
                  placeholder="e.g. Completed all exercises in my science notebook. Attached sheet is with class representative."
                  value={submissionText}
                  onChange={(e) => setSubmissionText(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 font-medium text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSubmitModalHw(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl font-extrabold shadow-sm transition cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Confirm Completion</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {/* MODAL 3: TEACHER REVIEW & GRADE SUBMISSIONS                                */}
      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {viewingSubmissionsHw && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full border border-slate-200 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div className="p-5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-white/10 rounded-xl">
                  <Users className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base">Student Submissions Review</h3>
                  <p className="text-xs text-indigo-100">
                    {viewingSubmissionsHw.subjectName} · Class {viewingSubmissionsHw.className} ({viewingSubmissionsHw.title})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingSubmissionsHw(null)}
                className="p-1.5 hover:bg-white/20 rounded-xl transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <span className="font-extrabold text-slate-800 text-sm">
                  Submissions Received ({(viewingSubmissionsHw.submissions || []).length})
                </span>
                <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg font-bold">
                  Max Marks: {viewingSubmissionsHw.maxMarks}
                </span>
              </div>

              {(viewingSubmissionsHw.submissions || []).length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-400">
                  No students have marked this homework as completed yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {(viewingSubmissionsHw.submissions || []).map((sub) => {
                    return (
                      <div
                        key={sub.student_id}
                        className="p-4 rounded-2xl border border-slate-200 bg-slate-50/60 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="font-extrabold text-slate-900 text-sm">{sub.student_name}</h4>
                            <p className="text-[11px] text-slate-400">
                              {sub.admission_no ? `Adm: ${sub.admission_no}` : `ID: ${sub.student_id}`} · Submitted on{' '}
                              {new Date(sub.submitted_at).toLocaleDateString()}
                            </p>
                          </div>
                          <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-lg font-black text-[11px]">
                            {sub.status}
                          </span>
                        </div>

                        {sub.submission_text && (
                          <div className="bg-white p-2.5 rounded-xl border border-slate-200 text-slate-700 italic">
                            “{sub.submission_text}”
                          </div>
                        )}

                        {/* Grading Form */}
                        <div className="pt-2 border-t border-slate-200/60 flex flex-wrap items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            max={viewingSubmissionsHw.maxMarks}
                            placeholder="Marks"
                            defaultValue={sub.marks_obtained !== null && sub.marks_obtained !== undefined ? sub.marks_obtained : ''}
                            onChange={(e) => {
                              setGradeStudentId(sub.student_id);
                              setGradeMarks(Number(e.target.value));
                            }}
                            className="w-20 p-2 rounded-lg border border-slate-200 font-bold text-center focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                          />
                          <input
                            type="text"
                            placeholder="Teacher feedback (e.g. Excellent work)..."
                            defaultValue={sub.teacher_feedback || ''}
                            onChange={(e) => {
                              setGradeStudentId(sub.student_id);
                              setGradeFeedback(e.target.value);
                            }}
                            className="flex-1 p-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveGrade(viewingSubmissionsHw.id)}
                            disabled={isGrading}
                            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold transition cursor-pointer"
                          >
                            Save Grade
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setViewingSubmissionsHw(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-bold transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
