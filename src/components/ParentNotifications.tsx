import {
  AlertTriangle,
  Bell,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  Clock3,
  Filter,
  GraduationCap,
  Megaphone,
  RefreshCw,
  Search,
  Users,
  Volume2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Student } from '../types';
import {
  useGetNotificationsQuery,
  useMarkNotificationReadMutation,
} from '../store/api/notificationApi';
import { useGetStudentsQuery } from '../store/api/studentApi';
import { testNotificationSound } from '../services/notificationSound';
import { useAppSelector } from '../store';

type ParentNotification = {
  id: number;
  senderName: string;
  category: string;
  title: string;
  body: string;
  channel?: string;
  readAt: string | null;
  createdAt: string;
  related_object?: Record<string, any>;
};

const REFRESH_INTERVAL_MS = 10_000;

interface ParentNotificationsProps {
  onNavigateToTab?: (tabId: string) => void;
}

export default function ParentNotifications({ onNavigateToTab }: ParentNotificationsProps) {
  const currentUser = useAppSelector((state) => state.auth.user);
  const isParent = currentUser?.role === 'Parent';
  const isServerBacked = Boolean(localStorage.getItem('school_erp_api_token'));
  const { data: wards = [], isLoading: wardsLoading } = useGetStudentsQuery(undefined, {
    skip: !isServerBacked || !isParent,
  });
  const {
    data: rawNotifications = [],
    isLoading: loading,
    refetch: refetchNotifications,
  } = useGetNotificationsQuery(undefined, {
    skip: !isServerBacked,
    pollingInterval: REFRESH_INTERVAL_MS,
  });
  const [markNotificationRead] = useMarkNotificationReadMutation();

  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(new Date());
  const [selectedWardId, setSelectedWardId] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    if (wards.length > 0) {
      if (!selectedWardId || selectedWardId === 'all' || !wards.some((w) => String(w.id) === selectedWardId)) {
        setSelectedWardId(String(wards[0].id));
      }
    }
  }, [wards, selectedWardId]);

  const items = useMemo<ParentNotification[]>(
    () =>
      (rawNotifications || []).map((n) => ({
        id: n.id,
        senderName: n.senderName || n.sender?.name || 'School Notice',
        category: n.category || 'General',
        title: n.title,
        body: n.body,
        channel: n.channel,
        readAt: n.readAt || n.read_at || null,
        createdAt: n.createdAt || n.created_at || new Date().toISOString(),
        related_object: n.related_object,
      })),
    [rawNotifications]
  );

  useEffect(() => {
    setUpdatedAt(new Date());
  }, [rawNotifications]);

  const activeWard = useMemo(() => {
    if (wards.length === 0) return null;
    return wards.find((w) => String(w.id) === selectedWardId) || wards[0] || null;
  }, [wards, selectedWardId]);

  const markRead = async (id: number) => {
    try {
      await markNotificationRead(id).unwrap();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not update this notice.');
    }
  };

  const markAllRead = async () => {
    const unreadItems = filteredItems.filter((item) => !item.readAt);
    try {
      await Promise.all(
        unreadItems.map((item) => markNotificationRead(item.id).unwrap())
      );
    } catch {
      void refetchNotifications();
    }
  };

  // Helper to normalize class string (e.g., "Class 5", "5", "class-5" -> "5")
  const cleanClassName = (raw: string) => {
    return raw
      .replace(/class/gi, '')
      .replace(/grade/gi, '')
      .replace(/standard/gi, '')
      .replace(/std/gi, '')
      .replace(/[-_ ]/g, '')
      .trim()
      .toLowerCase();
  };

  // Helper to test if a notice applies to a specific child
  const isNoticeForWard = useCallback((item: ParentNotification, ward: Student) => {
    const wardClassClean = cleanClassName(ward.class || '');
    const wardSection = (ward.section || '').trim().toLowerCase();
    const wardName = (ward.name || '').trim().toLowerCase();
    const wardAdm = (ward.admissionNo || '').trim().toLowerCase();
    const related = item.related_object || {};

    // 1. Explicit student ID match
    if (related.studentId) {
      if (String(related.studentId) !== String(ward.id)) {
        return false;
      }
      return true;
    }
    if (Array.isArray(related.studentIds) && related.studentIds.length > 0) {
      if (related.studentIds.some((id: any) => String(id) === String(ward.id))) {
        return true;
      }
      return false;
    }

    // 2. Explicit student Name match
    if (related.studentName && String(related.studentName).trim()) {
      if (String(related.studentName).trim().toLowerCase() !== wardName) {
        return false;
      }
      return true;
    }
    if (Array.isArray(related.studentNames) && related.studentNames.length > 0) {
      if (related.studentNames.some((n: any) => String(n).trim().toLowerCase() === wardName)) {
        return true;
      }
      return false;
    }

    // 3. Target class & section match in related metadata
    const targetClass = String(related.targetClass || related.class_name || '').trim();
    const targetSection = String(related.targetSection || related.section || '').trim().toLowerCase();

    if (targetClass && targetClass !== 'all' && targetClass !== 'All') {
      const targetClassClean = cleanClassName(targetClass);
      const classMatches =
        targetClassClean === wardClassClean ||
        targetClassClean.includes(wardClassClean) ||
        wardClassClean.includes(targetClassClean);

      if (!classMatches) {
        return false; // Specifically targeted to another class
      }

      if (targetSection && targetSection !== 'all' && targetSection !== 'All') {
        return targetSection === wardSection || targetSection.includes(wardSection);
      }
      return true;
    }

    // 4. Mentioned in title or body text
    const titleLower = item.title.toLowerCase();
    const bodyLower = item.body.toLowerCase();

    if (wardName && (titleLower.includes(wardName) || bodyLower.includes(wardName))) {
      return true;
    }
    if (wardAdm && (titleLower.includes(wardAdm) || bodyLower.includes(wardAdm))) {
      return true;
    }

    // If another class is explicitly mentioned in title/body (e.g. "Class 8 notice" when this ward is in Class 5), check exclusion
    if (wardClassClean) {
      const hasOtherClass = wards.some((other) => {
        if (String(other.id) === String(ward.id)) return false;
        const otherClean = cleanClassName(other.class || '');
        return (
          otherClean &&
          otherClean !== wardClassClean &&
          (titleLower.includes(`class ${otherClean}`) || bodyLower.includes(`class ${otherClean}`))
        );
      });
      if (hasOtherClass && !titleLower.includes(wardClassClean) && !bodyLower.includes(wardClassClean)) {
        return false;
      }
    }

    // 5. School-wide announcements apply to all children
    return true;
  }, [wards]);

  // Filter items based on selected child, category, and search query
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Child Filter (Only for parent with linked children)
      if (isParent && activeWard) {
        if (!isNoticeForWard(item, activeWard)) {
          return false;
        }
      }

      // Category Filter
      if (categoryFilter !== 'all') {
        if (item.category.toLowerCase() !== categoryFilter.toLowerCase()) {
          return false;
        }
      }

      // Search Filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = item.title.toLowerCase().includes(query);
        const matchesBody = item.body.toLowerCase().includes(query);
        const matchesSender = item.senderName.toLowerCase().includes(query);
        const matchesCategory = item.category.toLowerCase().includes(query);
        if (!matchesTitle && !matchesBody && !matchesSender && !matchesCategory) {
          return false;
        }
      }

      return true;
    });
  }, [items, isParent, activeWard, categoryFilter, searchQuery, isNoticeForWard]);

  // Notice counts per child
  const childNoticeCounts = useMemo(() => {
    if (!isParent) return {};
    const map: Record<string, number> = {};
    wards.forEach((w) => {
      map[String(w.id)] = items.filter((item) => isNoticeForWard(item, w)).length;
    });
    return map;
  }, [items, wards, isParent, isNoticeForWard]);

  const unreadCount = filteredItems.filter((item) => !item.readAt).length;

  return (
    <section className="space-y-5 animate-fade-in pb-12" id="parent-school-notices">
      {/* Header Banner with Ward Switcher Dropdown */}
      <header className="portal-header-card flex flex-col lg:flex-row justify-between lg:items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-md shadow-indigo-100 shrink-0">
            <Bell className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="portal-pill-badge indigo">{isParent ? 'Parent Portal' : currentUser?.role || 'School Portal'}</span>
              <span className="text-[11px] font-bold text-slate-400">Official Announcements</span>
            </div>
            <h1 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">
              {isParent ? 'School Notices & Circulars' : currentUser?.role === 'Teacher' ? 'Teacher Notices & Schedules' : 'School Notices & Bulletins'}
            </h1>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Official circulars, timetable notices, class alerts, and school-wide announcements.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 self-start lg:self-center">
          {/* Ward Switcher Dropdown (Parents only) */}
          {isParent && wards.length > 0 && (
            <div className="bg-slate-50 p-2.5 rounded-2xl border border-slate-200/80">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 px-1">
                Select Child
              </label>
              <select
                value={selectedWardId}
                onChange={(e) => setSelectedWardId(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 shadow-2xs focus:outline-none focus:ring-2 focus:ring-indigo-400 cursor-pointer"
              >
                {wards.map((w) => (
                  <option key={w.id} value={String(w.id)}>
                    {w.name} ({w.class} {w.section ? `- ${w.section}` : ''})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="rounded-2xl bg-indigo-50/80 border border-indigo-100 px-4 py-2.5 text-center">
            <p className="text-2xl font-black text-indigo-700">{unreadCount}</p>
            <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Unread</p>
          </div>

          <button
            type="button"
            onClick={() => void testNotificationSound('default')}
            className="flex items-center gap-1.5 rounded-2xl border border-indigo-200 bg-white px-3.5 py-3 text-xs font-bold text-indigo-700 hover:bg-indigo-50 shadow-2xs transition cursor-pointer"
            title="Click to test notification chime sound"
          >
            <Volume2 className="h-4 w-4 text-indigo-600" />
            <span className="hidden sm:inline">Hear Sound</span>
          </button>
        </div>
      </header>

      {/* Quick Child Filter Pills (Instant One-Click Child Switching) */}
      {isParent && wards.length > 0 && (
        <div className="portal-card p-3.5 flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-rose-500" /> Child:
          </span>
          {wards.map((w) => {
            const isSelected = selectedWardId === String(w.id);
            const count = childNoticeCounts[String(w.id)] ?? 0;
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => setSelectedWardId(String(w.id))}
                className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  isSelected
                    ? 'bg-rose-500 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <span>{w.name}</span>
                <span
                  className={`rounded-md px-1.5 py-0.2 text-[10px] font-mono font-bold ${
                    isSelected ? 'bg-white/25 text-white' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {w.class}
                  {w.section ? `-${w.section}` : ''}
                </span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    isSelected ? 'bg-white/30 text-white' : 'bg-rose-100 text-rose-700'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Active Child Context Bar */}
      {activeWard && (
        <div className="rounded-2xl border border-rose-200 bg-linear-to-r from-rose-50/80 to-white p-4 shadow-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-rose-500 text-white flex items-center justify-center font-black text-sm shadow-xs">
              {activeWard.name ? activeWard.name.charAt(0).toUpperCase() : 'S'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">{activeWard.name}</h3>
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                  Class {activeWard.class} {activeWard.section ? `· Section ${activeWard.section}` : ''}
                </span>
                {activeWard.admissionNo && (
                  <span className="text-[11px] font-mono text-slate-500 font-semibold">
                    Adm: {activeWard.admissionNo}
                  </span>
                )}
              </div>
              <p className="text-[11px] font-medium text-slate-500 mt-0.5">
                Showing notices targeted to <strong>{activeWard.name}</strong>, Class <strong>{activeWard.class}</strong>, and school-wide announcements
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Filter & Search Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search notices & circulars..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50/50 pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:border-rose-400 focus:bg-white focus:outline-none w-48 sm:w-64"
            />
          </div>

          <div className="flex items-center gap-1">
            {['all', 'urgent', 'meeting', 'academic', 'general'].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider transition cursor-pointer ${
                  categoryFilter === cat
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {unreadCount > 0 && (
            <button
              onClick={() => void markAllRead()}
              className="text-xs font-bold text-emerald-700 hover:text-emerald-900 hover:underline cursor-pointer"
            >
              Mark all as read
            </button>
          )}

          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            <Clock3 className="h-3.5 w-3.5 text-rose-500" />
            {updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : 'Loading notices...'}
          </p>

          <button
            onClick={() => void refetchNotifications()}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-50 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading || wardsLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
          {error}
        </p>
      )}

      {/* Notices Feed */}
      <div className="space-y-3">
        {!loading && filteredItems.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
            <Bell className="mx-auto h-8 w-8 text-rose-400" />
            <h2 className="mt-3 text-base font-extrabold text-slate-900">No school notices found</h2>
            <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">
              {activeWard
                ? `No notices specifically targeting ${activeWard.name} (Class ${activeWard.class}) right now.`
                : searchQuery || categoryFilter !== 'all'
                ? 'No notices match your active search or category filter.'
                : 'New notices from your School Admin and teachers will appear here automatically.'}
            </p>
          </div>
        )}

        {filteredItems.map((item) => {
          const isUrgent = item.category?.toLowerCase() === 'urgent';
          const isMeeting = item.category?.toLowerCase() === 'meeting';
          const related = item.related_object || {};
          const targetClass = String(related.targetClass || related.class_name || '').trim();
          const targetSection = String(related.targetSection || related.section || '').trim();

          // Identify matching children for this notice
          const matchingWards = wards.filter((w) => isNoticeForWard(item, w));

          return (
            <article
              key={item.id}
              className={`rounded-2xl border bg-white p-5 shadow-xs transition-all hover:border-rose-200 ${
                item.readAt
                  ? 'border-slate-200'
                  : isUrgent
                  ? 'border-rose-300 ring-2 ring-rose-100 bg-rose-50/20'
                  : 'border-rose-200 ring-1 ring-rose-100'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                        isUrgent
                          ? 'bg-rose-600 text-white'
                          : isMeeting
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-50 text-rose-700'
                      }`}
                    >
                      {item.category}
                    </span>

                    {/* Child Target Scope Badge */}
                    {targetClass ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[10px] font-bold text-indigo-700 border border-indigo-100">
                        <GraduationCap className="h-3 w-3 text-indigo-500" />
                        Class {targetClass} {targetSection ? `(${targetSection})` : ''}
                        {matchingWards.length > 0 && (
                          <span className="font-semibold text-indigo-900">
                            · {matchingWards.map((w) => w.name).join(', ')}
                          </span>
                        )}
                      </span>
                    ) : matchingWards.length > 0 && matchingWards.length < wards.length ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-100">
                        <Users className="h-3 w-3 text-emerald-500" />
                        For {matchingWards.map((w) => w.name).join(', ')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-600">
                        <Megaphone className="h-3 w-3 text-slate-500" />
                        School-Wide Announcement
                      </span>
                    )}

                    {!item.readAt && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                        New
                      </span>
                    )}
                  </div>

                  <h2 className="mt-3 text-base font-extrabold text-slate-900 flex items-center gap-2">
                    {isUrgent && <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />}
                    {item.title}
                  </h2>

                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-600 font-medium">
                    {item.body}
                  </p>

                  {item.category === 'Homework' && onNavigateToTab && (
                    <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-xs font-bold text-blue-600 flex items-center gap-1.5">
                        <BookOpen className="h-3.5 w-3.5" />
                        Class Homework Assignment
                      </span>
                      <button
                        type="button"
                        onClick={() => onNavigateToTab('homework')}
                        className="rounded-xl bg-blue-50 px-3 py-1 text-xs font-black text-blue-700 hover:bg-blue-100 transition cursor-pointer"
                      >
                        Open Class Homework →
                      </button>
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] font-semibold text-slate-400">
                    <span>From {item.senderName}</span>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(item.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}{' '}
                      at{' '}
                      {new Date(item.createdAt).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>

                {!item.readAt && (
                  <button
                    onClick={() => void markRead(item.id)}
                    className="shrink-0 rounded-xl border border-emerald-200 bg-emerald-50/50 px-3.5 py-2 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 transition shadow-2xs cursor-pointer flex items-center gap-1"
                  >
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    Mark as read
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
