import type { BatchLastMessagesResponse, MessagesResponse } from "../types";
import type { AdminNotification } from "../types";
import type { TelegramBotNotification } from "../types";
import type { Socket } from "socket.io-client";

const SEND_TOKEN_STORAGE_KEY = "sc_send_token";
const SEND_TOKEN_EXPIRY_STORAGE_KEY = "sc_send_token_expires_at";

function getBaseUrl(): string {
    // In development, proxy through Vite. In production, same origin.
    return "";
}

function getStoredSendToken(browserId: string): string | null {
    const token = localStorage.getItem(SEND_TOKEN_STORAGE_KEY);
    const tokenBrowserId = localStorage.getItem("sc_browser_id") || "";
    const expiresAt = Number(localStorage.getItem(SEND_TOKEN_EXPIRY_STORAGE_KEY) || 0);
    if (!token || tokenBrowserId !== browserId || !expiresAt || Date.now() >= expiresAt) {
        return null;
    }
    return token;
}

function storeSendToken(token: string, expiresAt: number) {
    localStorage.setItem(SEND_TOKEN_STORAGE_KEY, token);
    localStorage.setItem(SEND_TOKEN_EXPIRY_STORAGE_KEY, String(expiresAt));
}

function clearStoredSendToken() {
    localStorage.removeItem(SEND_TOKEN_STORAGE_KEY);
    localStorage.removeItem(SEND_TOKEN_EXPIRY_STORAGE_KEY);
}

async function validateSendToken(browserId: string, token: string): Promise<boolean> {
    const res = await fetch(`${getBaseUrl()}/api/validate-sendtoken`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browserId, token }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.valid === true;
}

// Request a send token from the server via socket
async function requestSendToken(socket: Socket | null): Promise<string | null> {
    const browserId = localStorage.getItem("sc_browser_id") || "";
    const storedToken = getStoredSendToken(browserId);
    if (storedToken) return storedToken;

    return new Promise((resolve) => {
        if (!socket || !socket.connected) {
            resolve(null);
            return;
        }
        socket.emit("request_send_token", { browserId });
        const timeout = setTimeout(() => {
            socket.off("send_token", handler);
            resolve(null);
        }, 5000);
        const handler = (data: { token: string | null; expiresAt?: number }) => {
            clearTimeout(timeout);
            socket.off("send_token", handler);
            if (data.token && data.expiresAt) {
                storeSendToken(data.token, data.expiresAt);
            }
            resolve(data.token);
        };
        socket.on("send_token", handler);
    });
}

// Store socket reference for token requests
let _socket: Socket | null = null;
export function setApiSocket(socket: Socket | null) {
    _socket = socket;
    if (!socket) clearStoredSendToken();
}

export async function fetchMessages(
    chatId: string,
    offset = 0,
    limit = 20
): Promise<MessagesResponse> {
    const res = await fetch(
        `${getBaseUrl()}/api/${chatId}?offset=${offset}&limit=${limit}`
    );
    if (!res.ok) throw new Error("Failed to fetch messages");
    return res.json();
}

export async function fetchBatchLastMessages(chats: { chatId: string; lastOpenedAt?: string }[]) {
    const res = await fetch(`${getBaseUrl()}/api/chats/last-messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chats }),
    });
    if (!res.ok) throw new Error("Failed to fetch batch last messages");
    return res.json() as Promise<BatchLastMessagesResponse>;
}

export async function sendMessage(
    chatId: string,
    text: string,
    name: string,
    browserId: string,
    replyToId?: number,
    tags?: { browserId: string; name: string }[]
) {
    // Request send token for authentication
    const sendToken = await requestSendToken(_socket);
    if (!sendToken) throw new Error("Failed to get valid send token (socket disconnected, timed out, or token validation failed)");

    const makeRequest = async (token: string) => fetch(`${getBaseUrl()}/api/${chatId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, name, browserId, replyToId, tags, sendToken: token }),
    });

    let res = await makeRequest(sendToken);
    if (res.ok) return res.json();

    const stillValid = await validateSendToken(browserId, sendToken);
    if (!stillValid) {
        clearStoredSendToken();
        const renewedToken = await requestSendToken(_socket);
        if (renewedToken) {
            res = await makeRequest(renewedToken);
            if (res.ok) return res.json();
            throw new Error("Failed to send message after token renewal");
        }
        throw new Error("Failed to send message: token invalid and renewal failed");
    }

    throw new Error("Failed to send message");
}

