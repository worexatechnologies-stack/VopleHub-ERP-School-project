import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Key,
  ShieldCheck,
  Users,
  GraduationCap,
  UserCheck,
  Search,
  Copy,
  Check,
  Eye,
  EyeOff,
  Download,
  RefreshCw,
  Filter,
  AlertCircle,
  CheckCircle2,
  Lock,
  RotateCcw,
  User,
  HeartHandshake,
  School,
  Trash,
  Building,
  Layers,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  SlidersHorizontal,
  BookOpen,
} from 'lucide-react';
import {
  useGetVaultCredentialsQuery,
  useSyncVaultRosterMutation,
  useResetVaultCredentialPasswordMutation,
  useUpdateVaultCredentialMutation,
  useDeleteVaultCredentialMutation,
  VaultCredential,
} from '../store/api/vaultApi';
import { useGetClassesQuery, useGetSectionsQuery } from '../store/api/academicApi';
import { copyToClipboard as robustCopyToClipboard } from '../utils/clipboard';

interface PasswordManagerProps {
  schoolName?: string;
  onOpenChangePassword?: () => void;
  viewerRole?: string;
}

export default function PasswordManager({
  schoolName = 'School Portal',
  onOpenChangePassword,
  viewerRole,
}: PasswordManagerProps) {
  const isSuperAdmin = viewerRole === 'Super Admin';

  const [selectedRole, setSelectedRole] = useState<'all' | 'student' | 'teacher' | 'parent'>('all');
  const [selectedClass, setSelectedClass] = useState<string>('all');
  const [selectedSection, setSelectedSection] = useState<string>('all');
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [revealedIds, setRevealedIds] = useState<Set<number>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);

  // Debounce search query by 250ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Super Admin action modal states
  const [updatingAdminItem, setUpdatingAdminItem] = useState<VaultCredential | null>(null);
  const [adminNewPassword, setAdminNewPassword] = useState('');
  const [adminDeleteCandidate, setAdminDeleteCandidate] = useState<VaultCredential | null>(null);

  // Fetch official school academic classes & sections for authoritative dropdown options
  const { data: dbClasses = [] } = useGetClassesQuery(undefined, { skip: isSuperAdmin });
  const { data: dbSections = [] } = useGetSectionsQuery(undefined, { skip: isSuperAdmin });

  // Unfiltered vault query for stable overview KPI counts and full class/section discovery
  const { data: allVaultCredentials = [] } = useGetVaultCredentialsQuery(
    isSuperAdmin ? { role: 'admin' } : {},
    { refetchOnMountOrArgChange: true }
  );

  // Filtered RTK Query hooks with live auto-sync polling every 3 seconds
  const { data: rawCredentials = [], isLoading, isFetching, refetch } = useGetVaultCredentialsQuery(
    {
      role: isSuperAdmin ? 'admin' : selectedRole !== 'all' ? selectedRole : undefined,
      className: !isSuperAdmin && selectedClass !== 'all' ? selectedClass : undefined,
      section: !isSuperAdmin && selectedSection !== 'all' ? selectedSection : undefined,
      search: debouncedSearch ? debouncedSearch : undefined,
    },
    {
      pollingInterval: 3000,
      refetchOnMountOrArgChange: true,
      refetchOnFocus: true,
      refetchOnReconnect: true,
    }
  );

  const [syncVaultRoster, { isLoading: isSyncing }] = useSyncVaultRosterMutation();
  const [resetPassword, { isLoading: isResetting }] = useResetVaultCredentialPasswordMutation();
  const [updateVaultCredential, { isLoading: isUpdatingCred }] = useUpdateVaultCredentialMutation();
  const [deleteVaultCredential, { isLoading: isDeletingCred }] = useDeleteVaultCredentialMutation();

  // Distinct branches for Super Admin
  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    rawCredentials.forEach((c) => {
      if (c.schoolName) set.add(c.schoolName);
    });
    return Array.from(set).sort();
  }, [rawCredentials]);

  // Filtered credentials (handling branch filter for Super Admin)
  const credentials = useMemo(() => {
    if (!isSuperAdmin || selectedBranch === 'all') return rawCredentials;
    return rawCredentials.filter((c) => c.schoolName === selectedBranch);
  }, [rawCredentials, isSuperAdmin, selectedBranch]);

  // Automatically sync roster on mount in background to guarantee all accounts have live credentials
  useEffect(() => {
    syncVaultRoster()
      .unwrap()
      .catch((err) => {
        console.debug('Background auto-sync on mount:', err);
      });
  }, [syncVaultRoster]);

  // Helper to extract integer from class name for natural sorting (e.g. 1, 2, ..., 10)
  const getSortNumber = (str: string): number => {
    const match = str.match(/\d+/);
    return match ? parseInt(match[0], 10) : Number.MAX_SAFE_INTEGER;
  };

  // Helper to format class display nicely (e.g. "1" -> "Class 1")
  const formatClassDisplay = (val: string): string => {
    if (!val) return '';
    if (/^(class|grade)\s+/i.test(val)) return val;
    if (/^\d+$/.test(val)) return `Class ${val}`;
    return val;
  };

  // Distinct classes for the filter dropdown (School Admin view)
  // Combines official Academic Setup classes + all credentials, sorted naturally
  const classOptions = useMemo(() => {
    const map = new Map<string, string>(); // raw value -> display label

    // 1. Add from official classes in Academic Setup
    dbClasses.forEach((c) => {
      if (c.name) {
        map.set(c.name, formatClassDisplay(c.name));
      }
    });

    // 2. Add from all vault records
    allVaultCredentials.forEach((c) => {
      if (c.className && !map.has(c.className)) {
        map.set(c.className, formatClassDisplay(c.className));
      }
    });

    // 3. Natural numerical sort (1, 2, ..., 10, instead of alphabetical 1, 10, 2...)
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => {
        const numA = getSortNumber(a.value);
        const numB = getSortNumber(b.value);
        if (numA !== numB) return numA - numB;
        return a.label.localeCompare(b.label, undefined, { numeric: true });
      });
  }, [dbClasses, allVaultCredentials]);

  // Distinct sections available for the currently selected class
  const sectionOptions = useMemo(() => {
    const set = new Set<string>();

    if (selectedClass !== 'all') {
      // Find class record in Academic Setup
      const selectedClassRecord = dbClasses.find(
        (c) =>
          c.name.toLowerCase() === selectedClass.toLowerCase() ||
          c.name.toLowerCase() === selectedClass.replace(/^(class|grade)\s*/i, '').toLowerCase() ||
          `class ${c.name}`.toLowerCase() === selectedClass.toLowerCase()
      );

      if (selectedClassRecord) {
        dbSections
          .filter((s) => s.classId === selectedClassRecord.id)
          .forEach((s) => set.add(s.name.toUpperCase()));
      }

      // Also harvest sections from vault credentials matching this class
      allVaultCredentials.forEach((c) => {
        if (
          c.className &&
          (c.className.toLowerCase() === selectedClass.toLowerCase() ||
            c.className.toLowerCase() === selectedClass.replace(/^(class|grade)\s*/i, '').toLowerCase()) &&
          c.section
        ) {
          set.add(c.section.trim().toUpperCase());
        }
      });
    } else {
      // All sections across the school
      dbSections.forEach((s) => set.add(s.name.toUpperCase()));
      allVaultCredentials.forEach((c) => {
        if (c.section) set.add(c.section.trim().toUpperCase());
      });
    }

    return Array.from(set).sort();
  }, [selectedClass, dbClasses, dbSections, allVaultCredentials]);

  // Handlers for filter changes
  const handleRoleChange = (role: 'all' | 'student' | 'teacher' | 'parent') => {
    setSelectedRole(role);
    setPage(1);
  };

  const handleClassChange = (newClass: string) => {
    setSelectedClass(newClass);
    setSelectedSection('all');
    setPage(1);
  };

  const handleSectionChange = (newSection: string) => {
    setSelectedSection(newSection);
    setPage(1);
  };

  const handleResetFilters = () => {
    setSelectedClass('all');
    setSelectedSection('all');
    setSearchQuery('');
    setPage(1);
  };

  // Aggregate metrics: derived from allVaultCredentials so overview cards stay stable
  const stats = useMemo(() => {
    const source = allVaultCredentials.length > 0 ? allVaultCredentials : credentials;
    const total = source.length;
    const students = source.filter((c) => c.role === 'student').length;
    const teachers = source.filter((c) => c.role === 'teacher').length;
    const parents = source.filter((c) => c.role === 'parent').length;
    const admins = source.filter((c) => c.role === 'admin' || c.role === 'school_admin').length;
    return { total, students, teachers, parents, admins };
  }, [allVaultCredentials, credentials]);

  // Client-side pagination calculations
  const totalPages = Math.max(1, Math.ceil(credentials.length / pageSize));
  const paginatedCredentials = useMemo(() => {
    const start = (page - 1) * pageSize;
    return credentials.slice(start, start + pageSize);
  }, [credentials, page, pageSize]);

  // Toggle reveal
  const toggleReveal = (id: number) => {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Robust cross-platform copy handler
  const handleCopy = async (
    e: React.MouseEvent,
    text: string,
    key: string,
    label: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!text) return;

    let success = false;
    try {
      success = await robustCopyToClipboard(text);
    } catch {
      success = false;
    }

    if (!success) {
      // Fallback with temporary textarea
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus({ preventScroll: true });
        textArea.select();
        success = document.execCommand('copy');
        document.body.removeChild(textArea);
      } catch (err) {
        console.error('Copy fallback failed:', err);
      }
    }

    if (success) {
      setCopiedKey(key);
      setCopyToast(`${label} copied to clipboard!`);
      setTimeout(() => {
        setCopiedKey((curr) => (curr === key ? null : curr));
      }, 2000);
      setTimeout(() => {
        setCopyToast((curr) => (curr?.startsWith(label) ? null : curr));
      }, 2500);
    } else {
      alert(`Could not copy: ${text}`);
    }
  };

  // Handle Sync Roster
  const handleSync = async () => {
    try {
      setSyncStatusMsg(null);
      const res = await syncVaultRoster().unwrap();
      if (res.synced > 0) {
        setSyncStatusMsg(`Successfully auto-provisioned ${res.synced} credentials (${res.students} students, ${res.teachers} teachers, ${res.parents} parents).`);
      } else {
        setSyncStatusMsg('All active student, teacher, and parent logins are already catalogued.');
      }
      refetch();
    } catch (err: any) {
      setSyncStatusMsg(`Sync error: ${err?.data?.detail || err?.message || 'Failed to sync'}`);
    }
  };

  // Reset single password
  const handleResetPassword = async (item: VaultCredential) => {
    if (!window.confirm(`Generate a new temporary password for ${item.name} (${item.loginId})?`)) {
      return;
    }
    try {
      await resetPassword(item.id).unwrap();
      // Ensure the new password is shown
      setRevealedIds((prev) => new Set([...prev, item.id]));
    } catch (err: any) {
      alert(`Could not reset password: ${err?.data?.detail || err?.message}`);
    }
  };

  // Super Admin custom password update
  const handleSaveAdminNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!updatingAdminItem || !adminNewPassword) return;
    if (adminNewPassword.length < 8) {
      alert('Password must be at least 8 characters long.');
      return;
    }
    try {
      await updateVaultCredential({
        id: updatingAdminItem.id,
        password: adminNewPassword,
      }).unwrap();
      setRevealedIds((prev) => new Set([...prev, updatingAdminItem.id]));
      setCopyToast(`Password updated for ${updatingAdminItem.name}`);
      setUpdatingAdminItem(null);
      setAdminNewPassword('');
      refetch();
    } catch (err: any) {
      alert(err?.data?.detail || err?.message || 'Could not update administrator password.');
    }
  };

  // Super Admin permanent delete
  const handleConfirmDeleteAdmin = async () => {
    if (!adminDeleteCandidate) return;
    try {
      await deleteVaultCredential(adminDeleteCandidate.id).unwrap();
      setCopyToast(`Administrator ${adminDeleteCandidate.name} permanently deleted.`);
      setAdminDeleteCandidate(null);
      refetch();
    } catch (err: any) {
      alert(err?.data?.detail || err?.message || 'Could not delete administrator.');
    }
  };

  // Export CSV
  const handleExportCsv = () => {
    if (!credentials.length) return;

    if (isSuperAdmin) {
      const headers = ['Administrator Name', 'Login Email / ID', 'Allocated School Branch', 'Password', 'Status'];
      const rows = credentials.map((c) => [
        `"${c.name.replace(/"/g, '""')}"`,
        `"${c.loginId}"`,
        `"${(c.schoolName || 'Central Branch').replace(/"/g, '""')}"`,
        `"${c.password}"`,
        '"Active"',
      ]);
      const csvContent =
        'data:text/csv;charset=utf-8,' +
        [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute(
        'download',
        `school_admins_passwords_${new Date().toISOString().slice(0, 10)}.csv`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    const headers = [
      'Role',
      'Name',
      'Login Email / ID',
      'Password',
      'Admission / Employee ID',
      'Class & Section',
      'Academic Year',
      'Contact Phone',
      'Linked Student',
      'Source',
    ];
    const rows = credentials.map((c) => [
      c.role.toUpperCase(),
      `"${c.name.replace(/"/g, '""')}"`,
      `"${c.loginId}"`,
      `"${c.password}"`,
      `"${c.identifier || ''}"`,
      `"${c.className ? `${c.className} ${c.section}`.trim() : ''}"`,
      `"${c.academicYear || ''}"`,
      `"${c.phone || ''}"`,
      `"${c.linkedStudentName ? c.linkedStudentName.replace(/"/g, '""') : ''}"`,
      `"${c.source || ''}"`,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `${schoolName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_passwords_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 p-6 md:p-8 text-white shadow-xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-300">
                <Key className="w-3.5 h-3.5" />
                <span>{isSuperAdmin ? 'Root Access Credential Vault' : 'School Credential Distribution Vault'}</span>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-300 shadow-sm">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Live Directory Synced</span>
              </div>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white">
              {isSuperAdmin ? 'Administrator Password Manager' : 'Password Manager'}
            </h1>
            <p className="text-sm text-slate-300 max-w-2xl">
              {isSuperAdmin ? (
                <>
                  Centralized, secure credential authority for dedicated <strong className="text-white">School Administrators &amp; Commissioners</strong> across all branches. Monitor, reveal, copy, or reset administrator credentials.
                </>
              ) : (
                <>
                  Centralized, secure repository of temporary and assigned credentials for{' '}
                  <strong className="text-white">Students</strong>,{' '}
                  <strong className="text-white">Teachers</strong>, and{' '}
                  <strong className="text-white">Parents</strong>. Credentials from CSV &amp; Excel uploads are automatically archived here.
                </>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => {
                refetch();
                if (!isSuperAdmin) handleSync();
              }}
              disabled={isSyncing}
              className="inline-flex items-center gap-2 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/20 px-4 py-2.5 text-xs font-bold text-white shadow-sm backdrop-blur-md transition-all cursor-pointer disabled:opacity-50"
              title="Refresh credentials from the server"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Syncing...' : isSuperAdmin ? 'Sync Admin Directory' : 'Sync Active Roster'}</span>
            </button>

            <button
              onClick={handleExportCsv}
              disabled={credentials.length === 0}
              className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 transition-all cursor-pointer disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              <span>Export Passwords (CSV)</span>
            </button>
          </div>
        </div>

        {/* Security Invariant Badge */}
        <div className="mt-6 pt-5 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-300">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              {isSuperAdmin ? (
                <>
                  <strong className="text-white">Root Clearance:</strong> Exclusively School Administrator credentials are displayed in this console.
                </>
              ) : (
                <>
                  <strong className="text-white">Strict Security Policy:</strong> Admin and Super Admin passwords are never recorded or accessible in this vault.
                </>
              )}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {onOpenChangePassword && !isSuperAdmin && (
              <button
                type="button"
                onClick={onOpenChangePassword}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-semibold text-white transition-all cursor-pointer shadow-xs"
              >
                <Key className="w-3.5 h-3.5 text-indigo-300" />
                <span>Change Admin Password</span>
              </button>
            )}
            <div className="flex items-center gap-2 text-slate-400 text-[11px]">
              <Lock className="w-3.5 h-3.5 text-indigo-400" />
              <span>Encrypted tenant isolation active</span>
            </div>
          </div>
        </div>
      </div>

      {/* Sync Status Alert */}
      {syncStatusMsg && (
        <div className="flex items-center justify-between rounded-2xl border border-indigo-200 bg-indigo-50/90 px-4 py-3 text-xs font-medium text-indigo-900 shadow-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
            <span>{syncStatusMsg}</span>
          </div>
          <button
            onClick={() => setSyncStatusMsg(null)}
            className="text-indigo-500 hover:text-indigo-800 font-bold ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Stats Cards */}
      {isSuperAdmin ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Admins</span>
              <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <UserCheck className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900">{credentials.length}</div>
            <p className="text-[11px] text-slate-400 mt-0.5">School administrators</p>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Active Credentials</span>
              <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Key className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900">{credentials.filter((c) => c.password).length}</div>
            <p className="text-[11px] text-slate-400 mt-0.5">Encrypted login keys</p>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">Branches Covered</span>
              <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <School className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900">{branchOptions.length}</div>
            <p className="text-[11px] text-slate-400 mt-0.5">Active school branches</p>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-600 uppercase tracking-wider">Revealed Keys</span>
              <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <Eye className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900">{revealedIds.size}</div>
            <p className="text-[11px] text-slate-400 mt-0.5">Passwords inspected</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Managed</span>
              <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
                <Key className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900">{stats.total}</div>
            <p className="text-[11px] text-slate-400 mt-0.5">Active credentials stored</p>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Students</span>
              <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <GraduationCap className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900">{stats.students}</div>
            <p className="text-[11px] text-slate-400 mt-0.5">Student portal logins</p>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">Teachers</span>
              <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <UserCheck className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900">{stats.teachers}</div>
            <p className="text-[11px] text-slate-400 mt-0.5">Faculty credentials</p>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-600 uppercase tracking-wider">Parents</span>
              <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <HeartHandshake className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900">{stats.parents}</div>
            <p className="text-[11px] text-slate-400 mt-0.5">Guardian access logins</p>
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        {isSuperAdmin ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-50 border border-indigo-100 px-3 py-1.5 text-xs font-bold text-indigo-700">
              <UserCheck className="w-3.5 h-3.5" />
              <span>School Administrators ({credentials.length})</span>
            </span>

            {branchOptions.length > 0 && (
              <div className="relative">
                <select
                  value={selectedBranch}
                  onChange={(e) => {
                    setSelectedBranch(e.target.value);
                    setPage(1);
                  }}
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
                >
                  <option value="all">All School Branches</option>
                  {branchOptions.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center bg-slate-100 p-1 rounded-xl text-xs font-semibold overflow-x-auto shrink-0">
            <button
              onClick={() => handleRoleChange('all')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                selectedRole === 'all'
                  ? 'bg-white text-slate-900 shadow-sm font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Accounts ({stats.total})
            </button>
            <button
              onClick={() => handleRoleChange('student')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                selectedRole === 'student'
                  ? 'bg-emerald-600 text-white shadow-sm font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <GraduationCap className="w-3.5 h-3.5" />
              <span>Students ({stats.students})</span>
            </button>
            <button
              onClick={() => handleRoleChange('teacher')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                selectedRole === 'teacher'
                  ? 'bg-blue-600 text-white shadow-sm font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Teachers ({stats.teachers})</span>
            </button>
            <button
              onClick={() => handleRoleChange('parent')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                selectedRole === 'parent'
                  ? 'bg-amber-600 text-white shadow-sm font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <HeartHandshake className="w-3.5 h-3.5" />
              <span>Parents ({stats.parents})</span>
            </button>
          </div>
        )}

        {/* Right Controls: Class & Section Filters + Search */}
        <div className="flex flex-wrap items-center gap-2.5">
          {!isSuperAdmin && (
            <div className="flex items-center gap-2">
              {/* Class Filter */}
              <div className="relative">
                <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-indigo-500">
                  <GraduationCap className="w-3.5 h-3.5" />
                </div>
                <select
                  value={selectedClass}
                  onChange={(e) => handleClassChange(e.target.value)}
                  className={`h-10 pl-8 pr-7 rounded-xl border text-xs font-bold transition-all cursor-pointer appearance-none bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 ${
                    selectedClass !== 'all'
                      ? 'border-indigo-400 bg-indigo-50/50 text-indigo-900 shadow-xs ring-1 ring-indigo-300'
                      : 'border-slate-200 text-slate-700 hover:border-slate-300'
                  }`}
                  title="Filter credentials by class"
                >
                  <option value="all">All Classes</option>
                  {classOptions.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-[9px]">
                  ▼
                </div>
              </div>

              {/* Section Filter */}
              <div className="relative">
                <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-indigo-500">
                  <Layers className="w-3.5 h-3.5" />
                </div>
                <select
                  value={selectedSection}
                  onChange={(e) => handleSectionChange(e.target.value)}
                  className={`h-10 pl-8 pr-7 rounded-xl border text-xs font-bold transition-all cursor-pointer appearance-none bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 ${
                    selectedSection !== 'all'
                      ? 'border-indigo-400 bg-indigo-50/50 text-indigo-900 shadow-xs ring-1 ring-indigo-300'
                      : 'border-slate-200 text-slate-700 hover:border-slate-300'
                  }`}
                  title="Filter credentials by section"
                >
                  <option value="all">All Sections</option>
                  {sectionOptions.map((s) => (
                    <option key={s} value={s}>
                      Sec {s}
                    </option>
                  ))}
                </select>
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-[9px]">
                  ▼
                </div>
              </div>

              {/* Quick Reset button when filters are active */}
              {(selectedClass !== 'all' || selectedSection !== 'all') && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="h-10 px-2.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold flex items-center gap-1 transition-all cursor-pointer shadow-xs"
                  title="Clear class and section filters"
                >
                  <X className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Reset</span>
                </button>
              )}
            </div>
          )}

          {/* Search Input */}
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isSuperAdmin ? 'Search admin name, email, branch...' : 'Search by name, login, or ID...'}
              className="w-full h-10 rounded-xl border border-slate-200 pl-9 pr-8 text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Active Filter Status Bar */}
      {!isSuperAdmin && (selectedClass !== 'all' || selectedSection !== 'all' || debouncedSearch) && (
        <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-2.5 rounded-2xl bg-indigo-50/80 border border-indigo-100 text-xs text-indigo-900 animate-fade-in shadow-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-indigo-700 flex items-center gap-1.5">
              <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-600" />
              Active Filters:
            </span>
            {selectedClass !== 'all' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-white border border-indigo-200 text-indigo-800 font-bold text-[11px] shadow-xs">
                {formatClassDisplay(selectedClass)}
                <button
                  type="button"
                  onClick={() => handleClassChange('all')}
                  className="hover:text-rose-600 ml-0.5 cursor-pointer text-slate-400"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {selectedSection !== 'all' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-white border border-indigo-200 text-indigo-800 font-bold text-[11px] shadow-xs">
                Section {selectedSection}
                <button
                  type="button"
                  onClick={() => handleSectionChange('all')}
                  className="hover:text-rose-600 ml-0.5 cursor-pointer text-slate-400"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {debouncedSearch && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-white border border-indigo-200 text-indigo-800 font-bold text-[11px] shadow-xs">
                Query: "{debouncedSearch}"
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="hover:text-rose-600 ml-0.5 cursor-pointer text-slate-400"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            <span className="text-slate-500 font-semibold ml-1">
              ({credentials.length} matching account{credentials.length === 1 ? '' : 's'})
            </span>
          </div>

          <button
            type="button"
            onClick={handleResetFilters}
            className="text-xs font-bold text-indigo-700 hover:text-indigo-900 underline cursor-pointer"
          >
            Clear all filters
          </button>
        </div>
      )}

      {/* Credentials Table Card */}
      <div className="rounded-3xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-500">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-indigo-500 mb-3" />
            <p className="text-sm font-semibold">Loading Password Manager entries...</p>
          </div>
        ) : credentials.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3">
              <Key className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900">
              {isSuperAdmin ? 'No administrator passwords found' : 'No passwords found'}
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              {searchQuery || (isSuperAdmin ? selectedBranch !== 'all' : selectedClass !== 'all' || selectedRole !== 'all')
                ? 'Try adjusting your search filters.'
                : isSuperAdmin
                ? 'Commission school administrators in the School Admins tab to manage their credentials.'
                : 'Click "Sync Active Roster" above or import students / teachers via CSV to populate the vault.'}
            </p>
          </div>
        ) : isSuperAdmin ? (
          /* Dedicated Super Admin View: Exclusively Administrator Passwords */
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200/80 bg-slate-50/70 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Administrator Name</th>
                  <th className="py-3 px-4">Login ID / Email</th>
                  <th className="py-3 px-4">Allocated School Branch</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Password Credential</th>
                  <th className="py-3 px-4 text-right">Clearance Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedCredentials.map((item) => {
                  const isRevealed = revealedIds.has(item.id);
                  const isUserCopied = copiedKey === `login-${item.id}`;
                  const isPassCopied = copiedKey === `pass-${item.id}`;

                  return (
                    <tr key={item.id} className="hover:bg-slate-50/80 transition-colors group">
                      {/* Admin Name */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center font-bold text-indigo-700 shrink-0">
                            {item.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 flex items-center gap-2">
                              <span>{item.name}</span>
                              <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
                                SCHOOL_ADMIN
                              </span>
                            </div>
                            {item.identifier && (
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                {item.identifier}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Login ID / Email */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-700">
                          <span className="select-all">{item.loginId}</span>
                          <button
                            type="button"
                            onClick={(e) => handleCopy(e, item.loginId, `login-${item.id}`, `${item.name}'s Login ID`)}
                            className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                              isUserCopied
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-600 shadow-xs scale-105'
                                : 'bg-slate-50 border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-100 hover:border-slate-300'
                            }`}
                            title={isUserCopied ? 'Copied Login ID!' : 'Copy Login ID'}
                          >
                            {isUserCopied ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Allocated School Branch */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 text-slate-700 font-medium">
                          <School className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{item.schoolName || 'Central Branch Office'}</span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-600 border-emerald-100">
                          Active
                        </span>
                      </td>

                      {/* Password */}
                      <td className="py-3 px-4">
                        {item.password === '[User Managed]' || !item.mustChangePassword || item.source === 'user_password_change' ? (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold" title="Protected: User has set their personal password (hashed via Argon2id)">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span>User Set • Protected</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => toggleReveal(item.id)}
                              className={`font-mono text-xs px-2.5 py-1 rounded-lg border transition-all cursor-pointer text-left ${
                                isRevealed
                                  ? 'bg-amber-50/80 border-amber-200 text-amber-900 font-bold select-all'
                                  : 'bg-slate-100 border-slate-200 text-slate-500 select-none tracking-widest hover:border-slate-300'
                              }`}
                              title="Click to toggle reveal"
                            >
                              {isRevealed ? item.password : '••••••••••••'}
                            </button>

                            <button
                              type="button"
                              onClick={() => toggleReveal(item.id)}
                              className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                              title={isRevealed ? 'Hide Password' : 'Show Password'}
                            >
                              {isRevealed ? (
                                <EyeOff className="w-3.5 h-3.5 text-amber-600" />
                              ) : (
                                <Eye className="w-3.5 h-3.5" />
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={(e) => handleCopy(e, item.password, `pass-${item.id}`, `${item.name}'s Password`)}
                              className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                                isPassCopied
                                  ? 'bg-emerald-50 border-emerald-300 text-emerald-600 shadow-xs scale-105'
                                  : 'bg-slate-50 border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-100 hover:border-slate-300'
                              }`}
                              title={isPassCopied ? 'Copied Password!' : 'Copy Password'}
                            >
                              {isPassCopied ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        )}
                      </td>

                      {/* Clearance Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* Update Custom Password */}
                          <button
                            type="button"
                            onClick={() => {
                              setUpdatingAdminItem(item);
                              setAdminNewPassword('');
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800 transition-all cursor-pointer"
                            title="Set custom password for this administrator"
                          >
                            <Key className="w-3 h-3 text-amber-600" />
                            <span>Update Password</span>
                          </button>

                          {/* Delete Administrator */}
                          <button
                            type="button"
                            onClick={() => setAdminDeleteCandidate(item)}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 px-2 py-1 text-[10px] font-bold text-rose-700 transition-all cursor-pointer"
                            title="Delete administrator from database"
                          >
                            <Trash className="w-3 h-3 text-rose-600" />
                            <span>Delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* Standard School Admin View: Students, Teachers, Parents */
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200/80 bg-slate-50/70 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">User &amp; Role</th>
                  <th className="py-3 px-4">Details / Class</th>
                  <th className="py-3 px-4">Login ID (Username / Email)</th>
                  <th className="py-3 px-4">Password</th>
                  <th className="py-3 px-4">Source</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedCredentials.map((item) => {
                  const isRevealed = revealedIds.has(item.id);
                  const isUserCopied = copiedKey === `login-${item.id}`;
                  const isPassCopied = copiedKey === `pass-${item.id}`;

                  let roleBadge = (
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                      <GraduationCap className="w-3 h-3" /> Student
                    </span>
                  );
                  if (item.role === 'teacher') {
                    roleBadge = (
                      <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-200">
                        <UserCheck className="w-3 h-3" /> Teacher
                      </span>
                    );
                  } else if (item.role === 'parent') {
                    roleBadge = (
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 border border-amber-200">
                        <HeartHandshake className="w-3 h-3" /> Parent
                      </span>
                    );
                  }

                  return (
                    <tr key={item.id} className="hover:bg-slate-50/80 transition-colors group">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-slate-700 shrink-0">
                            {item.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 flex items-center gap-2">
                              <span>{item.name}</span>
                              {roleBadge}
                            </div>
                            {item.identifier && (
                              <div className="text-[11px] text-slate-500 font-mono">
                                ID: {item.identifier}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        {item.className ? (
                          <div>
                            <span className="font-semibold text-slate-800">
                              {item.className}
                              {item.section ? ` - ${item.section}` : ''}
                            </span>
                            {item.academicYear && (
                              <span className="text-[11px] text-slate-400 block font-sans">
                                {item.academicYear}
                              </span>
                            )}
                          </div>
                        ) : item.linkedStudentName ? (
                          <div>
                            <span className="text-[11px] text-slate-500">Child:</span>{' '}
                            <span className="font-semibold text-slate-800">
                              {item.linkedStudentName}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400 font-sans italic">—</span>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-700">
                          <span className="select-all">{item.loginId}</span>
                          <button
                            type="button"
                            onClick={(e) => handleCopy(e, item.loginId, `login-${item.id}`, `${item.name}'s Login ID`)}
                            className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                              isUserCopied
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-600 shadow-xs scale-105'
                                : 'bg-slate-50 border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-100 hover:border-slate-300'
                            }`}
                            title={isUserCopied ? 'Copied Login ID!' : 'Copy Login ID'}
                          >
                            {isUserCopied ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        {item.password === '[User Managed]' || !item.mustChangePassword || item.source === 'user_password_change' ? (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold" title="Protected: User has set their personal password (hashed via Argon2id)">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span>User Set • Protected</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => toggleReveal(item.id)}
                              className={`font-mono text-xs px-2.5 py-1 rounded-lg border transition-all cursor-pointer text-left ${
                                isRevealed
                                  ? 'bg-amber-50/80 border-amber-200 text-amber-900 font-bold select-all'
                                  : 'bg-slate-100 border-slate-200 text-slate-500 select-none tracking-widest hover:border-slate-300'
                              }`}
                              title="Click to toggle reveal"
                            >
                              {isRevealed ? item.password : '••••••••••••'}
                            </button>

                            <button
                              type="button"
                              onClick={() => toggleReveal(item.id)}
                              className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                              title={isRevealed ? 'Hide Password' : 'Show Password'}
                            >
                              {isRevealed ? (
                                <EyeOff className="w-3.5 h-3.5 text-amber-600" />
                              ) : (
                                <Eye className="w-3.5 h-3.5" />
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={(e) => handleCopy(e, item.password, `pass-${item.id}`, `${item.name}'s Password`)}
                              className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                                isPassCopied
                                  ? 'bg-emerald-50 border-emerald-300 text-emerald-600 shadow-xs scale-105'
                                  : 'bg-slate-50 border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-100 hover:border-slate-300'
                              }`}
                              title={isPassCopied ? 'Copied Password!' : 'Copy Password'}
                            >
                              {isPassCopied ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                          item.source === 'user_password_change'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          {item.source === 'csv_bulk_import'
                            ? 'CSV Import'
                            : item.source === 'sync_auto'
                            ? 'Auto-Sync'
                            : item.source === 'admin_reset'
                            ? 'Admin Reset'
                            : item.source === 'user_password_change'
                            ? 'User Set'
                            : item.source || 'Active'}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => handleCopy(
                              e,
                              `School: ${schoolName}\nRole: ${item.role.toUpperCase()}\nName: ${item.name}\nLogin ID: ${item.loginId}\nPassword: ${item.password}`,
                              `slip-${item.id}`,
                              `${item.name}'s Credentials Slip`
                            )}
                            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-all cursor-pointer ${
                              copiedKey === `slip-${item.id}`
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-700 shadow-xs'
                                : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:border-slate-300'
                            }`}
                            title="Copy Login ID and Password together"
                          >
                            {copiedKey === `slip-${item.id}` ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-600" />
                                <span>Copied Slip</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3 text-slate-400" />
                                <span>Copy Slip</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleResetPassword(item)}
                            disabled={isResetting}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 hover:bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition-all cursor-pointer disabled:opacity-50"
                            title="Generate a new password for this user"
                          >
                            <RotateCcw className="w-3 h-3 text-slate-400" />
                            <span>Reset</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Table Footer & Interactive Pagination Bar */}
        {!isLoading && credentials.length > 0 && (
          <div className="p-4 bg-slate-50/80 border-t border-slate-200/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <div className="text-slate-600 font-medium">
              Showing{' '}
              <strong className="text-slate-900 font-bold">
                {credentials.length === 0 ? 0 : (page - 1) * pageSize + 1} - {Math.min(page * pageSize, credentials.length)}
              </strong>{' '}
              of <strong className="text-indigo-700 font-bold">{credentials.length.toLocaleString()}</strong> credentials
              {selectedClass !== 'all' && (
                <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-bold">
                  {formatClassDisplay(selectedClass)}
                  {selectedSection !== 'all' ? ` - Sec ${selectedSection}` : ''}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span>Rows:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage(1)}
                    title="First page"
                    className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ChevronsLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    title="Previous page"
                    className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg font-mono text-[11px] font-bold text-slate-700">
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    title="Next page"
                    className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage(totalPages)}
                    title="Last page"
                    className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ChevronsRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Super Admin Update Password Modal */}
      {updatingAdminItem && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 animate-fade-in">
          <div className="bg-white w-full max-w-md rounded-2xl border border-slate-200 shadow-2xl p-6 relative animate-scale-up space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                <Key className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800">Update Administrator Password</h3>
                <p className="text-xs text-slate-500">Super Admin Root Clearance</p>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-xs text-slate-700 space-y-1">
              <div><span className="text-slate-400">Officer:</span> <span className="font-bold">{updatingAdminItem.name}</span></div>
              <div><span className="text-slate-400">Login ID:</span> <span className="font-bold">{updatingAdminItem.loginId}</span></div>
              <div><span className="text-slate-400">Branch:</span> <span className="font-bold">{updatingAdminItem.schoolName || 'Central Branch Office'}</span></div>
            </div>

            <form onSubmit={handleSaveAdminNewPassword} className="space-y-4">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">New Password</label>
                  <button
                    type="button"
                    onClick={() => {
                      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';
                      let pass = '';
                      for (let i = 0; i < 12; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
                      setAdminNewPassword(pass);
                    }}
                    className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 cursor-pointer"
                  >
                    Generate Random
                  </button>
                </div>
                <input
                  autoFocus
                  required
                  type="text"
                  minLength={8}
                  placeholder="Enter at least 8 characters"
                  value={adminNewPassword}
                  onChange={(e) => setAdminNewPassword(e.target.value)}
                  className="w-full text-xs bg-slate-50 border border-slate-200 p-2.5 rounded-xl focus:outline-indigo-500 text-slate-800 font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setUpdatingAdminItem(null);
                    setAdminNewPassword('');
                  }}
                  disabled={isUpdatingCred}
                  className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingCred || adminNewPassword.length < 8}
                  className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-xs disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <Key className="w-3.5 h-3.5" />
                  {isUpdatingCred ? 'Saving in DB…' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Super Admin Delete Modal */}
      {adminDeleteCandidate && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 animate-fade-in">
          <div className="bg-white w-full max-w-md rounded-2xl border border-rose-100 shadow-2xl p-6 relative animate-scale-up space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                <Trash className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800">Delete Dedicated Administrator</h3>
                <p className="text-xs text-slate-500">Permanent database removal</p>
              </div>
            </div>

            <div className="bg-rose-50/70 border border-rose-100 rounded-xl p-3.5 space-y-2 text-xs text-rose-900">
              <p className="leading-relaxed">
                Are you sure you want to permanently delete administrator <strong className="font-bold text-slate-900">{adminDeleteCandidate.name}</strong>?
              </p>
              <div className="text-[11px] font-mono text-slate-700 bg-white/80 p-2.5 rounded-lg border border-rose-100/60 space-y-1">
                <div><span className="text-slate-400">Login ID:</span> <span className="font-bold">{adminDeleteCandidate.loginId}</span></div>
                <div><span className="text-slate-400">Allocated Branch:</span> <span className="font-bold">{adminDeleteCandidate.schoolName || 'Central Branch Office'}</span></div>
              </div>
              <p className="text-[11px] text-rose-700 font-medium">
                ⚠️ This will immediately revoke their administrative clearance and erase this account record from the database.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setAdminDeleteCandidate(null)}
                disabled={isDeletingCred}
                className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteAdmin}
                disabled={isDeletingCred}
                className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-xs disabled:opacity-50 transition-colors cursor-pointer"
              >
                <Trash className="w-3.5 h-3.5" />
                {isDeletingCred ? 'Deleting from DB…' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Floating Copy Feedback Toast */}
      {copyToast && (
        <div className="fixed bottom-6 right-6 z-[9999] flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-xs font-bold text-emerald-800 shadow-2xl shadow-emerald-950/20 animate-fade-in">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 shrink-0">
            <Check className="h-3.5 w-3.5" />
          </div>
          <span>{copyToast}</span>
        </div>
      )}
    </div>
  );
}
