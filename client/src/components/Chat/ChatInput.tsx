import { useState, useRef, useEffect, useCallback } from "react";
import type { ChatMessage, ForwardMessagePayload } from "../../types";
import { useUser } from "../../contexts/UserContext";
import { useChat } from "../../contexts/ChatContext";
import { encryptText, encryptFile, decryptText, decryptFile } from "../../lib/crypto";
import { getEncryptionKey, getDraft, setDraft, getChatDisplayName, getPvKeyMap } from "../../lib/storage";
import { fetchMessages, sendMessage, uploadFile } from "../../lib/api";
import { getPendingMessages, upsertPendingMessage, removePendingMessage } from "../../lib/pendingMessages";
import { renderTextWithEmoji } from "../../lib/emojiService";
import EmojiPicker from "./EmojiPicker";
import AppleEmoji from "../ui/AppleEmoji";
import ImageEditorModal from "./ImageEditorModal";
import VideoTrimModal from "./VideoTrimModal";
import { createConnect4 } from "./Connect4Game";
import { createChess } from "./ChessGame";
import { createXO } from "./XOGame";
import { createMinesweeper } from "./MinesweeperGame";
import { createOthello } from "./OthelloGame";
import { createBackgammon } from "./BackgammonGame";
import { createHokm2 } from "./Hokm2Game";
import { createHokm4 } from "./Hokm4Game";
import { createChaarBarg } from "./ChaarBargGame";

interface ChatInputProps {
    chatId: string;
    replyTo: ChatMessage | null;
    onClearReply: () => void;
    editingMessage?: ChatMessage | null;
    onClearEdit?: () => void;
    forwardingMessages?: ForwardMessagePayload[];
    onClearForward?: () => void;
    messages?: ChatMessage[];
    emojiPickerOpen?: boolean;
    onEmojiPickerChange?: (open: boolean) => void;
    onEdit?: (msg: ChatMessage) => void;
    onOptimisticMessageAdd?: (msg: ChatMessage) => void;
    onOptimisticMessageStatusChange?: (messageId: number, status: "pending" | "failed" | "sent", serverMessage?: ChatMessage) => void;
    retryMessage?: ChatMessage | null;
    onRetryHandled?: () => void;
}

// 🎲 with optional variation selector (U+FE0F) to match emoji/text presentation.
const DICE_EMOJI_REGEX = /^🎲\uFE0F?$/u;
const DICE_MESSAGE_TOKEN_REGEX = /^DICE::([1-6])$/;
const DICE_MESSAGE_TOKEN_PREFIX = "DICE::";
const SOCKET_MESSAGE_ACK_TIMEOUT_MS = 3000;
const RECENT_MESSAGES_FETCH_LIMIT = 10;
const PENDING_VERIFY_BASE_RETRY_MS = 3000;
const PENDING_VERIFY_MAX_RETRY_MS = 15000;
const PENDING_VERIFY_BACKOFF_STEPS_CAP = 6;

async function readMediaDurationSec(file: Blob, kind: "audio" | "video"): Promise<number | undefined> {
    return await new Promise<number | undefined>((resolve) => {
        const element = document.createElement(kind) as HTMLAudioElement | HTMLVideoElement;
        const objectUrl = URL.createObjectURL(file);
        const cleanup = () => {
            element.removeAttribute("src");
            element.load();
            URL.revokeObjectURL(objectUrl);
        };
        const done = (value?: number) => {
            cleanup();
            resolve(typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined);
        };
        element.preload = "metadata";
        element.onloadedmetadata = () => done(element.duration);
        element.onerror = () => done(undefined);
        element.src = objectUrl;
    });
}

/**
 * Trims outgoing text and maps a standalone dice emoji message to DICE::<1-6>,
 * which is the backend/client token used for dice-roll message handling.
 */
function normalizeOutgoingText(rawText: string): string {
    const trimmed = rawText.trim();
    if (!DICE_EMOJI_REGEX.test(trimmed)) return trimmed;
    const rolledValue = Math.floor(Math.random() * 6) + 1;
    return `${DICE_MESSAGE_TOKEN_PREFIX}${rolledValue}`;
}

