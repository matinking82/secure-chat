// ─── Message from server ───
export interface ChatMessage {
    id: number;
    text: string;
    rawText?: string;
    name: string;
    browserId: string;
    createdAt: string;
    file?: string;
    fileType?: string;
    originalName?: string;
    fileSize?: number;
    mediaDurationSec?: number;
    replyToId?: number;
    edited?: boolean;
    reactions?: { [emoji: string]: string[] };
    seenBy?: string[];
    tags?: { browserId: string; name: string }[];
    localStatus?: "pending" | "failed";
    localOnly?: boolean;
}

export interface ForwardMessagePayload {
    id: number;
    sourceChatId: string;
    text: string;
    name: string;
    file?: string;
    fileType?: string;
    originalName?: string;
    fileSize?: number;
    mediaDurationSec?: number;
}

// ─── Saved chat in localStorage ───
export interface SavedChat {
    chatId: string;
    label?: string;
    lastMessage?: string;
    lastMessageTime?: string;
    lastOpenedAt?: string;
    unreadCount: number;
    hasMention?: boolean;
    muted?: boolean;
    pinned?: boolean;
}

// ─── API response for messages ───
export interface MessagesResponse {
    success: boolean;
    messages: ChatMessage[];
    total: number;
    hasMore: boolean;
}

export interface BatchLastMessagesResponse {
    success: boolean;
    chats: {
        [chatId: string]: {
            message: ChatMessage | null;
            unreadSinceLastOpenedCount: number;
        };
    };
}

// ─── User settings ───
export type AppearanceThemePresetId =
    | "default"
    | "midnight"
    | "aurora"
    | "dusk"
    | "forest"
    | "mono";

export type ChatBackgroundPresetId =
    | "default"
    | "aurora"
    | "dusk"
    | "ocean"
    | "grid"
    | "paper"
    | "stars";

export type BackgroundEffectPresetId =
    | "none"
    | "glow"
    | "grain"
    | "prism"
    | "stars";

export type DensityMode = "comfortable" | "compact";
export type BubbleStyleId = "default" | "soft" | "glass";

export interface AppearanceSettings {
    themePreset: AppearanceThemePresetId;
    accentColor: string;
    chatBackgroundPreset: ChatBackgroundPresetId;
    backgroundEffect: BackgroundEffectPresetId;
    customBackgroundImage: string;
    useCustomBackground: boolean;
    backgroundDim: number;
    backgroundBlur: number;
    backgroundMotion: boolean;
    interfaceDensity: DensityMode;
    bubbleStyle: BubbleStyleId;
    uiEffects: boolean;
    sidebarTranslucent: boolean;
}

export interface UserSettings {
    displayName: string;
    browserId: string;
    pushEnabled: boolean;
    appearance: AppearanceSettings;
}

// ─── Encryption keys per chat ───
export type EncryptionKeys = { [chatId: string]: string };

// ─── Voice chat ───
export interface VoiceParticipant {
    socketId: string;
    browserId: string;
    name: string;
    videoEnabled?: boolean;
}

export interface AdminNotification {
    id: number;
    title: string;
    text: string;
    imageUrl?: string;
    date: string;
    seen: boolean;
}

export interface TelegramBotNotification {
    id: number;
    userId: string;
    name: string;
}
