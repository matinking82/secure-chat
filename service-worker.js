self.addEventListener("push", event => {
    if (!event.data) return;
    const data = event.data.json();

    const title = data.title || "SecureChat";
    const options = {
        body: data.body,
        icon: "/icon-192.png",      // مسیر آیکون (اختیاری)
        badge: "/badge-72.png",      // مسیر badge (اختیاری)
        data: data.url || "/",       // می‌توانید URL را ذخیره کنید
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
    event.notification.close();
    const url = event.notification.data;
    if (url) {
        event.waitUntil(clients.openWindow(url));
    }
});