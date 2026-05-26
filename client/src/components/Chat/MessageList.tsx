import { useRef, useEffect, useLayoutEffect, useCallback, useMemo, useState } from "react";
import type { ChatMessage, ForwardMessagePayload } from "../../types";
import MessageBubble from "./MessageBubble";
import { useUser } from "../../contexts/UserContext";
import { useChat } from "../../contexts/ChatContext";
import { fetchMessages } from "../../lib/api";
import { decryptText } from "../../lib/crypto";
import { getEncryptionKey } from "../../lib/storage";
import { upsertChatAudioIndex, type ChatAudioIndexItem } from "../../lib/audioIndex";
import { isConnect4Message } from "./Connect4Game";

// Check if a message is a game message (Connect4 or Chess)
function isGameMessage(text: string): boolean {
    return isConnect4Message(text) || text.startsWith("GAME::");
}

interface MessageListProps {
    chatId: string;
    messages: ChatMessage[];
    lastOpenedAt?: string;
    setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
    onReply: (msg: ChatMessage) => void;
    onEdit?: (msg: ChatMessage) => void;
    onDelete?: (msg: ChatMessage) => void;
    onRetryMessage?: (msg: ChatMessage) => void;
    onForwardSelected?: (messages: ForwardMessagePayload[]) => void;
    onDragOver?: React.DragEventHandler<HTMLDivElement>;
    onDragEnter?: React.DragEventHandler<HTMLDivElement>;
    onDragLeave?: React.DragEventHandler<HTMLDivElement>;
    onDrop?: React.DragEventHandler<HTMLDivElement>;
}

// Merge already-rendered messages with newly fetched/decrypted messages:
// if the same id appears in both sets (refresh/decrypt pass), keep the incoming copy.
function mergeSortedMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
    if (incoming.length === 0) return existing;
    const incomingSortedById = [...incoming].sort((a, b) => a.id - b.id);
    const merged: ChatMessage[] = [];
    const pushMerged = (message: ChatMessage) => {
        const last = merged[merged.length - 1];
        if (!last || last.id !== message.id) {
            merged.push(message);
            return;
        }
        merged[merged.length - 1] = message;
    };
    let existingIdx = 0;
    let incomingIdx = 0;
    while (existingIdx < existing.length && incomingIdx < incomingSortedById.length) {
        const a = existing[existingIdx];
        const b = incomingSortedById[incomingIdx];
        if (a.id === b.id) {
            pushMerged(b);
            existingIdx++;
            incomingIdx++;
        } else if (a.id < b.id) {
            pushMerged(a);
            existingIdx++;
        } else {
            pushMerged(b);
            incomingIdx++;
        }
    }
    while (existingIdx < existing.length) {
        pushMerged(existing[existingIdx++]);
    }
    while (incomingIdx < incomingSortedById.length) {
        pushMerged(incomingSortedById[incomingIdx++]);
    }
    return merged;
}

const SEEN_STATUS_RETRY_TIMEOUT_MS = 3000;
const NEAR_BOTTOM_AUTO_SCROLL_PX = 320;

