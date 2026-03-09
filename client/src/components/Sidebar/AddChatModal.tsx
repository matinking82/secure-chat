import { useState } from "react";
import Modal from "../ui/Modal";

interface AddChatModalProps {
    open: boolean;
    onClose: () => void;
    onAdd: (chatId: string) => void;
}

function generateRandomCode(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    const array = new Uint8Array(12);
    crypto.getRandomValues(array);
    for (let i = 0; i < 12; i++) {
        result += chars[array[i] % chars.length];
    }
    return result;
}

export default function AddChatModal({ open, onClose, onAdd }: AddChatModalProps) {
    const [chatKey, setChatKey] = useState("");

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = chatKey.trim();
        if (trimmed) {
            onAdd(trimmed);
            setChatKey("");
            onClose();
        }
    };

    const handleGenerateRandom = () => {
        setChatKey(generateRandomCode());
    };

    return (
        <Modal open={open} onClose={onClose} title="Join Chat">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <p className="text-gray-400 text-sm">
                    Enter a chat room key to join. Share this key with others so they can join the same room.
                </p>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={chatKey}
                        onChange={(e) => setChatKey(e.target.value)}
                        placeholder="Enter chat key..."
                        autoFocus
                        className="flex-1 bg-[#0e1621] text-white border border-[#2b5278]/50 rounded-lg px-4 py-3
                                   focus:outline-none focus:border-[#4ea4f6] transition placeholder-gray-500"
                    />
                    <button
                        type="button"
                        onClick={handleGenerateRandom}
                        className="px-3 py-3 bg-[#1e2c3a] hover:bg-[#2b5278] text-gray-300 hover:text-white
                                   rounded-lg transition shrink-0 border border-[#2b5278]/50"
                        title="Generate random code"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                </div>
                <button
                    type="submit"
                    disabled={!chatKey.trim()}
                    className="bg-[#4ea4f6] hover:bg-[#3d93e5] disabled:opacity-40 disabled:cursor-not-allowed
                               text-white font-medium py-3 rounded-lg transition"
                >
                    Join Chat
                </button>
            </form>
        </Modal>
    );
}
