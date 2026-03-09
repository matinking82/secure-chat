import { useEffect, useRef, useState } from "react";

interface ChatListContextMenuProps {
    chatId: string;
    onOpen: () => void;
    onSettings: () => void;
    onDelete: () => void;
    onClose: () => void;
    position: { x: number; y: number };
}

export default function ChatListContextMenu({
    onOpen,
    onSettings,
    onDelete,
    onClose,
    position,
}: ChatListContextMenuProps) {
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

    // Close on click outside or scroll
    useEffect(() => {
        const handleClose = () => onClose();
        document.addEventListener("click", handleClose);
        document.addEventListener("scroll", handleClose, true);
        return () => {
            document.removeEventListener("click", handleClose);
            document.removeEventListener("scroll", handleClose, true);
        };
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-[200]" onClick={onClose}>
            <div
                ref={menuRef}
                className="fixed rounded-xl shadow-2xl border border-white/10
                           py-1.5 min-w-[180px] animate-in overflow-hidden select-none backdrop-blur-xl"
                style={{ left: adjusted.x, top: adjusted.y, backgroundColor: 'var(--sc-surface-2, #1e2c3a)' }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Open */}
                <button
                    onClick={onOpen}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-white hover:bg-white/10 transition text-left"
                >
                    <svg className="w-[18px] h-[18px] text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    Open
                </button>

                {/* Settings */}
                <button
                    onClick={onSettings}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-white hover:bg-white/10 transition text-left"
                >
                    <svg className="w-[18px] h-[18px] text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Settings
                </button>

                {/* Divider */}
                <div className="border-t border-white/10 my-1" />

                {/* Delete */}
                <button
                    onClick={onDelete}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition text-left"
                >
                    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete Chat
                </button>
            </div>
        </div>
    );
}
