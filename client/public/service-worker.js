self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(APP_CACHE)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((key) => key !== APP_CACHE)
                        .map((key) => caches.delete(key))
                )
            )
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const { request } = event;

    if (request.method !== "GET") {
        return;
    }

    const url = new URL(request.url);

    if (url.origin !== self.location.origin) {
        return;
    }

    if (
        url.pathname.startsWith("/api") ||
        url.pathname.startsWith("/files") ||
        url.pathname.startsWith("/socket.io")
    ) {
        return;
    }

    if (request.mode === "navigate") {
        event.respondWith(handleNavigationRequest(request));
        return;
    }

    if (isStaticAsset(url.pathname)) {
        event.respondWith(handleStaticAssetRequest(request));
    }
});

self.addEventListener("push", (event) => {
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
        icon: "/pwa-192.png",
        badge: "/pwa-192.png",
        data: notificationUrl,
        tag: "securechat-" + Date.now(),
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const url = event.notification.data;
    if (url) {
        event.waitUntil(clients.openWindow(url));
    }
});

const APP_CACHE = "securechat-app-v1";
const APP_SHELL = [
    "/",
    "/index.html",
    "/manifest.webmanifest",
    "/pwa-icon.svg",
    "/pwa-192.png",
    "/pwa-512.png",
    "/apple-touch-icon.png",
];

function isStaticAsset(pathname) {
    return (
        pathname === "/" ||
        pathname.startsWith("/assets/") ||
        /\.(?:css|js|mjs|html|json|png|svg|jpg|jpeg|webp|gif|ico|woff2?|ttf)$/i.test(
            pathname
        )
    );
}

async function handleNavigationRequest(request) {
    const cache = await caches.open(APP_CACHE);

    try {
        const response = await fetch(request);
        if (response.ok) {
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }

        const appShell = await cache.match("/index.html");
        if (appShell) {
            return appShell;
        }

        throw new Error("Navigation request failed and no cached shell was found.");
    }
}

async function handleStaticAssetRequest(request) {
    const cache = await caches.open(APP_CACHE);
    const cachedResponse = await cache.match(request);

    if (cachedResponse) {
        return cachedResponse;
    }

    const response = await fetch(request);
    if (response.ok) {
        cache.put(request, response.clone());
    }
    return response;
}
