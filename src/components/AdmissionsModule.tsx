import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Inbox,
  UserPlus,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  ExternalLink,
  Copy,
  Check,
  RotateCw,
  Eye,
  Download,
  LayoutGrid,
  Table as TableIcon,
  ChevronRight,
  ChevronDown,
  GraduationCap,
  User,
  Phone,
  Mail,
  Calendar,
  MapPin,
  AlertCircle,
  X,
  Link as LinkIcon,
  AlertTriangle,
  CreditCard,
  FileText,
  BadgeCheck,
  Send,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Loader2,
} from 'lucide-react';
import { apiDownload } from '../services/api';
import {
  useGetEnrollmentApplicationsQuery,
  useApproveEnrollmentApplicationMutation,
  useRejectEnrollmentApplicationMutation,
  useGetEnrollmentLinksQuery,
  useCreateEnrollmentLinkMutation,
  useDeactivateEnrollmentLinkMutation,
  normalizeStudent,
  EnrollmentApplicationItem,
  EnrollmentLinkItem,
} from '../store/api/studentApi';
import AuthenticatedImage from './AuthenticatedImage';
import { copyToClipboard } from '../utils/clipboard';
import type { Student } from '../types';
import { chatSocket } from '../services/chatSocket';

export interface AdmissionsModuleProps {
  students: Student[];
  onStudentApproved?: (student: Student) => void;
  currentAcademicYear: string;
  academicClasses?: Array<{ id: string | number; name: string }>;
  academicYears?: Array<{ id: string | number; name: string }>;
  schoolName?: string;
  onNavigateToTab?: (tab: string) => void;
}

