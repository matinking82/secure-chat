import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import type { ChatMessage } from "../../types";
import { decryptText, encryptText } from "../../lib/crypto";
import { getEncryptionKey, getBrowserId, DEFAULT_ENCRYPTION_KEY, setEncryptionKey, addChat as addChatStorage, getPvChatKey, generatePvChatKey, setPvChatKey } from "../../lib/storage";
import { fetchFileWithCache, getDecryptedUrl, setDecryptedUrl, clearDecryptedUrlsForChat, isDecryptedUrlCached, hasCachedFile } from "../../lib/fileCache";
import { useChat } from "../../contexts/ChatContext";
import { useAudioPlayer } from "../../contexts/AudioPlayerContext";
import { useUser } from "../../contexts/UserContext";
import { renderTextWithEmoji, EMOJI_CATEGORIES, getEmojiStyle, unifiedToNative } from "../../lib/emojiService";
import { sendMessage } from "../../lib/api";
import { saveGif, saveSticker } from "../../lib/gifStickerStore";
import { formatMessageTime } from "../../lib/dateFormatter";
import { readAudioMetadata } from "../../lib/audioMetadata";
import AudioPlayer from "./AudioPlayer";
import MessageContextMenu from "./MessageContextMenu";
import MediaViewer from "./MediaViewer";
import AppleEmoji from "../ui/AppleEmoji";
import Connect4Game, { isConnect4Message, parseConnect4 } from "./Connect4Game";
import ChessGame, { isChessMessage, parseChess } from "./ChessGame";
import XOGame, { isXOMessage, parseXO } from "./XOGame";
import MinesweeperGame, { isMinesweeperMessage, parseMinesweeper } from "./MinesweeperGame";
import OthelloGame, { isOthelloMessage, parseOthello } from "./OthelloGame";
import BackgammonGame, { isBackgammonMessage, parseBackgammon } from "./BackgammonGame";
import Hokm2Game, { isHokm2Message, parseHokm2 } from "./Hokm2Game";
import Hokm4Game, { isHokm4Message, parseHokm4 } from "./Hokm4Game";
import ChaarBargGame, { isChaarBargMessage, parseChaarBarg as parseChaarBargState } from "./ChaarBargGame";
import GameExpandModal, { GameExpandButton } from "./GameExpandModal";

// URL regex that matches https://, http://, and bare domain links
const URL_REGEX = /(?:https?:\/\/[^\s<]+|(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,})(?:\/[^\s<]*)?)/g;

/** Render text with clickable links, then pass through emoji rendering */
function renderTextWithLinks(text: string, emojiSize: number): ReactNode[] {
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    const regex = new RegExp(URL_REGEX.source, "g");

    while ((match = regex.exec(text)) !== null) {
        // Text before the URL
        if (match.index > lastIndex) {
            const before = text.slice(lastIndex, match.index);
            parts.push(...renderTextWithEmoji(before, emojiSize));
        }
        const url = match[0];
        const href = url.startsWith("http") ? url : `https://${url}`;
        parts.push(
            <a
                key={`link-${match.index}`}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#4ea4f6] underline hover:text-[#6db8ff] break-all"
                onClick={(e) => e.stopPropagation()}
            >
                {url}
            </a>
        );
        lastIndex = match.index + url.length;
    }

    // Remaining text after last URL
    if (lastIndex < text.length) {
        parts.push(...renderTextWithEmoji(text.slice(lastIndex), emojiSize));
    }

    return parts.length > 0 ? parts : renderTextWithEmoji(text, emojiSize);
}

// MIME type mapping for proper file downloads
const FILE_EXTENSION_MIME_MAP: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp",
    mp4: "video/mp4", webm: "video/webm", mkv: "video/x-matroska",
    mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", flac: "audio/flac",
    pdf: "application/pdf", zip: "application/zip", json: "application/json",
    doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function getMimeTypeFromName(fileName: string): string {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    return FILE_EXTENSION_MIME_MAP[ext] || "application/octet-stream";
}

