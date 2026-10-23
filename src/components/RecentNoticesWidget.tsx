import React from 'react';
import { Bell, Clock, ArrowRight, Megaphone, AlertCircle, Calendar } from 'lucide-react';
import { motion } from 'motion/react';
import { useGetNotificationsQuery, NotificationRecord } from '../store/api/notificationApi';
import { useAppSelector } from '../store';

interface RecentNoticesWidgetProps {
  onNavigateToTab?: (tabId: string) => void;
  title?: string;
  maxItems?: number;
}

export default function RecentNoticesWidget({
  onNavigateToTab,
  title = 'School Notices & Circulars',
  maxItems = 4,
}: RecentNoticesWidgetProps) {
  const currentUser = useAppSelector((state) => state.auth.user);
  const { data: rawNotices = [], isLoading } = useGetNotificationsQuery(undefined, {
    pollingInterval: 8000,
  });

  const notices = React.useMemo(() => {
    const list = Array.isArray(rawNotices) ? rawNotices : [];
    return list
      .filter((n) => {
        // Exclude chat direct messages from Notices circular widget
        if (n.channel === 'chat') return false;
        // Exclude notices explicitly addressed to someone else
        if (currentUser?.id && n.recipientId && String(n.recipientId) !== String(currentUser.id)) {
          return false;
        }
        return true;
      })
      .slice(0, maxItems);
  }, [rawNotices, maxItems, currentUser?.id]);

  const unreadCount = React.useMemo(() => {
    const list = Array.isArray(rawNotices) ? rawNotices : [];
    return list.filter((n) => {
      if (n.channel === 'chat') return false;
      if (currentUser?.id && n.recipientId && String(n.recipientId) !== String(currentUser.id)) {
        return false;
      }
      return !n.readAt && !n.read_at;
    }).length;
  }, [rawNotices, currentUser?.id]);

  const getCategoryColor = (category: string) => {
    const cat = (category || '').toLowerCase();
    if (cat.includes('urgent') || cat.includes('alert')) {
      return 'bg-rose-50 text-rose-700 border-rose-200';
    }
    if (cat.includes('timetable') || cat.includes('schedule')) {
      return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    }
    if (cat.includes('exam') || cat.includes('academic')) {
      return 'bg-violet-50 text-violet-700 border-violet-200';
    }
    if (cat.includes('leave') || cat.includes('staff')) {
      return 'bg-amber-50 text-amber-700 border-amber-200';
    }
    return 'bg-slate-100 text-slate-700 border-slate-200';
  };

  const formatTimestamp = (iso?: string) => {
    if (!iso) return '';
    try {
      const date = new Date(iso);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  return (
    <div className="rounded-3xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-xs space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100 shadow-2xs">
            <Bell className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-900 tracking-tight">{title}</h3>
            <p className="text-[11px] text-slate-500 font-medium">Broadcast alerts and administration updates</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-[10px] font-black text-rose-700 border border-rose-200">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
              {unreadCount} New
            </span>
          )}
          {onNavigateToTab && (
            <button
              type="button"
              onClick={() => onNavigateToTab('notifications')}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-700 transition cursor-pointer flex items-center gap-0.5"
            >
              <span>View All</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {isLoading && notices.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-400">
          <Clock className="w-5 h-5 mx-auto mb-1.5 text-slate-300 animate-pulse" />
          Loading announcements...
        </div>
      ) : notices.length === 0 ? (
        <div className="py-7 text-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 space-y-1">
          <Megaphone className="w-6 h-6 text-slate-300 mx-auto" />
          <p className="text-xs font-bold text-slate-700">No active circulars at this time.</p>
          <p className="text-[11px] text-slate-400">Notices published by the administration will appear here.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {notices.map((n) => {
            const isUnread = !n.readAt && !n.read_at;
            const timeLabel = formatTimestamp(n.createdAt || n.created_at);
            return (
              <motion.div
                key={n.id}
                whileHover={{ y: -1 }}
                className={`p-3.5 rounded-2xl border transition-all ${
                  isUnread
                    ? 'border-indigo-200/90 bg-indigo-50/30 hover:bg-white hover:shadow-xs'
                    : 'border-slate-100 bg-slate-50/60 hover:bg-white hover:border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border ${getCategoryColor(n.category)}`}>
                        {n.category || 'Notice'}
                      </span>
                      {timeLabel && (
                        <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {timeLabel}
                        </span>
                      )}
                    </div>
                    <h4 className="text-xs font-black text-slate-900 leading-snug line-clamp-1">
                      {n.title}
                    </h4>
                    <p className="text-[11px] text-slate-600 font-medium leading-relaxed line-clamp-2">
                      {n.body}
                    </p>
                  </div>
                  {isUnread && (
                    <span className="w-2 h-2 rounded-full bg-indigo-600 shrink-0 mt-1 shadow-xs" title="Unread notice" />
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
