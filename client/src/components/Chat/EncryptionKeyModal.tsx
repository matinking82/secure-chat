import { useEffect, useState } from "react";
import Modal from "../ui/Modal";
import { getEncryptionKey, setEncryptionKey } from "../../lib/storage";

interface EncryptionKeyModalProps {
    chatId: string;
    open: boolean;
    onClose: () => void;
}

export default function EncryptionKeyModal({
    chatId,
    open,
    onClose,
}: EncryptionKeyModalProps) {
    const [key, setKey] = useState(() => getEncryptionKey(chatId));
    const [showKey, setShowKey] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        if (!open) return;
        setKey(getEncryptionKey(chatId));
        setShowKey(false);
        setSaved(false);
    }, [chatId, open]);

    const handleSave = () => {
        setEncryptionKey(chatId, key);
        setSaved(true);
        setTimeout(() => {
            setSaved(false);
            onClose();
        }, 1000);
    };

    return (
        <Modal open={open} onClose={onClose} title="Encryption Key">
            <div className="flex flex-col gap-4">
                <p className="text-gray-400 text-sm">
                    Set a shared secret key for this chat. All participants must use the
                    same key to read messages. The key never leaves your browser.
                </p>

                <div className="relative">
                    <input
                        type={showKey ? "text" : "password"}
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                        placeholder="Enter encryption key..."
                        className="w-full bg-[#0e1621] text-white border border-[#2b5278]/50 rounded-lg
                                   px-4 py-3 pr-12 focus:outline-none focus:border-[#4ea4f6] transition
                                   placeholder-gray-500"
                    />
                    <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                    >
                        {showKey ? (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                            </svg>
                        ) : (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                        )}
                    </button>
                </div>

                <div className="text-xs text-gray-500 flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    If you change the key, you won't be able to read messages encrypted with the old key.
                </div>

                <button
                    onClick={handleSave}
                    className={`font-medium py-3 rounded-lg transition ${
                        saved
                            ? "bg-green-600 text-white"
                            : "bg-[#4ea4f6] hover:bg-[#3d93e5] text-white"
                    }`}
                >
                    {saved ? "✓ Saved" : "Save Key"}
                </button>
            </div>
        </Modal>
    );
}
