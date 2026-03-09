import { useRef, useEffect, useCallback, useState } from "react";
import type { ChatMessage } from "../../types";
import MessageBubble from "./MessageBubble";
import { useUser } from "../../contexts/UserContext";
import { useChat } from "../../contexts/ChatContext";
import { fetchMessages } from "../../lib/api";
import { isConnect4Message } from "./Connect4Game";

// Check if a message is a game message (Connect4 or Chess)
function isGameMessage(text: string): boolean {
    return isConnect4Message(text) || text.startsWith("GAME::CHESS::");
}

interface MessageListProps {
    chatId: string;
    messages: ChatMessage[];
    setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
    onReply: (msg: ChatMessage) => void;
    onEdit?: (msg: ChatMessage) => void;
    onDelete?: (msg: ChatMessage) => void;
}

export default function MessageList({
    chatId,
    messages,
    setMessages,
    onReply,
    onEdit,
    onDelete,
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
    const [lastSendMessageId, setLastSendMessageId] = useState(0);
    const prevScrollHeightRef = useRef(0);
    const chatIdRef = useRef(chatId);
    chatIdRef.current = chatId;
    const seenSentRef = useRef<Set<number>>(new Set());
    const [seenTrigger, setSeenTrigger] = useState(0);
    const prevNewestMsgIdRef = useRef(0);
    const visibleMsgIdsRef = useRef<Set<number>>(new Set());
    const isLoadingOlderRef = useRef(false);

    // Scroll to bottom
    const scrollToBottom = useCallback((smooth = true) => {
        bottomRef.current?.scrollIntoView({
            behavior: smooth ? "smooth" : "instant",
        });
    }, []);

    // Initial message load
    useEffect(() => {
        setMessages([]);
        setHasMore(true);
        setInitialLoad(true);
        seenSentRef.current.clear();
        visibleMsgIdsRef.current.clear();

        fetchMessages(chatId, 0, 30).then((data) => {
            if (chatIdRef.current !== chatId) return; // stale
            setMessages((prev) => {
                // Merge fetched with any WS messages that arrived during load
                const map = new Map<number, ChatMessage>();
                data.messages.forEach((m) => map.set(m.id, m));
                // WS messages not in fetch result are newer; keep them
                prev.forEach((m) => { if (!map.has(m.id)) map.set(m.id, m); });
                return Array.from(map.values()).sort((a, b) => a.id - b.id);
            });
            setHasMore(data.hasMore);
            setInitialLoad(false);
            setTimeout(() => scrollToBottom(false), 50);
        });
    }, [chatId, setMessages, scrollToBottom]);

    // Refetch messages when returning from background (visibility change)
    useEffect(() => {
        const handleVisibility = () => {
            if (document.visibilityState === "visible" && !initialLoad) {
                fetchMessages(chatId, 0, 30).then((data) => {
                    if (chatIdRef.current !== chatId) return;
                    setMessages((prev) => {
                        const map = new Map<number, ChatMessage>();
                        // Use fetched messages as base
                        data.messages.forEach((m) => map.set(m.id, m));
                        // Keep existing messages not in fetch result (older loaded or newer WS)
                        prev.forEach((m) => { if (!map.has(m.id)) map.set(m.id, m); });
                        return Array.from(map.values()).sort((a, b) => a.id - b.id);
                    });
                    setHasMore(data.hasMore);
                });
            }
        };

        document.addEventListener("visibilitychange", handleVisibility);
        return () => document.removeEventListener("visibilitychange", handleVisibility);
    }, [chatId, initialLoad, setMessages]);

    // Auto-scroll on new messages: only if near bottom AND the new message is from us
    // AND not a game move. When loading older messages, never auto-scroll.
    useEffect(() => {
        if (initialLoad) return;
        if (isLoadingOlderRef.current) return;
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
            container.scrollHeight - container.scrollTop - container.clientHeight < 150;
        const isOwnMessage = newestMsg?.browserId === settings.browserId;

        if (isOwnMessage && lastSendMessageId != newestMsg.id) {
            // Always scroll to bottom when user sends a message
            setLastSendMessageId(newestMsg.id);
            setTimeout(() => scrollToBottom(true), 50);
        } else if (isNearBottom && newestMsgId > prevNewestMsgIdRef.current) {
            // Near bottom and new message from someone else — scroll
            setTimeout(() => scrollToBottom(true), 50);
        } else if (newestMsgId > prevNewestMsgIdRef.current) {
            // New message arrived while scrolled up
            setHasNewMessage(true);
        }
        prevNewestMsgIdRef.current = newestMsgId;
    }, [messages, scrollToBottom, initialLoad, settings.browserId]);

    // Re-check seen status after identity verification completes
    // (API-fetched messages may arrive before the server verifies the socket identity)
    useEffect(() => {
        if (!socket) return;
        const handleVerified = (data: { success: boolean }) => {
            if (!data.success) return;
            seenSentRef.current.clear();
            setSeenTrigger((c) => c + 1);
        };
        socket.on("identity_verified", handleVerified);
        return () => {
            socket.off("identity_verified", handleVerified);
        };
    }, [socket]);

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
            messageIds.forEach((id) => seenSentRef.current.add(id));
        }
    }, [messages, initialLoad, socket, chatId, settings.browserId, seenTrigger]);

    // Load older messages on scroll up + track scroll position for scroll-to-bottom button
    const handleScroll = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;

        // Show/hide scroll-to-bottom button
        const distFromBottom =
            container.scrollHeight - container.scrollTop - container.clientHeight;
        setShowScrollBtn(distFromBottom > 300);
        if (distFromBottom <= 300) {
            setHasNewMessage(false);
        }

        if (!hasMore || loadingMore) return;
        if (container.scrollTop < 100) {
            setLoadingMore(true);
            isLoadingOlderRef.current = true;
            prevScrollHeightRef.current = container.scrollHeight;

            fetchMessages(chatId, messages.length, 20).then((data) => {
                if (data.messages.length > 0) {
                    setMessages((prev) => [...data.messages, ...prev]);
                    setHasMore(data.hasMore);

                    // Preserve scroll position
                    requestAnimationFrame(() => {
                        if (container) {
                            const newScrollHeight = container.scrollHeight;
                            container.scrollTop =
                                newScrollHeight - prevScrollHeightRef.current;
                        }
                        // Reset the loading flag after scroll position is restored
                        isLoadingOlderRef.current = false;
                    });
                } else {
                    setHasMore(false);
                    isLoadingOlderRef.current = false;
                }
                setLoadingMore(false);
            });
        }
    }, [chatId, hasMore, loadingMore, messages.length, setMessages]);

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

    return (
        <div className="relative h-full">
            <div
                ref={containerRef}
                onScroll={handleScroll}
                className="sc-chat-wallpaper h-full overflow-y-auto py-3"
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
                {messages.map((msg, idx) => (
                    <div key={msg.id} data-msg-id={msg.id}>
                        <MessageBubble
                            msg={msg}
                            chatId={chatId}
                            isMine={msg.browserId === settings.browserId}
                            replyTarget={msg.replyToId ? findMessage(msg.replyToId) : undefined}
                            onReply={onReply}
                            onScrollToMessage={scrollToMessage}
                            onEdit={onEdit}
                            onDelete={onDelete}
                        />
                    </div>
                ))}

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
        </div>
    );
}
