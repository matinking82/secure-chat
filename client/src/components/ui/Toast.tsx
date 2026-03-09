import { useChat, type NotifItem } from "../../contexts/ChatContext";
import { useNavigate } from "react-router-dom";

export default function Toast() {
    const { notifications, dismissNotification } = useChat();
    const navigate = useNavigate();

    if (notifications.length === 0) return null;

    return (
        <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
            {notifications.map((n) => (
                <div
                    key={n.id}
                    className="bg-[#2b5278] text-white rounded-lg px-4 py-3 shadow-lg cursor-pointer
                               flex items-start gap-3 animate-slide-in border border-[#4ea4f6]/30
                               hover:bg-[#3a6491] transition"
                    onClick={() => {
                        dismissNotification(n.id);
                        navigate(`/chat/${n.chatId}`);
                    }}
                >
                    <div className="w-8 h-8 rounded-full bg-[#4ea4f6] flex items-center justify-center text-sm font-bold shrink-0">
                        {n.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{n.name}</div>
                        <div className="text-xs text-gray-300 truncate">{n.preview}</div>
                    </div>
                    <button
                        className="text-gray-400 hover:text-white text-sm"
                        onClick={(e) => {
                            e.stopPropagation();
                            dismissNotification(n.id);
                        }}
                    >
                        ✕
                    </button>
                </div>
            ))}
        </div>
    );
}
