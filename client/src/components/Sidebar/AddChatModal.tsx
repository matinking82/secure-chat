import { useEffect, useState } from "react";
import Modal from "../ui/Modal";
import { MIN_CHAT_KEY_LENGTH } from "../../lib/chatKey";
import {
    generateSecureRandomKey,
    getBrowserId,
    getEncryptionKeys,
    setEncryptionKey,
} from "../../lib/storage";
import { useUser } from "../../contexts/UserContext";

interface AddChatModalProps {
    open: boolean;
    onClose: () => void;
    onAdd: (chatId: string) => void;
}
const PV_PATH_SUFFIX = "/pv/";

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
    const { settings } = useUser();
    const [chatKey, setChatKey] = useState(() => generateRandomCode());
    const [error, setError] = useState("");
    const [activeTab, setActiveTab] = useState<"chat" | "pv">("chat");
    const [copied, setCopied] = useState(false);
    const [pvShareName, setPvShareName] = useState(() => settings.displayName || "");
    const trimmedShareName = pvShareName.trim();
    const pvLink = `${window.location.origin}${PV_PATH_SUFFIX}${getBrowserId()}${
        trimmedShareName ? `?name=${encodeURIComponent(trimmedShareName)}` : ""
    }`;

    useEffect(() => {
        if (!open) return;
        setPvShareName(settings.displayName || "");
    }, [open, settings.displayName]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = chatKey.trim();
        if (!trimmed) return;
        if (trimmed.length < MIN_CHAT_KEY_LENGTH) {
            setError(`Chat key must be at least ${MIN_CHAT_KEY_LENGTH} characters.`);
            return;
        }
        const existingKeys = getEncryptionKeys();
        if (!existingKeys[trimmed]) {
            setEncryptionKey(trimmed, generateSecureRandomKey(32));
        }
        onAdd(trimmed);
        setChatKey("");
        setError("");
        onClose();
    };

    const handleGenerateRandom = () => {
        setChatKey(generateRandomCode());
        setError("");
    };

    const handleCopyPvLink = async () => {
        try {
            await navigator.clipboard.writeText(pvLink);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            setCopied(false);
        }
    };

    return (
        <Modal open={open} onClose={onClose} title="Join Chat">
            <div className="flex items-center gap-2 mb-4">
                <button
                    type="button"
                    onClick={() => setActiveTab("chat")}
                    className={`px-3 py-1.5 rounded-md text-sm transition ${
                        activeTab === "chat"
                            ? "bg-[#4ea4f6] text-white"
                            : "bg-[#1e2c3a] text-gray-300 hover:text-white"
                    }`}
                >
                    Chat
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab("pv")}
                    title="Private link sharing"
                    aria-label="Private link sharing"
                    className={`px-3 py-1.5 rounded-md text-sm transition ${
                        activeTab === "pv"
                            ? "bg-[#4ea4f6] text-white"
                            : "bg-[#1e2c3a] text-gray-300 hover:text-white"
                    }`}
                >
                    PV
                </button>
            </div>

            {activeTab === "chat" ? (
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <p className="text-gray-400 text-sm">
                        Enter a chat room key to join. Share this key with others so they can join the same room.
                    </p>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={chatKey}
                            onChange={(e) => {
                                setChatKey(e.target.value);
                                if (error) setError("");
                            }}
                            placeholder="Enter chat key..."
                            autoFocus={activeTab === "chat"}
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
                    {error && (
                        <p className="text-red-400 text-sm -mt-2">{error}</p>
                    )}
                    <button
                        type="submit"
                        disabled={!chatKey.trim()}
                        className="bg-[#4ea4f6] hover:bg-[#3d93e5] disabled:opacity-40 disabled:cursor-not-allowed
                               text-white font-medium py-3 rounded-lg transition"
                    >
                        Join Chat
                    </button>
                </form>
            ) : (
                <div className="flex flex-col gap-4">
                    <div>
                        <label htmlFor="pv-share-name" className="block text-gray-300 text-sm mb-1.5">
                            Name shown to the user opening the link
                        </label>
                        <input
                            id="pv-share-name"
                            type="text"
                            value={pvShareName}
                            onChange={(e) => setPvShareName(e.target.value)}
                            className="w-full bg-[#0e1621] text-white border border-[#2b5278]/50 rounded-lg px-4 py-3
                                   focus:outline-none focus:border-[#4ea4f6] transition"
                        />
                        <p className="text-gray-500 text-xs mt-1">
                            This name will be the chat name for the user entering the link.
                        </p>
                    </div>
                    <p className="text-gray-400 text-sm">
                        Share this PV link:
                    </p>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={pvLink}
                            readOnly
                            className="flex-1 bg-[#0e1621] text-white border border-[#2b5278]/50 rounded-lg px-4 py-3
                                   focus:outline-none focus:border-[#4ea4f6] transition"
                        />
                        <button
                            type="button"
                            onClick={handleCopyPvLink}
                            className="px-3 py-3 bg-[#1e2c3a] hover:bg-[#2b5278] text-gray-300 hover:text-white
                                   rounded-lg transition shrink-0 border border-[#2b5278]/50"
                        >
                            {copied ? "Copied" : "Copy"}
                        </button>
                    </div>
                </div>
            )}
        </Modal>
    );
}
