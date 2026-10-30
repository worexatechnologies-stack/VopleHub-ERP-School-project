import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  UserCheck,
  Plus,
  Edit,
  Trash,
  Lock,
  Unlock,
  Key,
  CheckCircle,
  XCircle,
  Search,
  Save,
  ShieldCheck,
  RefreshCw,
  School,
  Copy,
  Check
} from 'lucide-react';
import { copyToClipboard } from '../../utils/clipboard';
import { getStoredAuthenticatedUser } from '../../utils/auth';
import { store } from '../../store';
import { schoolApi } from '../../store/api/schoolApi';
import { authApi } from '../../store/api/authApi';
import { ListPagination } from '../common/QueryStates';

export interface AdminRecord {
  id: string;
  name: string;
  email: string;
  schoolId: string; // Primordial school
  status: 'Active' | 'Inactive';
  locked?: boolean;
}

interface SchoolOption {
  id: string;
  name: string;
  isDemo: boolean;
}

interface AccountDirectoryItem {
  id: number;
  name: string;
  email: string;
  role: string;
  schoolId?: string;
  isActive?: boolean;
}

const toAdminRecord = (account: AccountDirectoryItem): AdminRecord => ({
  id: String(account.id),
  name: account.name,
  email: account.email,
  schoolId: account.schoolId || '',
  status: account.isActive === false ? 'Inactive' : 'Active',
  locked: false,
});

