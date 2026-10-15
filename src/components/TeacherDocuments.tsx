import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  FileText,
  UploadCloud,
  CheckCircle2,
  Clock,
  AlertCircle,
  Download,
  Trash2,
  ShieldCheck,
  CreditCard,
  Building2,
  FileCheck,
  RefreshCw,
  Info,
  Eye,
  ExternalLink,
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Check,
  GraduationCap
} from 'lucide-react';
import { emitNotification } from '../services/notificationBus';
import { apiDownload } from '../services/api';
import {
  useGetTeachersQuery,
  useUploadTeacherDocumentMutation,
  useDeleteTeacherDocumentMutation,
  TeacherApiDocument
} from '../store/api/teacherApi';

interface TeacherDocumentsProps {
  user?: any;
  schoolName?: string;
}

const DOCUMENT_PRESETS = [
  {
    category: 'Aadhaar Card',
    name: 'Aadhaar Card (Front & Back)',
    description: 'Government issued 12-digit Aadhaar card proof for identity and address verification.',
    mandatory: true,
    icon: ShieldCheck,
  },
  {
    category: 'Bank Passbook',
    name: 'Bank Passbook / Cancelled Cheque',
    description: 'Bank passbook front page or cancelled cheque showing Account No, IFSC, and Name.',
    mandatory: true,
    icon: CreditCard,
  },
  {
    category: 'PAN Card',
    name: 'PAN Card',
    description: 'Permanent Account Number card copy for tax records and salary compliance.',
    mandatory: false,
    icon: Building2,
  },
  {
    category: 'Qualification Certificate',
    name: 'Highest Educational Degree / Certificate',
    description: 'Degree, B.Ed, or highest qualification marksheet/degree certificate.',
    mandatory: false,
    icon: FileCheck,
  },
  {
    category: 'Other Document',
    name: 'Other Supporting Document',
    description: 'Experience letter, address proof, or any other official verification document.',
    mandatory: false,
    icon: FileText,
  },
];

