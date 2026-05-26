import {
    createContext,
    useContext,
    useState,
    useCallback,
    useEffect,
    useRef,
    type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";
import type { SavedChat, ChatMessage } from "../types";
import type { AdminNotification } from "../types";
import {
    getSavedChats,
    addChat as addChatStorage,
    removeChat as removeChatStorage,
    updateChatMeta,
    getEncryptionKey,
    getBrowserId,
    getPublicKey,
    initBrowserIdentity,
    signChallenge,
    getUserSettings,
    setPvChatKey,
    getPvChatKey,
    confirmPvChatKey,
    getSeenAdminNotificationIds,
    markAdminNotificationsSeen as storeSeenAdminNotifications,
} from "../lib/storage";
import { decryptText } from "../lib/crypto";
import {
    fetchAdminNotifications,
    fetchBatchLastMessages,
    fetchMessages,
    setApiSocket,
} from "../lib/api";
import { subscribeChatToPush, unsubscribeChatFromPush, getNotificationPermission } from "../lib/push";

// ─── Notification toast item ───
export interface NotifItem {
    id: number;
    chatId: string;
    name: string;
    preview: string;
    time: number;
}

interface ChatContextType {
    chats: SavedChat[];
    activeChatId: string | null;
    setActiveChatId: (id: string | null) => void;
    addChat: (chatId: string, label?: string) => void;
    removeChat: (chatId: string) => void;
    updateChat: (chatId: string, updates: Partial<SavedChat>) => void;
    clearUnread: (chatId: string) => void;
    reconnectSocket: () => void;
    socket: Socket | null;
    onMessage: (handler: (msg: ChatMessage & { chatId: string }) => void) => () => void;
    onMessageEdited: (handler: (data: { chatId: string; messageId: number; text: string; edited: boolean }) => void) => () => void;
    onMessageReaction: (handler: (data: { chatId: string; messageId: number; reactions: { [emoji: string]: string[] } }) => void) => () => void;
    onMessageSeenUpdate: (handler: (data: { chatId: string; updates: { messageId: number; seenBy: string[] }[] }) => void) => () => void;
    onMessageDeleted: (handler: (data: { chatId: string; messageId: number }) => void) => () => void;
    notifications: NotifItem[];
    dismissNotification: (id: number) => void;
    adminNotifications: AdminNotification[];
    unseenAdminNotificationCount: number;
    refreshAdminNotifications: () => Promise<void>;
    markAllAdminNotificationsSeen: () => Promise<void>;
}

const ChatContext = createContext<ChatContextType | null>(null);

let notifIdCounter = 0;
// Treat any incoming socket event as activity. If no activity is seen for this long while a chat is open,
// we consider the connection stale and force a reconnect.
const SOCKET_ACTIVITY_TIMEOUT_MS = 90000;
// Watchdog cadence for checking stale/idle socket state.
const SOCKET_WATCHDOG_INTERVAL_MS = 15000;
const SOCKET_RECONNECT_COOLDOWN_MS = 8000;
const SOCKET_RECONNECT_DELAY_AFTER_DISCONNECT_MS = 2000;

export function ChatProvider({ children }: { children: ReactNode }) {
    const [chats, setChats] = useState<SavedChat[]>(() => getSavedChats());
    const [activeChatId, setActiveChatIdState] = useState<string | null>(null);
    const [notifications, setNotifications] = useState<NotifItem[]>([]);
    const [adminNotifications, setAdminNotifications] = useState<AdminNotification[]>([]);
    const socketRef = useRef<Socket | null>(null);
    const activeChatIdRef = useRef<string | null>(null);
    const messageHandlersRef = useRef<Set<(msg: ChatMessage & { chatId: string }) => void>>(new Set());
    const editedHandlersRef = useRef<Set<(data: { chatId: string; messageId: number; text: string; edited: boolean }) => void>>(new Set());
    const reactionHandlersRef = useRef<Set<(data: { chatId: string; messageId: number; reactions: { [emoji: string]: string[] } }) => void>>(new Set());
    const seenUpdateHandlersRef = useRef<Set<(data: { chatId: string; updates: { messageId: number; seenBy: string[] }[] }) => void>>(new Set());
    const deletedHandlersRef = useRef<Set<(data: { chatId: string; messageId: number }) => void>>(new Set());
    const lastSocketActivityAtRef = useRef(Date.now());
    const lastReconnectAtRef = useRef(0);
    const reconnectInFlightRef = useRef(false);
    const reconnectTimeoutsRef = useRef<Set<number>>(new Set());

    const refreshAdminNotifications = useCallback(async () => {
        try {
            const seenIds = new Set(getSeenAdminNotificationIds());
            const fetched = await fetchAdminNotifications();
            const merged = fetched.map((notification) => ({
                ...notification,
                seen: seenIds.has(notification.id),
            }));
            setAdminNotifications(merged);
            const newSeenIds = merged.filter((notification) => notification.seen).map((notification) => notification.id);
            if (newSeenIds.length > 0) {
                storeSeenAdminNotifications(newSeenIds);
            }
        } catch {
            // ignore transient errors
        }
    }, []);

    const markAllAdminNotificationsSeen = useCallback(async () => {
        const unseen = adminNotifications.filter((notification) => !notification.seen);
        if (unseen.length === 0) return;
        const ids = unseen.map((notification) => notification.id);
        setAdminNotifications((prev) => prev.map((notification) => ({ ...notification, seen: true })));
        storeSeenAdminNotifications(ids);
    }, [adminNotifications]);

    // Keep active chatId ref in sync
    const setActiveChatId = useCallback((id: string | null) => {
        activeChatIdRef.current = id;
        setActiveChatIdState(id);
    }, []);

    const reconnectSocket = useCallback(() => {
        const socket = socketRef.current;
        if (!socket) return;
        if (reconnectInFlightRef.current) return;
        const now = Date.now();
        if (now - lastReconnectAtRef.current < SOCKET_RECONNECT_COOLDOWN_MS) return;
        lastReconnectAtRef.current = now;
        reconnectInFlightRef.current = true;
        if (socket.connected) {
            socket.disconnect();
        }
        socket.connect();
        const timeoutId = window.setTimeout(() => {
            reconnectTimeoutsRef.current.delete(timeoutId);
            reconnectInFlightRef.current = false;
        }, SOCKET_RECONNECT_DELAY_AFTER_DISCONNECT_MS);
        reconnectTimeoutsRef.current.add(timeoutId);
    }, []);

    // Initialize socket connection (once)
    useEffect(() => {
        const wsUrl = import.meta.env.DEV
            ? `http://localhost:${import.meta.env.VITE_SERVER_PORT || 4040}`
            : window.location.origin;

        const socket = io(wsUrl, {
            transports: ["websocket", "polling"],
        });
        socketRef.current = socket;
        // Share socket with API module for send token requests
        setApiSocket(socket);

        socket.on("connect", async () => {
            reconnectTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
            reconnectTimeoutsRef.current.clear();
            reconnectInFlightRef.current = false;
            lastSocketActivityAtRef.current = Date.now();
            // Register public key with server
            const registerIdentity = async () => {
                try {
                    let publicKey = getPublicKey();
                    if (!publicKey) {
                        const identity = await initBrowserIdentity();
                        publicKey = identity.publicKey;
                    }
                    const browserId = getBrowserId();
                    if (publicKey && browserId) {
                        socket.emit("register_public_key", { browserId, publicKey });
                    }
                } catch (err) {
                    console.error("Failed to initialize/register browser identity:", err);
                }
            };
            await registerIdentity();
            await refreshAdminNotifications();

            // Join all saved chat rooms
            getSavedChats().forEach((c) => {
                socket.emit("join_chat", c.chatId);
            });
        });

        socket.on("disconnect", () => {
            const timeoutId = window.setTimeout(() => {
                reconnectTimeoutsRef.current.delete(timeoutId);
                if (!socket.connected) {
                    reconnectSocket();
                }
            }, SOCKET_RECONNECT_DELAY_AFTER_DISCONNECT_MS);
            reconnectTimeoutsRef.current.add(timeoutId);
        });

        socket.onAny(() => {
            lastSocketActivityAtRef.current = Date.now();
        });

        // ─── Identity challenge-response ───
        socket.on("identity_challenge", async (data: { challenge: string }) => {
            const browserId = getBrowserId();
            const signature = await signChallenge(data.challenge);
            if (signature) {
                socket.emit("identity_response", {
                    browserId,
                    signature,
                    challenge: data.challenge,
                });
            }
        });

        // ─── Handle PV (Private) chat invites ───
        socket.on("pv_invite", (data: { fromBrowserId: string; chatKey: string; senderName: string }) => {
            const existing = getPvChatKey(data.fromBrowserId);

            if (existing) {
                // We already have a mapping for this user
                // If it's the same key, just confirm it
                if (existing.chatKey === data.chatKey) {
                    confirmPvChatKey(data.fromBrowserId);
                } else {
                    // Different key - accept the incoming one (merge scenario)
                    setPvChatKey(data.fromBrowserId, data.chatKey, true);
                }
            } else {
                // Store the PV mapping and auto-join the chat
                setPvChatKey(data.fromBrowserId, data.chatKey, true);
            }

            // Auto-join the PV chat room
            const chatLabel = data.senderName ? `PV: ${data.senderName}` : `PV: ${data.fromBrowserId.slice(0, 8)}`;
            addChatStorage(data.chatKey, chatLabel);
            socket.emit("join_chat", data.chatKey);
            setChats([...getSavedChats()]);
        });

        // ─── Handle PV confirmation ───
        socket.on("pv_confirmed", (data: { toBrowserId: string; chatKey: string }) => {
            confirmPvChatKey(data.toBrowserId);
        });

        socket.on("admin_notification_created", () => {
            void refreshAdminNotifications().catch(() => {
                window.setTimeout(() => {
                    void refreshAdminNotifications();
                }, 1500);
            });
        });

        socket.on("new_message", async (msg: ChatMessage & { chatId: string }) => {
            const chatId = msg.chatId;
            const myBrowserId = getBrowserId();
            if (myBrowserId) {
                socket.emit("message_delivered", {
                    chatId,
                    messageId: msg.id,
                    browserId: myBrowserId,
                });
            }

            // Notify all registered message handlers
            messageHandlersRef.current.forEach((handler) => handler(msg));

            // Update sidebar: last message preview + unread count
            if (chatId !== activeChatIdRef.current) {
                // Increment unread
                const currentChats = getSavedChats();
                const chatEntry = currentChats.find((c) => c.chatId === chatId);
                if (chatEntry) {
                    const key = getEncryptionKey(chatId);
                    let preview = msg.text || "(file)";
                    if (msg.text && key) {
                        try {
                            const result = await decryptText(msg.text, key, chatId);
                            preview = result.failed ? "[encrypted]" : result.text;
                        } catch {
                            preview = "[encrypted]";
                        }
                    }

                    // Check if current user is tagged
                    const myBrowserId = getBrowserId();
                    const isMentioned = msg.tags?.some((t) => t.browserId === myBrowserId) || false;

                    updateChatMeta(chatId, {
                        lastMessage: `${msg.name}: ${preview.slice(0, 50)}`,
                        lastMessageTime: msg.createdAt,
                        unreadCount: (chatEntry.unreadCount || 0) + 1,
                        ...(isMentioned ? { hasMention: true } : {}),
                    });
                    setChats([...getSavedChats()]);

                    // Add notification toast (skip if chat is muted)
                    if (!chatEntry.muted) {
                        const notif: NotifItem = {
                            id: ++notifIdCounter,
                            chatId,
                            name: msg.name,
                            preview: preview.slice(0, 60),
                            time: Date.now(),
                        };
                        setNotifications((prev) => [...prev, notif]);

                        // Auto-dismiss after 4 seconds
                        setTimeout(() => {
                            setNotifications((prev) => prev.filter((n) => n.id !== notif.id));
                        }, 4000);
                    }
                }
            } else {
                // Active chat — update last message but no unread
                const key = getEncryptionKey(chatId);
                let preview = msg.text || "(file)";
                if (msg.text && key) {
                    try {
                        const result = await decryptText(msg.text, key, chatId);
                        preview = result.failed ? "[encrypted]" : result.text;
                    } catch {
                        preview = "[encrypted]";
                    }
                }
                updateChatMeta(chatId, {
                    lastMessage: `${msg.name}: ${preview.slice(0, 50)}`,
                    lastMessageTime: msg.createdAt,
                });
                setChats([...getSavedChats()]);
            }
        });

        socket.on("message_edited", (data: { chatId: string; messageId: number; text: string; edited: boolean }) => {
            editedHandlersRef.current.forEach((handler) => handler(data));
        });

        socket.on("message_reaction", (data: { chatId: string; messageId: number; reactions: { [emoji: string]: string[] } }) => {
            reactionHandlersRef.current.forEach((handler) => handler(data));
        });

        socket.on("message_seen_update", (data: { chatId: string; updates: { messageId: number; seenBy: string[] }[] }) => {
            seenUpdateHandlersRef.current.forEach((handler) => handler(data));
        });

        socket.on("message_deleted", (data: { chatId: string; messageId: number }) => {
            deletedHandlersRef.current.forEach((handler) => handler(data));
        });

        socket.on("request_message_http_refresh", (data: { chatId: string; messageId: number }) => {
            const currentChatId = activeChatIdRef.current;
            const browserId = getBrowserId();
            if (!browserId) return;
            const confirmUpdated = () => {
                socket.emit("http_messages_updated", {
                    chatId: data.chatId,
                    messageId: data.messageId,
                    browserId,
                });
            };
            if (!currentChatId || data.chatId !== currentChatId) {
                fetchMessages(data.chatId, 0, 30)
                    .then(() => {
                        confirmUpdated();
                    })
                    .catch((error) => {
                        console.warn("Failed to refresh messages for inactive chat during socket recovery", error);
                        // keep retrying until server timeout window ends
                    });
                return;
            }
            window.dispatchEvent(
                new CustomEvent("sc-force-refresh-chat-messages", {
                    detail: {
                        chatId: currentChatId,
                        done: (success?: boolean) => {
                            if (success === false) return;
                            confirmUpdated();
                        },
                    },
                })
            );
        });

        const watchdogInterval = window.setInterval(() => {
            const currentSocket = socketRef.current;
            if (!currentSocket) return;
            if (!activeChatIdRef.current) return;
            if (document.visibilityState === "hidden") return;

            if (!currentSocket.connected) {
                reconnectSocket();
                return;
            }

            const inactiveFor = Date.now() - lastSocketActivityAtRef.current;
            if (inactiveFor >= SOCKET_ACTIVITY_TIMEOUT_MS) {
                reconnectSocket();
            }
        }, SOCKET_WATCHDOG_INTERVAL_MS);

        return () => {
            window.clearInterval(watchdogInterval);
            reconnectTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
            reconnectTimeoutsRef.current.clear();
            socket.offAny();
            socket.disconnect();
        };
    }, [reconnectSocket]);

    useEffect(() => {
        void refreshAdminNotifications();
    }, [refreshAdminNotifications]);

    // Fetch last message for all chats on mount
    useEffect(() => {
        const refreshAllLastMessages = async () => {
            const savedChats = getSavedChats();
            if (savedChats.length === 0) return;

            try {
                const res = await fetchBatchLastMessages(
                    savedChats.map((c) => ({
                        chatId: c.chatId,
                        lastOpenedAt: c.chatId === activeChatIdRef.current
                            ? new Date().toISOString()
                            : c.lastOpenedAt,
                    }))
                );
                for (const chat of savedChats) {
                    const chatData = res.chats?.[chat.chatId];
                    if (!chatData?.message) continue;
                    const msg = chatData.message;
                    const key = getEncryptionKey(chat.chatId);
                    let preview = msg.text || "(file)";
                    if (msg.text && key) {
                        try {
                            const result = await decryptText(msg.text, key, chat.chatId);
                            preview = result.failed ? "[encrypted]" : result.text;
                        } catch {
                            preview = "[encrypted]";
                        }
                    }
                    updateChatMeta(chat.chatId, {
                        lastMessage: `${msg.name}: ${preview.slice(0, 50)}`,
                        lastMessageTime: msg.createdAt,
                        unreadCount: chatData.unreadSinceLastOpenedCount,
                    });
                }
                setChats([...getSavedChats()]);
            } catch {
                // silently ignore fetch errors
            }
        };

        refreshAllLastMessages();

        // Also refresh sidebar when returning from background
        const handleVisibility = () => {
            if (document.visibilityState === "visible") {
                refreshAllLastMessages();
            }
        };
        document.addEventListener("visibilitychange", handleVisibility);
        return () => document.removeEventListener("visibilitychange", handleVisibility);
    }, []);

    const onMessage = useCallback(
        (handler: (msg: ChatMessage & { chatId: string }) => void) => {
            messageHandlersRef.current.add(handler);
            return () => {
                messageHandlersRef.current.delete(handler);
            };
        },
        []
    );

    const onMessageEdited = useCallback(
        (handler: (data: { chatId: string; messageId: number; text: string; edited: boolean }) => void) => {
            editedHandlersRef.current.add(handler);
            return () => {
                editedHandlersRef.current.delete(handler);
            };
        },
        []
    );

    const onMessageReaction = useCallback(
        (handler: (data: { chatId: string; messageId: number; reactions: { [emoji: string]: string[] } }) => void) => {
            reactionHandlersRef.current.add(handler);
            return () => {
                reactionHandlersRef.current.delete(handler);
            };
        },
        []
    );

    const onMessageSeenUpdate = useCallback(
        (handler: (data: { chatId: string; updates: { messageId: number; seenBy: string[] }[] }) => void) => {
            seenUpdateHandlersRef.current.add(handler);
            return () => {
                seenUpdateHandlersRef.current.delete(handler);
            };
        },
        []
    );

    const onMessageDeleted = useCallback(
        (handler: (data: { chatId: string; messageId: number }) => void) => {
            deletedHandlersRef.current.add(handler);
            return () => {
                deletedHandlersRef.current.delete(handler);
            };
        },
        []
    );

    const addChat = useCallback((chatId: string, label?: string) => {
        const updated = addChatStorage(chatId, label);
        setChats([...updated]);
        socketRef.current?.emit("join_chat", chatId);

        // Auto-subscribe to push if enabled
        const userSettings = getUserSettings();
        if (userSettings.pushEnabled && getNotificationPermission() === "granted") {
            const browserId = getBrowserId();
            subscribeChatToPush(chatId, browserId).catch(() => {});
        }
    }, []);

    const removeChatFn = useCallback((chatId: string) => {
        const updated = removeChatStorage(chatId);
        setChats([...updated]);
        socketRef.current?.emit("leave_chat", chatId);

        // Unsubscribe from push for removed chat
        unsubscribeChatFromPush(chatId).catch(() => {});
    }, []);

    const updateChat = useCallback(
        (chatId: string, updates: Partial<SavedChat>) => {
            const updated = updateChatMeta(chatId, updates);
            setChats([...updated]);
        },
        []
    );

    const clearUnread = useCallback((chatId: string) => {
        const updated = updateChatMeta(chatId, {
            unreadCount: 0,
            hasMention: false,
        });
        setChats([...updated]);
    }, []);

    const dismissNotification = useCallback((id: number) => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, []);

    useEffect(() => {
        const handleSystemToast = (event: Event) => {
            const detail = (event as CustomEvent<NotifItem>).detail;
            if (!detail || !detail.preview) return;
            const notif: NotifItem = {
                id: detail.id || ++notifIdCounter,
                chatId: detail.chatId || "",
                name: detail.name || "System",
                preview: detail.preview,
                time: Date.now(),
            };
            setNotifications((prev) => [...prev, notif]);
            setTimeout(() => {
                setNotifications((prev) => prev.filter((n) => n.id !== notif.id));
            }, 4000);
        };
        window.addEventListener("sc-system-toast", handleSystemToast as EventListener);
        return () => window.removeEventListener("sc-system-toast", handleSystemToast as EventListener);
    }, []);

    return (
        <ChatContext.Provider
            value={{
                chats,
                activeChatId,
                setActiveChatId,
                addChat,
                removeChat: removeChatFn,
                updateChat,
                clearUnread,
                reconnectSocket,
                socket: socketRef.current,
                onMessage,
                onMessageEdited,
                onMessageReaction,
                onMessageSeenUpdate,
                onMessageDeleted,
                notifications,
                dismissNotification,
                adminNotifications,
                unseenAdminNotificationCount: adminNotifications.filter((notification) => !notification.seen).length,
                refreshAdminNotifications,
                markAllAdminNotificationsSeen,
            }}
        >
            {children}
        </ChatContext.Provider>
    );
}

export function useChat() {
    const ctx = useContext(ChatContext);
    if (!ctx) throw new Error("useChat must be used within ChatProvider");
    return ctx;
}
