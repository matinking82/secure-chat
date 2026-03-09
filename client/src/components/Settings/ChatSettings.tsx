import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useChat } from "../../contexts/ChatContext";
import { useUser } from "../../contexts/UserContext";
import { getEncryptionKey, setEncryptionKey, getChatDisplayName, setChatDisplayName } from "../../lib/storage";
import { subscribeChatToPush, unsubscribeChatFromPush, getNotificationPermission } from "../../lib/push";
import AppleEmoji from "../ui/AppleEmoji";

// Consistent color palette for chat avatars
const CHAT_COLORS = [
    "#e06c75", "#61afef", "#98c379", "#c678dd",
    "#d19a66", "#56b6c2", "#be5046", "#73d0ff",
    "#ff7eb3", "#7ec8e3", "#a0e77d", "#ffd76e",
    "#c79bf2", "#f5a262", "#6ec6c8", "#e5c07b",
];

function getChatColor(chatId: string): string {
    let hash = 0;
    for (let i = 0; i < chatId.length; i++) {
        hash = chatId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return CHAT_COLORS[Math.abs(hash) % CHAT_COLORS.length];
}

export default function ChatSettings() {
    const { chatId } = useParams<{ chatId: string }>();
    const navigate = useNavigate();
    const { chats, updateChat, removeChat } = useChat();
    const { settings } = useUser();

    const chat = chats.find((c) => c.chatId === chatId);
    const [label, setLabel] = useState(chat?.label || chatId || "");
    const [encKey, setEncKey] = useState(() => getEncryptionKey(chatId || ""));
    const [showKey, setShowKey] = useState(false);
    const [saved, setSaved] = useState(false);
    const [chatDisplayNameVal, setChatDisplayNameVal] = useState(() => getChatDisplayName(chatId || ""));

    useEffect(() => {
        if (!chatId) return;
        setLabel(chat?.label || chatId || "");
        setEncKey(getEncryptionKey(chatId));
        setChatDisplayNameVal(getChatDisplayName(chatId));
        setShowKey(false);
        setSaved(false);
    }, [chat?.label, chatId]);

    if (!chatId) return null;

    const handleSave = () => {
        updateChat(chatId, { label: label.trim() || chatId });
        setEncryptionKey(chatId, encKey);
        setChatDisplayName(chatId, chatDisplayNameVal);
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
    };

    const handleLeave = () => {
        if (confirm("Remove this chat from your list? You can rejoin later with the same key.")) {
            removeChat(chatId);
            navigate("/");
        }
    };

    return (
        <div className="flex flex-col h-full min-h-0 bg-[#0e1621]">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 bg-[#17212b] border-b border-[#0e1621] shrink-0">
                <button
                    onClick={() => navigate(`/chat/${chatId}`)}
                    className="p-1 text-gray-400 hover:text-white transition"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M15 19l-7-7 7-7" />
                    </svg>
                </button>
                <h1 className="text-lg font-semibold text-white">Chat Settings</h1>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {/* Chat info */}
                <div className="bg-[#17212b] rounded-xl p-5 space-y-4">
                    <div className="flex items-center gap-4">
                        <div
                            className="w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-bold"
                            style={{ backgroundColor: getChatColor(chatId) }}
                        >
                            {chatId.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <div className="text-white font-medium">{label || chatId}</div>
                            <div className="text-xs text-gray-500 mt-0.5">
                                Room: {chatId}
                            </div>
                        </div>
                    </div>

                    {/* Chat label */}
                    <div>
                        <label className="text-gray-400 text-sm block mb-1.5">
                            Chat Name
                        </label>
                        <input
                            type="text"
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            placeholder="Enter chat name..."
                            className="w-full bg-[#0e1621] text-white border border-[#2b5278]/50 rounded-lg
                                       px-4 py-3 focus:outline-none focus:border-[#4ea4f6] transition
                                       placeholder-gray-500"
                        />
                    </div>

                    {/* Per-chat display name */}
                    <div>
                        <label className="text-gray-400 text-sm block mb-1.5">
                            Your Display Name (this chat only)
                        </label>
                        <input
                            type="text"
                            value={chatDisplayNameVal}
                            onChange={(e) => setChatDisplayNameVal(e.target.value)}
                            placeholder={settings.displayName || "Use global name..."}
                            className="w-full bg-[#0e1621] text-white border border-[#2b5278]/50 rounded-lg
                                       px-4 py-3 focus:outline-none focus:border-[#4ea4f6] transition
                                       placeholder-gray-500"
                        />
                        <div className="text-xs text-gray-500 mt-1">
                            If set, this name will be used when sending messages in this chat instead of your global name.
                        </div>
                    </div>
                </div>

                {/* Encryption key */}
                <div className="bg-[#17212b] rounded-xl p-5 space-y-4">
                    <h2 className="text-sm uppercase tracking-wider text-[#4ea4f6] font-medium">
                        Encryption
                    </h2>
                    <p className="text-gray-400 text-sm">
                        The encryption key is used to encrypt and decrypt messages in this chat.
                        All participants must use the same key.
                    </p>

                    <div className="relative">
                        <input
                            type={showKey ? "text" : "password"}
                            value={encKey}
                            onChange={(e) => setEncKey(e.target.value)}
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
                            {showKey ? <AppleEmoji native="👁️" size={18} /> : <AppleEmoji native="👁️‍🗨️" size={18} />}
                        </button>
                    </div>

                    <div className="text-xs text-gray-500 flex items-center gap-1.5">
                        <AppleEmoji native="⚠️" size={14} />
                        Changing the key means old messages encrypted with the previous key won't be readable.
                    </div>
                </div>

                {/* Notifications */}
                <div className="bg-[#17212b] rounded-xl p-5 space-y-4">
                    <h2 className="text-sm uppercase tracking-wider text-[#4ea4f6] font-medium">
                        Notifications
                    </h2>
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-white text-sm font-medium">Mute Notifications</div>
                            <div className="text-gray-500 text-xs mt-0.5">
                                {chat?.muted ? "Notifications are muted for this chat" : "You will receive notifications for new messages"}
                            </div>
                        </div>
                        <button
                            onClick={async () => {
                                const newMuted = !chat?.muted;
                                updateChat(chatId, { muted: newMuted });
                                if (newMuted) {
                                    // Muting — unsubscribe from push for this chat
                                    await unsubscribeChatFromPush(chatId);
                                } else {
                                    // Unmuting — re-subscribe if global push is enabled
                                    if (settings.pushEnabled && getNotificationPermission() === "granted") {
                                        await subscribeChatToPush(chatId, settings.browserId);
                                    }
                                }
                            }}
                            className={`relative w-12 h-7 rounded-full transition-colors ${
                                chat?.muted ? "bg-red-500" : "bg-[#2b5278]"
                            }`}
                        >
                            <div
                                className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-transform ${
                                    chat?.muted ? "translate-x-5" : "translate-x-0.5"
                                }`}
                            />
                        </button>
                    </div>
                </div>

                {/* Save button */}
                <button
                    onClick={handleSave}
                    className={`w-full font-medium py-3 rounded-lg transition ${
                        saved
                            ? "bg-green-600 text-white"
                            : "bg-[#4ea4f6] hover:bg-[#3d93e5] text-white"
                    }`}
                >
                    {saved ? "✓ Saved" : "Save Changes"}
                </button>

                {/* Leave chat */}
                <div className="bg-[#17212b] rounded-xl p-5">
                    <button
                        onClick={handleLeave}
                        className="w-full text-red-400 hover:text-red-300 font-medium py-3
                                   border border-red-400/30 hover:border-red-400/60 rounded-lg transition"
                    >
                        Leave Chat
                    </button>
                </div>
            </div>
        </div>
    );
}
