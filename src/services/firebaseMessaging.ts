import { getApp, getApps, initializeApp } from 'firebase/app';
import { getMessaging, getToken, isSupported, onMessage, type MessagePayload, type Messaging } from 'firebase/messaging';

import { store } from '../store';
import { notificationApi } from '../store/api/notificationApi';

const PUSH_TOKEN_STORAGE_KEY = 'erp_fcm_device_token';
const TOKEN_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};
const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';

let messagingPromise: Promise<Messaging | null> | null = null;
let serviceWorkerPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export const isFirebaseMessagingConfigured = () => Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.messagingSenderId && firebaseConfig.appId && vapidKey,
);

function deviceName(): string {
  const browserNavigator = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = browserNavigator.userAgentData?.platform || navigator.platform || 'Browser';
  return `Web browser (${platform})`.slice(0, 160);
}

async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (serviceWorkerPromise) return serviceWorkerPromise;
  serviceWorkerPromise = (async () => {
    if (!('serviceWorker' in navigator) || !isFirebaseMessagingConfigured()) return null;
    // Firebase configuration is public by design. Supplying it in the worker
    // URL lets the root-level worker initialize in both Vite dev and prod
    // without exposing any server-side Firebase Admin credential.
    const workerUrl = new URL('/firebase-messaging-sw.js', window.location.origin);
    Object.entries(firebaseConfig).forEach(([key, value]) => workerUrl.searchParams.set(key, value));
    return navigator.serviceWorker.register(workerUrl.toString(), { scope: '/' });
  })();
  return serviceWorkerPromise;
}

async function getFirebaseMessaging(): Promise<Messaging | null> {
  if (!isFirebaseMessagingConfigured()) return null;
  if (messagingPromise) return messagingPromise;
  messagingPromise = (async () => {
    if (!(await isSupported())) return null;
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    return getMessaging(app);
  })();
  return messagingPromise;
}

export type PushRegistrationResult = {
  permission: NotificationPermission | 'unsupported' | 'not-configured';
  registered: boolean;
};

/** Request browser permission only from a user gesture, then register the FCM token. */
export async function enablePushNotifications(): Promise<PushRegistrationResult> {
  if (!isFirebaseMessagingConfigured()) return { permission: 'not-configured', registered: false };
  if (!('Notification' in window)) return { permission: 'unsupported', registered: false };
  const permission = Notification.permission === 'default'
    ? await Notification.requestPermission()
    : Notification.permission;
  if (permission !== 'granted') return { permission, registered: false };
  return { permission, registered: await syncFcmDeviceToken() };
}

/**
 * Calls getToken every time it runs. Firebase returns the current token and
 * rotates it when needed; the previous token is deactivated server-side.
 */
export async function syncFcmDeviceToken(): Promise<boolean> {
  if (!isFirebaseMessagingConfigured() || !('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    const [messaging, serviceWorkerRegistration] = await Promise.all([getFirebaseMessaging(), getServiceWorkerRegistration()]);
    if (!messaging || !serviceWorkerRegistration) return false;
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration });
    if (!token) return false;
    const previousToken = localStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
    if (previousToken && previousToken !== token) {
      await store.dispatch(notificationApi.endpoints.unregisterFcmDevice.initiate({ token: previousToken })).unwrap();
    }
    await store.dispatch(notificationApi.endpoints.registerFcmDevice.initiate({ token, deviceName: deviceName() })).unwrap();
    localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
    return true;
  } catch {
    // Permission, offline, or Firebase configuration failures must not block
    // login or the rest of the school application.
    return false;
  }
}

/** Mark this browser token inactive before the JWT session is cleared. */
export async function deactivateFcmDeviceToken(): Promise<void> {
  const token = localStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
  if (!token) return;
  try {
    await store.dispatch(notificationApi.endpoints.unregisterFcmDevice.initiate({ token })).unwrap();
  } finally {
    localStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
  }
}

export async function subscribeToForegroundMessages(handler: (payload: MessagePayload) => void): Promise<() => void> {
  const messaging = await getFirebaseMessaging();
  return messaging ? onMessage(messaging, handler) : () => undefined;
}

/** Keep tokens fresh while the user is logged in and when a tab regains focus. */
export function startFcmTokenRefresh(onError?: (error: unknown) => void): () => void {
  const refresh = () => { void syncFcmDeviceToken().catch(onError); };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') refresh();
  };
  refresh();
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', onVisibilityChange);
  const interval = window.setInterval(refresh, TOKEN_REFRESH_INTERVAL_MS);
  return () => {
    window.clearInterval(interval);
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
