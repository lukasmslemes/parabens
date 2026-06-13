// firebase-messaging-sw.js
// Coloque este arquivo na RAIZ do projeto (mesma pasta do index.html)

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyATJAen6Qtzm-uOqHtD6ubQUDmVdqG1BUM",
  authDomain: "jogodamemoria-c5354.firebaseapp.com",
  projectId: "jogodamemoria-c5354",
  storageBucket: "jogodamemoria-c5354.firebasestorage.app",
  messagingSenderId: "438539724323",
  appId: "1:438539724323:web:f79d8dddeb9c8bac373396"
});

const messaging = firebase.messaging();

// ── Notificações em background (app fechado / aba em segundo plano) ──────────
messaging.onBackgroundMessage(payload => {
  const { title, body, icon, tag, data } = payload.notification || {};
  const notifData = payload.data || {};

  self.registration.showNotification(title || '🌸 Jogo da Memória', {
    body: body || 'Você tem uma nova notificação!',
    icon: icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: tag || notifData.type || 'general',
    renotify: true,
    data: { url: notifData.url || '/', ...notifData }
  });
});

// ── Clique na notificação ────────────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Se já há uma aba aberta, foca nela
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Senão, abre nova aba
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
