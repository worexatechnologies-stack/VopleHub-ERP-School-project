import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import {
  GraduationCap,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Upload,
  User,
  Mail,
  Phone,
  Calendar,
  MapPin,
  ShieldCheck,
  Copy,
  Check,
  Eye,
  EyeOff,
  Printer,
  RefreshCw,
  ArrowRight,
  X,
  HeartPulse,
  CreditCard,
  Lock,
  FileText,
  FileCheck,
  Trash2,
} from 'lucide-react';
import {
  useVerifyEnrollmentLinkQuery,
  useSubmitEnrollmentApplicationMutation,
  SubmitEnrollmentResponse,
} from '../store/api/studentApi';
import { copyToClipboard } from '../utils/clipboard';

export default function StudentEnrollmentPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';

  // API query to verify token & start 24-hour window
  const { data: linkData, error: linkError, isLoading: isVerifyingLink, refetch } = useVerifyEnrollmentLinkQuery(
    token,
    { skip: !token }
  );

  const [submitApplication, { isLoading: isSubmitting }] = useSubmitEnrollmentApplicationMutation();

  // 24-hour countdown timer state (86,400 seconds default)
  const [remainingSeconds, setRemainingSeconds] = useState<number>(86400);
  const [isExpired, setIsExpired] = useState<boolean>(false);

  // Student form states
  const [name, setName] = useState('');
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedSection, setSelectedSection] = useState('A');
  const [dob, setDob] = useState('2015-05-15');
  const [gender, setGender] = useState('Male');
  const [bloodGroup, setBloodGroup] = useState('O+');
  const [parentName, setParentName] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [address, setAddress] = useState('');
  const [aadhaarNo, setAadhaarNo] = useState('');
  const [medicalConditions, setMedicalConditions] = useState('');

  // Photograph upload states
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string>('');

  // Document upload states
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentCategory, setDocumentCategory] = useState<string>('Birth Certificate');
  const [documentName, setDocumentName] = useState<string>('');
  const [documentSizeStr, setDocumentSizeStr] = useState<string>('');
  const [isDocDragActive, setIsDocDragActive] = useState(false);

  // UI state
  const [formError, setFormError] = useState<string | null>(null);
  const [submissionResult, setSubmissionResult] = useState<SubmitEnrollmentResponse | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedPass, setCopiedPass] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  // Initialize remaining seconds from verified backend data
  useEffect(() => {
    if (linkData) {
      if (linkData.remainingSeconds != null) {
        setRemainingSeconds(linkData.remainingSeconds);
        if (linkData.remainingSeconds <= 0) {
          setIsExpired(true);
        }
      }
      if (linkData.targetClass) {
        setSelectedClass(linkData.targetClass);
      } else if (linkData.availableClasses && linkData.availableClasses.length > 0) {
        setSelectedClass(linkData.availableClasses[0]);
      }
    }
  }, [linkData]);

  // Real-time ticking countdown timer (24 hours from open)
  useEffect(() => {
    if (!linkData || isExpired) return;

    const interval = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setIsExpired(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [linkData, isExpired]);

  // Format HH:MM:SS or MM:SS for countdown display
  const formattedTimeRemaining = useMemo(() => {
    const hours = Math.floor(remainingSeconds / 3600);
    const mins = Math.floor((remainingSeconds % 3600) / 60);
    const secs = remainingSeconds % 60;
    if (hours > 0) {
      return `${hours}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }, [remainingSeconds]);

  const timerPercentage = useMemo(() => {
    const total = (linkData?.durationMinutes || 1440) * 60;
    return Math.min(100, Math.max(0, (remainingSeconds / total) * 100));
  }, [remainingSeconds, linkData]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setFormError('Photo size must be less than 5MB.');
        return;
      }
      setPhotoFile(file);
      const reader = new FileReader();
      reader.onload = () => {
        setPhotoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      setFormError(null);
    }
  };

  const processDocumentFile = (file: File) => {
    if (file.size > 15 * 1024 * 1024) {
      setFormError('Document size must be less than 15MB.');
      return;
    }
    setDocumentFile(file);
    setDocumentName(file.name);
    setDocumentSizeStr(formatFileSize(file.size));
    setFormError(null);
  };

  const handleDocumentSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processDocumentFile(file);
    }
  };

  const handleDocDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDocDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processDocumentFile(e.dataTransfer.files[0]);
    }
  };

  const handleRemoveDocument = () => {
    setDocumentFile(null);
    setDocumentName('');
    setDocumentSizeStr('');
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (isExpired) {
      setFormError('This enrollment link has expired. The 24-hour submission window has passed.');
      return;
    }

    if (!name.trim()) {
      setFormError("Please enter the student's full name.");
      return;
    }
    if (!selectedClass) {
      setFormError('Please select a target class.');
      return;
    }
    if (!parentName.trim()) {
      setFormError("Please enter the parent or guardian's name.");
      return;
    }
    if (!parentPhone.trim() || parentPhone.replace(/\D/g, '').length < 10) {
      setFormError('Please enter a valid 10-digit mobile number for the parent.');
      return;
    }
    if (!parentEmail.trim() || !parentEmail.includes('@')) {
      setFormError('Please enter a valid parent email address.');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('token', token);
      formData.append('name', name.trim());
      formData.append('className', selectedClass);
      formData.append('section', selectedSection);
      formData.append('dob', dob);
      formData.append('gender', gender);
      formData.append('bloodGroup', bloodGroup);
      formData.append('parentName', parentName.trim());
      formData.append('parentPhone', parentPhone.trim());
      formData.append('parentEmail', parentEmail.trim());
      formData.append('address', address.trim());
      formData.append('aadhaarNo', aadhaarNo.trim());
      formData.append('medicalConditions', medicalConditions.trim());
      if (photoFile) {
        formData.append('photo', photoFile);
      }
      if (documentFile) {
        formData.append('document', documentFile);
        formData.append('documentCategory', documentCategory);
      }

      const res = await submitApplication(formData).unwrap();
      setSubmissionResult(res);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setFormError(
        err?.data?.detail || err?.message || 'Failed to submit admission details. Please try again.'
      );
    }
  };

  // If no token was provided in URL
  if (!token) {
    return (
      <div className="min-h-screen bg-[#f8fafc] text-slate-800 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-3xl p-8 text-center space-y-5 shadow-xl">
          <div className="w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-600 mx-auto flex items-center justify-center border border-indigo-100">
            <Lock className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900">Enrollment Link Token Required</h1>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              To complete student self-registration, please open the unique link shared with you by the School Administration.
            </p>
          </div>
          <div className="pt-2">
            <button
              onClick={() => navigate('/login')}
              className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition cursor-pointer shadow-sm"
            >
              Go to School Portal Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (isVerifyingLink) {
    return (
      <div className="min-h-screen bg-[#f8fafc] text-slate-800 flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <RefreshCw className="w-10 h-10 text-indigo-600 animate-spin mx-auto" />
          <p className="text-sm font-bold text-slate-700">Verifying Enrollment Link Security Token...</p>
        </div>
      </div>
    );
  }

  // Link verification error or link expired before opening
  if (linkError || !linkData) {
    const errorMsg =
      (linkError as any)?.data?.detail ||
      'Invalid, inactive, or expired enrollment link. Please contact school administration.';
    return (
      <div className="min-h-screen bg-[#f8fafc] text-slate-800 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white border border-rose-200 rounded-3xl p-8 text-center space-y-5 shadow-xl">
          <div className="w-16 h-16 rounded-2xl bg-rose-50 text-rose-600 mx-auto flex items-center justify-center border border-rose-100">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900">Enrollment Link Expired or Invalid</h1>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">{errorMsg}</p>
          </div>
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-left text-[11px] text-rose-700">
            <strong>Security Notice:</strong> Enrollment links expire automatically 24 hours after they are opened. If your session expired, please request a fresh link from your school administration.
          </div>
          <div className="pt-2 flex gap-3">
            <button
              onClick={() => refetch()}
              className="flex-1 py-2 px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer"
            >
              Retry
            </button>
            <button
              onClick={() => navigate('/login')}
              className="flex-1 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-xs font-bold text-white cursor-pointer shadow-sm"
            >
              Return Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  // SUCCESS SCREEN WITH PROVISIONAL CREDENTIALS (Website Theme)
  if (submissionResult) {
    const creds = submissionResult.credentials;
    return (
      <div className="min-h-screen bg-[#f8fafc] text-slate-800 flex flex-col justify-center items-center p-4 sm:p-6 py-12">
        <div className="w-full max-w-xl bg-white border border-slate-200/90 rounded-3xl shadow-xl overflow-hidden animate-fade-in">
          {/* Header */}
          <div className="bg-gradient-to-r from-emerald-50 via-teal-50/50 to-indigo-50/50 p-6 sm:p-8 text-center border-b border-emerald-100 space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center shadow-xs border border-emerald-200">
              <CheckCircle2 className="w-9 h-9" />
            </div>
            <div>
              <span className="inline-block px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200 mb-2">
                Application Submitted Successfully
              </span>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900">Welcome, {submissionResult.studentName}!</h1>
              <p className="text-xs text-slate-600 mt-1">
                Application Reference: <strong className="font-mono text-emerald-700">#{submissionResult.applicationNo}</strong> · Applied for <strong>{submissionResult.className}-{submissionResult.section}</strong> ({submissionResult.academicYear})
              </p>
            </div>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            {/* Admin Verification Notice Banner */}
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-start gap-3 text-xs text-amber-800">
              <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold text-amber-900 block">Pending School Admin Verification</span>
                <p className="text-[11px] text-amber-800/90 leading-relaxed">
                  Your admission details and supporting documents have been saved in the school registry. Once the School Admin approves your submission, your student directory profile and portal account will be activated.
                </p>
              </div>
            </div>

            {/* Generated Student Portal Credentials Box */}
            <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900">Student Portal Credentials</h3>
                    <p className="text-[10px] text-slate-500">Save these credentials to log in once your admission is approved</p>
                  </div>
                </div>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Provisional
                </span>
              </div>

              <div className="space-y-3 font-mono text-xs">
                {/* Username / Login ID */}
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 flex items-center justify-between shadow-xs">
                  <div>
                    <span className="text-[9px] uppercase font-bold text-slate-400 font-sans block">Student Login ID / Username</span>
                    <span className="text-sm font-bold text-indigo-700 select-all">{creds.loginId}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      copyToClipboard(creds.loginId);
                      setCopiedId(true);
                      setTimeout(() => setCopiedId(false), 2000);
                    }}
                    className="p-2 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 transition cursor-pointer"
                    title="Copy Login ID"
                  >
                    {copiedId ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>

                {/* Temporary Password */}
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 flex items-center justify-between shadow-xs">
                  <div>
                    <span className="text-[9px] uppercase font-bold text-slate-400 font-sans block">Temporary Password</span>
                    <span className="text-sm font-bold text-slate-900 select-all">
                      {showPassword ? creds.temporaryPassword : '••••••••••••••••'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="p-2 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-500 border border-slate-200 transition cursor-pointer"
                      title={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        copyToClipboard(creds.temporaryPassword);
                        setCopiedPass(true);
                        setTimeout(() => setCopiedPass(false), 2000);
                      }}
                      className="p-2 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 transition cursor-pointer"
                      title="Copy Password"
                    >
                      {copiedPass ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Copy All Button */}
              <button
                type="button"
                onClick={() => {
                  const slip = `--- STUDENT PORTAL CREDENTIALS ---\nStudent: ${submissionResult.studentName}\nClass: ${submissionResult.className}-${submissionResult.section}\nApplication No: ${submissionResult.applicationNo}\nLogin ID: ${creds.loginId}\nTemporary Password: ${creds.temporaryPassword}\nLogin Portal: ${window.location.origin}/login\n---------------------------------`;
                  copyToClipboard(slip);
                  setCopiedAll(true);
                  setTimeout(() => setCopiedAll(false), 2500);
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-white hover:bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-xs"
              >
                {copiedAll ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span>Credentials Copied to Clipboard!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Copy Complete Credentials Slip</span>
                  </>
                )}
              </button>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex-1 py-3 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-xs"
              >
                <Printer className="w-4 h-4 text-slate-500" />
                <span>Print Admission Slip</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="flex-1 py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Go to Student Portal Login</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // MAIN ADMISSION FORM VIEW WITH 24-HOUR TIMER (Website Theme)
  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Ambient background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] bg-indigo-500/5 rounded-full blur-[140px]" />
        <div className="absolute top-1/3 right-0 w-[400px] h-[400px] bg-sky-500/5 rounded-full blur-[160px]" />
        <div className="absolute bottom-0 left-1/3 w-80 h-80 bg-emerald-500/5 rounded-full blur-[120px]" />
      </div>

      {/* Top Header Navbar */}
      <header className="relative z-20 bg-white/95 backdrop-blur-md border-b border-slate-200/90 px-4 sm:px-8 py-3.5 sticky top-0 shadow-xs">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-sm shrink-0">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-base font-black text-slate-900">{linkData.schoolName || 'School Campus'}</h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Online Admission
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Academic Cycle: <strong className="text-slate-700 font-mono">{linkData.academicYear}</strong>
                {linkData.targetClass && (
                  <span> · Target Class: <strong className="text-indigo-600 font-bold">{linkData.targetClass}</strong></span>
                )}
              </p>
            </div>
          </div>

          {/* Sticky 24-Hour Timer Badge */}
          <div className="flex items-center gap-3 bg-white border border-slate-200 px-4 py-2 rounded-2xl shrink-0 shadow-xs">
            <div className={`p-1.5 rounded-xl ${
              isExpired
                ? 'bg-rose-50 text-rose-600'
                : remainingSeconds < 300
                ? 'bg-rose-50 text-rose-600 animate-pulse'
                : remainingSeconds < 3600
                ? 'bg-amber-50 text-amber-600'
                : 'bg-indigo-50 text-indigo-600'
            }`}>
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                  {isExpired ? 'Session Expired' : 'Time Remaining'}
                </span>
                <span className={`text-xs font-mono font-black ${
                  isExpired
                    ? 'text-rose-600'
                    : remainingSeconds < 300
                    ? 'text-rose-600'
                    : remainingSeconds < 600
                    ? 'text-amber-600'
                    : 'text-indigo-600'
                }`}>
                  {formattedTimeRemaining}
                </span>
              </div>
              {/* Progress bar */}
              <div className="w-32 bg-slate-100 h-1.5 rounded-full overflow-hidden mt-1">
                <div
                  className={`h-full transition-all duration-1000 ${
                    isExpired
                      ? 'bg-rose-500'
                      : remainingSeconds < 300
                      ? 'bg-rose-500'
                      : remainingSeconds < 600
                      ? 'bg-amber-500'
                      : 'bg-indigo-600'
                  }`}
                  style={{ width: `${timerPercentage}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Form Body */}
      <main className="relative z-10 flex-1 max-w-4xl mx-auto w-full p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Session Expired Notice */}
        {isExpired && (
          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-3.5 text-xs text-rose-800 animate-shake shadow-xs">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <strong className="font-bold text-rose-900 text-sm block">Session Expired (24-Hour Window Ended)</strong>
              <p className="text-[11px] text-rose-800 leading-relaxed">
                By school administrative policy, enrollment links are valid for exactly 24 hours after opening. Your submission time has elapsed. Please contact the school office to request a new registration link.
              </p>
            </div>
          </div>
        )}

        {/* Hero Header Banner */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-indigo-900 p-6 sm:p-8 rounded-3xl text-white shadow-md border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="relative z-10 space-y-1.5">
            <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
              Official Admission Registry
            </span>
            <h2 className="text-xl sm:text-2xl font-black text-white">Student Self-Enrollment Form</h2>
            <p className="text-xs text-slate-300 max-w-xl leading-relaxed">
              Fill out the student and parent details accurately and attach required documents. After submission, your provisional Student Portal credentials will be generated immediately for your records, pending administrative verification.
            </p>
          </div>
          <div className="relative z-10 flex flex-col sm:flex-row md:flex-col gap-2 shrink-0">
            <div className="flex items-center gap-2 text-xs font-mono bg-white/10 backdrop-blur-xs px-3.5 py-2 rounded-xl border border-white/15 text-slate-200">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>24-Hour Protected Session</span>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono bg-white/10 backdrop-blur-xs px-3.5 py-2 rounded-xl border border-white/15 text-slate-200">
              <CheckCircle2 className="w-4 h-4 text-indigo-400" />
              <span>Instant Provisional ID</span>
            </div>
          </div>
        </div>

        {formError && (
          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center justify-between shadow-xs">
            <span>{formError}</span>
            <button type="button" onClick={() => setFormError(null)} className="cursor-pointer text-rose-600 hover:text-rose-800">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Admission Form */}
        <form onSubmit={handleFormSubmit} className="space-y-6">
          {/* Section 1: Student Personal Details */}
          <section className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xs">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
              <div className="p-2.5 rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100">
                <User className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Student Personal Details</h3>
                <p className="text-xs text-slate-500">Basic identification, class and academic selection</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {/* Full Name */}
              <div className="sm:col-span-2 space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
                  Student Full Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  disabled={isExpired}
                  placeholder="e.g. Rahul Sharma"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full text-xs sm:text-sm rounded-xl bg-slate-50/70 border border-slate-200 px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition font-medium disabled:opacity-50"
                />
              </div>

              {/* Target Class */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
                  Class <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  disabled={isExpired || Boolean(linkData.targetClass)}
                  value={selectedClass}
                  onChange={(e) => setSelectedClass(e.target.value)}
                  className="w-full text-xs sm:text-sm rounded-xl bg-slate-50/70 border border-slate-200 px-4 py-2.5 text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition font-bold disabled:opacity-75 cursor-pointer"
                >
                  {linkData.availableClasses?.map((cls) => (
                    <option key={cls} value={cls}>
                      {cls}
                    </option>
                  ))}
                  {!linkData.availableClasses?.includes(selectedClass) && selectedClass && (
                    <option value={selectedClass}>{selectedClass}</option>
                  )}
                </select>
              </div>

              {/* Section */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
                  Section <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  disabled={isExpired}
                  value={selectedSection}
                  onChange={(e) => setSelectedSection(e.target.value)}
                  className="w-full text-xs sm:text-sm rounded-xl bg-slate-50/70 border border-slate-200 px-4 py-2.5 text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition font-bold disabled:opacity-50 cursor-pointer"
                >
                  {(linkData.availableSections || ['A', 'B', 'C', 'D']).map((sec) => (
                    <option key={sec} value={sec}>
                      Section {sec}
                    </option>
                  ))}
                </select>
              </div>

              {/* Date of Birth */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
                  Date of Birth <span className="text-rose-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  disabled={isExpired}
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  className="w-full text-xs sm:text-sm rounded-xl bg-slate-50/70 border border-slate-200 px-4 py-2.5 text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition font-mono disabled:opacity-50"
                />
              </div>

              {/* Gender */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
                  Gender <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  disabled={isExpired}
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="w-full text-xs sm:text-sm rounded-xl bg-slate-50/70 border border-slate-200 px-4 py-2.5 text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition font-medium disabled:opacity-50 cursor-pointer"
                >
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              {/* Blood Group */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
                  Blood Group
                </label>
                <select
                  disabled={isExpired}
                  value={bloodGroup}
                  onChange={(e) => setBloodGroup(e.target.value)}
                  className="w-full text-xs sm:text-sm rounded-xl bg-slate-50/70 border border-slate-200 px-4 py-2.5 text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition font-bold disabled:opacity-50 cursor-pointer"
                >
                  {['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'].map((bg) => (
                    <option key={bg} value={bg}>
                      {bg}
                    </option>
                  ))}
                </select>
              </div>

              {/* Aadhaar Number */}
              <div className="sm:col-span-2 space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
                  Aadhaar / National Identity Number (Optional)
                </label>
                <input
                  type="text"
                  disabled={isExpired}
                  placeholder="12-digit Aadhaar / National ID"
                  value={aadhaarNo}
                  onChange={(e) => setAadhaarNo(e.target.value)}
                  className="w-full text-xs sm:text-sm rounded-xl bg-slate-50/70 border border-slate-200 px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition font-mono disabled:opacity-50"
                />
              </div>
            </div>
          </section>

          {/* Section 2: Parent / Guardian Details */}
          <section className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xs">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
              <div className="p-2.5 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100">
                <Phone className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Parent / Guardian Contact</h3>
                <p className="text-xs text-slate-500">Essential for communications, emergency contacts and portal registration</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {/* Parent Name */}
              <div className="sm:col-span-2 space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
                  Parent / Guardian Full Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  disabled={isExpired}
                  placeholder="e.g. Ramesh Sharma"
                  value={parentName}
                  onChange={(e) => setParentName(e.target.value)}
                  className="w-full text-xs sm:text-sm rounded-xl bg-slate-50/70 border border-slate-200 px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition font-medium disabled:opacity-50"
                />
              </div>

              {/* Mobile Phone */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
                  Parent Mobile Number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="tel"
                  required
                  disabled={isExpired}
                  placeholder="e.g. 9876543210"
                  value={parentPhone}
                  onChange={(e) => setParentPhone(e.target.value)}
                  className="w-full text-xs sm:text-sm rounded-xl bg-slate-50/70 border border-slate-200 px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition font-mono disabled:opacity-50"
                />
              </div>

              {/* Email Address */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
                  Parent Email Address <span className="text-rose-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  disabled={isExpired}
                  placeholder="e.g. ramesh@example.com"
                  value={parentEmail}
                  onChange={(e) => setParentEmail(e.target.value)}
                  className="w-full text-xs sm:text-sm rounded-xl bg-slate-50/70 border border-slate-200 px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition font-medium disabled:opacity-50"
                />
              </div>

              {/* Address */}
              <div className="sm:col-span-2 space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
                  Residential Address
                </label>
                <textarea
                  rows={2}
                  disabled={isExpired}
                  placeholder="Flat / House No., Street, Landmark, City, Pincode"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full text-xs sm:text-sm rounded-xl bg-slate-50/70 border border-slate-200 px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition font-medium disabled:opacity-50"
                />
              </div>
            </div>
          </section>

          {/* Section 3: Supporting Document Upload */}
          <section className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xs">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
              <div className="p-2.5 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900">Upload Supporting Document</h3>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Recommended
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  Attach Birth Certificate, Transfer Certificate (TC), Aadhaar ID, or Previous Marksheet
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {/* Document Category Dropdown */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                <div className="space-y-1.5 sm:col-span-1">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
                    Document Type
                  </label>
                  <select
                    value={documentCategory}
                    onChange={(e) => setDocumentCategory(e.target.value)}
                    disabled={isExpired}
                    className="w-full text-xs sm:text-sm rounded-xl bg-slate-50/70 border border-slate-200 px-3.5 py-2.5 text-slate-900 font-bold focus:bg-white focus:outline-none focus:border-indigo-500 transition cursor-pointer"
                  >
                    <option value="Birth Certificate">Birth Certificate</option>
                    <option value="Aadhaar / National ID Card">Aadhaar / National ID Card</option>
                    <option value="Transfer Certificate (TC)">Transfer Certificate (TC)</option>
                    <option value="Previous School Marksheet">Previous School Marksheet</option>
                    <option value="Address Proof">Address Proof</option>
                    <option value="Other Document">Other Document</option>
                  </select>
                </div>

                <div className="sm:col-span-2 text-xs text-slate-500">
                  <p>
                    Uploading an authentic document now allows school staff to verify and approve the application quickly without manual document collection follow-up.
                  </p>
                </div>
              </div>

              {/* Document Drag & Drop Dropzone */}
              {!documentFile ? (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDocDragActive(true);
                  }}
                  onDragLeave={() => setIsDocDragActive(false)}
                  onDrop={handleDocDrop}
                  className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all flex flex-col items-center justify-center gap-3 ${
                    isDocDragActive
                      ? 'border-indigo-500 bg-indigo-50/50'
                      : 'border-slate-300 hover:border-indigo-400 bg-slate-50/50 hover:bg-white'
                  }`}
                >
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100">
                    <Upload className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs sm:text-sm font-bold text-slate-800">
                      Drag &amp; drop document here, or{' '}
                      <label className="text-indigo-600 hover:text-indigo-700 underline cursor-pointer">
                        browse files
                        <input
                          type="file"
                          accept=".pdf,.png,.jpg,.jpeg"
                          disabled={isExpired}
                          onChange={handleDocumentSelect}
                          className="hidden"
                        />
                      </label>
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Supports PDF, PNG, JPG files up to 15MB
                    </p>
                  </div>
                </div>
              ) : (
                /* Document Uploaded Card Preview */
                <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50/40 flex items-center justify-between gap-4 shadow-xs">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-200">
                      <FileCheck className="w-6 h-6" />
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900 truncate block">
                          {documentName}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0">
                          Ready
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        {documentCategory} • <span className="font-mono">{documentSizeStr}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <label className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 transition cursor-pointer shadow-xs">
                      <span>Change</span>
                      <input
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg"
                        disabled={isExpired}
                        onChange={handleDocumentSelect}
                        className="hidden"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleRemoveDocument}
                      className="p-1.5 rounded-xl border border-rose-200 bg-white hover:bg-rose-50 text-rose-600 transition cursor-pointer"
                      title="Remove document"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Section 4: Photo & Healthcare Notes */}
          <section className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xs">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
              <div className="p-2.5 rounded-2xl bg-teal-50 text-teal-600 border border-teal-100">
                <HeartPulse className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Photograph &amp; Medical Notes</h3>
                <p className="text-xs text-slate-500">Student passport photograph &amp; known medical history</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Photo Upload */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
                  Student Passport Photograph
                </label>
                <div className="flex items-center gap-4">
                  <div className="w-20 h-24 rounded-2xl bg-slate-50 border-2 border-dashed border-slate-200 overflow-hidden flex items-center justify-center shrink-0 shadow-xs">
                    {photoPreview ? (
                      <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-8 h-8 text-slate-300" />
                    )}
                  </div>
                  <div className="space-y-1.5 flex-1">
                    <label className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700 border border-slate-200 transition ${isExpired ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                      <Upload className="w-3.5 h-3.5" />
                      <span>{photoFile ? 'Change Photo' : 'Upload Photo'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        disabled={isExpired}
                        onChange={handlePhotoSelect}
                        className="hidden"
                      />
                    </label>
                    <p className="text-[11px] text-slate-400">JPG, PNG up to 5MB</p>
                    {photoFile && (
                      <p className="text-[11px] text-emerald-600 font-bold truncate">Selected: {photoFile.name}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Medical Information */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
                  Medical Notes / Allergies (Optional)
                </label>
                <textarea
                  rows={3}
                  disabled={isExpired}
                  placeholder="e.g. Asthma, Peanuts allergy, None..."
                  value={medicalConditions}
                  onChange={(e) => setMedicalConditions(e.target.value)}
                  className="w-full text-xs sm:text-sm rounded-xl bg-slate-50/70 border border-slate-200 px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition font-medium disabled:opacity-50"
                />
              </div>
            </div>
          </section>

          {/* Submission Action Card */}
          <div className="p-6 sm:p-8 rounded-3xl bg-white border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-5">
            <div className="text-xs text-slate-500 text-center sm:text-left space-y-0.5">
              <span className="font-bold text-slate-900 block">24-Hour Window Policy:</span>
              <span className="text-[11px]">
                Upon submission, student portal credentials will be generated and shown for your immediate records.
              </span>
            </div>

            <button
              type="submit"
              disabled={isExpired || isSubmitting}
              className={`w-full sm:w-auto px-8 py-3.5 rounded-2xl text-xs sm:text-sm font-black text-white transition flex items-center justify-center gap-2 shadow-md ${
                isExpired
                  ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-700 active:scale-98 cursor-pointer shadow-indigo-500/25'
              }`}
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Submitting &amp; Generating Credentials...</span>
                </>
              ) : isExpired ? (
                <>
                  <Clock className="w-4 h-4" />
                  <span>24-Hour Session Expired</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Submit Admission &amp; Get Credentials</span>
                </>
              )}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
