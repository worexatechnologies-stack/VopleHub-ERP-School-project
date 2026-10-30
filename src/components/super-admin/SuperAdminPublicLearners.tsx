import { useEffect, useState } from 'react';
import { Search, UserRoundCheck, UserRoundX } from 'lucide-react';
import { ListPagination } from '../common/QueryStates';
import { useGetPublicLearnersQuery, useMigrateLegacyPublicLearnersMutation, useUpdatePublicLearnerStatusMutation } from '../../store/api/publicLearnerApi';

const PAGE_SIZE = 50;

export default function SuperAdminPublicLearners() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const { data, isLoading, isError } = useGetPublicLearnersQuery({
    page, page_size: PAGE_SIZE, search: debouncedSearch || undefined, status: status || undefined,
  });
  const [updateStatus, { isLoading: isUpdating }] = useUpdatePublicLearnerStatusMutation();
  const [migrateLegacy] = useMigrateLegacyPublicLearnersMutation();
  const [legacyMessage, setLegacyMessage] = useState('');

  useEffect(() => {
    const legacyJson = window.localStorage.getItem('sa_public_learners');
    if (!legacyJson) return;
    let legacyRows: unknown[];
    try {
      const parsed: unknown = JSON.parse(legacyJson);
      if (!Array.isArray(parsed)) throw new Error('The saved legacy data is not a list.');
      legacyRows = parsed;
    } catch {
      setLegacyMessage('Legacy Public Learners data could not be read. Keep this browser profile until the data is reviewed.');
      return;
    }
    if (legacyRows.length === 0) {
      window.localStorage.removeItem('sa_public_learners');
      return;
    }
    let cancelled = false;
    void (async () => {
      let created = 0;
      let alreadyImported = 0;
      try {
        for (let offset = 0; offset < legacyRows.length; offset += 100) {
          const result = await migrateLegacy({ learners: legacyRows.slice(offset, offset + 100) }).unwrap();
          created += result.created;
          alreadyImported += result.already_imported;
        }
        window.localStorage.removeItem('sa_public_learners');
        if (!cancelled) {
          setLegacyMessage(created || alreadyImported
            ? `Moved ${created} learner records to the database. ${alreadyImported} were already present.`
            : 'Legacy learner data was cleared after confirming there were no records.');
        }
      } catch (error: any) {
        if (!cancelled) setLegacyMessage(error?.data?.detail || 'Legacy learner migration failed. The browser copy was preserved; resolve the issue and reload this page to retry.');
      }
    })();
    return () => { cancelled = true; };
  }, [migrateLegacy]);

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedSearch(search.trim()); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const changeStatus = async (id: number, action: 'activate' | 'suspend') => {
    try {
      await updateStatus({ id, action }).unwrap();
    } catch {
      window.alert('Could not update this subscription. Refresh and try again.');
    }
  };

  return (
    <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <header>
        <h2 className="text-lg font-black text-slate-900">Public Learner Subscriptions</h2>
        <p className="mt-1 text-sm text-slate-500">Passwords are never listed. New registrations remain pending until subscription payment is verified.</p>
      </header>
      {legacyMessage && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{legacyMessage}</p>}
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or email" className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm" />
        </label>
        <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
          <option value="">All statuses</option><option>Pending</option><option>Active</option><option>Expired</option><option>Suspended</option>
        </select>
      </div>
      {isLoading ? <p className="py-8 text-center text-sm text-slate-500">Loading subscriptions…</p> : isError ? <p role="alert" className="py-8 text-center text-sm text-rose-700">Could not load public learners.</p> : (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Learner</th><th className="p-3">Plan</th><th className="p-3">Status</th><th className="p-3">Expiry</th><th className="p-3 text-right">Action</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.results || []).map((learner) => (
                <tr key={learner.id}>
                  <td className="p-3"><div className="font-bold text-slate-800">{learner.name}</div><div className="text-xs text-slate-500">{learner.email}</div></td>
                  <td className="p-3">{learner.plan}</td><td className="p-3">{learner.status}</td><td className="p-3">{learner.expiryDate || '—'}</td>
                  <td className="p-3 text-right">
                    {learner.status === 'Active' ? <button disabled={isUpdating} onClick={() => void changeStatus(learner.id, 'suspend')} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700 disabled:opacity-50"><UserRoundX className="h-3.5 w-3.5" /> Suspend</button> : <button disabled={isUpdating || learner.status === 'Expired'} onClick={() => void changeStatus(learner.id, 'activate')} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"><UserRoundCheck className="h-3.5 w-3.5" /> Activate</button>}
                  </td>
                </tr>
              ))}
              {!data?.results.length && <tr><td colSpan={5} className="p-8 text-center text-slate-500">No subscriptions found.</td></tr>}
            </tbody>
          </table>
          <ListPagination page={page} pageSize={PAGE_SIZE} total={data?.count || 0} onPageChange={setPage} />
        </div>
      )}
    </section>
  );
}
