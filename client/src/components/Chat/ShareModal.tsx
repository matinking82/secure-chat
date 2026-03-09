import { useState } from "react";
import Modal from "../ui/Modal";

interface ShareModalProps {
    chatId: string;
    open: boolean;
    onClose: () => void;
}

export default function ShareModal({ chatId, open, onClose }: ShareModalProps) {
    const [copied, setCopied] = useState(false);

    const chatUrl = `${window.location.origin}/chat/${chatId}`;

    const handleCopy = () => {
        navigator.clipboard.writeText(chatUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Modal open={open} onClose={onClose} title="Share Chat">
            <div className="flex flex-col gap-4">
                <p className="text-gray-400 text-sm">
                    Share this link to invite others to this chat room. They'll need the same
                    encryption key to read messages.
                </p>

                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        readOnly
                        value={chatUrl}
                        className="flex-1 bg-[#0e1621] text-white border border-[#2b5278]/50 rounded-lg
                                   px-4 py-3 focus:outline-none text-sm select-all"
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <button
                        onClick={handleCopy}
                        className={`px-4 py-3 rounded-lg font-medium transition shrink-0 ${
                            copied
                                ? "bg-green-600 text-white"
                                : "bg-[#4ea4f6] hover:bg-[#3d93e5] text-white"
                        }`}
                    >
                        {copied ? (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                        ) : (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                        )}
                    </button>
                </div>

                <div className="text-xs text-gray-500 flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-[#4ea4f6]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Remember to also share the encryption key separately through a secure channel.
                </div>
            </div>
        </Modal>
    );
}
