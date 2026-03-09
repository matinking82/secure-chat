import { useRef, useCallback } from "react";
import type { SavedChat } from "../../types";
import { renderTextWithEmoji } from "../../lib/emojiService";

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

interface ChatListItemProps {
    chat: SavedChat;
    isActive: boolean;
    onClick: () => void;
    onContextMenu: (chatId: string, position: { x: number; y: number }) => void;
}

export default function ChatListItem({ chat, isActive, onClick, onContextMenu }: ChatListItemProps) {
    const initial = (chat.label || chat.chatId).charAt(0).toUpperCase();
    const timeStr = chat.lastMessageTime
        ? new Date(chat.lastMessageTime).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
          })
        : "";

    // Long-press for mobile
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const touchMoved = useRef(false);

    const handleContextMenu = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            onContextMenu(chat.chatId, { x: e.clientX, y: e.clientY });
        },
        [chat.chatId, onContextMenu]
    );

    const handleTouchStart = useCallback(
        (e: React.TouchEvent) => {
            touchMoved.current = false;
            longPressTimer.current = setTimeout(() => {
                const touch = e.touches[0];
                onContextMenu(chat.chatId, { x: touch.clientX, y: touch.clientY });
            }, 500);
        },
        [chat.chatId, onContextMenu]
    );

    const handleTouchMove = useCallback(() => {
        touchMoved.current = true;
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    }, []);

    const handleTouchEnd = useCallback(() => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    }, []);

    return (
        <div
            onClick={onClick}
            onContextMenu={handleContextMenu}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className={`sc-chat-list-item flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors select-none
                ${isActive ? "bg-[#2b5278]" : "hover:bg-[#1e2c3a]"}`}
        >
            {/* Avatar */}
            <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg shrink-0"
                style={{ backgroundColor: getChatColor(chat.chatId) }}
            >
                {initial}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                    <span className="font-medium text-white text-[15px] truncate">
                        {chat.label || chat.chatId}
                    </span>
                    {timeStr && (
                        <span className="text-xs text-gray-400 shrink-0 ml-2">
                            {timeStr}
                        </span>
                    )}
                </div>
                <p className="text-sm text-gray-400 truncate mt-0.5">
                    {chat.lastMessage ? renderTextWithEmoji(chat.lastMessage, 14) : "\u00A0"}
                </p>
            </div>

            {/* Badges */}
            <div className="flex items-center gap-1 shrink-0">
                {/* Mention badge */}
                {chat.hasMention && (
                    <div className="bg-[#4ea4f6] text-white text-[10px] font-bold rounded-full w-[22px] h-[22px] flex items-center justify-center">
                        @
                    </div>
                )}
                {/* Unread badge */}
                {chat.unreadCount > 0 && (
                    <div className="bg-[#4ea4f6] text-white text-xs font-bold rounded-full min-w-[22px] h-[22px] flex items-center justify-center px-1.5">
                        {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
                    </div>
                )}
            </div>
        </div>
    );
}
