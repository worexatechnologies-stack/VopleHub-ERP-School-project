import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bell,
  Calendar,
  CheckCircle2,
  Filter,
  ShieldCheck,
  Trash2,
  UserX,
  AlertTriangle,
  Loader2,
  Plus,
  X,
  MessageSquare,
  BookOpen
} from 'lucide-react';
import { store } from '../../store';
import { notificationApi } from '../../store/api/notificationApi';
import { emitNotification } from '../../services/notificationBus';
import type { AuthUser } from '../../utils/auth';

export interface ApiNotification {
  id: number;
  senderId?: number;
  senderName: string;
  recipientId?: number;
  recipientName?: string;
  category: string;
  title: string;
  body: string;
  channel: string;
  status?: string;
  readAt: string | null;
  createdAt: string;
  requestStatus?: 'Pending' | 'Approved' | 'Declined' | 'Acknowledged';
}

interface CommunityNoticeBoardProps {
  user?: AuthUser | null;
  isGlass?: boolean;
  onNavigateToTab?: (tabId: string) => void;
}

export default function CommunityNoticeBoard({ user, isGlass = false, onNavigateToTab }: CommunityNoticeBoardProps) {
  const role = user?.role || 'School Admin';
  const isTeacher = role === 'Teacher';
  const isAdmin = role === 'School Admin' || role === 'Super Admin';
  const isStudent = role === 'Student';

  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  const [requestFilter, setRequestFilter] = useState<'all' | 'requests' | 'urgent' | 'general'>('all');
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [leaveCategory, setLeaveCategory] = useState<'Casual Leave' | 'Sick Leave' | 'Academic Leave' | 'Holiday Request'>('Casual Leave');
  const [leaveTitle, setLeaveTitle] = useState('');
  const [leaveReason, setLeaveReason] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const loadNotifications = async () => {
    try {
      const data = await store.dispatch(notificationApi.endpoints.getNotifications.initiate(undefined, { forceRefetch: true })).unwrap();
      setNotifications(data as any[]);
    } catch {
      // silent
    }
  };

  useEffect(() => {
    void loadNotifications();
    const interval = window.setInterval(() => {
      void loadNotifications();
    }, 5000);
    return () => window.clearInterval(interval);
  }, []);

  const markRead = async (id: number) => {
    try {
      const updated = await store.dispatch(notificationApi.endpoints.markNotificationRead.initiate(id)).unwrap();
      setNotifications((prev) => prev.map((n) => (n.id === id ? (updated as any) : n)));
    } catch {
      // silent
    }
  };

  const handleRequestDecision = async (notification: ApiNotification, status: 'Approved' | 'Declined') => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notification.id ? { ...n, status, requestStatus: status } : n))
    );

    emitNotification({
      title: `Request ${status}`,
      message: `"${notification.title}" from ${notification.senderName} has been ${status.toLowerCase()}.`,
      tone: status === 'Approved' ? 'success' : 'danger',
      source: 'communication',
    });

    try {
      await store
        .dispatch(
          notificationApi.endpoints.respondNotificationDecision.initiate({
            id: notification.id,
            action: status === 'Approved' ? 'Approve' : 'Reject',
          })
        )
        .unwrap();
      void loadNotifications();
    } catch {
      void loadNotifications();
    }
  };

  const handleClearAllNotifications = async () => {
    setIsResetting(true);
    try {
      await store.dispatch(notificationApi.endpoints.clearAllNotifications.initiate()).unwrap();
      setNotifications([]);
      emitNotification({
        title: 'Notices Cleared',
        message: 'All notification records have been cleared.',
        tone: 'info',
        source: 'communication',
      });
      setShowResetModal(false);
    } catch {
      emitNotification({
        title: 'Reset Failed',
        message: 'Could not clear notifications.',
        tone: 'danger',
        source: 'communication',
      });
    } finally {
      setIsResetting(false);
    }
  };

  const handleSubmitLeaveRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leaveTitle.trim() || !leaveReason.trim()) return;
    setIsSending(true);

    try {
      await store
        .dispatch(
          notificationApi.endpoints.notifyAdmin.initiate({
            recipientMode: 'all',
            recipients: [],
            category: leaveCategory,
            title: leaveTitle.trim(),
            body: leaveReason.trim(),
          })
        )
        .unwrap();

      emitNotification({
        title: `${leaveCategory} Submitted`,
        message: `Your request "${leaveTitle.trim()}" was sent to the School Office for review.`,
        tone: 'success',
        source: 'communication',
      });

      setLeaveTitle('');
      setLeaveReason('');
      setShowLeaveForm(false);
      void loadNotifications();
    } catch {
      emitNotification({
        title: 'Submission Failed',
        message: 'Could not submit leave request.',
        tone: 'danger',
        source: 'communication',
      });
    } finally {
      setIsSending(false);
    }
  };

  const isLeaveRequest = (n: ApiNotification) => {
    const cat = (n.category || '').toLowerCase();
    const title = (n.title || '').toLowerCase();
    return (
      cat.includes('leave') ||
      cat.includes('holiday') ||
      cat.includes('request') ||
      title.includes('leave') ||
      title.includes('holiday')
    );
  };

  const getNotificationCardStyle = (n: ApiNotification) => {
    const cat = (n.category || '').toLowerCase();
    const title = (n.title || '').toLowerCase();
    const reqStatus = (n.requestStatus || n.status || 'Pending').toLowerCase();

    if (isLeaveRequest(n)) {
      if (reqStatus === 'approved' || title.includes('approved')) {
        return {
          border: 'border-l-4 border-l-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200/70',
          badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-300 font-extrabold',
          iconBg: 'bg-emerald-500/10 text-emerald-600',
          Icon: CheckCircle2,
          tagText: `${n.category || 'Leave Request'} (Approved)`,
        };
      }
      if (reqStatus === 'declined' || title.includes('declined')) {
        return {
          border: 'border-l-4 border-l-rose-500 bg-rose-50/40 dark:bg-rose-950/20 border-rose-200/70',
          badge: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-300 font-extrabold',
          iconBg: 'bg-rose-500/10 text-rose-600',
          Icon: UserX,
          tagText: `${n.category || 'Leave Request'} (Declined)`,
        };
      }
      return {
        border: 'border-l-4 border-l-amber-500 bg-amber-50/40 dark:bg-amber-950/20 border-amber-200/70',
        badge: 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-300 font-extrabold',
        iconBg: 'bg-amber-500/10 text-amber-600',
        Icon: Calendar,
        tagText: `${n.category || 'Leave Request'} (Pending)`,
      };
    }

    if (cat.includes('urgent') || title.includes('urgent') || cat.includes('alert')) {
      return {
        border: 'border-l-4 border-l-rose-600 bg-rose-50/60 dark:bg-rose-950/30 border-rose-200 shadow-xs',
        badge: 'bg-rose-600 text-white font-black uppercase tracking-wider text-[9px]',
        iconBg: 'bg-rose-600 text-white',
        Icon: ShieldCheck,
        tagText: 'URGENT ALERT',
      };
    }

    return {
      border: 'border-l-4 border-l-indigo-500 bg-slate-50/50 dark:bg-slate-900/40 border-slate-200/80',
      badge: 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 font-bold',
      iconBg: 'bg-indigo-500/10 text-indigo-600',
      Icon: Bell,
      tagText: n.category || 'Notice',
    };
  };

  const filteredNotifications = useMemo(() => {
    return notifications
      .filter((n) => {
        // Exclude raw chat message notifications from notice board
        if (n.category === 'Message' || (n.title || '').toLowerCase().startsWith('new message from')) {
          return false;
        }
        if (requestFilter === 'requests') return isLeaveRequest(n);
        if (requestFilter === 'urgent') {
          const c = (n.category || '').toLowerCase();
          const t = (n.title || '').toLowerCase();
          return c.includes('urgent') || t.includes('urgent') || c.includes('alert');
        }
        if (requestFilter === 'general') return !isLeaveRequest(n);
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [notifications, requestFilter]);

  const inputClass = isGlass
    ? 'border-slate-700 bg-slate-900/60 text-slate-100 placeholder:text-slate-500 focus:border-indigo-400'
    : 'border-slate-200 bg-white text-slate-800 placeholder:text-slate-400 focus:border-indigo-500';

  return (
    <div className="space-y-6 animate-fade-in" id="community-notice-board">
      {/* Header & Filter Card */}
      <div className={`rounded-3xl border p-6 shadow-sm ${isGlass ? 'border-slate-800 bg-slate-900/50 backdrop-blur-md' : 'border-slate-200/80 bg-white'}`}>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-5 border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-indigo-500/10 text-indigo-600">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                {isStudent ? 'Class Notices & School Announcements' : 'School Notices & Staff Requests'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isStudent
                  ? 'Official class circulars, schedule changes, and school-wide alerts'
                  : 'Official circulars, notifications, and staff leave request approvals'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {isTeacher && (
              <button
                type="button"
                onClick={() => setShowLeaveForm(!showLeaveForm)}
                className="flex items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 text-xs font-extrabold shadow-sm transition active:scale-95 cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                {showLeaveForm ? 'Close Form' : 'Submit Leave Request'}
              </button>
            )}

            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowResetModal(true)}
                className="flex items-center gap-1.5 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 hover:bg-rose-100 px-3 py-2 text-xs font-bold transition cursor-pointer"
                title="Clear All Notices"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear All
              </button>
            )}

            {/* Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5 ml-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1">
                <Filter className="h-3 w-3" /> Filter:
              </span>
              {[
                { id: 'all', label: 'All' },
                ...(!isStudent ? [{ id: 'requests', label: 'Leave Requests' }] : []),
                { id: 'urgent', label: 'Urgent' },
                { id: 'general', label: 'Notices' },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setRequestFilter(f.id as any)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-extrabold transition cursor-pointer ${
                    requestFilter === f.id
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Teacher Leave Submission Form */}
        {showLeaveForm && isTeacher && (
          <form onSubmit={handleSubmitLeaveRequest} className="mt-5 space-y-4 rounded-2xl border p-5 bg-amber-50/40 dark:bg-amber-950/20 border-amber-200/80">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-amber-700 dark:text-amber-400 flex items-center gap-2">
                <Calendar className="h-4 w-4" /> Submit Official Staff Request
              </h3>
              <button
                type="button"
                onClick={() => setShowLeaveForm(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Request Type</label>
                <select
                  value={leaveCategory}
                  onChange={(e) => setLeaveCategory(e.target.value as any)}
                  className={`w-full rounded-xl border px-3 py-2 text-xs font-bold ${inputClass}`}
                >
                  <option value="Casual Leave">Casual Leave (Personal / Urgent)</option>
                  <option value="Sick Leave">Medical / Sick Leave</option>
                  <option value="Academic Leave">Official Duty / Training Leave</option>
                  <option value="Holiday Request">Vacation / Planned Holiday</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Subject / Dates</label>
                <input
                  type="text"
                  placeholder="e.g. Leave Application for 24th Oct - 26th Oct"
                  value={leaveTitle}
                  onChange={(e) => setLeaveTitle(e.target.value)}
                  className={`w-full rounded-xl border px-3 py-2 text-xs font-semibold ${inputClass}`}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Reason & Substituted Classes</label>
              <textarea
                rows={3}
                placeholder="Specify the reason for leave and any substitution arrangements arranged with colleagues..."
                value={leaveReason}
                onChange={(e) => setLeaveReason(e.target.value)}
                className={`w-full rounded-xl border px-3 py-2 text-xs font-medium resize-none ${inputClass}`}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowLeaveForm(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSending || !leaveTitle.trim() || !leaveReason.trim()}
                className="flex items-center gap-1.5 rounded-xl bg-amber-600 px-5 py-2 text-xs font-black text-white shadow-sm hover:bg-amber-700 disabled:opacity-50 transition cursor-pointer"
              >
                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calendar className="h-4 w-4" />}
                Submit to Administration
              </button>
            </div>
          </form>
        )}

        {/* Notices Cards List */}
        <div className="mt-5 space-y-3">
          {filteredNotifications.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <Bell className="mx-auto h-9 w-9 opacity-40 mb-2" />
              <p className="text-xs font-bold">No announcements or notices found.</p>
              <p className="text-[11px] text-slate-400 mt-1">Official circulars and announcements will appear here automatically.</p>
            </div>
          ) : (
            filteredNotifications.map((n) => {
              const style = getNotificationCardStyle(n);
              const isReq = isLeaveRequest(n);

              return (
                <div
                  key={n.id}
                  onClick={() => void markRead(n.id)}
                  className={`rounded-2xl border p-4 transition-all duration-200 space-y-3 ${style.border} ${
                    !n.readAt ? 'ring-1 ring-indigo-500/20 shadow-xs' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${style.iconBg}`}>
                        <style.Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-black text-slate-900 dark:text-white">{n.senderName}</span>
                          <span className={`rounded-full px-2.5 py-0.5 text-[10px] ${style.badge}`}>
                            {style.tagText || n.category}
                          </span>
                        </div>
                        <h3 className="mt-1.5 text-sm font-black tracking-tight text-slate-900 dark:text-white">{n.title}</h3>
                        <p className="mt-1 text-xs leading-relaxed font-medium text-slate-600 dark:text-slate-300">{n.body}</p>
                      </div>
                    </div>

                    <span className="text-[10px] font-mono text-slate-400 shrink-0">
                      {new Date(n.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  {/* Admin Approval / Rejection Actions for Staff Requests */}
                  {isAdmin && isReq && (!n.requestStatus || n.requestStatus === 'Pending') && (
                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200/60 dark:border-slate-800">
                      <span className="text-[11px] font-bold text-slate-400 mr-2">Office Decision:</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRequestDecision(n, 'Declined');
                        }}
                        className="rounded-xl border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-700 px-3.5 py-1.5 text-xs font-bold transition cursor-pointer"
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRequestDecision(n, 'Approved');
                        }}
                        className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 text-xs font-extrabold shadow-sm transition cursor-pointer"
                      >
                        Approve Request
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Admin Clear Confirmation Modal */}
      {showResetModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-rose-100">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <h3 className="text-base font-black text-slate-900">Clear All School Notices?</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              This action will permanently delete all circulars, announcements, and notice records for your school.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleClearAllNotifications()}
                disabled={isResetting}
                className="rounded-xl bg-rose-600 px-5 py-2 text-xs font-black text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {isResetting ? 'Clearing…' : 'Yes, Clear Notices'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
