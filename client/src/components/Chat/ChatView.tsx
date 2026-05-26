import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { ChatMessage, ForwardMessagePayload } from "../../types";
import { useChat } from "../../contexts/ChatContext";
import { useUser } from "../../contexts/UserContext";
import { useVoiceChat } from "../../hooks/useVoiceChat";

import MessageList from "./MessageList";
import ChatInput from "./ChatInput";
import EncryptionKeyModal from "./EncryptionKeyModal";
import ShareModal from "./ShareModal";
import VoiceCallOverlay, { VoiceCallBanner } from "./VoiceCallOverlay";
import VideoCallOverlay from "./VideoCallOverlay";
import ForwardModal from "./ForwardModal";
import { MIN_CHAT_KEY_LENGTH } from "../../lib/chatKey";
import { getPendingMessages, removePendingMessage } from "../../lib/pendingMessages";
import { getSavedChats } from "../../lib/storage";

const PENDING_FORWARD_STORAGE_KEY = "sc_pending_forward";
const WEAK_CHAT_KEY_WARNING_PREFIX = "sc_weak_chat_key_warned_";

// Consistent color palette for chat avatars
const CHAT_COLORS = [
    "#e06c75", "#61afef", "#98c379", "#c678dd",
    "#d19a66", "#56b6c2", "#be5046", "#73d0ff",
    "#ff7eb3", "#7ec8e3", "#a0e77d", "#ffd76e",
    "#c79bf2", "#f5a262", "#6ec6c8", "#e5c07b",
];

