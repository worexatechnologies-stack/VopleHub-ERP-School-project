import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Search,
  UserPlus,
  Smartphone,
  Calendar,

  GraduationCap,
  UploadCloud,
  User,
  MapPin,
  Activity,
  FileText,
  Trash2,
  Download,
  BookOpen,
  CheckCircle2,
  Clock,
  AlertCircle,
  Eye,
  EyeOff,
  AlertTriangle,
  Lock,
  X,
  Check,
  ZoomIn,
  ZoomOut,
  RotateCw,
  ExternalLink,
  ShieldCheck,
  FileCheck,
  Copy,
  CreditCard,
  Link as LinkIcon,
  Share2,
  Inbox,
  Filter,
  UserCheck,
  XCircle,
  FileSpreadsheet,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import ExcelImportModal from './ExcelImportModal';
import { copyToClipboard } from '../utils/clipboard';
import { Student, StudentDocument, UserRole } from '../types';
import AuthenticatedImage from './AuthenticatedImage';
import { formatBytes, optimizeImageForUpload } from '../services/imageOptimizer';
import { apiDownload } from '../services/api';
import { store, useAppSelector } from '../store';
import {
  studentApi,
  normalizeStudent,
  useGetStudentStatsQuery,
  useGetStudentsPaginatedQuery,
  useGetEnrollmentLinksQuery,
  useCreateEnrollmentLinkMutation,
  useDeactivateEnrollmentLinkMutation,
  useGetEnrollmentApplicationsQuery,
  useApproveEnrollmentApplicationMutation,
  useRejectEnrollmentApplicationMutation,
  useDeleteAllStudentsMutation,
  EnrollmentLinkItem,
  EnrollmentApplicationItem,
} from '../store/api/studentApi';
import {
  ACADEMIC_STRUCTURE_CHANGED_EVENT,
  AcademicClass,
  AcademicSection,
  AcademicSubject,
  AcademicYear,
  loadAcademicStructure,
} from '../services/academicStructure';

interface StudentModuleProps {
  students: Student[];
  onAddStudent: (newStudent: Student) => Promise<Student>;
  onUpdateStudent: (updatedStudent: Student) => Promise<void>;
  onDeleteStudent: (studentId: string) => Promise<void>;
  onPromoteStudent?: (
    studentId: string,
    nextClass: string,
    options?: {
      nextSection?: string;
      nextYear?: string;
      adminApproved?: boolean;
      allowFeeWaiver?: boolean;
      waiverReason?: string;
    }
  ) => void | Promise<boolean | void>;
  onIssueTC?: (studentId: string) => void;
  onDocumentsChanged: (studentId: string, documents: StudentDocument[]) => void;
  accountDirectory?: Array<{ id: number; email: string; role: string; studentId?: string; parentStudentIds?: string[] }>;
  onResetCredentials?: (userId: number) => Promise<{ loginId: string; temporaryPassword: string }>;
  currentAcademicYear?: string;
  canManageStudents?: boolean;
  onOpenAcademicSetup?: () => void;
  viewerRole?: UserRole;
  onStudentApproved?: (student: Student) => void;
  onNavigateToAdmissions?: () => void;
  onDeleteAllStudents?: () => void;
}

type StudentDetailsTab = 'Profile' | 'Fees' | 'Documents';

