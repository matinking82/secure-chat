import { useEffect, useMemo, type CSSProperties } from "react";
import { Routes, Route, useLocation, useParams } from "react-router-dom";
import Sidebar from "./components/Sidebar/Sidebar";
import ChatView from "./components/Chat/ChatView";
import GlobalAudioPlayer from "./components/Chat/GlobalAudioPlayer";
import SettingsView from "./components/Settings/SettingsView";
import ChatSettings from "./components/Settings/ChatSettings";
import Toast from "./components/ui/Toast";
import NamePromptModal from "./components/ui/NamePromptModal";
import { useUser } from "./contexts/UserContext";
import { buildAppearanceStyle } from "./lib/appearance";
import {
    isPushSupported,
    requestNotificationPermission,
    subscribeAllChats,
} from "./lib/push";

/** Wrapper that keys ChatView by chatId so React fully remounts on chat switch */
function ChatViewKeyed() {
    const { chatId } = useParams<{ chatId: string }>();
    return <ChatView key={chatId} />;
}

export default function App() {
    const location = useLocation();
    const { settings, updateSettings } = useUser();
    const appearance = settings.appearance;

    const appearanceStyle = useMemo(
        () => buildAppearanceStyle(appearance) as CSSProperties,
        [appearance]
    );

    useEffect(() => {
        const root = document.documentElement;
        const entries = Object.entries(buildAppearanceStyle(appearance));
        entries.forEach(([key, value]) => root.style.setProperty(key, value));
        return () => {
            entries.forEach(([key]) => root.style.removeProperty(key));
        };
    }, [appearance]);

    // First-run: ask for notification permission
    useEffect(() => {
        if (!isPushSupported()) return;
        const prompted = localStorage.getItem("sc_notif_prompted");
        if (prompted) return;

        localStorage.setItem("sc_notif_prompted", "true");

        // Small delay so the app renders first
        const timer = setTimeout(async () => {
            const permission = await requestNotificationPermission();
            if (permission === "granted") {
                updateSettings({ pushEnabled: true });
                await subscribeAllChats(settings.browserId);
            }
        }, 1500);

        return () => clearTimeout(timer);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Determine if we're showing a chat/settings (for mobile layout)
    const isInSubpage =
        location.pathname.startsWith("/chat/") ||
        location.pathname.startsWith("/settings");

    return (
        <div
            className={`sc-app-shell sc-themed sc-density-${appearance.interfaceDensity} sc-bubbles-${appearance.bubbleStyle} ${
                appearance.uiEffects ? "sc-effects-on" : "sc-effects-off"
            } ${appearance.backgroundMotion ? "sc-motion-on" : "sc-motion-off"} ${
                appearance.sidebarTranslucent ? "sc-panels-glass" : "sc-panels-solid"
            } h-dvh w-screen flex flex-col bg-[#0e1621] overflow-hidden`}
            style={appearanceStyle}
        >
            <GlobalAudioPlayer />

            <div className="flex-1 min-h-0 flex overflow-hidden">
                {/* Sidebar: always visible on desktop, hidden on mobile when in a chat */}
                <div
                    className={`
                        w-full md:w-[320px] lg:w-[360px] md:flex-shrink-0 h-full relative
                        ${isInSubpage ? "hidden md:flex" : "flex"}
                        flex-col
                    `}
                >
                    <Sidebar />
                </div>

                {/* Main content area */}
                <div
                    className={`
                        flex-1 h-full min-h-0 min-w-0 w-full md:w-auto
                        ${isInSubpage ? "flex" : "hidden md:flex"}
                        flex-col
                    `}
                >
                    <div className="flex-1 min-h-0">
                        <Routes>
                            <Route path="/chat/:chatId" element={<ChatViewKeyed />} />
                            <Route path="/settings" element={<SettingsView />} />
                            <Route path="/settings/:chatId" element={<ChatSettings />} />
                            <Route
                                path="*"
                                element={
                                    <div className="flex-1 flex items-center justify-center text-gray-600 h-full">
                                        <div className="text-center">
                                            <svg
                                                className="w-24 h-24 mx-auto mb-4 text-gray-700"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={1}
                                                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                                                />
                                            </svg>
                                            <p className="text-xl font-medium text-gray-500">
                                                SecureChat
                                            </p>
                                            <p className="text-sm text-gray-600 mt-2">
                                                Select a chat or create a new one to start messaging
                                            </p>
                                        </div>
                                    </div>
                                }
                            />
                        </Routes>
                    </div>
                </div>
            </div>

            {/* Toast notifications */}
            <Toast />

            {/* Name prompt on first visit */}
            <NamePromptModal />
        </div>
    );
}