export default function AdmissionsModule({
  students,
  onStudentApproved,
  currentAcademicYear,
  academicClasses = [],
  academicYears = [],
  schoolName = 'School Campus',
  onNavigateToTab,
}: AdmissionsModuleProps) {
  // Navigation / View Tabs
  const [activeTab, setActiveTab] = useState<'queue' | 'links'>('queue');
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');

  // Filter & Search states
  const [statusFilter, setStatusFilter] = useState<'All' | 'Pending' | 'Approved' | 'Rejected'>('Pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [yearFilter, setYearFilter] = useState(currentAcademicYear || '2026-2027');

  // Modal states
  const [selectedApplication, setSelectedApplication] = useState<EnrollmentApplicationItem | null>(null);
  const [isRejectingAppFormOpen, setIsRejectingAppFormOpen] = useState(false);
  const [reviewRejectRemarks, setReviewRejectRemarks] = useState('');
  const [reviewAssignClass, setReviewAssignClass] = useState('');
  const [reviewAssignSection, setReviewAssignSection] = useState('A');
  const [reviewAssignRollNo, setReviewAssignRollNo] = useState<number>(1);
  const [reviewAssignAdmissionNo, setReviewAssignAdmissionNo] = useState('');
  const [appActionMsg, setAppActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [approvedCredentialsSlip, setApprovedCredentialsSlip] = useState<{
    studentName: string;
    applicationNo: string;
    className: string;
    section: string;
    rollNo: number;
    loginId: string;
    temporaryPassword?: string;
  } | null>(null);

  // Link Generator Modal / State
  const [isCreateLinkModalOpen, setIsCreateLinkModalOpen] = useState(false);
  const [newLinkTitle, setNewLinkTitle] = useState('');
  const [newLinkTargetClass, setNewLinkTargetClass] = useState('');
  const [newLinkAcademicYear, setNewLinkAcademicYear] = useState(currentAcademicYear || '2026-2027');
  const [latestCreatedLink, setLatestCreatedLink] = useState<EnrollmentLinkItem | null>(null);
  const [copiedLinkToken, setCopiedLinkToken] = useState<string | null>(null);
  const [copiedSlip, setCopiedSlip] = useState(false);
  const [photoZoomUrl, setPhotoZoomUrl] = useState<{ url: string; name: string } | null>(null);

  // Document Viewer & Download State
  const [docPreviewModal, setDocPreviewModal] = useState<{
    isOpen: boolean;
    app: EnrollmentApplicationItem | null;
    blobUrl?: string;
    isPdf?: boolean;
    filename?: string;
    category?: string;
    isLoading: boolean;
    error?: string | null;
    scale: number;
    rotation: number;
  } | null>(null);
  const [downloadingDocAppId, setDownloadingDocAppId] = useState<number | null>(null);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState(chatSocket.getStatus() === 'connected');

  // Backend RTK Queries & Mutations
  const {
    data: enrollmentApplications = [],
    isLoading: isAppsLoading,
    refetch: refetchApplications,
  } = useGetEnrollmentApplicationsQuery(undefined, {
    // WebSocket is instant; background polling reconciles missed events and
    // keeps the queue current when the connection is unavailable.
    pollingInterval: realtimeConnected ? 30_000 : 10_000,
    skipPollingIfUnfocused: true,
  });

  const {
    data: enrollmentLinks = [],
    isLoading: isLinksLoading,
    refetch: refetchLinks,
  } = useGetEnrollmentLinksQuery();

  const [approveEnrollmentApplication, { isLoading: isApprovingApp }] = useApproveEnrollmentApplicationMutation();
  const [rejectEnrollmentApplication, { isLoading: isRejectingApp }] = useRejectEnrollmentApplicationMutation();
  const [createEnrollmentLink, { isLoading: isCreatingLink }] = useCreateEnrollmentLinkMutation();
  const [deactivateEnrollmentLink] = useDeactivateEnrollmentLinkMutation();

  useEffect(() => chatSocket.subscribeStatus((socketStatus) => {
    setRealtimeConnected(socketStatus === 'connected');
  }), []);

  useEffect(() => chatSocket.on('enrollment.sync', () => {
    refetchApplications();
  }), [refetchApplications]);

  useEffect(() => {
    if (realtimeConnected) refetchApplications();
  }, [realtimeConnected, refetchApplications]);

  // Metrics
  const stats = useMemo(() => {
    const total = enrollmentApplications.length;
    const pending = enrollmentApplications.filter((a) => a.status === 'Pending').length;
    const approved = enrollmentApplications.filter((a) => a.status === 'Approved').length;
    const rejected = enrollmentApplications.filter((a) => a.status === 'Rejected').length;
    const activeLinks = enrollmentLinks.filter((l) => l.is_active && !l.isExpired).length;
    return { total, pending, approved, rejected, activeLinks };
  }, [enrollmentApplications, enrollmentLinks]);

  // Fallback classes if academicClasses empty
  const availableClassesList = useMemo(() => {
    if (academicClasses.length > 0) return academicClasses;
    return Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `Class ${i + 1}` }));
  }, [academicClasses]);

  // Filtered applications
  const filteredApplications = useMemo(() => {
    return enrollmentApplications.filter((app) => {
      if (statusFilter !== 'All' && app.status !== statusFilter) return false;
      if (classFilter && app.className !== classFilter) return false;
      if (yearFilter && app.academicYear && app.academicYear !== yearFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = app.name.toLowerCase().includes(q);
        const matchParent = app.parentName.toLowerCase().includes(q);
        const matchPhone = (app.parentPhone || '').includes(q);
        const matchAppNo = (app.applicationNo || '').toLowerCase().includes(q);
        const matchUser = (app.provisionalUsername || '').toLowerCase().includes(q);
        const matchClass = (app.className || '').toLowerCase().includes(q);
        if (!matchName && !matchParent && !matchPhone && !matchAppNo && !matchUser && !matchClass) {
          return false;
        }
      }
      return true;
    });
  }, [enrollmentApplications, statusFilter, classFilter, yearFilter, searchQuery]);

  // Handle Review Modal open
  const handleOpenReviewModal = (app: EnrollmentApplicationItem) => {
    setSelectedApplication(app);
    const targetCls = app.className || availableClassesList[0]?.name || 'Class 1';
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

  // Confirm Approval
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
      setApprovedCredentialsSlip({
        studentName: selectedApplication.name,
        applicationNo: selectedApplication.applicationNo,
        className: reviewAssignClass,
        section: reviewAssignSection,
        rollNo: reviewAssignRollNo,
        loginId: selectedApplication.provisionalUsername,
        temporaryPassword: `${selectedApplication.provisionalUsername}@123`,
      });

      setSelectedApplication(null);
    } catch (err: any) {
      setAppActionMsg({
        type: 'error',
        text: err?.data?.detail || err?.message || 'Failed to approve application.',
      });
    }
  };

  // Quick Approve from row
  const handleQuickApprove = async (app: EnrollmentApplicationItem) => {
    const targetCls = app.className || availableClassesList[0]?.name || 'Class 1';
    const targetSec = app.section || 'A';
    const inClass = students.filter(
      (s) => s.class === targetCls && (!yearFilter || s.academicYear === (app.academicYear || yearFilter))
    );
    const highestRoll = inClass.reduce((max, s) => Math.max(max, Number(s.rollNo || 0)), 0);
    const allocatedRoll = highestRoll + 1;
    const yrCode = (app.academicYear || yearFilter || '2026').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
    const admNo = `ADM-${yrCode}-${Date.now().toString(36).toUpperCase()}`;

    try {
      const res = await approveEnrollmentApplication({
        id: app.id,
        className: targetCls,
        section: targetSec,
        rollNo: allocatedRoll,
        admissionNo: admNo,
      }).unwrap();

      if (res.student && onStudentApproved) {
        onStudentApproved(normalizeStudent(res.student));
      }
      refetchApplications();
      setApprovedCredentialsSlip({
        studentName: app.name,
        applicationNo: app.applicationNo,
        className: targetCls,
        section: targetSec,
        rollNo: allocatedRoll,
        loginId: app.provisionalUsername,
        temporaryPassword: `${app.provisionalUsername}@123`,
      });
    } catch (err: any) {
      alert(err?.data?.detail || err?.message || 'Failed to quick-approve application.');
    }
  };

  // Confirm Rejection
  const handleConfirmRejectApp = async () => {
    if (!selectedApplication) return;
    try {
      setAppActionMsg(null);
      await rejectEnrollmentApplication({
        id: selectedApplication.id,
        remarks: reviewRejectRemarks.trim() || 'Application rejected by administration.',
      }).unwrap();
      refetchApplications();
      setSelectedApplication(null);
    } catch (err: any) {
      setAppActionMsg({
        type: 'error',
        text: err?.data?.detail || err?.message || 'Failed to reject application.',
      });
    }
  };

  // Create 24h link
  const handleCreateLink = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await createEnrollmentLink({
        title: newLinkTitle.trim() || undefined,
        targetClass: newLinkTargetClass || '',
        academicYear: newLinkAcademicYear || yearFilter || currentAcademicYear || '2026-2027',
        durationMinutes: 1440,
      }).unwrap();
      setLatestCreatedLink(created);
      setNewLinkTitle('');
      refetchLinks();
      setIsCreateLinkModalOpen(false);
      setActiveTab('links');
    } catch (err: any) {
      alert(err?.data?.detail || err?.message || 'Failed to generate link.');
    }
  };

  // Copy link helper
  const handleCopyLink = async (token: string) => {
    const origin = window.location.origin;
    const url = `${origin}/enroll?token=${token}`;
    const success = await copyToClipboard(url);
    if (success) {
      setCopiedLinkToken(token);
      setTimeout(() => setCopiedLinkToken(null), 3000);
    }
  };

  // Deactivate link helper
  const handleDeactivateLink = async (id: string | number) => {
    if (!confirm('Are you sure you want to deactivate this enrollment link? Prospective applicants will no longer be able to submit.')) {
      return;
    }
    try {
      await deactivateEnrollmentLink(id).unwrap();
      refetchLinks();
    } catch (err: any) {
      alert(err?.data?.detail || err?.message || 'Failed to deactivate link.');
    }
  };

  // Export Applicants to CSV
  const handleExportCSV = (targetList?: EnrollmentApplicationItem[], customFilename?: string) => {
    setIsExportMenuOpen(false);

    // If a specific target list is passed (e.g. from dropdown), use it.
    // Otherwise, prefer current filtered applications if any exist; if empty, fallback to all applications.
    const listToExport = targetList || (filteredApplications.length > 0 ? filteredApplications : enrollmentApplications);

    if (!listToExport || listToExport.length === 0) {
      alert('No admission applications found to export.');
      return;
    }

    const headers = [
      'Application No',
      'Student Name',
      'Class',
      'Section',
      'Gender',
      'Date of Birth',
      'Blood Group',
      'Parent Name',
      'Parent Phone',
      'Parent Email',
      'Address',
      'Aadhaar No',
      'Medical Conditions',
      'Academic Year',
      'Document Attached',
      'Provisional Username',
      'Status',
      'Submitted At',
      'Approved At',
      'Approved By',
      'Rejection Remarks',
    ];

    const rows = listToExport.map((app) => [
      `"${(app.applicationNo || '').replace(/"/g, '""')}"`,
      `"${(app.name || '').replace(/"/g, '""')}"`,
      `"${(app.className || '').replace(/"/g, '""')}"`,
      `"${(app.section || '').replace(/"/g, '""')}"`,
      `"${(app.gender || '').replace(/"/g, '""')}"`,
      `"${(app.dob || '').replace(/"/g, '""')}"`,
      `"${(app.bloodGroup || '').replace(/"/g, '""')}"`,
      `"${(app.parentName || '').replace(/"/g, '""')}"`,
      `"${(app.parentPhone || '').replace(/"/g, '""')}"`,
      `"${(app.parentEmail || '').replace(/"/g, '""')}"`,
      `"${(app.address || '').replace(/"/g, '""')}"`,
      `"${(app.aadhaarNo || '').replace(/"/g, '""')}"`,
      `"${(app.medicalConditions || '').replace(/"/g, '""')}"`,
      `"${(app.academicYear || '').replace(/"/g, '""')}"`,
      `"${app.hasDocument ? `${app.documentCategory || 'Document'} (${(app.documentName || '').replace(/"/g, '""')})` : 'None'}"`,
      `"${(app.provisionalUsername || '').replace(/"/g, '""')}"`,
      `"${(app.status || '').replace(/"/g, '""')}"`,
      `"${app.submittedAt ? new Date(app.submittedAt).toLocaleString().replace(/"/g, '""') : ''}"`,
      `"${app.approvedAt ? new Date(app.approvedAt).toLocaleString().replace(/"/g, '""') : ''}"`,
      `"${(app.approvedBy || '').replace(/"/g, '""')}"`,
      `"${(app.rejectionRemarks || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const filterTag = customFilename || (targetList ? 'custom' : (filteredApplications.length > 0 ? statusFilter.toLowerCase() : 'all'));
    link.setAttribute('download', `admissions_applications_${filterTag}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Authenticated Document Preview & Download Handlers
  const handleOpenDocPreview = async (app: EnrollmentApplicationItem) => {
    if (!app.documentUrl) return;

    if (docPreviewModal?.blobUrl) {
      URL.revokeObjectURL(docPreviewModal.blobUrl);
    }

    setDocPreviewModal({
      isOpen: true,
      app,
      filename: app.documentName || 'Supporting Document',
      category: app.documentCategory || 'Identity / Document',
      isLoading: true,
      error: null,
      scale: 1,
      rotation: 0,
    });

    try {
      const { blob, filename, contentType } = await apiDownload(app.documentUrl);
      const isPdf =
        contentType.toLowerCase().includes('pdf') ||
        (filename || '').toLowerCase().endsWith('.pdf') ||
        (app.documentName || '').toLowerCase().endsWith('.pdf');
      const blobUrl = URL.createObjectURL(blob);

      setDocPreviewModal((prev) =>
        prev
          ? {
              ...prev,
              blobUrl,
              isPdf,
              filename: filename || prev.filename,
              isLoading: false,
            }
          : null
      );
    } catch (err) {
      setDocPreviewModal((prev) =>
        prev
          ? {
              ...prev,
              isLoading: false,
              error: err instanceof Error ? err.message : 'Failed to load document for preview.',
            }
          : null
      );
    }
  };

  const closeDocPreview = () => {
    if (docPreviewModal?.blobUrl) {
      URL.revokeObjectURL(docPreviewModal.blobUrl);
    }
    setDocPreviewModal(null);
  };

  const handleDownloadDoc = async (app: EnrollmentApplicationItem) => {
    if (!app.documentUrl) return;
    setDownloadingDocAppId(app.id);
    try {
      const { blob, filename } = await apiDownload(app.documentUrl);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || app.documentName || `application-${app.applicationNo}-document`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not download document. Please try again.');
    } finally {
      setDownloadingDocAppId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* =========================================================================
          1. PAGE HERO HEADER & QUICK ACTIONS
          ========================================================================= */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 text-white relative overflow-hidden shadow-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 left-1/3 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <span className="p-2 rounded-xl bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                <UserPlus className="w-5 h-5" />
              </span>
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-indigo-300">
                Admissions Management Portal
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                Cycle: {yearFilter || currentAcademicYear}
              </span>
              <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border ${realtimeConnected ? 'bg-emerald-500/10 text-emerald-300 border-emerald-400/30' : 'bg-amber-500/10 text-amber-200 border-amber-400/30'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${realtimeConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-300'}`} />
                {realtimeConnected ? 'LIVE' : 'RECONNECTING'}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              Online Student Admissions &amp; Enrollment
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
              Review and verify candidate submissions from shareable 24-hour self-enrollment links. Approve students into official rosters, automatically activating their portal accounts and fee ledgers.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setIsCreateLinkModalOpen(true)}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white text-xs font-bold shadow-lg shadow-indigo-500/25 flex items-center gap-2 cursor-pointer transition"
            >
              <LinkIcon className="w-4 h-4" />
              <span>+ Generate 24h Link</span>
            </button>

            {/* Split Export CSV Button with Dropdown Options */}
            <div className="relative inline-flex items-stretch rounded-xl shadow-xs">
              <button
                type="button"
                onClick={() => handleExportCSV()}
                className="px-3.5 py-2.5 rounded-l-xl bg-slate-800/80 hover:bg-slate-700 border border-r-0 border-slate-700 text-slate-200 text-xs font-bold flex items-center gap-2 cursor-pointer transition"
                title={`Export applications to CSV (${filteredApplications.length > 0 ? `${filteredApplications.length} in current view` : `${enrollmentApplications.length} total`})`}
              >
                <Download className="w-4 h-4 text-slate-300" />
                <span>Export CSV</span>
                {enrollmentApplications.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-700/80 text-indigo-300 font-mono">
                    {filteredApplications.length > 0 ? filteredApplications.length : enrollmentApplications.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setIsExportMenuOpen((prev) => !prev)}
                className="px-2 py-2.5 rounded-r-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white cursor-pointer transition"
                title="More export options"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>

              {/* Dropdown Menu */}
              {isExportMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsExportMenuOpen(false)}
                  />
                  <div className="absolute right-0 top-full mt-2 w-56 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-1.5 z-50 text-xs text-slate-200 animate-in fade-in zoom-in-95 duration-100">
                    <div className="px-2.5 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Export Options
                    </div>
                    {filteredApplications.length > 0 && (
                      <button
                        type="button"
                        onClick={() => handleExportCSV(filteredApplications, statusFilter.toLowerCase())}
                        className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-slate-800 flex items-center justify-between text-slate-200 cursor-pointer transition"
                      >
                        <span>Current Filter ({statusFilter})</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-indigo-400 border border-slate-700">
                          {filteredApplications.length}
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleExportCSV(enrollmentApplications, 'all')}
                      className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-slate-800 flex items-center justify-between text-slate-200 cursor-pointer transition"
                    >
                      <span>All Applications</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-emerald-400 border border-slate-700">
                        {stats.total}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleExportCSV(
                          enrollmentApplications.filter((a) => a.status === 'Approved'),
                          'approved'
                        )
                      }
                      className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-slate-800 flex items-center justify-between text-slate-200 cursor-pointer transition"
                    >
                      <span>Approved &amp; Enrolled</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-blue-400 border border-slate-700">
                        {stats.approved}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleExportCSV(
                          enrollmentApplications.filter((a) => a.status === 'Pending'),
                          'pending'
                        )
                      }
                      className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-slate-800 flex items-center justify-between text-slate-200 cursor-pointer transition"
                    >
                      <span>Pending Review</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-amber-400 border border-slate-700">
                        {stats.pending}
                      </span>
                    </button>
                    {stats.rejected > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          handleExportCSV(
                            enrollmentApplications.filter((a) => a.status === 'Rejected'),
                            'rejected'
                          )
                        }
                        className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-slate-800 flex items-center justify-between text-slate-200 cursor-pointer transition"
                      >
                        <span>Rejected Submissions</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-rose-400 border border-slate-700">
                          {stats.rejected}
                        </span>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                refetchApplications();
                refetchLinks();
              }}
              className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
              title="Refresh queue"
            >
              <RotateCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* =========================================================================
          2. KPI SUMMARY METRIC CARDS
          ========================================================================= */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Pending Card */}
        <div
          onClick={() => {
            setActiveTab('queue');
            setStatusFilter('Pending');
          }}
          className={`p-4 sm:p-5 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group ${
            statusFilter === 'Pending' && activeTab === 'queue'
              ? 'bg-amber-500/10 border-amber-400/50 shadow-md ring-2 ring-amber-400/30'
              : 'bg-white border-slate-200/80 hover:border-amber-300 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Pending Approvals
            </span>
            <span className="p-2 rounded-xl bg-amber-50 text-amber-600 border border-amber-100">
              <Clock className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-slate-900">{stats.pending}</span>
            {stats.pending > 0 && (
              <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 animate-pulse">
                Action Required
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Awaiting class placement</p>
        </div>

        {/* Approved Card */}
        <div
          onClick={() => {
            setActiveTab('queue');
            setStatusFilter('Approved');
          }}
          className={`p-4 sm:p-5 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group ${
            statusFilter === 'Approved' && activeTab === 'queue'
              ? 'bg-emerald-500/10 border-emerald-400/50 shadow-md ring-2 ring-emerald-400/30'
              : 'bg-white border-slate-200/80 hover:border-emerald-300 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Approved &amp; Enrolled
            </span>
            <span className="p-2 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100">
              <CheckCircle2 className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-slate-900">{stats.approved}</span>
            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
              In Class Rosters
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Active student logins</p>
        </div>

        {/* Rejected Card */}
        <div
          onClick={() => {
            setActiveTab('queue');
            setStatusFilter('Rejected');
          }}
          className={`p-4 sm:p-5 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group ${
            statusFilter === 'Rejected' && activeTab === 'queue'
              ? 'bg-rose-500/10 border-rose-400/50 shadow-md ring-2 ring-rose-400/30'
              : 'bg-white border-slate-200/80 hover:border-rose-300 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Rejected Submissions
            </span>
            <span className="p-2 rounded-xl bg-rose-50 text-rose-600 border border-rose-100">
              <XCircle className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-slate-900">{stats.rejected}</span>
            <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">
              Declined
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Provisional users removed</p>
        </div>

        {/* 24h Links Card */}
        <div
          onClick={() => setActiveTab('links')}
          className={`p-4 sm:p-5 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group ${
            activeTab === 'links'
              ? 'bg-indigo-500/10 border-indigo-400/50 shadow-md ring-2 ring-indigo-400/30'
              : 'bg-white border-slate-200/80 hover:border-indigo-300 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Active 24h Links
            </span>
            <span className="p-2 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
              <LinkIcon className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-slate-900">{stats.activeLinks}</span>
            <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
              ⏱ 24-Hr Window
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Shareable candidate portals</p>
        </div>
      </div>

      {/* =========================================================================
          3. MAIN TAB SWITCHER (QUEUE VS 24H LINKS)
          ========================================================================= */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('queue')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
              activeTab === 'queue'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Inbox className="w-4 h-4" />
            <span>Admissions Applications Queue</span>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${
                activeTab === 'queue' ? 'bg-indigo-700 text-indigo-100' : 'bg-slate-200 text-slate-700'
              }`}
            >
              {enrollmentApplications.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('links')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
              activeTab === 'links'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <LinkIcon className="w-4 h-4" />
            <span>24-Hour Self-Enrollment Links</span>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${
                activeTab === 'links' ? 'bg-indigo-700 text-indigo-100' : 'bg-slate-200 text-slate-700'
              }`}
            >
              {enrollmentLinks.length}
            </span>
          </button>
        </div>

        {activeTab === 'queue' && (
          <div className="hidden sm:flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'table' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-500 hover:text-slate-700'
              }`}
              title="Columns Table View"
            >
              <TableIcon className="w-4 h-4" />
              <span>Table Columns</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('kanban')}
              className={`p-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'kanban' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-500 hover:text-slate-700'
              }`}
              title="Kanban Board View"
            >
              <LayoutGrid className="w-4 h-4" />
              <span>Columns Board</span>
            </button>
          </div>
        )}
      </div>

      {/* =========================================================================
          4. TAB 1: ADMISSIONS APPLICATIONS QUEUE
          ========================================================================= */}
      {activeTab === 'queue' && (
        <div className="space-y-4">
          {/* Controls Bar: Filters & Search */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            {/* Status Pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              {(['Pending', 'Approved', 'Rejected', 'All'] as const).map((st) => {
                const count =
                  st === 'All'
                    ? enrollmentApplications.length
                    : enrollmentApplications.filter((a) => a.status === st).length;
                const isActive = statusFilter === st;
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(st)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                      isActive
                        ? st === 'Pending'
                          ? 'bg-amber-100 text-amber-900 border border-amber-300'
                          : st === 'Approved'
                          ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                          : st === 'Rejected'
                          ? 'bg-rose-100 text-rose-900 border border-rose-300'
                          : 'bg-indigo-100 text-indigo-900 border border-indigo-300'
                        : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
                    }`}
                  >
                    <span>{st === 'All' ? 'All Applications' : st}</span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                        isActive ? 'bg-white/80' : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Filter Dropdowns & Search Box */}
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Class Dropdown */}
              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="">All Classes</option>
                {availableClassesList.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>

              {/* Academic Cycle Dropdown */}
              <select
                value={yearFilter}
                onChange={(e) => setYearFilter(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="">All Cycles</option>
                {academicYears.length > 0 ? (
                  academicYears.map((y) => (
                    <option key={y.id} value={y.name}>
                      {y.name}
                    </option>
                  ))
                ) : (
                  <option value="2026-2027">2026-2027</option>
                )}
              </select>

              {/* Search Bar */}
              <div className="relative flex-1 sm:w-64">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search name, phone, #APP..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* TABLE COLUMNS VIEW ("create column and make that page user friendly so that the admin can use it easily") */}
          {viewMode === 'table' && (
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
              {filteredApplications.length === 0 ? (
                <div className="text-center py-16 px-4 space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-500 mx-auto flex items-center justify-center">
                    <Inbox className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800">No Applications Found</h3>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    {statusFilter === 'Pending'
                      ? 'Great job! All submitted student applications have been reviewed.'
                      : 'No applications match your selected filters or search query.'}
                  </p>
                  {(statusFilter !== 'All' || classFilter || searchQuery) && (
                    <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setStatusFilter('All');
                          setClassFilter('');
                          setSearchQuery('');
                        }}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-indigo-600 hover:bg-slate-50 transition cursor-pointer"
                      >
                        {statusFilter === 'Pending' && stats.total > 0
                          ? `View All Applications (${stats.total})`
                          : 'Clear Filters'}
                      </button>
                      {enrollmentApplications.length > 0 && (
                        <button
                          type="button"
                          onClick={() => handleExportCSV(enrollmentApplications, 'all')}
                          className="px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-xs font-bold text-indigo-700 transition cursor-pointer flex items-center gap-1.5"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Export All CSV ({stats.total})</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/80 border-b border-slate-200/80 text-[11px] font-black uppercase tracking-wider text-slate-500">
                        <th className="py-3 px-4">Applicant</th>
                        <th className="py-3 px-4">Application &amp; Class</th>
                        <th className="py-3 px-4">Guardian Details</th>
                        <th className="py-3 px-4">Submitted</th>
                        <th className="py-3 px-4">Portal Account</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {filteredApplications.map((app) => (
                        <tr key={app.id} className="hover:bg-slate-50/70 transition group">
                          {/* Column 1: Applicant Profile */}
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-3">
                              <div
                                onClick={() =>
                                  app.photoUrl && setPhotoZoomUrl({ url: app.photoUrl, name: app.name })
                                }
                                className={`w-11 h-11 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center ${
                                  app.photoUrl ? 'cursor-pointer hover:ring-2 hover:ring-indigo-400' : ''
                                }`}
                                title={app.photoUrl ? 'Click to zoom photo' : undefined}
                              >
                                {app.photoUrl ? (
                                  <AuthenticatedImage
                                    src={app.photoUrl}
                                    alt={app.name}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <span className="font-black text-indigo-600 text-xs">
                                    {app.name.slice(0, 2).toUpperCase()}
                                  </span>
                                )}
                              </div>
                              <div className="space-y-0.5">
                                <span className="font-bold text-slate-900 block group-hover:text-indigo-600 transition">
                                  {app.name}
                                </span>
                                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                                  <span>{app.gender}</span>
                                  <span>•</span>
                                  <span>DOB: {app.dob}</span>
                                </div>
                                <div className="flex items-center gap-1.5 pt-0.5">
                                  {app.bloodGroup && (
                                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-rose-50 text-rose-700 border border-rose-200">
                                      {app.bloodGroup}
                                    </span>
                                  )}
                                  {app.medicalConditions && (
                                    <span
                                      className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1"
                                      title={app.medicalConditions}
                                    >
                                      <AlertTriangle className="w-2.5 h-2.5" /> Medical Note
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Column 2: Application ID & Class */}
                          <td className="py-3.5 px-4">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-bold text-slate-700">#{app.applicationNo}</span>
                                <button
                                  type="button"
                                  onClick={() => copyToClipboard(app.applicationNo)}
                                  className="text-slate-400 hover:text-slate-600"
                                  title="Copy Application Number"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              </div>
                              <div>
                                <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
                                  {app.className} - {app.section || 'A'}
                                </span>
                              </div>
                              {app.hasDocument && (
                                <div className="pt-0.5">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenDocPreview(app)}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition cursor-pointer"
                                    title={`Click to preview: ${app.documentName || app.documentCategory}`}
                                  >
                                    <FileText className="w-2.5 h-2.5 text-emerald-600" />
                                    <span>{app.documentCategory || 'Document'}</span>
                                  </button>
                                </div>
                              )}
                              <span className="text-[10px] font-mono text-slate-400 block">
                                {app.academicYear}
                              </span>
                            </div>
                          </td>

                          {/* Column 3: Guardian Details */}
                          <td className="py-3.5 px-4">
                            <div className="space-y-0.5">
                              <span className="font-bold text-slate-800 block">{app.parentName}</span>
                              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                                <Phone className="w-3 h-3 text-slate-400" />
                                <a
                                  href={`tel:${app.parentPhone}`}
                                  className="font-mono text-indigo-600 hover:underline"
                                >
                                  {app.parentPhone}
                                </a>
                              </div>
                              {app.parentEmail && (
                                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 truncate max-w-[160px]">
                                  <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                                  <span className="truncate">{app.parentEmail}</span>
                                </div>
                              )}
                              {app.address && (
                                <span
                                  className="text-[10px] text-slate-400 truncate max-w-[160px] block cursor-help"
                                  title={app.address}
                                >
                                  📍 {app.address}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Column 4: Submission Time */}
                          <td className="py-3.5 px-4 text-slate-600">
                            <div className="space-y-0.5">
                              <span className="font-medium block">
                                {new Date(app.submittedAt).toLocaleDateString()}
                              </span>
                              <span className="text-[11px] font-mono text-slate-400 block">
                                {new Date(app.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                              <span className="text-[10px] text-indigo-600 font-bold bg-indigo-50 px-1.5 py-0.2 rounded inline-block">
                                24h Public Link
                              </span>
                            </div>
                          </td>

                          {/* Column 5: Provisional User Account */}
                          <td className="py-3.5 px-4">
                            <div className="space-y-1">
                              <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                {app.provisionalUsername}
                              </span>
                              <span className="text-[10px] text-slate-400 block">
                                {app.status === 'Approved' ? 'Account Active' : 'Pending Activation'}
                              </span>
                            </div>
                          </td>

                          {/* Column 6: Review Status */}
                          <td className="py-3.5 px-4">
                            {app.status === 'Pending' && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200">
                                <Clock className="w-3 h-3" />
                                Pending Approval
                              </span>
                            )}
                            {app.status === 'Approved' && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">
                                <CheckCircle2 className="w-3 h-3" />
                                Enrolled
                              </span>
                            )}
                            {app.status === 'Rejected' && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-200">
                                <XCircle className="w-3 h-3" />
                                Rejected
                              </span>
                            )}
                          </td>

                          {/* Column 7: Actions */}
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {app.status === 'Pending' ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenReviewModal(app)}
                                    className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white text-xs font-bold transition flex items-center gap-1 shadow-xs cursor-pointer"
                                  >
                                    <ShieldCheck className="w-3.5 h-3.5" />
                                    <span>Review &amp; Decide</span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => handleQuickApprove(app)}
                                    className="p-1.5 rounded-xl border border-emerald-200 hover:bg-emerald-50 text-emerald-700 text-xs font-bold transition cursor-pointer"
                                    title="Quick Approve with Next Roll #"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleOpenReviewModal(app)}
                                  className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>Details</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* KANBAN COLUMNS VIEW */}
          {viewMode === 'kanban' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Lane 1: Pending */}
              <div className="bg-amber-50/40 rounded-2xl border border-amber-200/80 p-4 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-amber-200">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-600" />
                    <h3 className="text-xs font-black uppercase tracking-wider text-amber-900">
                      Pending Approvals
                    </h3>
                  </div>
                  <span className="text-xs font-mono font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                    {filteredApplications.filter((a) => a.status === 'Pending').length}
                  </span>
                </div>

                <div className="space-y-3 max-h-[600px] overflow-y-auto">
                  {filteredApplications
                    .filter((a) => a.status === 'Pending')
                    .map((app) => (
                      <div
                        key={app.id}
                        className="bg-white p-3.5 rounded-xl border border-amber-200 shadow-xs space-y-2.5 hover:shadow-md transition"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h4 className="text-xs font-bold text-slate-900">{app.name}</h4>
                            <span className="text-[10px] font-mono text-slate-400">#{app.applicationNo}</span>
                          </div>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100">
                            {app.className}-{app.section || 'A'}
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-500 space-y-0.5">
                          <div>Guardian: <strong>{app.parentName}</strong></div>
                          <div>Phone: <strong className="font-mono">{app.parentPhone}</strong></div>
                          <div className="flex items-center justify-between gap-1">
                            <span>DOB: {app.dob}</span>
                            {app.hasDocument && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenDocPreview(app);
                                }}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition cursor-pointer"
                                title={`Click to preview: ${app.documentName || app.documentCategory}`}
                              >
                                <FileText className="w-2.5 h-2.5 text-emerald-600" />
                                <span>{app.documentCategory || 'Doc'}</span>
                              </button>
                            )}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleOpenReviewModal(app)}
                          className="w-full py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Review &amp; Decide</span>
                        </button>
                      </div>
                    ))}
                </div>
              </div>

              {/* Lane 2: Approved */}
              <div className="bg-emerald-50/40 rounded-2xl border border-emerald-200/80 p-4 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-emerald-200">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <h3 className="text-xs font-black uppercase tracking-wider text-emerald-900">
                      Enrolled &amp; Approved
                    </h3>
                  </div>
                  <span className="text-xs font-mono font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                    {filteredApplications.filter((a) => a.status === 'Approved').length}
                  </span>
                </div>

                <div className="space-y-3 max-h-[600px] overflow-y-auto">
                  {filteredApplications
                    .filter((a) => a.status === 'Approved')
                    .map((app) => (
                      <div
                        key={app.id}
                        className="bg-white p-3.5 rounded-xl border border-emerald-200 shadow-xs space-y-2 hover:shadow-md transition"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h4 className="text-xs font-bold text-slate-900">{app.name}</h4>
                            <span className="text-[10px] font-mono text-slate-400">#{app.applicationNo}</span>
                          </div>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800">
                            {app.className}-{app.section || 'A'}
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-500 space-y-0.5">
                          <div>Guardian: {app.parentName}</div>
                          <div className="flex items-center justify-between gap-1">
                            <div>User ID: <strong className="font-mono text-slate-700">{app.provisionalUsername}</strong></div>
                            {app.hasDocument && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenDocPreview(app);
                                }}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition cursor-pointer"
                                title={`Click to preview: ${app.documentName || app.documentCategory}`}
                              >
                                <FileText className="w-2.5 h-2.5 text-emerald-600" />
                                <span>{app.documentCategory || 'Doc'}</span>
                              </button>
                            )}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleOpenReviewModal(app)}
                          className="w-full py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View Details</span>
                        </button>
                      </div>
                    ))}
                </div>
              </div>

              {/* Lane 3: Rejected */}
              <div className="bg-rose-50/40 rounded-2xl border border-rose-200/80 p-4 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-rose-200">
                  <div className="flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-rose-600" />
                    <h3 className="text-xs font-black uppercase tracking-wider text-rose-900">
                      Rejected
                    </h3>
                  </div>
                  <span className="text-xs font-mono font-bold bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full">
                    {filteredApplications.filter((a) => a.status === 'Rejected').length}
                  </span>
                </div>

                <div className="space-y-3 max-h-[600px] overflow-y-auto">
                  {filteredApplications
                    .filter((a) => a.status === 'Rejected')
                    .map((app) => (
                      <div
                        key={app.id}
                        className="bg-white p-3.5 rounded-xl border border-rose-200 shadow-xs space-y-2 hover:shadow-md transition"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h4 className="text-xs font-bold text-slate-900">{app.name}</h4>
                            <span className="text-[10px] font-mono text-slate-400">#{app.applicationNo}</span>
                          </div>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-rose-100 text-rose-800">
                            Rejected
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-500">
                          <div className="flex items-center justify-between gap-1">
                            <span>Reason: {app.rejectionRemarks || 'None specified'}</span>
                            {app.hasDocument && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenDocPreview(app);
                                }}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition cursor-pointer"
                                title={`Click to preview: ${app.documentName || app.documentCategory}`}
                              >
                                <FileText className="w-2.5 h-2.5 text-emerald-600" />
                                <span>{app.documentCategory || 'Doc'}</span>
                              </button>
                            )}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleOpenReviewModal(app)}
                          className="w-full py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View Record</span>
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          5. TAB 2: 24-HOUR ENROLLMENT LINKS MANAGEMENT
          ========================================================================= */}
      {activeTab === 'links' && (
        <div className="space-y-6">
          {/* Quick Generator Card */}
          <form
            onSubmit={handleCreateLink}
            className="p-5 rounded-2xl border border-indigo-100 bg-indigo-50/40 space-y-4 shadow-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-wider text-indigo-950 flex items-center gap-2">
                <LinkIcon className="w-4 h-4 text-indigo-600" />
                Generate New 24-Hour Self-Enrollment Link
              </h3>
              <span className="text-[10px] font-mono font-bold text-indigo-700 bg-indigo-100/90 px-3 py-1 rounded-full">
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
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                >
                  <option value="">All Classes (Applicant Chooses)</option>
                  {availableClassesList.map((cls) => (
                    <option key={cls.id} value={cls.name}>
                      {cls.name}
                    </option>
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
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                >
                  {academicYears.length > 0 ? (
                    academicYears.map((yr) => (
                      <option key={yr.id} value={yr.name}>
                        {yr.name}
                      </option>
                    ))
                  ) : (
                    <option value="2026-2027">2026-2027</option>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Campaign Title
                </label>
                <input
                  type="text"
                  placeholder="e.g. 2026 General Admissions"
                  value={newLinkTitle}
                  onChange={(e) => setNewLinkTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <p className="text-[11px] text-slate-500">
                Link stays valid for 24 hours from the moment a prospective student opens it. Admin must approve before admission.
              </p>
              <button
                type="submit"
                disabled={isCreatingLink}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-5 py-2.5 flex items-center gap-2 cursor-pointer shadow-md transition"
              >
                <LinkIcon className="h-3.5 w-3.5" />
                <span>{isCreatingLink ? 'Generating...' : 'Generate 24h Shareable Link'}</span>
              </button>
            </div>
          </form>

          {/* Latest Created Link Banner */}
          {latestCreatedLink && (
            <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 space-y-2 animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  New Enrollment Link Generated!
                </span>
                <span className="text-[10px] text-emerald-700 font-mono">
                  Token: {latestCreatedLink.token.slice(0, 10)}...
                </span>
              </div>
              <div className="flex items-center gap-2 bg-white p-2.5 rounded-xl border border-emerald-200">
                <input
                  type="text"
                  readOnly
                  value={`${window.location.origin}/enroll?token=${latestCreatedLink.token}`}
                  className="flex-1 text-xs font-mono text-slate-700 bg-transparent outline-none select-all"
                />
                <button
                  type="button"
                  onClick={() => handleCopyLink(latestCreatedLink.token)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1 cursor-pointer transition"
                >
                  {copiedLinkToken === latestCreatedLink.token ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedLinkToken === latestCreatedLink.token ? 'Copied!' : 'Copy Link'}</span>
                </button>
                <a
                  href={`/enroll?token=${latestCreatedLink.token}`}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition"
                  title="Test Link"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </div>
          )}

          {/* Links List */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
                Generated Enrollment Links ({enrollmentLinks.length})
              </h4>
              <button
                type="button"
                onClick={() => refetchLinks()}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-bold"
              >
                Refresh list
              </button>
            </div>

            {enrollmentLinks.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-xs">
                No enrollment links generated yet. Use the form above to generate your first link.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {enrollmentLinks.map((lnk) => (
                  <div
                    key={lnk.id}
                    className="p-4 hover:bg-slate-50/70 transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                  >
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
                            Opened ({lnk.remainingSeconds >= 3600
                              ? `${Math.floor(lnk.remainingSeconds / 3600)}h ${Math.floor((lnk.remainingSeconds % 3600) / 60)}m`
                              : `${Math.floor(lnk.remainingSeconds / 60)}m`} left)
                          </span>
                        ) : lnk.is_active ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                            Active &amp; Ready
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
                        className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition"
                      >
                        {copiedLinkToken === lnk.token ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-slate-400" />}
                        <span>{copiedLinkToken === lnk.token ? 'Copied' : 'Copy'}</span>
                      </button>
                      <a
                        href={`/enroll?token=${lnk.token}`}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-600 transition"
                        title="Open Form"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      {lnk.is_active && !lnk.isExpired && (
                        <button
                          type="button"
                          onClick={() => handleDeactivateLink(lnk.id)}
                          className="px-3 py-1.5 rounded-xl border border-rose-200 hover:bg-rose-50 text-rose-600 text-xs font-bold transition cursor-pointer"
                        >
                          Deactivate
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          6. DETAILED REVIEW & APPROVAL MODAL (PORTAL)
          ========================================================================= */}
      {selectedApplication &&
        createPortal(
          <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex min-h-full items-center justify-center p-4">
            <section
              role="dialog"
              aria-modal="true"
              className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-auto animate-fade-in"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold shrink-0 shadow-sm">
                    <GraduationCap className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-slate-900">{selectedApplication.name}</h3>
                      <span
                        className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                          selectedApplication.status === 'Approved'
                            ? 'bg-emerald-100 text-emerald-800'
                            : selectedApplication.status === 'Rejected'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {selectedApplication.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 font-mono">
                      #{selectedApplication.applicationNo} • Cycle: {selectedApplication.academicYear}
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
                {/* Status Alert Banner */}
                {appActionMsg && (
                  <div
                    className={`p-3.5 rounded-xl text-xs font-bold ${
                      appActionMsg.type === 'success'
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-rose-50 text-rose-800 border border-rose-200'
                    }`}
                  >
                    {appActionMsg.text}
                  </div>
                )}

                {/* Profile Overview Card */}
                <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-4">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <div
                      onClick={() =>
                        selectedApplication.photoUrl &&
                        setPhotoZoomUrl({ url: selectedApplication.photoUrl, name: selectedApplication.name })
                      }
                      className="w-20 h-20 rounded-2xl bg-white border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center shadow-xs cursor-pointer hover:ring-2 hover:ring-indigo-400 transition"
                      title="Click to view full photo"
                    >
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
                          <strong className="text-slate-700">
                            {selectedApplication.medicalConditions || 'None reported'}
                          </strong>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Guardian & Address */}
                  <div className="pt-3 border-t border-slate-200/80 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Parent / Guardian</span>
                      <strong className="text-slate-800">{selectedApplication.parentName}</strong>
                      <span className="block text-slate-500 font-mono mt-0.5">{selectedApplication.parentPhone}</span>
                      <span className="block text-slate-500">{selectedApplication.parentEmail}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Residential Address</span>
                      <p className="text-slate-700 leading-relaxed mt-0.5">
                        {selectedApplication.address || 'Not provided'}
                      </p>
                    </div>
                  </div>

                  {/* Uploaded Supporting Document */}
                  <div className="pt-3 border-t border-slate-200/80">
                    <div className="p-3.5 rounded-2xl border border-emerald-200 bg-emerald-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-emerald-100 text-emerald-700 shrink-0">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] uppercase font-bold text-emerald-800">
                              Supporting Document
                            </span>
                            {selectedApplication.hasDocument ? (
                              <span className="px-2 py-0.2 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                Attached
                              </span>
                            ) : (
                              <span className="px-2 py-0.2 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200">
                                Not Attached
                              </span>
                            )}
                          </div>
                          {selectedApplication.hasDocument ? (
                            <p className="text-xs font-bold text-slate-800 mt-0.5">
                              {selectedApplication.documentCategory || 'Document'}: {selectedApplication.documentName || 'Attachment'}
                            </p>
                          ) : (
                            <p className="text-xs text-slate-500 italic mt-0.5">
                              No supporting document was uploaded with this application
                            </p>
                          )}
                        </div>
                      </div>

                      {selectedApplication.hasDocument && selectedApplication.documentUrl && (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleOpenDocPreview(selectedApplication)}
                            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-xs cursor-pointer active:scale-95"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View / Preview</span>
                          </button>
                          <button
                            type="button"
                            disabled={downloadingDocAppId === selectedApplication.id}
                            onClick={() => handleDownloadDoc(selectedApplication)}
                            className="px-3 py-2 rounded-xl bg-white border border-emerald-300 hover:bg-emerald-50 text-emerald-700 text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-xs cursor-pointer disabled:opacity-50"
                            title="Download document directly"
                          >
                            {downloadingDocAppId === selectedApplication.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Download className="w-3.5 h-3.5" />
                            )}
                            <span>Download</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Provisional Credentials Notice */}
                  <div className="p-3 rounded-xl border border-indigo-100 bg-indigo-50/70 text-xs space-y-1">
                    <span className="font-bold text-indigo-900 flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4 text-indigo-600" />
                      Provisional Student Portal Credentials
                    </span>
                    <p className="text-[11px] text-indigo-800">
                      Login ID: <strong className="font-mono">{selectedApplication.provisionalUsername}</strong>
                    </p>
                    <p className="text-[10px] text-slate-500">
                      Candidate received temporary credentials upon submission. Approving activates their account and tuition ledger in the database.
                    </p>
                  </div>
                </div>

                {/* Class Assignment Form if Pending */}
                {selectedApplication.status === 'Pending' && !isRejectingAppFormOpen && (
                  <div className="p-4 rounded-2xl border border-indigo-200 bg-white space-y-4 shadow-xs">
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      Class Allocation &amp; Admission Details
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
                            const inCls = students.filter((s) => s.class === nextCls);
                            const highest = inCls.reduce((max, s) => Math.max(max, Number(s.rollNo || 0)), 0);
                            setReviewAssignRollNo(highest + 1);
                          }}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                        >
                          {availableClassesList.map((cls) => (
                            <option key={cls.id} value={cls.name}>
                              {cls.name}
                            </option>
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
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                        >
                          {['A', 'B', 'C', 'D'].map((sec) => (
                            <option key={sec} value={sec}>
                              Section {sec}
                            </option>
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
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-100 text-[11px] text-emerald-800 flex items-start gap-2">
                      <CreditCard className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span>
                        Upon approval, this student is saved to <strong>{reviewAssignClass}-{reviewAssignSection}</strong> with active login and fee ledger.
                      </span>
                    </div>
                  </div>
                )}

                {/* Rejection Form */}
                {selectedApplication.status === 'Pending' && isRejectingAppFormOpen && (
                  <div className="p-4 rounded-2xl border border-rose-200 bg-rose-50/60 space-y-3">
                    <h4 className="text-xs font-bold text-rose-900 flex items-center gap-1.5">
                      <XCircle className="h-4 w-4 text-rose-600" />
                      Reject Student Application
                    </h4>
                    <p className="text-[11px] text-rose-700">
                      Rejecting removes the provisional account and marks application status as Rejected.
                    </p>
                    <textarea
                      rows={2}
                      placeholder="Reason for rejection (e.g. Incomplete information, seats full)..."
                      value={reviewRejectRemarks}
                      onChange={(e) => setReviewRejectRemarks(e.target.value)}
                      className="w-full rounded-xl border border-rose-200 bg-white p-2.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-rose-500"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setIsRejectingAppFormOpen(false)}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        disabled={isRejectingApp}
                        onClick={handleConfirmRejectApp}
                        className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition shadow-xs cursor-pointer"
                      >
                        {isRejectingApp ? 'Rejecting...' : 'Confirm Rejection'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50/80">
                <button
                  type="button"
                  onClick={() => setSelectedApplication(null)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
                >
                  Close
                </button>

                {selectedApplication.status === 'Pending' && !isRejectingAppFormOpen && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsRejectingAppFormOpen(true)}
                      className="rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 px-4 py-2 text-xs font-bold transition cursor-pointer"
                    >
                      Reject Application
                    </button>

                    <button
                      type="button"
                      disabled={isApprovingApp}
                      onClick={handleConfirmApproveApp}
                      className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white px-5 py-2 text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition cursor-pointer"
                    >
                      <Check className="h-4 w-4" />
                      <span>{isApprovingApp ? 'Enrolling...' : 'Approve & Enroll Candidate'}</span>
                    </button>
                  </div>
                )}
              </div>
            </section>
          </div>,
          document.body
        )}

      {/* =========================================================================
          7. APPROVAL CREDENTIALS SLIP POPUP
          ========================================================================= */}
      {approvedCredentialsSlip &&
        createPortal(
          <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex min-h-full items-center justify-center p-4">
            <div className="max-w-md w-full bg-white rounded-3xl p-6 sm:p-8 space-y-5 border border-emerald-200 shadow-2xl animate-fade-in my-auto">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto shadow-inner">
                <BadgeCheck className="w-8 h-8" />
              </div>
              <div className="text-center space-y-1">
                <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                  Admission Approved &amp; Enrolled
                </span>
                <h3 className="text-lg font-black text-slate-900">
                  {approvedCredentialsSlip.studentName}
                </h3>
                <p className="text-xs text-slate-500">
                  Enrolled into <strong>{approvedCredentialsSlip.className}-{approvedCredentialsSlip.section}</strong> (Roll #{approvedCredentialsSlip.rollNo})
                </p>
              </div>

              {/* Credentials Box */}
              <div className="p-4 rounded-2xl bg-slate-950 text-slate-100 space-y-3 font-mono text-xs">
                <div className="flex items-center justify-between text-slate-400 text-[10px] uppercase font-bold tracking-wider">
                  <span>Student Portal Credentials</span>
                  <span>Active</span>
                </div>
                <div className="space-y-1 border-t border-slate-800 pt-2">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Login ID:</span>
                    <span className="font-bold text-emerald-400 select-all">{approvedCredentialsSlip.loginId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Password:</span>
                    <span className="font-bold text-amber-300 select-all">{approvedCredentialsSlip.temporaryPassword}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const text = `Welcome to ${schoolName}!\nStudent: ${approvedCredentialsSlip.studentName}\nClass: ${approvedCredentialsSlip.className}-${approvedCredentialsSlip.section}\nRoll No: ${approvedCredentialsSlip.rollNo}\nPortal Login ID: ${approvedCredentialsSlip.loginId}\nPassword: ${approvedCredentialsSlip.temporaryPassword}`;
                    await copyToClipboard(text);
                    setCopiedSlip(true);
                    setTimeout(() => setCopiedSlip(false), 3000);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition shadow-xs"
                >
                  {copiedSlip ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedSlip ? 'Copied Slip!' : 'Copy Credentials Slip'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setApprovedCredentialsSlip(null);
                    setCopiedSlip(false);
                  }}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-bold cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* =========================================================================
          8. PHOTO FULLSCREEN PREVIEW MODAL
          ========================================================================= */}
      {photoZoomUrl &&
        createPortal(
          <div
            onClick={() => setPhotoZoomUrl(null)}
            className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 cursor-pointer"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="max-w-md w-full bg-white rounded-3xl overflow-hidden shadow-2xl p-4 text-center space-y-3"
            >
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="text-xs font-bold text-slate-800">{photoZoomUrl.name}</span>
                <button
                  type="button"
                  onClick={() => setPhotoZoomUrl(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="w-full aspect-square rounded-2xl overflow-hidden bg-slate-100 border border-slate-200">
                <AuthenticatedImage
                  src={photoZoomUrl.url}
                  alt={photoZoomUrl.name}
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* =========================================================================
          8b. DOCUMENT FULLSCREEN PREVIEW MODAL
          ========================================================================= */}
      {docPreviewModal?.isOpen &&
        createPortal(
          <div
            onClick={closeDocPreview}
            className="fixed inset-0 z-[10000] bg-slate-950/85 backdrop-blur-md flex flex-col p-3 sm:p-6 cursor-pointer"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-4xl mx-auto my-auto bg-slate-900 rounded-3xl overflow-hidden shadow-2xl border border-slate-700/60 flex flex-col max-h-[92vh] cursor-default"
            >
              {/* Modal Header */}
              <div className="px-5 sm:px-6 py-3.5 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono uppercase font-black tracking-wider px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
                        {docPreviewModal.category || 'Supporting Document'}
                      </span>
                      <span className="text-xs text-slate-400 truncate">
                        Applicant: <strong className="text-white">{docPreviewModal.app?.name}</strong> ({docPreviewModal.app?.applicationNo})
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-white truncate mt-0.5" title={docPreviewModal.filename}>
                      {docPreviewModal.filename}
                    </h3>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {!docPreviewModal.isPdf && docPreviewModal.blobUrl && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          setDocPreviewModal((prev) =>
                            prev ? { ...prev, scale: Math.max(0.5, +(prev.scale - 0.25).toFixed(2)) } : null
                          )
                        }
                        className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition cursor-pointer"
                        title="Zoom Out"
                      >
                        <ZoomOut className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDocPreviewModal((prev) =>
                            prev ? { ...prev, scale: Math.min(3, +(prev.scale + 0.25).toFixed(2)) } : null
                          )
                        }
                        className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition cursor-pointer"
                        title="Zoom In"
                      >
                        <ZoomIn className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDocPreviewModal((prev) =>
                            prev ? { ...prev, rotation: (prev.rotation + 90) % 360 } : null
                          )
                        }
                        className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition cursor-pointer"
                        title="Rotate 90°"
                      >
                        <RotateCw className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDocPreviewModal((prev) => (prev ? { ...prev, scale: 1, rotation: 0 } : null))
                        }
                        className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition cursor-pointer"
                        title="Reset Zoom"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    </>
                  )}

                  {docPreviewModal.blobUrl && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          if (docPreviewModal.app) handleDownloadDoc(docPreviewModal.app);
                        }}
                        className="p-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition flex items-center gap-1.5 px-3 text-xs cursor-pointer shadow-xs"
                        title="Download File to Computer"
                      >
                        <Download className="w-4 h-4" />
                        <span className="hidden sm:inline">Download</span>
                      </button>
                      <a
                        href={docPreviewModal.blobUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition"
                        title="Open in new window"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={closeDocPreview}
                    className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition ml-1 cursor-pointer"
                    title="Close Preview"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-auto bg-slate-950 p-4 sm:p-6 flex items-center justify-center min-h-[420px]">
                {docPreviewModal.isLoading ? (
                  <div className="flex flex-col items-center justify-center gap-3 text-slate-400 py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                    <p className="text-xs font-semibold">Loading secure document preview...</p>
                  </div>
                ) : docPreviewModal.error ? (
                  <div className="p-6 max-w-md bg-rose-950/40 border border-rose-800/60 rounded-2xl text-center space-y-3">
                    <AlertCircle className="w-8 h-8 text-rose-400 mx-auto" />
                    <p className="text-xs text-rose-200">{docPreviewModal.error}</p>
                    <button
                      type="button"
                      onClick={() => docPreviewModal.app && handleOpenDocPreview(docPreviewModal.app)}
                      className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-500 transition cursor-pointer"
                    >
                      Retry Loading
                    </button>
                  </div>
                ) : docPreviewModal.isPdf && docPreviewModal.blobUrl ? (
                  <iframe
                    src={docPreviewModal.blobUrl}
                    title={docPreviewModal.filename}
                    className="w-full h-[65vh] rounded-2xl bg-white shadow-xl border-0"
                  />
                ) : docPreviewModal.blobUrl ? (
                  <div className="overflow-auto max-h-[70vh] max-w-full flex items-center justify-center p-2">
                    <img
                      src={docPreviewModal.blobUrl}
                      alt={docPreviewModal.filename}
                      style={{
                        transform: `scale(${docPreviewModal.scale}) rotate(${docPreviewModal.rotation}deg)`,
                        transition: 'transform 0.15s ease-out',
                      }}
                      className="max-h-[65vh] max-w-full rounded-xl object-contain shadow-2xl"
                    />
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">No document content available.</p>
                )}
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/80 flex items-center justify-between text-xs text-slate-400">
                <span>
                  Application #{docPreviewModal.app?.applicationNo} • Submitted{' '}
                  {docPreviewModal.app?.submittedAt
                    ? new Date(docPreviewModal.app.submittedAt).toLocaleDateString()
                    : ''}
                </span>
                <span className="font-mono text-[11px] text-slate-400 font-bold">
                  {docPreviewModal.isPdf ? 'PDF Document' : 'Image File'}
                </span>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* =========================================================================
          9. GENERATE 24H LINK MODAL (TRIGGERED FROM HEADER)
          ========================================================================= */}
      {isCreateLinkModalOpen &&
        createPortal(
          <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex min-h-full items-center justify-center p-4">
            <div className="max-w-lg w-full bg-white rounded-3xl shadow-2xl border border-slate-200 p-6 space-y-5 animate-fade-in my-auto">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
                    <LinkIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900">Create 24-Hour Self-Enrollment Link</h3>
                    <p className="text-[11px] text-slate-500">Public candidate admission portal</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreateLinkModalOpen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateLink} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    Target Class (Optional)
                  </label>
                  <select
                    value={newLinkTargetClass}
                    onChange={(e) => setNewLinkTargetClass(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                  >
                    <option value="">All Classes (Applicant Selects)</option>
                    {availableClassesList.map((cls) => (
                      <option key={cls.id} value={cls.name}>
                        {cls.name}
                      </option>
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
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                  >
                    {academicYears.length > 0 ? (
                      academicYears.map((yr) => (
                        <option key={yr.id} value={yr.name}>
                          {yr.name}
                        </option>
                      ))
                    ) : (
                      <option value="2026-2027">2026-2027</option>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    Campaign / Link Title
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 2026-27 General Admissions"
                    value={newLinkTitle}
                    onChange={(e) => setNewLinkTitle(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div className="p-3 bg-indigo-50/80 rounded-xl border border-indigo-100 text-[11px] text-indigo-900 flex items-start gap-2">
                  <Clock className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                  <span>
                    <strong>24-Hour Policy:</strong> The security timer counts down exactly 24 hours once opened by the applicant.
                  </span>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsCreateLinkModalOpen(false)}
                    className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isCreatingLink}
                    className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md cursor-pointer transition"
                  >
                    {isCreatingLink ? 'Creating...' : 'Generate Shareable Link'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