export default function MessageList({
    chatId,
    messages,
    lastOpenedAt,
    setMessages,
    onReply,
    onEdit,
    onDelete,
    onRetryMessage,
    onForwardSelected,
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop,
}: MessageListProps) {
    const { settings } = useUser();
    const { socket } = useChat();
    const containerRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const [hasMore, setHasMore] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [initialLoad, setInitialLoad] = useState(true);
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const [hasNewMessage, setHasNewMessage] = useState(false);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [lastSendMessageId, setLastSendMessageId] = useState(0);
    const [keyReloadToken, setKeyReloadToken] = useState(0);
    const chatIdRef = useRef(chatId);
    chatIdRef.current = chatId;
    const seenSentRef = useRef<Set<number>>(new Set());
    const seenPendingRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
    const [seenTrigger, setSeenTrigger] = useState(0);
    const prevNewestMsgIdRef = useRef(0);
    const visibleMsgIdsRef = useRef<Set<number>>(new Set());
    const isLoadingOlderRef = useRef(false);
    const loadingMoreRef = useRef(false);
    const loadRequestIdRef = useRef(0);
    const initialStreamingRef = useRef(false);
    const initialScrollRafRef = useRef<number | null>(null);
    const didInitialBottomSnapRef = useRef(false);
    const paginationAnchorMsgIdRef = useRef<number | null>(null);
    const paginationAnchorOffsetRef = useRef(0);
    const paginationAnchorActiveRef = useRef(false);
    const paginationLockedScrollTopRef = useRef<number | null>(null);

    const clearSeenTracking = useCallback(() => {
        seenSentRef.current.clear();
        seenPendingRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
        seenPendingRef.current.clear();
    }, []);

    const decryptAndUpsertMessages = useCallback(
        async (incoming: ChatMessage[], requestId: number) => {
            const key = getEncryptionKey(chatId);
            const decryptedBatch: ChatMessage[] = [];
            const audioIndexBatch: ChatAudioIndexItem[] = [];
            // Keep decrypt order newest -> oldest like before, but commit once to avoid scroll/focus jitter.
            for (let i = incoming.length - 1; i >= 0; i--) {
                const msg = incoming[i];
                if (chatIdRef.current !== chatId || loadRequestIdRef.current !== requestId) return;
                let next = msg;
                if (msg.text?.startsWith("ENC::")) {
                    const result = await decryptText(msg.text, key, chatId);
                    if (chatIdRef.current !== chatId || loadRequestIdRef.current !== requestId) return;
                    next = { ...msg, rawText: msg.text, text: result.text };
                }
                decryptedBatch.push(next);
                if (msg.file && msg.fileType === "audio") {
                    const trackId = msg.id ?? msg.file;
                    const isVoice = msg.originalName?.startsWith("voice-");
                    audioIndexBatch.push({
                        trackKey: `${chatId}:${trackId}:${isVoice ? "voice" : "audio"}`,
                        fileUrl: msg.file,
                        title: msg.originalName || (isVoice ? "Voice message" : "Audio file"),
                        chatId,
                        createdAt: msg.createdAt,
                    });
                }
            }
            if (chatIdRef.current !== chatId || loadRequestIdRef.current !== requestId) return;
            if (audioIndexBatch.length) {
                upsertChatAudioIndex(chatId, audioIndexBatch);
            }
            setMessages((prev) => {
                return mergeSortedMessages(prev, decryptedBatch);
            });
        },
        [chatId, setMessages]
    );

    // Scroll to bottom
    const scrollToBottom = useCallback((smooth = true) => {
        const scrollContainer = containerRef.current;
        if (scrollContainer) {
            if (smooth) {
                scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: "smooth" });
            } else {
                scrollContainer.scrollTop = scrollContainer.scrollHeight;
            }
            return;
        }
        bottomRef.current?.scrollIntoView({
            behavior: smooth ? "smooth" : "instant",
        });
    }, []);
    const doubleRafScrollToBottom = useCallback(() => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => scrollToBottom(false));
        });
    }, [scrollToBottom]);

    // Initial message load — preserve local pending/failed optimistic items, then sync from API
    useEffect(() => {
        setMessages((prev) => prev.filter((m) => m.localOnly));
        setHasMore(true);
        setInitialLoad(true);
        didInitialBottomSnapRef.current = false;
        initialStreamingRef.current = true;
        setSelectionMode(false);
        setSelectedIds(new Set());
        clearSeenTracking();
        visibleMsgIdsRef.current.clear();

        const requestId = ++loadRequestIdRef.current;
        fetchMessages(chatId, 0, 30).then(async (data) => {
            if (chatIdRef.current !== chatId || loadRequestIdRef.current !== requestId) return; // stale
            await decryptAndUpsertMessages(data.messages, requestId);
            if (chatIdRef.current !== chatId || loadRequestIdRef.current !== requestId) return;
            initialStreamingRef.current = false;
            setHasMore(data.hasMore);
            setInitialLoad(false);
            doubleRafScrollToBottom();
        });
    }, [chatId, keyReloadToken, setMessages, decryptAndUpsertMessages, clearSeenTracking, doubleRafScrollToBottom]);

    // Keep the viewport pinned to bottom while initial history is streamed in.
    useEffect(() => {
        if (!initialLoad || !initialStreamingRef.current) return;
        if (initialScrollRafRef.current != null) return;
        initialScrollRafRef.current = requestAnimationFrame(() => {
            initialScrollRafRef.current = null;
            scrollToBottom(false);
        });
        return () => {
            if (initialScrollRafRef.current != null) {
                cancelAnimationFrame(initialScrollRafRef.current);
                initialScrollRafRef.current = null;
            }
        };
    }, [messages, initialLoad, scrollToBottom]);

    // Ensure first completed load lands at bottom even after async layout settle.
    useEffect(() => {
        if (initialLoad || didInitialBottomSnapRef.current) return;
        didInitialBottomSnapRef.current = true;
        doubleRafScrollToBottom();
    }, [initialLoad, doubleRafScrollToBottom]);


    // Refetch messages when returning from background (visibility change)
    useEffect(() => {
        const handleVisibility = () => {
            if (document.visibilityState === "visible" && !initialLoad) {
                const requestId = ++loadRequestIdRef.current;
                fetchMessages(chatId, 0, 30).then(async (data) => {
                    if (chatIdRef.current !== chatId || loadRequestIdRef.current !== requestId) return;
                    await decryptAndUpsertMessages(data.messages, requestId);
                    if (chatIdRef.current !== chatId || loadRequestIdRef.current !== requestId) return;
                    setHasMore(data.hasMore);
                });
            }
        };

        document.addEventListener("visibilitychange", handleVisibility);
        return () => document.removeEventListener("visibilitychange", handleVisibility);
    }, [chatId, initialLoad, setMessages, decryptAndUpsertMessages]);

    useEffect(() => {
        const handleForcedRefresh = (event: Event) => {
            const detail = (event as CustomEvent<{ chatId?: string; done?: (success?: boolean) => void }>).detail;
            const targetChatId = detail?.chatId;
            if (targetChatId !== chatId) return;
            const done = detail?.done;
            const requestId = ++loadRequestIdRef.current;
            let refreshed = false;
            fetchMessages(chatId, 0, 30).then(async (data) => {
                if (chatIdRef.current !== chatId || loadRequestIdRef.current !== requestId) return;
                await decryptAndUpsertMessages(data.messages, requestId);
                if (chatIdRef.current !== chatId || loadRequestIdRef.current !== requestId) return;
                setHasMore(data.hasMore);
                refreshed = true;
            }).finally(() => {
                done?.(refreshed);
            });
        };

        window.addEventListener("sc-force-refresh-chat-messages", handleForcedRefresh as EventListener);
        return () => window.removeEventListener("sc-force-refresh-chat-messages", handleForcedRefresh as EventListener);
    }, [chatId, decryptAndUpsertMessages]);

    useEffect(() => {
        const handleEncryptionKeyChange = (event: Event) => {
            const targetChatId = (event as CustomEvent<{ chatId?: string }>).detail?.chatId;
            if (typeof targetChatId === "string" && targetChatId === chatIdRef.current) {
                setKeyReloadToken((t) => t + 1);
            }
        };
        window.addEventListener("encryption-key-changed", handleEncryptionKeyChange as EventListener);
        return () =>
            window.removeEventListener("encryption-key-changed", handleEncryptionKeyChange as EventListener);
    }, []);

    const applyPaginationAnchor = useCallback(() => {
        if (!paginationAnchorActiveRef.current) return;
        const container = containerRef.current;
        const anchorId = paginationAnchorMsgIdRef.current;
        if (!container || !anchorId) return;
        const anchorEl = container.querySelector(`[data-msg-id="${anchorId}"]`) as HTMLElement | null;
        if (!anchorEl) return;
        const containerTop = container.getBoundingClientRect().top;
        const currentOffset = anchorEl.getBoundingClientRect().top - containerTop;
        const delta = currentOffset - paginationAnchorOffsetRef.current;
        if (delta !== 0) {
            container.scrollTop += delta;
        }
        paginationLockedScrollTopRef.current = container.scrollTop;
    }, []);

    // While loading older messages, keep the same message pinned at the same viewport offset.
    useLayoutEffect(() => {
        applyPaginationAnchor();
    }, [messages, loadingMore, applyPaginationAnchor]);

    // Auto-scroll on new messages: only if near bottom AND the new message is from us
    // AND not a game move. When loading older messages, never auto-scroll.
    useEffect(() => {
        if (initialLoad) return;
        if (isLoadingOlderRef.current || paginationAnchorActiveRef.current || loadingMoreRef.current || loadingMore) return;
        const container = containerRef.current;
        if (!container) return;
        const newestMsg = messages.length > 0 ? messages[messages.length - 1] : null;
        const newestMsgId = newestMsg ? newestMsg.id : 0;

        // Skip auto-scroll for game move messages (edited game state)
        if (newestMsg && isGameMessage(newestMsg.text)) {
            prevNewestMsgIdRef.current = newestMsgId;
            return;
        }

        const isNearBottom =
            container.scrollHeight - container.scrollTop - container.clientHeight <=
            NEAR_BOTTOM_AUTO_SCROLL_PX;
        const isOwnMessage = newestMsg?.browserId === settings.browserId;

        if (isOwnMessage && lastSendMessageId != newestMsg.id) {
            // Always scroll to bottom when user sends a message
            setLastSendMessageId(newestMsg.id);
            requestAnimationFrame(() => scrollToBottom(true));
        } else if (isNearBottom && newestMsgId > prevNewestMsgIdRef.current) {
            // Near bottom and new message from someone else — scroll
            requestAnimationFrame(() => scrollToBottom(true));
        } else if (newestMsgId > prevNewestMsgIdRef.current) {
            // New message arrived while scrolled up
            setHasNewMessage(true);
        }
        prevNewestMsgIdRef.current = newestMsgId;
    }, [messages, scrollToBottom, initialLoad, settings.browserId, loadingMore]);

    // Re-check seen status after identity verification completes
    // (API-fetched messages may arrive before the server verifies the socket identity)
    useEffect(() => {
        if (!socket) return;
        const handleVerified = (data: { success: boolean }) => {
            if (!data.success) return;
            clearSeenTracking();
            setSeenTrigger((c) => c + 1);
        };
        socket.on("identity_verified", handleVerified);
        return () => {
            socket.off("identity_verified", handleVerified);
        };
    }, [socket, clearSeenTracking]);

    // If browser identity changes after mount, retry seen updates with the new verified id.
    useEffect(() => {
        clearSeenTracking();
        setSeenTrigger((c) => c + 1);
    }, [settings.browserId, clearSeenTracking]);

    // Retry seen updates after reconnects because in-flight emits may be dropped.
    useEffect(() => {
        if (!socket) return;
        const handleConnect = () => {
            clearSeenTracking();
            setSeenTrigger((c) => c + 1);
        };
        socket.on("connect", handleConnect);
        return () => {
            socket.off("connect", handleConnect);
        };
    }, [socket, clearSeenTracking]);

    // Confirm sent seen marks only when server broadcasts our browserId in seenBy.
    useEffect(() => {
        if (!socket) return;
        const handleSeenUpdate = (data: { chatId: string; updates: { messageId: number; seenBy: string[] }[] }) => {
            if (data.chatId !== chatId) return;
            let changed = false;
            for (const update of data.updates) {
                if (!update.seenBy.includes(settings.browserId)) continue;
                const timeoutId = seenPendingRef.current.get(update.messageId);
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    seenPendingRef.current.delete(update.messageId);
                }
                if (!seenSentRef.current.has(update.messageId)) {
                    seenSentRef.current.add(update.messageId);
                    changed = true;
                }
            }
            if (changed) setSeenTrigger((c) => c + 1);
        };
        socket.on("message_seen_update", handleSeenUpdate);
        return () => {
            socket.off("message_seen_update", handleSeenUpdate);
        };
    }, [socket, chatId, settings.browserId]);

    // IntersectionObserver to track which messages are visible in the viewport
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    const msgId = parseInt((entry.target as HTMLElement).dataset.msgId || "0");
                    if (!msgId) return;
                    if (entry.isIntersecting) {
                        visibleMsgIdsRef.current.add(msgId);
                    } else {
                        visibleMsgIdsRef.current.delete(msgId);
                    }
                });
                // Trigger seen check when visibility changes
                setSeenTrigger((c) => c + 1);
            },
            { root: container, threshold: 0.5 }
        );

        // Observe all message elements
        const msgElements = container.querySelectorAll("[data-msg-id]");
        msgElements.forEach((el) => observer.observe(el));

        return () => observer.disconnect();
    }, [messages, initialLoad]);

    // Send seen status only for messages that are visible AND page is active
    useEffect(() => {
        if (initialLoad || !socket) return;
        if (document.visibilityState !== "visible") return;

        const unseenMessages = messages.filter(
            (m) =>
                m.browserId !== settings.browserId &&
                !seenSentRef.current.has(m.id) &&
                !seenPendingRef.current.has(m.id) &&
                (!m.seenBy || !m.seenBy.includes(settings.browserId)) &&
                visibleMsgIdsRef.current.has(m.id)
        );
        if (unseenMessages.length > 0) {
            const messageIds = unseenMessages.map((m) => m.id);
            socket.emit("message_seen", {
                chatId,
                messageIds,
                browserId: settings.browserId,
            });
            messageIds.forEach((id) => {
                const timeoutId = setTimeout(() => {
                    if (seenPendingRef.current.delete(id)) {
                        setSeenTrigger((c) => c + 1);
                    }
                }, SEEN_STATUS_RETRY_TIMEOUT_MS);
                seenPendingRef.current.set(id, timeoutId);
            });
        }
    }, [messages, initialLoad, socket, chatId, settings.browserId, seenTrigger]);

    useEffect(() => {
        return () => {
            seenSentRef.current.clear();
            seenPendingRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
            seenPendingRef.current.clear();
        };
    }, []);

    // Load older messages on scroll up + track scroll position for scroll-to-bottom button
    const handleScroll = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;

        if (loadingMoreRef.current && paginationAnchorActiveRef.current) return;

        // Show/hide scroll-to-bottom button
        const distFromBottom =
            container.scrollHeight - container.scrollTop - container.clientHeight;
        setShowScrollBtn(distFromBottom > 300);
        if (distFromBottom <= 300) {
            setHasNewMessage(false);
        }

        // loadingMoreRef gates concurrent pagination requests; loadingMore state is for the spinner UI.
        if (!hasMore || loadingMoreRef.current) return;
        if (container.scrollTop < 100) {
            loadingMoreRef.current = true;
            setLoadingMore(true);
            isLoadingOlderRef.current = true;
            paginationAnchorActiveRef.current = true;
            paginationLockedScrollTopRef.current = container.scrollTop;
            const containerTop = container.getBoundingClientRect().top;
            const messageEls = Array.from(
                container.querySelectorAll("[data-msg-id]")
            ) as HTMLElement[];
            const anchorEl =
                messageEls.find((el) => el.getBoundingClientRect().bottom > containerTop) || messageEls[0];
            if (anchorEl) {
                const msgId = Number(anchorEl.dataset.msgId);
                paginationAnchorMsgIdRef.current = Number.isNaN(msgId) ? null : msgId;
                paginationAnchorOffsetRef.current = anchorEl.getBoundingClientRect().top - containerTop;
            } else {
                paginationAnchorMsgIdRef.current = null;
            }

            const requestId = ++loadRequestIdRef.current;
            fetchMessages(chatId, messages.length, 20)
                .then(async (data) => {
                    if (data.messages.length > 0) {
                        await decryptAndUpsertMessages(data.messages, requestId);
                        setHasMore(data.hasMore);

                        // Keep anchor stable after the final insertion frame too.
                        requestAnimationFrame(() => {
                            applyPaginationAnchor();
                        });
                    } else {
                        setHasMore(false);
                    }
                })
                .catch((error) => {
                    console.error("Failed to fetch older messages:", error);
                })
                .finally(() => {
                    requestAnimationFrame(() => {
                        applyPaginationAnchor();
                        // Keep the anchor correction alive for one additional paint on mobile
                        // where virtualized keyboard/browser UI can settle a frame later.
                        requestAnimationFrame(() => {
                            applyPaginationAnchor();
                            paginationAnchorActiveRef.current = false;
                            paginationAnchorMsgIdRef.current = null;
                            paginationLockedScrollTopRef.current = null;
                            isLoadingOlderRef.current = false;
                            loadingMoreRef.current = false;
                            setLoadingMore(false);
                        });
                    });
                });
        }
    }, [chatId, hasMore, messages.length, setMessages, decryptAndUpsertMessages, applyPaginationAnchor]);

    // Find a message by id for reply references
    const findMessage = useCallback(
        (id: number) => messages.find((m) => m.id === id),
        [messages]
    );

    // Scroll to a specific message by id
    const scrollToMessage = useCallback((msgId: number) => {
        const container = containerRef.current;
        if (!container) return;
        const el = container.querySelector(`[data-msg-id="${msgId}"]`) as HTMLElement | null;
        if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            // Flash highlight
            el.style.transition = "background-color 0.3s";
            el.style.backgroundColor = "rgba(78,164,246,0.15)";
            setTimeout(() => {
                el.style.backgroundColor = "transparent";
                setTimeout(() => {
                    el.style.removeProperty("background-color");
                    el.style.removeProperty("transition");
                }, 300);
            }, 1200);
        }
    }, []);

    const handleToggleSelect = useCallback((msgId: number) => {
        setSelectionMode(true);
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(msgId)) next.delete(msgId);
            else next.add(msgId);
            return next;
        });
    }, []);

    const handleCopySelected = useCallback(async () => {
        const selected = messages.filter((m) => selectedIds.has(m.id));
        if (selected.length === 0) return;
        const key = getEncryptionKey(chatId);
        const lines: string[] = [];
        for (const msg of selected) {
            if (!msg.text) continue;
            const result = await decryptText(msg.text, key, chatId);
            if (!result.failed && result.text.trim()) {
                lines.push(`${msg.name}: ${result.text}`);
            }
        }
        if (lines.length > 0) {
            await navigator.clipboard.writeText(lines.join("\n"));
        }
        setSelectionMode(false);
        setSelectedIds(new Set());
    }, [chatId, messages, selectedIds]);

    const handleDeleteSelected = useCallback(() => {
        const selected = messages.filter((m) => selectedIds.has(m.id));
        if (selected.length === 0 || !onDelete) return;
        const confirmed = window.confirm(`Delete ${selected.length} selected message${selected.length === 1 ? "" : "s"}?`);
        if (!confirmed) return;
        selected.forEach((msg) => onDelete(msg));
        setSelectionMode(false);
        setSelectedIds(new Set());
    }, [messages, onDelete, selectedIds]);

    const handleForwardSelected = useCallback(async () => {
        if (!onForwardSelected) return;
        const selected = messages
            .filter((m) => selectedIds.has(m.id))
            .sort((a, b) => a.id - b.id);
        if (selected.length === 0) return;

        const key = getEncryptionKey(chatId);
        const prepared: ForwardMessagePayload[] = [];
        for (const msg of selected) {
            const decryptedText = msg.text
                ? await decryptText(msg.text, key, chatId)
                : { text: "", failed: false };
            const plainText = decryptedText.failed || !decryptedText.text ? "" : decryptedText.text;
            prepared.push({
                id: msg.id,
                sourceChatId: chatId,
                text: plainText,
                name: msg.name,
                file: msg.file,
                fileType: msg.fileType,
                originalName: msg.originalName,
                fileSize: msg.fileSize,
                mediaDurationSec: msg.mediaDurationSec,
            });
        }
        if (prepared.length === 0) return;
        onForwardSelected(prepared);
        setSelectionMode(false);
        setSelectedIds(new Set());
    }, [chatId, messages, onForwardSelected, selectedIds]);

    // ESC cancels message selection mode
    useEffect(() => {
        if (!selectionMode) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setSelectionMode(false);
                setSelectedIds(new Set());
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [selectionMode]);

    const selectedMessages = messages.filter((m) => selectedIds.has(m.id));
    const allSelectedMine =
        selectedMessages.length > 0 &&
        selectedMessages.every((m) => m.browserId === settings.browserId);
    const mediaItems = messages
        .filter((m) => m.file && (m.fileType === "image" || m.fileType === "video"))
        .map((m) => ({
            messageId: m.id,
            type: m.fileType as "image" | "video",
            file: m.file as string,
            alt: m.originalName,
        }));
    const mediaIndexByMessageId = new Map<number, number>();
    mediaItems.forEach((item, index) => {
        mediaIndexByMessageId.set(item.messageId, index);
    });
    const lastOpenedAtMs = useMemo(() => {
        return typeof lastOpenedAt === "string" && lastOpenedAt.length > 0
            ? new Date(lastOpenedAt).getTime()
            : Number.NaN;
    }, [lastOpenedAt]);
    const newMessagesDividerIndex = useMemo(() => {
        if (!Number.isFinite(lastOpenedAtMs)) return -1;
        return messages.findIndex((msg) => new Date(msg.createdAt).getTime() > lastOpenedAtMs);
    }, [messages, lastOpenedAtMs]);

    return (
        <div className="relative h-full">
            <div className="sc-chat-wallpaper h-full">
                <div
                    ref={containerRef}
                    onScroll={handleScroll}
                    onDragOver={onDragOver}
                    onDragEnter={onDragEnter}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                    className="h-full overflow-y-auto py-3 sc-mobile-hide-scrollbar"
                >
                    {/* Loading indicator */}
                    {loadingMore && (
                        <div className="text-center py-3">
                            <div className="inline-block w-6 h-6 border-2 border-[#4ea4f6] border-t-transparent rounded-full animate-spin" />
                        </div>
                    )}

                    {!hasMore && messages.length > 0 && (
                        <div className="text-center text-gray-600 text-sm py-4">
                            Beginning of conversation
                        </div>
                    )}

                    {/* Messages */}
                    {messages.map((msg, index) => {
                        const showNewMessagesDivider = index === newMessagesDividerIndex;
                        return (
                            <div key={msg.id}>
                                {showNewMessagesDivider && (
                                    <div className="text-center py-2">
                                        <span className="inline-block text-[11px] text-[#9bb6cf] bg-[#1a2a39] border border-[#2b5278] rounded-full px-3 py-1">
                                            New messages
                                        </span>
                                    </div>
                                )}
                                <div
                                    data-msg-id={msg.id}
                                    className={`relative rounded-xl transition-colors ${selectionMode && selectedIds.has(msg.id) ? "bg-[#4ea4f6]/15" : ""}`}
                                >
                                    <MessageBubble
                                        msg={msg}
                                        chatId={chatId}
                                        isMine={msg.browserId === settings.browserId}
                                        selectionMode={selectionMode}
                                        isSelected={selectedIds.has(msg.id)}
                                        replyTarget={msg.replyToId ? findMessage(msg.replyToId) : undefined}
                                        onReply={onReply}
                                        onScrollToMessage={scrollToMessage}
                                        onToggleSelect={handleToggleSelect}
                                        onEdit={onEdit}
                                        onDelete={onDelete}
                                        onRetryMessage={onRetryMessage}
                                        mediaItems={mediaItems}
                                        mediaIndex={mediaIndexByMessageId.get(msg.id) ?? -1}
                                    />
                                </div>
                            </div>
                        );
                    })}

                    {/* Empty state */}
                    {messages.length === 0 && !initialLoad && (
                        <div className="flex flex-col items-center justify-center h-full text-gray-500">
                            <svg className="w-16 h-16 mb-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                            <p className="text-lg">No messages yet</p>
                            <p className="text-sm mt-1">Send a message to start the conversation</p>
                        </div>
                    )}

                    <div ref={bottomRef} />
                </div>
            </div>

            {/* Scroll-to-bottom button */}
            {showScrollBtn && (
                <button
                    onClick={() => {
                        scrollToBottom(true);
                        setHasNewMessage(false);
                    }}
                    className="absolute bottom-4 right-4 w-10 h-10 rounded-full bg-[#17212b]
                               border border-[#2b5278] shadow-lg flex items-center justify-center
                               text-gray-300 hover:text-white hover:bg-[#1e2c3a] transition-all
                               z-10 animate-in"
                    title="Scroll to bottom"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                    {hasNewMessage && (
                        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-[#4ea4f6] rounded-full border-2 border-[#17212b]" />
                    )}
                </button>
            )}

            {selectionMode && (
                <div className="absolute bottom-4 left-4 right-4 flex items-center gap-2 z-20">
                    <button
                        onClick={() => {
                            setSelectionMode(false);
                            setSelectedIds(new Set());
                        }}
                        className="px-3 h-10 rounded-full bg-[#17212b] border border-[#2b5278] text-gray-300 hover:text-white hover:bg-[#1e2c3a]"
                    >
                        Cancel
                    </button>
                    {allSelectedMine && onDelete && (
                        <button
                            onClick={handleDeleteSelected}
                            className="px-4 h-10 rounded-full bg-red-600 hover:bg-red-700 text-white font-medium"
                        >
                            Delete
                        </button>
                    )}
                    {onForwardSelected && (
                        <button
                            onClick={handleForwardSelected}
                            disabled={selectedIds.size === 0}
                            className="px-4 h-10 rounded-full bg-[#2b5278] hover:bg-[#3a6794] disabled:opacity-50 text-white font-medium"
                        >
                            Forward
                        </button>
                    )}
                    <button
                        onClick={handleCopySelected}
                        disabled={selectedIds.size === 0}
                        className="flex-1 h-10 rounded-full bg-[#4ea4f6] disabled:opacity-50 text-white font-medium"
                    >
                        Copy {selectedIds.size} message{selectedIds.size === 1 ? "" : "s"}
                    </button>
                </div>
            )}
        </div>
    );
}
