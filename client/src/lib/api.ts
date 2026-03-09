import type { MessagesResponse } from "../types";
import type { Socket } from "socket.io-client";

function getBaseUrl(): string {
    // In development, proxy through Vite. In production, same origin.
    return "";
}

// Request a send token from the server via socket
function requestSendToken(socket: Socket | null): Promise<string | null> {
    return new Promise((resolve) => {
        if (!socket || !socket.connected) {
            resolve(null);
            return;
        }
        const browserId = localStorage.getItem("sc_browser_id") || "";
        socket.emit("request_send_token", { browserId });
        const timeout = setTimeout(() => {
            socket.off("send_token", handler);
            resolve(null);
        }, 5000);
        const handler = (data: { token: string | null }) => {
            clearTimeout(timeout);
            socket.off("send_token", handler);
            resolve(data.token);
        };
        socket.on("send_token", handler);
    });
}

// Store socket reference for token requests
let _socket: Socket | null = null;
export function setApiSocket(socket: Socket | null) {
    _socket = socket;
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

    const res = await fetch(`${getBaseUrl()}/api/${chatId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, name, browserId, replyToId, tags, sendToken }),
    });
    if (!res.ok) throw new Error("Failed to send message");
    return res.json();
}

export async function uploadFile(
    chatId: string,
    file: Blob,
    name: string,
    browserId: string,
    fileType: string,
    originalName: string,
    text?: string,
    replyToId?: number
) {
    // Request send token for authentication
    const sendToken = await requestSendToken(_socket);

    const formData = new FormData();
    formData.append("file", file, originalName);
    formData.append("name", name);
    formData.append("browserId", browserId);
    formData.append("fileType", fileType);
    formData.append("originalName", originalName);
    if (text) formData.append("text", text);
    if (replyToId) formData.append("replyToId", String(replyToId));
    if (sendToken) formData.append("sendToken", sendToken);

    const res = await fetch(`${getBaseUrl()}/api/${chatId}/upload`, {
        method: "POST",
        body: formData,
    });
    if (!res.ok) throw new Error("Failed to upload file");
    return res.json();
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