export async function uploadFile(
    chatId: string,
    file: Blob,
    name: string,
    browserId: string,
    fileType: string,
    originalName: string,
    fileSize?: number,
    mediaDurationSec?: number,
    text?: string,
    replyToId?: number,
    onUploadProgress?: (loadedBytes: number, totalBytes: number) => void,
    abortSignal?: AbortSignal
) {
    // Request send token for authentication
    const sendToken = await requestSendToken(_socket);
    if (!sendToken) throw new Error("Failed to get valid send token (socket disconnected, timed out, or token validation failed)");

    const uploadWithToken = async (token: string) => await new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append("file", file, originalName);
        formData.append("name", name);
        formData.append("browserId", browserId);
        formData.append("fileType", fileType);
        formData.append("originalName", originalName);
        if (typeof fileSize === "number" && Number.isFinite(fileSize) && fileSize >= 0) {
            formData.append("fileSize", String(Math.floor(fileSize)));
        }
        if (typeof mediaDurationSec === "number" && Number.isFinite(mediaDurationSec) && mediaDurationSec >= 0) {
            formData.append("mediaDurationSec", String(mediaDurationSec));
        }
        if (text) formData.append("text", text);
        if (replyToId) formData.append("replyToId", String(replyToId));
        formData.append("sendToken", token);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${getBaseUrl()}/api/${chatId}/upload`);
        xhr.responseType = "json";
        let settled = false;

        const handleAbort = () => {
            if (settled) return;
            settled = true;
            cleanupAbortListener();
            xhr.abort();
            reject(new DOMException("Upload aborted", "AbortError"));
        };
        const cleanupAbortListener = () => {
            if (!abortSignal) return;
            abortSignal.removeEventListener("abort", handleAbort);
        };
        if (abortSignal) {
            if (abortSignal.aborted) {
                handleAbort();
                return;
            }
            abortSignal.addEventListener("abort", handleAbort, { once: true });
        }

        xhr.upload.onprogress = (event) => {
            if (!onUploadProgress || !event.lengthComputable) return;
            onUploadProgress(event.loaded, event.total);
        };

        xhr.onload = () => {
            if (settled) return;
            settled = true;
            cleanupAbortListener();
            if (xhr.status < 200 || xhr.status >= 300) {
                const statusText = xhr.statusText || "No status text";
                reject(new Error(`Failed to upload file (${xhr.status} ${statusText})`));
                return;
            }

            if (xhr.response && typeof xhr.response === "object") {
                resolve(xhr.response);
                return;
            }

            try {
                resolve(xhr.responseText ? JSON.parse(xhr.responseText) : {});
            } catch {
                resolve({});
            }
        };

        xhr.onerror = () => {
            if (settled) return;
            settled = true;
            cleanupAbortListener();
            reject(new Error("Failed to upload file (network error)"));
        };
        xhr.onabort = () => {
            if (settled) return;
            settled = true;
            cleanupAbortListener();
            reject(new DOMException("Upload aborted", "AbortError"));
        };
        xhr.send(formData);
    });

    try {
        return await uploadWithToken(sendToken);
    } catch (error) {
        const stillValid = await validateSendToken(browserId, sendToken);
        if (!stillValid) {
            clearStoredSendToken();
            const renewedToken = await requestSendToken(_socket);
            if (renewedToken) {
                try {
                    return await uploadWithToken(renewedToken);
                } catch {
                    throw new Error("Failed to upload file after token renewal");
                }
            }
            throw new Error("Failed to upload file: token invalid and renewal failed");
        }
        throw error;
    }
}

export async function subscribePush(
    chatId: string,
    subscription: PushSubscription,
    browserId: string
) {
    const res = await fetch(`${getBaseUrl()}/api/${chatId}/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON(), browserId }),
    });
    if (!res.ok) throw new Error("Failed to subscribe");
    return res.json();
}

export async function unsubscribePush(chatId: string, subId: string) {
    const res = await fetch(`${getBaseUrl()}/api/${chatId}/unsubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subId }),
    });
    if (!res.ok) throw new Error("Failed to unsubscribe");
    return res.json();
}

export async function createChatInvite(payload: {
    data: string;
    ttlValue: number;
    ttlUnit: "minute" | "hour";
}) {
    const res = await fetch(`${getBaseUrl()}/api/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Failed to create invite");
    return res.json() as Promise<{ success: boolean; id: string }>;
}

export async function fetchChatInvite(id: string) {
    const res = await fetch(`${getBaseUrl()}/api/invites/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error("Failed to fetch invite");
    return res.json() as Promise<{ success: boolean; data: string }>;
}

export async function fetchAdminNotifications(): Promise<AdminNotification[]> {
    const res = await fetch(`${getBaseUrl()}/api/notifications`);
    if (!res.ok) throw new Error("Failed to fetch notifications");
    const data = await res.json() as { success: boolean; notifications?: AdminNotification[] };
    return Array.isArray(data.notifications) ? data.notifications : [];
}

export async function fetchTelegramBotNotifications(chatId: string, browserId: string): Promise<TelegramBotNotification[]> {
    const sendToken = await requestSendToken(_socket);
    if (!sendToken) throw new Error("Failed to get valid send token");
    const res = await fetch(`${getBaseUrl()}/api/bot-notifications/list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, browserId, sendToken }),
    });
    if (!res.ok) throw new Error("Failed to fetch telegram bot notifications");
    const data = await res.json() as { success: boolean; notifications?: TelegramBotNotification[] };
    return Array.isArray(data.notifications) ? data.notifications : [];
}

export async function createTelegramBotNotification(chatId: string, payload: {
    browserId: string;
    userId: string;
    botToken: string;
    name: string;
}): Promise<void> {
    const sendToken = await requestSendToken(_socket);
    if (!sendToken) throw new Error("Failed to get valid send token");
    const res = await fetch(`${getBaseUrl()}/api/${encodeURIComponent(chatId)}/bot-notifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, sendToken }),
    });
    if (!res.ok) throw new Error("Failed to save telegram bot notification");
}

export async function deleteTelegramBotNotification(
    chatId: string,
    notificationId: number,
    browserId: string
): Promise<void> {
    const sendToken = await requestSendToken(_socket);
    if (!sendToken) throw new Error("Failed to get valid send token");
    const res = await fetch(
        `${getBaseUrl()}/api/${encodeURIComponent(chatId)}/bot-notifications/${encodeURIComponent(String(notificationId))}`,
        {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ browserId, sendToken }),
        }
    );
    if (!res.ok) throw new Error("Failed to delete telegram bot notification");
}
