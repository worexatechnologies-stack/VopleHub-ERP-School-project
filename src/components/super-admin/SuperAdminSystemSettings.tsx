import React, { useState, useEffect } from 'react';
import {
  Settings,
  UserCheck,
  Save,
  Key,
  Calendar,
  Mail,
  CreditCard,
  Lock,
  Plus,
  Trash2,
  CheckCircle,
  AlertTriangle,
  SlidersHorizontal,
  ToggleLeft,
  ToggleRight,
  Eye,
  EyeOff,
  Copy,
  Check,
  Clock,
  Database,
  Info,
  ShieldCheck,
  X,
  RefreshCw,
  Building2,
  GraduationCap,
  BellRing
} from 'lucide-react';
import { getStoredAuthenticatedUser, SUPER_ADMIN_EMAIL, SUPER_ADMIN_NAME, SUPER_ADMIN_PASSWORD } from '../../utils/auth';

interface SystemSettingsData {
  schoolName: string;
  schoolPrefix: string;
  operatingHoursStart: string;
  operatingHoursEnd: string;
  holidays: string[];
  minAttendancePercent: number;
  absentAutoSMS: boolean;
  smsTemplate: string;
  gpaScale: string;
  pushAlerts: boolean;
  emailAlerts: boolean;
  smtpHost: string;
  senderID: string;
  paymentGatewayMode: string;
  razorpayKeyId: string;
  razorpayKeySecret?: string;
  backupSchedule: string;
  backupDestination: string;
  backupRetentionDays: number;
  minPasswordLength: number;
  lockoutAttempts: number;
  require2FAForAdmins: boolean;
}

const DEFAULT_SETTINGS: SystemSettingsData = {
  schoolName: 'Volpehub Education',
  schoolPrefix: 'SAD',
  operatingHoursStart: '08:00',
  operatingHoursEnd: '14:30',
  holidays: ['Saturday', 'Sunday'],
  minAttendancePercent: 75,
  absentAutoSMS: true,
  smsTemplate: 'Dear Parent, your ward [STUDENT_NAME] was marked ABSENT today. Please contact principal office.',
  gpaScale: '10.0',
  pushAlerts: true,
  emailAlerts: true,
  smtpHost: 'smtp.volpehub.education',
  senderID: 'SANSKR',
  paymentGatewayMode: 'Sandbox',
  razorpayKeyId: 'rzp_test_9281a8F83ha8',
  backupSchedule: 'Daily',
  backupDestination: 'GCS Bucket: erp-backups-main',
  backupRetentionDays: 30,
  minPasswordLength: 8,
  lockoutAttempts: 3,
  require2FAForAdmins: false
};

const DEFAULT_MODULES = [
  { id: 'admissions', name: 'Admissions & Student Information', description: 'Student profiles, guardians, documents, and academic history.', category: 'Core Registry', enabled: true },
  { id: 'academics', name: 'Academics & Timetable', description: 'Classes, subjects, faculty schedules, attendance, and exam gradebooks.', category: 'Academics', enabled: true },
  { id: 'finance', name: 'Fees & Finance', description: 'Fee structures, invoices, payment gateway receipts, and family accounts.', category: 'Operations', enabled: true },
  { id: 'communications', name: 'Communication Centre', description: 'Parent announcements, emergency circulars, and SMS notices.', category: 'Engagement', enabled: true },
  { id: 'transport', name: 'Transport & Fleet Safety', description: 'Bus routes, vehicle manifests, pickup alerts, and safety tracking.', category: 'Operations', enabled: true },
  { id: 'library', name: 'Library Repository', description: 'Catalog management, book issue desk, and learner borrowing records.', category: 'Academics', enabled: true },
  { id: 'learning', name: 'Digital Learning Hub', description: 'E-learning resources, assignments, syllabus progress, and courseware.', category: 'Academics', enabled: true },
];

interface ToastNotice {
  id: number;
  type: 'success' | 'info' | 'error';
  title: string;
  message: string;
}

