import { useEffect, useState } from 'react';
import { Search, Shield, RefreshCw } from 'lucide-react';
import { useGetAdminAuditEventsQuery } from '../../store/api/adminAuditApi';
import { ListPagination } from '../common/QueryStates';

export default function SuperAdminReports() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('all');
  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedSearch(search.trim()); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const { data, isLoading, isFetching, error, refetch } = useGetAdminAuditEventsQuery({
    page, page_size: 50, search: debouncedSearch || undefined,
    action: action === 'all' ? undefined : action,
    ordering: '-created_at',
  });

  return (
    <section className="space-y-5" id="super-admin-security-audit">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold uppercase tracking-wide text-slate-800"><Shield className="h-4 w-4 text-indigo-600" /> Security audit</h2>
          <p className="mt-1 text-xs text-slate-500">Recorded administrative actions, scoped and paginated by the server.</p>
        </div>
        <button type="button" onClick={() => void refetch()} className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 sm:self-auto">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </header>

      <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_220px]">
        <label className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input aria-label="Search audit events" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search action, actor, or record" className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs" />
        </label>
        <select aria-label="Filter audit events by action" value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
          <option value="all">All actions</option>
          <option value="school_created">School created</option>
          <option value="school_updated">School updated</option>
          <option value="school_deleted">School deleted</option>
          <option value="school_admin_created">Admin created</option>
          <option value="school_admin_deactivated">Admin deactivated</option>
          <option value="school_admin_reactivated">Admin reactivated</option>
          <option value="school_admin_deleted">Admin deleted</option>
          <option value="school_admin_password_reset">Admin password reset</option>
          <option value="user_credentials_reset">User credentials reset</option>
          <option value="student_credentials_created">Student credentials created</option>
          <option value="parent_credentials_created">Parent credentials created</option>
          <option value="credential_vault_password_reset">Credential password reset</option>
          <option value="credential_vault_entry_deleted">Credential entry deleted</option>
          <option value="admin_password_changed">Admin password changed</option>
          <option value="export_requested">Export requested</option>
          <option value="export_downloaded">Export downloaded</option>
        </select>
      </div>

      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">Could not load security audit events.</div>}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {isLoading ? <p className="p-6 text-sm text-slate-500">Loading audit events…</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-3">Time</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Actor</th><th className="px-4 py-3">School</th><th className="px-4 py-3">Record</th><th className="px-4 py-3">Source IP</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.results || []).map((event) => (
                  <tr key={event.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{new Date(event.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{event.action.replaceAll('_', ' ')}</td>
                    <td className="px-4 py-3 text-slate-700">{event.actor_name || `Account ${event.actor_id ?? 'removed'}`}</td>
                    <td className="px-4 py-3 text-slate-600">{event.school_name || (typeof event.metadata.school_code === 'string' ? event.metadata.school_code : 'Platform')}</td>
                    <td className="px-4 py-3 font-mono text-slate-500">{event.object_type ? `${event.object_type} #${event.object_id}` : '—'}</td>
                    <td className="px-4 py-3 font-mono text-slate-500">{event.remote_addr || '—'}</td>
                  </tr>
                ))}
                {!data?.results.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No audit events match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <ListPagination page={page} pageSize={50} total={data?.count || 0} onPageChange={setPage} />
      </div>
    </section>
  );
}
