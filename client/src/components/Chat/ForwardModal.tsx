import { useMemo } from "react";
import type { SavedChat } from "../../types";
import Modal from "../ui/Modal";

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

interface ForwardModalProps {
    open: boolean;
    onClose: () => void;
    chats: SavedChat[];
    currentChatId: string;
    selectedCount: number;
    onSelectChat: (chatId: string) => void;
}

export default function ForwardModal({
    open,
    onClose,
    chats,
    currentChatId,
    selectedCount,
    onSelectChat,
}: ForwardModalProps) {
    const availableChats = useMemo(() => {
        return chats
            .filter((chat) => chat.chatId !== currentChatId)
            .sort((a, b) => {
                if (Boolean(a.pinned) !== Boolean(b.pinned)) {
                    return a.pinned ? -1 : 1;
                }
                const timeA = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
                const timeB = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
                return timeB - timeA;
            });
    }, [chats, currentChatId]);

    return (
        <Modal open={open} onClose={onClose} title="Forward Messages">
            <div className="flex flex-col gap-3">
                <p className="text-sm text-gray-400">
                    Select a chat to forward {selectedCount} message{selectedCount === 1 ? "" : "s"}.
                </p>

                {availableChats.length === 0 ? (
                    <div className="text-sm text-gray-500">No other chats available.</div>
                ) : (
                    <div className="max-h-72 overflow-y-auto rounded-lg border border-[#2b5278]/30">
                        {availableChats.map((chat) => (
                            <button
                                key={chat.chatId}
                                type="button"
                                onClick={() => onSelectChat(chat.chatId)}
                                className="w-full text-left px-4 py-3 border-b last:border-b-0 border-[#2b5278]/20 hover:bg-[#1e2c3a] transition flex items-center gap-3"
                            >
                                <div
                                    className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold shrink-0"
                                    style={{ backgroundColor: getChatColor(chat.chatId) }}
                                >
                                    {(chat.label || chat.chatId).charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                    <div className="text-white font-medium truncate">
                                        {chat.label || chat.chatId}
                                    </div>
                                    <div className="text-xs text-gray-500 truncate">{chat.chatId}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </Modal>
    );
}