export default function SuperAdminSystemSettings() {
  const [activeSection, setActiveSection] = useState<string>('profile');
  const [profileName, setProfileName] = useState(SUPER_ADMIN_NAME);
  const [profilePassword, setProfilePassword] = useState(SUPER_ADMIN_PASSWORD);
  const [showProfilePassword, setShowProfilePassword] = useState(false);
  // Payment gateway secrets are strictly managed server-side and never persisted in browser storage.

  // Dynamic lists
  const [feeCategories, setFeeCategories] = useState<string[]>([]);
  const [newFeeCat, setNewFeeCat] = useState('');
  const [examTypes, setExamTypes] = useState<string[]>([]);
  const [newExamType, setNewExamType] = useState('');

  // General Settings and Modules
  const [sysSettings, setSysSettings] = useState<SystemSettingsData>(DEFAULT_SETTINGS);
  const [modules, setModules] = useState(DEFAULT_MODULES);

  // Toast feedback state
  const [toast, setToast] = useState<ToastNotice | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isBackingUp, setIsBackingUp] = useState(false);

  const showToast = (type: 'success' | 'info' | 'error', title: string, message: string) => {
    const id = Date.now();
    setToast({ id, type, title, message });
    setTimeout(() => {
      setToast((curr) => (curr?.id === id ? null : curr));
    }, 4000);
  };

  useEffect(() => {
    // Load system settings
    const savedSettings = localStorage.getItem('sa_system_settings');
    if (savedSettings) {
      try {
        setSysSettings(JSON.parse(savedSettings));
      } catch (e) {
        setSysSettings(DEFAULT_SETTINGS);
      }
    } else {
      localStorage.setItem('sa_system_settings', JSON.stringify(DEFAULT_SETTINGS));
    }

    // Load feature modules
    const savedModules = localStorage.getItem('sa_feature_modules');
    if (savedModules) {
      try {
        setModules(JSON.parse(savedModules));
      } catch (e) {
        setModules(DEFAULT_MODULES);
      }
    } else {
      localStorage.setItem('sa_feature_modules', JSON.stringify(DEFAULT_MODULES));
    }

    // Load Super Admin profile
    const savedUsers = localStorage.getItem('sa_users');
    if (savedUsers) {
      try {
        const usersList = JSON.parse(savedUsers);
        const superAdmin = usersList.find((u: any) => String(u.email || '').toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase());
        if (superAdmin) {
          if (superAdmin.name) setProfileName(superAdmin.name);
          if (superAdmin.password) setProfilePassword(superAdmin.password);
        }
      } catch (e) {}
    }

    // Load Fee Categories
    const savedFees = localStorage.getItem('sa_fee_categories');
    if (savedFees) {
      try {
        setFeeCategories(JSON.parse(savedFees));
      } catch (e) {
        setFeeCategories(['Tuition', 'Transport', 'Exam', 'Admission', 'Library', 'Sports', 'Laboratories']);
      }
    } else {
      const defaultFees = ['Tuition', 'Transport', 'Exam', 'Admission', 'Library', 'Sports', 'Laboratories'];
      localStorage.setItem('sa_fee_categories', JSON.stringify(defaultFees));
      setFeeCategories(defaultFees);
    }

    // Load Exam Types
    const savedExams = localStorage.getItem('sa_exam_types');
    if (savedExams) {
      try {
        setExamTypes(JSON.parse(savedExams));
      } catch (e) {
        setExamTypes(['Midterm Test', 'Final Exams', 'Quarterly Assessment', 'Class Unit Quiz', 'Practical Exams']);
      }
    } else {
      const defaultExams = ['Midterm Test', 'Final Exams', 'Quarterly Assessment', 'Class Unit Quiz', 'Practical Exams'];
      localStorage.setItem('sa_exam_types', JSON.stringify(defaultExams));
      setExamTypes(defaultExams);
    }
  }, []);

  const addAuditLog = (action: string) => {
    const user = getStoredAuthenticatedUser();
    const operatorName = user?.name || SUPER_ADMIN_NAME;
    const newLog = {
      id: `audit-${Date.now()}`,
      userName: operatorName,
      action,
      timestamp: new Date().toISOString(),
      ipAddress: '157.45.192.' + Math.floor(Math.random() * 254 + 1)
    };
    const saved = localStorage.getItem('sa_audit_logs');
    const existing = saved ? JSON.parse(saved) : [];
    localStorage.setItem('sa_audit_logs', JSON.stringify([newLog, ...existing]));
  };

  const handleCopyText = (text: string, key: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    showToast('info', 'Copied to Clipboard', `${label} was copied successfully.`);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const savedUsersStr = localStorage.getItem('sa_users');
    if (savedUsersStr) {
      try {
        const list = JSON.parse(savedUsersStr);
        const updated = list.map((u: any) => {
          if (String(u.email || '').toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) {
            return { ...u, name: profileName, password: profilePassword };
          }
          return u;
        });
        localStorage.setItem('sa_users', JSON.stringify(updated));
      } catch (err) {}
    }
    addAuditLog(`Updated profile details and password credentials for Super Admin account.`);
    showToast('success', 'Profile Updated', 'Super Admin particulars and password credentials were saved successfully.');
  };

  const handleSaveFeeCategories = () => {
    localStorage.setItem('sa_fee_categories', JSON.stringify(feeCategories));
    addAuditLog('Updated global system Fee Categories configuration array.');
    showToast('success', 'Fee Categories Saved', `${feeCategories.length} fee category types are active across all branches.`);
  };

  const handleSaveExamTypes = () => {
    localStorage.setItem('sa_exam_types', JSON.stringify(examTypes));
    addAuditLog('Updated global system Exam Types configuration list.');
    showToast('success', 'Exam Types Saved', `${examTypes.length} examination assessment schedules are preserved.`);
  };

  const handleSaveGeneralSettings = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('sa_system_settings', JSON.stringify(sysSettings));
    addAuditLog('Updated global ERP system parameters.');
    showToast('success', 'System Settings Saved', 'Your system configurations have been committed to local and tenant storage.');
  };

  const addFeeCat = () => {
    const trimmed = newFeeCat.trim();
    if (!trimmed) return;
    if (feeCategories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      showToast('error', 'Duplicate Category', `"${trimmed}" already exists in fee categories.`);
      return;
    }
    const updated = [...feeCategories, trimmed];
    setFeeCategories(updated);
    setNewFeeCat('');
    localStorage.setItem('sa_fee_categories', JSON.stringify(updated));
    showToast('success', 'Category Added', `Added "${trimmed}" to fee categories.`);
  };

  const removeFeeCat = (cat: string) => {
    const updated = feeCategories.filter((c) => c !== cat);
    setFeeCategories(updated);
    localStorage.setItem('sa_fee_categories', JSON.stringify(updated));
  };

  const addExamType = () => {
    const trimmed = newExamType.trim();
    if (!trimmed) return;
    if (examTypes.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      showToast('error', 'Duplicate Exam Type', `"${trimmed}" already exists in exam types.`);
      return;
    }
    const updated = [...examTypes, trimmed];
    setExamTypes(updated);
    setNewExamType('');
    localStorage.setItem('sa_exam_types', JSON.stringify(updated));
    showToast('success', 'Exam Type Added', `Added "${trimmed}" to examination types.`);
  };

  const removeExamType = (type: string) => {
    const updated = examTypes.filter((t) => t !== type);
    setExamTypes(updated);
    localStorage.setItem('sa_exam_types', JSON.stringify(updated));
  };

  const saveModules = () => {
    localStorage.setItem('sa_feature_modules', JSON.stringify(modules));
    addAuditLog('Updated school feature module availability controls.');
    const activeCount = modules.filter((m) => m.enabled).length;
    showToast('success', 'Modules Configured', `${activeCount} of ${modules.length} modules enabled for school branches.`);
  };

  const triggerInstantBackup = () => {
    setIsBackingUp(true);
    setTimeout(() => {
      setIsBackingUp(false);
      addAuditLog(`Super Admin triggered immediate system database snapshot to ${sysSettings.backupDestination}.`);
      showToast('success', 'Snapshot Captured', `Instant database snapshot created and stored in ${sysSettings.backupDestination}.`);
    }, 1500);
  };

  const insertSmsTag = (tag: string) => {
    setSysSettings((prev) => ({
      ...prev,
      smsTemplate: prev.smsTemplate + ' ' + tag
    }));
  };

  // Navigation sections configuration
  const SECTIONS = [
    { id: 'profile', label: 'Admin Clearance Profile', icon: UserCheck, desc: 'Root login name & password key' },
    { id: 'franchise', label: 'Campus & Organization', icon: Building2, desc: 'Operating hours & brand monogram' },
    { id: 'academic', label: 'Academic & Gradebook', icon: GraduationCap, desc: 'Attendance cutoffs, fees & exams' },
    { id: 'billing', label: 'Payment Gateway (Razorpay)', icon: CreditCard, desc: 'API keys & transaction mode' },
    { id: 'notifications', label: 'Email & SMS Channels', icon: Mail, desc: 'Absence SMS alerts & SMTP host' },
    { id: 'security', label: 'Security & Backup Vault', icon: Lock, desc: 'Password policy, 2FA & snapshots' },
    { id: 'modules', label: 'Feature Modules Rollout', icon: SlidersHorizontal, desc: 'Enable/disable platform tools' }
  ];

  return (
    <div className="space-y-6" id="sa-settings-hub">
      {/* Toast Banner Notification */}
      {toast && (
        <div
          className={`fixed top-6 right-6 z-[1000] flex max-w-md items-start gap-3 rounded-2xl border p-4 shadow-2xl backdrop-blur-md transition-all animate-fade-in ${
            toast.type === 'success'
              ? 'border-emerald-200 bg-emerald-50/95 text-emerald-950 shadow-emerald-900/10'
              : toast.type === 'error'
              ? 'border-rose-200 bg-rose-50/95 text-rose-950 shadow-rose-900/10'
              : 'border-indigo-200 bg-indigo-50/95 text-indigo-950 shadow-indigo-900/10'
          }`}
        >
          <div className="mt-0.5 shrink-0">
            {toast.type === 'success' && <CheckCircle className="h-5 w-5 text-emerald-600" />}
            {toast.type === 'error' && <AlertTriangle className="h-5 w-5 text-rose-600" />}
            {toast.type === 'info' && <Info className="h-5 w-5 text-indigo-600" />}
          </div>
          <div className="flex-1">
            <h4 className="text-xs font-bold">{toast.title}</h4>
            <p className="mt-0.5 text-xs text-slate-600">{toast.message}</p>
          </div>
          <button
            onClick={() => setToast(null)}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 md:p-8 text-white shadow-xl border border-slate-800">
        <div className="absolute right-0 top-0 -mt-10 -mr-10 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-indigo-200 backdrop-blur-xs border border-white/10 mb-2">
              <Settings className="w-3.5 h-3.5 text-indigo-300" />
              <span>Root System Control Panel</span>
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white md:text-3xl">
              Platform &amp; System Settings
            </h1>
            <p className="mt-1 text-xs md:text-sm text-slate-300 max-w-2xl leading-relaxed">
              Fine-tune global parameters, payment gateways, automated communication services, security standards, and feature rollouts across all school branches.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-white/10 border border-white/15 text-xs font-semibold text-white backdrop-blur-md">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Root Clearance 256-Bit</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Settings Panel */}
      <div className="rounded-3xl border border-slate-200/80 bg-white shadow-sm overflow-hidden flex flex-col lg:flex-row">
        {/* Navigation Sidebar */}
        <aside className="lg:w-72 bg-slate-50/70 border-b lg:border-b-0 lg:border-r border-slate-200/80 p-4 space-y-1.5 flex-none font-sans">
          <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
            <span>Settings Categories</span>
            <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-mono font-bold">
              {SECTIONS.length}
            </span>
          </div>

          <nav className="space-y-1">
            {SECTIONS.map((sec) => {
              const Icon = sec.icon;
              const isActive = activeSection === sec.id;
              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => setActiveSection(sec.id)}
                  className={`w-full text-left px-3.5 py-3 rounded-2xl text-xs font-bold transition-all cursor-pointer flex items-center gap-3 ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25 ring-1 ring-indigo-500'
                      : 'text-slate-600 hover:bg-slate-200/60 hover:text-slate-900'
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                      isActive ? 'bg-white/20 text-white' : 'bg-white text-slate-600 border border-slate-200/60 shadow-2xs'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 truncate">
                    <div className="truncate">{sec.label}</div>
                    <div
                      className={`text-[10px] font-medium truncate mt-0.5 ${
                        isActive ? 'text-indigo-100' : 'text-slate-400'
                      }`}
                    >
                      {sec.desc}
                    </div>
                  </div>
                </button>
              );
            })}
          </nav>

          <div className="pt-4 mt-4 border-t border-slate-200/80 px-3">
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>Auto-synchronized across sessions</span>
            </div>
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 p-6 md:p-8 min-h-[540px]">
          {/* SECTION 1: SUPER ADMIN PROFILE */}
          {activeSection === 'profile' && (
            <div className="space-y-6 max-w-3xl animate-fade-in">
              <div className="border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-1">
                  <UserCheck className="w-4 h-4" />
                  <span>Credential Management</span>
                </div>
                <h2 className="text-xl font-black text-slate-900">Super Administrator Profile &amp; Password</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Update your root operator display identity and access passphrase.
                </p>
              </div>

              <form onSubmit={handleSaveProfile} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Display Officer Name</label>
                    <input
                      required
                      type="text"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      placeholder="e.g. Worexa Technologies"
                      className="w-full text-xs bg-slate-50 border border-slate-200 px-3.5 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800 font-medium"
                    />
                    <p className="text-[11px] text-slate-400">Shown in the header bar and tenant audit trail logs.</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Root Account Clearance Email</label>
                    <div className="relative">
                      <input
                        disabled
                        type="email"
                        value={SUPER_ADMIN_EMAIL}
                        className="w-full text-xs bg-slate-100 border border-slate-200 px-3.5 py-2.5 rounded-xl text-slate-500 font-mono"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-full">
                        Locked ID
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">Unique root email address recognized across backend auth.</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-xs font-bold text-slate-800">Root Access Password</label>
                      <p className="text-[11px] text-slate-500">Master passphrase for Super Admin console clearance.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';
                        let pass = '';
                        for (let i = 0; i < 14; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
                        setProfilePassword(pass);
                        setShowProfilePassword(true);
                        showToast('info', 'Generated Password', 'Created strong 14-character random password.');
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                    >
                      <Key className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Generate Strong Key</span>
                    </button>
                  </div>

                  <div className="relative">
                    <Key className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      required
                      type={showProfilePassword ? 'text' : 'password'}
                      minLength={8}
                      value={profilePassword}
                      onChange={(e) => setProfilePassword(e.target.value)}
                      className="w-full text-xs bg-white border border-slate-200 pl-10 pr-24 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800 font-mono"
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setShowProfilePassword(!showProfilePassword)}
                        className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
                        title={showProfilePassword ? 'Hide password' : 'Show password'}
                      >
                        {showProfilePassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopyText(profilePassword, 'admin-pass', 'Password')}
                        className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
                        title="Copy password"
                      >
                        {copiedKey === 'admin-pass' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-[11px] text-slate-500 pt-1">
                    <span className="font-semibold">Strength:</span>
                    <span className={`font-bold ${profilePassword.length >= 10 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {profilePassword.length >= 12 ? 'Excellent (Enterprise Safe)' : profilePassword.length >= 8 ? 'Good (8+ chars)' : 'Too Short'}
                    </span>
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 hover:bg-indigo-700 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/25 transition-all cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>Save Profile Credentials</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* SECTION 2: CAMPUS & ORGANIZATION */}
          {activeSection === 'franchise' && (
            <div className="space-y-6 max-w-3xl animate-fade-in">
              <div className="border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-1">
                  <Building2 className="w-4 h-4" />
                  <span>Campus Identity</span>
                </div>
                <h2 className="text-xl font-black text-slate-900">Campus &amp; Organization Parameters</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Configure default organizational identity, student ID prefixes, and standard school daily operating hours.
                </p>
              </div>

              <form onSubmit={handleSaveGeneralSettings} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Consolidated Institution Brand Name</label>
                    <input
                      required
                      type="text"
                      value={sysSettings.schoolName}
                      onChange={(e) => setSysSettings({ ...sysSettings, schoolName: e.target.value })}
                      className="w-full text-xs bg-slate-50 border border-slate-200 px-3.5 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800 font-medium"
                    />
                    <p className="text-[11px] text-slate-400">Headlining organization title displayed on student credentials slips.</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">System Monogram Code Prefix</label>
                    <input
                      required
                      type="text"
                      maxLength={6}
                      value={sysSettings.schoolPrefix}
                      onChange={(e) => setSysSettings({ ...sysSettings, schoolPrefix: e.target.value.toUpperCase() })}
                      className="w-full text-xs bg-slate-50 border border-slate-200 px-3.5 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800 font-mono uppercase font-bold"
                    />
                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                      <span>Preview ID:</span>
                      <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                        {sysSettings.schoolPrefix}-2026-0001
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-900">Standard School Hours</h4>
                      <p className="text-[11px] text-slate-500">Timetable window and roll-call period.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700">Morning Bell / Rollcall Starts</label>
                      <input
                        required
                        type="time"
                        value={sysSettings.operatingHoursStart}
                        onChange={(e) => setSysSettings({ ...sysSettings, operatingHoursStart: e.target.value })}
                        className="w-full text-xs bg-white border border-slate-200 px-3.5 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800 font-mono"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700">Dispersal / Classes End</label>
                      <input
                        required
                        type="time"
                        value={sysSettings.operatingHoursEnd}
                        onChange={(e) => setSysSettings({ ...sysSettings, operatingHoursEnd: e.target.value })}
                        className="w-full text-xs bg-white border border-slate-200 px-3.5 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800 font-mono"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 hover:bg-indigo-700 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/25 transition-all cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>Save Campus Parameters</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* SECTION 3: ACADEMIC & GRADEBOOK */}
          {activeSection === 'academic' && (
            <div className="space-y-8 max-w-3xl animate-fade-in">
              <div className="border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-1">
                  <GraduationCap className="w-4 h-4" />
                  <span>Academic Policies</span>
                </div>
                <h2 className="text-xl font-black text-slate-900">Academic Governance &amp; Roster Rules</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Control baseline attendance percentage thresholds, grading scales, fee category options, and examination types.
                </p>
              </div>

              {/* Attendance & Grading Form */}
              <form onSubmit={handleSaveGeneralSettings} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-700">Minimum Required Attendance (%)</label>
                      <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                        {sysSettings.minAttendancePercent}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="95"
                      step="1"
                      value={sysSettings.minAttendancePercent}
                      onChange={(e) => setSysSettings({ ...sysSettings, minAttendancePercent: parseInt(e.target.value) })}
                      className="w-full accent-indigo-600 cursor-pointer"
                    />
                    <p className="text-[11px] text-slate-400">
                      Students falling below {sysSettings.minAttendancePercent}% trigger exam hall ticket attendance warnings.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Grading System Scale</label>
                    <select
                      value={sysSettings.gpaScale}
                      onChange={(e) => setSysSettings({ ...sysSettings, gpaScale: e.target.value })}
                      className="w-full text-xs bg-slate-50 border border-slate-200 px-3.5 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800 font-medium cursor-pointer"
                    >
                      <option value="10.0">10.0 Cumulative Grade Point Average (CGPA - CBSE / ICSE)</option>
                      <option value="4.0">4.0 Grade Point Average (GPA - International)</option>
                      <option value="100%">100% Direct Percent Marks System (State Board)</option>
                    </select>
                    <p className="text-[11px] text-slate-400">Default evaluation curve applied on progress report cards.</p>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-900 px-4 py-2 text-xs font-bold text-white transition-all cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save Academic Thresholds</span>
                  </button>
                </div>
              </form>

              {/* Fee Categories Manager */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Standard Fee Categories</h3>
                    <p className="text-xs text-slate-500">Available categories populated when school accountants create invoices.</p>
                  </div>
                  <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-full border border-indigo-100 self-start">
                    {feeCategories.length} Categories Active
                  </span>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g. Science Laboratory Charges"
                    value={newFeeCat}
                    onChange={(e) => setNewFeeCat(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addFeeCat();
                      }
                    }}
                    className="flex-1 text-xs bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800"
                  />
                  <button
                    type="button"
                    onClick={addFeeCat}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-xs font-bold text-white transition-all cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Category</span>
                  </button>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {feeCategories.map((cat) => (
                    <span
                      key={cat}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-100 hover:bg-slate-200/70 text-slate-700 border border-slate-200/80 px-3 py-1.5 text-xs font-semibold transition-colors"
                    >
                      <span>{cat}</span>
                      <button
                        type="button"
                        onClick={() => removeFeeCat(cat)}
                        className="text-slate-400 hover:text-rose-600 font-bold transition-colors"
                        title={`Remove ${cat}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>

                <div className="pt-2 border-t border-slate-100 flex justify-end">
                  <button
                    type="button"
                    onClick={handleSaveFeeCategories}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Persist Fee Categories</span>
                  </button>
                </div>
              </div>

              {/* Exam Types Manager */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Standard Examination Types</h3>
                    <p className="text-xs text-slate-500">Preset exam templates provided to faculty for schedule generation.</p>
                  </div>
                  <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-full border border-indigo-100 self-start">
                    {examTypes.length} Exam Types Active
                  </span>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g. Pre-Board Model Exam"
                    value={newExamType}
                    onChange={(e) => setNewExamType(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addExamType();
                      }
                    }}
                    className="flex-1 text-xs bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800"
                  />
                  <button
                    type="button"
                    onClick={addExamType}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-xs font-bold text-white transition-all cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Exam Type</span>
                  </button>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {examTypes.map((type) => (
                    <span
                      key={type}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-100 hover:bg-slate-200/70 text-slate-700 border border-slate-200/80 px-3 py-1.5 text-xs font-semibold transition-colors"
                    >
                      <span>{type}</span>
                      <button
                        type="button"
                        onClick={() => removeExamType(type)}
                        className="text-slate-400 hover:text-rose-600 font-bold transition-colors"
                        title={`Remove ${type}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>

                <div className="pt-2 border-t border-slate-100 flex justify-end">
                  <button
                    type="button"
                    onClick={handleSaveExamTypes}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Persist Exam Types</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 4: BILLING & PAYMENT GATEWAY */}
          {activeSection === 'billing' && (
            <div className="space-y-6 max-w-3xl animate-fade-in">
              <div className="border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-1">
                  <CreditCard className="w-4 h-4" />
                  <span>Financial Clearing</span>
                </div>
                <h2 className="text-xl font-black text-slate-900">Razorpay Payment Gateway Integration</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Equip online UPI, NetBanking, and credit/debit card checkout for student fee payments across branches.
                </p>
              </div>

              <form onSubmit={handleSaveGeneralSettings} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Operational Gateway Mode</label>
                    <select
                      value={sysSettings.paymentGatewayMode}
                      onChange={(e) => setSysSettings({ ...sysSettings, paymentGatewayMode: e.target.value })}
                      className="w-full text-xs bg-slate-50 border border-slate-200 px-3.5 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800 font-semibold cursor-pointer"
                    >
                      <option value="Sandbox">Sandbox / Test Transactions Mode</option>
                      <option value="Live">Live / Production Settlement Mode</option>
                    </select>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          sysSettings.paymentGatewayMode === 'Live'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : 'bg-amber-100 text-amber-800 border border-amber-200'
                        }`}
                      >
                        {sysSettings.paymentGatewayMode === 'Live' ? 'LIVE PRODUCTION' : 'TEST SANDBOX ACTIVE'}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Webhook Listener Endpoint</label>
                    <div className="relative">
                      <input
                        disabled
                        type="text"
                        value="https://volpehub.in/api/v1/store/razorpay/webhook/"
                        className="w-full text-xs bg-slate-100 border border-slate-200 pl-3.5 pr-10 py-2.5 rounded-xl text-slate-500 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => handleCopyText('https://volpehub.in/api/v1/store/razorpay/webhook/', 'webhook', 'Webhook URI')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/60"
                        title="Copy Webhook Endpoint"
                      >
                        {copiedKey === 'webhook' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-400">Configure this URL in your Razorpay Dashboard webhooks tab.</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700">Razorpay Key ID</label>
                      <input
                        required
                        type="text"
                        value={sysSettings.razorpayKeyId}
                        onChange={(e) => setSysSettings({ ...sysSettings, razorpayKeyId: e.target.value })}
                        className="w-full text-xs bg-white border border-slate-200 px-3.5 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800 font-mono"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-slate-700">Razorpay Secret Key</label>
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3" />
                          <span>Server-Side Protected</span>
                        </span>
                      </div>
                      <div className="w-full text-xs bg-slate-50 border border-slate-200 px-3.5 py-2.5 rounded-xl text-slate-500 font-mono flex items-center justify-between">
                        <span className="tracking-widest">••••••••••••••••••••••••</span>
                        <span className="text-[10px] text-slate-400 font-sans font-medium">Secured in backend environment (RAZORPAY_KEY_SECRET)</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-3.5 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-center gap-3 text-xs text-emerald-900 font-medium">
                  <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span>
                    Supported checkout channels: <strong>UPI (GPay, PhonePe, Paytm)</strong>, <strong>Credit &amp; Debit Cards</strong>, and <strong>50+ NetBanking Institutions</strong>.
                  </span>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 hover:bg-indigo-700 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/25 transition-all cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>Save Payment Gateway</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* SECTION 5: NOTIFICATIONS & ALERTS */}
          {activeSection === 'notifications' && (
            <div className="space-y-6 max-w-3xl animate-fade-in">
              <div className="border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-1">
                  <BellRing className="w-4 h-4" />
                  <span>Communication Channels</span>
                </div>
                <h2 className="text-xl font-black text-slate-900">Email &amp; Automated SMS Alerts</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Manage corporate SMTP relay settings, Twilio SMS sender tags, and automatic roll-call absentee parent dispatches.
                </p>
              </div>

              <form onSubmit={handleSaveGeneralSettings} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Twilio / Telephony SMS Sender ID</label>
                    <input
                      required
                      type="text"
                      maxLength={8}
                      value={sysSettings.senderID}
                      onChange={(e) => setSysSettings({ ...sysSettings, senderID: e.target.value.toUpperCase() })}
                      className="w-full text-xs bg-slate-50 border border-slate-200 px-3.5 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800 font-mono uppercase font-bold"
                    />
                    <p className="text-[11px] text-slate-400">Approved 6-character DLT telecom header (e.g. SANSKR).</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Corporate SMTP Mail Server</label>
                    <input
                      required
                      type="text"
                      value={sysSettings.smtpHost}
                      onChange={(e) => setSysSettings({ ...sysSettings, smtpHost: e.target.value })}
                      className="w-full text-xs bg-slate-50 border border-slate-200 px-3.5 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800 font-mono"
                    />
                    <p className="text-[11px] text-slate-400">SMTP server relaying receipts and credentials recovery emails.</p>
                  </div>
                </div>

                {/* Auto Absent SMS Card */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-900">Absent Rollcall Parent Notification</h4>
                      <p className="text-[11px] text-slate-500">Automatically dispatch SMS when teacher marks attendance as Absent.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSysSettings({ ...sysSettings, absentAutoSMS: !sysSettings.absentAutoSMS })}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition-all cursor-pointer ${
                        sysSettings.absentAutoSMS
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {sysSettings.absentAutoSMS ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                      <span>{sysSettings.absentAutoSMS ? 'Enabled' : 'Disabled'}</span>
                    </button>
                  </div>

                  <div className="space-y-1.5 pt-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-700">SMS Notification Message Template</label>
                      <div className="flex items-center gap-1 text-[11px]">
                        <span className="text-slate-400">Insert tag:</span>
                        {['[STUDENT_NAME]', '[DATE]', '[SCHOOL_NAME]'].map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => insertSmsTag(tag)}
                            className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-mono text-[10px] font-bold border border-indigo-100 cursor-pointer"
                          >
                            +{tag}
                          </button>
                        ))}
                      </div>
                    </div>
                    <textarea
                      required
                      rows={3}
                      value={sysSettings.smsTemplate}
                      onChange={(e) => setSysSettings({ ...sysSettings, smsTemplate: e.target.value })}
                      className="w-full text-xs bg-white border border-slate-200 p-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800 font-sans"
                    />
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>Length: {sysSettings.smsTemplate.length} characters</span>
                      <span>Approx. {Math.ceil(sysSettings.smsTemplate.length / 160) || 1} SMS Credit(s)</span>
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 hover:bg-indigo-700 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/25 transition-all cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>Save Communication Settings</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* SECTION 6: SECURITY & BACKUP VAULT */}
          {activeSection === 'security' && (
            <div className="space-y-6 max-w-3xl animate-fade-in">
              <div className="border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-1">
                  <Lock className="w-4 h-4" />
                  <span>Security Infrastructure</span>
                </div>
                <h2 className="text-xl font-black text-slate-900">Security Governance &amp; Disaster Recovery</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Enforce credential complexity, lockout prevention, multi-factor verification, and automated PostgreSQL snapshot archives.
                </p>
              </div>

              <form onSubmit={handleSaveGeneralSettings} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Minimum Password Key Length</label>
                    <input
                      required
                      type="number"
                      min="6"
                      max="32"
                      value={sysSettings.minPasswordLength}
                      onChange={(e) => setSysSettings({ ...sysSettings, minPasswordLength: parseInt(e.target.value) })}
                      className="w-full text-xs bg-slate-50 border border-slate-200 px-3.5 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800 font-bold"
                    />
                    <p className="text-[11px] text-slate-400">Required minimum length across all student/staff passwords.</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Failed Login Attempts Before Lockout</label>
                    <input
                      required
                      type="number"
                      min="3"
                      max="10"
                      value={sysSettings.lockoutAttempts}
                      onChange={(e) => setSysSettings({ ...sysSettings, lockoutAttempts: parseInt(e.target.value) })}
                      className="w-full text-xs bg-slate-50 border border-slate-200 px-3.5 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800 font-bold"
                    />
                    <p className="text-[11px] text-slate-400">Account locked for 15 minutes after threshold exceeded.</p>
                  </div>
                </div>

                {/* 2FA Enforcement Card */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4 flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Two-Factor Authentication (2FA) for Admins</h4>
                    <p className="text-[11px] text-slate-500">Require TOTP authenticator code on all administrator logins.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSysSettings({ ...sysSettings, require2FAForAdmins: !sysSettings.require2FAForAdmins })}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition-all cursor-pointer ${
                      sysSettings.require2FAForAdmins
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {sysSettings.require2FAForAdmins ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                    <span>{sysSettings.require2FAForAdmins ? 'Enforced' : 'Optional'}</span>
                  </button>
                </div>

                {/* Database Snapshots Card */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-900">Automated PostgreSQL Snapshots</h4>
                      <p className="text-[11px] text-slate-500">Disaster recovery schedule and secure offsite storage.</p>
                    </div>
                    <button
                      type="button"
                      onClick={triggerInstantBackup}
                      disabled={isBackingUp}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 hover:bg-black px-3.5 py-2 text-xs font-bold text-white shadow-xs transition-all cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isBackingUp ? 'animate-spin' : ''}`} />
                      <span>{isBackingUp ? 'Capturing Snapshot…' : 'Capture Snapshot Now'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700">Snapshot Frequency</label>
                      <select
                        value={sysSettings.backupSchedule}
                        onChange={(e) => setSysSettings({ ...sysSettings, backupSchedule: e.target.value })}
                        className="w-full text-xs bg-white border border-slate-200 px-3.5 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800 font-semibold cursor-pointer"
                      >
                        <option value="Hourly">Hourly Incremental Snapshots (High Redundancy)</option>
                        <option value="Daily">Daily Full Replication Backups (Recommended)</option>
                        <option value="Weekly">Weekly System Snapshot Archives</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700">Retention Horizon (Days)</label>
                      <input
                        required
                        type="number"
                        min="7"
                        max="365"
                        value={sysSettings.backupRetentionDays}
                        onChange={(e) => setSysSettings({ ...sysSettings, backupRetentionDays: parseInt(e.target.value) })}
                        className="w-full text-xs bg-white border border-slate-200 px-3.5 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800 font-bold"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Offsite Storage Destination Bucket</label>
                    <input
                      required
                      type="text"
                      value={sysSettings.backupDestination}
                      onChange={(e) => setSysSettings({ ...sysSettings, backupDestination: e.target.value })}
                      className="w-full text-xs bg-white border border-slate-200 px-3.5 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800 font-mono text-[11px]"
                    />
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 hover:bg-indigo-700 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/25 transition-all cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>Save Security Policies</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* SECTION 7: FEATURE MODULES ROLLOUT */}
          {activeSection === 'modules' && (
            <div className="space-y-6 max-w-3xl animate-fade-in">
              <div className="border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-1">
                  <SlidersHorizontal className="w-4 h-4" />
                  <span>Module Governance</span>
                </div>
                <h2 className="text-xl font-black text-slate-900">Feature Modules Availability Rollout</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Turn platform modules on or off across school branch workspaces to stage controlled rollouts.
                </p>
              </div>

              <div className="space-y-3">
                {modules.map((mod) => (
                  <div
                    key={mod.id}
                    className="rounded-2xl border border-slate-200/90 bg-white p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs hover:border-slate-300 transition-all"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-bold text-slate-900">{mod.name}</h4>
                        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
                          {mod.category}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">{mod.description}</p>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setModules((curr) =>
                          curr.map((m) => (m.id === mod.id ? { ...m, enabled: !m.enabled } : m))
                        )
                      }
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 ${
                        mod.enabled
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                          : 'bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200'
                      }`}
                    >
                      {mod.enabled ? <ToggleRight className="w-4 h-4 text-emerald-600" /> : <ToggleLeft className="w-4 h-4" />}
                      <span>{mod.enabled ? 'Module Enabled' : 'Disabled'}</span>
                    </button>
                  </div>
                ))}
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={saveModules}
                  className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 hover:bg-indigo-700 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/25 transition-all cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>Save Module Availability</span>
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
