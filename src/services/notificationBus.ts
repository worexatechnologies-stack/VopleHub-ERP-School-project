import { playNotificationSound, NotificationSoundType } from './notificationSound';

export type NotificationTone = 'info' | 'success' | 'warning' | 'danger';

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  tone: NotificationTone;
  timestamp: string;
  read: boolean;
  source?: string;
  conversationId?: number;
  senderId?: number;
  senderName?: string;
  related?: any;
}

export const NOTIFICATION_EVENT = 'volpehub:notification';

export function isUserFacingNotificationContent(title: string, message: string): boolean {
  const content = `${title} ${message}`.toLowerCase();
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

export function emitNotification(input: {
  title: string;
  message: string;
  tone?: NotificationTone;
  source?: string;
  skipSound?: boolean;
  conversationId?: number;
  senderId?: number;
  senderName?: string;
  related?: any;
}): AppNotification | null {
  if (!isUserFacingNotificationContent(input.title, input.message)) {
    return null;
  }

  const notification: AppNotification = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: input.title,
    message: input.message,
    tone: input.tone || 'info',
    timestamp: new Date().toISOString(),
    read: false,
    source: input.source,
    conversationId: input.conversationId,
    senderId: input.senderId,
    senderName: input.senderName,
    related: input.related,
  };

  // Play pleasant audible notification chime for every dashboard / in-app notification
  if (!input.skipSound) {
    const soundType: NotificationSoundType =
      notification.tone === 'danger'
        ? 'urgent'
        : notification.tone === 'success'
          ? 'success'
          : notification.tone === 'warning'
            ? 'warning'
            : 'default';

    void playNotificationSound({ type: soundType });
  }

  window.dispatchEvent(new CustomEvent<AppNotification>(NOTIFICATION_EVENT, { detail: notification }));
  return notification;
}
