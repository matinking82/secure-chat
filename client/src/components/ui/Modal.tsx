import type { ReactNode } from "react";

interface ModalProps {
    open: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    panelClassName?: string;
}

export default function Modal({ open, onClose, title, children, panelClassName = "" }: ModalProps) {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4" onClick={onClose}>
            <div
                className={`sc-modal-surface bg-[#17212b] rounded-xl shadow-2xl w-full max-w-md max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-2rem)] border border-[#2b5278]/30 animate-in overflow-hidden flex flex-col ${panelClassName}`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-4 border-b border-[#2b5278]/30">
                    <h2 className="text-lg font-semibold text-white">{title}</h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition text-xl leading-none"
                    >
                        ✕
                    </button>
                </div>
                <div className="p-4 sm:p-5 overflow-y-auto flex-1 min-h-0">{children}</div>
            </div>
        </div>
    );
}
