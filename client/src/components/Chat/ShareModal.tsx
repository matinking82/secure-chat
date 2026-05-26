import { useState } from "react";
import Modal from "../ui/Modal";
import { createChatInvite } from "../../lib/api";
import { generateSecureRandomKey, getEncryptionKey } from "../../lib/storage";
import { encryptText } from "../../lib/crypto";

interface ShareModalProps {
    chatId: string;
    open: boolean;
    onClose: () => void;
}

export default function ShareModal({ chatId, open, onClose }: ShareModalProps) {
    const [copied, setCopied] = useState(false);
    const [ttlValue, setTtlValue] = useState("30");
    const [ttlUnit, setTtlUnit] = useState<"minute" | "hour">("minute");
    const [inviteLink, setInviteLink] = useState("");
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState("");

    const handleCreateInviteLink = async () => {
        const parsed = Number(ttlValue);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            setError("Please enter a valid time.");
            return;
        }
        setCreating(true);
        setError("");
        try {
            const inviteKey = generateSecureRandomKey(32);
            const chatEncryptionKey = getEncryptionKey(chatId);
            const payload = JSON.stringify({
                chatKey: chatId,
                encryptionKey: chatEncryptionKey,
            });
            const encryptedPayload = await encryptText(payload, inviteKey, "invite-link");
            const created = await createChatInvite({
                data: encryptedPayload,
                ttlValue: parsed,
                ttlUnit,
            });
            const url = `${window.location.origin}/join/${created.id}?key=${encodeURIComponent(inviteKey)}`;
            setInviteLink(url);
        } catch {
            setError("Failed to create invite link.");
        } finally {
            setCreating(false);
        }
    };

    const handleCopy = () => {
        if (!inviteLink) return;
        navigator.clipboard.writeText(inviteLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Modal open={open} onClose={onClose} title="Share Chat">
            <div className="flex flex-col gap-4">
                <p className="text-gray-400 text-sm">
                    Create an invite link with expiry time. This shares encrypted chat data.
                </p>

                <div className="flex items-center gap-2">
                    <input
                        type="number"
                        min={1}
                        step={1}
                        value={ttlValue}
                        onChange={(e) => setTtlValue(e.target.value)}
                        className="w-24 bg-[#0e1621] text-white border border-[#2b5278]/50 rounded-lg px-3 py-3 focus:outline-none text-sm"
                    />
                    <select
                        value={ttlUnit}
                        onChange={(e) => setTtlUnit(e.target.value as "minute" | "hour")}
                        className="bg-[#0e1621] text-white border border-[#2b5278]/50 rounded-lg px-3 py-3 focus:outline-none text-sm"
                    >
                        <option value="minute">minute</option>
                        <option value="hour">hour</option>
                    </select>
                    <button
                        onClick={handleCreateInviteLink}
                        disabled={creating}
                        className="px-4 py-3 rounded-lg font-medium transition shrink-0 bg-[#4ea4f6] hover:bg-[#3d93e5] disabled:opacity-50 text-white"
                    >
                        {creating ? "Creating..." : "Create Invite Link"}
                    </button>
                </div>

                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        readOnly
                        value={inviteLink}
                        className="flex-1 bg-[#0e1621] text-white border border-[#2b5278]/50 rounded-lg
                                   px-4 py-3 focus:outline-none text-sm select-all"
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <button
                        onClick={handleCopy}
                        disabled={!inviteLink}
                        className={`px-4 py-3 rounded-lg font-medium transition shrink-0 ${
                            copied
                                ? "bg-green-600 text-white"
                                : "bg-[#4ea4f6] hover:bg-[#3d93e5] disabled:opacity-50 disabled:cursor-not-allowed text-white"
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
                {error && <p className="text-red-400 text-sm">{error}</p>}

                <div className="text-xs text-gray-500 flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-[#4ea4f6]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Invite payload is encrypted and expires automatically.
                </div>
            </div>
        </Modal>
    );
}
