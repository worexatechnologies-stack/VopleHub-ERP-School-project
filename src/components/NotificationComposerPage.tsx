import React, { useState } from 'react';
import { BellRing, Send, Users } from 'lucide-react';
import { Student } from '../types';
import type { AuthUser } from '../utils/auth';
import {
  useNotifyTeachersMutation,
  useNotifyParentsMutation,
  useNotifyStudentsMutation,
} from '../store/api/notificationApi';
import { useGetTeachersQuery } from '../store/api/teacherApi';
import { emitNotification } from '../services/notificationBus';

type ComposerMode = 'school-to-teachers' | 'teacher-to-parents' | 'teacher-to-students';

interface NotificationComposerPageProps {
  mode: ComposerMode;
  user: AuthUser;
  students?: Student[];
}

const copy = {
  'school-to-teachers': { title: 'Notify Teachers', subtitle: 'School Admin to Teacher(s)', recipientLabel: 'Teacher recipients', placeholder: 'All teachers / selected teacher names', categories: ['Meeting', 'Policy Update', 'Urgent', 'Timetable'] },
  'teacher-to-parents': { title: 'Notify Parents', subtitle: 'School Admin to Parent(s)', recipientLabel: 'Parent recipients', placeholder: 'Class-section / student admission numbers', categories: ['Absence follow-up', 'Homework reminder', 'Exam reminder', 'General'] },
  'teacher-to-students': { title: 'Notify Students', subtitle: 'School Admin to Student(s)', recipientLabel: 'Student recipients', placeholder: 'Class-section / student names / admission numbers', categories: ['Assignment posted', 'Exam reminder', 'Class announcement', 'General'] },
} satisfies Record<ComposerMode, { title: string; subtitle: string; recipientLabel: string; placeholder: string; categories: string[] }>;