export default function ChatInput({ chatId, replyTo, onClearReply, editingMessage, onClearEdit, forwardingMessages = [], onClearForward, messages = [], emojiPickerOpen, onEmojiPickerChange, onEdit, onOptimisticMessageAdd, onOptimisticMessageStatusChange, retryMessage, onRetryHandled }: ChatInputProps) {
    const { settings } = useUser();
    const { socket, reconnectSocket } = useChat();
    const [text, setText] = useState(() => getDraft(chatId));
    const [file, setFile] = useState<File | null>(null);
    const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
    const [sending, setSending] = useState(false);
    const [recording, setRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const [showEmoji, setShowEmojiInternal] = useState(false);
    const setShowEmoji = (val: boolean | ((prev: boolean) => boolean)) => {
        const newVal = typeof val === "function" ? val(showEmoji) : val;
        setShowEmojiInternal(newVal);
        onEmojiPickerChange?.(newVal);
    };

    // Sync emoji state from parent (e.g., back button closing it)
    const showEmojiRef = useRef(showEmoji);
    showEmojiRef.current = showEmoji;
    useEffect(() => {
        if (emojiPickerOpen === false && showEmojiRef.current) {
            setShowEmojiInternal(false);
        }
    }, [emojiPickerOpen]);
    const [showActionsMenu, setShowActionsMenu] = useState(false);
    const [showGameModal, setShowGameModal] = useState(false);
    const [showImageEditor, setShowImageEditor] = useState(false);
    const [showVideoTrimmer, setShowVideoTrimmer] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<{
        index: number;
        total: number;
        fileName: string;
        loaded: number;
        fileSize: number;
        totalLoaded: number;
        totalSize: number;
    } | null>(null);
    const [mentionQuery, setMentionQuery] = useState<string | null>(null);
    const [mentionUsers, setMentionUsers] = useState<{ browserId: string; name: string }[]>([]);
    const [selectedTags, setSelectedTags] = useState<{ browserId: string; name: string }[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const inputOverlayRef = useRef<HTMLDivElement>(null);
    const actionsButtonRef = useRef<HTMLButtonElement>(null);
    const actionsMenuRef = useRef<HTMLDivElement>(null);
    const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const recordingTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
    const uploadAbortControllerRef = useRef<AbortController | null>(null);
    const uploadCanceledRef = useRef(false);
    const optimisticIdCounterRef = useRef(0);
    const [replyPreview, setReplyPreview] = useState("");
    const [inputEmojiRender, setInputEmojiRender] = useState({
        font: "",
        size: 18,
    });
    const prevChatIdRef = useRef(chatId);
    const messagesRef = useRef(messages);
    messagesRef.current = messages;
    const activeChatIdRef = useRef(chatId);
    activeChatIdRef.current = chatId;
    const retryInFlightRef = useRef<number | null>(null);
    const pendingFailureCheckTimeoutsRef = useRef<Map<number, number>>(new Map());
    const pendingFailureCheckAttemptsRef = useRef<Map<number, number>>(new Map());
    const sendUploadProgressEvent = useCallback((progress: {
        index: number;
        total: number;
        fileName: string;
        loaded: number;
        fileSize: number;
        totalLoaded: number;
        totalSize: number;
    } | null) => {
        window.dispatchEvent(new CustomEvent("sc-chat-upload-progress", {
            detail: { chatId, progress },
        }));
    }, [chatId]);

    useEffect(() => {
        sendUploadProgressEvent(uploadProgress);
        return () => sendUploadProgressEvent(null);
    }, [sendUploadProgressEvent, uploadProgress]);

    const ensureSentMessageVisible = useCallback(async (messageId?: number) => {
        if (!messageId || Number.isNaN(messageId)) return;
        const expectedChatId = chatId;

        const messageExistsLocally = () => messagesRef.current.some((m) => m.id === messageId);
        if (messageExistsLocally()) return;

        let socketDelivered = false;
        if (socket?.connected) {
            socketDelivered = await new Promise<boolean>((resolve) => {
                let active = true;
                const handleSocketMessage = (incoming: ChatMessage & { chatId: string }) => {
                    if (!active || activeChatIdRef.current !== expectedChatId) {
                        window.clearTimeout(timeoutId);
                        socket.off("new_message", handleSocketMessage);
                        resolve(false);
                        return;
                    }
                    if (incoming.chatId === expectedChatId && incoming.id === messageId) {
                        window.clearTimeout(timeoutId);
                        socket.off("new_message", handleSocketMessage);
                        resolve(true);
                    }
                };

                const timeoutId = window.setTimeout(() => {
                    active = false;
                    socket.off("new_message", handleSocketMessage);
                    resolve(false);
                }, SOCKET_MESSAGE_ACK_TIMEOUT_MS);

                socket.on("new_message", handleSocketMessage);
            });
        }

        if (socketDelivered || messageExistsLocally()) return;

        await new Promise<void>((resolve) => {
            window.dispatchEvent(
                new CustomEvent("sc-force-refresh-chat-messages", {
                    detail: { chatId: expectedChatId, done: resolve },
                })
            );
        });
        reconnectSocket();
    }, [chatId, reconnectSocket, socket]);

    const sendMessageWithFallback = useCallback(async (
        textToSend: string,
        displayName: string,
        replyToId?: number,
        tags?: { browserId: string; name: string }[]
    ) => {
        const response = await sendMessage(
            chatId,
            textToSend,
            displayName,
            settings.browserId,
            replyToId,
            tags
        );
        try {
            await ensureSentMessageVisible(response?.message?.id);
        } catch (error) {
            console.warn("Message sent but visibility sync failed:", error);
        }
        return response;
    }, [chatId, ensureSentMessageVisible, settings.browserId]);

    const verifyPendingDeliveryBeforeFail = useCallback((pendingMessage: ChatMessage) => {
        if (pendingFailureCheckTimeoutsRef.current.has(pendingMessage.id)) return;

        const runCheck = async () => {
            pendingFailureCheckTimeoutsRef.current.delete(pendingMessage.id);
            try {
                const latest = await fetchMessages(chatId, 0, RECENT_MESSAGES_FETCH_LIMIT);
                pendingFailureCheckAttemptsRef.current.delete(pendingMessage.id);
                const matchedMessage = latest.messages.find((m) =>
                    m.browserId === settings.browserId
                    && typeof pendingMessage.rawText === "string"
                    && m.text === pendingMessage.rawText
                );

                if (matchedMessage) {
                    removePendingMessage(chatId, pendingMessage.id);
                    onOptimisticMessageStatusChange?.(pendingMessage.id, "sent", matchedMessage);
                    return;
                }

                const stillPending = getPendingMessages(chatId).some((m) => m.id === pendingMessage.id);
                if (!stillPending) {
                    return;
                }

                const failedMessage = { ...pendingMessage, localStatus: "failed" as const };
                upsertPendingMessage(chatId, failedMessage);
                onOptimisticMessageStatusChange?.(pendingMessage.id, "failed");
            } catch (error) {
                console.warn("Pending delivery verification failed, keeping pending:", error);
                const attempt = (pendingFailureCheckAttemptsRef.current.get(pendingMessage.id) ?? 0) + 1;
                pendingFailureCheckAttemptsRef.current.set(pendingMessage.id, attempt);
                const backoffSteps = Math.min(attempt - 1, PENDING_VERIFY_BACKOFF_STEPS_CAP);
                const retryMs = Math.min(
                    PENDING_VERIFY_BASE_RETRY_MS * (2 ** backoffSteps),
                    PENDING_VERIFY_MAX_RETRY_MS
                );
                const timeoutId = window.setTimeout(runCheck, retryMs);
                pendingFailureCheckTimeoutsRef.current.set(pendingMessage.id, timeoutId);
            }
        };

        runCheck();
    }, [chatId, onOptimisticMessageStatusChange, settings.browserId]);

    useEffect(() => {
        return () => {
            pendingFailureCheckTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
            pendingFailureCheckTimeoutsRef.current.clear();
            pendingFailureCheckAttemptsRef.current.clear();
        };
    }, [chatId]);

    useEffect(() => {
        if (!retryMessage || retryMessage.localStatus !== "failed") return;
        if (retryInFlightRef.current === retryMessage.id) return;
        retryInFlightRef.current = retryMessage.id;

        const run = async () => {
            const key = getEncryptionKey(chatId);
            const displayName = getChatDisplayName(chatId) || settings.displayName;
            const outgoingText = normalizeOutgoingText(retryMessage.text || "");
            const encryptedText = await encryptText(outgoingText, key, chatId);
            const retryPending = {
                ...retryMessage,
                name: displayName,
                text: outgoingText,
                rawText: encryptedText,
                localStatus: "pending" as const,
                localOnly: true,
            };
            upsertPendingMessage(chatId, retryPending);
            onOptimisticMessageStatusChange?.(retryMessage.id, "pending");

            try {
                const response = await sendMessageWithFallback(
                    encryptedText,
                    displayName,
                    retryMessage.replyToId,
                    retryMessage.tags
                );
                removePendingMessage(chatId, retryMessage.id);
                onOptimisticMessageStatusChange?.(retryMessage.id, "sent", response?.message);
            } catch (err) {
                verifyPendingDeliveryBeforeFail(retryPending);
                console.error("Failed to retry message:", err);
            } finally {
                retryInFlightRef.current = null;
                onRetryHandled?.();
            }
        };
        run();
    }, [chatId, onOptimisticMessageStatusChange, onRetryHandled, retryMessage, sendMessageWithFallback, settings.displayName, verifyPendingDeliveryBeforeFail]);

    // Get per-chat display name (fallback to global display name)
    const getDisplayName = () => {
        const chatName = getChatDisplayName(chatId);
        return chatName || settings.displayName;
    };

    // Save draft and load new draft when switching chats
    useEffect(() => {
        if (prevChatIdRef.current !== chatId) {
            // Save draft for previous chat
            setDraft(prevChatIdRef.current, text);
            // Load draft for new chat
            setText(getDraft(chatId));
            prevChatIdRef.current = chatId;
        }
    }, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps

    // === داخل کامپوننت ===
    const latestTextRef = useRef<string>(text);

    // به‌روزرسانی ref هر بار که متن عوض می‌شود
    useEffect(() => {
        latestTextRef.current = text;
    }, [text]);

    // ذخیره درفت فقط در زمان unmount
    useEffect(() => {
        return () => {
            // در اینجا latestTextRef.current همیشه آخرین مقدار متن را دارد
            setDraft(chatId, latestTextRef.current);
        };
        // وابستگی خالی → فقط زمان mount / unmount اجرا می‌شود
    }, []);

    // Decrypt reply preview text
    useEffect(() => {
        if (replyTo?.text) {
            const key = getEncryptionKey(chatId);
            decryptText(replyTo.text, key, chatId).then((r) => {
                setReplyPreview(r.failed ? "[encrypted]" : r.text);
            });
        } else {
            setReplyPreview("");
        }
    }, [replyTo, chatId]);

    // When editing a message, populate text field with decrypted content
    useEffect(() => {
        if (editingMessage?.text) {
            const key = getEncryptionKey(chatId);
            decryptText(editingMessage.text, key, chatId).then((r) => {
                setText(r.failed ? "" : r.text);
                textareaRef.current?.focus();
            });
        }
    }, [editingMessage, chatId]);

    // ESC cancels edit mode
    useEffect(() => {
        if (!editingMessage) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClearEdit?.();
                setText("");
                setQueuedFiles([]);
                setDraft(chatId, "");
                resetTextareaHeight();
                setShowImageEditor(false);
                setShowVideoTrimmer(false);
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [editingMessage, chatId, onClearEdit]);

    // Focus input when reply is selected
    useEffect(() => {
        if (replyTo) {
            textareaRef.current?.focus();
        }
    }, [replyTo]);

    useEffect(() => {
        if (!showActionsMenu) return;

        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            if (actionsButtonRef.current?.contains(target) || actionsMenuRef.current?.contains(target)) {
                return;
            }
            setShowActionsMenu(false);
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [showActionsMenu]);

    useEffect(() => {
        const updateInputEmojiRender = () => {
            const ta = textareaRef.current;
            if (!ta) return;

            const styles = window.getComputedStyle(ta);
            const fontSize = parseFloat(styles.fontSize) || 15;
            const measurementFont = `${styles.fontStyle} ${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`.replace(/\s+/g, " ").trim();

            let measuredWidth = fontSize;
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            if (ctx) {
                ctx.font = measurementFont;
                const width = ctx.measureText("😍").width;
                if (Number.isFinite(width) && width > 0) {
                    measuredWidth = width;
                }
            }

            setInputEmojiRender({
                font: measurementFont,
                size: Math.max(fontSize, Math.round(Math.max(measuredWidth, fontSize * 1.2))),
            });
        };

        updateInputEmojiRender();
        window.addEventListener("resize", updateInputEmojiRender);
        return () => window.removeEventListener("resize", updateInputEmojiRender);
    }, []);

    const toggleEmojiPicker = () => {
        setShowActionsMenu(false);
        const wasOpen = showEmoji;
        setShowEmoji((prev) => !prev);
        // On mobile, closing the emoji panel should re-focus the textarea to open the keyboard
        if (wasOpen && isMobile) {
            requestAnimationFrame(() => textareaRef.current?.focus());
        }
    };

    const toggleActionsMenu = () => {
        setShowEmoji(false);
        setShowActionsMenu((prev) => !prev);
    };

    const handleEmojiSelect = (emoji: string) => {
        const ta = textareaRef.current;
        if (ta) {
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            const newText = text.slice(0, start) + emoji + text.slice(end);
            setText(newText);
            // Set cursor position after emoji without focusing (avoids opening keyboard on mobile)
            requestAnimationFrame(() => {
                ta.selectionStart = ta.selectionEnd = start + emoji.length;
            });
        } else {
            setText((prev) => prev + emoji);
        }
    };

    const resetTextareaHeight = () => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "42px";
            textareaRef.current.scrollTop = 0;
        }
        if (inputOverlayRef.current) {
            inputOverlayRef.current.scrollTop = 0;
        }
    };
    const resetUploadUiState = () => {
        uploadAbortControllerRef.current = null;
        uploadCanceledRef.current = false;
        setUploadProgress(null);
        setSending(false);
    };

    // ─── Send GIF or Sticker from emoji panel ───
    const handleSendGifOrSticker = async (mediaFile: File, mediaType: "gif" | "sticker") => {
        if (sending) return;
        setSending(true);
        try {
            const key = getEncryptionKey(chatId);
            const displayName = getDisplayName();
            const buffer = await mediaFile.arrayBuffer();
            const encryptedBuffer = key
                ? await encryptFile(buffer, key, chatId)
                : buffer;

            await uploadFile(
                chatId,
                new Blob([encryptedBuffer]),
                displayName,
                settings.browserId,
                mediaType,
                mediaFile.name,
                mediaFile.size,
                undefined,
                "",
                replyTo?.id
            );

            setShowEmoji(false);
            onClearReply();
        } catch (err) {
            console.error("Failed to send " + mediaType + ":", err);
        }
        setSending(false);
    };

    const handleSendGif = (mediaFile: File) => handleSendGifOrSticker(mediaFile, "gif");
    const handleSendSticker = (mediaFile: File) => handleSendGifOrSticker(mediaFile, "sticker");

    const handleSend = async () => {
        if (uploadProgress) {
            const outgoingText = normalizeOutgoingText(text);
            if (!outgoingText) return;
            setSending(true);
            try {
                const key = getEncryptionKey(chatId);
                const encryptedText = await encryptText(outgoingText, key, chatId);
                await sendMessageWithFallback(
                    encryptedText,
                    getDisplayName(),
                    replyTo?.id,
                    selectedTags.length > 0 ? selectedTags : undefined
                );
                setText("");
                setDraft(chatId, "");
                resetTextareaHeight();
                setShowEmoji(false);
                setShowActionsMenu(false);
                setSelectedTags([]);
                setMentionQuery(null);
                onClearReply();
            } catch (err) {
                console.error("Failed to send:", err);
            } finally {
                setSending(false);
                textareaRef.current?.focus();
            }
            return;
        }
        if ((!text.trim() && !file && forwardingMessages.length === 0) || sending) return;
        setSending(true);
        uploadCanceledRef.current = false;

        try {
            const key = getEncryptionKey(chatId);
            const displayName = getDisplayName();
            const outgoingText = normalizeOutgoingText(text);
            const hasOutgoingText = outgoingText.length > 0;
            const shouldSendDiceUnencrypted = DICE_EMOJI_REGEX.test(text.trim()) && DICE_MESSAGE_TOKEN_REGEX.test(outgoingText);

            if (forwardingMessages.length > 0) {
                for (const message of forwardingMessages) {
                    const plainText = message.text?.trim() ?? "";
                    const isDiceOrGameText = plainText.startsWith("DICE::") || plainText.startsWith("GAME::");
                    const shouldPrefix = plainText.length > 0 && !isDiceOrGameText;
                    const finalText = plainText
                        ? `${shouldPrefix ? `Forwarded from ${message.name}:\n` : ""}${plainText}`
                        : "";

                    if (message.file) {
                        const res = await fetch(message.file);
                        if (!res.ok) {
                            console.error(`Failed to fetch file while forwarding message ${message.id} from ${message.sourceChatId} to ${chatId}: ${res.status}`);
                            continue;
                        }
                        const encryptedSourceBuffer = await res.arrayBuffer();
                        const sourceKey = getEncryptionKey(message.sourceChatId);
                        if (!sourceKey) {
                            console.error(`Missing source encryption key for forwarded message ${message.id} in chat ${message.sourceChatId}`);
                            continue;
                        }
                        const decryptedSourceBuffer = await decryptFile(encryptedSourceBuffer, sourceKey, message.sourceChatId);
                        if (!decryptedSourceBuffer) {
                            console.error(`Failed to decrypt forwarded file for message ${message.id}`);
                            continue;
                        }
                        const encryptedBuffer = key
                            ? await encryptFile(decryptedSourceBuffer, key, chatId)
                            : decryptedSourceBuffer;
                        const encryptedText = finalText ? await encryptText(finalText, key, chatId) : "";
                        await uploadFile(
                            chatId,
                            new Blob([encryptedBuffer]),
                            displayName,
                            settings.browserId,
                            message.fileType || "other",
                            message.originalName || "file",
                            message.fileSize,
                            message.mediaDurationSec,
                            encryptedText
                        );
                    } else if (finalText) {
                        const encryptedText = await encryptText(finalText, key, chatId);
                        await sendMessageWithFallback(encryptedText, displayName);
                    }
                }
                onClearForward?.();
                setShowEmoji(false);
                setShowActionsMenu(false);
                return;
            }

            // Handle edit mode
            if (editingMessage) {
                const encryptedText = await encryptText(outgoingText, key, chatId);
                socket?.emit("edit_message", {
                    chatId,
                    messageId: editingMessage.id,
                    text: encryptedText,
                    browserId: settings.browserId,
                });
                setText("");
                setDraft(chatId, "");
                resetTextareaHeight();
                setShowEmoji(false);
                setShowActionsMenu(false);
                onClearEdit?.();
                setSending(false);
                textareaRef.current?.focus();
                return;
            }

            if (file) {
                const allFiles = [file, ...queuedFiles];
                const lastIdx = allFiles.length - 1;
                const totalSize = allFiles.reduce((sum, currentFile) => sum + currentFile.size, 0);
                let completedBytes = 0;
                uploadAbortControllerRef.current = new AbortController();
                const captionText = hasOutgoingText
                    ? (shouldSendDiceUnencrypted ? outgoingText : await encryptText(outgoingText, key, chatId))
                    : "";
                setText("");
                setDraft(chatId, "");
                resetTextareaHeight();
                setFile(null);
                setQueuedFiles([]);
                setShowImageEditor(false);
                setShowVideoTrimmer(false);
                setShowEmoji(false);
                setShowActionsMenu(false);
                setSelectedTags([]);
                setMentionQuery(null);
                onClearReply();

                for (let i = 0; i < allFiles.length; i++) {
                    if (uploadCanceledRef.current) break;
                    const currentFile = allFiles[i];
                    setUploadProgress({
                        index: i + 1,
                        total: allFiles.length,
                        fileName: currentFile.name,
                        loaded: 0,
                        fileSize: currentFile.size,
                        totalLoaded: completedBytes,
                        totalSize,
                    });
                    const buffer = await currentFile.arrayBuffer();
                    const encryptedBuffer = key
                        ? await encryptFile(buffer, key, chatId)
                        : buffer;
                    if (uploadCanceledRef.current) break;

                    const mime = currentFile.type || "";
                    let fileType = "other";
                    if (mime.startsWith("image/")) fileType = "image";
                    else if (mime.startsWith("audio/")) fileType = "audio";
                    else if (mime.startsWith("video/")) fileType = "video";
                    const mediaDurationSec = fileType === "audio" || fileType === "video"
                        ? await readMediaDurationSec(currentFile, fileType)
                        : undefined;

                    const encryptedText = i === lastIdx ? captionText : "";

                    await uploadFile(
                        chatId,
                        new Blob([encryptedBuffer]),
                        displayName,
                        settings.browserId,
                        fileType,
                        currentFile.name,
                        currentFile.size,
                        mediaDurationSec,
                        encryptedText,
                        replyTo?.id,
                        (loadedBytes) => {
                            setUploadProgress({
                                index: i + 1,
                                total: allFiles.length,
                                fileName: currentFile.name,
                                loaded: loadedBytes,
                                fileSize: currentFile.size,
                                totalLoaded: completedBytes + loadedBytes,
                                totalSize,
                            });
                        },
                        uploadAbortControllerRef.current.signal
                    );
                    if (uploadCanceledRef.current) break;
                    completedBytes += currentFile.size;
                }
                if (uploadCanceledRef.current) return;
            } else {
                const encryptedText = shouldSendDiceUnencrypted
                    ? outgoingText
                    : await encryptText(outgoingText, key, chatId);

                optimisticIdCounterRef.current += 1;
                const optimisticMessageId = Date.now() * 100000 + optimisticIdCounterRef.current;
                const optimisticMessage: ChatMessage = {
                    id: optimisticMessageId,
                    text: outgoingText,
                    rawText: encryptedText,
                    name: displayName,
                    browserId: settings.browserId,
                    createdAt: new Date().toISOString(),
                    replyToId: replyTo?.id,
                    tags: selectedTags.length > 0 ? selectedTags : undefined,
                    seenBy: [],
                    localStatus: "pending",
                    localOnly: true,
                };
                onOptimisticMessageAdd?.(optimisticMessage);
                upsertPendingMessage(chatId, optimisticMessage);

                setText("");
                setDraft(chatId, "");
                resetTextareaHeight();
                setShowEmoji(false);
                setShowActionsMenu(false);
                setSelectedTags([]);
                setMentionQuery(null);
                onClearReply();

                try {
                    const response = await sendMessageWithFallback(
                        encryptedText,
                        displayName,
                        replyTo?.id,
                        selectedTags.length > 0 ? selectedTags : undefined
                    );
                    removePendingMessage(chatId, optimisticMessageId);
                    onOptimisticMessageStatusChange?.(optimisticMessageId, "sent", response?.message);
                } catch (err) {
                    verifyPendingDeliveryBeforeFail(optimisticMessage);
                    console.error("Failed to send:", err);
                }
            }

            setFile(null);
            setQueuedFiles([]);
            setShowImageEditor(false);
            setShowVideoTrimmer(false);
            setShowEmoji(false);
            setShowActionsMenu(false);
            setSelectedTags([]);
            setMentionQuery(null);
            setUploadProgress(null);
            onClearReply();

            socket?.emit("typing", {
                chatId,
                name: displayName,
                isTyping: false,
            });

            // If this is a PV chat, send a PV request to the other user
            if (chatId.startsWith("pv-")) {
                const pvMap = getPvKeyMap();
                for (const [otherBrowserId, entry] of Object.entries(pvMap)) {
                    if (entry.chatKey === chatId && !entry.confirmed) {
                        socket?.emit("pv_request", {
                            fromBrowserId: settings.browserId,
                            toBrowserId: otherBrowserId,
                            chatKey: chatId,
                            senderName: displayName,
                        });
                        break;
                    }
                }
            }
        } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") {
                return;
            }
            console.error("Failed to send:", err);
        } finally {
            resetUploadUiState();
            textareaRef.current?.focus();
        }
    };

    const cancelUpload = useCallback(() => {
        uploadCanceledRef.current = true;
        uploadAbortControllerRef.current?.abort();
        resetUploadUiState();
        setFile(null);
        setQueuedFiles([]);
        setShowImageEditor(false);
        setShowVideoTrimmer(false);
    }, []);

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

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowUp" && !text.trim() && !editingMessage) {
            const lastMessage = messages[messages.length - 1];
            const isEditableTextMessage =
                Boolean(lastMessage?.text)
                && !lastMessage.text.startsWith("GAME::")
                && !lastMessage.text.startsWith("DICE::");
            if (lastMessage?.browserId === settings.browserId && isEditableTextMessage) {
                e.preventDefault();
                onEdit?.(lastMessage);
                return;
            }
        }
        if (e.key === "Enter" && !e.shiftKey && !isMobile) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleTyping = () => {
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        const displayName = getDisplayName();
        socket?.emit("typing", {
            chatId,
            name: displayName,
            isTyping: true,
        });
        typingTimeoutRef.current = setTimeout(() => {
            socket?.emit("typing", {
                chatId,
                name: displayName,
                isTyping: false,
            });
        }, 2000);
    };

    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newText = e.target.value;
        setText(newText);
        if (!newText && inputOverlayRef.current) {
            inputOverlayRef.current.scrollTop = 0;
        }
        handleTyping();

        // Check for @ mention trigger
        const cursorPos = e.target.selectionStart;
        const textBeforeCursor = newText.slice(0, cursorPos);
        const atMatch = textBeforeCursor.match(/@(\w*)$/);
        if (atMatch) {
            const query = atMatch[1].toLowerCase();
            setMentionQuery(query);
            // Get unique users from messages (excluding self)
            const usersMap = new Map<string, string>();
            messages.forEach((m) => {
                if (m.browserId !== settings.browserId && !usersMap.has(m.browserId)) {
                    usersMap.set(m.browserId, m.name);
                }
            });
            const filtered = Array.from(usersMap.entries())
                .map(([browserId, name]) => ({ browserId, name }))
                .filter((u) => u.name.toLowerCase().includes(query));
            setMentionUsers(filtered);
        } else {
            setMentionQuery(null);
            setMentionUsers([]);
        }

        const el = e.target;
        el.style.height = "auto";
        el.style.height = Math.min(el.scrollHeight, 120) + "px";
    };

    const handleMentionSelect = (user: { browserId: string; name: string }) => {
        const ta = textareaRef.current;
        if (!ta) return;
        const cursorPos = ta.selectionStart;
        const textBeforeCursor = text.slice(0, cursorPos);
        const atMatch = textBeforeCursor.match(/@(\w*)$/);
        if (atMatch) {
            const beforeAt = textBeforeCursor.slice(0, atMatch.index);
            const afterCursor = text.slice(cursorPos);
            const newText = beforeAt + `@${user.name} ` + afterCursor;
            setText(newText);
            setSelectedTags((prev) => {
                if (prev.some((t) => t.browserId === user.browserId)) return prev;
                return [...prev, user];
            });
        }
        setMentionQuery(null);
        setMentionUsers([]);
        ta.focus();
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files ? Array.from(e.target.files) : [];
        if (files.length > 0) {
            handleIncomingFiles(files);
        }
        // Reset the file input value so onChange fires even for the same file
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const handleIncomingFiles = useCallback((incomingFiles: File[]) => {
        if (incomingFiles.length === 0) return false;
        if (uploadProgress) {
            alert("Another upload is in progress. Please wait for it to finish or cancel it from the header.");
            return false;
        }
        const tooLarge = incomingFiles.find((selected) => selected.size > 50 * 1024 * 1024);
        if (tooLarge) {
            alert("Each file must be under 50MB");
            return false;
        }
        setShowActionsMenu(false);
        setFile(incomingFiles[incomingFiles.length - 1] || null);
        setQueuedFiles(incomingFiles.slice(0, -1));
        setShowImageEditor(false);
        setShowVideoTrimmer(false);
        return true;
    }, [uploadProgress]);

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const pastedFiles = Array.from(e.clipboardData.files || []);
        if (pastedFiles.length === 0) return;
        if (!handleIncomingFiles(pastedFiles)) return;
        e.preventDefault();
    };

    // ─── Voice Recording ───
    const startRecording = async () => {
        setShowActionsMenu(false);
        setShowEmoji(false);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
                    ? "audio/webm;codecs=opus"
                    : "audio/webm",
            });
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    audioChunksRef.current.push(e.data);
                }
            };

            mediaRecorder.onstop = async () => {
                stream.getTracks().forEach((t) => t.stop());

                const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
                if (blob.size < 500) return; // Too short, ignore
                const hasAudibleSignal = await blobHasAudibleSignal(blob);
                if (!hasAudibleSignal) {
                    alert("No audio detected. Please check your microphone and try again.");
                    return;
                }

                // Send as voice message
                setSending(true);
                try {
                    const key = getEncryptionKey(chatId);
                    const buffer = await blob.arrayBuffer();
                    const encryptedBuffer = key
                        ? await encryptFile(buffer, key, chatId)
                        : buffer;

                    const fileName = `voice-${Date.now()}.webm`;
                    await uploadFile(
                        chatId,
                        new Blob([encryptedBuffer]),
                        getDisplayName(),
                        settings.browserId,
                        "audio",
                        fileName,
                        blob.size,
                        await readMediaDurationSec(blob, "audio"),
                        "",
                        replyTo?.id
                    );
                    onClearReply();
                } catch (err) {
                    console.error("Failed to send voice:", err);
                }
                setSending(false);
            };

            mediaRecorder.start(100);
            setRecording(true);
            setRecordingTime(0);

            // Timer
            recordingTimerRef.current = setInterval(() => {
                setRecordingTime((prev) => prev + 1);
            }, 1000);
        } catch (err) {
            console.error("Microphone access denied:", err);
            alert("Microphone access is required for voice messages");
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            mediaRecorderRef.current.stop();
        }
        setRecording(false);
        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
        }
    };

    const cancelRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            mediaRecorderRef.current.ondataavailable = null;
            mediaRecorderRef.current.onstop = () => {
                mediaRecorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
            };
            mediaRecorderRef.current.stop();
        }
        audioChunksRef.current = [];
        setRecording(false);
        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
        }
    };

    const formatRecordingTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, "0")}`;
    };
    const blobHasAudibleSignal = async (blob: Blob): Promise<boolean> => {
        const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return blob.size >= 500;
        try {
            const audioContext = new AudioCtx();
            try {
                const arrayBuffer = await blob.arrayBuffer();
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
                // Normalized PCM samples are in [-1, 1]; values above ~0.003 indicate non-trivial signal.
                const voiceActivityThreshold = 0.003;
                // Check roughly every 25ms to detect audible signal without scanning every sample.
                const checksPerSecond = 40;
                const sampleStride = Math.max(1, Math.floor(audioBuffer.sampleRate / checksPerSecond));
                for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
                    const channelData = audioBuffer.getChannelData(channel);
                    for (let i = 0; i < channelData.length; i += sampleStride) {
                        if (Math.abs(channelData[i]) > voiceActivityThreshold) {
                            return true;
                        }
                    }
                }
                return false;
            } finally {
                await audioContext.close();
            }
        } catch {
            return blob.size >= 500;
        }
    };
    // ─── Start Connect 4 Game ───
    const handleStartGame = async (gameType: string) => {
        if (sending) return;
        setShowActionsMenu(false);
        setShowGameModal(false);
        setShowEmoji(false);
        setSending(true);
        try {
            let gameText = "";
            switch (gameType) {
                case "connect4": gameText = createConnect4(settings.browserId); break;
                case "chess": gameText = createChess(settings.browserId); break;
                case "xo": gameText = createXO(settings.browserId); break;
                case "minesweeper": gameText = createMinesweeper(settings.browserId); break;
                case "othello": gameText = createOthello(settings.browserId); break;
                case "backgammon": gameText = createBackgammon(settings.browserId); break;
                case "hokm2": gameText = createHokm2(settings.browserId); break;
                case "hokm4": gameText = createHokm4(settings.browserId); break;
                case "chaarbarg": gameText = createChaarBarg(settings.browserId); break;
            }
            if (gameText) {
                await sendMessageWithFallback(gameText, getDisplayName());
            }
        } catch (err) {
            console.error("Failed to start game:", err);
        }
        setSending(false);
    };

    const handleOpenFilePicker = () => {
        if (uploadProgress) return;
        setShowEmoji(false);
        setShowActionsMenu(false);
        fileInputRef.current?.click();
    };

    const getFilePreviewIcon = () => {
        if (!file) return null;
        const mime = file.type;
        if (mime.startsWith("image/")) return <AppleEmoji native="🖼️" size={20} />;
        if (mime.startsWith("video/")) return <AppleEmoji native="🎬" size={20} />;
        if (mime.startsWith("audio/")) return <AppleEmoji native="🎵" size={20} />;
        return <AppleEmoji native="📎" size={20} />;
    };

    const showMicButton = !text.trim() && !file && !editingMessage && forwardingMessages.length === 0;

    useEffect(() => {
        const handleDroppedFiles = (event: Event) => {
            const dropped = (event as CustomEvent<File[]>).detail;
            if (!Array.isArray(dropped) || dropped.length === 0) return;
            handleIncomingFiles(dropped);
        };
        window.addEventListener("sc-chat-files-drop", handleDroppedFiles as EventListener);
        return () => window.removeEventListener("sc-chat-files-drop", handleDroppedFiles as EventListener);
    }, [handleIncomingFiles]);

    useEffect(() => {
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<{ chatId?: string }>).detail;
            if (!detail?.chatId || detail.chatId !== chatId) return;
            cancelUpload();
        };
        window.addEventListener("sc-chat-cancel-upload", handler as EventListener);
        return () => window.removeEventListener("sc-chat-cancel-upload", handler as EventListener);
    }, [cancelUpload, chatId]);

    return (
        <div className="sc-chat-input-shell border-t border-[#0e1621] bg-[#17212b] shrink-0 relative" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
            {/* Mention picker popup */}
            {mentionQuery !== null && mentionUsers.length > 0 && (
                <div className="absolute bottom-full left-0 right-0 bg-[#1e2c3a] border border-[#2b5278]/50 rounded-t-xl shadow-xl max-h-40 overflow-y-auto z-50">
                    {mentionUsers.map((user) => (
                        <button
                            key={user.browserId}
                            onClick={() => handleMentionSelect(user)}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-white hover:bg-[#2b5278] transition text-left"
                        >
                            <div className="w-8 h-8 rounded-full bg-[#4ea4f6] flex items-center justify-center text-white text-xs font-bold shrink-0">
                                {user.name.charAt(0).toUpperCase()}
                            </div>
                            <span>{user.name}</span>
                        </button>
                    ))}
                </div>
            )}

            {/* Emoji picker panel */}
            {showEmoji && (
                <EmojiPicker
                    onSelect={handleEmojiSelect}
                    onClose={() => setShowEmoji(false)}
                    onSendGif={handleSendGif}
                    onSendSticker={handleSendSticker}
                />
            )}

            {showImageEditor && file && file.type.startsWith("image/") && (
                <ImageEditorModal
                    file={file}
                    onApply={(editedFile) => {
                        setFile(editedFile);
                        setShowImageEditor(false);
                    }}
                    onClose={() => setShowImageEditor(false)}
                />
            )}

            {showVideoTrimmer && file && file.type.startsWith("video/") && (
                <VideoTrimModal
                    file={file}
                    onApply={(trimmedFile) => {
                        setFile(trimmedFile);
                        setShowVideoTrimmer(false);
                    }}
                    onClose={() => setShowVideoTrimmer(false)}
                />
            )}

            {/* Tag previews */}
            {selectedTags.length > 0 && !recording && (
                <div className="flex flex-wrap items-center gap-2 px-4 py-1.5 bg-[#0e1621]/50 border-b border-[#0e1621]">
                    <span className="text-gray-500 text-xs shrink-0">Tagging:</span>
                    {selectedTags.map((tag) => (
                        <span
                            key={tag.browserId}
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#4ea4f6]/20 border border-[#4ea4f6]/40 rounded-full text-xs text-[#4ea4f6]"
                        >
                            @{tag.name}
                            <button
                                onClick={() => setSelectedTags((prev) => prev.filter((t) => t.browserId !== tag.browserId))}
                                className="text-gray-400 hover:text-white ml-0.5"
                            >
                                ✕
                            </button>
                        </span>
                    ))}
                </div>
            )}

            {/* Edit preview */}
            {editingMessage && !recording && (
                <div className="flex items-center gap-2 px-4 py-2 bg-[#0e1621]/50 border-b border-[#0e1621]">
                    <div className="w-0.5 h-8 bg-green-400 rounded-full" />
                    <div className="flex-1 min-w-0">
                        <div className="text-green-400 text-xs font-medium">
                            Editing message
                        </div>
                        <div className="text-gray-400 text-xs truncate">
                            {text ? renderTextWithEmoji(text, 14) : "..."}
                        </div>
                    </div>
                    <button
                        onClick={() => {
                            onClearEdit?.();
                            setText("");
                            setQueuedFiles([]);
                        }}
                        className="text-gray-400 hover:text-white transition"
                    >
                        ✕
                    </button>
                </div>
            )}
            {/* Reply preview */}
            {replyTo && !recording && !editingMessage && (
                <div className="flex items-center gap-2 px-4 py-2 bg-[#0e1621]/50 border-b border-[#0e1621]">
                    <div className="w-0.5 h-8 bg-[#4ea4f6] rounded-full" />
                    <div className="flex-1 min-w-0">
                        <div className="text-[#4ea4f6] text-xs font-medium">
                            {replyTo.name}
                        </div>
                        <div className="text-gray-400 text-xs truncate">
                            {replyPreview ? renderTextWithEmoji(replyPreview, 14) : "(file)"}
                        </div>
                    </div>
                    <button
                        onClick={onClearReply}
                        className="text-gray-400 hover:text-white transition"
                    >
                        ✕
                    </button>
                </div>
            )}

            {forwardingMessages.length > 0 && !recording && !editingMessage && (
                <div className="px-4 py-2 bg-[#17212b] border-t border-[#2b5278]/30 flex items-center justify-between">
                    <div className="text-xs text-[#4ea4f6]">
                        Forwarding {forwardingMessages.length} message{forwardingMessages.length === 1 ? "" : "s"}
                    </div>
                    <button
                        type="button"
                        onClick={() => onClearForward?.()}
                        className="text-xs text-gray-400 hover:text-white"
                    >
                        Cancel
                    </button>
                </div>
            )}

            {/* File preview */}
            {file && !recording && (
                <div className="flex items-center gap-2 px-4 py-2 bg-[#0e1621]/50 border-b border-[#0e1621]">
                    <span>{getFilePreviewIcon()}</span>
                    <span className="text-sm text-gray-300 truncate flex-1">
                        {file.name}
                    </span>
                    <span className="text-xs text-gray-500">
                        {(file.size / 1024 / 1024).toFixed(1)}MB
                    </span>
                    <button
                        onClick={() => {
                            setFile(null);
                            setQueuedFiles([]);
                            setShowImageEditor(false);
                            setShowVideoTrimmer(false);
                        }}
                        className="text-gray-400 hover:text-white transition"
                    >
                        ✕
                    </button>
                </div>
            )}
            {file && file.type.startsWith("image/") && !recording && (
                <div className="px-4 py-1.5 bg-[#0e1621]/40 border-b border-[#0e1621]">
                    <button
                        onClick={() => setShowImageEditor(true)}
                        className="p-1.5 rounded-full text-[#4ea4f6] hover:text-[#6db8ff] hover:bg-[#4ea4f6]/10 transition"
                        title="Edit image"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 20h9" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z" />
                        </svg>
                    </button>
                </div>
            )}
            {file && file.type.startsWith("video/") && !recording && (
                <div className="px-4 py-1.5 bg-[#0e1621]/40 border-b border-[#0e1621]">
                    <button
                        onClick={() => setShowVideoTrimmer(true)}
                        className="p-1.5 rounded-full text-[#4ea4f6] hover:text-[#6db8ff] hover:bg-[#4ea4f6]/10 transition"
                        title="Trim video"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h13a2 2 0 012 2v10a2 2 0 01-2 2H3zM18 10l3-2v8l-3-2" />
                        </svg>
                    </button>
                </div>
            )}
            {queuedFiles.length > 0 && !recording && (
                <div className="px-4 py-1.5 bg-[#0e1621]/40 border-b border-[#0e1621] text-xs text-gray-400">
                    {queuedFiles.length + 1} files selected • caption will be sent with the last file
                </div>
            )}
            {/* Recording UI */}
            {recording ? (
                <div className="flex items-center gap-3 px-3 py-3">
                    {/* Cancel button */}
                    <button
                        onClick={cancelRecording}
                        className="p-2 text-red-400 hover:text-red-300 transition shrink-0"
                        title="Cancel"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>

                    {/* Recording indicator */}
                    <div className="flex-1 flex items-center gap-3">
                        <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                        <span className="text-white font-mono text-lg">
                            {formatRecordingTime(recordingTime)}
                        </span>
                        <div className="flex items-center gap-[2px] flex-1">
                            {Array.from({ length: 24 }, (_, i) => (
                                <div
                                    key={i}
                                    className="flex-1 bg-red-400/60 rounded-full animate-pulse"
                                    style={{
                                        height: `${6 + Math.sin((recordingTime * 3 + i) * 0.5) * 8 + Math.random() * 4}px`,
                                        animationDelay: `${i * 50}ms`,
                                        minWidth: "2px",
                                    }}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Send voice */}
                    <button
                        onClick={stopRecording}
                        className="p-2.5 bg-[#4ea4f6] hover:bg-[#3d93e5] rounded-full text-white transition shrink-0"
                        title="Send Voice Message"
                    >
                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                        </svg>
                    </button>
                </div>
            ) : (
                /* Normal input row */
                <div className="sc-chat-input-row flex items-end gap-2 px-3 py-2">
                    {/* Emoji button */}
                    <button
                        onClick={toggleEmojiPicker}
                        className={`p-2 transition shrink-0 mb-0.5 ${showEmoji ? "text-[#4ea4f6]" : "text-gray-400 hover:text-[#4ea4f6]"}`}
                        title="Emoji"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </button>

                    {/* File / game actions */}
                    <div className="relative shrink-0 mb-0.5">
                        {showActionsMenu && (
                            <div
                                ref={actionsMenuRef}
                                className="absolute bottom-full left-0 mb-2 w-56 overflow-hidden rounded-xl border border-[#2b5278]/40 bg-[#17212b] shadow-xl z-30"
                            >
                                <button
                                    onClick={handleOpenFilePicker}
                                    className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-[#1e2c3a] transition"
                                >
                                    <svg className="w-5 h-5 mt-0.5 text-[#4ea4f6] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                            d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                    </svg>
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium text-white">Select file</div>
                                        <div className="text-xs text-gray-400 mt-0.5">Send an image, video, audio, or document</div>
                                    </div>
                                </button>

                                <div className="h-px bg-[#2b5278]/30" />

                                <button
                                    onClick={() => { setShowActionsMenu(false); setShowGameModal(true); }}
                                    className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-[#1e2c3a] transition"
                                >
                                    <svg className="w-5 h-5 mt-0.5 text-[#4ea4f6] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                            d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                            d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium text-white">Start a game</div>
                                        <div className="text-xs text-gray-400 mt-0.5">Play a game with others in the chat</div>
                                    </div>
                                </button>
                            </div>
                        )}

                        <button
                            ref={actionsButtonRef}
                            onClick={toggleActionsMenu}
                            className={`p-2 transition ${showActionsMenu ? "text-[#4ea4f6]" : "text-gray-400 hover:text-[#4ea4f6]"}`}
                            title="More actions"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M12 4v16m8-8H4" />
                            </svg>
                        </button>
                    </div>

                    {/* Game selection modal */}
                    {showGameModal && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowGameModal(false)}>
                            <div
                                className="w-80 max-h-[80vh] overflow-y-auto rounded-2xl border border-[#2b5278]/50 bg-[#17212b] shadow-2xl p-4"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <h3 className="text-center text-white font-semibold text-lg mb-4">🎮 Choose a Game</h3>
                                <div className="grid grid-cols-2 gap-2">
                                    {[
                                        { id: "xo", icon: "❌⭕", name: "Tic-Tac-Toe", desc: "2 players" },
                                        { id: "connect4", icon: "🔴🔵", name: "Connect 4", desc: "2 players" },
                                        { id: "chess", icon: "♟️", name: "Chess", desc: "2 players" },
                                        { id: "othello", icon: "⚫⚪", name: "Othello", desc: "2 players" },
                                        { id: "backgammon", icon: "🎲", name: "Backgammon", desc: "2 players" },
                                        { id: "minesweeper", icon: "💣", name: "Minesweeper", desc: "Group play" },
                                        { id: "hokm2", icon: "🃏", name: "Hokm 2P", desc: "2 players" },
                                        { id: "hokm4", icon: "👑", name: "Hokm 4P", desc: "4 players" },
                                        { id: "chaarbarg", icon: "🎴", name: "Chaar Barg", desc: "2 players" },
                                    ].map((game) => (
                                        <button
                                            key={game.id}
                                            onClick={() => handleStartGame(game.id)}
                                            className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] hover:border-white/[0.15] transition-all duration-150 active:scale-95"
                                        >
                                            <span className="text-2xl">{game.icon}</span>
                                            <span className="text-sm font-medium text-white">{game.name}</span>
                                            <span className="text-[10px] text-gray-400">{game.desc}</span>
                                        </button>
                                    ))}
                                </div>
                                <button
                                    onClick={() => setShowGameModal(false)}
                                    className="w-full mt-3 py-2 text-sm text-gray-400 hover:text-white transition rounded-xl hover:bg-white/[0.05]"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}

                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        disabled={!!uploadProgress || recording}
                        onChange={handleFileSelect}
                    />

                    {/* Text input */}
                    <div className="relative flex-1 bg-[#242f3d] rounded-xl">
                        <div
                            ref={inputOverlayRef}
                            aria-hidden="true"
                            className="absolute inset-0 px-4 py-2.5 text-white text-[15px] leading-relaxed
                                       whitespace-pre-wrap break-words pointer-events-none overflow-y-auto"
                            style={{ unicodeBidi: "plaintext", scrollbarWidth: "none", msOverflowStyle: "none" }}
                        >
                            {renderTextWithEmoji(text, inputEmojiRender.size, {
                                measurementFont: inputEmojiRender.font || undefined,
                                reserveNativeAdvanceWidth: true,
                            })}
                        </div>
                        {/* Keep native textarea for editing/IME/caret, while visual emoji rendering comes from the overlay above. */}
                        <textarea
                            ref={textareaRef}
                            value={text}
                            onChange={handleTextChange}
                            onKeyDown={handleKeyDown}
                            onPaste={handlePaste}
                            onScroll={(e) => {
                                if (inputOverlayRef.current) {
                                    inputOverlayRef.current.scrollTop = e.currentTarget.scrollTop;
                                }
                            }}
                            aria-label="Message input"
                            placeholder="Message..."
                            dir="auto"
                            rows={1}
                            className="relative z-10 w-full bg-transparent text-transparent caret-white rounded-xl px-4 py-2.5
                                       placeholder-gray-500 resize-none focus:outline-none
                                       text-[15px] max-h-[120px] leading-relaxed"
                            style={{ height: "auto", minHeight: "42px", unicodeBidi: "plaintext" }}
                        />
                    </div>

                    {/* Send or Mic button */}
                    {showMicButton ? (
                        <button
                            onClick={startRecording}
                            className="p-2 text-gray-400 hover:text-[#4ea4f6] transition shrink-0 mb-0.5"
                            title="Voice Message"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                            </svg>
                        </button>
                    ) : (
                        <button
                            onClick={handleSend}
                            disabled={sending && !uploadProgress}
                            className="p-2 text-[#4ea4f6] hover:text-[#3d93e5] disabled:text-gray-600
                                       transition shrink-0 mb-0.5"
                            title="Send"
                        >
                            {sending && !uploadProgress ? (
                                <div className="w-6 h-6 border-2 border-[#4ea4f6] border-t-transparent rounded-full animate-spin" />
                            ) : (
                                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                                </svg>
                            )}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