export default function SuperAdminAdmins() {
  const [admins, setAdmins] = useState<AdminRecord[]>([]);
  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [directoryTotal, setDirectoryTotal] = useState(0);
  const [schoolFilter, setSchoolFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [ordering, setOrdering] = useState('email');
  
  const [isAdding, setIsAdding] = useState(false);
  
  // Password change states
  const [changingPasswordId, setChangingPasswordId] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<AdminRecord | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [createdAdminCredentials, setCreatedAdminCredentials] = useState<{ name: string; email: string; password: string } | null>(null);
  const [copiedAdminCredentials, setCopiedAdminCredentials] = useState(false);
  const [schoolLoadError, setSchoolLoadError] = useState('');

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    schoolId: '',
    status: 'Active' as 'Active' | 'Inactive'
  });
  const isServerBacked = Boolean(getStoredAuthenticatedUser());

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (isServerBacked) {
      Promise.all([
        store.dispatch(schoolApi.endpoints.getSchools.initiate()).unwrap(),
        store.dispatch(authApi.endpoints.getUsersPage.initiate({
          page, page_size: 50, role: 'school_admin', search: debouncedSearch || undefined,
          school_id: schoolFilter === 'all' ? undefined : schoolFilter,
          is_active: statusFilter === 'all' ? undefined : statusFilter === 'active', ordering,
        }, { forceRefetch: true, subscribe: false })).unwrap(),
      ])
        .then(([items, accountPage]) => {
          const serverSchools = items.map((school) => ({ id: String(school.id), name: school.schoolName, isDemo: Boolean(school.isDemo) }));
          const realSchools = serverSchools.filter((school) => !school.isDemo);
          setSchools(serverSchools);
          setAdmins(accountPage.results.map(toAdminRecord));
          setDirectoryTotal(accountPage.count);
          setForm((current) => current.schoolId ? current : { ...current, schoolId: realSchools[0]?.id || '' });
          setSchoolLoadError(realSchools.length ? '' : 'No real schools are available. Create a real school before creating its administrator.');
        })
        .catch(() => {
          setSchools([]);
          setAdmins([]);
          setSchoolLoadError('Unable to load schools from the server. Refresh the page and try again.');
        });
      return;
    }
    setSchools([]);
    setAdmins([]);
    setDirectoryTotal(0);
    setSchoolLoadError('A Super Admin server session is required to manage administrators.');
  }, [isServerBacked, page, debouncedSearch, schoolFilter, statusFilter, ordering]);

  const handleToggleStatus = async (id: string) => {
    const s = admins.find(x => x.id === id);
    if (!s) return;

    const nextStatus = s.status === 'Active' ? 'Inactive' : 'Active';
    if (nextStatus === 'Inactive' && !confirm(`Deactivate access for "${s.name}"? Their account will remain visible and can be reactivated later.`)) return;
    try {
      await store.dispatch(authApi.endpoints.setSchoolAdminStatus.initiate({
        id,
        action: nextStatus === 'Active' ? 'reactivate' : 'deactivate',
      })).unwrap();
      setAdmins((current) => current.map((item) => item.id === id ? { ...item, status: nextStatus } : item));
    } catch (error) {
      alert(error instanceof Error ? `Could not update School Admin access: ${error.message}` : 'Could not update School Admin access.');
    }
  };

  const handleManualPasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changingPasswordId) return;

    const s = admins.find(x => x.id === changingPasswordId);
    if (!s) return;

    if (!isServerBacked) {
      alert('Connect to the server as a Super Admin before changing a School Admin password.');
      return;
    }
    setSavingPassword(true);
    try {
      const result = await store.dispatch(authApi.endpoints.setSchoolAdminPassword.initiate({ id: s.id })).unwrap();
      setCreatedAdminCredentials({
        name: s.name,
        email: result.loginId,
        password: result.temporaryPassword,
      });
      setChangingPasswordId(null);
    } catch (error) {
      alert(error instanceof Error ? `Could not change School Admin password: ${error.message}` : 'Could not change School Admin password.');
    } finally {
      setSavingPassword(false);
    }
  };

  const deleteAdmin = async () => {
    if (!deleteCandidate) return;
    setDeleting(true);
    try {
      await store.dispatch(authApi.endpoints.deleteSchoolAdmin.initiate({
        id: deleteCandidate.id,
        confirmation: deleteCandidate.email,
      })).unwrap();
      const remaining = admins.filter((item) => item.id !== deleteCandidate.id);
      setAdmins(remaining);
      setDeleteCandidate(null);
      setDeleteConfirmation('');
    } catch (error) {
      alert(error instanceof Error ? `Could not delete School Admin: ${error.message}` : 'Could not delete School Admin.');
    } finally {
      setDeleting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isServerBacked) {
      alert('A Super Admin server session is required before creating administrators.');
      return;
    }
    if (!form.schoolId) {
      alert('Select a school before creating a School Admin account.');
      return;
    }
    try {
      const created = await store.dispatch(authApi.endpoints.createSchoolAdmin.initiate({
        name: form.name,
        schoolId: form.schoolId,
        status: form.status,
      })).unwrap();
      setAdmins((current) => [...current, toAdminRecord(created)]);
      setCreatedAdminCredentials({
        name: created.name,
        email: created.loginCredentials?.loginId || created.email,
        password: created.loginCredentials?.temporaryPassword || '',
      });
      setIsAdding(false);
      setForm({ name: '', email: '', password: '', schoolId: schools.find((school) => !school.isDemo)?.id || '', status: 'Active' });
    } catch (error) {
      alert(error instanceof Error ? `School Admin account could not be saved: ${error.message}` : 'School Admin account could not be saved to the server.');
    }
  };

  const filteredAdmins = admins;

  return (
    <div className="space-y-6" id="sa-admins-container">
      {deleteCandidate && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-950/75 backdrop-blur-xs flex min-h-full items-center justify-center p-3 sm:p-5 animate-fade-in" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg max-h-[85vh] my-auto flex flex-col rounded-3xl bg-white p-6 shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95">
            <div className="flex-shrink-0">
              <h2 className="font-extrabold text-base text-rose-700">Permanently delete School Admin</h2>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">This deletes only <strong>{deleteCandidate.email}</strong>. The school and all student, teacher, attendance, and exam data remain unchanged.</p>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0 my-3">
              <label className="block text-xs font-bold text-slate-700">Type the School Admin email to confirm</label>
              <input autoFocus value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs" />
            </div>
            <div className="flex-shrink-0 flex justify-end gap-2 pt-2 border-t border-slate-100"><button onClick={() => { setDeleteCandidate(null); setDeleteConfirmation(''); }} disabled={deleting} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">Cancel</button><button onClick={deleteAdmin} disabled={deleteConfirmation !== deleteCandidate.email || deleting} className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">{deleting ? 'Deleting…' : 'Delete Admin'}</button></div>
          </div>
        </div>,
        document.body
      )}
      {/* Title */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-800 uppercase tracking-wide">
            School Administrators & Commissioners
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Appoint regional commissioners, manage credentials lockouts, and allocate school control bounds.</p>
        </div>

        <button
          onClick={() => {
            setForm({ name: '', email: '', password: '', schoolId: schools[0]?.id || 'sch-1', status: 'Active' });
            setIsAdding(!isAdding);
          }}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          {isAdding ? 'Cancel Commission' : 'Commission School Admin'}
        </button>
      </div>

      {/* Manual Password Dialog */}
      {createdAdminCredentials && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 shadow-sm max-w-xl">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
            <div className="flex-1">
              <h4 className="text-xs font-extrabold uppercase tracking-wide">Commissioner login credentials</h4>
              <p className="mt-1 text-[11px] text-emerald-700">Copy and share securely with {createdAdminCredentials.name}.</p>
              <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-white p-3 text-xs font-mono text-slate-800">
{`Email: ${createdAdminCredentials.email}
Password: ${createdAdminCredentials.password}`}
              </pre>
              <button
                type="button"
                onClick={async () => {
                  const text = `Email: ${createdAdminCredentials.email}\nPassword: ${createdAdminCredentials.password}`;
                  const success = await copyToClipboard(text);
                  if (success) {
                    setCopiedAdminCredentials(true);
                    setTimeout(() => setCopiedAdminCredentials(false), 2500);
                  }
                }}
                className={`mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white transition-all cursor-pointer ${
                  copiedAdminCredentials
                    ? 'bg-emerald-700 ring-2 ring-emerald-300'
                    : 'bg-emerald-600 hover:bg-emerald-700 active:scale-95'
                }`}
              >
                {copiedAdminCredentials ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-200" />
                    Copied credentials!
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy credentials
                  </>
                )}
              </button>
            </div>
            <button onClick={() => { setCreatedAdminCredentials(null); setCopiedAdminCredentials(false); }} className="text-xs font-bold text-emerald-700 hover:text-emerald-900 cursor-pointer">Dismiss</button>
          </div>
        </div>
      )}

      {changingPasswordId && (() => {
        const targetAdmin = admins.find(x => x.id === changingPasswordId);
        const targetSchool = schools.find(x => x.id === targetAdmin?.schoolId);
        return createPortal(
          <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-950/75 backdrop-blur-xs flex min-h-full items-center justify-center p-3 sm:p-5 animate-fade-in" role="dialog" aria-modal="true">
            <div className="w-full max-w-lg max-h-[85vh] my-auto flex flex-col rounded-3xl bg-white p-6 shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95">
              <div className="flex-shrink-0 flex items-start gap-3 border-b border-slate-100 pb-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 border border-amber-100">
                  <Key className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-sm">Reset School Admin Password</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Generate a one-time password for <strong className="text-slate-800">{targetAdmin?.name}</strong> ({targetAdmin?.email}).
                  </p>
                  {targetSchool && (
                    <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-slate-600">
                      <School className="w-3 h-3 text-slate-400" /> {targetSchool.name}
                    </span>
                  )}
                </div>
              </div>

              <form onSubmit={handleManualPasswordChange} className="flex-1 flex flex-col min-h-0 mt-3">
                <div className="flex-1 overflow-y-auto space-y-3.5 pr-1 py-1">
                  <p className="text-xs text-slate-600 bg-amber-50/80 border border-amber-200/70 rounded-xl p-3 leading-relaxed">
                    The new password will be shown once after reset. The administrator must change it at sign-in, and their existing refresh tokens will be revoked.
                  </p>
                </div>

                <div className="flex-shrink-0 flex items-center justify-end gap-2 pt-3 border-t border-slate-100 mt-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setChangingPasswordId(null)}
                      disabled={savingPassword}
                      className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-xs font-bold transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={savingPassword}
                      className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-xs disabled:opacity-50 transition-colors"
                    >
                      {savingPassword ? 'Resetting…' : 'Generate One-Time Password'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>,
          document.body
        );
      })()}

      {/* Delete Confirmation Modal */}
      {deleteCandidate && typeof document !== 'undefined' && createPortal(
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
                Are you sure you want to permanently delete administrator <strong className="font-bold text-slate-900">{deleteCandidate.name}</strong>?
              </p>
              <div className="text-[11px] font-mono text-slate-700 bg-white/80 p-2.5 rounded-lg border border-rose-100/60 space-y-1">
                <div><span className="text-slate-400">Email:</span> <span className="font-bold">{deleteCandidate.email}</span></div>
                <div><span className="text-slate-400">Branch:</span> <span className="font-bold">{schools.find(s => s.id === deleteCandidate.schoolId)?.name || 'Branch Office'}</span></div>
              </div>
              <p className="text-[11px] text-rose-700 font-medium">
                ⚠️ This will immediately revoke their administrative clearance and permanently erase this administrator record from the database.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => { setDeleteCandidate(null); setDeleteConfirmation(''); }}
                disabled={deleting}
                className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={deleteAdmin}
                disabled={deleting}
                className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-xs disabled:opacity-50 transition-colors cursor-pointer"
              >
                <Trash className="w-3.5 h-3.5" />
                {deleting ? 'Deleting from DB…' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Form Card */}
      {isAdding && (
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm max-w-2xl animate-fade-in" id="admin-form">
          <h3 className="font-sans font-bold text-xs uppercase tracking-wider text-slate-700 border-b border-slate-100 pb-2.5 mb-4 flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-indigo-500" />
            Commission New School Administrator
          </h3>
          <form onSubmit={handleSave} className="space-y-4">
            {schoolLoadError && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{schoolLoadError}</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Officer Full Name</label>
                <input
                  required
                  type="text"
                  placeholder="e.g. Dr. Ramesh Chidambaram"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full text-xs bg-slate-50 border border-slate-200 p-2.5 rounded-lg focus:outline-indigo-500 text-slate-800"
                />
              </div>
              <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-xs text-indigo-800">
                The login ID is generated automatically from this name and the selected real school.
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Primary Assigned Campus</label>
                <select
                  required
                  value={form.schoolId}
                  onChange={e => setForm({ ...form, schoolId: e.target.value })}
                  className="w-full text-xs bg-slate-50 border border-slate-200 p-2.5 rounded-lg focus:outline-indigo-500 text-slate-800 cursor-pointer font-sans"
                >
                  <option value="">-- Choose Branch --</option>
                  {schools.filter((school) => !school.isDemo).map(sch => (
                    <option key={sch.id} value={sch.id}>{sch.name}</option>
                  ))}
                </select>
              </div>
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-800">
                A strong temporary password is generated securely and shown once after creation. The School Admin must change it on first login.
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Operational Status</label>
                <select
                  value={form.status}
                  onChange={e => setForm({ ...form, status: e.target.value as 'Active' | 'Inactive' })}
                  className="w-full text-xs bg-slate-50 border border-slate-200 p-2.5 rounded-lg focus:outline-indigo-500 text-slate-800 cursor-pointer font-sans"
                >
                  <option value="Active">Active Clearance</option>
                  <option value="Inactive">Deactivated Clearance</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-3">
              <button
                type="button"
                onClick={() => {
                  setIsAdding(false);
                }}
                className="px-3 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!isServerBacked || schools.filter((school) => !school.isDemo).length === 0}
                className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-xs font-semibold shadow-xs"
              >
                <Save className="w-3.5 h-3.5" />
                Commission Officer
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
        <input
          type="text"
          placeholder="Filter officers by name or credentials identifier..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full text-xs bg-white border border-slate-200 pl-10 pr-4 py-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-800 shadow-xs"
        />
      </div>

      {isServerBacked && <div className="grid gap-2 sm:grid-cols-3">
        <select aria-label="Filter admins by school" value={schoolFilter} onChange={(event) => { setSchoolFilter(event.target.value); setPage(1); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
          <option value="all">All schools</option>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
        </select>
        <select aria-label="Filter admins by status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as typeof statusFilter); setPage(1); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
          <option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
        </select>
        <select aria-label="Sort admins" value={ordering} onChange={(event) => { setOrdering(event.target.value); setPage(1); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
          <option value="email">Email A–Z</option><option value="-email">Email Z–A</option><option value="name">Name A–Z</option><option value="-name">Name Z–A</option><option value="created_at">Oldest created</option><option value="-created_at">Newest created</option>
        </select>
      </div>}

      {/* Administrators Registry Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden" id="sa-admins-list-table">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
              <th className="p-3.5 pl-5">Officer Name</th>
              <th className="p-3.5">Email / Login ID</th>
              <th className="p-3.5">Allocated Branch</th>
              <th className="p-3.5">Status</th>
              <th className="p-3.5">Security Gate</th>
              <th className="p-3.5 text-right pr-5">Clearance Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs text-slate-700 font-sans">
            {filteredAdmins.map(adm => {
              const bBranch = schools.find(x => x.id === adm.schoolId);
              return (
                <tr key={adm.id} className={`hover:bg-slate-50/50 ${adm.status === 'Inactive' ? 'bg-slate-50 text-slate-400 opacity-70' : adm.locked ? 'bg-rose-50/30' : ''}`}>
                  <td className="p-3.5 pl-5">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 bg-indigo-100 text-indigo-700 font-bold rounded-full flex items-center justify-center text-xs">
                        {adm.name.charAt(0)}
                      </div>
                      <div>
                        <span className="font-bold text-slate-900">{adm.name}</span>
                        {adm.locked && (
                          <span className="text-[8px] bg-rose-500 text-white px-1.5 py-0.2 rounded-md font-bold uppercase tracking-wide block w-fit mt-0.5">
                            LOCKED OUT
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="p-3.5 font-mono text-[11px] text-slate-600">{adm.email}</td>
                  <td className="p-3.5">
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700">
                      <School className="w-3.5 h-3.5 text-slate-400" />
                      {bBranch ? bBranch.name : 'All Campuses (SAD)'}
                    </span>
                  </td>
                  <td className="p-3.5">
                    <span
                      className={`inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                        adm.status === 'Active'
                          ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                          : 'bg-rose-50 text-rose-500 border-rose-100'
                      }`}
                    >
                      {adm.status}
                    </span>
                  </td>
                  <td className="p-3.5">
                    <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
                      SCHOOL_ADMIN
                    </span>
                  </td>
                  <td className="p-3.5 text-right pr-5">
                    <div className="flex items-center justify-end gap-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      {/* Update Password */}
                      <button
                        onClick={() => {
                          setChangingPasswordId(adm.id);
                        }}
                        className="text-amber-600 hover:text-amber-800 transition-colors cursor-pointer px-1 flex items-center gap-1"
                        title="Update password if lost or forgotten"
                      >
                        <Key className="w-3 h-3" />
                        Reset Password
                      </button>

                      {/* Delete Administrator */}
                      <button
                        onClick={() => {
                          setDeleteCandidate(adm);
                          setDeleteConfirmation(adm.email);
                        }}
                        className="text-rose-600 hover:text-rose-800 transition-colors cursor-pointer px-1 flex items-center gap-1"
                        title="Permanently delete administrator from database"
                      >
                        <Trash className="w-3 h-3" />
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {filteredAdmins.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-400">
                  No School Admin records match your query.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {isServerBacked && <ListPagination page={page} pageSize={50} total={directoryTotal} onPageChange={setPage} />}
      </div>
    </div>
  );
}
