import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Check, CheckCheck, Volume2, VolumeX, X, Play, Music } from 'lucide-react';
import { AppNotification, emitNotification, NOTIFICATION_EVENT, NotificationTone } from '../services/notificationBus';
import {
  isNotificationSoundEnabled,
  setNotificationSoundEnabled,
  testNotificationSound,
  unlockAudioContext,
  getNotificationSoundVolume,
  setNotificationSoundVolume,
} from '../services/notificationSound';
import { enablePushNotifications, isFirebaseMessagingConfigured } from '../services/firebaseMessaging';
import {
  useGetNotificationsQuery,
  useMarkNotificationReadMutation,
  useClearAllNotificationsMutation,
} from '../store/api/notificationApi';
import { useAppSelector } from '../store';
import { chatSocket } from '../services/chatSocket';
import { ACCESS_TOKEN_STORAGE_KEY } from '../utils/auth';

const STORAGE_KEY = 'erp_live_notifications';

interface NotificationCenterProps {
  logs?: string[];
  isGlass?: boolean;
  is3D?: boolean;
}

function isUserFacingItem(item: AppNotification): boolean {
  if (!item || !item.message) return false;
  const content = `${item.title || ''} ${item.message || ''}`.toLowerCase();
  if (
    content.includes('authenticated via jwt') ||
    content.includes('[authentication]') ||
    content.includes('access granted') ||
    content.includes('firebase web configuration') ||
    content.includes('push setup pending') ||
    (content.includes('system activity') && content.includes('jwt'))
  ) {
    return false;
  }
  return true;
}

function loadNotifications(): AppNotification[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isUserFacingItem);
  } catch {
    return [];
  }
}