function getChatColor(chatId: string): string {
    let hash = 0;
    for (let i = 0; i < chatId.length; i++) {
        hash = chatId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return CHAT_COLORS[Math.abs(hash) % CHAT_COLORS.length];
}

function isSameEncryptedPayload(localMessage: ChatMessage, incoming: { browserId?: string; text?: string }): boolean {
    if (!incoming.browserId || typeof incoming.text !== "string") return false;
    return (
        localMessage.browserId === incoming.browserId
        && typeof localMessage.rawText === "string"
        && localMessage.rawText === incoming.text
    );
}

export default function ChatView() {
    const { chatId } = useParams<{ chatId: string }>();
    const navigate = useNavigate();
    const { chats, setActiveChatId, clearUnread, updateChat, onMessage, onMessageEdited, onMessageReaction, onMessageSeenUpdate, onMessageDeleted, socket } = useChat();
    const { settings } = useUser();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
    const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
    const [typingUsers, setTypingUsers] = useState<string[]>([]);
    const [isDraggingFiles, setIsDraggingFiles] = useState(false);
    const [showKeyModal, setShowKeyModal] = useState(false);
    const [showShareModal, setShowShareModal] = useState(false);
    const [showForwardModal, setShowForwardModal] = useState(false);
    const [forwardingMessages, setForwardingMessages] = useState<ForwardMessagePayload[]>([]);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<{
        index: number;
        total: number;
        fileName: string;
        loaded: number;
        fileSize: number;
        totalLoaded: number;
        totalSize: number;
    } | null>(null);
    const [showWeakKeyWarning, setShowWeakKeyWarning] = useState(false);
    const [retryMessage, setRetryMessage] = useState<ChatMessage | null>(null);
    const [lastOpenedBeforeSession, setLastOpenedBeforeSession] = useState<string | undefined>(undefined);
    const canPersistLastOpenedAtRef = useRef(false);

    // Swipe-right to go back (mobile)
    const touchStartXRef = useRef(0);
    const touchStartYRef = useRef(0);

    const [isMobile, setIsMobile] = useState(() =>
        /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        ('ontouchstart' in window && window.innerWidth < 1024)
    );

    useEffect(() => {
        const detectMobile = () => {
            setIsMobile(
                /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
                ('ontouchstart' in window && window.innerWidth < 1024)
            );
        };

        window.addEventListener('resize', detectMobile);
        return () => window.removeEventListener('resize', detectMobile);
    }, []);

    // Handle mobile virtual keyboard: adjust container height to match visual viewport
    useEffect(() => {
        const vv = window.visualViewport;
        if (!vv) return;

        const handleResize = () => {
            const container = chatContainerRef.current;
            if (!container) return;
            // Set height to visual viewport height so keyboard doesn't cause overflow
            container.style.height = `${vv.height}px`;
            // Prevent the container from scrolling when viewport resizes
            container.style.position = "fixed";
            container.style.top = `${vv.offsetTop}px`;
            container.style.left = "0";
            container.style.right = "0";
        };

        // Reset to normal when viewport is full size
        const handleFullRestore = () => {
            const container = chatContainerRef.current;
            if (!container) return;
            if (vv.height >= window.innerHeight * 0.95) {
                container.style.position = "";
                container.style.top = "";
                container.style.left = "";
                container.style.right = "";
                container.style.height = "";
            } else {
                handleResize();
            }
        };

        vv.addEventListener("resize", handleFullRestore);
        vv.addEventListener("scroll", handleResize);

        return () => {
            vv.removeEventListener("resize", handleFullRestore);
            vv.removeEventListener("scroll", handleResize);
            // Cleanup styles on unmount
            const container = chatContainerRef.current;
            if (container) {
                container.style.position = "";
                container.style.top = "";
                container.style.left = "";
                container.style.right = "";
                container.style.height = "";
            }
        };
    }, []);

    // Handle mobile back button (popstate) — close emoji panel first, then go back
    useEffect(() => {
        if (!isMobile) return;

        // Push a fake history entry so we can intercept back
        window.history.pushState({ chatView: true }, "");

        const handlePopState = () => {
            if (emojiPickerOpen) {
                // Close emoji panel instead of navigating
                setEmojiPickerOpen(false);
                window.history.pushState({ chatView: true }, "");
            } else if (document.querySelector(".sc-media-viewer")) {
                window.dispatchEvent(new Event("sc-close-media-viewer"));
                window.history.pushState({ chatView: true }, "");
            } else {
                // Navigate to chat list
                navigate("/");
            }
        };

        window.addEventListener("popstate", handlePopState);
        return () => {
            window.removeEventListener("popstate", handlePopState);
        };
    }, [isMobile, emojiPickerOpen, navigate]);

    // Swipe right to go back on mobile
    const handleSwipeTouchStart = (e: React.TouchEvent) => {
        touchStartXRef.current = e.touches[0].clientX;
        touchStartYRef.current = e.touches[0].clientY;
    };

    const handleSwipeTouchEnd = (e: React.TouchEvent) => {
        if (!isMobile) return;
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const diffX = touchEndX - touchStartXRef.current;
        const diffY = Math.abs(touchEndY - touchStartYRef.current);

        // Swipe right from left edge to go back (only if started near left edge)
        if (diffX > 80 && diffY < 100 && touchStartXRef.current < 40) {
            navigate("/");
        }
    };

    // Voice chat
    const voice = useVoiceChat({
        socket,
        chatId: chatId || "",
        browserId: settings.browserId,
        displayName: settings.displayName,
    });

    // Get display label for this chat
    const chatEntry = chats.find((c) => c.chatId === chatId);
    const displayName = chatEntry?.label || chatId || "";

    // On mount: add chat to sidebar, set active, clear unread
    useEffect(() => {
        if (!chatId) return;
        canPersistLastOpenedAtRef.current = false;
        // In React StrictMode (dev), mount effects run twice with an immediate cleanup in-between.
        // Arm persistence on the next macrotask so that synthetic cleanup does not overwrite lastOpenedAt.
        const armPersistTimer = window.setTimeout(() => {
            canPersistLastOpenedAtRef.current = true;
        }, 0);
        const entryAtOpen = getSavedChats().find((c) => c.chatId === chatId);
        setLastOpenedBeforeSession(entryAtOpen?.lastOpenedAt);
        setActiveChatId(chatId);
        clearUnread(chatId);
        setMessages(getPendingMessages(chatId));

        return () => {
            window.clearTimeout(armPersistTimer);
            if (canPersistLastOpenedAtRef.current) {
                updateChat(chatId, { lastOpenedAt: new Date().toISOString() });
            }
            setActiveChatId(null);
        };
    }, [chatId, setActiveChatId, clearUnread, updateChat]);

    useEffect(() => {
        if (!chatId) return;
        if (chatId.length >= MIN_CHAT_KEY_LENGTH) return;
        const warnedKey = `${WEAK_CHAT_KEY_WARNING_PREFIX}${chatId}`;
        if (localStorage.getItem(warnedKey)) return;
        localStorage.setItem(warnedKey, "1");
        setShowWeakKeyWarning(true);
    }, [chatId]);

    // Listen for new messages via WebSocket
    useEffect(() => {
        if (!chatId) return;

        const unsub = onMessage((msg) => {
            if (msg.chatId === chatId) {
                setMessages((prev) => {
                    if (prev.some((m) => m.id === msg.id)) return prev;
                    const pendingIndex = prev.findIndex((m) => (
                        m.localOnly
                        && isSameEncryptedPayload(m, { browserId: msg.browserId, text: msg.text })
                    ));
                    if (pendingIndex >= 0) {
                        const next = [...prev];
                        const pending = next[pendingIndex];
                        removePendingMessage(chatId, pending.id);
                        next[pendingIndex] = {
                            ...msg,
                            text: pending.text ?? msg.text,
                            rawText: msg.text,
                        };
                        return next;
                    }
                    return [...prev, msg];
                });
            }
        });

        return unsub;
    }, [chatId, onMessage]);

    // Listen for message edits
    useEffect(() => {
        if (!chatId) return;
        const unsub = onMessageEdited((data) => {
            if (data.chatId === chatId) {
                setMessages((prev) =>
                    prev.map((m) =>
                        m.id === data.messageId
                            ? {
                                ...m,
                                text: data.text,
                                rawText: data.text.startsWith("ENC::") ? data.text : undefined,
                                edited: true,
                            }
                            : m
                    )
                );
            }
        });
        return unsub;
    }, [chatId, onMessageEdited]);

    // Listen for message reactions
    useEffect(() => {
        if (!chatId) return;
        const unsub = onMessageReaction((data) => {
            if (data.chatId === chatId) {
                setMessages((prev) =>
                    prev.map((m) =>
                        m.id === data.messageId
                            ? { ...m, reactions: data.reactions }
                            : m
                    )
                );
            }
        });
        return unsub;
    }, [chatId, onMessageReaction]);

    // Listen for seen status updates
    useEffect(() => {
        if (!chatId) return;
        const unsub = onMessageSeenUpdate((data) => {
            if (data.chatId === chatId) {
                setMessages((prev) =>
                    prev.map((m) => {
                        const update = data.updates.find((u) => u.messageId === m.id);
                        return update ? { ...m, seenBy: update.seenBy } : m;
                    })
                );
            }
        });
        return unsub;
    }, [chatId, onMessageSeenUpdate]);

    // Listen for message deletions
    useEffect(() => {
        if (!chatId) return;
        const unsub = onMessageDeleted((data) => {
            if (data.chatId === chatId) {
                setMessages((prev) => prev.filter((m) => m.id !== data.messageId));
            }
        });
        return unsub;
    }, [chatId, onMessageDeleted]);

    // Typing indicator — listen for user_typing events from server
    useEffect(() => {
        if (!chatId || !socket) return;

        const handleTyping = (data: { chatId: string; name: string; isTyping: boolean }) => {
            if (data.chatId !== chatId) return;

            const existingTimeout = typingTimeoutsRef.current.get(data.name);
            if (existingTimeout) {
                clearTimeout(existingTimeout);
                typingTimeoutsRef.current.delete(data.name);
            }

            setTypingUsers((prev) => {
                if (data.isTyping) {
                    return prev.includes(data.name) ? prev : [...prev, data.name];
                }
                return prev.filter((n) => n !== data.name);
            });

            if (data.isTyping) {
                const timeout = setTimeout(() => {
                    setTypingUsers((prev) => prev.filter((n) => n !== data.name));
                    typingTimeoutsRef.current.delete(data.name);
                }, 4000);
                typingTimeoutsRef.current.set(data.name, timeout);
            }
        };

        socket.on("user_typing", handleTyping);

        return () => {
            socket.off("user_typing", handleTyping);
            typingTimeoutsRef.current.forEach((t) => clearTimeout(t));
            typingTimeoutsRef.current.clear();
            setTypingUsers([]);
        };
    }, [chatId, socket]);

    // Handle delete message
    const handleDeleteMessage = (msg: ChatMessage) => {
        if (msg.localOnly) {
            removePendingMessage(chatId, msg.id);
            setMessages((prev) => prev.filter((m) => m.id !== msg.id));
            return;
        }
        socket?.emit("delete_message", {
            chatId,
            messageId: msg.id,
            browserId: settings.browserId,
        });
    };

    const handleChatDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
        }
    };

    const handleChatDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setIsDraggingFiles(true);
    };

    const handleChatDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        const related = e.relatedTarget as Node | null;
        if (!related || !e.currentTarget.contains(related)) {
            setIsDraggingFiles(false);
        }
    };

    const handleChatDrop = (e: React.DragEvent<HTMLDivElement>) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setIsDraggingFiles(false);
        const droppedFiles = Array.from(e.dataTransfer.files || []);
        if (droppedFiles.length === 0) return;
        window.dispatchEvent(new CustomEvent("sc-chat-files-drop", { detail: droppedFiles }));
    };

    const handleForwardSelected = (selectedMessages: ForwardMessagePayload[]) => {
        if (selectedMessages.length === 0) return;
        setForwardingMessages(selectedMessages);
        setShowForwardModal(true);
    };

    const handleForwardToChat = (targetChatId: string) => {
        if (forwardingMessages.length === 0) return;
        sessionStorage.setItem(
            PENDING_FORWARD_STORAGE_KEY,
            JSON.stringify({ targetChatId, messages: forwardingMessages })
        );
        setShowForwardModal(false);
        setForwardingMessages([]);
        navigate(`/chat/${targetChatId}`);
    };

    useEffect(() => {
        if (!chatId) return;
        const raw = sessionStorage.getItem(PENDING_FORWARD_STORAGE_KEY);
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw) as { targetChatId?: string; messages?: ForwardMessagePayload[] };
            if (parsed.targetChatId === chatId && Array.isArray(parsed.messages) && parsed.messages.length > 0) {
                setForwardingMessages(parsed.messages);
            }
        } catch {
            // ignore malformed payload
        } finally {
            sessionStorage.removeItem(PENDING_FORWARD_STORAGE_KEY);
        }
    }, [chatId]);

    useEffect(() => {
        if (!chatId) return;
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<{
                chatId?: string;
                progress?: {
                    index: number;
                    total: number;
                    fileName: string;
                    loaded: number;
                    fileSize: number;
                    totalLoaded: number;
                    totalSize: number;
                } | null;
            }>).detail;
            if (!detail || detail.chatId !== chatId) return;
            setUploadProgress(detail.progress ?? null);
        };
        window.addEventListener("sc-chat-upload-progress", handler as EventListener);
        return () => window.removeEventListener("sc-chat-upload-progress", handler as EventListener);
    }, [chatId]);

    const formatMb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
    const uploadPercent = uploadProgress && uploadProgress.totalSize > 0
        ? Math.min(100, Math.round((uploadProgress.totalLoaded / uploadProgress.totalSize) * 100))
        : 0;

    if (!chatId) return null;

    const handleOptimisticMessageAdd = (msg: ChatMessage) => {
        setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
        });
    };

    const handleOptimisticMessageStatusChange = (
        messageId: number,
        status: "pending" | "failed" | "sent",
        serverMessage?: ChatMessage
    ) => {
        setMessages((prev) => {
            const target = prev.find((m) => m.id === messageId);
            if (!target) return prev;
            if (status === "sent" && serverMessage) {
                return prev.flatMap((m) => {
                    if (m.id === messageId) {
                        return [{
                            ...serverMessage,
                            text: target.text,
                            rawText: serverMessage.text,
                        }];
                    }
                    if (
                        m.id !== serverMessage.id
                        && isSameEncryptedPayload(m, { browserId: serverMessage.browserId, text: serverMessage.text })
                    ) {
                        return [];
                    }
                    return [m];
                });
            }
            return prev.map((m) => (m.id === messageId ? { ...m, localStatus: status === "sent" ? undefined : status } : m));
        });
    };

    return (
        <div
            ref={chatContainerRef}
            className="flex flex-col h-full min-h-0 bg-[#0e1621]"
            onTouchStart={handleSwipeTouchStart}
            onTouchEnd={handleSwipeTouchEnd}
        >
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 bg-[#17212b] border-b border-[#0e1621] shrink-0 z-10">
                {/* Back button (mobile) */}
                <button
                    onClick={() => navigate("/")}
                    className="lg:hidden p-1 text-gray-400 hover:text-white transition"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M15 19l-7-7 7-7" />
                    </svg>
                </button>

                {/* Chat avatar */}
                <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0"
                    style={{ backgroundColor: getChatColor(chatId) }}
                >
                    {displayName.charAt(0).toUpperCase()}
                </div>

                {/* Chat info */}
                <div className="flex-1 min-w-0">
                    <div className="font-medium text-white truncate">{displayName}</div>
                    <div className="text-xs text-gray-400">
                        {typingUsers.length > 0
                            ? `${typingUsers.join(", ")} typing...`
                            : "encrypted chat"}
                    </div>
                </div>

                {/* Share button */}
                <button
                    onClick={() => setShowShareModal(true)}
                    className="p-2 text-gray-400 hover:text-white transition"
                    title="Share Chat Link"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                </button>

                {/* Voice call button */}
                <button
                    onClick={voice.isInCall ? voice.leaveCall : voice.joinCall}
                    className={`p-2 transition ${voice.isInCall
                        ? "text-green-400 hover:text-green-300"
                        : "text-gray-400 hover:text-white"
                        }`}
                    title={voice.isInCall ? "Leave Voice Chat" : "Join Voice Chat"}
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                </button>

                {/* Key/Settings button */}
                <button
                    onClick={() => setShowKeyModal(true)}
                    className="p-2 text-gray-400 hover:text-white transition"
                    title="Encryption Key"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                    </svg>
                </button>

                {/* Chat settings */}
                <button
                    onClick={() => navigate(`/settings/${chatId}`)}
                    className="p-2 text-gray-400 hover:text-white transition"
                    title="Chat Settings"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                    </svg>
                </button>
            </div>
            {showWeakKeyWarning && (
                <div className="px-4 py-2 bg-amber-500/15 border-b border-amber-400/30 text-amber-200 text-xs flex items-start justify-between gap-3 shrink-0">
                    <span>
                        This chat key is weak (less than {MIN_CHAT_KEY_LENGTH} characters). We strongly recommend changing to a longer, harder-to-guess chat key.
                    </span>
                    <button
                        type="button"
                        onClick={() => setShowWeakKeyWarning(false)}
                        className="text-amber-100 hover:text-white transition shrink-0"
                        title="Dismiss warning"
                    >
                        ✕
                    </button>
                </div>
            )}
            {uploadProgress && (
                <div className="px-4 py-2 bg-[#0e1621]/40 border-b border-[#0e1621] shrink-0 z-10">
                    <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-gray-300 truncate">
                            Uploading {uploadProgress.index}/{uploadProgress.total}: {uploadProgress.fileName}
                        </span>
                        <div className="flex items-center gap-3 shrink-0">
                            <span className="text-[#4ea4f6]">{uploadPercent}%</span>
                            <button
                                type="button"
                                onClick={() => window.dispatchEvent(new CustomEvent("sc-chat-cancel-upload", { detail: { chatId } }))}
                                className="text-red-300 hover:text-red-200 transition"
                                title="Cancel upload"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-[#243447] overflow-hidden">
                        <div className="h-full bg-[#4ea4f6] transition-all" style={{ width: `${uploadPercent}%` }} />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-gray-400">
                        <span>
                            {formatMb(uploadProgress.loaded)} / {formatMb(uploadProgress.fileSize)} MB
                        </span>
                        <span>
                            Total {formatMb(uploadProgress.totalLoaded)} / {formatMb(uploadProgress.totalSize)} MB
                        </span>
                    </div>
                </div>
            )}

            {/* Voice call overlay (when in call) */}
            {voice.isInCall && (
                <VoiceCallOverlay
                    participants={voice.participants}
                    callDuration={voice.callDuration}
                    isMuted={voice.isMuted}
                    isVideoOn={voice.isVideoOn}
                    browserId={settings.browserId}
                    onToggleMute={voice.toggleMute}
                    onToggleVideo={voice.toggleVideo}
                    onLeave={voice.leaveCall}
                />
            )}

            {/* Fullscreen video overlay (when anyone has video on) */}
            {voice.isInCall &&
                (voice.isVideoOn || voice.participants.some((p) => p.videoEnabled)) && (
                    <VideoCallOverlay
                        participants={voice.participants}
                        callDuration={voice.callDuration}
                        isMuted={voice.isMuted}
                        isVideoOn={voice.isVideoOn}
                        browserId={settings.browserId}
                        localStream={voice.localStream}
                        remoteStreams={voice.remoteStreams}
                        onToggleMute={voice.toggleMute}
                        onToggleVideo={voice.toggleVideo}
                        onLeave={voice.leaveCall}
                    />
                )}

            {/* Voice call banner (others in call, you're not) */}
            {!voice.isInCall && voice.participants.length > 0 && (
                <VoiceCallBanner
                    participantCount={voice.participants.length}
                    participantNames={voice.participants.map((p) => p.name)}
                    onJoin={voice.joinCall}
                />
            )}

            {/* Messages */}
            <div className="flex-1 min-h-0 overflow-hidden relative">
                <MessageList
                    chatId={chatId}
                    messages={messages}
                    lastOpenedAt={lastOpenedBeforeSession}
                    setMessages={setMessages}
                    onReply={setReplyTo}
                    onEdit={setEditingMessage}
                    onDelete={handleDeleteMessage}
                    onRetryMessage={setRetryMessage}
                    onForwardSelected={handleForwardSelected}
                    onDragOver={handleChatDragOver}
                    onDragEnter={handleChatDragEnter}
                    onDragLeave={handleChatDragLeave}
                    onDrop={handleChatDrop}
                />
                {isDraggingFiles && (
                    <div className="absolute inset-3 border-2 border-dashed border-[#4ea4f6] bg-[#17212b]/75 rounded-xl pointer-events-none flex items-center justify-center z-20">
                        <span className="text-[#4ea4f6] font-medium text-sm">Drop files to attach</span>
                    </div>
                )}
            </div>

            {/* Typing indicator */}
            {typingUsers.length > 0 && (
                <div className="px-4 py-1 text-xs text-gray-400 bg-[#0e1621] shrink-0">
                    {typingUsers.join(", ")} typing...
                </div>
            )}

            {/* Input */}
            <ChatInput
                chatId={chatId}
                replyTo={replyTo}
                onClearReply={() => setReplyTo(null)}
                editingMessage={editingMessage}
                onClearEdit={() => setEditingMessage(null)}
                forwardingMessages={forwardingMessages}
                onClearForward={() => setForwardingMessages([])}
                messages={messages}
                emojiPickerOpen={emojiPickerOpen}
                onEmojiPickerChange={setEmojiPickerOpen}
                onEdit={setEditingMessage}
                onOptimisticMessageAdd={handleOptimisticMessageAdd}
                onOptimisticMessageStatusChange={handleOptimisticMessageStatusChange}
                retryMessage={retryMessage}
                onRetryHandled={() => setRetryMessage(null)}
            />

            {/* Encryption key modal */}
            <EncryptionKeyModal
                chatId={chatId}
                open={showKeyModal}
                onClose={() => setShowKeyModal(false)}
            />

            {/* Share modal */}
            <ShareModal
                chatId={chatId}
                open={showShareModal}
                onClose={() => setShowShareModal(false)}
            />

            <ForwardModal
                open={showForwardModal}
                onClose={() => {
                    setShowForwardModal(false);
                    setForwardingMessages([]);
                }}
                chats={chats}
                currentChatId={chatId}
                selectedCount={forwardingMessages.length}
                onSelectChat={handleForwardToChat}
            />
        </div>
    );
}
