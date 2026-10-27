import React, { useEffect, useMemo, useState } from 'react';
import {
  Megaphone,
  Send,
  Users,
  GraduationCap,
  Building2,
  Calendar,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Filter,
  CheckCheck
} from 'lucide-react';
import { store } from '../../store';
import { notificationApi } from '../../store/api/notificationApi';
import { useGetTeachersQuery } from '../../store/api/teacherApi';
import { loadAcademicStructure, type AcademicClass, type AcademicSection } from '../../services/academicStructure';
import { emitNotification } from '../../services/notificationBus';
import type { AuthUser } from '../../utils/auth';

interface CommunityBroadcastDeskProps {
  user?: AuthUser | null;
  isGlass?: boolean;
}

export default function CommunityBroadcastDesk({ user, isGlass = false }: CommunityBroadcastDeskProps) {
  const role = user?.role || 'School Admin';
  const isTeacher = role === 'Teacher';
  const isAdmin = role === 'School Admin' || role === 'Super Admin';

  // Broadcast Audience Targets
  const targets = useMemo(() => {
    if (isAdmin) {
      return [
        { endpoint: '/notifications/teacher-to-students/', label: 'Students', categories: ['Meeting', 'Event', 'Circular', 'Urgent'] },
        { endpoint: '/notifications/teacher-to-parents/', label: 'Parents', categories: ['Meeting', 'Event', 'Fee Notice', 'Circular', 'Urgent'] },
        { endpoint: '/notifications/school-to-teachers/', label: 'Teachers & Faculty', categories: ['Staff Meeting', 'Circular', 'Urgent', 'Policy'] },
      ];
    }
    if (isTeacher) {
      return [
        { endpoint: '/notifications/teacher-to-students/', label: 'Assigned Students', categories: ['Assignment', 'Test Alert', 'Study Note', 'Event'] },
        { endpoint: '/notifications/teacher-to-parents/', label: 'Assigned Parents', categories: ['Homework Alert', 'PTM Meeting', 'Behavior Note', 'Urgent'] },
        { endpoint: '/notifications/teacher-to-admin/', label: 'School Admin / Office', categories: ['Leave Request', 'Equipment Need', 'General Notice'] },
      ];
    }
    return [];
  }, [role, isAdmin, isTeacher]);

  const [selectedTargetIdx, setSelectedTargetIdx] = useState(0);
  const selectedTarget = targets[selectedTargetIdx] || targets[0];

  const [broadcastCategory, setBroadcastCategory] = useState('Circular');
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');
  const [recipientMode, setRecipientMode] = useState<'all' | 'class_section' | 'individual'>('all');
  const [recipients, setRecipients] = useState('');
  const [selectedClassId, setSelectedClassId] = useState<string>('All');
  const [selectedClassName, setSelectedClassName] = useState<string>('All');
  const [selectedSectionId, setSelectedSectionId] = useState<string>('All');
  const [selectedSectionName, setSelectedSectionName] = useState<string>('All');
  const [isSending, setIsSending] = useState(false);
  const [recentBroadcasts, setRecentBroadcasts] = useState<any[]>([]);

  // Academic structure
  const [academicClasses, setAcademicClasses] = useState<AcademicClass[]>([]);
  const [academicSections, setAcademicSections] = useState<AcademicSection[]>([]);
  const { data: teacherRecords = [] } = useGetTeachersQuery(undefined, { skip: !isAdmin });

  useEffect(() => {
    async function loadStructure() {
      try {
        const structure = await loadAcademicStructure();
        setAcademicClasses(structure.classes || []);
        setAcademicSections(structure.sections || []);
      } catch {
        // silent
      }
    }
    void loadStructure();
  }, []);

  const loadBroadcastHistory = async () => {
    try {
      const data = await store.dispatch(notificationApi.endpoints.getNotifications.initiate(undefined, { forceRefetch: true })).unwrap();
      const broadcasts = (data as any[]).filter(n => n.category !== 'Message' && !n.title?.toLowerCase().startsWith('new message from'));
      setRecentBroadcasts(broadcasts.slice(0, 15));
    } catch {
      // silent
    }
  };

  useEffect(() => {
    void loadBroadcastHistory();
  }, []);

  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTarget || !broadcastTitle.trim() || !broadcastBody.trim()) return;
    setIsSending(true);

    try {
      const payload: Record<string, any> = {
        category: broadcastCategory,
        title: broadcastTitle.trim(),
        body: broadcastBody.trim(),
      };

      if (selectedTarget.endpoint === '/notifications/school-to-teachers/') {
        payload.recipientMode = recipientMode === 'individual' ? 'individual' : 'all';
        if (recipientMode === 'individual') {
          payload.recipients = recipients.split(/[\n,]/).map((v) => v.trim()).filter(Boolean);
        }
      } else if (selectedTarget.endpoint === '/notifications/teacher-to-admin/') {
        payload.recipientMode = 'all';
      } else {
        if (recipientMode === 'all') {
          payload.recipientMode = 'all';
        } else if (recipientMode === 'class_section') {
          payload.recipientMode = 'class';
          if (selectedClassId !== 'All') {
            payload.targetClassId = Number(selectedClassId);
            payload.targetClass = selectedClassName !== 'All' ? selectedClassName : '';
          }
          if (selectedSectionId !== 'All') {
            payload.targetSectionId = Number(selectedSectionId);
            payload.targetSection = selectedSectionName !== 'All' ? selectedSectionName : '';
          }
        } else if (recipientMode === 'individual') {
          payload.recipientMode = 'individual';
          payload.recipients = recipients.split(/[\n,]/).map((v) => v.trim()).filter(Boolean);
        }
      }

      let result: { created: number };
      if (selectedTarget.endpoint === '/notifications/school-to-teachers/') {
        result = await store.dispatch(notificationApi.endpoints.notifyTeachers.initiate(payload as any)).unwrap();
      } else if (selectedTarget.endpoint === '/notifications/teacher-to-parents/') {
        result = await store.dispatch(notificationApi.endpoints.notifyParents.initiate(payload as any)).unwrap();
      } else if (selectedTarget.endpoint === '/notifications/teacher-to-students/') {
        result = await store.dispatch(notificationApi.endpoints.notifyStudents.initiate(payload as any)).unwrap();
      } else {
        result = await store.dispatch(notificationApi.endpoints.notifyAdmin.initiate(payload as any)).unwrap();
      }

      emitNotification({
        title: `${selectedTarget.label} Broadcast Sent`,
        message: `"${broadcastTitle.trim()}" delivered successfully to ${result.created} recipient${result.created === 1 ? '' : 's'}.`,
        tone: broadcastCategory === 'Urgent' ? 'danger' : 'success',
        source: 'communication',
      });

      setBroadcastTitle('');
      setBroadcastBody('');
      setRecipients('');
      void loadBroadcastHistory();
    } catch (err: any) {
      const msg = err?.data?.detail || err?.data?.message || err?.message || 'Failed to dispatch broadcast.';
      emitNotification({
        title: 'Broadcast Error',
        message: msg,
        tone: 'danger',
        source: 'communication',
      });
    } finally {
      setIsSending(false);
    }
  };

  const inputClass = isGlass
    ? 'border-slate-700 bg-slate-900/60 text-slate-100 placeholder:text-slate-500 focus:border-indigo-400'
    : 'border-slate-200 bg-white text-slate-800 placeholder:text-slate-400 focus:border-indigo-500';

  return (
    <div className="space-y-6 animate-fade-in" id="community-broadcast-desk">
      {/* Broadcast Composer Card */}
      <div className={`rounded-3xl border p-6 shadow-sm ${isGlass ? 'border-slate-800 bg-slate-900/50 backdrop-blur-md' : 'border-slate-200/80 bg-white'}`}>
        <div className="flex items-center gap-3 border-b pb-4 border-slate-100 dark:border-slate-800">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-indigo-500/10 text-indigo-600">
            <Megaphone className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-slate-900 dark:text-white">Community Broadcast Announcement Desk</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isTeacher
                ? 'Send official announcements and circulars directly to your students and parents'
                : 'Publish school-wide broadcasts or targeted alerts filtered by class, section, teachers or parents'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSendBroadcast} className="mt-5 space-y-4 rounded-2xl border p-5 bg-slate-50/50 dark:bg-slate-900/40 border-slate-200/80 dark:border-slate-800">
          {/* Target Audience Tabs */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Send To:</span>
            {targets.map((t, i) => (
              <button
                key={t.label}
                type="button"
                onClick={() => {
                  setSelectedTargetIdx(i);
                  setRecipientMode('all');
                  setRecipients('');
                  setSelectedClassId('All');
                  setSelectedClassName('All');
                  setSelectedSectionId('All');
                  setSelectedSectionName('All');
                }}
                className={`rounded-xl px-4 py-2 text-xs font-extrabold transition cursor-pointer ${
                  selectedTargetIdx === i
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                }`}
              >
                {t.label}
              </button>
            ))}

            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs font-bold text-slate-400">Category:</span>
              <select
                value={broadcastCategory}
                onChange={(e) => setBroadcastCategory(e.target.value)}
                className={`rounded-xl border px-3 py-1.5 text-xs font-bold ${inputClass}`}
              >
                {(selectedTarget?.categories || ['Circular', 'Meeting', 'Event', 'Urgent']).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Scope Filters for Students & Parents */}
          {(selectedTarget?.endpoint === '/notifications/teacher-to-students/' || selectedTarget?.endpoint === '/notifications/teacher-to-parents/') && (
            <div className="space-y-3 pt-2 border-t border-slate-200/80 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Audience Scope:</span>
                <button
                  type="button"
                  onClick={() => {
                    setRecipientMode('all');
                    setSelectedClassId('All');
                    setSelectedClassName('All');
                    setSelectedSectionId('All');
                    setSelectedSectionName('All');
                  }}
                  className={`rounded-full px-3.5 py-1 text-xs font-bold transition cursor-pointer ${
                    recipientMode === 'all'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300'
                  }`}
                >
                  All {selectedTarget.label} (School-Wide)
                </button>
                <button
                  type="button"
                  onClick={() => setRecipientMode('class_section')}
                  className={`rounded-full px-3.5 py-1 text-xs font-bold transition cursor-pointer ${
                    recipientMode === 'class_section'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300'
                  }`}
                >
                  Particular Class & Section
                </button>
              </div>

              {recipientMode === 'class_section' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-indigo-50/50 dark:bg-slate-800/40 rounded-2xl border border-indigo-100 dark:border-slate-800">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Target Class</label>
                    <select
                      value={selectedClassId}
                      onChange={(e) => {
                        setSelectedClassId(e.target.value);
                        const c = academicClasses.find((x) => String(x.id) === e.target.value);
                        setSelectedClassName(c ? c.name : 'All');
                      }}
                      className={`w-full rounded-xl border px-3 py-2 text-xs font-bold ${inputClass}`}
                    >
                      <option value="All">All Classes</option>
                      {academicClasses.map((c) => (
                        <option key={c.id} value={String(c.id)}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Target Section</label>
                    <select
                      value={selectedSectionId}
                      onChange={(e) => {
                        setSelectedSectionId(e.target.value);
                        const s = academicSections.find((x) => String(x.id) === e.target.value);
                        setSelectedSectionName(s ? s.name : 'All');
                      }}
                      className={`w-full rounded-xl border px-3 py-2 text-xs font-bold ${inputClass}`}
                    >
                      <option value="All">All Sections</option>
                      {academicSections.map((s) => (
                        <option key={s.id} value={String(s.id)}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Broadcast Content Inputs */}
          <div className="space-y-3 pt-2">
            <div>
              <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300 mb-1">Announcement Title</label>
              <input
                type="text"
                placeholder="e.g. Annual Sports Day Circular, Holiday Notice, Examination Schedule..."
                value={broadcastTitle}
                onChange={(e) => setBroadcastTitle(e.target.value)}
                className={`w-full rounded-xl border px-4 py-2.5 text-xs font-semibold ${inputClass}`}
              />
            </div>
            <div>
              <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300 mb-1">Detailed Message</label>
              <textarea
                rows={4}
                placeholder="Compose the announcement details, dates, instructions or general notice to broadcast..."
                value={broadcastBody}
                onChange={(e) => setBroadcastBody(e.target.value)}
                className={`w-full rounded-xl border px-4 py-2.5 text-xs font-medium resize-none ${inputClass}`}
              />
            </div>
          </div>

          {/* Submit Action */}
          <div className="flex items-center justify-between pt-2">
            <span className="text-[11px] font-semibold text-slate-400">
              Target: <strong className="text-indigo-600 dark:text-indigo-400">{selectedTarget?.label}</strong> ({recipientMode === 'class_section' ? `${selectedClassName} · ${selectedSectionName}` : 'All School'})
            </span>
            <button
              type="submit"
              disabled={isSending || !broadcastTitle.trim() || !broadcastBody.trim()}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-2.5 text-xs font-black text-white shadow-md shadow-indigo-500/20 hover:from-indigo-700 hover:to-violet-700 active:scale-95 disabled:opacity-50 cursor-pointer transition-all"
            >
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Publish Broadcast
            </button>
          </div>
        </form>
      </div>

      {/* Broadcast History List */}
      <div className={`rounded-3xl border p-6 shadow-sm ${isGlass ? 'border-slate-800 bg-slate-900/50 backdrop-blur-md' : 'border-slate-200/80 bg-white'}`}>
        <div className="flex items-center justify-between border-b pb-4 border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-xl bg-violet-500/10 text-violet-600">
              <Megaphone className="h-4 w-4" />
            </div>
            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">Recent Broadcast History</h3>
          </div>
          <span className="text-xs font-bold text-slate-400">{recentBroadcasts.length} Sent</span>
        </div>

        {recentBroadcasts.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <Megaphone className="mx-auto h-8 w-8 opacity-40 mb-2" />
            <p className="text-xs font-bold">No announcements published yet.</p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {recentBroadcasts.map((b) => (
              <div
                key={b.id}
                className="rounded-2xl border p-4 bg-slate-50/50 dark:bg-slate-900/40 border-slate-200/80 dark:border-slate-800 space-y-2 hover:border-indigo-400 transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-slate-900 dark:text-white">{b.senderName}</span>
                      <span className="rounded-full px-2 py-0.5 text-[9px] font-extrabold bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                        {b.category || 'Broadcast'}
                      </span>
                    </div>
                    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100 mt-1">{b.title}</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{b.body}</p>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 shrink-0">
                    {new Date(b.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
