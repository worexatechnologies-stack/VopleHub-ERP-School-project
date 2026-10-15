import { FormEvent, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, Plus, Power, Save, School, Trash2, XCircle } from 'lucide-react';
import {
  useGetSchoolsQuery,
  useCreateSchoolMutation,
  useUpdateSchoolMutation,
  useDeleteSchoolMutation,
  type SchoolRecord,
} from '../../store/api/schoolApi';
import { getErrorMessage } from '../../utils/apiError';
import { ACCESS_TOKEN_STORAGE_KEY } from '../../utils/auth';
import AuthenticatedImage from '../AuthenticatedImage';
import { formatBytes, optimizeImageForUpload } from '../../services/imageOptimizer';

const normalizeCode = (value: string) => value
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

export default function SuperAdminSchools() {
  const tokenExists = Boolean(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY));
  const { data: rawSchools = [], isLoading, error: queryError } = useGetSchoolsQuery(undefined, {
    skip: !tokenExists,
  });
  const [createSchoolMutation] = useCreateSchoolMutation();
  const [updateSchoolMutation] = useUpdateSchoolMutation();
  const [deleteSchoolMutation] = useDeleteSchoolMutation();

  const [isAdding, setIsAdding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const [logoPreview, setLogoPreview] = useState('');
  const [logoSummary, setLogoSummary] = useState('');
  const [form, setForm] = useState({
    schoolName: '',
    code: '',
    subdomain: '',
    logoIcon: 'School',
    logoFile: null as File | null,
    primaryColor: '#6366f1',
    secondaryColor: '#10b981',
    isActive: true,
  });

  const error = !tokenExists
    ? 'Sign in as a Super Admin to manage real schools.'
    : (actionError || (queryError ? getErrorMessage(queryError, 'Could not load schools.') : ''));

  const schools = useMemo(() => {
    return [...rawSchools].sort((a, b) => a.schoolName.localeCompare(b.schoolName));
  }, [rawSchools]);

  const handleNameChange = (name: string) => {
    const code = normalizeCode(name);
    setForm((prev) => ({
      ...prev,
      schoolName: name,
      code: prev.code || code,
      subdomain: prev.subdomain || code,
    }));
  };

  const createSchool = async (event: FormEvent) => {
    event.preventDefault();
    const code = normalizeCode(form.code);
    const subdomain = normalizeCode(form.subdomain || code);
    if (!form.schoolName.trim() || !code) {
      setActionError('School name and a valid school code are required.');
      return;
    }

    const duplicate = schools.find((s) =>
      s.code.toLowerCase() === code.toLowerCase() ||
      (s.subdomain && s.subdomain.toLowerCase() === subdomain.toLowerCase()) ||
      s.schoolName.toLowerCase() === form.schoolName.trim().toLowerCase()
    );
    if (duplicate) {
      setActionError(`A school with this name, code, or subdomain ("${duplicate.schoolName}") already exists. Please use a unique school name, code, or subdomain.`);
      return;
    }

    setIsSaving(true);
    setActionError('');
    try {
      const body = new FormData();
      body.append('schoolName', form.schoolName.trim());
      body.append('code', code);
      body.append('subdomain', subdomain);
      body.append('logoIcon', form.logoIcon || 'School');
      body.append('primaryColor', form.primaryColor || '#6366f1');
      body.append('secondaryColor', form.secondaryColor || '#10b981');
      body.append('theme', 'glass-academy');
      body.append('is_active', String(form.isActive));
      if (form.logoFile) body.append('logoFile', form.logoFile);
      await createSchoolMutation(body).unwrap();
      setForm({
        schoolName: '',
        code: '',
        subdomain: '',
        logoIcon: 'School',
        logoFile: null,
        primaryColor: '#6366f1',
        secondaryColor: '#10b981',
        isActive: true,
      });
      setLogoPreview('');
      setLogoSummary('');
      setIsAdding(false);
    } catch (requestError) {
      setActionError(getErrorMessage(requestError, 'Could not create the school.'));
    } finally {
      setIsSaving(false);
    }
  };

  const setSchoolActive = async (school: SchoolRecord) => {
    setActionError('');
    const nextActive = !school.is_active;
    try {
      await updateSchoolMutation({
        id: school.id,
        body: { is_active: nextActive },
      }).unwrap();

      // Sync localStorage caches if present
      const savedAdm = localStorage.getItem('sa_admins');
      if (savedAdm) {
        try {
          const parsed = JSON.parse(savedAdm);
          const updatedAdm = parsed.map((adm: any) =>
            adm.schoolId === String(school.id) ? { ...adm, status: nextActive ? 'Active' : 'Inactive' } : adm
          );
          localStorage.setItem('sa_admins', JSON.stringify(updatedAdm));
        } catch {}
      }
      const savedUsers = localStorage.getItem('sa_users');
      if (savedUsers) {
        try {
          const parsedUsers = JSON.parse(savedUsers);
          const updatedUsers = parsedUsers.map((u: any) =>
            u.schoolId === String(school.id) ? { ...u, status: nextActive ? 'Active' : 'Inactive' } : u
          );
          localStorage.setItem('sa_users', JSON.stringify(updatedUsers));
        } catch {}
      }
    } catch (requestError) {
      setActionError(getErrorMessage(requestError, 'Could not update the school.'));
    }
  };

  const deleteSchool = async (school: SchoolRecord) => {
    const confirmation = window.prompt(
      `This permanently deletes ${school.schoolName}, its users, students, staff, documents, attendance, exams, and related records.\n\nType the school code exactly to continue: ${school.code}`,
    );
    if (confirmation === null) return;
    if (confirmation !== school.code) {
      setActionError(`School was not deleted. Type the exact code "${school.code}" to confirm.`);
      return;
    }

    setActionError('');
    try {
      await deleteSchoolMutation({
        id: school.id,
        confirmation,
      }).unwrap();

      // Clean up deleted school's admins and users in localStorage caches if present
      const savedAdm = localStorage.getItem('sa_admins');
      if (savedAdm) {
        try {
          const parsed = JSON.parse(savedAdm);
          const filtered = parsed.filter((adm: any) => adm.schoolId !== String(school.id));
          localStorage.setItem('sa_admins', JSON.stringify(filtered));
        } catch {}
      }
      const savedUsers = localStorage.getItem('sa_users');
      if (savedUsers) {
        try {
          const parsedUsers = JSON.parse(savedUsers);
          const filteredUsers = parsedUsers.filter((u: any) => u.schoolId !== String(school.id));
          localStorage.setItem('sa_users', JSON.stringify(filteredUsers));
        } catch {}
      }
      const savedSchools = localStorage.getItem('sa_schools');
      if (savedSchools) {
        try {
          const parsedSchools = JSON.parse(savedSchools);
          const filteredSchools = parsedSchools.filter((s: any) => s.id !== String(school.id) && s.id !== school.id);
          localStorage.setItem('sa_schools', JSON.stringify(filteredSchools));
        } catch {}
      }
    } catch (requestError) {
      setActionError(getErrorMessage(requestError, 'Could not permanently delete the school.'));
    }
  };

  return (
    <div className="space-y-6" id="sa-schools-container">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-bold uppercase tracking-wide text-slate-800">School Directory</h2>
          <p className="mt-0.5 text-xs text-slate-500">Create and manage database-backed schools with custom subdomains and branding.</p>
        </div>
        <button
          onClick={() => setIsAdding((value) => !value)}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" />
          {isAdding ? 'Cancel' : 'Create Real School'}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {isAdding && (
        <form onSubmit={createSchool} className="max-w-2xl space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3 text-xs font-bold uppercase tracking-wider text-slate-700">
            <School className="h-4 w-4 text-indigo-500" /> New real school
          </div>
          <p className="text-xs text-slate-500">Create a real school tenant with its own dedicated subdomain, logo, and branding.</p>
          
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-[10px] font-bold uppercase text-slate-400 sm:col-span-2">
              School name *
              <input required value={form.schoolName} onChange={(event) => handleNameChange(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs normal-case text-slate-800" placeholder="Srichaitanya Children Academy" />
            </label>

            <label className="space-y-1 text-[10px] font-bold uppercase text-slate-400">
              School code *
              <input required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs normal-case text-slate-800" placeholder="srichaitanya-academy" />
            </label>

            <label className="space-y-1 text-[10px] font-bold uppercase text-slate-400">
              Subdomain (URL Slug)
              <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1">
                <input value={form.subdomain} onChange={(event) => setForm({ ...form, subdomain: event.target.value })} className="w-full bg-transparent text-xs normal-case text-slate-800 outline-none" placeholder="srichaitanya" />
                <span className="text-[10px] font-semibold text-slate-400">.volpehub.education</span>
              </div>
            </label>

            <label className="space-y-1 text-[10px] font-bold uppercase text-slate-400">
              Logo Icon
              <select value={form.logoIcon} onChange={(event) => setForm({ ...form, logoIcon: event.target.value })} className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs normal-case text-slate-800">
                <option value="School">School Building</option>
                <option value="GraduationCap">Graduation Cap</option>
                <option value="Building2">Academy Campus</option>
                <option value="BookOpen">Open Book</option>
                <option value="Globe">Global International</option>
              </select>
            </label>

            <label className="space-y-1 text-[10px] font-bold uppercase text-slate-400">
              Logo image (Optional)
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => {
                const file = event.target.files?.[0] || null;
                if (!file) { setForm({ ...form, logoFile: null }); setLogoPreview(''); setLogoSummary(''); return; }
                try {
                  const optimized = await optimizeImageForUpload(file);
                  setForm({ ...form, logoFile: optimized.file });
                  setLogoPreview(optimized.previewUrl);
                  setLogoSummary(`${optimized.width}×${optimized.height} WebP · ${formatBytes(optimized.originalBytes)} → ${formatBytes(optimized.optimizedBytes)}`);
                } catch (requestError) {
                  setActionError(requestError instanceof Error ? requestError.message : 'Logo optimization failed.');
                  event.target.value = '';
                }
              }} className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs normal-case text-slate-800" />
              {logoPreview && <img src={logoPreview} alt="Logo preview" className="mt-2 h-12 w-12 rounded-lg border border-slate-200 object-contain" />}
            </label>

            <label className="space-y-1 text-[10px] font-bold uppercase text-slate-400">
              Primary Brand Color
              <div className="flex items-center gap-2">
                <input type="color" value={form.primaryColor} onChange={(event) => setForm({ ...form, primaryColor: event.target.value })} className="h-9 w-12 cursor-pointer rounded border border-slate-200 p-0.5" />
                <input value={form.primaryColor} onChange={(event) => setForm({ ...form, primaryColor: event.target.value })} className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs font-mono normal-case text-slate-800" />
              </div>
            </label>

            <label className="space-y-1 text-[10px] font-bold uppercase text-slate-400">
              Secondary Accent Color
              <div className="flex items-center gap-2">
                <input type="color" value={form.secondaryColor} onChange={(event) => setForm({ ...form, secondaryColor: event.target.value })} className="h-9 w-12 cursor-pointer rounded border border-slate-200 p-0.5" />
                <input value={form.secondaryColor} onChange={(event) => setForm({ ...form, secondaryColor: event.target.value })} className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs font-mono normal-case text-slate-800" />
              </div>
            </label>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} /> Start this school as active
          </label>
          
          <div className="flex justify-end">
            <button disabled={isSaving} className="flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60">
              <Save className="h-3.5 w-3.5" /> {isSaving ? 'Creating…' : 'Create Real School'}
            </button>
          </div>
        </form>
      )}

      {isLoading ? <p className="text-sm text-slate-500">Loading schools…</p> : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {schools.map((school) => (
            <article key={school.id} className={`rounded-xl border bg-white p-5 shadow-xs ${school.is_active ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  {school.logoImageUrl ? (
                    <AuthenticatedImage src={school.logoImageUrl} alt={school.schoolName} className="h-10 w-10 rounded-lg object-contain border border-slate-100" />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100">
                      <School className="h-5 w-5" />
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-600">{school.code}</span>
                      {school.subdomain && (
                        <span className="rounded-md border border-indigo-100 bg-indigo-50 px-2 py-0.5 font-mono text-[10px] font-bold text-indigo-700">
                          {school.subdomain}.volpehub.education
                        </span>
                      )}
                    </div>
                    <h3 className="mt-2 text-sm font-bold text-slate-900">{school.schoolName}</h3>
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${school.isDemo ? 'border-amber-100 bg-amber-50 text-amber-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`}>
                  {school.isDemo ? 'Demo data' : 'Real school'}
                </span>
              </div>
              <div className="mt-5 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                <span className={`flex items-center gap-1 text-xs font-semibold ${school.is_active ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {school.is_active ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                  {school.is_active ? 'Active' : 'Inactive'}
                </span>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => void setSchoolActive(school)} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50">
                    <Power className="h-3 w-3" /> {school.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button onClick={() => void deleteSchool(school)} className="flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-50" title="Permanently delete this school and its data">
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
          {!schools.length && !error && <p className="col-span-full rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No schools exist yet. Create the first real school above.</p>}
        </div>
      )}
    </div>
  );
}
