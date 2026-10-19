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
  GraduationCap
} from 'lucide-react';
import { emitNotification } from '../services/notificationBus';
import { apiDownload } from '../services/api';
import {
  useGetStudentsQuery,
  useGetStudentDocumentsQuery,
  useUploadStudentDocumentMutation,
  useDeleteStudentDocumentMutation,
} from '../store/api/studentApi';
import type { Student, StudentDocument } from '../types';

interface StudentDocumentsProps {
  user?: any;
  schoolName?: string;
  students?: Student[];
}

const DOCUMENT_PRESETS = [
  {
    category: 'Aadhaar Card',
    name: 'Aadhaar Card (Front & Back)',
    description: 'Government issued 12-digit Aadhaar card proof for identity and student record verification.',
    mandatory: true,
    icon: ShieldCheck,
  },
  {
    category: 'Other Document',
    name: 'Other Supporting Document',
    description: 'Address proof, medical certificate, or any other school verification document.',
    mandatory: false,
    icon: FileText,
  },
];

export default function StudentDocuments({ user, schoolName = 'School Management Portal', students: passedStudents }: StudentDocumentsProps) {
  const isServerBacked = Boolean(localStorage.getItem('school_erp_api_token'));
  const { data: serverStudents = [], refetch: refetchStudents } = useGetStudentsQuery(undefined, { skip: !isServerBacked });

  // Resolve current logged-in student
  const currentStudent = useMemo(() => {
    const list = isServerBacked && serverStudents.length > 0
      ? serverStudents
      : (passedStudents && passedStudents.length > 0
        ? passedStudents
        : []);

    if (list.length > 0) {
      if (user?.studentId) {
        const byId = list.find((s) => String(s.id) === String(user.studentId));
        if (byId) return byId;
      }
      if (user?.email) {
        const byEmail = list.find((s) => s.parentEmail?.toLowerCase() === user.email?.toLowerCase());
        if (byEmail) return byEmail;
      }
      return list[0];
    }

    try {
      const raw = localStorage.getItem('erp_students');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (user?.studentId) {
          const byId = parsed.find((s: any) => String(s.id) === String(user.studentId));
          if (byId) return byId;
        }
        if (user?.email) {
          const byEmail = parsed.find((s: any) => s.parentEmail?.toLowerCase() === user.email?.toLowerCase());
          if (byEmail) return byEmail;
        }
        return parsed[0] || null;
      }
    } catch {
      return null;
    }
    return null;
  }, [serverStudents, passedStudents, user, isServerBacked]);

  const studentId = currentStudent ? String(currentStudent.id) : '';
  const { data: serverDocuments = [], refetch: refetchDocs } = useGetStudentDocumentsQuery(studentId, {
    skip: !isServerBacked || !studentId,
  });

  const [uploadMutation, { isLoading: isUploading }] = useUploadStudentDocumentMutation();
  const [deleteMutation, { isLoading: isDeleting }] = useDeleteStudentDocumentMutation();

  // Local state for uploading
  const [selectedCategory, setSelectedCategory] = useState<string>('Aadhaar Card');
  const [customDocName, setCustomDocName] = useState<string>('Aadhaar Card (Front & Back)');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string>('');
  const [uploadSuccess, setUploadSuccess] = useState<string>('');
  const [isDownloadingId, setIsDownloadingId] = useState<number | null>(null);
  const [isPreviewLoadingId, setIsPreviewLoadingId] = useState<number | null>(null);

  interface PreviewDocState {
    doc: StudentDocument;
    url: string;
    isPdf: boolean;
    index: number;
    total: number;
    scale: number;
    rotation: number;
  }
  const [previewDoc, setPreviewDoc] = useState<PreviewDocState | null>(null);

  // Documents list
  const documents: StudentDocument[] = useMemo(() => {
    if (isServerBacked && serverDocuments.length > 0) {
      return serverDocuments;
    }
    if (currentStudent?.documents && currentStudent.documents.length > 0) {
      return currentStudent.documents;
    }
    return [];
  }, [isServerBacked, serverDocuments, currentStudent]);

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
      setUploadError('Please choose a document file (PDF, JPEG, or PNG) to upload.');
      return;
    }
    if (selectedFile.size > 5 * 1024 * 1024) {
      setUploadError('File size exceeds the 5 MB limit.');
      return;
    }
    if (!currentStudent) {
      setUploadError('Student profile could not be identified. Please contact the administrator.');
      return;
    }

    setUploadError('');
    setUploadSuccess('');

    if (isServerBacked) {
      try {
        const formData = new FormData();
        const docName = customDocName || selectedCategory;
        formData.append('name', docName);
        formData.append('category', selectedCategory);
        formData.append('file', selectedFile);

        await uploadMutation({
          studentId: String(currentStudent.id),
          body: formData,
        }).unwrap();

        setUploadSuccess(`"${docName}" uploaded successfully! It is now pending administrative verification.`);
        emitNotification({
          title: 'Document Uploaded',
          message: `"${docName}" was uploaded for ${currentStudent.name}.`,
          tone: 'success',
          source: 'documents',
        });
        setSelectedFile(null);
        refetchDocs();
        refetchStudents();
      } catch (err: any) {
        setUploadError(err?.data?.detail || err?.message || 'Failed to upload document to server.');
      }
    } else {
      // LocalStorage fallback for offline demo
      try {
        const raw = localStorage.getItem('erp_students');
        const studentsList = raw ? JSON.parse(raw) : [];
        const newDoc: StudentDocument = {
          id: Date.now(),
          name: customDocName || selectedCategory,
          category: selectedCategory,
          status: 'Pending',
          remarks: '',
          fileType: selectedFile.name.toLowerCase().endsWith('.pdf') ? 'PDF' : 'JPG',
          fileName: selectedFile.name,
          uploadedAt: new Date().toISOString(),
        };

        const updated = studentsList.map((s: any) => {
          if (String(s.id) === String(currentStudent.id)) {
            const existing = s.documents || [];
            return {
              ...s,
              documents: [newDoc, ...existing],
            };
          }
          return s;
        });

        localStorage.setItem('erp_students', JSON.stringify(updated));
        setUploadSuccess(`"${customDocName || selectedCategory}" uploaded. It is now pending administrative verification.`);
        setSelectedFile(null);
        window.location.reload();
      } catch {
        setUploadError('Failed to save document locally.');
      }
    }
  };

  // Delete handler
  const handleDelete = async (doc: StudentDocument) => {
    if (!confirm(`Are you sure you want to remove "${doc.name}"?`)) return;
    if (!currentStudent) return;

    if (isServerBacked) {
      try {
        await deleteMutation({
          studentId: String(currentStudent.id),
          docId: Number(doc.id),
        }).unwrap();
        emitNotification({
          title: 'Document Deleted',
          message: `"${doc.name}" was removed.`,
          tone: 'warning',
          source: 'documents',
        });
        refetchDocs();
      } catch (err: any) {
        alert(err?.data?.detail || 'Could not delete document.');
      }
    } else {
      try {
        const raw = localStorage.getItem('erp_students');
        if (raw) {
          const list = JSON.parse(raw);
          const updated = list.map((s: any) => {
            if (String(s.id) === String(currentStudent.id)) {
              return { ...s, documents: (s.documents || []).filter((d: any) => d.id !== doc.id) };
            }
            return s;
          });
          localStorage.setItem('erp_students', JSON.stringify(updated));
          window.location.reload();
        }
      } catch { }
    }
  };

  const getDocCategoryIcon = (category: string = '', name: string = '') => {
    const text = `${category || ''} ${name || ''}`.toLowerCase();
    if (text.includes('aadhaar') || text.includes('adhar') || text.includes('uid') || text.includes('identity')) {
      return <ShieldCheck className="h-5 w-5 text-indigo-600" />;
    }
    if (text.includes('birth') || text.includes('dob')) {
      return <FileCheck className="h-5 w-5 text-emerald-600" />;
    }
    if (text.includes('transfer') || text.includes('tc') || text.includes('school')) {
      return <GraduationCap className="h-5 w-5 text-blue-600" />;
    }
    return <FileText className="h-5 w-5 text-amber-600" />;
  };

  const getDocCategoryTheme = (category: string = '', name: string = '') => {
    const text = `${category || ''} ${name || ''}`.toLowerCase();
    if (text.includes('aadhaar') || text.includes('adhar') || text.includes('identity')) {
      return { bg: 'bg-indigo-50/80', border: 'border-indigo-100', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200/60' };
    }
    if (text.includes('birth')) {
      return { bg: 'bg-emerald-50/80', border: 'border-emerald-100', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200/60' };
    }
    if (text.includes('transfer') || text.includes('tc')) {
      return { bg: 'bg-blue-50/80', border: 'border-blue-100', badge: 'bg-blue-50 text-blue-700 border-blue-200/60' };
    }
    return { bg: 'bg-amber-50/80', border: 'border-amber-100', badge: 'bg-amber-50 text-amber-700 border-amber-200/60' };
  };

  // Preview handler
  const handlePreview = async (doc: StudentDocument, docList?: StudentDocument[]) => {
    if (!doc.downloadUrl) {
      alert('This document does not have a preview URL available.');
      return;
    }
    const list = docList || documents;
    const currentIndex = list.findIndex((d) => d.id === doc.id);
    setIsPreviewLoadingId(Number(doc.id));
    try {
      const previewUrl = doc.downloadUrl + (doc.downloadUrl.includes('?') ? '&view=1' : '?view=1');
      const { blob, filename, contentType } = await apiDownload(previewUrl);
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
  const handleDownload = async (doc: StudentDocument) => {
    if (!doc.downloadUrl && !isServerBacked) {
      alert(`Local preview for "${doc.name}" (${doc.fileName || 'file'}).`);
      return;
    }
    if (!doc.downloadUrl) return;

    setIsDownloadingId(Number(doc.id));
    try {
      const { blob, filename, contentType } = await apiDownload(doc.downloadUrl);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      let finalName = filename;
      if (!finalName || finalName === 'document' || !finalName.includes('.')) {
        if (doc.fileName && doc.fileName.includes('.')) {
          finalName = doc.fileName;
        } else {
          const ext = contentType.includes('pdf') ? 'pdf' : contentType.includes('png') ? 'png' : (contentType.includes('jpeg') || contentType.includes('jpg')) ? 'jpg' : (doc.fileType || 'pdf').toLowerCase();
          finalName = `${doc.fileName || doc.name || 'document'}.${ext}`;
        }
      }
      a.download = finalName;
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

  // Status Summary
  const statusSummary = useMemo(() => {
    if (!documents.length) {
      return {
        type: 'missing',
        badge: 'Aadhaar Card Pending',
        title: 'Submit Aadhaar Card for Verification',
        description: 'Please upload your 12-digit Aadhaar Card (Front & Back) to complete your student identity and official school record verification.',
        theme: 'amber',
      };
    }

    const hasRejected = documents.some((d) => d.status === 'Rejected');
    if (hasRejected) {
      return {
        type: 'rejected',
        badge: 'Action Required',
        title: 'Document Verification Requires Attention',
        description: 'One or more of your uploaded documents were rejected by the School Administration. Please check the feedback remarks below and re-upload.',
        theme: 'rose',
      };
    }

    const hasPending = documents.some((d) => d.status === 'Pending' || d.status === 'Uploaded');
    if (hasPending) {
      return {
        type: 'pending',
        badge: 'Verification Pending',
        title: 'Document Awaiting Admin Approval',
        description: 'Your document has been submitted and is currently waiting for verification by the School Administration. You will see the approval status here once confirmed.',
        theme: 'indigo',
      };
    }

    const hasVerified = documents.some((d) => d.status === 'Verified');
    if (hasVerified) {
      return {
        type: 'verified',
        badge: 'Aadhaar Verified',
        title: 'Official Records Verified',
        description: 'Your Aadhaar Card and student documents have been verified and approved by the School Administration.',
        theme: 'emerald',
      };
    }

    return {
      type: 'pending',
      badge: 'Under Review',
      title: 'Documents Submitted',
      description: 'Your documents are pending review by the school administration.',
      theme: 'indigo',
    };
  }, [documents]);

  const verifiedCount = documents.filter((d) => d.status === 'Verified').length;
  const pendingCount = documents.filter((d) => d.status === 'Pending' || d.status === 'Uploaded').length;
  const rejectedCount = documents.filter((d) => d.status === 'Rejected').length;

  return (
    <div className="space-y-6 animate-fade-in font-sans pb-12" id="student-documents-page">
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
                  Student Identity &amp; KYC
                </span>
                <span className="text-xs text-slate-300">·</span>
                <span className="text-xs font-semibold text-slate-500 font-mono">{schoolName}</span>
              </div>
              <h1 className="mt-1 text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                My Documents &amp; Aadhaar Verification
              </h1>
              <p className="mt-1 text-xs sm:text-sm text-slate-500 max-w-xl font-medium">
                Upload your official Aadhaar card (or supporting documents) and track approval from the School Administration in real-time.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0 self-start md:self-center">
            {currentStudent && (
              <div className="flex items-center gap-2.5 rounded-2xl border border-slate-200/90 bg-slate-50/80 px-3.5 py-2 shadow-2xs">
                <div className="grid h-8 w-8 place-items-center rounded-xl bg-indigo-600 text-xs font-bold text-white uppercase shadow-2xs">
                  {currentStudent.name?.slice(0, 2) || 'ST'}
                </div>
                <div>
                  <p className="text-xs font-black text-slate-800">{currentStudent.name}</p>
                  <p className="text-[10px] text-slate-400 font-mono">
                    Class {currentStudent.class || currentStudent.section ? `${currentStudent.class || ''}-${currentStudent.section || ''}` : 'Student'} · Roll #{currentStudent.rollNo || 'N/A'}
                  </p>
                </div>
              </div>
            )}
            <button
              onClick={() => {
                refetchDocs();
                refetchStudents();
              }}
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
                  {documents.length} document{documents.length !== 1 ? 's' : ''} submitted
                </span>
              </div>
              <h2 className="mt-1 text-lg font-black">{statusSummary.title}</h2>
              <p className="mt-0.5 text-xs text-slate-600 max-w-2xl leading-relaxed">
                {statusSummary.description}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Verification Progress
              </span>
              <span className="text-sm font-black text-slate-800">
                {verifiedCount} of {documents.length || 1} Approved
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Metric Counter Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Total Submitted</span>
            <FileText className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-2 text-2xl font-black text-slate-900">{documents.length}</p>
          <span className="text-[10px] text-slate-400">In student dossier</span>
        </div>

        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-700">Verified & Approved</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-2 text-2xl font-black text-emerald-900">{verifiedCount}</p>
          <span className="text-[10px] text-emerald-600/80">Confirmed by Admin</span>
        </div>

        <div className="rounded-2xl border border-amber-100 bg-amber-50/40 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-700">Awaiting Approval</span>
            <Clock className="h-4 w-4 text-amber-600" />
          </div>
          <p className="mt-2 text-2xl font-black text-amber-900">{pendingCount}</p>
          <span className="text-[10px] text-amber-600/80">Under admin review</span>
        </div>

        <div className="rounded-2xl border border-rose-100 bg-rose-50/40 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-rose-700">Needs Attention</span>
            <AlertCircle className="h-4 w-4 text-rose-600" />
          </div>
          <p className="mt-2 text-2xl font-black text-rose-900">{rejectedCount}</p>
          <span className="text-[10px] text-rose-600/80">Action required</span>
        </div>
      </div>

      {/* Main Grid: Upload Document Form (Left) & Document History / Status (Right) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Apply / Upload Document */}
        <div className="space-y-6 lg:col-span-5">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs">
            <div className="flex items-center gap-2">
              <div className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-50 text-indigo-600">
                <UploadCloud className="h-4 w-4" />
              </div>
              <h3 className="text-base font-black text-slate-900">
                Apply / Upload Document
              </h3>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Select your document type (Aadhaar Card is required) and submit a clear PDF or photo copy for admin confirmation.
            </p>

            {/* Quick Preset Selector */}
            <div className="mt-4 space-y-2">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                Select Document Preset
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {DOCUMENT_PRESETS.map((preset) => {
                  const isSelected = selectedCategory === preset.category;
                  const Icon = preset.icon;
                  return (
                    <button
                      key={preset.category}
                      type="button"
                      onClick={() => handleSelectPreset(preset)}
                      className={`flex items-start gap-2.5 rounded-2xl border p-3 text-left transition-all ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-50/60 ring-2 ring-indigo-600/20'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50'
                      }`}
                    >
                      <div
                        className={`grid h-7 w-7 shrink-0 place-items-center rounded-xl ${
                          isSelected
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-900 truncate">
                            {preset.category}
                          </span>
                          {preset.mandatory && (
                            <span className="shrink-0 rounded-full bg-indigo-100 px-1.5 py-0.2 text-[9px] font-extrabold text-indigo-700">
                              Primary
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">
                          {preset.name}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Upload Form */}
            <form onSubmit={handleUpload} className="mt-5 space-y-4">
              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block mb-1">
                  Document Title / Description
                </label>
                <input
                  type="text"
                  value={customDocName}
                  onChange={(e) => setCustomDocName(e.target.value)}
                  placeholder="e.g. Aadhaar Card (Front & Back)"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-medium text-slate-800 placeholder-slate-400 transition-colors focus:border-indigo-500 focus:bg-white focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block mb-1">
                  Attach Document File (PDF, JPEG, PNG · max 5 MB)
                </label>
                <div
                  className={`group relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 text-center transition-all ${
                    selectedFile
                      ? 'border-emerald-300 bg-emerald-50/30'
                      : 'border-slate-300 bg-slate-50/50 hover:border-indigo-400 hover:bg-indigo-50/20'
                  }`}
                >
                  <input
                    id="student-document-upload-input"
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        setSelectedFile(e.target.files[0]);
                        setUploadError('');
                      }
                    }}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-white text-indigo-600 shadow-xs group-hover:scale-105 transition-transform">
                    {selectedFile ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    ) : (
                      <UploadCloud className="h-5 w-5" />
                    )}
                  </div>
                  {selectedFile ? (
                    <div className="mt-2">
                      <p className="text-xs font-bold text-emerald-900 truncate max-w-xs">
                        {selectedFile.name}
                      </p>
                      <p className="text-[10px] text-emerald-700 font-mono">
                        {(selectedFile.size / 1024 / 1024).toFixed(2)} MB · Click to choose another file
                      </p>
                    </div>
                  ) : (
                    <div className="mt-2">
                      <p className="text-xs font-bold text-slate-700">
                        Choose document file or drag here
                      </p>
                      <p className="text-[10px] text-slate-400">
                        PDF, JPG, PNG up to 5 MB
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {uploadError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                  <span>{uploadError}</span>
                </div>
              )}

              {uploadSuccess && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{uploadSuccess}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isUploading || !selectedFile}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-xs font-extrabold text-white shadow-sm transition-all hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <UploadCloud className="h-4 w-4" />
                {isUploading ? 'Uploading Document to Database...' : 'Apply & Submit for Admin Approval'}
              </button>
            </form>

            <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-3.5 text-[11px] text-slate-500 leading-relaxed">
              <div className="flex items-center gap-1.5 font-bold text-slate-700 mb-1">
                <Info className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                Verification Guidelines
              </div>
              Ensure both sides of your Aadhaar card are clearly visible without glare or blur. The School Administration reviews submitted documents and approves them in your student profile.
            </div>
          </div>
        </div>

        {/* Right Column: Submitted Documents & Approval Tracking */}
        <div className="space-y-4 lg:col-span-7">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-black text-slate-900">
                  Applied Documents & Verification Status
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Live status of your submitted documents awaiting or confirmed by administration.
                </p>
              </div>
              <span className="rounded-xl bg-slate-100 px-3 py-1 text-xs font-mono font-bold text-slate-600">
                {documents.length} Record{documents.length !== 1 ? 's' : ''}
              </span>
            </div>

            {documents.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center my-4">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-600">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <h4 className="mt-3 text-sm font-bold text-slate-800">
                  No Documents Submitted Yet
                </h4>
                <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                  Submit your Aadhaar card using the form on the left to start the administrative verification process.
                </p>
                <button
                  onClick={() => {
                    const input = document.getElementById('student-document-upload-input');
                    if (input) input.click();
                  }}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-indigo-50 px-4 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition-colors"
                >
                  <UploadCloud className="h-3.5 w-3.5" />
                  Select Aadhaar File
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {documents.map((doc) => {
                  const theme = getDocCategoryTheme(doc.category, doc.name);
                  const isVerified = doc.status === 'Verified';
                  const isRejected = doc.status === 'Rejected';
                  const isPending = doc.status === 'Pending' || doc.status === 'Uploaded' || !doc.status;

                  return (
                    <div
                      key={doc.id}
                      className={`rounded-2xl border p-4.5 transition-all hover:shadow-xs ${
                        isVerified
                          ? 'border-emerald-100 bg-white'
                          : isRejected
                          ? 'border-rose-200 bg-rose-50/20'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        {/* Doc Details */}
                        <div className="flex items-start gap-3.5">
                          <div
                            className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${theme.bg} ${theme.border}`}
                          >
                            {getDocCategoryIcon(doc.category, doc.name)}
                          </div>
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="text-sm font-black text-slate-900">
                                {doc.name}
                              </h4>
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${theme.badge}`}
                              >
                                {doc.category || 'Identity Proof'}
                              </span>
                            </div>

                            <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-400 font-medium">
                              <span className="font-mono uppercase font-bold text-slate-500">
                                {doc.fileType || (doc.fileName?.endsWith('.pdf') ? 'PDF' : 'JPG')}
                              </span>
                              {doc.fileName && (
                                <span className="truncate max-w-[180px] font-mono text-slate-400">
                                  {doc.fileName}
                                </span>
                              )}
                              {doc.uploadedAt && (
                                <span>
                                  Applied {new Date(doc.uploadedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Status Badge & Actions */}
                        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
                          {isVerified ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-extrabold text-emerald-800">
                              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                              Verified & Approved
                            </span>
                          ) : isRejected ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10px] font-extrabold text-rose-800">
                              <AlertCircle className="h-3 w-3 text-rose-600" />
                              Needs Attention
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-extrabold text-amber-800">
                              <Clock className="h-3 w-3 text-amber-600" />
                              Awaiting Approval
                            </span>
                          )}

                          {/* View Preview Button */}
                          <button
                            type="button"
                            onClick={() => handlePreview(doc)}
                            disabled={isPreviewLoadingId === doc.id}
                            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
                            title="View Document"
                          >
                            <Eye className="h-3.5 w-3.5 text-indigo-600" />
                            {isPreviewLoadingId === doc.id ? 'Loading...' : 'View'}
                          </button>

                          {/* Download Button */}
                          <button
                            type="button"
                            onClick={() => handleDownload(doc)}
                            disabled={isDownloadingId === doc.id}
                            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
                            title="Download Document"
                          >
                            <Download className="h-3.5 w-3.5 text-slate-500" />
                            {isDownloadingId === doc.id ? '...' : 'Download'}
                          </button>

                          {/* Delete/Replace option if pending or rejected */}
                          {(isPending || isRejected) && (
                            <button
                              type="button"
                              onClick={() => handleDelete(doc)}
                              disabled={isDeleting}
                              className="rounded-xl border border-slate-200 p-1.5 text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                              title="Delete & Re-upload"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Admin Feedback Box if Rejected */}
                      {isRejected && (
                        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50/80 p-3 text-xs text-rose-900">
                          <div className="flex items-center gap-1.5 font-black text-rose-800 mb-0.5">
                            <AlertCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                            Administrator Feedback / Reason for Rejection:
                          </div>
                          <p className="font-medium text-rose-800/90 pl-5">
                            {doc.remarks || 'Document rejected by school administrator. Please ensure the document is clear, legible, and shows both sides.'}
                          </p>
                          <div className="mt-2 pl-5">
                            <button
                              onClick={() => {
                                handleSelectPreset({
                                  category: doc.category || 'Aadhaar Card',
                                  name: doc.name || 'Aadhaar Card',
                                  description: '',
                                  mandatory: false,
                                  icon: ShieldCheck,
                                });
                                const input = document.getElementById('student-document-upload-input');
                                if (input) input.click();
                              }}
                              className="inline-flex items-center gap-1 font-bold text-rose-700 hover:text-rose-900 underline text-[11px]"
                            >
                              Re-upload this document now &rarr;
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Verified details note */}
                      {isVerified && (
                        <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-emerald-700 font-semibold bg-emerald-50/50 rounded-lg px-2.5 py-1">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          <span>Official record verified & approved by School Administration</span>
                          {doc.verifiedAt && (
                            <span className="text-emerald-600/70 font-normal">
                              · on {new Date(doc.verifiedAt).toLocaleDateString()}
                            </span>
                          )}
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

      {/* Interactive Document Preview Modal */}
      {previewDoc && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-950/70 backdrop-blur-sm flex min-h-full items-center justify-center p-3 sm:p-5 animate-fade-in" role="presentation">
          <div className="relative my-auto flex h-[88vh] w-full max-w-5xl flex-col rounded-3xl bg-white shadow-2xl overflow-hidden border border-slate-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-600 text-white">
                  {previewDoc.isPdf ? <FileText className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-black text-slate-900">
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
                      {previewDoc.doc.status || 'Pending'}
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
                  onClick={zoomOut}
                  className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 transition-colors"
                  title="Zoom Out"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <button
                  onClick={resetZoom}
                  className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                  title="Reset Zoom"
                >
                  {Math.round(previewDoc.scale * 100)}%
                </button>
                <button
                  onClick={zoomIn}
                  className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 transition-colors"
                  title="Zoom In"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
                <button
                  onClick={rotateDoc}
                  className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 transition-colors"
                  title="Rotate 90°"
                >
                  <RotateCw className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDownload(previewDoc.doc)}
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
            <div className="flex-1 overflow-auto bg-slate-900/90 p-4 flex items-center justify-center">
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
            <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3 bg-slate-50 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                {previewDoc.total > 1 && (
                  <div className="flex items-center gap-1 mr-4">
                    <button
                      onClick={() => navigatePreview('prev')}
                      disabled={previewDoc.index <= 0}
                      className="rounded-lg border border-slate-200 p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="font-mono text-[11px] px-1">
                      {previewDoc.index + 1} of {previewDoc.total}
                    </span>
                    <button
                      onClick={() => navigatePreview('next')}
                      disabled={previewDoc.index >= previewDoc.total - 1}
                      className="rounded-lg border border-slate-200 p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                )}
                <span>Category: <strong className="text-slate-800">{previewDoc.doc.category || 'Identity'}</strong></span>
                {previewDoc.doc.verifiedAt && (
                  <span className="text-emerald-700">· Verified on {new Date(previewDoc.doc.verifiedAt).toLocaleDateString()}</span>
                )}
              </div>
              <button
                onClick={closeDocPreview}
                className="rounded-xl border border-slate-300 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
