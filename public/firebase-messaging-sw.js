/* Firebase Messaging background worker. Firebase web configuration is public;
   Firebase Admin service-account credentials never appear in this file. */
importScripts('https://www.gstatic.com/firebasejs/12.17.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.17.1/firebase-messaging-compat.js');

const parameters = new URL(self.location.href).searchParams;
const firebaseConfig = {
  apiKey: parameters.get('apiKey'),
  authDomain: parameters.get('authDomain'),
  projectId: parameters.get('projectId'),
  storageBucket: parameters.get('storageBucket'),
  messagingSenderId: parameters.get('messagingSenderId'),
  appId: parameters.get('appId'),
};

if (firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.messagingSenderId && firebaseConfig.appId) {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const notification = payload.notification || {};
    const data = payload.data || {};
    const clickUrl = typeof data.clickUrl === 'string' && data.clickUrl.startsWith('/') ? data.clickUrl : '/app';
    self.registration.showNotification(notification.title || 'School ERP', {
      body: notification.body || 'You have a new school notification.',
      icon: '/favicon.ico',
      tag: data.notificationId || undefined,
      data: { clickUrl },
    });
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const clickUrl = event.notification.data?.clickUrl || '/app';
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(clickUrl);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(clickUrl);
  })());
});
