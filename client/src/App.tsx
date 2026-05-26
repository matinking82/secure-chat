import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Navigate, Routes, Route, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import Sidebar from "./components/Sidebar/Sidebar";
import ChatView from "./components/Chat/ChatView";
import GlobalAudioPlayer from "./components/Chat/GlobalAudioPlayer";
import SettingsView from "./components/Settings/SettingsView";
import ChatSettings from "./components/Settings/ChatSettings";
import Toast from "./components/ui/Toast";
import NamePromptModal from "./components/ui/NamePromptModal";
import FirstRunGuideModal from "./components/ui/FirstRunGuideModal";
import { useUser } from "./contexts/UserContext";
import { buildAppearanceStyle } from "./lib/appearance";
import {
    isPushSupported,
    requestNotificationPermission,
    subscribeAllChats,
} from "./lib/push";
import {
    generatePvChatKey,
    getSavedChats,
    getPvChatKey,
    setPvChatKey,
    setEncryptionKey,
} from "./lib/storage";
import { useChat } from "./contexts/ChatContext";
import { fetchChatInvite } from "./lib/api";
import { decryptText } from "./lib/crypto";

const FIRST_RUN_GUIDE_SEEN_KEY = "sc_first_run_guide_seen";
const ANONYMOUS_DISPLAY_NAME = "Anonymous";
const MAX_PV_NAME_LENGTH = 40;

function normalizePvName(raw: string | null): string {
    if (!raw) return "";
    return raw
        .replace(/[^\p{L}\p{N}\p{M}\s._-]/gu, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_PV_NAME_LENGTH);
}

/** Wrapper that keys ChatView by chatId so React fully remounts on chat switch */
function ChatViewKeyed() {
    const { chatId } = useParams<{ chatId: string }>();
    if (!chatId) return <Navigate to="/" replace />;
    const joined = getSavedChats().some((chat) => chat.chatId === chatId);
    if (!joined) return <Navigate to="/" replace />;
    return <ChatView key={chatId} />;
}

function PvRouteHandler() {
    const { browserId } = useParams<{ browserId?: string }>();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { addChat } = useChat();
    const { settings } = useUser();
    const handledRef = useRef(false);

    useEffect(() => {
        if (handledRef.current) return;
        if (!browserId) {
            handledRef.current = true;
            navigate("/", { replace: true });
            return;
        }
        const firstRunGuideSeen = Boolean(localStorage.getItem(FIRST_RUN_GUIDE_SEEN_KEY));
        const hasDisplayName =
            settings.displayName.trim() !== "" && settings.displayName !== ANONYMOUS_DISPLAY_NAME;
        if (!firstRunGuideSeen || !hasDisplayName) {
            return;
        }

        const existing = getPvChatKey(browserId);
        const pvChatId = existing?.chatKey || generatePvChatKey();
        if (!existing) {
            setPvChatKey(browserId, pvChatId, false);
        }

        const requestedName = normalizePvName(searchParams.get("name"));
        handledRef.current = true;
        addChat(pvChatId, `PV: ${requestedName || browserId}`);
        navigate(`/chat/${pvChatId}`, { replace: true });
    }, [addChat, browserId, navigate, searchParams, settings.displayName]);

    return null;
}

function JoinInviteRouteHandler() {
    const { id } = useParams<{ id?: string }>();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { addChat } = useChat();
    const handledRef = useRef(false);

    useEffect(() => {
        const notifyInvalidInvite = () => {
            window.dispatchEvent(
                new CustomEvent("sc-system-toast", {
                    detail: { id: Date.now(), chatId: "", name: "System", preview: "Invalid or expired invite link." },
                })
            );
        };
        if (handledRef.current) return;
        const inviteId = id?.trim();
        const inviteKey = searchParams.get("key") || "";
        if (!inviteId || !inviteKey) {
            handledRef.current = true;
            notifyInvalidInvite();
            navigate("/", { replace: true });
            return;
        }

        handledRef.current = true;
        const run = async () => {
            try {
                const invite = await fetchChatInvite(inviteId);
                const decrypted = await decryptText(invite.data, inviteKey, "invite-link");
                if (decrypted.failed) {
                    notifyInvalidInvite();
                    navigate("/", { replace: true });
                    return;
                }
                const parsed = JSON.parse(decrypted.text) as {
                    chatKey?: string;
                    encryptionKey?: string;
                };
                if (!parsed.chatKey || !parsed.encryptionKey) {
                    notifyInvalidInvite();
                    navigate("/", { replace: true });
                    return;
                }
                setEncryptionKey(parsed.chatKey, parsed.encryptionKey);
                addChat(parsed.chatKey);
                navigate(`/chat/${parsed.chatKey}`, { replace: true });
            } catch {
                notifyInvalidInvite();
                navigate("/", { replace: true });
            }
        };
        void run();
    }, [addChat, id, navigate, searchParams]);

    return null;
}

export default function App() {
    const location = useLocation();
    const { settings, updateSettings } = useUser();
    const appearance = settings.appearance;
    const [showFirstRunGuide, setShowFirstRunGuide] = useState(() => {
        return !localStorage.getItem(FIRST_RUN_GUIDE_SEEN_KEY);
    });

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
                        w-full lg:w-[320px] xl:w-[360px] lg:flex-shrink-0 h-full relative
                        ${isInSubpage ? "hidden lg:flex" : "flex"}
                        flex-col
                    `}
                >
                    <Sidebar />
                </div>

                {/* Main content area */}
                <div
                    className={`
                        flex-1 h-full min-h-0 min-w-0 w-full lg:w-auto
                        ${isInSubpage ? "flex" : "hidden lg:flex"}
                        flex-col
                    `}
                >
                    <div className="flex-1 min-h-0">
                        <Routes>
                            <Route path="/chat/:chatId" element={<ChatViewKeyed />} />
                            <Route path="/join/:id" element={<JoinInviteRouteHandler />} />
                            <Route path="/pv" element={<PvRouteHandler />} />
                            <Route path="/pv/:browserId" element={<PvRouteHandler />} />
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

            <FirstRunGuideModal
                open={showFirstRunGuide && settings.displayName === ANONYMOUS_DISPLAY_NAME}
                onUnderstand={() => {
                    localStorage.setItem(FIRST_RUN_GUIDE_SEEN_KEY, "1");
                    setShowFirstRunGuide(false);
                }}
            />

            {/* Name prompt on first visit */}
            <NamePromptModal enabled={!showFirstRunGuide} />
        </div>
    );
}
