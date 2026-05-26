import Modal from "./Modal";
import type { AdminNotification } from "../../types";

function renderTextWithLinks(text: string) {
    const urlRegex = /(https:\/\/[^\s<>"']+?)(?=[.,;!?)\]]*(?:\s|$))/g;
    const exactUrlRegex = /^https:\/\/[^\s<>"']+$/i;
    const parts = text.split(urlRegex);
    return parts.map((part, index) => {
        if (exactUrlRegex.test(part)) {
            return (
                <a
                    key={index}
                    href={part}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#60a5fa] underline break-all"
                >
                    {part}
                </a>
            );
        }
        return <span key={index}>{part}</span>;
    });
}

function isSafeImageUrl(url: string): boolean {
    try {
        const parsed = new URL(url, window.location.origin);
        const currentProtocol = window.location.protocol;
        if (currentProtocol === "https:") {
            return parsed.protocol === "https:";
        }
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}

function resolveNotificationImageUrl(url: string): string {
    try {
        return new URL(url, window.location.origin).toString();
    } catch {
        return url;
    }
}

interface NotificationModalProps {
    open: boolean;
    notifications: AdminNotification[];
    onClose: () => void;
}

export default function NotificationModal({
    open,
    notifications,
    onClose,
}: NotificationModalProps) {
    return (
        <Modal open={open} onClose={onClose} title="Notifications">
            {notifications.length === 0 ? (
                <p className="text-sm text-gray-400">No notifications</p>
            ) : (
                <div className="space-y-2">
                    {notifications.map((notification) => (
                        <div
                            key={notification.id}
                            className="rounded-lg border border-[#2b5278]/30 bg-[#1f2c3a] px-3 py-2"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div
                                    dir="auto"
                                    className="text-sm font-medium text-white break-words"
                                    style={{ unicodeBidi: "plaintext" }}
                                >
                                    {notification.title}
                                </div>
                                {!notification.seen && (
                                    <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#3b82f6] mt-1" />
                                )}
                            </div>
                            <p
                                dir="auto"
                                className="mt-1 text-sm text-gray-300 break-words whitespace-pre-wrap"
                                style={{ unicodeBidi: "plaintext" }}
                            >
                                {renderTextWithLinks(notification.text)}
                            </p>
                            {notification.imageUrl && isSafeImageUrl(notification.imageUrl) && (
                                <img
                                    src={resolveNotificationImageUrl(notification.imageUrl)}
                                    alt="Notification attachment"
                                    className="mt-2 max-h-56 w-full rounded-md border border-[#2b5278]/30 object-contain bg-[#15202b]"
                                    loading="lazy"
                                />
                            )}
                            <p className="mt-2 text-xs text-gray-400">
                                {new Date(notification.date).toLocaleString()}
                            </p>
                        </div>
                    ))}
                </div>
            )}
        </Modal>
    );
}
