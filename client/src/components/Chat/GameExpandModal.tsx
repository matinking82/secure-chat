import { type ReactNode } from "react";
import { createPortal } from "react-dom";

interface GameExpandModalProps {
    open: boolean;
    onClose: () => void;
    children: ReactNode;
}

export default function GameExpandModal({ open, onClose, children }: GameExpandModalProps) {
    if (!open) return null;

    return createPortal(
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="relative max-w-[95vw] max-h-[95vh] overflow-auto rounded-2xl p-4"
                style={{ background: "#0e1621" }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Close button */}
                <button
                    onClick={onClose}
                    className="absolute top-2 right-2 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white transition text-lg leading-none"
                >
                    ✕
                </button>
                <div className="pt-2">
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );
}

/** Small expand icon button to open a game in a modal */
export function GameExpandButton({ onClick }: { onClick: () => void }) {
    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                onClick();
            }}
            className="absolute top-1.5 right-1.5 z-10 w-7 h-7 flex items-center justify-center rounded-full bg-black/30 hover:bg-black/50 text-gray-300 hover:text-white transition"
            title="Expand game"
        >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
        </button>
    );
}