export default function NotificationComposerPage({ mode, user, students = [] }: NotificationComposerPageProps) {
  const meta = copy[mode];
  const [notifyTeachers] = useNotifyTeachersMutation();
  const [notifyParents] = useNotifyParentsMutation();
  const [notifyStudents] = useNotifyStudentsMutation();
  const { data: teacherList = [] } = useGetTeachersQuery(undefined, { skip: mode !== 'school-to-teachers' });
  const notifyForMode = mode === 'school-to-teachers' ? notifyTeachers : mode === 'teacher-to-parents' ? notifyParents : notifyStudents;
  const [recipientMode, setRecipientMode] = useState<'all' | 'subject' | 'section' | 'individual'>('all');
  const [recipients, setRecipients] = useState('');
  const [category, setCategory] = useState(meta.categories[0]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sent, setSent] = useState<Array<{ id: string; title: string; body: string; category: string; recipients: string; createdAt: string; created: number }>>([]);
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);

  const sectionOptions = Array.from(new Set(students.map((student) => `${student.class}-${student.section}`))).filter(Boolean);

  const toggleTeacherRecipient = (teacherName: string) => {
    const list = recipients.split(/[\n,]/).map((v) => v.trim()).filter(Boolean);
    const exists = list.includes(teacherName);
    const updated = exists ? list.filter((item) => item !== teacherName) : [...list, teacherName];
    setRecipients(updated.join(', '));
  };

  const applyPreset = (preset: string) => {
    setCategory(preset);
    if (preset.includes('Homework')) { setTitle('Homework reminder'); setBody('Please complete and submit the assigned homework before the due date.'); }
    if (preset.includes('Exam')) { setTitle('Exam reminder'); setBody('This is a reminder about the upcoming exam. Please check the timetable and prepare accordingly.'); }
    if (preset.includes('Absence')) { setTitle('Absence follow-up'); setBody('Your ward was marked absent. Please share the reason or contact the school office.'); }
    if (preset.includes('Assignment')) { setTitle('Assignment posted'); setBody('A new assignment has been posted. Please review and submit it on time.'); }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setIsSending(true);
    try {
      const result = await notifyForMode({
        recipientMode,
        recipients: recipients.split(/[\n,]/).map((value) => value.trim()).filter(Boolean),
        category,
        title,
        body,
      }).unwrap();
      setSent((current) => [{ id: `notice-${Date.now()}`, title, body, category, recipients: recipients || recipientMode, createdAt: new Date().toISOString(), created: result.created }, ...current].slice(0, 8));
      emitNotification({ title: `${meta.title} sent`, message: `${title} delivered to ${result.created} recipient${result.created === 1 ? '' : 's'}.`, tone: category === 'Urgent' ? 'danger' : 'success', source: mode });
      setTitle(''); setBody(''); setRecipients('');
    } catch (requestError: any) {
      const detail = requestError?.data?.recipients?.[0] || requestError?.data?.detail || (requestError instanceof Error ? requestError.message : 'Could not send the notification.');
      setError(detail);
    } finally {
      setIsSending(false);
    }
  };

  if (user.role !== 'School Admin') return <section className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm"><BellRing className="mx-auto h-6 w-6 text-indigo-500" /><h1 className="mt-3 text-lg font-extrabold text-slate-900">Notifications are view-only</h1><p className="mt-1 text-sm text-slate-500">Only School Admins can publish notices.</p></section>;

  return <section className="space-y-5 animate-fade-in" id={`composer-${mode}`}>
    <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-500">School notification composer</p><h1 className="mt-2 text-2xl font-extrabold text-slate-900">{meta.title}</h1><p className="mt-1 text-sm text-slate-500">{meta.subtitle}. Messages are delivered through the school-scoped notification API.</p></header>
    <div className="grid gap-5 lg:grid-cols-3">
      <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
        <div className="grid gap-4 md:grid-cols-2"><label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Recipient mode<select value={recipientMode} onChange={(event) => { const nextMode = event.target.value as 'all' | 'subject' | 'section' | 'individual'; setRecipientMode(nextMode); if (nextMode === 'all') setRecipients(''); }} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="all">All teachers / allowed recipients</option><option value="individual">Particular teacher(s) / individual</option></select></label><label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Category<select value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">{meta.categories.map((item) => <option key={item}>{item}</option>)}</select></label></div>
        
        {recipientMode !== 'all' && (
          <label className="mt-4 block text-[10px] font-bold uppercase tracking-wider text-slate-500">{meta.recipientLabel}
            <input value={recipients} onChange={(event) => setRecipients(event.target.value)} placeholder={meta.placeholder} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          </label>
        )}

        {mode === 'school-to-teachers' && recipientMode !== 'all' && teacherList.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Click to select particular teacher(s):</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {teacherList.map((t) => {
                const selected = recipients.split(/[\n,]/).map((v) => v.trim()).includes(t.name);
                return (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => toggleTeacherRecipient(t.name)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      selected ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {sectionOptions.length > 0 && mode !== 'school-to-teachers' && (
          <div className="mt-2 flex flex-wrap gap-2">{sectionOptions.slice(0, 8).map((section) => <button type="button" key={section} onClick={() => setRecipients(section)} className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold text-slate-600">{section}</button>)}</div>
        )}

        <div className="mt-4 grid gap-4"><input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Notification title" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /><textarea required rows={5} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write message body..." className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /></div>
        <div className="mt-4 flex flex-wrap gap-2">{meta.categories.map((preset) => <button type="button" key={preset} onClick={() => applyPreset(preset)} className="rounded-full border border-slate-200 px-3 py-1.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50">{preset}</button>)}</div>
        {error && <p className="mt-4 rounded-xl bg-rose-50 p-3 text-xs font-semibold text-rose-700">{error}</p>}
        <button disabled={isSending} type="submit" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-extrabold text-white hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60"><Send className="h-4 w-4" />{isSending ? 'Sending...' : 'Send notification'}</button>
      </form>
      <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><BellRing className="h-4 w-4 text-indigo-500" /><h2 className="text-sm font-extrabold text-slate-900">Delivery rules</h2></div><div className="mt-4 space-y-3 text-xs leading-relaxed text-slate-500"><p className="rounded-xl bg-slate-50 p-3"><Users className="mr-1 inline h-3.5 w-3.5" />Each recipient gets their own server-side notification.</p><p className="rounded-xl bg-slate-50 p-3">The server scopes all recipients to this School Admin's school before delivery.</p><p className="rounded-xl bg-slate-50 p-3">Select "All teachers" for school-wide notices or "Particular teacher(s)" to target specific staff members.</p></div></aside>
    </div>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-sm font-extrabold text-slate-900">Recent sends</h2><div className="mt-4 space-y-2">{sent.length === 0 ? <p className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-500">No notices sent during this session.</p> : sent.map((item) => <div key={item.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3"><p className="text-xs font-extrabold text-slate-900">{item.title}</p><p className="mt-1 text-[11px] text-slate-500">{item.body}</p><p className="mt-2 text-[10px] font-mono text-slate-400">{new Date(item.createdAt).toLocaleString()} · {item.category} · {item.created} delivered</p></div>)}</div></section>
  </section>;
}

