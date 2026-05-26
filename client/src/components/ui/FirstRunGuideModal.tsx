interface FirstRunGuideModalProps {
    open: boolean;
    onUnderstand: () => void;
}

export default function FirstRunGuideModal({ open, onUnderstand }: FirstRunGuideModalProps) {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/75 p-4">
            <div className="bg-[#17212b] rounded-xl shadow-2xl w-full max-w-lg border border-[#2b5278]/30 animate-in">
                <div className="px-5 pt-5 pb-3">
                    <h2 className="text-xl font-semibold text-white">How SecureChat works</h2>
                    <p className="text-gray-400 text-sm mt-1">
                        Please read this once before choosing your name.
                    </p>
                </div>

                <div className="px-5 pb-2 text-sm text-gray-300 space-y-3">
                    <p>
                        <span className="text-white font-medium">chatKey</span>: this is the room key used by the backend to store and load chat messages.
                        Anyone with the same chatKey joins the same chat history.
                    </p>
                    <p>
                        <span className="text-white font-medium">encryptionKey</span>: this key encrypts/decrypts message content on your device.
                        Keep it strong and private. If the key is wrong, messages will stay unreadable.
                    </p>
                    <p>
                        <span className="text-white font-medium">Tips</span>: use hard-to-guess keys, avoid sharing keys publicly,
                        and use different keys for different groups when possible.
                    </p>
                </div>

                <div className="p-5 pt-4">
                    <button
                        onClick={onUnderstand}
                        className="w-full bg-[#4ea4f6] hover:bg-[#3d93e5] text-white font-medium py-3 rounded-lg transition"
                    >
                        I Understand
                    </button>
                </div>
            </div>
        </div>
    );
}
