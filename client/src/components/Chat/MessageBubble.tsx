import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import type { ChatMessage } from "../../types";
import { decryptText, decryptFile, encryptText } from "../../lib/crypto";
import { getEncryptionKey, getBrowserId, DEFAULT_ENCRYPTION_KEY, setEncryptionKey, addChat as addChatStorage, getPvChatKey, generatePvChatKey, setPvChatKey } from "../../lib/storage";
import { fetchFileWithCache } from "../../lib/fileCache";
import { useChat } from "../../contexts/ChatContext";
import { useAudioPlayer } from "../../contexts/AudioPlayerContext";
import { useUser } from "../../contexts/UserContext";
import { renderTextWithEmoji } from "../../lib/emojiService";
import { sendMessage } from "../../lib/api";
import { saveGif, saveSticker } from "../../lib/gifStickerStore";
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

interface MessageBubbleProps {
    msg: ChatMessage;
    chatId: string;
    isMine: boolean;
    replyTarget?: ChatMessage;
    onReply: (msg: ChatMessage) => void;
    onScrollToMessage?: (msgId: number) => void;
    onEdit?: (msg: ChatMessage) => void;
    onDelete?: (msg: ChatMessage) => void;
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
    replyTarget,
    onReply,
    onScrollToMessage,
    onEdit,
    onDelete,
}: MessageBubbleProps) {
    const navigate = useNavigate();
    const { socket, addChat } = useChat();
    const { isUsingSource } = useAudioPlayer();
    const { settings } = useUser();
    const [decrypted, setDecrypted] = useState<DecryptedContent>({
        text: msg.text,
        encrypted: false,
        failed: false,
    });
    const [decryptedFileUrl, setDecryptedFileUrl] = useState<string | null>(null);
    const [fileDecrypting, setFileDecrypting] = useState(false);
    const [replyDecrypted, setReplyDecrypted] = useState<string>("");

    // Context menu state
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

    // Reaction picker state
    const [showReactionPicker, setShowReactionPicker] = useState(false);

    // Media viewer modal state
    const [mediaViewer, setMediaViewer] = useState<{ type: "image" | "video"; src: string } | null>(null);

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
        if (url && !isUsingSource(url)) {
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
        setFileDecrypting(true);
        try {
            const key = getEncryptionKey(chatId);
            const buffer = await fetchFileWithCache(msg.file);

            // Determine MIME type from originalName for proper blob/download
            const mimeType = getMimeTypeFromName(msg.originalName || "");

            if (key) {
                const dec = await decryptFile(buffer, key, chatId);
                if (dec) {
                    const blob = new Blob([dec], { type: mimeType });
                    updateDecryptedFileUrl(URL.createObjectURL(blob));
                } else {
                    // Decryption failed, try raw
                    const blob = new Blob([buffer], { type: mimeType });
                    updateDecryptedFileUrl(URL.createObjectURL(blob));
                }
            } else {
                const blob = new Blob([buffer], { type: mimeType });
                updateDecryptedFileUrl(URL.createObjectURL(blob));
            }
        } catch {
            // File decryption failed
        }
        setFileDecrypting(false);
    }, [msg.file, msg.originalName, chatId, updateDecryptedFileUrl]);

    // ─── Decrypt text (with in-memory cache) ───
    useEffect(() => {
        if (msg.text) {
            const key = getEncryptionKey(chatId);
            decryptText(msg.text, key, chatId).then((result) => {
                setDecrypted(result);
            });
        }
    }, [msg.text, msg.id, chatId]);

    // ─── Decrypt reply text ───
    useEffect(() => {
        if (replyTarget?.text) {
            const key = getEncryptionKey(chatId);
            decryptText(replyTarget.text, key, chatId).then((r) =>
                setReplyDecrypted(r.text)
            );
        }
    }, [replyTarget, chatId]);

    // ─── Auto-decrypt media files ───
    useEffect(() => {
        if (msg.file && (msg.fileType === "image" || msg.fileType === "video" || msg.fileType === "audio" || msg.fileType === "gif" || msg.fileType === "sticker")) {
            doDecryptFile();
        }
    }, [msg.file, msg.fileType, doDecryptFile]);

    // ─── Re-decrypt everything on key change ───
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail.chatId === chatId) {
                // Re-decrypt text
                if (msg.text) {
                    const key = getEncryptionKey(chatId);
                    decryptText(msg.text, key, chatId).then((result) => {
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
                // Re-decrypt file
                if (msg.file) {
                    doDecryptFile();
                }
            }
        };
        window.addEventListener("encryption-key-changed", handler);
        return () => window.removeEventListener("encryption-key-changed", handler);
    }, [chatId, msg.text, msg.id, msg.file, replyTarget, doDecryptFile]);

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
        // Only swipe left (for reply), with dead zone
        if (diff > swipeDeadZone) {
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
    };

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

    const timeStr = new Date(msg.createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
    });

    const isVoiceMessage = msg.fileType === "audio" && msg.originalName?.startsWith("voice-");
    const isBorderlessMedia = isGifOrSticker && !msg.text;

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
                    className={`sc-message-bubble max-w-[85%] md:max-w-[65%] relative
                        ${isBorderlessMedia
                            ? "px-0 py-0"
                            : `rounded-2xl px-3.5 py-2 ${isMine
                                ? "bg-[#2b5278] rounded-br-md"
                                : "bg-[#182533] rounded-bl-md"
                            }`}
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
                                    className="rounded-lg max-h-72 max-w-full cursor-pointer"
                                    onClick={() => setMediaViewer({ type: "image", src: decryptedFileUrl })}
                                />
                            )}
                            {msg.fileType === "video" && decryptedFileUrl && (
                                <div
                                    className="relative rounded-lg max-h-72 max-w-full cursor-pointer overflow-hidden group/vid"
                                    onClick={() => setMediaViewer({ type: "video", src: decryptedFileUrl })}
                                >
                                    <video
                                        src={decryptedFileUrl}
                                        className="rounded-lg max-h-72 max-w-full pointer-events-none"
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
                                    chatId={chatId}
                                    trackId={msg.id}
                                    name={isVoiceMessage ? undefined : msg.originalName}
                                    isVoice={isVoiceMessage}
                                />
                            )}
                            {msg.fileType === "gif" && decryptedFileUrl && (
                                (() => {
                                    const isVideoGif = msg.originalName ? /\.(mp4|webm|mov|mkv|avi)$/i.test(msg.originalName) : true;
                                    return isVideoGif ? (
                                        <video
                                            src={decryptedFileUrl}
                                            className="max-h-52 max-w-[240px] rounded-lg object-contain"
                                            autoPlay
                                            loop
                                            muted
                                            playsInline
                                        />
                                    ) : (
                                        <img
                                            src={decryptedFileUrl}
                                            alt="GIF"
                                            className="max-h-52 max-w-[240px] rounded-lg object-contain"
                                        />
                                    );
                                })()
                            )}
                            {msg.fileType === "sticker" && decryptedFileUrl && (
                                <img
                                    src={decryptedFileUrl}
                                    alt="Sticker"
                                    className="max-h-44 max-w-[200px] object-contain"
                                />
                            )}
                            {!decryptedFileUrl && (
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
                                    Save {msg.originalName || "File"}
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
                    {decrypted.text && !decrypted.failed && isConnect4Message(decrypted.text) ? (
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
                    <div className={`flex items-center justify-end gap-1.5 mt-0.5 ${isBorderlessMedia ? "absolute bottom-1 right-1 bg-black/50 rounded-full px-1.5 py-0.5" : ""}`}>
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
                                {msg.seenBy && msg.seenBy.length > 0 ? (
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
                        </div>
                    )}
                </div>
            </div>

            {/* Context menu — portal to body to escape wallpaper stacking context */}
            {contextMenu && createPortal(
                <MessageContextMenu
                    msg={msg}
                    decryptedText={decrypted.failed ? "" : decrypted.text}
                    decryptedFileUrl={decryptedFileUrl}
                    onReply={onReply}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onReact={handleReaction}
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
                    alt={msg.originalName}
                    onClose={() => setMediaViewer(null)}
                />,
                document.body
            )}
        </>
    );
}
