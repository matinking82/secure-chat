import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../types";
import { getBrowserId } from "../../lib/storage";
import AppleEmoji from "../ui/AppleEmoji";

// Quick reaction emojis for context menu
const CONTEXT_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

interface MessageContextMenuProps {
    msg: ChatMessage;
    decryptedText: string;
    decryptedFileUrl: string | null;
    onReply: (msg: ChatMessage) => void;
    onEdit?: (msg: ChatMessage) => void;
    onDelete?: (msg: ChatMessage) => void;
    onReact?: (emoji: string) => void;
    onClose: () => void;
    position: { x: number; y: number };
}

export default function MessageContextMenu({
    msg,
    decryptedText,
    decryptedFileUrl,
    onReply,
    onEdit,
    onDelete,
    onReact,
    onClose,
    position,
}: MessageContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const [adjusted, setAdjusted] = useState(position);

    // Adjust position to fit in viewport
    useEffect(() => {
        const menu = menuRef.current;
        if (!menu) return;
        const rect = menu.getBoundingClientRect();
        let { x, y } = position;

        if (x + rect.width > window.innerWidth - 8) {
            x = window.innerWidth - rect.width - 8;
        }
        if (y + rect.height > window.innerHeight - 8) {
            y = window.innerHeight - rect.height - 8;
        }
        if (x < 8) x = 8;
        if (y < 8) y = 8;
        setAdjusted({ x, y });
    }, [position]);

    // Close on scroll
    useEffect(() => {
        const handleClose = () => onClose();
        document.addEventListener("scroll", handleClose, true);
        return () => {
            document.removeEventListener("scroll", handleClose, true);
        };
    }, [onClose]);

    const handleCopy = () => {
        if (decryptedText) {
            navigator.clipboard.writeText(decryptedText);
        }
        onClose();
    };

    const handleReply = () => {
        onReply(msg);
        onClose();
    };

    const handleEdit = () => {
        if (onEdit) onEdit(msg);
        onClose();
    };

    const handleDelete = () => {
        if (onDelete) onDelete(msg);
        onClose();
    };

    const handleDownload = () => {
        if (decryptedFileUrl) {
            const a = document.createElement("a");
            a.href = decryptedFileUrl;
            // Use originalName to preserve the correct file extension
            const fileName = msg.originalName || "file";
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
        onClose();
    };

    const isMine = msg.browserId === getBrowserId();

    return (
        <div
            className="fixed inset-0 z-[150]"
            onClick={onClose}
        >
            <div
                ref={menuRef}
                className="fixed rounded-xl shadow-2xl border border-white/10 
                           py-1.5 min-w-[180px] animate-in overflow-hidden select-none backdrop-blur-xl"
                style={{ left: adjusted.x, top: adjusted.y, backgroundColor: 'var(--sc-surface-2, #1e2c3a)' }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Quick reactions row */}
                {onReact && (
                    <div className="flex items-center gap-1 px-3 py-2 border-b border-white/10">
                        {CONTEXT_REACTIONS.map((emoji) => (
                            <button
                                key={emoji}
                                onClick={() => {
                                    onReact(emoji);
                                    onClose();
                                }}
                                className="hover:scale-125 transition-transform p-1"
                            >
                                <AppleEmoji native={emoji} size={22} />
                            </button>
                        ))}
                    </div>
                )}

                {/* Reply */}
                <button
                    onClick={handleReply}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-white hover:bg-white/10 transition text-left"
                >
                    <svg className="w-[18px] h-[18px] text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                    </svg>
                    Reply
                </button>

                {/* Edit (only for sender's messages with text) */}
                {isMine && decryptedText && onEdit && (
                    <button
                        onClick={handleEdit}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-white hover:bg-white/10 transition text-left"
                    >
                        <svg className="w-[18px] h-[18px] text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        Edit
                    </button>
                )}

                {/* Copy (only if there's text) */}
                {decryptedText && (
                    <button
                        onClick={handleCopy}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-white hover:bg-white/10 transition text-left"
                    >
                        <svg className="w-[18px] h-[18px] text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        Copy Text
                    </button>
                )}

                {/* Download (only if there's a file) */}
                {decryptedFileUrl && msg.file && (
                    <button
                        onClick={handleDownload}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-white hover:bg-white/10 transition text-left"
                    >
                        <svg className="w-[18px] h-[18px] text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download
                    </button>
                )}

                {/* Delete (only for sender's messages) */}
                {isMine && onDelete && (
                    <button
                        onClick={handleDelete}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition text-left"
                    >
                        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Delete
                    </button>
                )}
            </div>
        </div>
    );
}
