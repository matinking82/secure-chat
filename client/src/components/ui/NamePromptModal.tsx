import { useState } from "react";
import { useUser } from "../../contexts/UserContext";

export default function NamePromptModal() {
    const { settings, updateSettings } = useUser();
    const [name, setName] = useState("");
    const [open, setOpen] = useState(() => {
        // Show if name is default "Anonymous" and no saved setting exists
        return settings.displayName === "Anonymous";
    });

    if (!open) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (trimmed) {
            updateSettings({ displayName: trimmed });
            setOpen(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4">
            <div
                className="bg-[#17212b] rounded-xl shadow-2xl w-full max-w-sm border border-[#2b5278]/30 animate-in"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-5 pt-6 pb-2 text-center">
                    <div className="w-20 h-20 rounded-full bg-[#4ea4f6] flex items-center justify-center text-white text-3xl font-bold mx-auto mb-4">
                        {(name || "?").charAt(0).toUpperCase()}
                    </div>
                    <h2 className="text-xl font-semibold text-white mb-1">Welcome to SecureChat</h2>
                    <p className="text-gray-400 text-sm">Choose a display name to get started</p>
                </div>
                <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your name..."
                        autoFocus
                        className="w-full bg-[#0e1621] text-white border border-[#2b5278]/50 rounded-lg
                                   px-4 py-3 focus:outline-none focus:border-[#4ea4f6] transition
                                   placeholder-gray-500 text-center text-lg"
                    />
                    <button
                        type="submit"
                        disabled={!name.trim()}
                        className="bg-[#4ea4f6] hover:bg-[#3d93e5] disabled:opacity-40 disabled:cursor-not-allowed
                                   text-white font-medium py-3 rounded-lg transition"
                    >
                        Continue
                    </button>
                </form>
            </div>
        </div>
    );
}
