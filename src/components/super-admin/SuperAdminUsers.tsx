import React, { useState, useEffect } from 'react';
import {
  Users,
  Search,
  Edit,
  Trash,
  Lock,
  Unlock,
  Key,
  CheckCircle,
  XCircle,
  Plus,
  Save,
  Check,
  ShieldAlert,
  School
} from 'lucide-react';
import { ACCESS_TOKEN_STORAGE_KEY, PRESET_ACCOUNTS, SUPER_ADMIN_EMAIL, SUPER_ADMIN_NAME, decodeJWT } from '../../utils/auth';
import { UserRole } from '../../types';
import { store } from '../../store';
import { authApi } from '../../store/api/authApi';

interface UserRecord {
  email: string;
  password?: string;
  name: string;
  role: UserRole;
  schoolId?: string;
  studentId?: string;
  status?: string;
  locked?: boolean;
  forceReset?: boolean;
}

export default function SuperAdminUsers() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [schools, setSchools] = useState<{ id: string; name: string }[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('All');
  
  const [isAdding, setIsAdding] = useState(false);
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [changingPassEmail, setChangingPassEmail] = useState<string | null>(null);
  const [overridePassword, setOverridePassword] = useState('');

  const [form, setForm] = useState({
    name: '',
    email: '',
    role: 'Teacher' as UserRole,
    schoolId: '',
    status: 'Active',
    locked: false
  });

  useEffect(() => {
    const token = localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
    if (token) {
      store.dispatch(authApi.endpoints.getUsers.initiate()).unwrap()
        .then((accounts) => {
          const roleMap: Record<string, UserRole> = {
            super_admin: 'Super Admin', school_admin: 'School Admin', teacher: 'Teacher',
            parent: 'Parent', student: 'Student', public_learner: 'Public Learner',
          };
          setUsers(accounts.reduce<UserRecord[]>((result, account) => {
            const role = roleMap[account.role];
            if (role) result.push({
              email: account.email, name: account.name, role,
              schoolId: account.schoolId, status: 'Active', locked: false,
            });
            return result;
          }, []));
        })
        .catch(() => setUsers([]));
      return;
    }
    // Load users from localStorage sa_users
    const savedUsers = localStorage.getItem('sa_users');
    if (savedUsers) {
      setUsers(JSON.parse(savedUsers));
    } else {
      const seeded = PRESET_ACCOUNTS.map(u => ({
        ...u,
        status: 'Active',
        locked: false,
        forceReset: false
      }));
      localStorage.setItem('sa_users', JSON.stringify(seeded));
      setUsers(seeded);
    }

    // Load schools for display names
    const savedSch = localStorage.getItem('sa_schools');
    if (savedSch) {
      const parsed = JSON.parse(savedSch);
      setSchools(Array.isArray(parsed) ? parsed.filter((school: any) => !['sch-1', 'sch-2', 'sch-3'].includes(school.id)) : []);
    } else {
      setSchools([]);
    }
  }, []);

  const saveUsers = (list: UserRecord[]) => {
    localStorage.setItem('sa_users', JSON.stringify(list));
    setUsers(list);

    // If there is any School Admin change, synchronize with sa_admins as well
    const adminClearances = list.filter(u => u.role === 'School Admin');
    const syncedAdmins = adminClearances.map(ac => ({
      id: `adm-${ac.email.replace(/[@.]/g, '')}`,
      name: ac.name,
      email: ac.email,
      schoolId: ac.schoolId || '',
      status: (ac.status === 'Active' ? 'Active' : 'Inactive') as 'Active' | 'Inactive',
      locked: ac.locked || false
    }));
    localStorage.setItem('sa_admins', JSON.stringify(syncedAdmins));
  };

  const addAuditLog = (action: string) => {
    const token = localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
    let operatorName = SUPER_ADMIN_NAME;
    if (token) {
      try {
        const decoded = decodeJWT(token);
        if (decoded) operatorName = decoded.name;
      } catch (e) {}
    }
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

  const handleToggleLock = (email: string) => {
    const u = users.find(x => x.email.toLowerCase() === email.toLowerCase());
    if (!u) return;

    const nextLocked = !u.locked;
    const updated = users.map(item => {
      if (item.email.toLowerCase() === email.toLowerCase()) {
        return { ...item, locked: nextLocked };
      }
      return item;
    });

    addAuditLog(`${nextLocked ? 'Locked' : 'Unlocked'} account credentials for user: ${u.name} (${u.email})`);
    saveUsers(updated);
  };

  const handleToggleStatus = (email: string) => {
    const u = users.find(x => x.email.toLowerCase() === email.toLowerCase());
    if (!u) return;

    const nextStatus = u.status === 'Active' ? 'Inactive' : 'Active';
    const updated = users.map(item => {
      if (item.email.toLowerCase() === email.toLowerCase()) {
        return { ...item, status: nextStatus };
      }
      return item;
    });

    addAuditLog(`Toggled status for user account ${u.name} (${u.email}) to ${nextStatus}`);
    saveUsers(updated);
  };

  const handleDelete = (email: string) => {
    const u = users.find(x => x.email.toLowerCase() === email.toLowerCase());
    if (!u) return;

    if (u.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) {
      alert('SECURITY BLOCK:\n\nFor safety, the bootstrap Super Admin account cannot be deleted from this screen.');
      return;
    }

    if (confirm(`PERMANENT DELETION:\n\nAre you sure you want to completely erase credentials and logs for user "${u.name}" (${u.email})?\n\nThey will lose access immediately.`)) {
      const updated = users.filter(item => item.email.toLowerCase() !== email.toLowerCase());
      addAuditLog(`Permanently deleted credentials for user: ${u.name} (${u.email})`);
      saveUsers(updated);
    }
  };

  const handleForcePasswordReset = (email: string) => {
    const u = users.find(x => x.email.toLowerCase() === email.toLowerCase());
    if (!u) return;

    const updated = users.map(item => {
      if (item.email.toLowerCase() === email.toLowerCase()) {
        return { ...item, forceReset: true };
      }
      return item;
    });

    addAuditLog(`Flagged account ${u.name} (${u.email}) for "Force Password Reset" policies.`);
    saveUsers(updated);
    alert(`POLICY FORCE SUCCESS:\n\nUser ${u.name} has been flagged. On their next sign-in, they will receive a security notification to reset their password!`);
  };

  const handleSavePasswordOverride = (e: React.FormEvent) => {
    e.preventDefault();
    if (!changingPassEmail || !overridePassword) return;

    const u = users.find(x => x.email.toLowerCase() === changingPassEmail.toLowerCase());
    if (!u) return;

    const updated = users.map(item => {
      if (item.email.toLowerCase() === changingPassEmail.toLowerCase()) {
        return { ...item, password: overridePassword };
      }
      return item;
    });

    addAuditLog(`Manually overrode password credentials for account: ${u.name} (${u.email})`);
    saveUsers(updated);
    alert(`SUCCESS:\n\nPassword changed successfully for user "${u.name}".`);
    setChangingPassEmail(null);
    setOverridePassword('');
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    if (editingEmail) {
      // Edit User Details
      const updated = users.map(item => {
        if (item.email.toLowerCase() === editingEmail.toLowerCase()) {
          return {
            ...item,
            name: form.name,
            role: form.role,
            schoolId: form.schoolId || undefined,
            status: form.status,
            locked: form.locked
          };
        }
        return item;
      });

      addAuditLog(`Edited profile particulars for user: ${form.name} (${editingEmail})`);
      saveUsers(updated);
      setEditingEmail(null);
    } else {
      // Create New User
      const exists = users.some(x => x.email.toLowerCase() === form.email.toLowerCase());
      if (exists) {
        alert('VALIDATION ERROR:\n\nThis email ID is already registered in the central system directory!');
        return;
      }

      // Create permissions based on roles
      let perms: string[] = [];
      if (form.role === 'Teacher') perms = ['view_students', 'mark_attendance', 'manage_lessons', 'submit_grades', 'chat_parents'];
      else if (form.role === 'Parent') perms = ['view_child_records', 'pay_fees', 'view_report_cards', 'chat_teachers'];
      else if (form.role === 'Student') perms = ['view_schedules', 'access_lms', 'take_quizzes', 'view_my_grades'];
      else perms = ['view_schedules'];

      const newUser: UserRecord = {
        email: form.email,
        password: 'ChangeMe123!',
        name: form.name,
        role: form.role,
        schoolId: form.schoolId || (schools[0]?.id || 'sch-1'),
        status: form.status,
        locked: form.locked,
        forceReset: false
      };

      const updated = [...users, newUser];
      addAuditLog(`Created credentials for new ${form.role}: ${form.name} (${form.email})`);
      saveUsers(updated);
      setIsAdding(false);
      alert(`Success: Account created for ${form.name}. Temporary password set to "ChangeMe123!".`);
    }

    // Reset Form
    setForm({
      name: '',
      email: '',
      role: 'Teacher',
      schoolId: schools[0]?.id || 'sch-1',
      status: 'Active',
      locked: false
    });
  };

  const startEdit = (user: UserRecord) => {
    setEditingEmail(user.email);
    setForm({
      name: user.name,
      email: user.email,
      role: user.role,
      schoolId: user.schoolId || '',
      status: user.status || 'Active',
      locked: user.locked || false
    });
    setIsAdding(true);
  };

  // Filter list
  const filteredUsers = users.filter(u => {
    const matchQuery =
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.role.toLowerCase().includes(searchQuery.toLowerCase());
    
    if (roleFilter === 'All') return matchQuery;
    return matchQuery && u.role === roleFilter;
  });

  return (
    <div className="space-y-6" id="sa-users-container">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-800 uppercase tracking-wide">
            Universal Users & RBAC Directory
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Unified catalog of all system logins. Maintain passwords, unlock profiles, and assign role-based access.</p>
        </div>

        <button
          onClick={() => {
            setEditingEmail(null);
            setForm({ name: '', email: '', role: 'Teacher', schoolId: schools[0]?.id || 'sch-1', status: 'Active', locked: false });
            setIsAdding(!isAdding);
          }}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          {isAdding ? 'Cancel Account Creation' : 'Create New User Account'}
        </button>
      </div>

      {/* Override Password Dialogue */}
      {changingPassEmail && (
        <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 shadow-sm max-w-md space-y-3">
          <div className="flex items-start gap-2.5">
            <Key className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-sans font-bold text-xs text-amber-800">Manual Password Override</h4>
              <p className="text-[10px] text-amber-600 mt-0.5">Force a manual password change for credentials key: {changingPassEmail}</p>
            </div>
          </div>
          <form onSubmit={handleSavePasswordOverride} className="flex gap-2 items-end">
            <div className="flex-1 space-y-1">
              <label className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">Overwrite Password</label>
              <input
                required
                type="text"
                placeholder="Type new secure key..."
                value={overridePassword}
                onChange={e => setOverridePassword(e.target.value)}
                className="w-full text-xs bg-white border border-slate-200 px-3 py-1.5 rounded-lg focus:outline-indigo-500 text-slate-800"
              />
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setChangingPassEmail(null)}
                className="bg-slate-200 text-slate-600 font-bold px-2.5 py-1.5 rounded-lg text-xs hover:bg-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="bg-indigo-600 text-white font-bold px-3 py-1.5 rounded-lg text-xs hover:bg-indigo-700 shadow-2xs"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Creation / Editing Form */}
      {isAdding && (
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm max-w-2xl animate-fade-in" id="user-creation-form">
          <h3 className="font-sans font-bold text-xs uppercase tracking-wider text-slate-700 border-b border-slate-100 pb-2.5 mb-4 flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-500" />
            {editingEmail ? `Edit Profile particulars for: ${editingEmail}` : 'Register New User Credentials'}
          </h3>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Full Legal Name</label>
                <input
                  required
                  type="text"
                  placeholder="e.g. Anand Mahindra"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full text-xs bg-slate-50 border border-slate-200 p-2.5 rounded-lg focus:outline-indigo-500 text-slate-800"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Active Login Email</label>
                <input
                  required
                  type="email"
                  placeholder="e.g. anand@mahindra.edu"
                  value={form.email}
                  disabled={editingEmail !== null}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  className="w-full text-xs bg-slate-50 border border-slate-200 p-2.5 rounded-lg focus:outline-indigo-500 text-slate-800 font-mono disabled:opacity-60"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase">System Clearance Role</label>
                <select
                  value={form.role}
                  onChange={e => setForm({ ...form, role: e.target.value as UserRole })}
                  className="w-full text-xs bg-slate-50 border border-slate-200 p-2.5 rounded-lg focus:outline-indigo-500 text-slate-800 cursor-pointer font-sans"
                >
                  <option value="Super Admin">Super Admin</option>
                  <option value="School Admin">School Admin</option>
                  <option value="Teacher">Teacher</option>
                  <option value="Parent">Parent</option>
                  <option value="Student">Student</option>
                  <option value="Accountant">Accountant</option>
                  <option value="Librarian">Librarian</option>
                  <option value="Transport Manager">Transport Manager</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Branch Host School</label>
                <select
                  value={form.schoolId}
                  onChange={e => setForm({ ...form, schoolId: e.target.value })}
                  className="w-full text-xs bg-slate-50 border border-slate-200 p-2.5 rounded-lg focus:outline-indigo-500 text-slate-800 cursor-pointer font-sans"
                >
                  <option value="">-- No Branch Assignment --</option>
                  {schools.map(sch => (
                    <option key={sch.id} value={sch.id}>{sch.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Status & Lockout</label>
                <select
                  value={form.status}
                  onChange={e => setForm({ ...form, status: e.target.value })}
                  className="w-full text-xs bg-slate-50 border border-slate-200 p-2.5 rounded-lg focus:outline-indigo-500 text-slate-800 cursor-pointer font-sans"
                >
                  <option value="Active">Active Account</option>
                  <option value="Inactive">Deactivated Account</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="form-locked"
                checked={form.locked}
                onChange={e => setForm({ ...form, locked: e.target.checked })}
                className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
              />
              <label htmlFor="form-locked" className="text-xs text-slate-600 font-bold uppercase tracking-wider select-none cursor-pointer">
                Lock this account credentials (prevent login access)
              </label>
            </div>

            <div className="flex justify-end gap-2.5 pt-3">
              <button
                type="button"
                onClick={() => {
                  setIsAdding(false);
                  setEditingEmail(null);
                }}
                className="px-3 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-lg text-xs font-semibold shadow-xs"
              >
                <Save className="w-3.5 h-3.5" />
                {editingEmail ? 'Save Changes' : 'Register Account'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search credentials across directories..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full text-xs bg-white border border-slate-200 pl-10 pr-4 py-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-800 shadow-xs"
          />
        </div>

        <div className="flex gap-2">
          {['All', 'Super Admin', 'School Admin', 'Teacher', 'Parent', 'Student'].map(role => (
            <button
              key={role}
              onClick={() => setRoleFilter(role)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                roleFilter === role
                  ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs'
                  : 'bg-white border-slate-200 text-slate-500 hover:text-slate-800'
              }`}
            >
              {role.split(' ')[0]}s
            </button>
          ))}
        </div>
      </div>

      {/* Table list */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden" id="universal-users-table">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
              <th className="p-3 pl-5">Person</th>
              <th className="p-3">Email credentials ID</th>
              <th className="p-3">Role perspective</th>
              <th className="p-3">Branch assignment</th>
              <th className="p-3">Security Access</th>
              <th className="p-3 text-right pr-5">Control Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs text-slate-700 font-sans">
            {filteredUsers.map(u => {
              const bBranch = schools.find(x => x.id === u.schoolId);
              return (
                <tr key={u.email} className={`hover:bg-slate-50/50 ${u.locked ? 'bg-rose-50/30' : ''}`}>
                  <td className="p-3 pl-5">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 bg-indigo-50 text-indigo-700 font-bold rounded-full flex items-center justify-center text-[10px] border border-indigo-100">
                        {u.name.charAt(0)}
                      </div>
                      <div>
                        <span className="font-bold text-slate-900">{u.name}</span>
                        {u.locked && (
                          <span className="text-[8px] bg-rose-500 text-white px-1 py-0.2 rounded font-bold uppercase tracking-wide block w-fit mt-0.5">
                            LOCKED OUT
                          </span>
                        )}
                        {u.forceReset && (
                          <span className="text-[8px] bg-amber-500 text-slate-950 px-1 py-0.2 rounded font-bold uppercase tracking-wide block w-fit mt-0.5">
                            FORCE RESET KEY
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="p-3 font-mono text-[11px] text-slate-600">{u.email}</td>
                  <td className="p-3">
                    <span className="inline-flex items-center gap-1 font-semibold text-indigo-600">
                      {u.role}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className="text-slate-600 font-medium">
                      {bBranch ? bBranch.name : 'Central Server Nodes'}
                    </span>
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                        u.status === 'Active'
                          ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                          : 'bg-rose-50 text-rose-500 border-rose-100'
                      }`}
                    >
                      {u.status || 'Active'}
                    </span>
                  </td>
                  <td className="p-3 text-right pr-5">
                    <div className="flex items-center justify-end gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      <button
                        onClick={() => startEdit(u)}
                        className="text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer px-1"
                      >
                        Edit
                      </button>

                      <button
                        onClick={() => handleToggleLock(u.email)}
                        className={`transition-colors cursor-pointer px-1 flex items-center gap-0.5 ${
                          u.locked ? 'text-emerald-600 hover:text-emerald-800' : 'text-amber-600 hover:text-amber-800'
                        }`}
                        title={u.locked ? 'Unlock Account' : 'Lock Account'}
                      >
                        {u.locked ? 'Unlock' : 'Lock'}
                      </button>

                      <button
                        onClick={() => handleToggleStatus(u.email)}
                        className="text-slate-600 hover:text-slate-800 transition-colors cursor-pointer px-1"
                      >
                        {u.status === 'Active' ? 'Suspend' : 'Activate'}
                      </button>

                      <span className="text-slate-300">|</span>
                      
                      <button
                        onClick={() => handleForcePasswordReset(u.email)}
                        className="text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer px-1 animate-pulse"
                        title="Force password reset on next sign-in"
                      >
                        Force Reset
                      </button>

                      <button
                        onClick={() => setChangingPassEmail(u.email)}
                        className="text-slate-500 hover:text-slate-700 transition-colors cursor-pointer px-1"
                      >
                        Set Pass
                      </button>

                      <span className="text-slate-300">|</span>

                      <button
                        onClick={() => handleDelete(u.email)}
                        className="text-rose-500 hover:text-rose-700 transition-colors cursor-pointer px-1"
                      >
                        Wipe
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {filteredUsers.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-400">
                  No registered users match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