function formatFileSize(bytes?: number): string {
    if (!bytes || !Number.isFinite(bytes) || bytes < 0) return "Unknown size";
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(gb >= 100 ? 0 : 1)} GB`;
}

function formatDuration(seconds?: number): string {
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "--:--";
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// Generate a consistent color for a given name
const NAME_COLORS = [
    "#ff7eb3", "#7ec8e3", "#a0e77d", "#ffd76e",
    "#c79bf2", "#f5a262", "#6ec6c8", "#e06c75",
    "#61afef", "#d19a66", "#c678dd", "#98c379",
    "#e5c07b", "#56b6c2", "#be5046", "#73d0ff",
];

function getNameColor(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return NAME_COLORS[Math.abs(hash) % NAME_COLORS.length];
}

// Quick reaction emojis
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "👎"];
const DICE_TOKEN_REGEX = /^DICE::([1-6])$/;
const EMOJI_OR_WHITESPACE_TEXT_REGEX = /^(?:\p{White_Space}|[\p{Extended_Pictographic}\uFE0F\u200D])+$/u;
const CHAT_MEDIA_WIDTH_CLASS = "w-[220px] sm:w-[260px] md:w-[320px]";
const CHAT_STICKER_WIDTH_CLASS = "w-[180px] sm:w-[210px] md:w-[240px]";
const CHAT_MEDIA_MAX_HEIGHT_CLASS = "max-h-[320px]";
const CHAT_MEDIA_BASE_CLASS = `${CHAT_MEDIA_WIDTH_CLASS} h-auto ${CHAT_MEDIA_MAX_HEIGHT_CLASS} object-contain`;
const CHAT_STICKER_BASE_CLASS = `${CHAT_STICKER_WIDTH_CLASS} h-auto ${CHAT_MEDIA_MAX_HEIGHT_CLASS} object-contain`;
const FULL_REACTION_PANEL_WIDTH = 288; // w-72
const FULL_REACTION_PANEL_HEIGHT = 248; // approximate panel height used for preferred-above placement
const FULL_REACTION_PANEL_VIEWPORT_PADDING = 8;
const FULL_REACTION_PANEL_MIN_HEIGHT = 120;

function getDiceRollValue(text: string): number | null {
    const match = DICE_TOKEN_REGEX.exec(text.trim());
    return match ? Number(match[1]) : null;
}

function getDeterministicDiceFallback(seed: string): number {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        hash = seed.charCodeAt(i) + ((hash << 5) - hash);
    }
    return (Math.abs(hash) % 6) + 1;
}

interface MessageBubbleProps {
    msg: ChatMessage;
    chatId: string;
    isMine: boolean;
    mediaItems?: { messageId: number; type: "image" | "video"; file: string; alt?: string }[];
    mediaIndex?: number;
    selectionMode?: boolean;
    isSelected?: boolean;
    replyTarget?: ChatMessage;
    onReply: (msg: ChatMessage) => void;
    onScrollToMessage?: (msgId: number) => void;
    onToggleSelect?: (msgId: number) => void;
    onEdit?: (msg: ChatMessage) => void;
    onDelete?: (msg: ChatMessage) => void;
    onRetryMessage?: (msg: ChatMessage) => void;
}

interface DecryptedContent {
    text: string;
    encrypted: boolean;
    failed: boolean;
}

export default function MessageBubble({
    msg,
    chatId,
    isMine,
    mediaItems = [],
    mediaIndex = -1,
    selectionMode = false,
    isSelected = false,
    replyTarget,
    onReply,
    onScrollToMessage,
    onToggleSelect,
    onEdit,
    onDelete,
    onRetryMessage,
}: MessageBubbleProps) {
    const navigate = useNavigate();
    const { socket, addChat } = useChat();
    const { isUsingSource } = useAudioPlayer();
    const { settings } = useUser();
    const sourceText = typeof msg.rawText === "string" ? msg.rawText : msg.text;
    const isEncryptedText = typeof sourceText === "string" && sourceText.startsWith("ENC::");
    const hasPreDecryptedText = typeof msg.text === "string" && !msg.text.startsWith("ENC::");
    const [decrypted, setDecrypted] = useState<DecryptedContent>({
        text: isEncryptedText ? (hasPreDecryptedText ? msg.text : "") : msg.text,
        encrypted: isEncryptedText,
        failed: false,
    });
    const [decryptedFileUrl, setDecryptedFileUrl] = useState<string | null>(null);
    const [fileDecrypting, setFileDecrypting] = useState(false);
    const [hasCachedFileEntry, setHasCachedFileEntry] = useState(false);
    const [replyDecrypted, setReplyDecrypted] = useState<string>("");

    // Context menu state
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

    // Reaction picker state
    const [showReactionPicker, setShowReactionPicker] = useState(false);
    const [showFullReactionPicker, setShowFullReactionPicker] = useState(false);
    const [fullReactionPickerPos, setFullReactionPickerPos] = useState<{ x: number; y: number; bottomY?: number } | null>(null);
    const reactionPlusBtnRef = useRef<HTMLButtonElement>(null);
    const reactionPickerRef = useRef<HTMLDivElement>(null);
    const fullReactionPickerRef = useRef<HTMLDivElement>(null);

    // Media viewer modal state
    const [mediaViewer, setMediaViewer] = useState<{ type: "image" | "video"; src: string; index: number; items: { type: "image" | "video"; src: string; alt?: string }[] } | null>(null);
    const [resolvedAudioName, setResolvedAudioName] = useState<string | undefined>(undefined);

    // Game expand modal state
    const [gameExpanded, setGameExpanded] = useState(false);

    // Swipe state
    const bubbleRef = useRef<HTMLDivElement>(null);
    const touchStartX = useRef(0);
    const touchStartY = useRef(0);
    const touchCurrentX = useRef(0);
    const isSwiping = useRef(false);
    const swipeThreshold = 60;
    const swipeDeadZone = 15; // pixels before swipe starts moving
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressTriggered = useRef(false);
    const decryptedFileUrlRef = useRef<string | null>(null);

    const releaseFileUrl = useCallback((url: string | null) => {
        if (url && !isUsingSource(url) && !isDecryptedUrlCached(url)) {
            URL.revokeObjectURL(url);
        }
    }, [isUsingSource]);

    const updateDecryptedFileUrl = useCallback((nextUrl: string) => {
        setDecryptedFileUrl((prev) => {
            releaseFileUrl(prev);
            return nextUrl;
        });
    }, [releaseFileUrl]);

    // ─── Decrypt file ───
    const doDecryptFile = useCallback(async () => {
        if (!msg.file) return;

        // Check in-memory decrypted URL cache first (avoids blob re-creation)
        const cached = getDecryptedUrl(chatId, msg.file);
        if (cached) {
            updateDecryptedFileUrl(cached);
            return;
        }

        setFileDecrypting(true);
        try {
            const key = getEncryptionKey(chatId);
            // fetchFileWithCache handles IndexedDB caching + decryption:
            // - If already decrypted in cache, returns instantly
            // - If not yet decrypted, tries current key, upgrades cache on success
            // - On network fetch, tries to decrypt before caching
            const { data } = await fetchFileWithCache(msg.file, key, chatId);

            const mimeType = getMimeTypeFromName(msg.originalName || "");
            const blob = new Blob([data], { type: mimeType });
            const blobUrl = URL.createObjectURL(blob);

            // Store blob URL in memory so future mounts skip everything
            setDecryptedUrl(chatId, msg.file, blobUrl);
            updateDecryptedFileUrl(blobUrl);
        } catch {
            // File fetch/decryption failed
        }
        setFileDecrypting(false);
    }, [msg.file, msg.originalName, chatId, updateDecryptedFileUrl]);

    useEffect(() => {
        let active = true;
        (async () => {
            const exists = msg.file ? await hasCachedFile(msg.file) : false;
            if (active) setHasCachedFileEntry(exists);
        })();
        return () => {
            active = false;
        };
    }, [msg.file]);

    // ─── Decrypt text (with in-memory cache) ───
    useEffect(() => {
        if (isEncryptedText && hasPreDecryptedText) {
            setDecrypted({ text: msg.text, encrypted: true, failed: false });
            return;
        }
        if (sourceText) {
            const key = getEncryptionKey(chatId);
            decryptText(sourceText, key, chatId).then((result) => {
                setDecrypted(result);
            });
        }
    }, [sourceText, msg.id, msg.text, chatId, isEncryptedText, hasPreDecryptedText]);

    // ─── Decrypt reply text ───
    useEffect(() => {
        if (replyTarget?.text) {
            const key = getEncryptionKey(chatId);
            decryptText(replyTarget.text, key, chatId).then((r) =>
                setReplyDecrypted(r.text)
            );
        }
    }, [replyTarget, chatId]);

    const isVoiceMessage = msg.fileType === "audio" && msg.originalName?.startsWith("voice-");
    const canAutoLoadWhenCached = msg.fileType === "video" || msg.fileType === "audio" || msg.fileType === "other";
    const shouldAutoDecrypt = msg.fileType === "image"
        || msg.fileType === "gif"
        || msg.fileType === "sticker"
        || isVoiceMessage
        || (hasCachedFileEntry && canAutoLoadWhenCached);
    const shouldShowGenericDownload = !decryptedFileUrl
        && msg.fileType !== "video"
        && (msg.fileType !== "audio" || isVoiceMessage)
        && !hasCachedFileEntry;

    // ─── Auto-decrypt allowed media files ───
    useEffect(() => {
        if (msg.file && shouldAutoDecrypt) {
            doDecryptFile();
        }
    }, [msg.file, shouldAutoDecrypt, doDecryptFile]);

    useEffect(() => {
        if (msg.fileType !== "audio" || !decryptedFileUrl) return;
        let mounted = true;
        const voiceMessage = msg.originalName?.startsWith("voice-");
        readAudioMetadata(decryptedFileUrl).then((meta) => {
            if (!mounted) return;
            setResolvedAudioName(meta?.title || msg.originalName || (voiceMessage ? "Voice message" : "Audio file"));
        });
        return () => {
            mounted = false;
        };
    }, [msg.fileType, decryptedFileUrl, msg.originalName]);

    // ─── Re-decrypt everything on key change ───
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail.chatId === chatId) {
                // Re-decrypt text
                if (sourceText) {
                    const key = getEncryptionKey(chatId);
                    decryptText(sourceText, key, chatId).then((result) => {
                        setDecrypted(result);
                    });
                }
                // Re-decrypt reply
                if (replyTarget?.text) {
                    const key = getEncryptionKey(chatId);
                    decryptText(replyTarget.text, key, chatId).then((r) =>
                        setReplyDecrypted(r.text)
                    );
                }
                // Invalidate cached decrypted URLs for this chat then re-decrypt
                clearDecryptedUrlsForChat(chatId);
                if (msg.file && shouldAutoDecrypt) {
                    doDecryptFile();
                }
            }
        };
        window.addEventListener("encryption-key-changed", handler);
        return () => window.removeEventListener("encryption-key-changed", handler);
    }, [chatId, sourceText, msg.id, msg.file, replyTarget, doDecryptFile, shouldAutoDecrypt]);

    // Cleanup object URL and long-press timer on unmount
    useEffect(() => {
        return () => {
            releaseFileUrl(decryptedFileUrlRef.current);
            if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
        };
    }, [releaseFileUrl]);

    useEffect(() => {
        decryptedFileUrlRef.current = decryptedFileUrl;
    }, [decryptedFileUrl]);

    // ─── Swipe to reply + long-press context menu (mobile) ───
    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartX.current = e.touches[0].clientX;
        touchStartY.current = e.touches[0].clientY;
        touchCurrentX.current = e.touches[0].clientX;
        isSwiping.current = false;
        longPressTriggered.current = false;

        // Start long-press timer
        const touch = e.touches[0];
        longPressTimerRef.current = setTimeout(() => {
            longPressTriggered.current = true;
            if (navigator.vibrate) navigator.vibrate(30);
            setContextMenu({ x: touch.clientX, y: touch.clientY });
        }, 500);
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        const touch = e.touches[0];
        const diffX = Math.abs(touchStartX.current - touch.clientX);
        const diffY = Math.abs(touchStartY.current - touch.clientY);

        // Cancel long-press if finger moved
        if (diffX > 10 || diffY > 10) {
            if (longPressTimerRef.current) {
                clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = null;
            }
        }

        const diff = touchStartX.current - touch.clientX;
        const isMostlyHorizontalSwipe = diffX > diffY * 1.4;
        // Only swipe left (for reply), with dead zone
        if (diff > swipeDeadZone && isMostlyHorizontalSwipe) {
            isSwiping.current = true;
            touchCurrentX.current = touch.clientX;
            const effectiveDiff = diff - swipeDeadZone;
            const translateX = Math.min(0, -Math.min(effectiveDiff, 80));
            if (bubbleRef.current) {
                bubbleRef.current.style.transform = `translateX(${translateX}px)`;
                bubbleRef.current.style.transition = "none";
            }
        }
    };

    const handleTouchEnd = () => {
        // Clear long-press timer
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }

        if (isSwiping.current) {
            const diff = touchStartX.current - touchCurrentX.current;
            if (diff >= swipeThreshold) {
                onReply(msg);
                if (navigator.vibrate) navigator.vibrate(15);
            }
            if (bubbleRef.current) {
                bubbleRef.current.style.transform = "translateX(0)";
                bubbleRef.current.style.transition = "transform 0.2s ease-out";
            }
            isSwiping.current = false;
        }
    };

    // ─── Context menu (desktop right-click or single click/tap) ───
    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
    };

    const handleBubbleClick = (e: React.MouseEvent) => {
        // If long-press just triggered, don't also open from click
        if (longPressTriggered.current) {
            longPressTriggered.current = false;
            return;
        }
        if (selectionMode && onToggleSelect) {
            e.stopPropagation();
            onToggleSelect(msg.id);
            return;
        }
        // On desktop, context menu is opened only via right-click (handleContextMenu).
        // Left-click should not open it.
    };

    // ─── Save GIF/Sticker to local collection ───
    const isGifOrSticker = msg.fileType === "gif" || msg.fileType === "sticker";
    const canSaveToCollection = isGifOrSticker && !!decryptedFileUrl;

    const handleSaveToCollection = useCallback(async () => {
        if (!decryptedFileUrl || !msg.file) return;
        try {
            const response = await fetch(decryptedFileUrl);
            const blob = await response.blob();
            const name = msg.originalName || (msg.fileType === "gif" ? "saved.mp4" : "saved.png");
            if (msg.fileType === "gif") {
                await saveGif(blob, name);
            } else if (msg.fileType === "sticker") {
                await saveSticker(blob, name);
            }
        } catch (err) {
            console.error("Failed to save to collection:", err);
        }
    }, [decryptedFileUrl, msg.file, msg.fileType, msg.originalName]);

    const handleReaction = (emoji: string) => {
        socket?.emit("react_message", {
            chatId,
            messageId: msg.id,
            emoji,
            browserId: getBrowserId(),
        });
        setShowReactionPicker(false);
        setShowFullReactionPicker(false);
    };

    const allReactionEmojis = EMOJI_CATEGORIES.flatMap((cat) => cat.emojis);
    const fullReactionPickerStyle = fullReactionPickerPos ? (() => {
        const panelHeightForPosition = Math.min(
            FULL_REACTION_PANEL_HEIGHT,
            Math.max(
                FULL_REACTION_PANEL_MIN_HEIGHT,
                window.innerHeight - FULL_REACTION_PANEL_VIEWPORT_PADDING * 2
            )
        );

        const left = Math.max(
            FULL_REACTION_PANEL_VIEWPORT_PADDING,
            Math.min(
                window.innerWidth - FULL_REACTION_PANEL_WIDTH - FULL_REACTION_PANEL_VIEWPORT_PADDING,
                fullReactionPickerPos.x - FULL_REACTION_PANEL_WIDTH / 2
            )
        );

        const preferredTop = fullReactionPickerPos.y - panelHeightForPosition - FULL_REACTION_PANEL_VIEWPORT_PADDING;
        const fallbackTop = (fullReactionPickerPos.bottomY ?? fullReactionPickerPos.y) + FULL_REACTION_PANEL_VIEWPORT_PADDING;
        const maxTop = Math.max(
            FULL_REACTION_PANEL_VIEWPORT_PADDING,
            window.innerHeight - panelHeightForPosition - FULL_REACTION_PANEL_VIEWPORT_PADDING
        );
        const top = preferredTop >= FULL_REACTION_PANEL_VIEWPORT_PADDING
            ? preferredTop
            : Math.min(maxTop, fallbackTop);

        return {
            left,
            top: Math.max(FULL_REACTION_PANEL_VIEWPORT_PADDING, top),
            maxHeight: panelHeightForPosition,
        };
    })() : undefined;

    useEffect(() => {
        if (!showReactionPicker && !showFullReactionPicker) return;

        const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
            const target = event.target as Node | null;
            if (!target) return;

            if (reactionPlusBtnRef.current?.contains(target)) return;
            if (reactionPickerRef.current?.contains(target)) return;
            if (fullReactionPickerRef.current?.contains(target)) return;

            setShowReactionPicker(false);
            setShowFullReactionPicker(false);
        };

        document.addEventListener("mousedown", handleOutsideClick);
        document.addEventListener("touchstart", handleOutsideClick);

        return () => {
            document.removeEventListener("mousedown", handleOutsideClick);
            document.removeEventListener("touchstart", handleOutsideClick);
        };
    }, [showReactionPicker, showFullReactionPicker]);

    const handleNameClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isMine) return;
        const otherBrowserId = msg.browserId;

        // Check if we already have a PV key mapping for this user
        const existing = getPvChatKey(otherBrowserId);

        let pvChatId: string;
        if (existing) {
            pvChatId = existing.chatKey;
        } else {
            // Generate a random chat key
            pvChatId = generatePvChatKey();
            setPvChatKey(otherBrowserId, pvChatId, false);
        }

        // Set default encryption key for PV chats
        const existingKey = getEncryptionKey(pvChatId);
        if (existingKey === DEFAULT_ENCRYPTION_KEY) {
            setEncryptionKey(pvChatId, DEFAULT_ENCRYPTION_KEY);
        }
        addChat(pvChatId, `PV: ${msg.name}`);
        navigate(`/chat/${pvChatId}`);
    };

    const timeStr = formatMessageTime(msg.createdAt);

    const isBorderlessMedia = isGifOrSticker && !msg.text;
    const unencryptedDiceRollValue = (!isEncryptedText && msg.text) ? getDiceRollValue(msg.text) : null;
    const hasUnencryptedDiceRoll = unencryptedDiceRollValue !== null;
    const trimmedDecryptedText = decrypted.text?.trim() ?? "";
    const isDiceMessage = hasUnencryptedDiceRoll;
    const resolvedDiceRollValue = hasUnencryptedDiceRoll ? unencryptedDiceRollValue : null;
    const hasGameMessageContent = !decrypted.failed && trimmedDecryptedText.startsWith("GAME::");
    const isEmojiOnlyText = !msg.file
        && !decrypted.failed
        && trimmedDecryptedText.length > 0
        && EMOJI_OR_WHITESPACE_TEXT_REGEX.test(trimmedDecryptedText);
    const isBorderlessBubble = isBorderlessMedia || isDiceMessage || isEmojiOnlyText;
    const shouldOverlayMeta = isBorderlessMedia;
    const openMediaViewerAt = (type: "image" | "video", src: string) => {
        const canUseChatMedia = mediaIndex >= 0 && mediaItems.length > 0;
        const items = canUseChatMedia
            ? mediaItems
                .map((item, index) => {
                    const currentSrc = index === mediaIndex ? src : (getDecryptedUrl(chatId, item.file) || "");
                    if (!currentSrc) return null;
                    return { type: item.type, src: currentSrc, alt: item.alt };
                })
                .filter((item): item is { type: "image" | "video"; src: string; alt?: string } => item !== null)
            : [{ type, src, alt: msg.originalName }];
        const startIndex = canUseChatMedia
            ? Math.max(
                0,
                items.findIndex((item) => item.src === src)
            )
            : 0;
        setMediaViewer({
            type: items[startIndex]?.type || type,
            src: items[startIndex]?.src || src,
            index: startIndex,
            items,
        });
    };
    const goPrevMedia = () => {
        setMediaViewer((prev) => {
            if (!prev || prev.index <= 0) return prev;
            const nextIndex = prev.index - 1;
            return { ...prev, index: nextIndex, type: prev.items[nextIndex].type, src: prev.items[nextIndex].src };
        });
    };
    const goNextMedia = () => {
        setMediaViewer((prev) => {
            if (!prev || prev.index >= prev.items.length - 1) return prev;
            const nextIndex = prev.index + 1;
            return { ...prev, index: nextIndex, type: prev.items[nextIndex].type, src: prev.items[nextIndex].src };
        });
    };

    return (
        <>
            <div
                ref={bubbleRef}
                className={`sc-message-row flex ${isMine ? "justify-end" : "justify-start"} mb-1 px-3 group msg-bubble-touch`}
                onContextMenu={handleContextMenu}
                onClick={handleBubbleClick}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                <div
                    data-own={isMine ? "true" : "false"}
                    data-borderless={isBorderlessBubble ? "true" : "false"}
                    className={`sc-message-bubble max-w-[85%] md:max-w-[75%] lg:max-w-[65%] relative
                        ${isBorderlessBubble
                            ? "px-0 py-0"
                            : `rounded-2xl px-3.5 py-2 ${isMine
                                ? "bg-[#2b5278] rounded-br-md"
                                : "bg-[#182533] rounded-bl-md"
                            }`}
                        ${selectionMode && isSelected ? "ring-2 ring-[#4ea4f6] ring-offset-2 ring-offset-transparent" : ""}
                        }`}
                >
                    {/* Sender name (clickable to open PV) */}
                    {!isMine && (
                        <div
                            data-sender-name
                            className="text-[13px] font-medium mb-0.5 cursor-pointer hover:underline"
                            style={{ color: getNameColor(msg.name) }}
                            onClick={handleNameClick}
                            title={`Open private chat with ${msg.name}`}
                        >
                            {msg.name}
                        </div>
                    )}

                    {/* Reply preview */}
                    {replyTarget && (
                        <div
                            className="bg-[#0e1621]/50 border-l-2 border-[#4ea4f6] rounded px-2.5 py-1.5 mb-1.5 text-sm cursor-pointer hover:bg-[#0e1621]/70 transition-colors"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (msg.replyToId && onScrollToMessage) {
                                    onScrollToMessage(msg.replyToId);
                                }
                            }}
                        >
                            <div className="text-xs font-medium" style={{ color: getNameColor(replyTarget.name) }}>
                                {replyTarget.name}
                            </div>
                            <div className="text-gray-400 text-xs truncate">
                                {replyDecrypted ? renderTextWithEmoji(replyDecrypted, 14) : "(file)"}
                            </div>
                        </div>
                    )}

                    {/* File content */}
                    {msg.file && (
                        <div className="mb-1.5">
                            {msg.fileType === "image" && decryptedFileUrl && (
                                <img
                                    src={decryptedFileUrl}
                                    alt={msg.originalName || "Image"}
                                    className={`rounded-lg cursor-pointer ${CHAT_MEDIA_BASE_CLASS}`}
                                    onClick={() => openMediaViewerAt("image", decryptedFileUrl)}
                                />
                            )}
                            {msg.fileType === "video" && decryptedFileUrl && (
                                <div
                                    className={`relative rounded-lg cursor-pointer overflow-hidden group/vid inline-block ${CHAT_MEDIA_WIDTH_CLASS}`}
                                    onClick={() => openMediaViewerAt("video", decryptedFileUrl)}
                                >
                                    <video
                                        src={decryptedFileUrl}
                                        className={`rounded-lg pointer-events-none ${CHAT_MEDIA_BASE_CLASS}`}
                                    />
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover/vid:bg-black/30 transition">
                                        <div className="w-14 h-14 rounded-full bg-black/50 flex items-center justify-center">
                                            <svg className="w-7 h-7 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                                                <path d="M8 5v14l11-7z" />
                                            </svg>
                                        </div>
                                    </div>
                                </div>
                            )}
                            {msg.fileType === "audio" && decryptedFileUrl && (
                                <AudioPlayer
                                    src={decryptedFileUrl}
                                    encryptedFileUrl={msg.file}
                                    chatId={chatId}
                                    trackId={msg.id}
                                    name={resolvedAudioName || msg.originalName}
                                    isVoice={isVoiceMessage}
                                    createdAt={msg.createdAt}
                                />
                            )}
                            {msg.fileType === "gif" && decryptedFileUrl && (
                                (() => {
                                    const isVideoGif = msg.originalName ? /\.(mp4|webm|mov|mkv|avi)$/i.test(msg.originalName) : true;
                                    return isVideoGif ? (
                                        <video
                                            src={decryptedFileUrl}
                                            className={`rounded-lg ${CHAT_MEDIA_BASE_CLASS}`}
                                            autoPlay
                                            loop
                                            muted
                                            playsInline
                                        />
                                    ) : (
                                        <img
                                            src={decryptedFileUrl}
                                            alt="GIF"
                                            className={`rounded-lg ${CHAT_MEDIA_BASE_CLASS}`}
                                        />
                                    );
                                })()
                            )}
                            {msg.fileType === "sticker" && decryptedFileUrl && (
                                <img
                                    src={decryptedFileUrl}
                                    alt="Sticker"
                                    className={CHAT_STICKER_BASE_CLASS}
                                />
                            )}
                            {msg.fileType === "video" && !decryptedFileUrl && (
                                <div>
                                    <button
                                        onClick={doDecryptFile}
                                        disabled={fileDecrypting}
                                        className={`relative rounded-lg overflow-hidden inline-flex items-center justify-center ${CHAT_MEDIA_WIDTH_CLASS} ${CHAT_MEDIA_MAX_HEIGHT_CLASS} aspect-video bg-black hover:bg-black/90 transition`}
                                    >
                                        <div className="w-14 h-14 rounded-full bg-black/50 border border-white/20 flex items-center justify-center">
                                            {fileDecrypting ? (
                                                <div className="w-6 h-6 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
                                            ) : (
                                                <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v10m0 0l-4-4m4 4l4-4M5 19h14" />
                                                </svg>
                                            )}
                                        </div>
                                    </button>
                                    <div className="mt-1 text-xs text-gray-400">
                                        {formatDuration(msg.mediaDurationSec)} • {formatFileSize(msg.fileSize)}
                                    </div>
                                </div>
                            )}
                            {msg.fileType === "audio" && !decryptedFileUrl && !isVoiceMessage && (
                                <div className="flex items-center gap-2.5 w-[280px] sm:w-[320px]">
                                    <button
                                        onClick={doDecryptFile}
                                        disabled={fileDecrypting}
                                        className="w-10 h-10 rounded-full bg-[#4ea4f6] hover:bg-[#3d93e5] flex items-center justify-center shrink-0 transition disabled:opacity-60"
                                    >
                                        {fileDecrypting ? (
                                            <div className="w-4 h-4 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
                                        ) : (
                                            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v10m0 0l-4-4m4 4l4-4M5 19h14" />
                                            </svg>
                                        )}
                                    </button>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs text-white truncate mb-1">{msg.originalName || "Audio file"}</div>
                                        <div className="h-1 bg-[#3a4a5c] rounded-full opacity-70" />
                                        <div className="flex justify-between mt-1">
                                            <span className="text-[11px] text-gray-400">0:00</span>
                                            <span className="text-[11px] text-gray-400">{formatDuration(msg.mediaDurationSec)}</span>
                                        </div>
                                        <div className="text-[10px] text-gray-500 mt-0.5">{formatFileSize(msg.fileSize)}</div>
                                    </div>
                                </div>
                            )}
                            {shouldShowGenericDownload && (
                                <button
                                    onClick={doDecryptFile}
                                    disabled={fileDecrypting}
                                    className="flex items-center gap-2 bg-[#0e1621]/50 rounded-lg px-3 py-2
                                               text-sm text-[#4ea4f6] hover:bg-[#0e1621]/80 transition"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                            d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    {fileDecrypting ? "Decrypting..." : msg.originalName || "Download File"}
                                </button>
                            )}
                            {msg.fileType === "other" && decryptedFileUrl && (
                                <a
                                    href={decryptedFileUrl}
                                    download={msg.originalName || "file"}
                                    className="flex items-center gap-2 bg-[#0e1621]/50 rounded-lg px-3 py-2
                                               text-sm text-[#4ea4f6] hover:bg-[#0e1621]/80 transition"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                    Save {msg.originalName || "File"} ({formatFileSize(msg.fileSize)})
                                </a>
                            )}
                        </div>
                    )}

                    {/* Tags display */}
                    {msg.tags && msg.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1">
                            {msg.tags.map((tag) => (
                                <span
                                    key={tag.browserId}
                                    className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#4ea4f6]/15 text-[#4ea4f6] text-xs font-medium"
                                >
                                    @{tag.name}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Text content or game rendering */}
                    {resolvedDiceRollValue ? (
                        <img
                            src={`/dice/dice${resolvedDiceRollValue}.svg`}
                            alt={`Dice roll ${resolvedDiceRollValue}`}
                            className="w-14 h-14 object-contain"
                        />
                    ) : decrypted.text && !decrypted.failed && isConnect4Message(decrypted.text) ? (
                        (() => {
                            const gameState = parseConnect4(decrypted.text);
                            if (!gameState) return null;
                            const gameEl = <Connect4Game gameState={gameState} messageId={msg.id} chatId={chatId} />;
                            return (
                                <div className="relative">
                                    <GameExpandButton onClick={() => setGameExpanded(true)} />
                                    {!gameExpanded && gameEl}
                                    <GameExpandModal open={gameExpanded} onClose={() => setGameExpanded(false)}>{gameEl}</GameExpandModal>
                                </div>
                            );
                        })()
                    ) : decrypted.text && !decrypted.failed && isChessMessage(decrypted.text) ? (
                        (() => {
                            const gameState = parseChess(decrypted.text);
                            if (!gameState) return null;
                            const gameEl = <ChessGame gameState={gameState} messageId={msg.id} chatId={chatId} />;
                            return (
                                <div className="relative">
                                    <GameExpandButton onClick={() => setGameExpanded(true)} />
                                    {!gameExpanded && gameEl}
                                    <GameExpandModal open={gameExpanded} onClose={() => setGameExpanded(false)}>{gameEl}</GameExpandModal>
                                </div>
                            );
                        })()
                    ) : decrypted.text && !decrypted.failed && isXOMessage(decrypted.text) ? (
                        (() => {
                            const gameState = parseXO(decrypted.text);
                            if (!gameState) return null;
                            const gameEl = <XOGame gameState={gameState} messageId={msg.id} chatId={chatId} />;
                            return (
                                <div className="relative">
                                    <GameExpandButton onClick={() => setGameExpanded(true)} />
                                    {!gameExpanded && gameEl}
                                    <GameExpandModal open={gameExpanded} onClose={() => setGameExpanded(false)}>{gameEl}</GameExpandModal>
                                </div>
                            );
                        })()
                    ) : decrypted.text && !decrypted.failed && isMinesweeperMessage(decrypted.text) ? (
                        (() => {
                            const gameState = parseMinesweeper(decrypted.text);
                            if (!gameState) return null;
                            const gameEl = <MinesweeperGame gameState={gameState} messageId={msg.id} chatId={chatId} />;
                            return (
                                <div className="relative">
                                    <GameExpandButton onClick={() => setGameExpanded(true)} />
                                    {!gameExpanded && gameEl}
                                    <GameExpandModal open={gameExpanded} onClose={() => setGameExpanded(false)}>{gameEl}</GameExpandModal>
                                </div>
                            );
                        })()
                    ) : decrypted.text && !decrypted.failed && isOthelloMessage(decrypted.text) ? (
                        (() => {
                            const gameState = parseOthello(decrypted.text);
                            if (!gameState) return null;
                            const gameEl = <OthelloGame gameState={gameState} messageId={msg.id} chatId={chatId} />;
                            return (
                                <div className="relative">
                                    <GameExpandButton onClick={() => setGameExpanded(true)} />
                                    {!gameExpanded && gameEl}
                                    <GameExpandModal open={gameExpanded} onClose={() => setGameExpanded(false)}>{gameEl}</GameExpandModal>
                                </div>
                            );
                        })()
                    ) : decrypted.text && !decrypted.failed && isBackgammonMessage(decrypted.text) ? (
                        (() => {
                            const gameState = parseBackgammon(decrypted.text);
                            if (!gameState) return null;
                            const gameEl = <BackgammonGame gameState={gameState} messageId={msg.id} chatId={chatId} />;
                            return (
                                <div className="relative">
                                    <GameExpandButton onClick={() => setGameExpanded(true)} />
                                    {!gameExpanded && gameEl}
                                    <GameExpandModal open={gameExpanded} onClose={() => setGameExpanded(false)}>{gameEl}</GameExpandModal>
                                </div>
                            );
                        })()
                    ) : decrypted.text && !decrypted.failed && isHokm2Message(decrypted.text) ? (
                        (() => {
                            const gameState = parseHokm2(decrypted.text);
                            if (!gameState) return null;
                            const gameEl = <Hokm2Game gameState={gameState} messageId={msg.id} chatId={chatId} />;
                            return (
                                <div className="relative">
                                    <GameExpandButton onClick={() => setGameExpanded(true)} />
                                    {!gameExpanded && gameEl}
                                    <GameExpandModal open={gameExpanded} onClose={() => setGameExpanded(false)}>{gameEl}</GameExpandModal>
                                </div>
                            );
                        })()
                    ) : decrypted.text && !decrypted.failed && isHokm4Message(decrypted.text) ? (
                        (() => {
                            const gameState = parseHokm4(decrypted.text);
                            if (!gameState) return null;
                            const gameEl = <Hokm4Game gameState={gameState} messageId={msg.id} chatId={chatId} />;
                            return (
                                <div className="relative">
                                    <GameExpandButton onClick={() => setGameExpanded(true)} />
                                    {!gameExpanded && gameEl}
                                    <GameExpandModal open={gameExpanded} onClose={() => setGameExpanded(false)}>{gameEl}</GameExpandModal>
                                </div>
                            );
                        })()
                    ) : decrypted.text && !decrypted.failed && isChaarBargMessage(decrypted.text) ? (
                        (() => {
                            const gameState = parseChaarBargState(decrypted.text);
                            if (!gameState) return null;
                            const gameEl = <ChaarBargGame gameState={gameState} messageId={msg.id} chatId={chatId} />;
                            return (
                                <div className="relative">
                                    <GameExpandButton onClick={() => setGameExpanded(true)} />
                                    {!gameExpanded && gameEl}
                                    <GameExpandModal open={gameExpanded} onClose={() => setGameExpanded(false)}>{gameEl}</GameExpandModal>
                                </div>
                            );
                        })()
                    ) : decrypted.text ? (
                        <div
                            dir="auto"
                            className={`text-[15px] leading-relaxed break-words whitespace-pre-wrap ${decrypted.failed ? "text-red-400 italic" : "text-white"
                                }`}
                            style={{ unicodeBidi: "plaintext" }}
                        >
                            {decrypted.failed ? renderTextWithEmoji(decrypted.text, 20) : renderTextWithLinks(decrypted.text, 20)}
                        </div>
                    ) : null}

                    {/* Reactions display */}
                    {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                            {Object.entries(msg.reactions).map(([emoji, browserIds]) => (
                                <button
                                    key={emoji}
                                    data-reaction
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleReaction(emoji);
                                    }}
                                    className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs transition
                                        ${browserIds.includes(getBrowserId())
                                            ? "bg-[#4ea4f6]/20 border border-[#4ea4f6]/50"
                                            : "bg-[#0e1621]/50 border border-transparent hover:border-[#2b5278]"
                                        }`}
                                >
                                    <AppleEmoji native={emoji} size={16} />
                                    <span className="text-gray-400">{browserIds.length}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Bottom row: edited badge + encryption badge + time + seen status */}
                    <div className={`flex items-center justify-end gap-1.5 mt-0.5 ${shouldOverlayMeta ? "absolute bottom-1 right-1 bg-black/50 rounded-full px-1.5 py-0.5" : ""}`}>
                        {msg.edited && (
                            <span className="text-[10px] text-gray-500 italic">edited</span>
                        )}
                        {decrypted.encrypted && (
                            <span className={`text-[10px] ${decrypted.failed ? "text-red-400" : "text-green-400"}`}>
                                <AppleEmoji native={decrypted.failed ? "🔓" : "🔒"} size={12} />
                            </span>
                        )}
                        <span className="text-[11px] text-gray-500">{timeStr}</span>
                        {/* Seen status (only for own messages) */}
                        {isMine && (
                            <span className="text-[12px]">
                                {msg.localStatus === "failed" ? (
                                    <svg className="w-4 h-4 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6l-12 12" />
                                    </svg>
                                ) : msg.localStatus === "pending" ? (
                                    <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                                        <circle cx="12" cy="12" r="8" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l2.5 1.5" />
                                    </svg>
                                ) : msg.seenBy && msg.seenBy.length > 0 ? (
                                    <svg className="w-4 h-4 text-[#4ea4f6]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M1 13l5 5L17 7" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 13l5 5L23 7" />
                                    </svg>
                                ) : (
                                    <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                )}
                            </span>
                        )}
                    </div>

                    {/* Desktop hover actions - reply + react */}
                    <div
                        className={`absolute top-0 ${isMine ? "-left-20" : "-right-20"}
                            opacity-0 group-hover:opacity-100 transition-opacity hidden md:flex gap-0.5`}
                    >
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onReply(msg);
                            }}
                            className="p-1.5 rounded-full bg-[#0e1621] text-gray-400 hover:text-white transition"
                            title="Reply"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                            </svg>
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowReactionPicker((prev) => !prev);
                            }}
                            ref={reactionPlusBtnRef}
                            className="p-1.5 rounded-full bg-[#0e1621] text-gray-400 hover:text-white transition"
                            title="React"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </button>
                    </div>

                    {/* Reaction picker popup */}
                    {showReactionPicker && (
                        <div
                            ref={reactionPickerRef}
                            className={`absolute ${isMine ? "right-0" : "left-0"} -top-10 z-50 bg-[#1e2c3a] rounded-full shadow-xl border border-[#2b5278]/50 px-2 py-1 flex gap-1`}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {QUICK_REACTIONS.map((emoji) => (
                                <button
                                    key={emoji}
                                    onClick={() => handleReaction(emoji)}
                                    className="hover:scale-125 transition-transform p-0.5"
                                >
                                    <AppleEmoji native={emoji} size={22} />
                                </button>
                            ))}
                            <button
                                onClick={() => {
                                    const rect = reactionPlusBtnRef.current?.getBoundingClientRect();
                                    if (rect) {
                                        setFullReactionPickerPos({
                                            x: rect.left + rect.width / 2,
                                            y: rect.top,
                                            bottomY: rect.bottom,
                                        });
                                    } else {
                                        setFullReactionPickerPos(null);
                                    }
                                    setShowReactionPicker(false);
                                    setShowFullReactionPicker(true);
                                }}
                                className="hover:scale-110 transition-transform p-0.5 text-gray-300 hover:text-white"
                                title="More reactions"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                            </button>
                        </div>
                    )}

                </div>
            </div>

            {/* Full reaction picker — portal to body so fixed positioning is viewport-relative */}
            {showFullReactionPicker && createPortal(
                <div
                    ref={fullReactionPickerRef}
                    className="fixed z-50 w-72 bg-[#1e2c3a] rounded-2xl shadow-2xl border border-[#2b5278]/50 p-2 overflow-y-auto"
                    style={fullReactionPickerStyle}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="grid grid-cols-8 gap-0.5">
                        {allReactionEmojis.map((emoji) => (
                            <button
                                key={emoji.unified}
                                onClick={() => handleReaction(unifiedToNative(emoji.unified))}
                                className="w-8 h-8 rounded-md hover:bg-white/10 transition-colors flex items-center justify-center"
                            >
                                <span role="img" style={getEmojiStyle(emoji.sheetX, emoji.sheetY, 24)} />
                            </button>
                        ))}
                    </div>
                </div>,
                document.body
            )}

            {/* Context menu — portal to body to escape wallpaper stacking context */}
            {contextMenu && createPortal(
                <MessageContextMenu
                    msg={msg}
                    decryptedText={decrypted.failed ? "" : decrypted.text}
                    decryptedFileUrl={decryptedFileUrl}
                    onReply={onReply}
                    onSelect={onToggleSelect}
                    onEdit={isDiceMessage || hasGameMessageContent ? undefined : onEdit}
                    onDelete={onDelete}
                    onRetry={onRetryMessage}
                    onReact={handleReaction}
                    onOpenFullReactions={(position) => {
                        setShowReactionPicker(false);
                        setFullReactionPickerPos(position);
                        setShowFullReactionPicker(true);
                    }}
                    onSaveToCollection={canSaveToCollection ? handleSaveToCollection : undefined}
                    onClose={() => setContextMenu(null)}
                    position={contextMenu}
                />,
                document.body
            )}

            {/* Media viewer modal — portal to body */}
            {mediaViewer && createPortal(
                <MediaViewer
                    type={mediaViewer.type}
                    src={mediaViewer.src}
                    alt={mediaViewer.items[mediaViewer.index]?.alt || msg.originalName}
                    onPrev={goPrevMedia}
                    onNext={goNextMedia}
                    hasPrev={mediaViewer.index > 0}
                    hasNext={mediaViewer.index < mediaViewer.items.length - 1}
                    onClose={() => setMediaViewer(null)}
                />,
                document.body
            )}
        </>
    );
}
