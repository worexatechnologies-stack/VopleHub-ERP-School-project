import { useEffect } from 'react';

import { startFcmTokenRefresh, subscribeToForegroundMessages } from '../services/firebaseMessaging';
import { emitNotification } from '../services/notificationBus';

interface PushNotificationManagerProps {
  enabled: boolean;
}

/** Bridges Firebase foreground messages into the existing in-app notification UI. */
export default function PushNotificationManager({ enabled }: PushNotificationManagerProps) {
  useEffect(() => {
    if (!enabled) return;
    let unsubscribe: () => void = () => undefined;
    void subscribeToForegroundMessages((payload) => {
      const notification = payload.notification;
      emitNotification({
        title: notification?.title || 'New school notification',
        message: notification?.body || 'Open the notification center for details.',
        tone: 'info',
        source: 'fcm',
      });
    }).then((cleanup) => { unsubscribe = cleanup; });
    const stopRefresh = startFcmTokenRefresh();
    return () => {
      unsubscribe();
      stopRefresh();
    };
  }, [enabled]);

  return null;
}
