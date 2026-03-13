self.addEventListener("push", event => {
    if (!event.data) return;
    const data = event.data.json();

    // Validate notification URL - only allow relative paths (same-origin)
    let notificationUrl = "/";
    if (data.url && typeof data.url === "string" && data.url.startsWith("/")) {
        notificationUrl = data.url;
    }

    const title = data.title || "SecureChat";
    const options = {
        body: data.body,
        icon: "/icon-192.png",
        badge: "/badge-72.png",
        data: notificationUrl,
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