export default function TeacherDocuments({ user, schoolName = 'School Management Portal' }: TeacherDocumentsProps) {
  const isServerBacked = Boolean(localStorage.getItem('school_erp_api_token'));
  const { data: teachers = [], refetch } = useGetTeachersQuery(undefined, { skip: !isServerBacked });

  // Find the current logged-in teacher profile
  const currentTeacher = useMemo(() => {
    if (isServerBacked && teachers.length) {
      return (
        teachers.find((t) => t.email?.toLowerCase() === user?.email?.toLowerCase()) ||
        teachers[0]
      );
    }
    try {
      const raw = localStorage.getItem('erp_teachers');
      if (raw) {
        const parsed = JSON.parse(raw);
        return (
          parsed.find((t: any) => t.email?.toLowerCase() === user?.email?.toLowerCase()) ||
          parsed[0] ||
          null
        );
      }
    } catch {
      return null;
    }
    return null;
  }, [teachers, user, isServerBacked]);

  const [uploadMutation, { isLoading: isUploading }] = useUploadTeacherDocumentMutation();
  const [deleteMutation, { isLoading: isDeleting }] = useDeleteTeacherDocumentMutation();

  // Local state for uploading form
  const [selectedCategory, setSelectedCategory] = useState<string>('Aadhaar Card');
  const [customDocName, setCustomDocName] = useState<string>('Aadhaar Card');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string>('');
  const [uploadSuccess, setUploadSuccess] = useState<string>('');
  const [isDownloadingId, setIsDownloadingId] = useState<number | null>(null);
  const [isPreviewLoadingId, setIsPreviewLoadingId] = useState<number | null>(null);
  interface PreviewDocState {
    doc: TeacherApiDocument;
    url: string;
    isPdf: boolean;
    index: number;
    total: number;
    scale: number;
    rotation: number;
  }
  const [previewDoc, setPreviewDoc] = useState<PreviewDocState | null>(null);

  // Documents list
  const documents: TeacherApiDocument[] = useMemo(() => {
    if (!currentTeacher) return [];
    return currentTeacher.documents || [];
  }, [currentTeacher]);

  // Handle Preset selection
  const handleSelectPreset = (preset: typeof DOCUMENT_PRESETS[0]) => {
    setSelectedCategory(preset.category);
    setCustomDocName(preset.name);
    setUploadError('');
    setUploadSuccess('');
  };

  // Upload handler
  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setUploadError('Please select a document file to upload.');
      return;
    }
    if (selectedFile.size > 5 * 1024 * 1024) {
      setUploadError('File size exceeds the 5 MB limit.');
      return;
    }
    if (!currentTeacher) {
      setUploadError('Teacher profile could not be identified. Please contact the administrator.');
      return;
    }

    setUploadError('');
    setUploadSuccess('');

    if (isServerBacked) {
      try {
        const formData = new FormData();
        formData.append('name', customDocName || selectedCategory);
        formData.append('category', selectedCategory);
        formData.append('file', selectedFile);

        await uploadMutation({
          teacherId: Number(currentTeacher.id),
          body: formData,
        }).unwrap();

        setUploadSuccess(`"${customDocName || selectedCategory}" uploaded successfully. It is now pending admin verification.`);
        emitNotification({
          title: 'Teacher Document Uploaded',
          message: `"${customDocName || selectedCategory}" was uploaded for ${currentTeacher.name}.`,
          tone: 'success',
          source: 'documents',
        });
        setSelectedFile(null);
        refetch();
      } catch (err: any) {
        setUploadError(err?.data?.detail || err?.message || 'Failed to upload document to server.');
      }
    } else {
      // LocalStorage fallback for offline demo
      try {
        const raw = localStorage.getItem('erp_teachers');
        const teachersList = raw ? JSON.parse(raw) : [];
        const newDoc: TeacherApiDocument = {
          id: Date.now(),
          name: customDocName || selectedCategory,
          category: selectedCategory,
          status: 'Pending',
          remarks: '',
          fileType: selectedFile.name.endsWith('.pdf') ? 'PDF' : 'JPG',
          fileName: selectedFile.name,
          uploadedAt: new Date().toISOString(),
        };

        const updated = teachersList.map((t: any) => {
          if (String(t.id) === String(currentTeacher.id)) {
            const existing = t.documents || [];
            return { ...t, documents: [newDoc, ...existing] };
          }
          return t;
        });

        localStorage.setItem('erp_teachers', JSON.stringify(updated));
        setUploadSuccess(`"${customDocName || selectedCategory}" uploaded. It is now pending admin verification.`);
        setSelectedFile(null);
        window.location.reload();
      } catch (err) {
        setUploadError('Failed to save document locally.');
      }
    }
  };

  // Delete handler
  const handleDelete = async (doc: TeacherApiDocument) => {
    if (!confirm(`Are you sure you want to remove "${doc.name}"?`)) return;
    if (!currentTeacher) return;

    if (isServerBacked) {
      try {
        await deleteMutation({
          teacherId: Number(currentTeacher.id),
          docId: Number(doc.id),
        }).unwrap();
        emitNotification({
          title: 'Teacher Document Deleted',
          message: `"${doc.name}" was removed.`,
          tone: 'warning',
          source: 'documents',
        });
        refetch();
      } catch (err: any) {
        alert(err?.data?.detail || 'Could not delete document.');
      }
    } else {
      try {
        const raw = localStorage.getItem('erp_teachers');
        if (raw) {
          const list = JSON.parse(raw);
          const updated = list.map((t: any) => {
            if (String(t.id) === String(currentTeacher.id)) {
              return { ...t, documents: (t.documents || []).filter((d: any) => d.id !== doc.id) };
            }
            return t;
          });
          localStorage.setItem('erp_teachers', JSON.stringify(updated));
          window.location.reload();
        }
      } catch { }
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

  // Preview handler
  const handlePreview = async (doc: TeacherApiDocument, docList?: TeacherApiDocument[]) => {
    if (!doc.downloadUrl) {
      alert('This document does not have a download or view URL.');
      return;
    }
    const list = docList || documents;
    const currentIndex = list.findIndex((d) => d.id === doc.id);
    setIsPreviewLoadingId(doc.id);
    try {
      const { blob, filename, contentType } = await apiDownload(doc.downloadUrl);
      const isPdf = contentType.includes('pdf') || (doc.fileType || '').toUpperCase() === 'PDF' || (doc.fileName || '').toLowerCase().endsWith('.pdf');
      const url = URL.createObjectURL(blob);
      setPreviewDoc((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return {
          doc: {
            ...doc,
            fileName: filename || doc.fileName,
          },
          url,
          isPdf,
          index: currentIndex >= 0 ? currentIndex : 0,
          total: list.length || 1,
          scale: 1,
          rotation: 0,
        };
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to load document for preview.');
    } finally {
      setIsPreviewLoadingId(null);
    }
  };

  const closeDocPreview = () => {
    if (previewDoc?.url) {
      URL.revokeObjectURL(previewDoc.url);
    }
    setPreviewDoc(null);
  };

  const navigatePreview = async (direction: 'prev' | 'next') => {
    if (!previewDoc) return;
    const targetIndex = direction === 'next' ? previewDoc.index + 1 : previewDoc.index - 1;
    if (targetIndex < 0 || targetIndex >= documents.length) return;
    const targetDoc = documents[targetIndex];
    if (targetDoc) {
      await handlePreview(targetDoc, documents);
    }
  };

  const zoomIn = () => setPreviewDoc((prev) => (prev ? { ...prev, scale: Math.min(3, +(prev.scale + 0.25).toFixed(2)) } : null));
  const zoomOut = () => setPreviewDoc((prev) => (prev ? { ...prev, scale: Math.max(0.5, +(prev.scale - 0.25).toFixed(2)) } : null));
  const resetZoom = () => setPreviewDoc((prev) => (prev ? { ...prev, scale: 1, rotation: 0 } : null));
  const rotateDoc = () => setPreviewDoc((prev) => (prev ? { ...prev, rotation: (prev.rotation + 90) % 360 } : null));

  // Download handler
  const handleDownload = async (doc: TeacherApiDocument) => {
    if (!doc.downloadUrl && !isServerBacked) {
      alert(`Local preview for "${doc.name}" (${doc.fileName || 'file'}).`);
      return;
    }
    if (!doc.downloadUrl) return;

    setIsDownloadingId(doc.id);
    try {
      const { blob, filename } = await apiDownload(doc.downloadUrl);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || doc.fileName || `${doc.name}.${doc.fileType.toLowerCase()}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not download document. Please try again.');
    } finally {
      setIsDownloadingId(null);
    }
  };

  // Overall status evaluation
  const statusSummary = useMemo(() => {
    if (!documents.length) {
      return {
        type: 'missing',
        badge: 'Documents Pending Upload',
        title: 'Upload Required Documents',
        description: 'Please upload your Aadhaar Card and Bank Passbook/Cheque to complete your staff profile verification.',
        theme: 'amber',
      };
    }

    const hasRejected = documents.some((d) => d.status === 'Rejected');
    if (hasRejected) {
      return {
        type: 'rejected',
        badge: 'Action Required',
        title: 'Document Verification Requires Attention',
        description: 'One or more of your uploaded documents were rejected by the School Administration. Please review remarks and re-upload.',
        theme: 'rose',
      };
    }

    const hasPending = documents.some((d) => d.status === 'Pending' || d.status === 'Uploaded');
    if (hasPending) {
      return {
        type: 'pending',
        badge: 'Pending Verification',
        title: 'Documents Awaiting Admin Approval',
        description: 'Your uploaded documents have been securely stored in the school database and are currently being reviewed by the administration.',
        theme: 'indigo',
      };
    }

    const hasVerified = documents.some((d) => d.status === 'Verified');
    if (hasVerified) {
      return {
        type: 'verified',
        badge: 'Profile Verified',
        title: 'All Uploaded Documents Verified',
        description: 'Your identity and banking credentials have been verified and approved by the School Administration.',
        theme: 'emerald',
      };
    }

    return {
      type: 'pending',
      badge: 'Pending Verification',
      title: 'Documents Submitted',
      description: 'Your documents are pending review by the school administration.',
      theme: 'indigo',
    };
  }, [documents]);

  const verifiedCount = documents.filter((d) => d.status === 'Verified').length;
  const pendingCount = documents.filter((d) => d.status === 'Pending' || d.status === 'Uploaded').length;
  const rejectedCount = documents.filter((d) => d.status === 'Rejected').length;

  return (
    <div className="space-y-6 animate-fade-in font-sans pb-12" id="teacher-documents-page">
      {/* Page Header */}
      <div className="rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-7 shadow-xs">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 text-indigo-600 shadow-2xs">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200/80">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
                  Staff Verification &amp; Credentials
                </span>
                <span className="text-xs text-slate-300">·</span>
                <span className="text-xs font-semibold text-slate-500 font-mono">{schoolName}</span>
              </div>
              <h1 className="mt-1 text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                Documents &amp; ID Verification
              </h1>
              <p className="mt-1 text-xs sm:text-sm text-slate-500 max-w-xl font-medium">
                Upload your Aadhaar Card, Bank Passbook, and supporting credentials. Stored securely in PostgreSQL for School Admin verification.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0 self-start md:self-center">
            {currentTeacher && (
              <div className="flex items-center gap-2.5 rounded-2xl border border-slate-200/90 bg-slate-50/80 px-3.5 py-2 shadow-2xs">
                <div className="grid h-8 w-8 place-items-center rounded-xl bg-indigo-600 text-xs font-bold text-white uppercase shadow-2xs">
                  {currentTeacher.name?.slice(0, 2) || 'TC'}
                </div>
                <div>
                  <p className="text-xs font-black text-slate-800">{currentTeacher.name}</p>
                  <p className="text-[10px] text-slate-400 font-mono">{currentTeacher.email}</p>
                </div>
              </div>
            )}
            <button
              onClick={() => refetch()}
              className="rounded-2xl border border-slate-200 bg-white p-2.5 text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-colors cursor-pointer shadow-2xs"
              title="Refresh status"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Overall Verification Status Banner */}
      <div
        className={`rounded-3xl border p-6 shadow-xs transition-all ${
          statusSummary.theme === 'emerald'
            ? 'border-emerald-200 bg-emerald-50/70 text-emerald-950'
            : statusSummary.theme === 'rose'
            ? 'border-rose-200 bg-rose-50/70 text-rose-950'
            : statusSummary.theme === 'amber'
            ? 'border-amber-200 bg-amber-50/70 text-amber-950'
            : 'border-indigo-200 bg-indigo-50/70 text-indigo-950'
        }`}
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div
              className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${
                statusSummary.theme === 'emerald'
                  ? 'bg-emerald-500 text-white'
                  : statusSummary.theme === 'rose'
                  ? 'bg-rose-500 text-white'
                  : statusSummary.theme === 'amber'
                  ? 'bg-amber-500 text-white'
                  : 'bg-indigo-600 text-white'
              }`}
            >
              {statusSummary.theme === 'emerald' ? (
                <CheckCircle2 className="h-6 w-6" />
              ) : statusSummary.theme === 'rose' ? (
                <AlertCircle className="h-6 w-6" />
              ) : statusSummary.theme === 'amber' ? (
                <Info className="h-6 w-6" />
              ) : (
                <Clock className="h-6 w-6" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                    statusSummary.theme === 'emerald'
                      ? 'bg-emerald-200/60 text-emerald-900'
                      : statusSummary.theme === 'rose'
                      ? 'bg-rose-200/60 text-rose-900'
                      : statusSummary.theme === 'amber'
                      ? 'bg-amber-200/60 text-amber-900'
                      : 'bg-indigo-200/60 text-indigo-900'
                  }`}
                >
                  {statusSummary.badge}
                </span>
                <span className="text-[11px] font-medium text-slate-500">
                  {documents.length} document{documents.length !== 1 ? 's' : ''} on record
                </span>
              </div>
              <h2 className="mt-1 text-lg font-black">{statusSummary.title}</h2>
              <p className="mt-0.5 text-xs text-slate-600 max-w-2xl leading-relaxed">
                {statusSummary.description}
              </p>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="flex items-center gap-2 border-t border-slate-200/60 pt-3 md:border-t-0 md:pt-0">
            <div className="rounded-2xl bg-white/80 px-3.5 py-2 text-center shadow-xs">
              <p className="text-[10px] font-bold text-slate-500 uppercase">Verified</p>
              <p className="text-lg font-black text-emerald-700">{verifiedCount}</p>
            </div>
            <div className="rounded-2xl bg-white/80 px-3.5 py-2 text-center shadow-xs">
              <p className="text-[10px] font-bold text-slate-500 uppercase">Pending</p>
              <p className="text-lg font-black text-amber-600">{pendingCount}</p>
            </div>
            {rejectedCount > 0 && (
              <div className="rounded-2xl bg-white/80 px-3.5 py-2 text-center shadow-xs">
                <p className="text-[10px] font-bold text-slate-500 uppercase">Rejected</p>
                <p className="text-lg font-black text-rose-600">{rejectedCount}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Column: Required Document Presets & Upload Form */}
        <div className="space-y-6 lg:col-span-5">
          {/* Document Presets Picker */}
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Required Staff Documents
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Select a required document to upload or replace:
            </p>

            <div className="mt-3 space-y-2">
              {DOCUMENT_PRESETS.map((preset) => {
                const IconComponent = preset.icon;
                const existingDoc = documents.find(
                  (d) => d.category === preset.category || d.name.toLowerCase().includes(preset.category.toLowerCase())
                );
                const isSelected = selectedCategory === preset.category;

                return (
                  <button
                    key={preset.category}
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    className={`w-full rounded-2xl border p-3 text-left transition-all flex items-start justify-between gap-3 ${
                      isSelected
                        ? 'border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-600/10'
                        : 'border-slate-100 bg-slate-50/60 hover:bg-slate-50 hover:border-slate-200'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${
                        isSelected ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 border border-slate-200'
                      }`}>
                        <IconComponent className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-black text-slate-800">{preset.name}</p>
                          {preset.mandatory && (
                            <span className="rounded-md bg-rose-50 px-1 py-0.2 text-[9px] font-bold text-rose-600">
                              Mandatory
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5 leading-tight">{preset.description}</p>
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      {existingDoc ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${
                            existingDoc.status === 'Verified'
                              ? 'bg-emerald-100 text-emerald-800'
                              : existingDoc.status === 'Rejected'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {existingDoc.status === 'Verified' ? '✓ Verified' : existingDoc.status === 'Rejected' ? '! Rejected' : '⧖ Pending'}
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-[9px] font-bold text-slate-600">
                          Not Uploaded
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Upload Form Box */}
          <div className="rounded-3xl border border-indigo-200 bg-white p-5 shadow-xs">
            <div className="flex items-center gap-2">
              <div className="grid h-7 w-7 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
                <UploadCloud className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">Upload to Database</h3>
                <p className="text-[11px] text-slate-400">Target: {selectedCategory}</p>
              </div>
            </div>

            {uploadError && (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                {uploadError}
              </div>
            )}
            {uploadSuccess && (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                {uploadSuccess}
              </div>
            )}

            <form onSubmit={handleUpload} className="mt-4 space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600">Document Label</label>
                <input
                  type="text"
                  value={customDocName}
                  onChange={(e) => setCustomDocName(e.target.value)}
                  placeholder="e.g. Aadhaar Card (Front & Back)"
                  required
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600">
                  Select File (PDF, JPEG, or PNG · Max 5MB)
                </label>
                <div className="mt-1 rounded-2xl border-2 border-dashed border-slate-200 p-4 text-center hover:border-indigo-400 transition-colors bg-slate-50/40">
                  <input
                    type="file"
                    id="teacher-doc-input"
                    accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      setSelectedFile(file);
                      setUploadError('');
                    }}
                    className="hidden"
                  />
                  <label htmlFor="teacher-doc-input" className="cursor-pointer block">
                    <UploadCloud className="mx-auto h-8 w-8 text-indigo-400" />
                    <p className="mt-1 text-xs font-bold text-slate-700">
                      {selectedFile ? selectedFile.name : 'Click to select file from computer'}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {selectedFile
                        ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB · Ready to upload`
                        : 'Stored securely in PostgreSQL database for approval'}
                    </p>
                  </label>
                </div>
              </div>

              <button
                type="submit"
                disabled={isUploading || !selectedFile}
                className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              >
                <UploadCloud className="h-4 w-4" />
                {isUploading ? 'Uploading to Database...' : 'Upload for Verification'}
              </button>
            </form>
          </div>
        </div>

        {/* Right Column: Uploaded Documents Ledger */}
        <div className="space-y-4 lg:col-span-7">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">Your Uploaded Documents</h3>
                <p className="text-xs text-slate-400">
                  Track current approval status and review remarks from the School Admin.
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                {documents.length} Item{documents.length !== 1 ? 's' : ''}
              </span>
            </div>

            {documents.length === 0 ? (
              <div className="py-12 text-center">
                <FileText className="mx-auto h-12 w-12 text-slate-300" />
                <h4 className="mt-2 text-sm font-bold text-slate-700">No documents uploaded yet</h4>
                <p className="mt-1 text-xs text-slate-400 max-w-sm mx-auto">
                  Select a document from the left panel to upload your Aadhaar card and Bank Passbook for school verification.
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {documents.map((doc) => {
                  const isVerified = doc.status === 'Verified';
                  const isRejected = doc.status === 'Rejected';
                  const theme = getDocCategoryTheme(doc.category, doc.name);

                  return (
                    <div
                      key={doc.id}
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
                            {getDocCategoryIcon(doc.category, doc.name)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-bold text-sm text-slate-900 leading-snug truncate">
                                {doc.name}
                              </h4>
                              {doc.category && doc.category.toLowerCase().trim() !== doc.name.toLowerCase().trim() && (
                                <span className="rounded-md bg-slate-100 text-slate-600 px-1.5 py-0.5 text-[10px] font-semibold">
                                  {doc.category}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5 font-normal">
                              <span className="text-slate-600 font-medium truncate max-w-[180px] sm:max-w-[240px]">
                                {doc.fileName || 'Uploaded file'}
                              </span>
                              <span>•</span>
                              <span className="uppercase font-semibold text-[10px] text-slate-400">{doc.fileType}</span>
                              {doc.uploadedAt && (
                                <>
                                  <span>•</span>
                                  <span>{new Date(doc.uploadedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
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
                              <><Clock className="h-3 w-3 text-amber-600" /> Pending</>
                            )}
                          </span>

                          {/* Action Buttons Toolbar */}
                          <div className="flex items-center gap-1 border-l border-slate-200 pl-2">
                            <button
                              type="button"
                              onClick={() => void handlePreview(doc, documents)}
                              disabled={isPreviewLoadingId === doc.id}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 text-xs font-bold transition-all shadow-2xs disabled:opacity-50"
                              title="Preview document"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              {isPreviewLoadingId === doc.id ? 'Loading...' : 'View'}
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleDownload(doc)}
                              disabled={isDownloadingId === doc.id}
                              className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-2xs"
                              title="Download file"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>

                            {!isVerified && (
                              <button
                                type="button"
                                onClick={() => handleDelete(doc)}
                                disabled={isDeleting}
                                className="rounded-lg border border-transparent p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                title="Remove and re-upload"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Admin Remarks or Status Note */}
                      {isRejected && doc.remarks && (
                        <div className="mt-2.5 rounded-xl bg-rose-50 border border-rose-200/80 px-3 py-2 text-xs text-rose-900 flex items-start gap-2">
                          <AlertCircle className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold text-rose-800">Admin Remarks: </span>
                            <span className="text-rose-700">{doc.remarks}</span>
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
      </div>

      {/* Fullscreen Document Preview Studio Modal */}
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
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                        previewDoc.doc.status === 'Verified'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : previewDoc.doc.status === 'Rejected'
                          ? 'bg-rose-950 text-rose-400 border border-rose-800'
                          : 'bg-amber-950 text-amber-400 border border-amber-800'
                      }`}
                    >
                      {previewDoc.doc.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 truncate mt-0.5">
                    {previewDoc.doc.fileName || 'document'}
                    {previewDoc.doc.uploadedAt && ` • Uploaded ${new Date(previewDoc.doc.uploadedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
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

              {/* Right: Controls & Actions */}
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
                  onClick={() => void handleDownload(previewDoc.doc)}
                  disabled={isDownloadingId === previewDoc.doc.id}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition-colors"
                  title="Download file to computer"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{isDownloadingId === previewDoc.doc.id ? 'Downloading...' : 'Download'}</span>
                </button>
                <a
                  href={previewDoc.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition-colors"
                  title="Open in new window"
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

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 border-t border-slate-800 bg-slate-900/95 px-5 py-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Verification Status:</span>
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
                  <span className="text-xs text-slate-400">({previewDoc.doc.remarks})</span>
                )}
              </div>
              <button
                type="button"
                onClick={closeDocPreview}
                className="rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