export default function StudentModule({
  students,
  onAddStudent,
  onUpdateStudent,
  onDeleteStudent,
  onPromoteStudent,
  onIssueTC: _onIssueTC,
  onDocumentsChanged,
  accountDirectory = [],
  onResetCredentials,
  currentAcademicYear = '',
  canManageStudents = false,
  onOpenAcademicSetup,
  viewerRole = 'School Admin',
  onStudentApproved,
  onNavigateToAdmissions,
  onDeleteAllStudents,
}: StudentModuleProps) {
  const isTeacherView = viewerRole === 'Teacher';
  // Query Filters
  const [yearFilter, setYearFilter] = useState(currentAcademicYear || 'All');
  const [classFilter, setClassFilter] = useState('All');
  const [sectionFilter, setSectionFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 250);
    return () => clearTimeout(handler);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, classFilter, sectionFilter, yearFilter]);

  // Tab state inside details panel
  const activeDetailsTabDefault: StudentDetailsTab = 'Profile';
  const [activeDetailsTab, setActiveDetailsTab] = useState<StudentDetailsTab>(activeDetailsTabDefault);

  // Forms states
  const [isAdding, setIsAdding] = useState(false);
  const [isExcelImportOpen, setIsExcelImportOpen] = useState(false);
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newClass, setNewClass] = useState('');
  const [newSection, setNewSection] = useState('');
  const [newSectionId, setNewSectionId] = useState<number | undefined>();
  const [newRollNo, setNewRollNo] = useState<number>(0);
  const [newParent, setNewParent] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newDob, setNewDob] = useState('2011-04-12');
  const [newGender, setNewGender] = useState('Male');
  const [newBloodGroup, setNewBloodGroup] = useState('B+');
  const [newAadhaar, setNewAadhaar] = useState('');
  const [newFatherName, setNewFatherName] = useState('');
  const [newMotherName, setNewMotherName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newPhotoFile, setNewPhotoFile] = useState<File | null>(null);
  const [newPhotoPreview, setNewPhotoPreview] = useState<string>('');
  const [newPhotoSummary, setNewPhotoSummary] = useState('');

  // Document verification state
  const reduxToken = useAppSelector((state) => state.auth?.accessToken);
  const isServerBacked = Boolean(reduxToken || localStorage.getItem('school_erp_api_token'));

  // Sync year filter when active academic year is resolved
  useEffect(() => {
    if (currentAcademicYear && (yearFilter === 'All' || !yearFilter)) {
      setYearFilter(currentAcademicYear);
    }
  }, [currentAcademicYear]);

  // Live PostgreSQL authoritative stats & paginated roster
  const {
    data: serverStats,
    isLoading: isStatsLoading,
    isFetching: isStatsFetching,
    refetch: refetchStats,
  } = useGetStudentStatsQuery(
    {
      academic_year: yearFilter !== 'All' ? yearFilter : undefined,
      class_name: classFilter !== 'All' ? classFilter : undefined,
      section: sectionFilter !== 'All' ? sectionFilter : undefined,
    },
    { skip: !isServerBacked }
  );

  const {
    data: paginatedResponse,
    isLoading: isRosterLoading,
    isFetching: isRosterFetching,
    refetch: refetchPaginatedRoster,
  } = useGetStudentsPaginatedQuery(
    {
      page,
      page_size: pageSize,
      search: debouncedSearch || undefined,
      class_name: classFilter !== 'All' ? classFilter : undefined,
      section: sectionFilter !== 'All' ? sectionFilter : undefined,
      academic_year: yearFilter !== 'All' ? yearFilter : undefined,
    },
    { skip: !isServerBacked }
  );
  const [isVerifyingDocId, setIsVerifyingDocId] = useState<number | string | null>(null);
  const [rejectingDocId, setRejectingDocId] = useState<number | string | null>(null);
  const [rejectRemarks, setRejectRemarks] = useState<string>('');
  const [isPreviewLoadingDocId, setIsPreviewLoadingDocId] = useState<number | string | null>(null);
  const [isDownloadingDocId, setIsDownloadingDocId] = useState<number | string | null>(null);

  interface StudentPreviewDocState {
    doc: StudentDocument;
    url: string;
    isPdf: boolean;
    scale: number;
    rotation: number;
  }
  const [previewDoc, setPreviewDoc] = useState<StudentPreviewDocState | null>(null);

  // Promotion modal state
  const [promoteStudentTarget, setPromoteStudentTarget] = useState<Student | null>(null);
  const [promoteTargetClass, setPromoteTargetClass] = useState<string>('');
  const [promoteTargetSection, setPromoteTargetSection] = useState<string>('');
  const [promoteTargetYear, setPromoteTargetYear] = useState<string>('');
  const [promoteFeeWaiver, setPromoteFeeWaiver] = useState<boolean>(false);
  const [promoteWaiverReason, setPromoteWaiverReason] = useState<string>('');
  const [promoteAdminApproved, setPromoteAdminApproved] = useState<boolean>(true);
  const [isPromoting, setIsPromoting] = useState<boolean>(false);
  const [promoteStatusMsg, setPromoteStatusMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const getNextClassFor = (currentClassName: string): string => {
    const currentIndex = academicClasses.findIndex(
      (classroom) => classroom.name.toLowerCase() === currentClassName.toLowerCase()
    );
    if (currentIndex >= 0 && currentIndex + 1 < academicClasses.length) {
      return academicClasses[currentIndex + 1].name;
    }
    const match = currentClassName.match(/^Class\s*(\d+)$/i);
    if (match) {
      const nextNum = parseInt(match[1], 10) + 1;
      const candidate = `Class ${nextNum}`;
      const found = academicClasses.find(c => c.name.toLowerCase() === candidate.toLowerCase());
      if (found) return found.name;
    }
    return academicClasses[0]?.name || 'Graduated';
  };

  const handleOpenPromoteModal = (student: Student) => {
    setPromoteStudentTarget(student);
    const nextCls = getNextClassFor(student.class);
    setPromoteTargetClass(nextCls);
    setPromoteTargetSection(student.section || 'A');
    const currYearIdx = academicYears.findIndex(y => y.name === student.academicYear);
    const nextYr = (currYearIdx >= 0 && academicYears[currYearIdx + 1]?.name) 
      ? academicYears[currYearIdx + 1].name 
      : student.academicYear;
    setPromoteTargetYear(nextYr);
    setPromoteFeeWaiver(false);
    setPromoteWaiverReason('');
    setPromoteAdminApproved(true);
    setPromoteStatusMsg(null);
  };

  const handleConfirmPromote = async () => {
    if (!promoteStudentTarget || !onPromoteStudent) return;
    
    const feeTotal = Number(promoteStudentTarget.feeTotal || 0);
    const feePaid = Number(promoteStudentTarget.feePaid || 0);
    const feePct = feeTotal > 0 ? (feePaid / feeTotal) * 100 : 100;
    const isUnder50 = feeTotal > 0 && feePct < 50;

    if (!promoteAdminApproved && !promoteFeeWaiver) {
      setPromoteStatusMsg({
        type: 'error',
        text: 'Admin approval required: Please check the admin fee clearance authorization to complete promotion.',
      });
      return;
    }

    if (isUnder50 && !promoteFeeWaiver) {
      setPromoteStatusMsg({
        type: 'error',
        text: `Promotion blocked: Student has completed only ${feePct.toFixed(1)}% of fees. At least 50% fee clearance is mandatory to promote to next class.`,
      });
      return;
    }

    if (isUnder50 && promoteFeeWaiver && !promoteWaiverReason.trim()) {
      setPromoteStatusMsg({
        type: 'error',
        text: 'Please enter an administrative reason for granting the fee waiver.',
      });
      return;
    }

    if (!promoteTargetClass) {
      setPromoteStatusMsg({
        type: 'error',
        text: 'Please select a valid target class for promotion.',
      });
      return;
    }

    try {
      setIsPromoting(true);
      setPromoteStatusMsg(null);
      await onPromoteStudent(promoteStudentTarget.id, promoteTargetClass, {
        nextSection: promoteTargetSection,
        nextYear: promoteTargetYear,
        adminApproved: promoteAdminApproved || Boolean(promoteFeeWaiver),
        allowFeeWaiver: promoteFeeWaiver,
        waiverReason: promoteWaiverReason,
      });
      setIsPromoting(false);
      setPromoteStudentTarget(null);
    } catch (err: any) {
      setIsPromoting(false);
      setPromoteStatusMsg({
        type: 'error',
        text: err?.message || 'Failed to promote student. Please try again.',
      });
    }
  };

  // Self-Enrollment Links State
  const [isLinksModalOpen, setIsLinksModalOpen] = useState(false);
  const [newLinkTargetClass, setNewLinkTargetClass] = useState('');
  const [newLinkAcademicYear, setNewLinkAcademicYear] = useState('');
  const [newLinkTitle, setNewLinkTitle] = useState('');
  const [copiedLinkToken, setCopiedLinkToken] = useState<string | null>(null);
  const [latestCreatedLink, setLatestCreatedLink] = useState<EnrollmentLinkItem | null>(null);

  // Online Applications State
  const [isApplicationsModalOpen, setIsApplicationsModalOpen] = useState(false);
  const [appStatusFilter, setAppStatusFilter] = useState<'All' | 'Pending' | 'Approved' | 'Rejected'>('Pending');
  const [appSearch, setAppSearch] = useState('');
  const [appClassFilter, setAppClassFilter] = useState('All');
  const [selectedApplication, setSelectedApplication] = useState<EnrollmentApplicationItem | null>(null);

  // Application Review & Decision State
  const [reviewAssignClass, setReviewAssignClass] = useState('');
  const [reviewAssignSection, setReviewAssignSection] = useState('A');
  const [reviewAssignRollNo, setReviewAssignRollNo] = useState<number>(0);
  const [reviewAssignAdmissionNo, setReviewAssignAdmissionNo] = useState('');
  const [reviewRejectRemarks, setReviewRejectRemarks] = useState('');
  const [isRejectingAppFormOpen, setIsRejectingAppFormOpen] = useState(false);
  const [appActionMsg, setAppActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Enrollment RTK Query hooks
  const {
    data: enrollmentLinks = [],
    refetch: refetchLinks,
  } = useGetEnrollmentLinksQuery(undefined, { skip: !canManageStudents });

  const [createEnrollmentLink, { isLoading: isCreatingLink }] = useCreateEnrollmentLinkMutation();
  const [deactivateEnrollmentLink, { isLoading: isDeactivatingLink }] = useDeactivateEnrollmentLinkMutation();

  const {
    data: enrollmentApplications = [],
    refetch: refetchApplications,
  } = useGetEnrollmentApplicationsQuery(undefined, { skip: !canManageStudents });

  const [approveEnrollmentApplication, { isLoading: isApprovingApp }] = useApproveEnrollmentApplicationMutation();
  const [rejectEnrollmentApplication, { isLoading: isRejectingApp }] = useRejectEnrollmentApplicationMutation();

  const pendingApplicationsCount = enrollmentApplications.filter((a) => a.status === 'Pending').length;

  // Delete all students admin credentials modal state & mutation
  const currentUser = useAppSelector((state) => state.auth.user);
  const [deleteAllStudents, { isLoading: isDeletingAll }] = useDeleteAllStudentsMutation();
  const [isDeleteAllModalOpen, setIsDeleteAllModalOpen] = useState(false);
  const [deleteAdminPassword, setDeleteAdminPassword] = useState('');
  const [showDeleteAdminPassword, setShowDeleteAdminPassword] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSuccessMsg, setDeleteSuccessMsg] = useState<string | null>(null);

  const handleDeleteAllSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deleteAdminPassword.trim()) {
      setDeleteError('Please enter your admin password to confirm.');
      return;
    }
    setDeleteError(null);
    setDeleteSuccessMsg(null);
    try {
      const res = await deleteAllStudents({
        adminPassword: deleteAdminPassword,
        adminEmail: currentUser?.email,
      }).unwrap();

      try {
        localStorage.removeItem('erp_students');
        localStorage.removeItem('erp_individual_fees');
      } catch {}

      setSelectedStudentId(null);
      setEditingStudentId(null);
      setIsAdding(false);
      onDeleteAllStudents?.();

      setDeleteSuccessMsg(res.message || `Successfully deleted ${res.deletedCount} students.`);
      setTimeout(() => {
        setIsDeleteAllModalOpen(false);
        setDeleteAdminPassword('');
        setShowDeleteAdminPassword(false);
        setDeleteError(null);
        setDeleteSuccessMsg(null);
      }, 1400);
    } catch (err: any) {
      const errorMsg =
        err?.data?.error ||
        err?.data?.detail ||
        err?.message ||
        'Authentication failed. Please verify your admin password.';
      setDeleteError(errorMsg);
    }
  };

  const handleCreateLink = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await createEnrollmentLink({
        title: newLinkTitle.trim() || undefined,
        targetClass: newLinkTargetClass || '',
        academicYear: newLinkAcademicYear || (yearFilter !== 'All' ? yearFilter : '') || currentAcademicYear || '2026-2027',
        durationMinutes: 1440,
      }).unwrap();
      setLatestCreatedLink(created);
      setNewLinkTitle('');
      refetchLinks();
    } catch (err: any) {
      alert(err?.data?.detail || err?.message || 'Failed to generate link.');
    }
  };

  const handleCopyLink = async (token: string) => {
    const origin = window.location.origin;
    const url = `${origin}/enroll?token=${token}`;
    const success = await copyToClipboard(url);
    if (success) {
      setCopiedLinkToken(token);
      setTimeout(() => setCopiedLinkToken(null), 3000);
    }
  };

  const handleDeactivateLink = async (id: string | number) => {
    if (!confirm('Are you sure you want to deactivate this enrollment link? Prospective applicants will no longer be able to use it.')) return;
    try {
      await deactivateEnrollmentLink(id).unwrap();
      refetchLinks();
      if (latestCreatedLink?.id === String(id) || (latestCreatedLink?.id as any) === id) {
        setLatestCreatedLink(null);
      }
    } catch (err: any) {
      alert(err?.data?.detail || err?.message || 'Failed to deactivate link.');
    }
  };

  const handleOpenReviewModal = (app: EnrollmentApplicationItem) => {
    setSelectedApplication(app);
    const targetCls = app.className || (academicClasses[0]?.name ?? 'Class 1');
    setReviewAssignClass(targetCls);
    setReviewAssignSection(app.section || 'A');

    const inClass = students.filter(
      (s) => s.class === targetCls && (!yearFilter || s.academicYear === (app.academicYear || yearFilter))
    );
    const highestRoll = inClass.reduce((max, s) => Math.max(max, Number(s.rollNo || 0)), 0);
    setReviewAssignRollNo(highestRoll + 1);

    const yrCode = (app.academicYear || yearFilter || '2026').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
    setReviewAssignAdmissionNo(`ADM-${yrCode}-${Date.now().toString(36).toUpperCase()}`);
    setReviewRejectRemarks('');
    setIsRejectingAppFormOpen(false);
    setAppActionMsg(null);
  };

  const handleConfirmApproveApp = async () => {
    if (!selectedApplication) return;
    try {
      setAppActionMsg(null);
      const res = await approveEnrollmentApplication({
        id: selectedApplication.id,
        className: reviewAssignClass,
        section: reviewAssignSection,
        rollNo: reviewAssignRollNo || undefined,
        admissionNo: reviewAssignAdmissionNo || undefined,
      }).unwrap();

      if (res.student) {
        const studentObj = normalizeStudent(res.student);
        if (onStudentApproved) {
          onStudentApproved(studentObj);
        }
      }
      refetchApplications();
      setAppActionMsg({
        type: 'success',
        text: `Approved! ${selectedApplication.name} is enrolled in ${reviewAssignClass}-${reviewAssignSection}. Portal credentials activated and fees ledger created.`,
      });
      setTimeout(() => {
        setSelectedApplication(null);
        setAppActionMsg(null);
      }, 1500);
    } catch (err: any) {
      setAppActionMsg({
        type: 'error',
        text: err?.data?.detail || err?.message || 'Failed to approve application.',
      });
    }
  };

  const handleConfirmRejectApp = async () => {
    if (!selectedApplication) return;
    try {
      setAppActionMsg(null);
      await rejectEnrollmentApplication({
        id: selectedApplication.id,
        remarks: reviewRejectRemarks.trim() || 'Application rejected by administration.',
      }).unwrap();
      refetchApplications();
      setAppActionMsg({
        type: 'success',
        text: `Application for ${selectedApplication.name} has been rejected.`,
      });
      setTimeout(() => {
        setSelectedApplication(null);
        setAppActionMsg(null);
        setIsRejectingAppFormOpen(false);
      }, 1200);
    } catch (err: any) {
      setAppActionMsg({
        type: 'error',
        text: err?.data?.detail || err?.message || 'Failed to reject application.',
      });
    }
  };


  const getDocCategoryIcon = (category: string = '', name: string = '') => {
    const text = `${category || ''} ${name || ''}`.toLowerCase();
    if (text.includes('aadhaar') || text.includes('adhar') || text.includes('identity') || text.includes('uid')) {
      return <ShieldCheck className="h-4 w-4 text-indigo-600" />;
    }
    if (text.includes('birth') || text.includes('dob')) {
      return <FileCheck className="h-4 w-4 text-emerald-600" />;
    }
    if (text.includes('transfer') || text.includes('tc') || text.includes('school')) {
      return <GraduationCap className="h-4 w-4 text-blue-600" />;
    }
    return <FileText className="h-4 w-4 text-amber-600" />;
  };

  const getDocCategoryTheme = (category: string = '', name: string = '') => {
    const text = `${category || ''} ${name || ''}`.toLowerCase();
    if (text.includes('aadhaar') || text.includes('adhar') || text.includes('identity') || text.includes('uid')) {
      return { bg: 'bg-indigo-50/80', border: 'border-indigo-100', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200/60' };
    }
    if (text.includes('birth') || text.includes('dob')) {
      return { bg: 'bg-emerald-50/80', border: 'border-emerald-100', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200/60' };
    }
    if (text.includes('transfer') || text.includes('tc')) {
      return { bg: 'bg-blue-50/80', border: 'border-blue-100', badge: 'bg-blue-50 text-blue-700 border-blue-200/60' };
    }
    return { bg: 'bg-amber-50/80', border: 'border-amber-100', badge: 'bg-amber-50 text-amber-700 border-amber-200/60' };
  };
  const [credentialRevision, setCredentialRevision] = useState(0);
  // A generated password exists only in this in-memory state.  It is never
  // written to localStorage or the database in plaintext.
  const [revealedCredential, setRevealedCredential] = useState<{
    role: 'Student' | 'Parent'; loginId: string; temporaryPassword: string;
  } | null>(null);
  const [copiedCredentialModal, setCopiedCredentialModal] = useState(false);
  const [copiedLoginDetails, setCopiedLoginDetails] = useState(false);
  const [academicClasses, setAcademicClasses] = useState<AcademicClass[]>([]);
  const [academicSections, setAcademicSections] = useState<AcademicSection[]>([]);
  const [academicSubjects, setAcademicSubjects] = useState<AcademicSubject[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [structureError, setStructureError] = useState('');
  const classOptions = academicClasses;
  const sectionRecords = academicSections;
  const selectedClassRecord = classOptions.find((classroom) => classroom.name === newClass) || classOptions[0];
  const sectionOptions = sectionRecords.filter((section) => section.classId === selectedClassRecord?.id);
  const filterClassRecord = classOptions.find((classroom) => classroom.name === classFilter);
  const normalizeClassName = (cls?: string): string => {
    if (!cls) return '';
    return cls.replace(/^(Class|Grade|Std)\s+/i, '').trim().toLowerCase();
  };

  const teacherYearNames = Array.from(new Set(students.map((student) => student.academicYear).filter(Boolean)));
  const studentYearNames = Array.from(new Set(students.map((student) => student.academicYear).filter(Boolean)));
  const allAvailableYears = Array.from(new Set([
    ...academicYears.map((year) => year.name),
    ...studentYearNames,
    ...(currentAcademicYear ? [currentAcademicYear] : []),
  ])).filter(Boolean);
  const hasAvailableYears = academicYears.length > 0 || allAvailableYears.length > 0 || Boolean(currentAcademicYear);
  const hasAvailableSections = academicSections.length > 0 || sectionRecords.length > 0;
  const directoryYearOptions = (isTeacherView ? teacherYearNames : allAvailableYears).map((name) => ({
    id: name,
    name,
  }));

  const studentClassNames = Array.from(new Set(
    students
      .filter((student) => yearFilter === 'All' || !yearFilter || student.academicYear === yearFilter)
      .map((student) => student.class)
      .filter(Boolean),
  )).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  const teacherClassNames = studentClassNames;
  const directoryClassNames = isTeacherView
    ? teacherClassNames
    : Array.from(new Set([
        ...classOptions.map((classroom) => classroom.name),
        ...studentClassNames,
      ])).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  const filterSections = isTeacherView
    ? Array.from(new Set(
        students
          .filter((student) => (yearFilter === 'All' || !yearFilter || student.academicYear === yearFilter) && (classFilter === 'All' || student.class === classFilter || normalizeClassName(student.class) === normalizeClassName(classFilter)))
          .map((student) => student.section)
          .filter(Boolean),
      )).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    : Array.from(new Set([
        ...sectionRecords
          .filter((section) => classFilter === 'All' || section.classId === filterClassRecord?.id)
          .map((section) => section.name),
        ...students
          .filter((student) => (yearFilter === 'All' || !yearFilter || student.academicYear === yearFilter) && (classFilter === 'All' || student.class === classFilter || normalizeClassName(student.class) === normalizeClassName(classFilter)))
          .map((student) => student.section)
          .filter(Boolean),
      ])).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  useEffect(() => {
    let active = true;
    const load = () => loadAcademicStructure()
      .then(({ years, classes, sections, subjects }) => {
        if (!active) return;
        setAcademicYears(years);
        setAcademicClasses(classes);
        setAcademicSections(sections);
        setAcademicSubjects(subjects);
        setStructureError('');
        const selectedYear = years.find((year) => year.name === currentAcademicYear)
          || years.find((year) => year.is_active)
          || years[0];
        setYearFilter((existing) => {
          if (existing === 'All') return 'All';
          if (existing && (years.some((year) => year.name === existing) || students.some((s) => s.academicYear === existing))) {
            return existing;
          }
          if (selectedYear && (!students.length || students.some((s) => s.academicYear === selectedYear.name))) {
            return selectedYear.name;
          }
          const candidateStudentYear = students.find((s) => Boolean(s.academicYear))?.academicYear;
          return candidateStudentYear || selectedYear?.name || 'All';
        });
        const classroom = classes[0];
        const classSections = classroom ? sections.filter((item) => item.classId === classroom.id) : [];
        const section = classSections[0];
        setNewClass(classroom?.name || '');
        if (section) {
          setNewSection(section.name);
          setNewSectionId(section.id);
        } else {
          setNewSection('');
          setNewSectionId(undefined);
        }
      })
      .catch((error) => setStructureError(error instanceof Error ? error.message : 'Could not load classes and sections.'));
    void load();
    window.addEventListener(ACADEMIC_STRUCTURE_CHANGED_EVENT, load);
    return () => {
      active = false;
      window.removeEventListener(ACADEMIC_STRUCTURE_CHANGED_EVENT, load);
    };
  }, [currentAcademicYear, students]);

  // Keep yearFilter aligned with available students if current yearFilter has no matches
  useEffect(() => {
    if (yearFilter === 'All') return;
    if (students.length > 0) {
      const hasMatchingStudent = students.some((s) => s.academicYear === yearFilter);
      if (!hasMatchingStudent) {
        const studentYear = students.find((s) => Boolean(s.academicYear))?.academicYear;
        if (studentYear) {
          setYearFilter(studentYear);
        } else {
          setYearFilter('All');
        }
      }
    }
  }, [students, yearFilter]);

  useEffect(() => {
    if (!isTeacherView) return;

    const nextYear = teacherYearNames.includes(currentAcademicYear)
      ? currentAcademicYear
      : teacherYearNames[0] || '';
    if (!teacherYearNames.includes(yearFilter) && yearFilter !== nextYear && yearFilter !== 'All') {
      setYearFilter(nextYear);
    }

    if (classFilter !== 'All' && !teacherClassNames.includes(classFilter) && !teacherClassNames.some(tc => normalizeClassName(tc) === normalizeClassName(classFilter))) {
      setClassFilter('All');
      setSectionFilter('All');
    } else if (sectionFilter !== 'All' && !filterSections.includes(sectionFilter)) {
      setSectionFilter('All');
    }
  }, [classFilter, currentAcademicYear, filterSections, isTeacherView, sectionFilter, teacherClassNames, teacherYearNames, yearFilter]);

  useEffect(() => {
    if (isTeacherView && ['Fees', 'Documents'].includes(activeDetailsTab)) {
      setActiveDetailsTab('Profile');
    }
  }, [activeDetailsTab, isTeacherView]);

  // Filter students based on all selected criteria (used for offline or fallback)
  const filteredStudents = students.filter(student => {
    const matchesYear = yearFilter === 'All' || !yearFilter || student.academicYear === yearFilter;
    const matchesClass = classFilter === 'All' || 
      student.class === classFilter || 
      normalizeClassName(student.class) === normalizeClassName(classFilter);
    const matchesSection = sectionFilter === 'All' || 
      student.section === sectionFilter ||
      student.section?.toLowerCase() === sectionFilter?.toLowerCase();

    const query = (debouncedSearch || search).toLowerCase().trim();
    const matchesSearch = !query || 
      String(student.name || '').toLowerCase().includes(query) ||
      String(student.admissionNo || '').toLowerCase().includes(query) ||
      String(student.rollNo || '').toLowerCase() === query ||
      String(student.class || '').toLowerCase().includes(query) ||
      String(student.section || '').toLowerCase() === query ||
      String(student.parentPhone || '').toLowerCase().includes(query);

    return matchesYear && matchesClass && matchesSection && matchesSearch;
  });

  const displayStudents = isServerBacked && paginatedResponse ? paginatedResponse.results : filteredStudents;
  const totalCohortCount = isServerBacked && paginatedResponse ? paginatedResponse.count : filteredStudents.length;
  const totalPages = isServerBacked && paginatedResponse ? paginatedResponse.totalPages : Math.max(1, Math.ceil(filteredStudents.length / pageSize));

  // Track the selected student
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  
  // Resolve selected student (handling changes dynamically)
  const selectedStudent = (
    displayStudents.find(s => s.id === selectedStudentId) ||
    filteredStudents.find(s => s.id === selectedStudentId) ||
    displayStudents[0] ||
    filteredStudents[0] ||
    null
  );
  const selectedStudentSection = academicSections.find((section) => section.id === selectedStudent?.sectionId);
  const selectedStudentClass = academicClasses.find((classroom) => classroom.id === selectedStudentSection?.classId)
    || academicClasses.find((classroom) => classroom.name === selectedStudent?.class);
  const selectedStudentSubjectIds = new Set(selectedStudentClass?.subjectIds || []);
  const selectedStudentSubjects = academicSubjects
    .filter((subject) => selectedStudentSubjectIds.has(subject.id))
    .sort((left, right) => left.name.localeCompare(right.name));
  const detailsTabs: Array<{ id: StudentDetailsTab; label: string }> = isTeacherView
    ? [
        { id: 'Profile', label: 'Student profile' },
      ]
    : [
        { id: 'Profile', label: 'Profile' },
        { id: 'Fees', label: 'Fees' },
        { id: 'Documents', label: 'Documents' },
      ];

  const getLoginDetailsForStudent = (student: Student) => {
    void credentialRevision;
    const studentAccount = accountDirectory.find((account) => account.role === 'student' && account.studentId === student.id);
    const parentAccount = accountDirectory.find((account) => account.role === 'parent' && account.parentStudentIds?.includes(student.id));

    return {
      studentEmail: studentAccount?.email || 'No linked Student login found',
      studentPassword: 'Password is shown only once. Use Reset credentials to generate a new one.',
      studentUserId: studentAccount?.id,
      parentEmail: parentAccount?.email || 'No linked Parent login found',
      parentPassword: 'Password is shown only once. Use Reset credentials to generate a new one.',
      parentUserId: parentAccount?.id,
    };
  };

  const resetCredentials = async (role: 'Student' | 'Parent', userId: number | undefined) => {
    if (!onResetCredentials || !userId) {
      alert(`No linked ${role} login is available to reset.`);
      return;
    }
    if (!confirm(`Generate a new one-time password for this ${role} account?`)) return;
    try {
      const credentials = await onResetCredentials(userId);
      setCredentialRevision((version) => version + 1);
      setRevealedCredential({ role, loginId: credentials.loginId, temporaryPassword: credentials.temporaryPassword });
    } catch (error) {
      alert(error instanceof Error ? `Could not reset ${role} credentials: ${error.message}` : `Could not reset ${role} credentials.`);
    }
  };

  const copyLoginDetails = async (student: Student) => {
    const details = getLoginDetailsForStudent(student);
    const success = await copyToClipboard([
      `Student Email: ${details.studentEmail}`,
      `Parent Email: ${details.parentEmail}`,
    ].join('\n'));
    if (success) {
      setCopiedLoginDetails(true);
      setTimeout(() => setCopiedLoginDetails(false), 2500);
    }
  };

  // Calculate cohort-wise dashboard stats corresponding to currently selected class filter
  const cohortForDashboard = students.filter(s => 
    (yearFilter === 'All' || !yearFilter || s.academicYear === yearFilter) && 
    (classFilter === 'All' ? true : s.class === classFilter || normalizeClassName(s.class) === normalizeClassName(classFilter)) &&
    (sectionFilter === 'All' ? true : s.section === sectionFilter || s.section?.toLowerCase() === sectionFilter?.toLowerCase())
  );

  const localStatsTotal = cohortForDashboard.length;
  const localStatsBoys = cohortForDashboard.filter(s => s.gender === 'Male').length;
  const localStatsGirls = cohortForDashboard.filter(s => s.gender === 'Female').length;
  
  const recordedAttendance = cohortForDashboard
    .map((student) => student.attendancePercentage)
    .filter((value): value is number => value !== undefined);
  const localStatsAvgAttendance = recordedAttendance.length > 0
    ? Math.round(recordedAttendance.reduce((sum, value) => sum + value, 0) / recordedAttendance.length)
    : null;

  const statsTotalExpectedFee = cohortForDashboard.reduce((sum, s) => sum + (s.feeTotal ?? 0), 0);
  const statsTotalPaidFee = cohortForDashboard.reduce((sum, s) => sum + (s.feePaid ?? 0), 0);
  const localStatsFeeStatusPercent = statsTotalExpectedFee > 0
    ? Math.round((statsTotalPaidFee / statsTotalExpectedFee) * 100)
    : 0;

  const statsTotal = serverStats
    ? serverStats.totalStudents
    : (isServerBacked && paginatedResponse?.count !== undefined
      ? paginatedResponse.count
      : localStatsTotal);
  const statsBoys = serverStats ? serverStats.boysCount : localStatsBoys;
  const statsGirls = serverStats ? serverStats.girlsCount : localStatsGirls;
  const statsAvgAttendance = serverStats ? serverStats.avgAttendance : localStatsAvgAttendance;
  const statsFeeStatusPercent = serverStats ? serverStats.feeStatusPercent : localStatsFeeStatusPercent;

  const currentClassTeacher = classFilter !== 'All' ? 'See Teacher Profiles' : 'Multiple Teachers';

  const resetStudentForm = () => {
    const firstClass = classOptions[0];
    const firstSection = sectionRecords.find((item) => item.classId === firstClass?.id);
    setNewName('');
    setNewParent('');
    setNewPhone('');
    setNewEmail('');
    setNewFatherName('');
    setNewMotherName('');
    setNewAadhaar('');
    setNewAddress('');
    setNewRollNo(0);
    setNewPhotoFile(null);
    setNewPhotoPreview('');
    setNewPhotoSummary('');
    if (firstClass) setNewClass(firstClass.name);
    if (firstSection) {
      setNewSection(firstSection.name);
      setNewSectionId(firstSection.id);
    } else {
      setNewSection('');
      setNewSectionId(undefined);
    }
    setEditingStudentId(null);
  };

  const startEditStudent = (student: Student) => {
    setEditingStudentId(student.id);
    setNewName(student.name);
    setNewClass(student.class);
    setNewSection(student.section);
    const classroom = academicClasses.find((item) => item.name === student.class);
    const section = academicSections.find((item) => item.classId === classroom?.id && item.name === student.section);
    setNewSectionId(student.sectionId || section?.id);
    setNewRollNo(student.rollNo);
    setNewParent(student.parentName);
    setNewPhone(student.parentPhone);
    setNewEmail(student.parentEmail);
    setNewDob(student.dob);
    setNewGender(student.gender);
    setNewBloodGroup(student.bloodGroup || 'B+');
    setNewAadhaar(student.aadhaar || '');
    setNewFatherName(student.fatherName || student.parentName);
    setNewMotherName(student.motherName || '');
    setNewAddress(student.address || '');
    setNewPhotoFile(null);
    setNewPhotoPreview(student.photoUrl || '');
    setNewPhotoSummary('');
    setIsAdding(true);
  };

  const handleOpenEnrollForm = () => {
    setEditingStudentId(null);
    resetStudentForm();
    if (yearFilter === 'All' || !yearFilter || !academicYears.some((year) => year.name === yearFilter)) {
      const activeYear = academicYears.find((year) => year.is_active)?.name
        || academicYears[0]?.name
        || currentAcademicYear
        || allAvailableYears[0]
        || '2026-2027';
      setYearFilter(activeYear);
    }
    setIsAdding(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newParent || !newPhone) return;

    const targetAcademicYear = (yearFilter && yearFilter !== 'All')
      ? yearFilter
      : (academicYears.find((year) => year.is_active)?.name || academicYears[0]?.name || currentAcademicYear || allAvailableYears[0] || '2026-2027');

    const yearExists = academicYears.some((year) => year.name === targetAcademicYear)
      || allAvailableYears.includes(targetAcademicYear)
      || targetAcademicYear === currentAcademicYear;

    if (!targetAcademicYear || !yearExists) {
      alert('Create and select an academic year in Academic Setup before saving a student.');
      return;
    }

    let finalSectionId = newSectionId;
    if (!finalSectionId) {
      const matchingSection = sectionRecords.find(
        (s) => s.name === newSection && (!newClass || s.classId === classOptions.find((c) => c.name === newClass)?.id)
      ) || sectionOptions[0] || sectionRecords[0];
      if (matchingSection) {
        finalSectionId = matchingSection.id;
        setNewSectionId(matchingSection.id);
        if (!newSection) setNewSection(matchingSection.name);
      }
    }

    if (!finalSectionId) {
      alert('A School Admin must create and select a class section before saving a student.');
      return;
    }

    const computedRollNo = newRollNo > 0 ? newRollNo : (students.filter(s => s.class === newClass && s.academicYear === targetAcademicYear).length + 1);

    if (editingStudentId) {
      const existing = students.find(s => s.id === editingStudentId);
      if (!existing) return;

      const updatedStudent: Student = {
        ...existing,
        name: newName,
        class: newClass,
        section: newSection,
        sectionId: finalSectionId,
        academicYear: existing.academicYear || targetAcademicYear,
        rollNo: computedRollNo,
        parentName: newParent,
        parentPhone: newPhone,
        parentEmail: newEmail || existing.parentEmail,
        dob: newDob,
        gender: newGender,
        address: newAddress || '',
        medicalConditions: existing.medicalConditions || 'None',
        bloodGroup: newBloodGroup,
        aadhaar: newAadhaar,
        fatherName: newFatherName || newParent,
        motherName: newMotherName || 'Not Specified',
        feeTotal: existing.feeTotal ?? 0,
        feePaid: existing.feePaid ?? 0,
        photoUrl: newPhotoPreview || existing.photoUrl,
        photoFile: newPhotoFile || undefined,
      };

      await onUpdateStudent(updatedStudent);
      setSelectedStudentId(updatedStudent.id);
      setIsAdding(false);
      resetStudentForm();
      return;
    }

    const academicYearCode = targetAcademicYear.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 8) || 'YEAR';
    const newS: Student = {
      id: `s-${Date.now()}`,
      admissionNo: `ADM-${academicYearCode}-${Date.now().toString(36).toUpperCase()}`,
      name: newName,
      class: newClass,
      section: newSection,
      sectionId: finalSectionId,
      rollNo: computedRollNo,
      parentName: newParent,
      parentPhone: newPhone,
      parentEmail: newEmail || `${newParent.toLowerCase().replace(/\s/g, '')}@school-erp.com`,
      dob: newDob,
      gender: newGender,
      address: newAddress || '',
      medicalConditions: 'None',
      qrCodeData: `SCH-ERP-s-${Date.now()}`,
      status: 'Active',
      academicYear: targetAcademicYear,
      bloodGroup: newBloodGroup,
      aadhaar: newAadhaar,
      fatherName: newFatherName || newParent,
      motherName: newMotherName || 'Not Specified',
      attendancePercentage: 100,
      feeTotal: 0,
      feePaid: 0,
      gpa: undefined,
      documents: [],
      history: []
    };
    if (newPhotoFile) {
      newS.photoFile = newPhotoFile;
      newS.photoUrl = newPhotoPreview;
    }

    try {
      const createdStudent = await onAddStudent(newS);
      setSelectedStudentId(createdStudent.id);
      setIsAdding(false);
      resetStudentForm();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Student admission could not be saved to the server.');
    }
  };

  const handleDocumentDownload = async (document: StudentDocument) => {
    if (!document.downloadUrl) {
      alert('This legacy document is not available for download. Upload it again to store it securely.');
      return;
    }
    setIsDownloadingDocId(document.id ?? null);
    try {
      const { blob, filename } = await apiDownload(document.downloadUrl);
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = filename || document.fileName || `${document.name}.${(document.fileType || 'pdf').toLowerCase()}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Document download failed.');
    } finally {
      setIsDownloadingDocId(null);
    }
  };

  const handleVerifyDocument = async (doc: StudentDocument) => {
    if (!selectedStudent) return;
    setIsVerifyingDocId(doc.id ?? null);
    try {
      if (isServerBacked && doc.id) {
        await store.dispatch(studentApi.endpoints.verifyStudentDocument.initiate({
          studentId: selectedStudent.id,
          docId: doc.id,
          status: 'Verified',
          remarks: 'Verified & Approved by School Administration',
        })).unwrap();
      }
      const updatedDocs = (selectedStudent.documents || []).map((d) =>
        d.id === doc.id
          ? {
              ...d,
              status: 'Verified' as const,
              remarks: 'Verified & Approved by School Administration',
              verifiedAt: new Date().toISOString(),
            }
          : d
      );
      onDocumentsChanged(selectedStudent.id, updatedDocs);
      if (previewDoc && previewDoc.doc.id === doc.id) {
        setPreviewDoc((prev) => prev ? {
          ...prev,
          doc: {
            ...prev.doc,
            status: 'Verified' as const,
            remarks: 'Verified & Approved by School Administration',
            verifiedAt: new Date().toISOString(),
          }
        } : null);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Document verification failed.');
    } finally {
      setIsVerifyingDocId(null);
    }
  };

  const handleRejectDocument = async (doc: StudentDocument, customRemarks?: string) => {
    if (!selectedStudent) return;
    setIsVerifyingDocId(doc.id ?? null);
    const remarks = (customRemarks !== undefined ? customRemarks : rejectRemarks).trim() || 'Document rejected. Please re-upload a clear and legible copy.';
    try {
      if (isServerBacked && doc.id) {
        await store.dispatch(studentApi.endpoints.verifyStudentDocument.initiate({
          studentId: selectedStudent.id,
          docId: doc.id,
          status: 'Rejected',
          remarks,
        })).unwrap();
      }
      const updatedDocs = (selectedStudent.documents || []).map((d) =>
        d.id === doc.id
          ? {
              ...d,
              status: 'Rejected' as const,
              remarks,
              verifiedAt: new Date().toISOString(),
            }
          : d
      );
      onDocumentsChanged(selectedStudent.id, updatedDocs);
      if (previewDoc && previewDoc.doc.id === doc.id) {
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
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to reject document.');
    } finally {
      setIsVerifyingDocId(null);
    }
  };

  const handleDeleteDocument = async (doc: StudentDocument) => {
    if (!confirm(`Are you sure you want to remove "${doc.name}" from this student's records?`)) return;
    if (!selectedStudent) return;
    try {
      if (isServerBacked && doc.id) {
        await store.dispatch(studentApi.endpoints.deleteStudentDocument.initiate({
          studentId: selectedStudent.id,
          docId: doc.id,
        })).unwrap();
      }
      const updatedDocs = (selectedStudent.documents || []).filter((d) => d.id !== doc.id);
      onDocumentsChanged(selectedStudent.id, updatedDocs);
      if (previewDoc && previewDoc.doc.id === doc.id) {
        closeDocPreview();
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Document deletion failed.');
    }
  };

  const handlePreviewDocument = async (doc: StudentDocument) => {
    if (!doc.downloadUrl) {
      alert('This document is not available for preview.');
      return;
    }
    setIsPreviewLoadingDocId(doc.id ?? null);
    try {
      const { blob, filename, contentType } = await apiDownload(doc.downloadUrl);
      const isPdf = contentType.includes('pdf') || (doc.fileType || '').toUpperCase() === 'PDF' || (doc.fileName || '').toLowerCase().endsWith('.pdf');
      const url = URL.createObjectURL(blob);
      setPreviewDoc({
        doc: {
          ...doc,
          fileName: filename || doc.fileName,
        },
        url,
        isPdf,
        scale: 1,
        rotation: 0,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to load document preview.');
    } finally {
      setIsPreviewLoadingDocId(null);
    }
  };

  const closeDocPreview = () => {
    if (previewDoc?.url) {
      URL.revokeObjectURL(previewDoc.url);
    }
    setPreviewDoc(null);
  };

  // Helper to resolve profile photo URL or initials
  const renderProfilePhoto = (student: Student, sizeClass = "w-10 h-10 text-xs") => {
    const photoUrl = student.photoUrl;
    if (photoUrl) {
      return (
        <AuthenticatedImage
          src={photoUrl}
          alt={student.name}
          className={`${sizeClass} rounded-full object-cover border border-slate-200`}
        />
      );
    }
    const initials = String(student.name || 'ST').split(' ').map(n => n[0]).slice(0, 2).join('');
    return (
      <div className={`${sizeClass} rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 font-bold flex items-center justify-center`}>
        {initials}
      </div>
    );
  };

  return (
    <>
    <div className="space-y-6 animate-fade-in" id="student-management-workspace">
      
      {/* Portal Header Card */}
      <div className="portal-header-card space-y-5">
        {/* Top Tier: Title, Context & Primary Action */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white shrink-0 ring-4 ring-indigo-50">
              <GraduationCap className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <div className="portal-pill-badge indigo">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block"></span>
                  {isTeacherView ? 'Teacher View' : 'School Admin'}
                </div>
                <span className="text-[11px] font-semibold text-slate-600 bg-slate-100/90 px-2.5 py-0.5 rounded-full border border-slate-200/60">
                  Roster & Lifecycle Portal
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight leading-snug">
                {isTeacherView ? 'My Assigned Students' : 'Class-wise Student Directory'}
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-3xl leading-relaxed">
                {isTeacherView
                  ? 'Only students in your assigned class sections are shown. Open a profile to review learning details or contact the student and guardian.'
                  : 'Maintain independent rosters per academic term, monitor class performance dashboards, execute promotions, and manage documents.'}
              </p>
            </div>
          </div>

          {canManageStudents && (
            <div className="flex items-center gap-3 shrink-0 self-start lg:self-center">
              <button
                disabled={!hasAvailableYears || !hasAvailableSections}
                onClick={() => {
                  if (isAdding) {
                    setIsAdding(false);
                    resetStudentForm();
                  } else {
                    handleOpenEnrollForm();
                  }
                }}
                className="portal-btn-primary shadow-lg shadow-indigo-500/25 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                title={!hasAvailableYears || !hasAvailableSections ? 'Create an academic year, class, and section first in Academic Setup' : undefined}
              >
                <UserPlus className="w-4 h-4" />
                <span>{isAdding ? 'View Student List' : 'Enroll New Student'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Bottom Tier: Integrated Toolbar for Secondary Actions */}
        {canManageStudents && (
          <div className="pt-4 border-t border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                onClick={() => (onNavigateToAdmissions ? onNavigateToAdmissions() : setIsLinksModalOpen(true))}
                className="portal-btn-secondary !text-xs !py-2 !px-3.5 flex items-center gap-2 hover:border-indigo-200 hover:bg-indigo-50/50 transition-all"
                title="Generate and manage shareable 24-hour self-enrollment links"
              >
                <LinkIcon className="w-3.5 h-3.5 text-indigo-600" />
                <span>Self-Enrollment Links</span>
              </button>

              <button
                onClick={() => (onNavigateToAdmissions ? onNavigateToAdmissions() : setIsApplicationsModalOpen(true))}
                className="portal-btn-secondary relative !text-xs !py-2 !px-3.5 flex items-center gap-2 hover:border-purple-200 hover:bg-purple-50/50 transition-all"
                title="Review and approve online applicant submissions"
              >
                <Inbox className="w-3.5 h-3.5 text-purple-600" />
                <span>Online Admissions</span>
                {pendingApplicationsCount > 0 && (
                  <span className="flex items-center justify-center min-w-[18px] h-4.5 px-1.5 text-[10px] font-black text-white bg-gradient-to-r from-rose-500 to-pink-500 rounded-full shadow-xs animate-pulse">
                    {pendingApplicationsCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setIsExcelImportOpen(true)}
                className="portal-btn-secondary !text-xs !py-2 !px-3.5 flex items-center gap-2 !border-emerald-200 !bg-emerald-50/80 hover:!bg-emerald-100/90 !text-emerald-800 transition-all"
                title="Import students from Excel (.xlsx, .xls) or Google Sheets with smart column & row organization"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span>Import via Excel / Sheet</span>
              </button>

              {onOpenAcademicSetup && (
                <button
                  onClick={onOpenAcademicSetup}
                  className="portal-btn-secondary !text-xs !py-2 !px-3.5 flex items-center gap-2 hover:border-slate-300 transition-all"
                  title="Configure academic years, classes, and sections"
                >
                  <Settings className="w-3.5 h-3.5 text-slate-500" />
                  <span>Academic Setup</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 self-end md:self-auto shrink-0">
              <button
                type="button"
                onClick={() => {
                  setDeleteAdminPassword('');
                  setShowDeleteAdminPassword(false);
                  setDeleteError(null);
                  setDeleteSuccessMsg(null);
                  setIsDeleteAllModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-rose-200 bg-rose-50/70 hover:bg-rose-100/90 text-rose-700 font-bold text-xs shadow-xs transition-all cursor-pointer"
                title="Permanently wipe all students data and credentials across this school"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                <span>Delete All Students</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Pending Online Applications Action Banner */}
      {canManageStudents && pendingApplicationsCount > 0 && (
        <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50/90 via-purple-50/90 to-pink-50/90 p-4.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm animate-fade-in">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 text-white flex items-center justify-center font-black shrink-0 shadow-md">
              <Inbox className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-rose-100 text-rose-700 text-[10px] font-black uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping inline-block"></span>
                  Action Required
                </span>
                <h4 className="text-sm font-bold text-slate-900">
                  {pendingApplicationsCount} Online Student Application{pendingApplicationsCount === 1 ? '' : 's'} Awaiting Review
                </h4>
              </div>
              <p className="text-xs text-slate-600 mt-1">
                Prospective students submitted their admission forms via the self-enrollment link and received portal credentials. School Admin approval is required to finalize their admission into the class directory and initialize fees.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0 w-full sm:w-auto">
            <button
              onClick={() => setIsApplicationsModalOpen(true)}
              className="w-full sm:w-auto rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold text-xs px-4 py-2.5 shadow-md flex items-center justify-center gap-2 cursor-pointer transition-all"
            >
              <Inbox className="w-4 h-4" />
              <span>Review Admissions Queue ({pendingApplicationsCount})</span>
            </button>
          </div>
        </div>
      )}

      {structureError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0"></span>
          {structureError}
        </div>
      )}

      {isTeacherView && (
        <div className="portal-card px-5 py-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
              <User className="w-3.5 h-3.5 text-indigo-600" />
            </div>
            <span className="text-sm font-semibold text-slate-700">Assignment-scoped access is active. Unassigned classes and students are not available in this directory.</span>
          </div>
          <span className="shrink-0 rounded-full bg-indigo-50 border border-indigo-100 px-4 py-1 text-xs font-extrabold uppercase tracking-wider text-indigo-700">
            {students.length} assigned student{students.length === 1 ? '' : 's'}
          </span>
        </div>
      )}

      {/* Class-wise Dashboard Widgets (Hides during adding form) */}
      {!isAdding && (
        <div className="portal-card p-6 space-y-5 relative overflow-hidden" id="class-cohort-dashboard">
          <div className="absolute right-0 top-0 w-72 h-72 bg-indigo-400/5 rounded-full blur-3xl pointer-events-none"></div>
          
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <p className="text-xs font-bold text-indigo-500 uppercase tracking-widest">{isTeacherView ? 'Assigned Roster Summary' : 'Cohort Analytics Dashboard'}</p>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2 mt-0.5">
                {classFilter === 'All' ? (isTeacherView ? 'My assigned classes' : 'School-wide Summary') : `${classFilter} (${sectionFilter === 'All' ? 'All Sections' : `Section ${sectionFilter}`})`}
                <span className="text-xs font-mono text-slate-400">· {yearFilter}</span>
              </h3>
            </div>
            
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-2 rounded-2xl text-xs text-slate-700">
              <User className="w-3.5 h-3.5 text-indigo-400" />
              <span>{isTeacherView ? <strong className="text-slate-900 font-semibold">Server-scoped access</strong> : <>Teacher: <strong className="text-slate-900 font-semibold">{currentClassTeacher}</strong></>}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5 pt-1">
            <div className="bg-indigo-50/60 border border-indigo-100 p-4 rounded-2xl flex flex-col justify-between hover:shadow-sm transition-all">
              <span className="text-[10px] font-bold text-indigo-400 tracking-wider uppercase">Total Students</span>
              <p className="text-2xl font-extrabold text-indigo-700 mt-2">{statsTotal}</p>
            </div>

            <div className="bg-blue-50/60 border border-blue-100 p-4 rounded-2xl flex flex-col justify-between hover:shadow-sm transition-all">
              <span className="text-[10px] font-bold text-blue-400 tracking-wider uppercase">Boys Ratio</span>
              <p className="text-2xl font-extrabold text-blue-600 mt-2">
                {statsBoys} <span className="text-xs font-normal text-slate-400">({statsTotal > 0 ? Math.round((statsBoys / statsTotal) * 100) : 0}%)</span>
              </p>
            </div>

            <div className="bg-pink-50/60 border border-pink-100 p-4 rounded-2xl flex flex-col justify-between hover:shadow-sm transition-all">
              <span className="text-[10px] font-bold text-pink-400 tracking-wider uppercase">Girls Ratio</span>
              <p className="text-2xl font-extrabold text-pink-500 mt-2">
                {statsGirls} <span className="text-xs font-normal text-slate-400">({statsTotal > 0 ? Math.round((statsGirls / statsTotal) * 100) : 0}%)</span>
              </p>
            </div>

            <div className="bg-emerald-50/60 border border-emerald-100 p-4 rounded-2xl flex flex-col justify-between hover:shadow-sm transition-all">
              <span className="text-[10px] font-bold text-emerald-400 tracking-wider uppercase">Class Attendance</span>
              <div className="flex items-baseline gap-1 mt-2">
                <p className="text-2xl font-extrabold text-emerald-600">{statsAvgAttendance === null ? '—' : `${statsAvgAttendance}%`}</p>
                <span className="text-[9px] text-slate-400 font-medium">avg</span>
              </div>
            </div>

            {isTeacherView ? (
              <div className="col-span-2 md:col-span-1 bg-amber-50/60 border border-amber-100 p-4 rounded-2xl flex flex-col justify-between hover:shadow-sm transition-all">
                <span className="text-[10px] font-bold text-amber-400 tracking-wider uppercase">Visible Classes</span>
                <div className="mt-2 flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-amber-500" />
                  <p className="text-2xl font-extrabold text-amber-600">{teacherClassNames.length}</p>
                </div>
              </div>
            ) : (
              <div className="col-span-2 md:col-span-1 bg-violet-50/60 border border-violet-100 p-4 rounded-2xl flex flex-col justify-between hover:shadow-sm transition-all">
                <span className="text-[10px] font-bold text-violet-400 tracking-wider uppercase">Fees Collected</span>
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-2xl font-extrabold text-violet-600">{statsFeeStatusPercent}%</p>
                  <div className="w-12 bg-violet-100 rounded-full h-2">
                    <div className="bg-violet-500 h-2 rounded-full" style={{ width: `${statsFeeStatusPercent}%` }}></div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {isAdding ? (
        /* ADMISSION REGISTRATION FORM */
        <div className="portal-header-card max-w-4xl mx-auto">
          <div className="border-b border-slate-100 pb-3 mb-5">
            <h3 className="font-sans font-bold text-slate-900 text-sm">{editingStudentId ? 'Edit Student Details' : 'Register New Student (Class-wise Admission)'}</h3>
            <p className="text-xs text-slate-500">{editingStudentId ? 'Update student profile and guardian contact details.' : 'Provide personal and guardian contact details to enroll instantly.'}</p>
          </div>

          <form onSubmit={handleCreate} className="space-y-6">
            
            {/* Primary Details Block */}
            <div>
              <h4 className="text-[11px] font-bold text-indigo-600 uppercase tracking-widest mb-3 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full"></span>
                1. Basic Personal Information
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Profile Photo</label>
                  <div className="mt-1 flex items-center gap-3">
                    {newPhotoPreview ? <AuthenticatedImage src={newPhotoPreview} alt="Student preview" className="h-12 w-12 rounded-full border border-slate-200 object-cover" /> : <span className="grid h-12 w-12 place-items-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-600">Photo</span>}
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => {
                      const file = event.target.files?.[0] || null;
                      if (!file) { setNewPhotoFile(null); setNewPhotoPreview(''); setNewPhotoSummary(''); return; }
                      try {
                        const optimized = await optimizeImageForUpload(file);
                        setNewPhotoFile(optimized.file);
                        setNewPhotoPreview(optimized.previewUrl);
                        setNewPhotoSummary(`${optimized.width}×${optimized.height} WebP · ${formatBytes(optimized.originalBytes)} → ${formatBytes(optimized.optimizedBytes)}`);
                      } catch (error) {
                        alert(error instanceof Error ? error.message : 'Photo optimization failed.');
                        event.target.value = '';
                      }
                    }} className="block w-full text-xs text-slate-500 file:mr-2 file:rounded-md file:border-0 file:bg-indigo-50 file:px-2 file:py-1.5 file:text-xs file:font-bold file:text-indigo-700" />
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">JPEG, PNG, or WebP.</p>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-200 mt-1 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    placeholder="e.g. Rohan Verma"
                  />
                </div>
                
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Date of Birth *</label>
                  <input
                    type="date"
                    required
                    value={newDob}
                    onChange={(e) => setNewDob(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-200 mt-1 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Gender *</label>
                  <select
                    value={newGender}
                    onChange={(e) => setNewGender(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-200 mt-1 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white"
                  >
                    <option>Male</option>
                    <option>Female</option>
                    <option>Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Blood Group</label>
                  <select
                    value={newBloodGroup}
                    onChange={(e) => setNewBloodGroup(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-200 mt-1 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white"
                  >
                    <option>A+</option>
                    <option>A-</option>
                    <option>B+</option>
                    <option>B-</option>
                    <option>O+</option>
                    <option>O-</option>
                    <option>AB+</option>
                    <option>AB-</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Aadhaar Card Number (Optional)</label>
                  <input
                    type="text"
                    value={newAadhaar}
                    onChange={(e) => setNewAadhaar(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-200 mt-1 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    placeholder="e.g. 5432-8765-1029"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Roll Number (Leave 0 for Auto)</label>
                  <input
                    type="number"
                    value={newRollNo}
                    onChange={(e) => setNewRollNo(parseInt(e.target.value) || 0)}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-200 mt-1 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    placeholder="e.g. 15"
                  />
                </div>
              </div>
            </div>

            {/* Class Placement Block */}
            <div>
              <h4 className="text-[11px] font-bold text-indigo-600 uppercase tracking-widest mb-3 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full"></span>
                2. Roster Placement & Academic Year
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Target Academic Term</label>
                  <select
                    value={yearFilter === 'All' ? (academicYears.find((y) => y.is_active)?.name || academicYears[0]?.name || allAvailableYears[0] || '') : yearFilter}
                    onChange={(e) => setYearFilter(e.target.value)}
                    disabled={!academicYears.length && !allAvailableYears.length}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-200 mt-1 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-slate-50 font-semibold text-slate-700"
                  >
                    {!academicYears.length && !allAvailableYears.length && <option value="">Create an academic year first</option>}
                    {academicYears.length > 0 ? (
                      academicYears.map((year) => (
                        <option key={year.id} value={year.name}>{year.name} Cycle{year.is_active ? ' (Active)' : ''}</option>
                      ))
                    ) : (
                      allAvailableYears.map((yearName) => (
                        <option key={yearName} value={yearName}>{yearName} Cycle</option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Grade/Class *</label>
                  <select
                    value={newClass}
                    onChange={(e) => {
                      const classroom = classOptions.find((item) => item.name === e.target.value);
                      const firstSection = sectionRecords.find((item) => item.classId === classroom?.id);
                      setNewClass(e.target.value);
                      setNewSection(firstSection?.name || '');
                      setNewSectionId(firstSection?.id);
                    }}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-200 mt-1 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white"
                  >
                    {!classOptions.length && <option value="">Create a class first</option>}
                    {classOptions.map((classroom) => (
                      <option key={classroom.id} value={classroom.name}>{classroom.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Assigned Section *</label>
                  <select
                    value={newSection}
                    onChange={(e) => {
                      const section = sectionOptions.find((item) => item.name === e.target.value);
                      setNewSection(e.target.value);
                      setNewSectionId(section?.id);
                    }}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-200 mt-1 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white"
                  >
                    {!sectionOptions.length && <option value="">Create a section for this class</option>}
                    {sectionOptions.map((section) => (
                      <option key={section.id} value={section.name}>{section.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Parent & Contact Details */}
            <div>
              <h4 className="text-[11px] font-bold text-indigo-600 uppercase tracking-widest mb-3 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full"></span>
                3. Parent, Guardian & Contact Info
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Primary Guardian Name *</label>
                  <input
                    type="text"
                    required
                    value={newParent}
                    onChange={(e) => setNewParent(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-200 mt-1 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    placeholder="e.g. Sunil Verma"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Father's Name</label>
                  <input
                    type="text"
                    value={newFatherName}
                    onChange={(e) => setNewFatherName(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-200 mt-1 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    placeholder="e.g. Sunil Verma"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Mother's Name</label>
                  <input
                    type="text"
                    value={newMotherName}
                    onChange={(e) => setNewMotherName(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-200 mt-1 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    placeholder="e.g. Meera Verma"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Parent Phone Number *</label>
                  <input
                    type="text"
                    required
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-200 mt-1 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    placeholder="e.g. +91 99999 88888"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Parent Email Address</label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-200 mt-1 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    placeholder="e.g. sunil@gmail.com"
                  />
                  <p className="mt-1 text-[10px] text-slate-500">Use the guardian’s own email. Staff and student account emails cannot also be parent logins.</p>
                </div>
              </div>

              <div className="mt-3">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Residential Address *</label>
                <textarea
                  required
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-200 mt-1 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none h-16"
                  placeholder="Street No, Building/Flat, Locality, City/State"
                />
              </div>
            </div>


            {/* Action buttons */}
            <div className="flex justify-end gap-3 pt-5 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setIsAdding(false);
                  resetStudentForm();
                }}
                className="portal-btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="portal-btn-primary"
              >
                {editingStudentId ? 'Save Student Changes' : 'Confirm Admission Registry'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        /* MAIN ERP STUDENT WORKSPACE (SPLIT PANELS) */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* LEFT PANEL: Directory list & Filter tools (col-span-5) */}
          <div className="portal-card flex h-[650px] min-h-0 flex-col overflow-hidden lg:sticky lg:top-0 lg:col-span-5 lg:h-[calc(100dvh-8rem)]" id="student-sidebar-directory">
            
            {/* Multi-Filters header */}
            <div className="p-4 bg-slate-50 border-b border-slate-200 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                
                {/* Year Filter */}
                <div>
                  <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Academic Year</label>
                  <select
                    value={yearFilter}
                    onChange={(e) => setYearFilter(e.target.value)}
                    className="text-xs p-2 w-full rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-indigo-500 font-mono font-semibold"
                  >
                    <option value="All">{isTeacherView ? 'All Years' : 'All Academic Years'}</option>
                    {directoryYearOptions.map((year) => (
                      <option key={year.id} value={year.name}>{year.name}</option>
                    ))}
                  </select>
                </div>

                {/* Class Filter */}
                <div>
                  <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Class/Grade</label>
                  <select
                    value={classFilter}
                    onChange={(e) => {
                      setClassFilter(e.target.value);
                      setSectionFilter('All');
                    }}
                    className="text-xs p-2 w-full rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-indigo-500 font-semibold"
                  >
                    <option value="All">{isTeacherView ? 'All Assigned' : 'All Grades'}</option>
                    {directoryClassNames.map((className) => (
                      <option key={className} value={className}>{className}</option>
                    ))}
                  </select>
                </div>

                {/* Section Filter */}
                <div>
                  <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Section</label>
                  <select
                    value={sectionFilter}
                    onChange={(e) => setSectionFilter(e.target.value)}
                    className="text-xs p-2 w-full rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-indigo-500 font-semibold"
                  >
                    <option value="All">All Sections</option>
                    {filterSections.map((section) => (
                      <option key={section} value={section}>Sec {section}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Advanced search (Query matches Name, Admission ID, Roll No, Class, Section, Mobile) */}
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search Name, ADM-ID, Roll, Mobile..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 text-xs w-full p-2.5 rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-500 bg-white text-slate-800 placeholder-slate-400 font-semibold"
                />
              </div>
            </div>

            {/* Scrollable list of filtered cohort */}
            {/* Scrollable list of filtered cohort */}
            <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-slate-100">
              {isRosterFetching && (
                <div className="py-1.5 px-4 bg-indigo-50/80 border-b border-indigo-100 text-[10px] text-indigo-700 font-bold flex items-center justify-between animate-fade-in">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-indigo-600 animate-ping"></span>
                    <span>Updating roster...</span>
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-wider text-indigo-500">Page {page}/{totalPages}</span>
                </div>
              )}
              {displayStudents.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs">
                  {isRosterLoading
                    ? 'Loading roster records from server...'
                    : isTeacherView
                    ? 'No students are linked to your assigned class sections for these filters.'
                    : 'No matching students found in this cycle.'}
                </div>
              ) : (
                displayStudents.map((student) => {
                  const isSelected = selectedStudent?.id === student.id;
                  return (
                    <div
                      key={student.id}
                      onClick={() => setSelectedStudentId(student.id)}
                      className={`p-4 flex items-center justify-between hover:bg-slate-50/70 cursor-pointer transition-all border-l-4 ${isSelected ? 'bg-indigo-50/50 border-l-indigo-600' : 'border-l-transparent'}`}
                    >
                      <div className="flex items-center gap-3">
                        {renderProfilePhoto(student, "w-9 h-9 text-[11px]")}
                        <div>
                          <p className="text-xs font-bold text-slate-900">{student.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-400 font-mono">
                            <span>{student.admissionNo}</span>
                            <span>·</span>
                            <span>Roll #{student.rollNo}</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="text-right shrink-0">
                        <span className="inline-block text-[10px] font-bold bg-slate-100 text-slate-700 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                          {student.class}-{student.section}
                        </span>
                        <div className="mt-1">
                          {student.status === 'TC_Issued' ? (
                            <span className="text-[9px] font-bold text-rose-500 uppercase">TC Issued</span>
                          ) : student.status === 'Promoted' ? (
                            <span className="text-[9px] font-bold text-indigo-500 uppercase">Archived</span>
                          ) : (
                            <span className="text-[9px] font-bold text-emerald-500 uppercase">Active</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            
            {/* Total Indicator footer & Pagination controls */}
            <div className="p-3 bg-slate-50 border-t border-slate-100 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600">
                <span>
                  Showing{' '}
                  <strong className="text-slate-900">
                    {totalCohortCount === 0 ? 0 : (page - 1) * pageSize + 1} - {Math.min(page * pageSize, totalCohortCount)}
                  </strong>{' '}
                  of <strong className="text-indigo-700 font-bold">{totalCohortCount.toLocaleString()}</strong> students
                </span>

                <div className="flex items-center gap-1 text-[10px]">
                  <span className="text-slate-400">Rows:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    className="bg-white border border-slate-200 rounded px-1.5 py-0.5 text-[10px] font-bold text-slate-700 focus:outline-none focus:border-indigo-500"
                  >
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={250}>250</option>
                  </select>
                </div>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage(1)}
                      title="First page"
                      className="p-1 rounded hover:bg-white text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed"
                    >
                      <ChevronsLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      title="Previous page"
                      className="p-1 rounded hover:bg-white text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-1 text-[11px] font-bold text-slate-700">
                    <span>Page</span>
                    <span className="px-2 py-0.5 bg-white border border-slate-200 rounded font-mono text-indigo-700">
                      {page}
                    </span>
                    <span>of {totalPages}</span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      title="Next page"
                      className="p-1 rounded hover:bg-white text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => setPage(totalPages)}
                      title="Last page"
                      className="p-1 rounded hover:bg-white text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed"
                    >
                      <ChevronsRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT PANEL: Comprehensive Student details tabs (col-span-7) */}
          <div className="lg:col-span-7 space-y-6">
            {selectedStudent ? (
              <div className="space-y-6">
                
                {/* ID Identification header */}
                <div className="portal-header-card flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center !p-5">
                  <div className="flex items-center gap-4">
                    {renderProfilePhoto(selectedStudent, "w-14 h-14 text-base")}
                    <div>
                      <span className="text-[9px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md font-bold uppercase tracking-wider font-mono">
                        Cycle {selectedStudent.academicYear}
                      </span>
                      <h3 className="text-base font-extrabold text-slate-900 font-sans tracking-tight mt-1">{selectedStudent.name}</h3>
                      <p className="text-xs text-slate-500">
                        Class: <strong className="text-slate-800">{selectedStudent.class} - {selectedStudent.section}</strong> · Admission: <strong className="text-slate-800 font-mono">{selectedStudent.admissionNo}</strong>{isTeacherView && <> · Roll: <strong className="text-slate-800 font-mono">#{selectedStudent.rollNo}</strong></>}
                      </p>
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    {selectedStudent.status === 'TC_Issued' ? (
                      <span className="bg-rose-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-md uppercase tracking-wider">
                        Locked (TC Issued)
                      </span>
                    ) : selectedStudent.status === 'Promoted' ? (
                      <span className="bg-indigo-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-md uppercase tracking-wider">
                        Term Promoted
                      </span>
                    ) : (
                      <span className="bg-emerald-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-md uppercase tracking-wider">
                        Active Enrolled
                      </span>
                    )}

                    {!isTeacherView && selectedStudent.status === 'Active' && onPromoteStudent && (
                      <button
                        type="button"
                        onClick={() => handleOpenPromoteModal(selectedStudent)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-xs hover:shadow transition cursor-pointer"
                        title="Promote student to next higher class (Requires ≥50% Fee Clearance)"
                      >
                        <GraduationCap className="w-3.5 h-3.5" />
                        <span>Promote Class</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Sub-tabs Selection for specific profiles attributes */}
                <div className="portal-card overflow-hidden">
                  {detailsTabs.length > 1 && (
                    <div className="flex border-b border-slate-100 bg-slate-50 overflow-x-auto divide-x divide-slate-100" id="profile-sub-tabs">
                      {detailsTabs.map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => setActiveDetailsTab(tab.id)}
                          className={`px-4 py-3 text-xs font-bold tracking-wide transition-all ${activeDetailsTab === tab.id ? 'bg-white text-indigo-600 border-t-2 border-indigo-600' : 'text-slate-500 hover:text-slate-900'}`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="p-5">
                    {/* TAB 1: Profile & Contact */}
                    {activeDetailsTab === 'Profile' && (
                      <div className="space-y-4" id="tab-profile-details">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)]">
                          <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center">
                            {selectedStudent.photoUrl ? (
                              <AuthenticatedImage src={selectedStudent.photoUrl} alt={`${selectedStudent.name}'s profile`} className="h-28 w-28 rounded-full border-2 border-white object-cover shadow-sm" />
                            ) : (
                              <>
                                <div className="grid h-20 w-20 place-items-center rounded-full bg-indigo-100 text-indigo-600">
                                  <User className="h-9 w-9" />
                                </div>
                                <p className="mt-3 text-xs font-bold text-slate-600">No photo uploaded</p>
                                <p className="mt-1 text-[10px] text-slate-400">Student profile image</p>
                              </>
                            )}
                          </div>
                          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                            <span className="text-[10px] text-slate-400 font-bold uppercase">Personal Particulars</span>
                            <div className="mt-2 space-y-1.5 text-xs text-slate-600">
                              <p>Date of Birth: <strong className="text-slate-800 font-mono">{selectedStudent.dob}</strong></p>
                              <p>Gender: <strong className="text-slate-800">{selectedStudent.gender}</strong></p>
                              {isTeacherView ? (
                                <>
                                  <p>Admission ID: <strong className="text-slate-800 font-mono">{selectedStudent.admissionNo}</strong></p>
                                  <p>Roll Number: <strong className="text-slate-800 font-mono">#{selectedStudent.rollNo}</strong></p>
                                  <p>Status: <strong className="text-slate-800">{selectedStudent.status}</strong></p>
                                </>
                              ) : (
                                <>
                                  <p>Blood Group: <strong className="text-slate-800 font-mono">{selectedStudent.bloodGroup || 'Not recorded'}</strong></p>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span>Aadhaar UID: <strong className="text-slate-800 font-mono">{selectedStudent.aadhaar || 'Not Recorded'}</strong></span>
                                    {(() => {
                                      const aadhaarDoc = (selectedStudent.documents || []).find((d) =>
                                        `${d.category || ''} ${d.name || ''}`.toLowerCase().includes('aadhaar') || `${d.category || ''} ${d.name || ''}`.toLowerCase().includes('adhar')
                                      );
                                      if (!aadhaarDoc) return null;
                                      if (aadhaarDoc.status === 'Verified') {
                                        return (
                                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                                            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Verified
                                          </span>
                                        );
                                      }
                                      if (aadhaarDoc.status === 'Rejected') {
                                        return (
                                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                                            <AlertCircle className="w-3 h-3 text-rose-600" /> Rejected
                                          </span>
                                        );
                                      }
                                      return (
                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                                          <Clock className="w-3 h-3 text-amber-600" /> Pending Review
                                        </span>
                                      );
                                    })()}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                            <span className="text-[10px] text-slate-400 font-bold uppercase">Parent / Guardian Details</span>
                            <div className="mt-2 space-y-1.5 text-xs text-slate-600">
                              <p>Primary Guardian: <strong className="text-slate-800">{selectedStudent.parentName}</strong></p>
                              {!isTeacherView && <p>Father Name: <strong className="text-slate-800">{selectedStudent.fatherName || selectedStudent.parentName}</strong></p>}
                              {!isTeacherView && <p>Mother Name: <strong className="text-slate-800">{selectedStudent.motherName || 'Not Specified'}</strong></p>}
                              <p>Emergency Phone: <strong className="text-indigo-600 font-mono">{selectedStudent.parentPhone}</strong></p>
                            </div>
                          </div>
                        </div>

                        {isTeacherView && (
                          <section className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">Class subjects</span>
                            <p className="mt-1 text-xs text-slate-600">Subjects configured for {selectedStudent.class} - {selectedStudent.section}.</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {selectedStudentSubjects.length ? selectedStudentSubjects.map((subject) => (
                                <span key={subject.id} className="rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[10px] font-bold text-indigo-700">{subject.name}</span>
                              )) : <span className="text-xs font-semibold text-amber-700">No subjects are assigned to this class yet.</span>}
                            </div>
                          </section>
                        )}

                        {!isTeacherView && <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 space-y-1 text-xs text-slate-600">
                          <span className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Contact & Communication Address</span>
                          <p className="flex items-center gap-1.5 mt-1">
                            <Smartphone className="w-3.5 h-3.5 text-slate-400" />
                            <span>Mobile Phone: <strong className="text-slate-800 font-mono">{selectedStudent.parentPhone}</strong></span>
                          </p>
                          <p className="flex items-center gap-1.5 mt-1">
                            <FileText className="w-3.5 h-3.5 text-slate-400" />
                            <span>Parent Email: <strong className="text-slate-800 font-mono">{selectedStudent.parentEmail}</strong></span>
                          </p>
                          <p className="flex items-start gap-1.5 mt-1">
                            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                            <span>Address: <strong className="text-slate-800 leading-normal">{selectedStudent.address}</strong></span>
                          </p>
                        </div>}

                        {!isTeacherView && (() => {
                          const loginDetails = getLoginDetailsForStudent(selectedStudent);
                          return (
                            <div className="p-3 bg-emerald-50/70 rounded-lg border border-emerald-100 text-xs text-slate-700">
                              <div className="flex flex-col gap-3">
                                <div className="min-w-0">
                                  <span className="text-[10px] text-emerald-600 font-bold uppercase block mb-2">Login Details — Student & Parent</span>
                                  <div className="grid grid-cols-1 gap-2">
                                    <div className="min-w-0 rounded-lg bg-white border border-emerald-100 p-3">
                                      <p className="text-[10px] font-bold uppercase text-slate-400">Student Login</p>
                                      <p className="mt-1 break-all font-mono"><strong>Email:</strong> {loginDetails.studentEmail}</p>
                                      <p className="mt-1 break-all font-mono"><strong>Password:</strong> {loginDetails.studentPassword}</p>
                                      <button onClick={() => void resetCredentials('Student', loginDetails.studentUserId)} className="mt-3 rounded-lg border border-indigo-200 px-2.5 py-1 text-[10px] font-bold text-indigo-700 hover:bg-indigo-50">Reset Student credentials</button>
                                    </div>
                                    <div className="min-w-0 rounded-lg bg-white border border-emerald-100 p-3">
                                      <p className="text-[10px] font-bold uppercase text-slate-400">Parent Login</p>
                                      <p className="mt-1 break-all font-mono"><strong>Email:</strong> {loginDetails.parentEmail}</p>
                                      <p className="mt-1 break-all font-mono"><strong>Password:</strong> {loginDetails.parentPassword}</p>
                                      <button onClick={() => void resetCredentials('Parent', loginDetails.parentUserId)} className="mt-3 rounded-lg border border-indigo-200 px-2.5 py-1 text-[10px] font-bold text-indigo-700 hover:bg-indigo-50">Reset Parent credentials</button>
                                    </div>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => copyLoginDetails(selectedStudent)}
                                  className={`self-start inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-bold text-white transition-all cursor-pointer ${
                                    copiedLoginDetails ? 'bg-emerald-700 ring-2 ring-emerald-300' : 'bg-emerald-600 hover:bg-emerald-700 active:scale-95'
                                  }`}
                                >
                                  {copiedLoginDetails ? (
                                    <>
                                      <Check className="h-3.5 w-3.5 text-emerald-200" />
                                      Copied Login IDs!
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="h-3.5 w-3.5" />
                                      Copy Login IDs
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>
                          );
                        })()}

                      </div>
                    )}

                    {/* TAB 2: Fees Ledger */}
                    {!isTeacherView && activeDetailsTab === 'Fees' && (
                      <div className="space-y-4" id="tab-fees-details">
                        <div className="grid grid-cols-3 gap-3">
                          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-center">
                            <span className="text-[9px] text-slate-400 font-bold uppercase">TOTAL ANNUAL</span>
                            <p className="text-base font-extrabold text-slate-800 mt-1 font-mono">₹{selectedStudent.feeTotal ?? 0}</p>
                          </div>
                          <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-100 text-center">
                            <span className="text-[9px] text-emerald-600 font-bold uppercase">PAID SO FAR</span>
                            <p className="text-base font-extrabold text-emerald-800 mt-1 font-mono">₹{selectedStudent.feePaid ?? 0}</p>
                          </div>
                          <div className="p-3 bg-rose-50 rounded-lg border border-rose-100 text-center">
                            <span className="text-[9px] text-rose-600 font-bold uppercase">OUTSTANDING</span>
                            <p className="text-base font-extrabold text-rose-800 mt-1 font-mono">₹{Math.max(0, (selectedStudent.feeTotal ?? 0) - (selectedStudent.feePaid ?? 0))}</p>
                          </div>
                        </div>

                        {/* 50% Fee Promotion Policy Card */}
                        {(() => {
                          const total = Number(selectedStudent.feeTotal || 0);
                          const paid = Number(selectedStudent.feePaid || 0);
                          const pct = total > 0 ? (paid / total) * 100 : 100;
                          const eligible = total === 0 || pct >= 50;
                          const minReq = total * 0.5;
                          const shortfall = Math.max(0, minReq - paid);

                          return (
                            <div className={`p-4 rounded-xl border ${eligible ? 'bg-emerald-50/50 border-emerald-200' : 'bg-amber-50/50 border-amber-200'} space-y-2.5`}>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div className={`p-1.5 rounded-lg ${eligible ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                    <GraduationCap className="w-4 h-4" />
                                  </div>
                                  <div>
                                    <h4 className="text-xs font-bold text-slate-900">Class Promotion Fee Clearance Status</h4>
                                    <p className="text-[11px] text-slate-500">Students must clear at least 50% of annual fees to advance to the next higher class.</p>
                                  </div>
                                </div>
                                <span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider ${
                                  eligible ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white'
                                }`}>
                                  {eligible ? 'Eligible (≥ 50% Paid)' : 'Ineligible (< 50% Paid)'}
                                </span>
                              </div>

                              <div className="space-y-1">
                                <div className="flex justify-between text-[11px] font-bold">
                                  <span className="text-slate-600">Fee Clearance Progress: {pct.toFixed(1)}%</span>
                                  <span className="text-slate-500 font-mono">₹{paid.toLocaleString()} / ₹{total.toLocaleString()} (Min ₹{minReq.toLocaleString()})</span>
                                </div>
                                <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden relative">
                                  <div
                                    className={`h-full transition-all duration-500 ${eligible ? 'bg-emerald-500' : 'bg-amber-500'}`}
                                    style={{ width: `${Math.min(100, pct)}%` }}
                                  />
                                </div>
                              </div>

                              {!eligible && (
                                <p className="text-[11px] text-amber-800 font-medium">
                                  Pending fee shortfall of <strong className="font-mono">₹{shortfall.toLocaleString()}</strong> needed to satisfy the 50% threshold for next-class promotion.
                                </p>
                              )}
                            </div>
                          );
                        })()}

                        <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 space-y-2 text-xs">
                          <span className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Receipt Register</span>
                          <div className="flex items-center justify-between p-2 bg-white rounded border border-slate-100">
                            <div>
                              <p className="font-bold text-slate-800">Quarter 1 Tuition Fee</p>
                              <p className="text-[10px] text-slate-400 font-mono">Receipt: SCH-Q1-2026</p>
                            </div>
                            <div className="text-right">
                              <p className="font-bold font-mono">₹{selectedStudent.feePaid ?? 0}</p>
                              <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded ${selectedStudent.feePaid && selectedStudent.feePaid > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                                {selectedStudent.feePaid && selectedStudent.feePaid > 0 ? 'PAID' : 'PENDING'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* TAB 3: Documents Folder & Administrative Verification */}
                    {!isTeacherView && activeDetailsTab === 'Documents' && (
                      <div className="space-y-4" id="tab-documents-folder">
                        {/* Top Summary Banner for Documents */}
                        {(() => {
                          const docList = selectedStudent.documents || [];
                          const verified = docList.filter((d) => d.status === 'Verified').length;
                          const pending = docList.filter((d) => d.status === 'Pending' || d.status === 'Uploaded' || !d.status).length;
                          const rejected = docList.filter((d) => d.status === 'Rejected').length;

                          return (
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Total Files</span>
                                <span className="text-lg font-black text-slate-800">{docList.length}</span>
                              </div>
                              <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 block">Verified & Approved</span>
                                <span className="text-lg font-black text-emerald-800">{verified}</span>
                              </div>
                              <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-3">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 block">Awaiting Review</span>
                                <span className="text-lg font-black text-amber-800">{pending}</span>
                              </div>
                              <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-3">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 block">Needs Attention</span>
                                <span className="text-lg font-black text-rose-800">{rejected}</span>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Submitted Documents & Verification Workspace */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                              Student Dossier & Verification Queue
                            </span>
                            <span className="text-[10px] font-medium text-slate-400">
                              {(selectedStudent.documents || []).length} Document{((selectedStudent.documents || []).length !== 1) ? 's' : ''} on record
                            </span>
                          </div>

                          {selectedStudent.documents && selectedStudent.documents.length > 0 ? (
                            <div className="space-y-2.5">
                              {selectedStudent.documents.map((doc, idx) => {
                                const theme = getDocCategoryTheme(doc.category, doc.name);
                                const isVerified = doc.status === 'Verified';
                                const isRejected = doc.status === 'Rejected';
                                const isPending = doc.status === 'Pending' || doc.status === 'Uploaded' || !doc.status;
                                const isRejectingThis = rejectingDocId === doc.id;

                                return (
                                  <div
                                    key={doc.id || `${doc.name}-${idx}`}
                                    className={`rounded-2xl border p-3.5 transition-all bg-white shadow-2xs hover:shadow-xs ${
                                      isVerified
                                        ? 'border-slate-200/90 hover:border-slate-300'
                                        : isRejected
                                        ? 'border-rose-200/90 bg-rose-50/15'
                                        : 'border-amber-200/90 bg-amber-50/15'
                                    }`}
                                  >
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                      {/* Left: Icon, Title & Metadata */}
                                      <div className="flex items-center gap-3 min-w-0">
                                        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${theme.bg} ${theme.border} border shadow-2xs`}>
                                          {getDocCategoryIcon(doc.category, doc.name)}
                                        </div>
                                        <div className="min-w-0">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <h4 className="font-bold text-sm text-slate-900 leading-snug truncate">
                                              {doc.name}
                                            </h4>
                                            {doc.category && doc.category.toLowerCase().trim() !== doc.name.toLowerCase().trim() && (
                                              <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold border ${theme.badge}`}>
                                                {doc.category}
                                              </span>
                                            )}
                                          </div>
                                          <p className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5 font-normal">
                                            <span className="text-slate-600 font-medium truncate max-w-[180px] sm:max-w-[240px]">
                                              {doc.fileName || 'Uploaded file'}
                                            </span>
                                            <span>•</span>
                                            <span className="uppercase font-semibold text-[10px] text-slate-400">{doc.fileType || (doc.fileName?.endsWith('.pdf') ? 'PDF' : 'JPG')}</span>
                                            {doc.uploadedAt && (
                                              <>
                                                <span>•</span>
                                                <span>Uploaded {new Date(doc.uploadedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                              </>
                                            )}
                                            {isVerified && (
                                              <>
                                                <span>•</span>
                                                <span className="text-emerald-700 font-semibold inline-flex items-center gap-0.5">
                                                  <Check className="h-3 w-3 inline text-emerald-600" /> Verified
                                                  {doc.verifiedAt ? ` on ${new Date(doc.verifiedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
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
                                            <><Clock className="h-3 w-3 text-amber-600" /> Pending Review</>
                                          )}
                                        </span>

                                        {/* Action Buttons Toolbar */}
                                        <div className="flex items-center gap-1 border-l border-slate-200 pl-2">
                                          {/* View Preview Button */}
                                          <button
                                            type="button"
                                            onClick={() => void handlePreviewDocument(doc)}
                                            disabled={isPreviewLoadingDocId === doc.id}
                                            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 text-xs font-bold transition-all shadow-2xs disabled:opacity-50"
                                            title="View Document Preview"
                                          >
                                            <Eye className="h-3.5 w-3.5" />
                                            {isPreviewLoadingDocId === doc.id ? 'Loading...' : 'View'}
                                          </button>

                                          {/* Download Button */}
                                          <button
                                            type="button"
                                            onClick={() => void handleDocumentDownload(doc)}
                                            disabled={isDownloadingDocId === doc.id}
                                            className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-2xs disabled:opacity-50"
                                            title="Download File"
                                          >
                                            <Download className="h-3.5 w-3.5" />
                                          </button>

                                          {/* Verify Action Button */}
                                          {!isVerified && (
                                            <button
                                              type="button"
                                              onClick={() => void handleVerifyDocument(doc)}
                                              disabled={isVerifyingDocId === doc.id}
                                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 text-xs font-bold transition-all shadow-2xs disabled:opacity-50"
                                              title="Approve and verify document"
                                            >
                                              <Check className="h-3.5 w-3.5" />
                                              Verify
                                            </button>
                                          )}

                                          {/* Reject Action Button */}
                                          {!isRejected && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setRejectingDocId(doc.id ?? null);
                                                setRejectRemarks('');
                                              }}
                                              disabled={isVerifyingDocId === doc.id}
                                              className="rounded-lg border border-rose-200 bg-rose-50/70 p-1.5 text-rose-600 hover:bg-rose-100 transition-colors shadow-2xs disabled:opacity-50"
                                              title="Reject document with feedback"
                                            >
                                              <X className="h-3.5 w-3.5" />
                                            </button>
                                          )}

                                          {/* Delete Document Button */}
                                          <button
                                            type="button"
                                            onClick={() => void handleDeleteDocument(doc)}
                                            className="rounded-lg border border-transparent p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                            title="Delete document"
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </button>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Rejection Feedback Note (if previously rejected and not currently editing) */}
                                    {isRejected && !isRejectingThis && (
                                      <div className="mt-2.5 rounded-xl border border-rose-200 bg-rose-50/60 p-2.5 text-xs text-rose-900 flex items-start gap-2">
                                        <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                                        <div className="min-w-0">
                                          <span className="font-bold text-rose-800">Admin Rejection Remarks: </span>
                                          <span className="text-rose-700 font-medium">{doc.remarks || 'Document was rejected. Student must re-upload a clear copy.'}</span>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setRejectingDocId(doc.id ?? null);
                                              setRejectRemarks(doc.remarks || '');
                                            }}
                                            className="ml-2 text-[11px] font-bold text-rose-700 hover:underline"
                                          >
                                            (Edit feedback)
                                          </button>
                                        </div>
                                      </div>
                                    )}

                                    {/* Interactive Inline Rejection Drawer */}
                                    {isRejectingThis && (
                                      <div className="mt-2.5 rounded-xl border border-rose-200 bg-rose-50/80 p-3 animate-in fade-in">
                                        <label className="block text-xs font-bold text-rose-900 mb-1">
                                          Rejection feedback (visible to student):
                                        </label>

                                        <div className="flex flex-wrap gap-1.5 mb-2">
                                          {[
                                            'Scan is blurry / illegible',
                                            'Aadhaar UID number mismatch',
                                            'Missing back side of Aadhaar',
                                            'Name / DOB does not match school record',
                                            'Incorrect or expired document',
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
                                            placeholder="Type rejection reason or select a preset above..."
                                            className="flex-1 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                                          />
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setRejectingDocId(null);
                                              setRejectRemarks('');
                                            }}
                                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                                          >
                                            Cancel
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => void handleRejectDocument(doc)}
                                            disabled={isVerifyingDocId === doc.id}
                                            className="rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50 transition-colors shadow-2xs"
                                          >
                                            Confirm Rejection
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="p-6 text-center border-2 border-dashed border-slate-200 rounded-2xl">
                              <ShieldCheck className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                              <p className="text-xs font-bold text-slate-600">No documents submitted yet</p>
                              <p className="text-[11px] text-slate-400 mt-0.5">
                                When this student uploads their Aadhaar card or certificates, they will appear here for administrative verification.
                              </p>
                            </div>
                          )}
                        </div>

                        {/* In-App Document Preview Modal */}
                        {previewDoc && createPortal(
                          <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-950/80 backdrop-blur-md flex min-h-full items-center justify-center p-3 sm:p-6 animate-fade-in" role="presentation">
                            <div className="relative my-auto flex h-full max-h-[88vh] w-full max-w-5xl flex-col rounded-3xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
                              {/* Modal Header */}
                              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50">
                                <div className="flex items-center gap-3">
                                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-600 text-white">
                                    {previewDoc.isPdf ? <FileText className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <h3 className="text-base font-black text-slate-900 truncate max-w-md">
                                        {previewDoc.doc.name}
                                      </h3>
                                      <span
                                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                          previewDoc.doc.status === 'Verified'
                                            ? 'bg-emerald-100 text-emerald-800'
                                            : previewDoc.doc.status === 'Rejected'
                                            ? 'bg-rose-100 text-rose-800'
                                            : 'bg-amber-100 text-amber-800'
                                        }`}
                                      >
                                        {previewDoc.doc.status || 'Pending Review'}
                                      </span>
                                    </div>
                                    <p className="text-[11px] font-mono text-slate-400">
                                      {previewDoc.doc.fileName || 'document'} · {previewDoc.doc.category || 'Identity Proof'}
                                    </p>
                                  </div>
                                </div>

                                {/* Controls */}
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => setPreviewDoc((prev) => prev ? { ...prev, scale: Math.max(0.5, +(prev.scale - 0.25).toFixed(2)) } : null)}
                                    className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 transition-colors"
                                    title="Zoom Out"
                                  >
                                    <ZoomOut className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => setPreviewDoc((prev) => prev ? { ...prev, scale: 1, rotation: 0 } : null)}
                                    className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                                    title="Reset Zoom"
                                  >
                                    {Math.round(previewDoc.scale * 100)}%
                                  </button>
                                  <button
                                    onClick={() => setPreviewDoc((prev) => prev ? { ...prev, scale: Math.min(3, +(prev.scale + 0.25).toFixed(2)) } : null)}
                                    className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 transition-colors"
                                    title="Zoom In"
                                  >
                                    <ZoomIn className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => setPreviewDoc((prev) => prev ? { ...prev, rotation: (prev.rotation + 90) % 360 } : null)}
                                    className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 transition-colors"
                                    title="Rotate 90°"
                                  >
                                    <RotateCw className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => handleDocumentDownload(previewDoc.doc)}
                                    className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 transition-colors"
                                    title="Download File"
                                  >
                                    <Download className="h-4 w-4" />
                                  </button>
                                  <a
                                    href={previewDoc.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 transition-colors"
                                    title="Open in new window"
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                  </a>
                                  <button
                                    onClick={closeDocPreview}
                                    className="rounded-xl bg-slate-200 p-2 text-slate-700 hover:bg-slate-300 transition-colors ml-2"
                                    title="Close Preview"
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>

                              {/* Modal Body */}
                              <div className="flex-1 overflow-auto bg-slate-900 p-4 flex items-center justify-center">
                                {previewDoc.isPdf ? (
                                  <iframe
                                    src={previewDoc.url}
                                    title={previewDoc.doc.name}
                                    className="h-full w-full rounded-2xl bg-white shadow-lg border-0"
                                  />
                                ) : (
                                  <div className="overflow-auto max-h-full max-w-full flex items-center justify-center">
                                    <img
                                      src={previewDoc.url}
                                      alt={previewDoc.doc.name}
                                      style={{
                                        transform: `scale(${previewDoc.scale}) rotate(${previewDoc.rotation}deg)`,
                                        transition: 'transform 0.15s ease-out',
                                      }}
                                      className="max-h-[75vh] max-w-full rounded-xl object-contain shadow-2xl"
                                    />
                                  </div>
                                )}
                              </div>

                              {/* Modal Footer */}
                              <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3 bg-slate-50 text-xs text-slate-600">
                                <div className="flex items-center gap-2">
                                  <span>Document Category: <strong className="text-slate-800 font-bold">{previewDoc.doc.category || 'Identity Proof'}</strong></span>
                                  {previewDoc.doc.verifiedAt && (
                                    <span className="text-emerald-700 font-semibold">
                                      · Approved on {new Date(previewDoc.doc.verifiedAt).toLocaleDateString()}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  {previewDoc.doc.status !== 'Verified' && (
                                    <button
                                      onClick={() => void handleVerifyDocument(previewDoc.doc)}
                                      className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 text-xs font-bold transition-all"
                                    >
                                      Verify & Approve
                                    </button>
                                  )}
                                  <button
                                    onClick={closeDocPreview}
                                    className="rounded-xl border border-slate-300 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
                                  >
                                    Done
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>,
                          document.body
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Administration Administrative Actions box */}
                {canManageStudents && <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-4">
                  <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-slate-400" />
                    Administrative Actions
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <button
                      onClick={() => startEditStudent(selectedStudent)}
                      className="flex items-center justify-between p-3.5 bg-sky-50/70 border border-sky-100 hover:border-sky-300 text-sky-700 hover:text-sky-800 rounded-xl text-xs font-bold transition-all"
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-sky-500" />
                        <span>Edit Student Details</span>
                      </div>
                      <span className="text-[9px] font-mono bg-sky-100 text-sky-700 px-2 py-0.5 rounded font-bold uppercase">EDIT</span>
                    </button>

                    <button
                      onClick={async () => {
                        if (!confirm(`Delete student profile for ${selectedStudent.name}? This permanently removes the student and any login accounts that are no longer linked to a student.`)) return;
                        try {
                          await onDeleteStudent(selectedStudent.id);
                          setSelectedStudentId(null);
                        } catch (error) {
                          alert(error instanceof Error ? error.message : 'The student could not be deleted. Please try again.');
                        }
                      }}
                      className="flex items-center justify-between p-3.5 bg-red-50/70 border border-red-100 hover:border-red-300 text-red-700 hover:text-red-800 rounded-xl text-xs font-bold transition-all"
                    >
                      <div className="flex items-center gap-2">
                        <Trash2 className="w-4 h-4 text-red-500" />
                        <span>Delete Student Profile</span>
                      </div>
                      <span className="text-[9px] font-mono bg-red-100 text-red-700 px-2 py-0.5 rounded font-bold uppercase">DELETE</span>
                    </button>

                    {selectedStudent.status === 'Active' && onPromoteStudent && (
                      <button
                        onClick={() => handleOpenPromoteModal(selectedStudent)}
                        className="flex items-center justify-between p-3.5 bg-purple-50/70 border border-purple-100 hover:border-purple-300 text-purple-700 hover:text-purple-800 rounded-xl text-xs font-bold transition-all sm:col-span-2 cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="p-1 rounded-lg bg-purple-100 text-purple-700">
                            <GraduationCap className="w-4 h-4" />
                          </div>
                          <div className="text-left">
                            <p className="font-extrabold text-purple-900">Promote to Next Higher Class</p>
                            <p className="text-[10px] text-purple-600 font-normal">Advance student grade level (Requires minimum 50% fee clearance)</p>
                          </div>
                        </div>
                        <span className="text-[9px] font-mono bg-purple-200/80 text-purple-800 px-2.5 py-1 rounded font-bold uppercase tracking-wider">PROMOTE</span>
                      </button>
                    )}

                  </div>
                </div>}
              </div>
            ) : (
              <div className="bg-white p-12 rounded-xl border border-slate-200 text-center text-slate-400 text-xs shadow-xs">
                {isTeacherView
                  ? `No assigned students match these filters${yearFilter ? ` for ${yearFilter}` : ''}.`
                  : `No students match your query criteria in Academic Year ${yearFilter}. Choose another academic cycle or enroll a student.`}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    {canManageStudents && revealedCredential && createPortal(
      <div className="fixed inset-0 z-[9999] overflow-y-auto bg-black/55 backdrop-blur-sm flex min-h-full items-center justify-center p-3 sm:p-5 animate-fade-in" role="presentation">
        <section className="w-full max-w-lg max-h-[85vh] my-auto flex flex-col rounded-3xl border border-emerald-200 bg-white p-6 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95" role="dialog" aria-modal="true" aria-labelledby="reset-credential-title">
          <div className="flex-shrink-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600">New one-time credentials</p>
            <h2 id="reset-credential-title" className="mt-1 text-lg font-extrabold text-slate-900">{revealedCredential.role} password reset</h2>
            <p className="mt-1.5 text-xs text-slate-600">Copy this password now. It will not be shown again, and the user must change it after signing in.</p>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 my-4 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs text-slate-900">
            <p className="break-all"><span className="font-sans font-bold text-slate-500">Login ID: </span>{revealedCredential.loginId}</p>
            <p className="break-all"><span className="font-sans font-bold text-slate-500">Temporary password: </span>{revealedCredential.temporaryPassword}</p>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={async () => {
                const text = `Login ID: ${revealedCredential.loginId}\nTemporary password: ${revealedCredential.temporaryPassword}`;
                const success = await copyToClipboard(text);
                if (success) {
                  setCopiedCredentialModal(true);
                  setTimeout(() => setCopiedCredentialModal(false), 2500);
                }
              }}
              className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition-all cursor-pointer ${
                copiedCredentialModal
                  ? 'border border-emerald-300 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-300'
                  : 'border border-indigo-200 text-indigo-700 hover:bg-indigo-50 active:scale-95'
              }`}
            >
              {copiedCredentialModal ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  Copied credentials!
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy credentials
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setRevealedCredential(null);
                setCopiedCredentialModal(false);
              }}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 cursor-pointer"
            >
              I copied it
            </button>
          </div>
        </section>
      </div>,
      document.body,
    )}
    {promoteStudentTarget && createPortal(
      <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex min-h-full items-center justify-center p-3 sm:p-4 animate-fade-in" role="presentation">
        <section className="w-full max-w-xl my-auto flex flex-col rounded-2xl border border-slate-100 bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95" role="dialog" aria-modal="true" aria-labelledby="promote-modal-title">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-gradient-to-r from-purple-50/70 via-indigo-50/50 to-white">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-purple-100 p-2 text-purple-700 shrink-0">
                <GraduationCap className="h-5 w-5" />
              </div>
              <div>
                <h3 id="promote-modal-title" className="font-black text-slate-900 text-sm leading-tight">Promote Student to Higher Class</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {promoteStudentTarget.name} ({promoteStudentTarget.admissionNo}) · Current: <strong>{promoteStudentTarget.class}-{promoteStudentTarget.section}</strong>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPromoteStudentTarget(null)}
              className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 space-y-4">
            {/* Fee Clearance Requirement Evaluation */}
            {(() => {
              const total = Number(promoteStudentTarget.feeTotal || 0);
              const paid = Number(promoteStudentTarget.feePaid || 0);
              const pct = total > 0 ? (paid / total) * 100 : 100;
              const isEligible = total === 0 || pct >= 50;
              const minRequired = total * 0.5;
              const shortfall = Math.max(0, minRequired - paid);

              return (
                <div className={`rounded-xl border p-3.5 space-y-2.5 ${
                  isEligible ? 'bg-emerald-50/40 border-emerald-200' : 'bg-rose-50/40 border-rose-200'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 text-slate-700">
                      <ShieldCheck className={`h-4 w-4 ${isEligible ? 'text-emerald-600' : 'text-rose-600'}`} />
                      50% Fee Clearance Requirement
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                      isEligible ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                    }`}>
                      {isEligible ? 'Criteria Fulfilled (≥50%)' : 'Criteria Not Met (<50%)'}
                    </span>
                  </div>

                  {/* Progress indicator */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-600 font-medium">
                        Fees Paid: <strong className="font-mono text-slate-900">₹{paid.toLocaleString()}</strong> of <span className="font-mono text-slate-500">₹{total.toLocaleString()}</span>
                      </span>
                      <span className={`font-mono font-bold ${isEligible ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {pct.toFixed(1)}% Cleared
                      </span>
                    </div>
                    <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden relative">
                      <div
                        className={`h-full transition-all duration-300 ${isEligible ? 'bg-emerald-500' : 'bg-rose-500'}`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>0%</span>
                      <span className="font-bold text-slate-600">50% Minimum Threshold (₹{minRequired.toLocaleString()})</span>
                      <span>100%</span>
                    </div>
                  </div>

                  {/* Notice & Admin Approval */}
                  {isEligible ? (
                    <div className="space-y-2">
                      <p className="text-[11px] text-emerald-800 font-medium leading-relaxed">
                        ✓ Student has completed {pct.toFixed(1)}% of annual school fees (≥50% requirement satisfied).
                      </p>
                      <div className="pt-2 border-t border-emerald-200/80">
                        <label className="flex items-start gap-2.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={promoteAdminApproved}
                            onChange={(e) => setPromoteAdminApproved(e.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-emerald-400 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                          <div>
                            <span className="text-xs font-bold text-slate-800 block">
                              Admin Approval: 50% Fee Clearance Verified & Approved
                            </span>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              I authorize promotion to {promoteTargetClass || 'target class'} and approve updating the student's fees invoice for the next academic term.
                            </p>
                          </div>
                        </label>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[11px] text-rose-800 font-medium leading-relaxed">
                        ⚠️ Promotion condition blocked: Students must pay at least 50% of the fees to be promoted to the next higher class. This student has only paid {pct.toFixed(1)}% (Shortfall: <strong className="font-mono">₹{shortfall.toLocaleString()}</strong>).
                      </p>

                      {/* Admin Override Option */}
                      <div className="pt-2 border-t border-rose-200/80 space-y-2">
                        <label className="flex items-start gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={promoteFeeWaiver}
                            onChange={(e) => setPromoteFeeWaiver(e.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-rose-400 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                          <div>
                            <span className="text-xs font-bold text-slate-800 block">
                              Grant Admin Discretionary Fee Exemption & Promotion Approval
                            </span>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              Authorize promotion with an administrative fee waiver. Enter mandatory justification below.
                            </p>
                          </div>
                        </label>
                        {promoteFeeWaiver && (
                          <input
                            type="text"
                            placeholder="Enter administrative reason for waiver (e.g. Management approval, Fee concession granted)..."
                            value={promoteWaiverReason}
                            onChange={(e) => setPromoteWaiverReason(e.target.value)}
                            className="w-full text-xs rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Fee Invoice Synchronization Notice */}
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 text-xs flex items-start gap-2.5">
              <CreditCard className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-indigo-900 block">Automatic Fee Invoice Synchronization</span>
                <p className="text-[11px] text-indigo-700/90 leading-relaxed mt-0.5">
                  Upon promotion, the student's tuition fees record and invoice will be updated to <strong>{promoteTargetClass || 'target class'}</strong> with the corresponding term fee structure and quarterly schedule.
                </p>
              </div>
            </div>

            {/* Class & Academic Year Selection */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Target Class *
                </label>
                <select
                  value={promoteTargetClass}
                  onChange={(e) => setPromoteTargetClass(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                >
                  {academicClasses.map((cls) => (
                    <option key={cls.id} value={cls.name}>
                      {cls.name} {cls.name.toLowerCase() === getNextClassFor(promoteStudentTarget.class).toLowerCase() ? '★ (Next)' : ''}
                    </option>
                  ))}
                  <option value="Graduated">Graduated</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Target Section *
                </label>
                <select
                  value={promoteTargetSection}
                  onChange={(e) => setPromoteTargetSection(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                >
                  {['A', 'B', 'C', 'D'].map((sec) => (
                    <option key={sec} value={sec}>Section {sec}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Academic Cycle
                </label>
                <select
                  value={promoteTargetYear}
                  onChange={(e) => setPromoteTargetYear(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                >
                  {academicYears.map((yr) => (
                    <option key={yr.id} value={yr.name}>{yr.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Status or error banner */}
            {promoteStatusMsg && (
              <div className={`p-3 rounded-lg text-xs font-medium ${
                promoteStatusMsg.type === 'error' ? 'bg-rose-50 text-rose-800 border border-rose-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              }`}>
                {promoteStatusMsg.text}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/60">
            <button
              type="button"
              onClick={() => setPromoteStudentTarget(null)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
            >
              Cancel
            </button>

            {(() => {
              const total = Number(promoteStudentTarget.feeTotal || 0);
              const paid = Number(promoteStudentTarget.feePaid || 0);
              const pct = total > 0 ? (paid / total) * 100 : 100;
              const isUnder50 = total > 0 && pct < 50;
              const canProceed = (!isUnder50 || promoteFeeWaiver) && (promoteAdminApproved || promoteFeeWaiver);

              return (
                <button
                  type="button"
                  disabled={!canProceed || isPromoting || !promoteTargetClass}
                  onClick={handleConfirmPromote}
                  className={`rounded-lg px-4 py-2 text-xs font-black text-white transition flex items-center gap-1.5 shadow-xs ${
                    canProceed
                      ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 cursor-pointer'
                      : 'bg-slate-300 cursor-not-allowed text-slate-500'
                  }`}
                >
                  <GraduationCap className="h-4 w-4" />
                  <span>
                    {isPromoting
                      ? 'Promoting & Updating Invoice...'
                      : !promoteAdminApproved && !promoteFeeWaiver
                      ? 'Admin Approval Required'
                      : isUnder50 && !promoteFeeWaiver
                      ? '50% Fee Clearance Required'
                      : `Approve & Promote to ${promoteTargetClass}`}
                  </span>
                </button>
              );
            })()}
          </div>
        </section>
      </div>,
      document.body
    )}

    {/* =========================================================================
        1. SELF-ENROLLMENT PUBLIC LINK GENERATOR & MANAGEMENT MODAL
        ========================================================================= */}
    {isLinksModalOpen && createPortal(
      <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex min-h-full items-center justify-center p-4">
        <section
          role="dialog"
          aria-modal="true"
          className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                <LinkIcon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Self-Enrollment Link Generator</h3>
                <p className="text-xs text-slate-500">
                  Generate public admission links for students. Link is valid for 24 hours after candidate opens it.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsLinksModalOpen(false)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
            {/* Generator Card */}
            <form onSubmit={handleCreateLink} className="p-4 rounded-xl border border-indigo-100 bg-indigo-50/40 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black uppercase tracking-wider text-indigo-900 flex items-center gap-2">
                  <LinkIcon className="h-4 w-4 text-indigo-600" />
                  Generate New Admission Link
                </h4>
                <span className="text-[10px] font-mono font-bold text-indigo-600 bg-indigo-100/80 px-2.5 py-0.5 rounded-full">
                  ⏱ 24-Hour Validity Window
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    Target Class (Optional)
                  </label>
                  <select
                    value={newLinkTargetClass}
                    onChange={(e) => setNewLinkTargetClass(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                  >
                    <option value="">All Classes (Applicant Selects)</option>
                    {academicClasses.map((cls) => (
                      <option key={cls.id} value={cls.name}>{cls.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    Academic Cycle
                  </label>
                  <select
                    value={newLinkAcademicYear || yearFilter || currentAcademicYear}
                    onChange={(e) => setNewLinkAcademicYear(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-mono font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                  >
                    {academicYears.map((yr) => (
                      <option key={yr.id} value={yr.name}>{yr.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    Link Campaign Title
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 2026 Admissions"
                    value={newLinkTitle}
                    onChange={(e) => setNewLinkTitle(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <p className="text-[11px] text-slate-500">
                  Candidates receive portal login credentials immediately upon submission. Admin approval required.
                </p>
                <button
                  type="submit"
                  disabled={isCreatingLink}
                  className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2 flex items-center gap-2 cursor-pointer shadow-xs transition"
                >
                  <LinkIcon className="h-3.5 w-3.5" />
                  <span>{isCreatingLink ? 'Creating...' : 'Generate Shareable Link'}</span>
                </button>
              </div>
            </form>

            {/* Latest Created Link Banner if present */}
            {latestCreatedLink && (
              <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/60 space-y-2 animate-fade-in">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    New Enrollment Link Ready to Share!
                  </span>
                  <span className="text-[10px] text-emerald-700 font-mono">
                    Token: {latestCreatedLink.token.slice(0, 10)}...
                  </span>
                </div>
                <div className="flex items-center gap-2 bg-white p-2 rounded-lg border border-emerald-200">
                  <input
                    type="text"
                    readOnly
                    value={`${window.location.origin}/enroll?token=${latestCreatedLink.token}`}
                    className="flex-1 text-xs font-mono text-slate-700 bg-transparent outline-none select-all"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopyLink(latestCreatedLink.token)}
                    className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1 cursor-pointer transition"
                  >
                    {copiedLinkToken === latestCreatedLink.token ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedLinkToken === latestCreatedLink.token ? 'Copied!' : 'Copy Link'}</span>
                  </button>
                  <a
                    href={`/enroll?token=${latestCreatedLink.token}`}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1.5 rounded-md hover:bg-slate-100 text-slate-600 transition"
                    title="Test Open Form"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              </div>
            )}

            {/* List of Active & Past Links */}
            <div className="space-y-3">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center justify-between">
                <span>Active & Past Enrollment Links ({enrollmentLinks.length})</span>
                <button
                  type="button"
                  onClick={() => refetchLinks()}
                  className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 transition cursor-pointer"
                >
                  Refresh list
                </button>
              </h4>

              {enrollmentLinks.length === 0 ? (
                <div className="text-center py-8 border border-dashed border-slate-200 rounded-xl text-slate-400 text-xs">
                  No enrollment links generated yet. Use the form above to generate your first link.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                  {enrollmentLinks.map((lnk) => {
                    return (
                      <div key={lnk.id} className="p-3.5 bg-white hover:bg-slate-50/70 transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-900">
                              {lnk.title || (lnk.targetClass ? `Admission for ${lnk.targetClass}` : 'General School Admission')}
                            </span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                              {lnk.academicYear}
                            </span>
                            {lnk.isExpired ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
                                Expired (24h passed)
                              </span>
                            ) : lnk.firstOpenedAt ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                                Opened ({lnk.remainingSeconds >= 3600 ? `${Math.floor(lnk.remainingSeconds / 3600)}h ${Math.floor((lnk.remainingSeconds % 3600) / 60)}m` : `${Math.floor(lnk.remainingSeconds / 60)}m`} left)
                              </span>
                            ) : lnk.is_active ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                                Active & Ready
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                                Deactivated
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-slate-500">
                            <span className="font-mono text-slate-400">Token: {lnk.token.slice(0, 12)}...</span>
                            <span>•</span>
                            <span>{lnk.applicationCount} application{lnk.applicationCount === 1 ? '' : 's'} received</span>
                            <span>•</span>
                            <span>Created {new Date(lnk.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleCopyLink(lnk.token)}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition"
                            title="Copy full public URL"
                          >
                            {copiedLinkToken === lnk.token ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-slate-500" />}
                            <span>{copiedLinkToken === lnk.token ? 'Copied' : 'Copy'}</span>
                          </button>
                          <a
                            href={`/enroll?token=${lnk.token}`}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 transition"
                            title="Open Link"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                          {lnk.is_active && !lnk.isExpired && (
                            <button
                              type="button"
                              onClick={() => handleDeactivateLink(lnk.id)}
                              className="px-2.5 py-1.5 rounded-lg border border-rose-200 hover:bg-rose-50 text-rose-600 text-xs font-bold transition cursor-pointer"
                              title="Deactivate link"
                            >
                              Deactivate
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end px-6 py-3 border-t border-slate-100 bg-slate-50/60">
            <button
              type="button"
              onClick={() => setIsLinksModalOpen(false)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
            >
              Close
            </button>
          </div>
        </section>
      </div>,
      document.body
    )}

    {/* =========================================================================
        2. ONLINE STUDENT APPLICATIONS & APPROVAL QUEUE MODAL
        ========================================================================= */}
    {isApplicationsModalOpen && createPortal(
      <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex min-h-full items-center justify-center p-4">
        <section
          role="dialog"
          aria-modal="true"
          className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600 shrink-0">
                <Inbox className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Online Student Admissions Queue</h3>
                <p className="text-xs text-slate-500">
                  Review applicant details submitted via the self-enrollment form, verify data & photo, and approve admission into class rosters.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsApplicationsModalOpen(false)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
            {/* Filter Tabs & Search Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
                {(['Pending', 'Approved', 'Rejected', 'All'] as const).map((st) => {
                  const cnt = st === 'All'
                    ? enrollmentApplications.length
                    : enrollmentApplications.filter(a => a.status === st).length;
                  const isActive = appStatusFilter === st;
                  return (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setAppStatusFilter(st)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                        isActive
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      <span>{st}</span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                        isActive ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-600'
                      }`}>
                        {cnt}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1 sm:w-56">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search applicant or phone..."
                    value={appSearch}
                    onChange={(e) => setAppSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => refetchApplications()}
                  className="p-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition"
                  title="Refresh queue"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Applications List */}
            {(() => {
              const filtered = enrollmentApplications.filter((app) => {
                if (appStatusFilter !== 'All' && app.status !== appStatusFilter) return false;
                if (appSearch) {
                  const q = appSearch.toLowerCase();
                  const matchName = app.name.toLowerCase().includes(q);
                  const matchParent = app.parentName.toLowerCase().includes(q);
                  const matchPhone = app.parentPhone.includes(q);
                  const matchNo = app.applicationNo.toLowerCase().includes(q);
                  if (!matchName && !matchParent && !matchPhone && !matchNo) return false;
                }
                return true;
              });

              if (filtered.length === 0) {
                return (
                  <div className="text-center py-12 border border-dashed border-slate-200 rounded-xl space-y-2">
                    <Inbox className="w-8 h-8 text-slate-300 mx-auto" />
                    <p className="text-xs font-bold text-slate-600">No applications in this view</p>
                    <p className="text-[11px] text-slate-400">
                      {appStatusFilter === 'Pending'
                        ? 'All online student applications have been reviewed and processed.'
                        : 'No submissions matching current filter criteria.'}
                    </p>
                  </div>
                );
              }

              return (
                <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                  {filtered.map((app) => (
                    <div
                      key={app.id}
                      className="p-4 bg-white hover:bg-slate-50/70 transition flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
                    >
                      <div className="flex items-start gap-3.5">
                        <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center font-bold text-slate-500">
                          {app.photoUrl ? (
                            <AuthenticatedImage
                              src={app.photoUrl}
                              alt={app.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-sm font-black text-indigo-600">
                              {app.name.slice(0, 2).toUpperCase()}
                            </span>
                          )}
                        </div>

                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-sm font-bold text-slate-900">{app.name}</h4>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-100 text-indigo-700 font-bold">
                              {app.className} - {app.section || 'A'}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400">
                              #{app.applicationNo}
                            </span>
                            {app.status === 'Pending' && (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                                Pending Approval
                              </span>
                            )}
                            {app.status === 'Approved' && (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 flex items-center gap-1">
                                <Check className="h-3 w-3" /> Enrolled
                              </span>
                            )}
                            {app.status === 'Rejected' && (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
                                Rejected
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                            <span>Guardian: <strong className="text-slate-700">{app.parentName}</strong></span>
                            <span>Phone: <strong className="text-slate-700 font-mono">{app.parentPhone}</strong></span>
                            <span>DOB: <strong className="text-slate-700">{app.dob}</strong></span>
                            <span>Gender: <strong className="text-slate-700">{app.gender}</strong></span>
                          </div>

                          <div className="text-[11px] text-slate-400 flex items-center gap-3">
                            <span>Submitted: {new Date(app.submittedAt).toLocaleString()}</span>
                            <span>•</span>
                            <span className="font-mono text-slate-500">Provisional User: {app.provisionalUsername}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 w-full md:w-auto justify-end">
                        <button
                          type="button"
                          onClick={() => handleOpenReviewModal(app)}
                          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs ${
                            app.status === 'Pending'
                              ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white'
                              : 'border border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          {app.status === 'Pending' ? (
                            <>
                              <ShieldCheck className="h-4 w-4" />
                              <span>Review & Decide</span>
                            </>
                          ) : (
                            <>
                              <Eye className="h-4 w-4" />
                              <span>View Details</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100 bg-slate-50/60">
            <span className="text-xs text-slate-500">
              Total Applications: <strong>{enrollmentApplications.length}</strong> (Pending: <strong className="text-indigo-600">{pendingApplicationsCount}</strong>)
            </span>
            <button
              type="button"
              onClick={() => setIsApplicationsModalOpen(false)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
            >
              Close
            </button>
          </div>
        </section>
      </div>,
      document.body
    )}

    {/* =========================================================================
        3. REVIEW APPLICATION DETAILS & ADMIN APPROVAL MODAL
        ========================================================================= */}
    {selectedApplication && createPortal(
      <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex min-h-full items-center justify-center p-4">
        <section
          role="dialog"
          aria-modal="true"
          className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto animate-fade-in"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold shrink-0 shadow-sm">
                <GraduationCap className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900">{selectedApplication.name}</h3>
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                    selectedApplication.status === 'Approved'
                      ? 'bg-emerald-100 text-emerald-800'
                      : selectedApplication.status === 'Rejected'
                      ? 'bg-rose-100 text-rose-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}>
                    {selectedApplication.status}
                  </span>
                </div>
                <p className="text-xs text-slate-500 font-mono">
                  Application #{selectedApplication.applicationNo} • Cycle: {selectedApplication.academicYear}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedApplication(null);
                setAppActionMsg(null);
                setIsRejectingAppFormOpen(false);
              }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
            {/* Status message banner */}
            {appActionMsg && (
              <div className={`p-3.5 rounded-xl text-xs font-bold ${
                appActionMsg.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}>
                {appActionMsg.text}
              </div>
            )}

            {/* Applicant Profile Card */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="w-20 h-20 rounded-2xl bg-white border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center shadow-xs">
                  {selectedApplication.photoUrl ? (
                    <AuthenticatedImage
                      src={selectedApplication.photoUrl}
                      alt={selectedApplication.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-indigo-50 text-indigo-600 font-black text-xl flex items-center justify-center">
                      {selectedApplication.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>

                <div className="space-y-1 flex-1">
                  <h4 className="text-base font-extrabold text-slate-900">{selectedApplication.name}</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs pt-1">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Date of Birth</span>
                      <strong className="text-slate-700">{selectedApplication.dob}</strong>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Gender</span>
                      <strong className="text-slate-700">{selectedApplication.gender}</strong>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Blood Group</span>
                      <strong className="text-slate-700">{selectedApplication.bloodGroup || '—'}</strong>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Aadhaar No.</span>
                      <strong className="text-slate-700 font-mono">{selectedApplication.aadhaarNo || '—'}</strong>
                    </div>
                    <div className="col-span-2">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Medical Notes</span>
                      <strong className="text-slate-700">{selectedApplication.medicalConditions || 'None reported'}</strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* Parent & Address Details */}
              <div className="pt-3 border-t border-slate-200/80 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Parent / Guardian</span>
                  <strong className="text-slate-800">{selectedApplication.parentName}</strong>
                  <span className="block text-slate-500 font-mono mt-0.5">{selectedApplication.parentPhone}</span>
                  <span className="block text-slate-500">{selectedApplication.parentEmail}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Residential Address</span>
                  <p className="text-slate-700 leading-relaxed mt-0.5">{selectedApplication.address || 'Not provided'}</p>
                </div>
              </div>

              {/* Provisional Credentials Notice */}
              <div className="p-3 rounded-lg border border-indigo-100 bg-indigo-50/60 text-xs space-y-1">
                <span className="font-bold text-indigo-900 flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-indigo-600" />
                  Provisional Student Portal Credentials
                </span>
                <p className="text-[11px] text-indigo-800">
                  Login ID: <strong className="font-mono">{selectedApplication.provisionalUsername}</strong>
                </p>
                <p className="text-[10px] text-slate-500">
                  The candidate received temporary credentials upon submission. Approving below activates their portal account in the database.
                </p>
              </div>
            </div>

            {/* Approval Decision & Class Assignment Form */}
            {selectedApplication.status === 'Pending' && !isRejectingAppFormOpen && (
              <div className="p-4 rounded-xl border border-indigo-200 bg-white space-y-4 shadow-xs">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Class Allocation & Admission Details
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                      Assigned Class *
                    </label>
                    <select
                      value={reviewAssignClass}
                      onChange={(e) => {
                        const nextCls = e.target.value;
                        setReviewAssignClass(nextCls);
                        const inCls = students.filter(s => s.class === nextCls);
                        const highest = inCls.reduce((max, s) => Math.max(max, Number(s.rollNo || 0)), 0);
                        setReviewAssignRollNo(highest + 1);
                      }}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                    >
                      {academicClasses.map((cls) => (
                        <option key={cls.id} value={cls.name}>{cls.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                      Section *
                    </label>
                    <select
                      value={reviewAssignSection}
                      onChange={(e) => setReviewAssignSection(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                    >
                      {['A', 'B', 'C', 'D'].map((sec) => (
                        <option key={sec} value={sec}>Section {sec}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                      Allocated Roll No. *
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={reviewAssignRollNo}
                      onChange={(e) => setReviewAssignRollNo(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                      Admission Number *
                    </label>
                    <input
                      type="text"
                      value={reviewAssignAdmissionNo}
                      onChange={(e) => setReviewAssignAdmissionNo(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-emerald-50/60 border border-emerald-100 text-[11px] text-emerald-800 flex items-start gap-2">
                  <CreditCard className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>
                    Upon approval, this student will be officially saved to <strong>{reviewAssignClass}-{reviewAssignSection}</strong>, user account activated, and a fee invoice record will be initialized in the database.
                  </span>
                </div>
              </div>
            )}

            {/* Rejection Form if toggled */}
            {selectedApplication.status === 'Pending' && isRejectingAppFormOpen && (
              <div className="p-4 rounded-xl border border-rose-200 bg-rose-50/50 space-y-3">
                <h4 className="text-xs font-bold text-rose-900 flex items-center gap-1.5">
                  <XCircle className="h-4 w-4 text-rose-600" />
                  Reject Student Application
                </h4>
                <p className="text-[11px] text-rose-700">
                  Rejecting will delete the provisional user account and mark this application as Rejected.
                </p>
                <textarea
                  rows={2}
                  placeholder="Reason for rejection (e.g. Incomplete address, seat quota full)..."
                  value={reviewRejectRemarks}
                  onChange={(e) => setReviewRejectRemarks(e.target.value)}
                  className="w-full rounded-lg border border-rose-200 bg-white p-2.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsRejectingAppFormOpen(false)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={isRejectingApp}
                    onClick={handleConfirmRejectApp}
                    className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition shadow-xs"
                  >
                    {isRejectingApp ? 'Rejecting...' : 'Confirm Rejection'}
                  </button>
                </div>
              </div>
            )}

            {/* If already approved or rejected */}
            {selectedApplication.status === 'Approved' && (
              <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50 text-xs text-emerald-900 flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <div>
                  <span className="font-bold block">Application Approved & Student Enrolled</span>
                  <span className="text-[11px] text-emerald-700">
                    Approved by {selectedApplication.approvedBy || 'Admin'} on {selectedApplication.approvedAt ? new Date(selectedApplication.approvedAt).toLocaleString() : 'recently'}.
                  </span>
                </div>
              </div>
            )}

            {selectedApplication.status === 'Rejected' && (
              <div className="p-3.5 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-900 flex items-center gap-2">
                <XCircle className="h-5 w-5 text-rose-600 shrink-0" />
                <div>
                  <span className="font-bold block">Application Rejected</span>
                  <span className="text-[11px] text-rose-700">
                    Remarks: {selectedApplication.rejectionRemarks || 'No remarks provided.'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100 bg-slate-50/60">
            <div>
              {selectedApplication.status === 'Pending' && !isRejectingAppFormOpen && (
                <button
                  type="button"
                  onClick={() => setIsRejectingAppFormOpen(true)}
                  className="rounded-lg border border-rose-200 bg-white px-3.5 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                >
                  Reject Application
                </button>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setSelectedApplication(null);
                  setAppActionMsg(null);
                  setIsRejectingAppFormOpen(false);
                }}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
              >
                Close
              </button>

              {selectedApplication.status === 'Pending' && !isRejectingAppFormOpen && (
                <button
                  type="button"
                  disabled={isApprovingApp}
                  onClick={handleConfirmApproveApp}
                  className="rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black text-xs px-5 py-2 shadow-sm flex items-center gap-2 cursor-pointer transition"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{isApprovingApp ? 'Enrolling Student...' : `Approve & Enrol Student`}</span>
                </button>
              )}
            </div>
          </div>
        </section>
      </div>,
      document.body
    )}

    {/* Universal Smart Excel / Google Sheets Import Modal */}
    <ExcelImportModal
      isOpen={isExcelImportOpen}
      onClose={() => setIsExcelImportOpen(false)}
      entityType="students"
      currentAcademicYear={(yearFilter !== 'All' ? yearFilter : '') || currentAcademicYear}
      availableClasses={academicClasses.map((c) => c.name)}
      availableSections={academicSections.map((s) => s.name)}
      onImportSuccess={() => {
        void refetchStats();
        void refetchPaginatedRoster();
      }}
    />

    {/* Admin Credentials Confirmation Modal for Deleting All Students */}
    {isDeleteAllModalOpen && createPortal(
      <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex min-h-full items-center justify-center p-4">
        <section
          role="dialog"
          aria-modal="true"
          className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-rose-100 overflow-hidden my-auto animate-fade-in"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-rose-100 bg-rose-50/70">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-red-600 text-white flex items-center justify-center font-bold shrink-0 shadow-sm">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Delete All Students Data</h3>
                <p className="text-xs text-rose-700 font-medium">Irreversible Administrative Action</p>
              </div>
            </div>
            <button
              type="button"
              disabled={isDeletingAll}
              onClick={() => {
                setIsDeleteAllModalOpen(false);
                setDeleteAdminPassword('');
                setShowDeleteAdminPassword(false);
                setDeleteError(null);
                setDeleteSuccessMsg(null);
              }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white transition cursor-pointer disabled:opacity-40"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Form Body */}
          <form onSubmit={handleDeleteAllSubmit} className="p-6 space-y-4">
            {/* Warning description */}
            <div className="p-4 rounded-xl border border-rose-200 bg-rose-50/60 text-xs text-rose-900 space-y-2">
              <div className="flex items-center gap-2 font-bold text-rose-800">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>Permanent Data Purge Warning</span>
              </div>
              <p className="text-slate-600 leading-relaxed">
                This action will permanently delete <strong className="text-rose-700 font-extrabold">{students.length} student records</strong> in this school along with all linked admission details, academic history, fee records, attendance logs, documents, and student portal accounts.
              </p>
              <p className="text-rose-700 font-semibold text-[11px]">
                This operation is permanent and cannot be undone.
              </p>
            </div>

            {/* Admin Verification Input */}
            <div className="space-y-3 pt-1">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Administrator Account
                </label>
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="font-semibold truncate">{currentUser?.email || 'admin@school.edu'}</span>
                  <span className="ml-auto text-[10px] font-bold uppercase px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700">
                    {currentUser?.role || 'Admin'}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Admin Password to Confirm *
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-4 w-4 text-slate-400" />
                  </div>
                  <input
                    type={showDeleteAdminPassword ? 'text' : 'password'}
                    required
                    autoFocus
                    disabled={isDeletingAll}
                    value={deleteAdminPassword}
                    onChange={(e) => {
                      setDeleteAdminPassword(e.target.value);
                      if (deleteError) setDeleteError(null);
                    }}
                    placeholder="Enter your admin account password"
                    className="w-full text-xs pl-9 pr-10 py-2.5 rounded-xl border border-slate-200 bg-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 focus:outline-none font-medium placeholder-slate-400 disabled:bg-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowDeleteAdminPassword(!showDeleteAdminPassword)}
                    tabIndex={-1}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showDeleteAdminPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  Enter your admin password to authorize the complete purge of student records.
                </p>
              </div>
            </div>

            {/* Error banner */}
            {deleteError && (
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{deleteError}</span>
              </div>
            )}

            {/* Success banner */}
            {deleteSuccessMsg && (
              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>{deleteSuccessMsg}</span>
              </div>
            )}

            {/* Footer buttons */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                disabled={isDeletingAll}
                onClick={() => {
                  setIsDeleteAllModalOpen(false);
                  setDeleteAdminPassword('');
                  setShowDeleteAdminPassword(false);
                  setDeleteError(null);
                  setDeleteSuccessMsg(null);
                }}
                className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50 transition cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isDeletingAll || !deleteAdminPassword.trim()}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-700 hover:to-red-700 text-white font-bold text-xs shadow-sm flex items-center gap-2 cursor-pointer transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDeletingAll ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    <span>Verifying & Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    <span>Authorize & Delete All</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </section>
      </div>,
      document.body
    )}
    </>
  );
}
