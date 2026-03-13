import { useState, useRef, useEffect, useMemo } from "react";
import type { ChatMessage } from "../../types";
import { useUser } from "../../contexts/UserContext";
import { useChat } from "../../contexts/ChatContext";
import { encryptText, encryptFile, decryptText } from "../../lib/crypto";
import { getEncryptionKey, getDraft, setDraft, getChatDisplayName, getPvKeyMap, getPvChatKey } from "../../lib/storage";
import { sendMessage, uploadFile } from "../../lib/api";
import { renderTextWithEmoji } from "../../lib/emojiService";
import EmojiPicker from "./EmojiPicker";
import AppleEmoji from "../ui/AppleEmoji";
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
    messages?: ChatMessage[];
    emojiPickerOpen?: boolean;
    onEmojiPickerChange?: (open: boolean) => void;
}

export default function ChatInput({ chatId, replyTo, onClearReply, editingMessage, onClearEdit, messages = [], emojiPickerOpen, onEmojiPickerChange }: ChatInputProps) {
    const { settings } = useUser();
    const { socket } = useChat();
    const [text, setText] = useState(() => getDraft(chatId));
    const [file, setFile] = useState<File | null>(null);
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
    const [replyPreview, setReplyPreview] = useState("");
    const [inputEmojiRender, setInputEmojiRender] = useState({
        font: "",
        size: 18,
    });
    const prevChatIdRef = useRef(chatId);

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
        if ((!text.trim() && !file) || sending) return;
        setSending(true);

        try {
            const key = getEncryptionKey(chatId);
            const displayName = getDisplayName();

            // Handle edit mode
            if (editingMessage) {
                const encryptedText = await encryptText(text.trim(), key, chatId);
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
                const buffer = await file.arrayBuffer();
                const encryptedBuffer = key
                    ? await encryptFile(buffer, key, chatId)
                    : buffer;

                const mime = file.type || "";
                let fileType = "other";
                if (mime.startsWith("image/")) fileType = "image";
                else if (mime.startsWith("audio/")) fileType = "audio";
                else if (mime.startsWith("video/")) fileType = "video";

                const encryptedText = text.trim()
                    ? await encryptText(text.trim(), key, chatId)
                    : "";

                await uploadFile(
                    chatId,
                    new Blob([encryptedBuffer]),
                    displayName,
                    settings.browserId,
                    fileType,
                    file.name,
                    encryptedText,
                    replyTo?.id
                );
            } else {
                const encryptedText = await encryptText(text.trim(), key, chatId);
                await sendMessage(
                    chatId,
                    encryptedText,
                    displayName,
                    settings.browserId,
                    replyTo?.id,
                    selectedTags.length > 0 ? selectedTags : undefined
                );
            }

            setText("");
            setDraft(chatId, "");
            resetTextareaHeight();
            setFile(null);
            setShowEmoji(false);
            setShowActionsMenu(false);
            setSelectedTags([]);
            setMentionQuery(null);
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
            console.error("Failed to send:", err);
        }

        setSending(false);
        textareaRef.current?.focus();
    };

    const isMobile = useMemo(() =>
        /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        ('ontouchstart' in window && window.innerWidth < 768), []);

    const handleKeyDown = (e: React.KeyboardEvent) => {
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
        const selected = e.target.files?.[0];
        if (selected) {
            if (selected.size > 25 * 1024 * 1024) {
                alert("File size must be under 25MB");
                // Reset the file input so the same file can be re-selected
                if (fileInputRef.current) fileInputRef.current.value = "";
                return;
            }
            setShowActionsMenu(false);
            setFile(selected);
        }
        // Reset the file input value so onChange fires even for the same file
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    // ─── Voice Recording ───
    const startRecording = async () => {
        setShowActionsMenu(false);
        setShowEmoji(false);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
                await sendMessage(
                    chatId,
                    gameText,
                    getDisplayName(),
                    settings.browserId,
                );
            }
        } catch (err) {
            console.error("Failed to start game:", err);
        }
        setSending(false);
    };

    const handleOpenFilePicker = () => {
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

    const showMicButton = !text.trim() && !file && !editingMessage;

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

            {/* Tag previews */}
            {selectedTags.length > 0 && !recording && (
                <div className="flex items-center gap-2 px-4 py-1.5 bg-[#0e1621]/50 border-b border-[#0e1621] overflow-x-auto">
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
                        onClick={() => setFile(null)}
                        className="text-gray-400 hover:text-white transition"
                    >
                        ✕
                    </button>
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
                        className="hidden"
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
                            disabled={sending}
                            className="p-2 text-[#4ea4f6] hover:text-[#3d93e5] disabled:text-gray-600
                                       transition shrink-0 mb-0.5"
                            title="Send"
                        >
                            {sending ? (
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
