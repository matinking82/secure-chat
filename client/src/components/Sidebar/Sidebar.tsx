import { useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useChat } from "../../contexts/ChatContext";
import ChatListItem from "./ChatListItem";
import ChatListContextMenu from "./ChatListContextMenu";
import AddChatModal from "./AddChatModal";

export default function Sidebar() {
    const { chats, activeChatId, addChat, removeChat } = useChat();
    const [showAddModal, setShowAddModal] = useState(false);
    const [search, setSearch] = useState("");
    const [contextMenu, setContextMenu] = useState<{
        chatId: string;
        position: { x: number; y: number };
    } | null>(null);
    const navigate = useNavigate();
    const location = useLocation();

    const isSettingsActive = location.pathname === "/settings";

    // Sort chats from newest to oldest by last message time
    const sortedChats = [...chats].sort((a, b) => {
        const timeA = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
        const timeB = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
        return timeB - timeA;
    });

    const filteredChats = search
        ? sortedChats.filter(
              (c) =>
                  c.chatId.toLowerCase().includes(search.toLowerCase()) ||
                  c.label?.toLowerCase().includes(search.toLowerCase())
          )
        : sortedChats;

    const handleAddChat = (chatId: string) => {
        addChat(chatId);
        navigate(`/chat/${chatId}`);
    };

    const handleContextMenu = useCallback(
        (chatId: string, position: { x: number; y: number }) => {
            setContextMenu({ chatId, position });
        },
        []
    );

    const handleDeleteChat = useCallback(() => {
        if (contextMenu) {
            removeChat(contextMenu.chatId);
            // If we're viewing the deleted chat, go back to root
            if (location.pathname === `/chat/${contextMenu.chatId}` ||
                location.pathname === `/chat/${contextMenu.chatId}/settings`) {
                navigate("/");
            }
        }
        setContextMenu(null);
    }, [contextMenu, removeChat, location.pathname, navigate]);

    const handleOpenChat = useCallback(() => {
        if (contextMenu) {
            navigate(`/chat/${contextMenu.chatId}`);
        }
        setContextMenu(null);
    }, [contextMenu, navigate]);

    const handleChatSettings = useCallback(() => {
        if (contextMenu) {
            navigate(`/settings/${contextMenu.chatId}`);
        }
        setContextMenu(null);
    }, [contextMenu, navigate]);

    return (
        <div className="sc-sidebar-shell flex flex-col h-full bg-[#17212b] border-r border-[#0e1621]">
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[#0e1621]">
                <button
                    onClick={() => navigate("/settings")}
                    className={`p-2 rounded-lg transition ${
                        isSettingsActive
                            ? "bg-[#2b5278] text-white"
                            : "text-gray-400 hover:text-white hover:bg-[#1e2c3a]"
                    }`}
                    title="Settings"
                >
                    <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 6h16M4 12h16M4 18h16"
                        />
                    </svg>
                </button>
                <div className="relative flex-1">
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search..."
                        className="w-full bg-[#242f3d] text-white text-sm rounded-lg px-4 py-2
                                   placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#4ea4f6]/50"
                    />
                    {search && (
                        <button
                            onClick={() => setSearch("")}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                        >
                            ✕
                        </button>
                    )}
                </div>
            </div>

            {/* Chat list */}
            <div className="flex-1 overflow-y-auto">
                {filteredChats.length === 0 && (
                    <div className="text-center text-gray-500 mt-12 px-4">
                        {search ? (
                            <p>No chats matching "{search}"</p>
                        ) : (
                            <div>
                                <p className="text-lg mb-2">No chats yet</p>
                                <p className="text-sm">
                                    Tap the + button to join a chat room
                                </p>
                            </div>
                        )}
                    </div>
                )}
                {filteredChats.map((chat) => (
                    <ChatListItem
                        key={chat.chatId}
                        chat={chat}
                        isActive={activeChatId === chat.chatId}
                        onClick={() => navigate(`/chat/${chat.chatId}`)}
                        onContextMenu={handleContextMenu}
                    />
                ))}
            </div>

            {/* Floating add button */}
            <button
                onClick={() => setShowAddModal(true)}
                className="absolute bottom-6 right-6 w-14 h-14 bg-[#4ea4f6] hover:bg-[#3d93e5]
                           rounded-full shadow-lg flex items-center justify-center text-white
                           text-2xl transition-transform hover:scale-105 active:scale-95 z-10"
                title="New Chat"
            >
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                    />
                </svg>
            </button>

            <AddChatModal
                open={showAddModal}
                onClose={() => setShowAddModal(false)}
                onAdd={handleAddChat}
            />

            {/* Context menu */}
            {contextMenu && (
                <ChatListContextMenu
                    chatId={contextMenu.chatId}
                    position={contextMenu.position}
                    onOpen={handleOpenChat}
                    onSettings={handleChatSettings}
                    onDelete={handleDeleteChat}
                    onClose={() => setContextMenu(null)}
                />
            )}
        </div>
    );
}
