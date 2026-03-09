import { subscribePush, unsubscribePush } from "./api";
import { getPushSubId, setPushSubId, getSavedChats, getBrowserId } from "./storage";

let vapidPublicKeyCache: string | null = null;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

export async function getVapidPublicKey(): Promise<string> {
    if (vapidPublicKeyCache) return vapidPublicKeyCache;
    const res = await fetch("/api/vapid-public-key");
    if (!res.ok) throw new Error("Failed to fetch VAPID key");
    const data = await res.json();
    vapidPublicKeyCache = data.publicKey;
    return data.publicKey;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
    if (!("Notification" in window)) return "denied";
    if (Notification.permission !== "default") return Notification.permission;
    return await Notification.requestPermission();
}

export function getNotificationPermission(): NotificationPermission {
    if (!("Notification" in window)) return "denied";
    return Notification.permission;
}

export function isPushSupported(): boolean {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
    if (!("serviceWorker" in navigator)) return null;
    return navigator.serviceWorker.ready;
}

export async function subscribeChatToPush(chatId: string, browserId: string): Promise<boolean> {
    try {
        // Skip if already subscribed
        if (getPushSubId(chatId)) return true;

        const registration = await getServiceWorkerRegistration();
        if (!registration) return false;

        const vapidKey = await getVapidPublicKey();
        const applicationServerKey = urlBase64ToUint8Array(vapidKey);

        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
        });

        const result = await subscribePush(chatId, subscription, browserId);
        if (result.subId) {
            setPushSubId(chatId, result.subId);
            return true;
        }
        return false;
    } catch (err) {
        console.error(`Failed to subscribe chat ${chatId} to push:`, err);
        return false;
    }
}

export async function unsubscribeChatFromPush(chatId: string): Promise<boolean> {
    try {
        const subId = getPushSubId(chatId);
        if (!subId) return true;

        await unsubscribePush(chatId, subId);
        setPushSubId(chatId, null);
        return true;
    } catch (err) {
        console.error(`Failed to unsubscribe chat ${chatId} from push:`, err);
        return false;
    }
}

export async function subscribeAllChats(browserId?: string): Promise<void> {
    const bid = browserId || getBrowserId();
    const chats = getSavedChats();
    await Promise.all(
        chats
            .filter((c) => !c.muted)
            .map((c) => subscribeChatToPush(c.chatId, bid))
    );
}

export async function unsubscribeAllChats(): Promise<void> {
    const chats = getSavedChats();
    await Promise.all(chats.map((c) => unsubscribeChatFromPush(c.chatId)));
}