export default function NotificationCenter({ logs = [], isGlass = false, is3D = false }: NotificationCenterProps) {
  const [notifications, setNotifications] = useState<AppNotification[]>(loadNotifications);
  const [isOpen, setIsOpen] = useState(false);
  const currentUser = useAppSelector((state) => state.auth.user);
  const [toast, setToast] = useState<AppNotification | null>(null);
  const [soundEnabled, setSoundEnabledState] = useState(isNotificationSoundEnabled);
  const [soundVolume, setSoundVolumeState] = useState(getNotificationSoundVolume);
  const [isTestingSound, setIsTestingSound] = useState(false);
  const toastTimer = useRef<number | null>(null);

  // Poll server notifications for authenticated user to detect real-time incoming notices
  const hasAuthToken = Boolean(typeof window !== 'undefined' && localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY));
  const { data: serverNotifications = [] } = useGetNotificationsQuery(undefined, {
    pollingInterval: 6000,
    skip: !hasAuthToken,
  });

  const [markServerNotificationRead] = useMarkNotificationReadMutation();
  const [clearAllServerNotifications] = useClearAllNotificationsMutation();

  const knownServerIds = useRef<Set<number>>(new Set());
  const isInitialSync = useRef(true);

  // Real-time WebSocket listener for immediate instant chat message delivery
  useEffect(() => {
    if (!hasAuthToken || !currentUser?.id) return;
    chatSocket.connect();

    const unsubChat = chatSocket.on('message.created', (newMsg: any) => {
      // 1. If I am the sender, NEVER show an alert/toast to myself!
      if (newMsg.senderId === currentUser.id || newMsg.isMe) {
        return;
      }

      // 2. If the user is currently actively viewing this conversation, do not show duplicate intrusive toast
      if (chatSocket.activeConversationId && chatSocket.activeConversationId === newMsg.conversationId) {
        return;
      }

      // 3. To whom the message is sent: Show immediate notification toast with sound!
      emitNotification({
        title: `New Message from ${newMsg.senderName || 'Parent / Teacher'}`,
        message: newMsg.body || 'Sent an attachment',
        tone: 'info',
        source: 'chat',
      });
    });

    return () => {
      unsubChat();
    };
  }, [hasAuthToken, currentUser?.id]);

  // Detect and announce newly arrived backend notices in real-time, and merge with display state
  useEffect(() => {
    if (!serverNotifications || serverNotifications.length === 0) return;

    const brandNewItems = isInitialSync.current
      ? []
      : serverNotifications.filter((n) => {
          if (knownServerIds.current.has(n.id)) return false;
          // Crucial: The sender must NEVER receive incoming notification alerts for their own message or notice!
          if (currentUser?.id && n.senderId && n.senderId === currentUser.id) return false;
          if (currentUser?.id && n.recipientId && n.recipientId !== currentUser.id) return false;
          return true;
        });

    // Register all server IDs
    serverNotifications.forEach((n) => knownServerIds.current.add(n.id));
    isInitialSync.current = false;

    // Convert server notices to app notification models (filtering out outgoing items)
    const serverItems: AppNotification[] = serverNotifications
      .filter((n) => {
        if (currentUser?.id && n.senderId && n.senderId === currentUser.id && n.recipientId !== currentUser.id) {
          return false;
        }
        return true;
      })
      .map((n): AppNotification => {
        let tone: NotificationTone = 'info';
        if (n.category === 'Urgent' || n.category === 'Attendance Alert') {
          tone = 'danger';
        } else if (n.category === 'Finance' || n.category === 'Salary') {
          tone = 'success';
        } else if (n.category === 'Homework' || n.category === 'Academic') {
          tone = 'info';
        }

        return {
          id: `server-${n.id}`,
          title: n.title || 'School Notice',
          message: n.body || '',
          tone,
          timestamp: n.createdAt || n.created_at || new Date().toISOString(),
          read: Boolean(n.readAt || n.read_at),
          source: n.channel || 'school-server',
        };
      })
      .filter(isUserFacingItem);

    // Merge into local state
    setNotifications((prev) => {
      const map = new Map<string, AppNotification>();
      // Preserve local-only items (not from server)
      prev.filter((item) => !item.id.startsWith('server-')).forEach((item) => map.set(item.id, item));
      // Add or update server items
      serverItems.forEach((item) => map.set(item.id, item));
      return Array.from(map.values())
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 100);
    });

    // Alert for newly incoming notices
    if (brandNewItems.length > 0) {
      brandNewItems.forEach((n) => {
        emitNotification({
          title: n.title || 'New school notice',
          message: n.body || 'Open the notifications panel for full details.',
          tone: n.category === 'Urgent' || n.category === 'Attendance Alert' ? 'danger' : 'info',
          source: 'school-server',
        });
      });
    }
  }, [serverNotifications, currentUser?.id]);

  const unreadCount = useMemo(() => notifications.filter((item) => !item.read).length, [notifications]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.filter(isUserFacingItem).slice(0, 60)));
  }, [notifications]);

  // Listen to in-app & server notification events
  useEffect(() => {
    const onNotification = (event: Event) => {
      const item = (event as CustomEvent<AppNotification>).detail;
      if (!item || !isUserFacingItem(item)) return;

      setNotifications((prev) => [item, ...prev.filter((p) => p.id !== item.id)].slice(0, 100));
      setToast(item);

      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToast(null), 5500);

      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(item.title, {
            body: item.message,
            tag: item.id,
            silent: !soundEnabled,
          });
        } catch {
          // Native notification error ignored
        }
      }
    };

    window.addEventListener(NOTIFICATION_EVENT, onNotification);
    return () => window.removeEventListener(NOTIFICATION_EVENT, onNotification);
  }, [soundEnabled]);

  const handleToggleSound = () => {
    const nextState = !soundEnabled;
    setSoundEnabledState(nextState);
    setNotificationSoundEnabled(nextState);
    unlockAudioContext();
    if (nextState) {
      void testNotificationSound('default');
    }
  };

  const handleTestSound = async () => {
    setIsTestingSound(true);
    unlockAudioContext();
    await testNotificationSound('default');
    setTimeout(() => setIsTestingSound(false), 500);
  };

  const handleVolumeChange = (newVol: number) => {
    setSoundVolumeState(newVol);
    setNotificationSoundVolume(newVol);
    unlockAudioContext();
    void testNotificationSound('default');
  };

  const requestPermission = async () => {
    setSoundEnabledState(true);
    setNotificationSoundEnabled(true);
    unlockAudioContext();
    void testNotificationSound('success');
    const result = await enablePushNotifications();
    if (result.registered) {
      emitNotification({
        title: 'Push notifications enabled',
        message: 'This device will receive school notices and sound alerts in real-time.',
        tone: 'success',
        source: 'fcm',
      });
    } else if (result.permission === 'denied') {
      emitNotification({
        title: 'Push notifications blocked',
        message: 'Allow notifications in your browser settings to receive alert chimes.',
        tone: 'warning',
        source: 'fcm',
      });
    }
  };

  const handleMarkItemRead = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (id.startsWith('server-')) {
      const numericId = parseInt(id.replace('server-', ''), 10);
      if (!isNaN(numericId)) {
        void markServerNotificationRead(numericId);
      }
    }
    setNotifications((prev) => prev.map((item) => (item.id === id ? { ...item, read: true } : item)));
  };

  const markAllRead = () => {
    // Mark all server notifications read
    notifications.forEach((item) => {
      if (!item.read && item.id.startsWith('server-')) {
        const numericId = parseInt(item.id.replace('server-', ''), 10);
        if (!isNaN(numericId)) {
          void markServerNotificationRead(numericId);
        }
      }
    });
    setNotifications((prev) => prev.map((item) => ({ ...item, read: true })));
  };

  const clearAll = () => {
    try {
      void clearAllServerNotifications();
    } catch {
      // Ignored if forbidden
    }
    setNotifications([]);
    setToast(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  const buttonClass = `w-8 h-8 rounded-full transition-all flex items-center justify-center relative border cursor-pointer ${
    isGlass
      ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white'
      : is3D
        ? 'bg-white border-slate-200 text-slate-600 hover:text-indigo-600 shadow-[2px_2px_5px_rgba(163,177,198,0.15)] hover:translate-y-[-1px] active:translate-y-[1px]'
        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-indigo-600 hover:shadow-xs'
  }`;

  return (
    <div className="relative">
      <button
        onClick={() => {
          unlockAudioContext();
          setIsOpen((value) => !value);
        }}
        className={buttonClass}
        title="Notifications & Sound Alerts"
        aria-label="Notifications"
        id="btn-header-notifications"
      >
        <Bell className="w-3.5 h-3.5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 grid min-h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-white bg-rose-500 px-1 text-[9px] font-black text-white animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="notification-popover absolute right-0 top-11 z-50 w-[380px] overflow-hidden rounded-2xl shadow-2xl border border-slate-700/50 bg-slate-950/95 backdrop-blur-xl">
          <div className="notification-popover__header flex items-center justify-between p-4 border-b border-white/10 bg-slate-900/80">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-extrabold text-white">Live notifications</p>
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-bold text-indigo-300">
                  <span className={`h-1.5 w-1.5 rounded-full ${soundEnabled ? 'bg-emerald-400 animate-ping' : 'bg-slate-500'}`} />
                  {soundEnabled ? 'Sound ON' : 'Muted'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Activity inbox & real-time chime alerts</p>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white transition cursor-pointer"
              aria-label="Close notifications"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Sound alert control bar */}
          <div className="flex items-center justify-between border-b border-white/10 bg-slate-900/60 px-4 py-2.5 text-xs text-slate-300">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleSound}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
                  soundEnabled
                    ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                    : 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
                }`}
                title={soundEnabled ? 'Mute notification sounds' : 'Enable notification sounds'}
              >
                {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                {soundEnabled ? 'Sound Active' : 'Sound Muted'}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTestSound}
                className={`flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:bg-white/10 hover:text-white transition cursor-pointer ${
                  isTestingSound ? 'scale-95 text-indigo-300 border-indigo-400' : ''
                }`}
                title="Click to test notification sound"
              >
                <Music className="h-3 w-3 text-indigo-400" />
                <span>Hear Sound</span>
              </button>
            </div>
          </div>

          <div className="notification-popover__actions flex gap-2 p-3 border-b border-white/5 bg-slate-900/40">
            <button
              onClick={() => void requestPermission()}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-indigo-500 transition shadow-sm cursor-pointer"
              title={
                isFirebaseMessagingConfigured()
                  ? 'Enable browser push notifications & background sound'
                  : 'Enable desktop notifications & alert chime'
              }
            >
              <Volume2 className="h-3.5 w-3.5" />
              Enable Push & Sound
            </button>
            <button
              onClick={markAllRead}
              className="flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-[11px] font-bold text-slate-200 hover:bg-white/15 transition cursor-pointer"
              title="Mark all as read"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              <span>Mark all read</span>
            </button>
          </div>

          <div className="notification-popover__body max-h-96 overflow-y-auto p-3">
            {notifications.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 p-5 text-center text-xs text-slate-400">
                <Bell className="mx-auto mb-2 h-5 w-5 text-slate-500 opacity-60" />
                No notifications yet. New timetable, fees, attendance, notices and system alerts will arrive here with an audible chime.
              </div>
            ) : (
              notifications.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleMarkItemRead(item.id)}
                  className={`notification-popover__item mb-2.5 rounded-xl p-3 transition border cursor-pointer hover:border-indigo-400/40 ${
                    item.read
                      ? 'border-white/5 bg-slate-900/30 opacity-70'
                      : 'border-indigo-500/40 bg-indigo-950/30 shadow-xs'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className={`text-xs font-extrabold ${item.read ? 'text-slate-300' : 'text-white'}`}>
                          {item.title}
                        </p>
                        {item.tone === 'danger' && (
                          <span className="rounded bg-rose-500/30 px-1 py-0.2 text-[9px] font-bold text-rose-300">
                            Urgent
                          </span>
                        )}
                        {item.tone === 'success' && (
                          <span className="rounded bg-emerald-500/30 px-1 py-0.2 text-[9px] font-bold text-emerald-300">
                            Success
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-300">{item.message}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {!item.read ? (
                        <span className="mt-1 h-2 w-2 rounded-full bg-rose-500 shadow-xs shadow-rose-500" />
                      ) : (
                        <Check className="h-3 w-3 text-emerald-400" />
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[9px] text-slate-500 font-mono">
                    <time>{new Date(item.timestamp).toLocaleString()}</time>
                    <span className="text-[9px] uppercase tracking-wider text-slate-400">{item.source || 'notice'}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {notifications.length > 0 && (
            <button
              onClick={clearAll}
              className="notification-popover__clear w-full border-t border-white/5 px-4 py-3 text-xs font-bold text-slate-400 hover:text-white hover:bg-white/5 transition cursor-pointer"
            >
              Clear all notifications
            </button>
          )}
        </div>
      )}

      {/* Floating Dashboard Notification Toast with Audio Wave Indicator */}
      {toast && (
        <div className="fixed right-5 top-20 z-[999] w-[340px] animate-fade-in rounded-2xl border border-indigo-200 bg-white/95 backdrop-blur-md p-4 text-slate-900 shadow-2xl shadow-indigo-500/25 transition-all">
          <div className="flex items-start gap-3">
            <span
              className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white shadow-xs ${
                toast.tone === 'danger'
                  ? 'bg-gradient-to-br from-rose-500 to-rose-600'
                  : toast.tone === 'success'
                    ? 'bg-gradient-to-br from-emerald-500 to-emerald-600'
                    : 'bg-gradient-to-br from-indigo-500 to-indigo-600'
              }`}
            >
              <Bell className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-extrabold text-slate-900 truncate">{toast.title}</p>
                {soundEnabled && (
                  <span
                    className="inline-flex items-center text-indigo-600"
                    title="Notification sound played"
                  >
                    <Volume2 className="h-3 w-3 animate-pulse" />
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 line-clamp-2">{toast.message}</p>
            </div>
            <button
              onClick={() => setToast(null)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition cursor-pointer"
              aria-label="Dismiss notification"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
