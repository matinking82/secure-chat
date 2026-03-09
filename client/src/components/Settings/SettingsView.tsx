import { useState, useEffect, useRef, useMemo, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "../../contexts/UserContext";
import { getCacheStats, clearFileCache } from "../../lib/fileCache";
import { getPublicKey, exportAllData, importAllData } from "../../lib/storage";
import {
    isPushSupported,
    getNotificationPermission,
    requestNotificationPermission,
    subscribeAllChats,
    unsubscribeAllChats,
} from "../../lib/push";
import {
    ACCENT_SWATCHES,
    BUBBLE_STYLE_OPTIONS,
    DEFAULT_APPEARANCE_SETTINGS,
    DENSITY_OPTIONS,
    EFFECT_PRESET_LIST,
    THEME_PRESET_LIST,
    WALLPAPER_PRESET_LIST,
    buildAppearanceStyle,
    compressImageFileToDataUrl,
} from "../../lib/appearance";
import type { AppearanceSettings } from "../../types";
import AppleEmoji from "../ui/AppleEmoji";

interface ChoiceCardProps {
    active: boolean;
    onClick: () => void;
    preview: string;
    title: string;
    description: string;
    className?: string;
}

function ChoiceCard({ active, onClick, preview, title, description, className = "" }: ChoiceCardProps) {
    return (
        <button
            onClick={onClick}
            className={`sc-theme-card text-left rounded-xl border p-3 transition ${
                active
                    ? "border-[#4ea4f6] bg-[#4ea4f6]/10"
                    : "border-[#2b5278]/30 bg-[#0e1621] hover:bg-[#1e2c3a]"
            } ${className}`}
        >
            <div
                className="h-20 rounded-lg border border-white/10 mb-3"
                style={{ background: preview }}
            />
            <div className="text-white font-medium text-sm">{title}</div>
            <div className="text-gray-400 text-xs mt-1 leading-relaxed">{description}</div>
        </button>
    );
}

function ToggleRow({
    title,
    description,
    enabled,
    onToggle,
}: {
    title: string;
    description: string;
    enabled: boolean;
    onToggle: () => void;
}) {
    return (
        <div className="flex items-center justify-between gap-4">
            <div>
                <div className="text-white text-sm font-medium">{title}</div>
                <div className="text-gray-500 text-xs mt-0.5">{description}</div>
            </div>
            <button
                onClick={onToggle}
                className={`relative w-12 h-7 rounded-full transition-colors ${
                    enabled ? "bg-[#4ea4f6]" : "bg-[#2b5278]"
                }`}
                title={title}
            >
                <div
                    className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-transform ${
                        enabled ? "translate-x-5" : "translate-x-0.5"
                    }`}
                />
            </button>
        </div>
    );
}

export default function SettingsView() {
    const navigate = useNavigate();
    const { settings, updateSettings } = useUser();
    const appearance = settings.appearance;

    const [name, setName] = useState(settings.displayName);
    const [saved, setSaved] = useState(false);
    const [cacheSize, setCacheSize] = useState(0);
    const [cacheCount, setCacheCount] = useState(0);
    const [clearing, setClearing] = useState(false);
    const [importStatus, setImportStatus] = useState<"" | "success" | "error">("");
    const [wallpaperStatus, setWallpaperStatus] = useState<"" | "success" | "error">("");
    const [wallpaperBusy, setWallpaperBusy] = useState(false);
    const [showRevertConfirm, setShowRevertConfirm] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const wallpaperInputRef = useRef<HTMLInputElement>(null);

    const previewStyle = useMemo(
        () => buildAppearanceStyle(appearance) as CSSProperties,
        [appearance]
    );

    useEffect(() => {
        setName(settings.displayName);
    }, [settings.displayName]);

    useEffect(() => {
        getCacheStats().then(({ size, count }) => {
            setCacheSize(size);
            setCacheCount(count);
        });
    }, []);

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
    };

    const handleClearCache = async () => {
        setClearing(true);
        await clearFileCache();
        setCacheSize(0);
        setCacheCount(0);
        setClearing(false);
    };

    const handleSave = () => {
        updateSettings({ displayName: name.trim() || "Anonymous" });
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
    };

    const handleExport = () => {
        const data = exportAllData();
        const blob = new Blob([data], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `securechat-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            try {
                const text = reader.result as string;
                importAllData(text);
                setImportStatus("success");
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            } catch (err) {
                console.error("Failed to import data:", err);
                setImportStatus("error");
                setTimeout(() => setImportStatus(""), 3000);
            }
        };
        reader.readAsText(file);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const updateAppearance = (updates: Partial<AppearanceSettings>) => {
        updateSettings({
            appearance: {
                ...appearance,
                ...updates,
            },
        });
    };

    const handleWallpaperUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) {
            setWallpaperStatus("error");
            setTimeout(() => setWallpaperStatus(""), 2500);
            return;
        }

        setWallpaperBusy(true);
        try {
            const dataUrl = await compressImageFileToDataUrl(file);
            updateAppearance({
                customBackgroundImage: dataUrl,
                useCustomBackground: true,
            });
            setWallpaperStatus("success");
            setTimeout(() => setWallpaperStatus(""), 2500);
        } catch (err) {
            console.error("Failed to process wallpaper:", err);
            setWallpaperStatus("error");
            setTimeout(() => setWallpaperStatus(""), 2500);
        } finally {
            setWallpaperBusy(false);
            if (wallpaperInputRef.current) wallpaperInputRef.current.value = "";
        }
    };

    return (
        <div className="flex flex-col h-full min-h-0 bg-[#0e1621]">
            <div className="flex items-center gap-3 px-4 py-3 bg-[#17212b] border-b border-[#0e1621] shrink-0">
                <button
                    onClick={() => navigate("/")}
                    className="p-1 text-gray-400 hover:text-white transition"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                </button>
                <h1 className="text-lg font-semibold text-white">Settings</h1>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                <div className="sc-settings-card bg-[#17212b] rounded-xl p-5 space-y-4">
                    <h2 className="text-white font-medium text-sm uppercase tracking-wider text-[#4ea4f6]">
                        Profile
                    </h2>

                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-full bg-[#4ea4f6] flex items-center justify-center text-white text-2xl font-bold">
                            {(name || "A").charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <div className="text-white font-medium">{name || "Anonymous"}</div>
                            <div className="text-xs text-gray-500 mt-0.5">ID: {settings.browserId.slice(0, 8)}...</div>
                        </div>
                    </div>

                    <div>
                        <label className="text-gray-400 text-sm block mb-1.5">Display Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Enter your name..."
                            className="w-full bg-[#0e1621] text-white border border-[#2b5278]/50 rounded-lg
                                       px-4 py-3 focus:outline-none focus:border-[#4ea4f6] transition
                                       placeholder-gray-500"
                        />
                    </div>

                    <button
                        onClick={handleSave}
                        className={`w-full font-medium py-3 rounded-lg transition ${
                            saved ? "bg-green-600 text-white" : "bg-[#4ea4f6] hover:bg-[#3d93e5] text-white"
                        }`}
                    >
                        {saved ? "✓ Saved" : "Save Changes"}
                    </button>
                </div>

                {/* Notifications */}
                {isPushSupported() && (
                    <div className="sc-settings-card bg-[#17212b] rounded-xl p-5 space-y-4">
                        <h2 className="text-sm uppercase tracking-wider text-[#4ea4f6] font-medium">
                            Notifications
                        </h2>
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-white text-sm font-medium">Push Notifications</div>
                                <div className="text-gray-500 text-xs mt-0.5">
                                    {settings.pushEnabled
                                        ? getNotificationPermission() === "granted"
                                            ? "You will receive push notifications"
                                            : "Enabled but browser permission blocked"
                                        : "Push notifications are disabled"}
                                </div>
                            </div>
                            <button
                                onClick={async () => {
                                    if (settings.pushEnabled) {
                                        // Turning OFF
                                        await unsubscribeAllChats();
                                        updateSettings({ pushEnabled: false });
                                    } else {
                                        // Turning ON — request permission if needed
                                        const permission = await requestNotificationPermission();
                                        if (permission === "granted") {
                                            updateSettings({ pushEnabled: true });
                                            await subscribeAllChats(settings.browserId);
                                        } else if (permission === "denied") {
                                            alert("Notifications are blocked by your browser. Please enable them in your browser settings.");
                                        }
                                    }
                                }}
                                className={`relative w-12 h-7 rounded-full transition-colors ${
                                    settings.pushEnabled && getNotificationPermission() === "granted"
                                        ? "bg-[#4ea4f6]"
                                        : "bg-[#2b5278]"
                                }`}
                            >
                                <div
                                    className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-transform ${
                                        settings.pushEnabled && getNotificationPermission() === "granted"
                                            ? "translate-x-5"
                                            : "translate-x-0.5"
                                    }`}
                                />
                            </button>
                        </div>
                        {getNotificationPermission() === "denied" && (
                            <div className="text-xs text-red-400 flex items-center gap-1.5">
                                <AppleEmoji native="⚠️" size={14} />
                                Browser has blocked notifications. Allow them in your browser/OS settings to receive push notifications.
                            </div>
                        )}
                    </div>
                )}

                <div className="sc-settings-card bg-[#17212b] rounded-xl p-5 space-y-5">
                    <div>
                        <h2 className="text-sm uppercase tracking-wider text-[#4ea4f6] font-medium">Appearance</h2>
                        <p className="text-gray-400 text-sm mt-2">
                            Tune the app like a modern customizable messenger: theme, accent, wallpaper,
                            motion, bubble feel, and layout density. Changes apply instantly and are saved in backups.
                        </p>
                    </div>

                    <div
                        className={`sc-app-shell sc-preview-surface sc-themed sc-density-${appearance.interfaceDensity} sc-bubbles-${appearance.bubbleStyle} ${
                            appearance.uiEffects ? "sc-effects-on" : "sc-effects-off"
                        } ${appearance.backgroundMotion ? "sc-motion-on" : "sc-motion-off"} ${
                            appearance.sidebarTranslucent ? "sc-panels-glass" : "sc-panels-solid"
                        } rounded-2xl overflow-hidden border border-[#2b5278]/30`}
                        style={previewStyle}
                    >
                        <div className="sc-chat-wallpaper h-52 px-4 py-3 flex flex-col justify-between">
                            <div className="flex items-center justify-between text-xs text-gray-400 relative z-10">
                                <span>Live preview</span>
                                <span>{appearance.useCustomBackground ? "Local wallpaper" : "Built-in wallpaper"}</span>
                            </div>
                            <div className="relative z-10 space-y-2">
                                <div className="sc-message-bubble bg-[#182533] rounded-2xl rounded-bl-md px-3.5 py-2 max-w-[75%]">
                                    <div className="text-[11px] text-gray-400 mb-1">Friend</div>
                                    <div className="text-sm text-white">Themes and wallpapers update instantly.</div>
                                </div>
                                <div className="flex justify-end">
                                    <div data-own="true" className="sc-message-bubble bg-[#2b5278] rounded-2xl rounded-br-md px-3.5 py-2 max-w-[70%] text-sm text-white">
                                        Looks good ✨
                                    </div>
                                </div>
                            </div>
                            <div className="relative z-10 rounded-2xl bg-[#17212b] border border-[#0e1621] px-4 py-3 flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-[#4ea4f6]" />
                                <span className="text-sm text-gray-400">Message input preview</span>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="text-white text-sm font-medium">Theme palette</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {THEME_PRESET_LIST.map((theme) => (
                                <ChoiceCard
                                    key={theme.id}
                                    active={appearance.themePreset === theme.id}
                                    onClick={() =>
                                        updateAppearance({
                                            themePreset: theme.id,
                                            accentColor: appearance.accentColor || theme.colors.accent,
                                        })
                                    }
                                    preview={theme.preview}
                                    title={theme.label}
                                    description={theme.description}
                                />
                            ))}
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <div className="text-white text-sm font-medium">Accent color</div>
                                <div className="text-gray-500 text-xs mt-0.5">Used for highlights, badges, links, and active states.</div>
                            </div>
                            <label className="flex items-center gap-2 text-xs text-gray-400">
                                Custom
                                <input
                                    type="color"
                                    value={appearance.accentColor}
                                    onChange={(e) => updateAppearance({ accentColor: e.target.value })}
                                    className="w-9 h-9 rounded-lg bg-transparent border-0 cursor-pointer"
                                />
                            </label>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {ACCENT_SWATCHES.map((swatch) => (
                                <button
                                    key={swatch}
                                    onClick={() => updateAppearance({ accentColor: swatch })}
                                    className={`w-10 h-10 rounded-full border-2 transition ${
                                        appearance.accentColor.toLowerCase() === swatch.toLowerCase()
                                            ? "border-white scale-105"
                                            : "border-white/15 hover:border-white/40"
                                    }`}
                                    style={{ backgroundColor: swatch }}
                                    title={swatch}
                                />
                            ))}
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="text-white text-sm font-medium">Chat wallpaper</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {WALLPAPER_PRESET_LIST.map((wallpaper) => (
                                <ChoiceCard
                                    key={wallpaper.id}
                                    active={!appearance.useCustomBackground && appearance.chatBackgroundPreset === wallpaper.id}
                                    onClick={() =>
                                        updateAppearance({
                                            chatBackgroundPreset: wallpaper.id,
                                            useCustomBackground: false,
                                        })
                                    }
                                    preview={wallpaper.preview}
                                    title={wallpaper.label}
                                    description={wallpaper.description}
                                    className="sc-wallpaper-card"
                                />
                            ))}
                        </div>

                        <div className="rounded-xl border border-[#2b5278]/30 bg-[#0e1621] p-4 space-y-3">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="text-white text-sm font-medium">Use a photo from your phone</div>
                                    <div className="text-gray-500 text-xs mt-0.5">
                                        The image stays only on this device and inside exported backups.
                                    </div>
                                </div>
                                {appearance.customBackgroundImage && (
                                    <button
                                        onClick={() => updateAppearance({ useCustomBackground: !appearance.useCustomBackground })}
                                        className={`px-3 py-2 text-xs font-medium rounded-lg transition ${
                                            appearance.useCustomBackground
                                                ? "bg-[#4ea4f6]/20 text-[#4ea4f6]"
                                                : "bg-[#2b5278]/30 text-gray-300 hover:bg-[#2b5278]/50"
                                        }`}
                                    >
                                        {appearance.useCustomBackground ? "Using photo" : "Use saved photo"}
                                    </button>
                                )}
                            </div>

                            <div className="flex flex-col sm:flex-row gap-3">
                                <button
                                    onClick={() => wallpaperInputRef.current?.click()}
                                    disabled={wallpaperBusy}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium rounded-lg bg-[#4ea4f6]/20 text-[#4ea4f6] hover:bg-[#4ea4f6]/30 transition disabled:opacity-60"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15l4-4a3 3 0 014.243 0L16 15m-2-2l1-1a3 3 0 014.243 0L21 13m-9 8h.01M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                    </svg>
                                    {wallpaperBusy ? "Processing..." : "Choose local wallpaper"}
                                </button>
                                <button
                                    onClick={() => updateAppearance({ customBackgroundImage: "", useCustomBackground: false })}
                                    disabled={!appearance.customBackgroundImage}
                                    className={`flex-1 px-4 py-3 text-sm font-medium rounded-lg transition ${
                                        appearance.customBackgroundImage
                                            ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                                            : "bg-[#17212b] text-gray-500 cursor-not-allowed"
                                    }`}
                                >
                                    Remove saved photo
                                </button>
                            </div>

                            <input
                                ref={wallpaperInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleWallpaperUpload}
                            />

                            {wallpaperStatus === "success" && (
                                <div className="text-green-400 text-sm flex items-center gap-1.5">
                                    <AppleEmoji native="🖼️" size={14} />
                                    Wallpaper saved locally.
                                </div>
                            )}
                            {wallpaperStatus === "error" && (
                                <div className="text-red-400 text-sm flex items-center gap-1.5">
                                    <AppleEmoji native="⚠️" size={14} />
                                    Could not process that image. Try another photo.
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="text-white text-sm font-medium">Overlay effects</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {EFFECT_PRESET_LIST.map((effect) => (
                                <ChoiceCard
                                    key={effect.id}
                                    active={appearance.backgroundEffect === effect.id}
                                    onClick={() => updateAppearance({ backgroundEffect: effect.id })}
                                    preview={`${appearance.useCustomBackground && appearance.customBackgroundImage ? `url("${appearance.customBackgroundImage}") center / cover no-repeat, ` : ""}${effect.preview === "none" ? "linear-gradient(135deg, #0e1621 0%, #17212b 100%)" : effect.preview}`}
                                    title={effect.label}
                                    description={effect.description}
                                    className="sc-effect-card"
                                />
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="rounded-xl border border-[#2b5278]/30 bg-[#0e1621] p-4 space-y-3">
                            <div className="flex items-center justify-between gap-4">
                                <label className="text-white text-sm font-medium">Wallpaper dim</label>
                                <span className="text-xs text-gray-400">{appearance.backgroundDim}%</span>
                            </div>
                            <input
                                type="range"
                                min={0}
                                max={70}
                                value={appearance.backgroundDim}
                                onChange={(e) => updateAppearance({ backgroundDim: Number(e.target.value) })}
                                className="w-full accent-[#4ea4f6]"
                            />
                            <div className="text-xs text-gray-500">Darkens bright wallpapers so messages stay readable.</div>
                        </div>

                        <div className="rounded-xl border border-[#2b5278]/30 bg-[#0e1621] p-4 space-y-3">
                            <div className="flex items-center justify-between gap-4">
                                <label className="text-white text-sm font-medium">Wallpaper blur</label>
                                <span className="text-xs text-gray-400">{appearance.backgroundBlur}px</span>
                            </div>
                            <input
                                type="range"
                                min={0}
                                max={24}
                                value={appearance.backgroundBlur}
                                onChange={(e) => updateAppearance({ backgroundBlur: Number(e.target.value) })}
                                className="w-full accent-[#4ea4f6]"
                            />
                            <div className="text-xs text-gray-500">Useful for busy photos from your gallery.</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="rounded-xl border border-[#2b5278]/30 bg-[#0e1621] p-4 space-y-3">
                            <div className="text-white text-sm font-medium">Message bubble style</div>
                            <div className="space-y-2">
                                {BUBBLE_STYLE_OPTIONS.map((option) => (
                                    <button
                                        key={option.id}
                                        onClick={() => updateAppearance({ bubbleStyle: option.id })}
                                        className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                                            appearance.bubbleStyle === option.id
                                                ? "border-[#4ea4f6] bg-[#4ea4f6]/10"
                                                : "border-[#2b5278]/30 bg-[#17212b] hover:bg-[#1e2c3a]"
                                        }`}
                                    >
                                        <div className="text-white text-sm font-medium">{option.label}</div>
                                        <div className="text-gray-500 text-xs mt-1">{option.description}</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="rounded-xl border border-[#2b5278]/30 bg-[#0e1621] p-4 space-y-3">
                            <div className="text-white text-sm font-medium">Layout density</div>
                            <div className="space-y-2">
                                {DENSITY_OPTIONS.map((option) => (
                                    <button
                                        key={option.id}
                                        onClick={() => updateAppearance({ interfaceDensity: option.id })}
                                        className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                                            appearance.interfaceDensity === option.id
                                                ? "border-[#4ea4f6] bg-[#4ea4f6]/10"
                                                : "border-[#2b5278]/30 bg-[#17212b] hover:bg-[#1e2c3a]"
                                        }`}
                                    >
                                        <div className="text-white text-sm font-medium">{option.label}</div>
                                        <div className="text-gray-500 text-xs mt-1">{option.description}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="rounded-xl border border-[#2b5278]/30 bg-[#0e1621] p-4 space-y-4">
                        <ToggleRow
                            title="Animated wallpaper motion"
                            description="Subtle movement for built-in and custom wallpapers."
                            enabled={appearance.backgroundMotion}
                            onToggle={() => updateAppearance({ backgroundMotion: !appearance.backgroundMotion })}
                        />
                        <ToggleRow
                            title="Enhanced UI effects"
                            description="Adds richer glow, shadow, and overlay depth across the app."
                            enabled={appearance.uiEffects}
                            onToggle={() => updateAppearance({ uiEffects: !appearance.uiEffects })}
                        />
                        <ToggleRow
                            title="Translucent panels"
                            description="Give sidebars, cards, and sheets a glass-like messenger feel."
                            enabled={appearance.sidebarTranslucent}
                            onToggle={() => updateAppearance({ sidebarTranslucent: !appearance.sidebarTranslucent })}
                        />
                    </div>

                    {/* Revert to Default */}
                    <div className="pt-2">
                        <button
                            onClick={() => setShowRevertConfirm(true)}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium
                                       rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition border border-red-500/20"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Revert to Default
                        </button>
                    </div>

                    {/* Revert confirmation modal */}
                    {showRevertConfirm && (
                        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
                             onClick={() => setShowRevertConfirm(false)}>
                            <div className="rounded-2xl border border-white/10 p-6 w-full max-w-sm mx-4 space-y-4 shadow-2xl"
                                 style={{ backgroundColor: 'var(--sc-surface-1, #17212b)' }}
                                 onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
                                        <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                        </svg>
                                    </div>
                                    <div>
                                        <h3 className="text-white font-medium">Revert to Default</h3>
                                        <p className="text-gray-400 text-sm mt-1">
                                            This will reset all appearance settings (theme, accent color, wallpaper, effects, and layout) to their defaults. This action cannot be undone.
                                        </p>
                                    </div>
                                </div>
                                <div className="flex gap-3 pt-2">
                                    <button
                                        onClick={() => setShowRevertConfirm(false)}
                                        className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg
                                                   text-gray-300 hover:bg-white/10 transition border border-white/10"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => {
                                            updateSettings({ appearance: { ...DEFAULT_APPEARANCE_SETTINGS } });
                                            setShowRevertConfirm(false);
                                        }}
                                        className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg
                                                   bg-red-500 text-white hover:bg-red-600 transition"
                                    >
                                        Revert
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="sc-settings-card bg-[#17212b] rounded-xl p-5 space-y-3">
                    <h2 className="text-sm uppercase tracking-wider text-[#4ea4f6] font-medium">About</h2>
                    <div className="text-gray-400 text-sm space-y-2">
                        <p>
                            <span className="text-gray-300 font-medium">SecureChat</span> — End-to-end encrypted messaging.
                        </p>
                        <p>
                            Messages are encrypted in your browser using AES-256-GCM before being sent.
                            The server never sees your plaintext messages or encryption keys.
                        </p>
                        <p>
                            Files are also encrypted before upload. Share the same encryption key
                            with your chat partners to communicate securely.
                        </p>
                    </div>
                </div>

                <div className="sc-settings-card bg-[#17212b] rounded-xl p-5 space-y-3">
                    <h2 className="text-sm uppercase tracking-wider text-[#4ea4f6] font-medium">Your Identity</h2>
                    <p className="text-gray-400 text-sm">
                        Your identity is secured by a cryptographic key pair generated in your browser.
                        The public key identifies you to others. The private key never leaves your device.
                    </p>
                    <div className="space-y-2">
                        <div>
                            <span className="text-gray-500 text-xs">Browser ID (Public Key Fingerprint)</span>
                            <code className="text-xs text-gray-400 bg-[#0e1621] p-2 rounded block break-all mt-0.5">
                                {settings.browserId}
                            </code>
                        </div>
                        {getPublicKey() && (
                            <div>
                                <span className="text-gray-500 text-xs">Public Key</span>
                                <code className="text-[10px] text-gray-500 bg-[#0e1621] p-2 rounded block break-all mt-0.5 max-h-16 overflow-y-auto">
                                    {getPublicKey()}
                                </code>
                            </div>
                        )}
                    </div>
                    <div className="text-xs text-gray-500 flex items-center gap-1.5">
                        <AppleEmoji native="🔒" size={14} />
                        Private key is stored only in your browser
                    </div>
                </div>

                <div className="sc-settings-card bg-[#17212b] rounded-xl p-5 space-y-4">
                    <h2 className="text-sm uppercase tracking-wider text-[#4ea4f6] font-medium">Storage</h2>
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-white text-sm font-medium">File Cache</div>
                            <div className="text-gray-500 text-xs mt-0.5">
                                {cacheCount} {cacheCount === 1 ? "file" : "files"} · {formatBytes(cacheSize)}
                            </div>
                        </div>
                        <button
                            onClick={handleClearCache}
                            disabled={clearing || cacheCount === 0}
                            className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
                                clearing
                                    ? "bg-gray-600 text-gray-300 cursor-not-allowed"
                                    : cacheCount === 0
                                      ? "bg-[#0e1621] text-gray-500 cursor-not-allowed"
                                      : "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                            }`}
                        >
                            {clearing ? "Clearing..." : "Clear Cache"}
                        </button>
                    </div>
                    <p className="text-gray-500 text-xs">
                        Downloaded media files are cached locally to avoid re-downloading.
                        Clearing the cache will require files to be downloaded again.
                    </p>
                </div>

                <div className="sc-settings-card bg-[#17212b] rounded-xl p-5 space-y-4">
                    <h2 className="text-sm uppercase tracking-wider text-[#4ea4f6] font-medium">Data Backup</h2>
                    <p className="text-gray-400 text-sm">
                        Export all your SecureChat data (identity keys, chats, encryption keys, profile settings,
                        appearance customization, local wallpaper, and emoji history) to a file. Import it on another
                        browser or device to restore your setup.
                    </p>

                    <div className="flex flex-col gap-3 sm:flex-row">
                        <button
                            onClick={handleExport}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium
                                       rounded-lg bg-[#4ea4f6]/20 text-[#4ea4f6] hover:bg-[#4ea4f6]/30 transition"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Export Data
                        </button>

                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium
                                       rounded-lg bg-[#2b5278]/30 text-gray-300 hover:bg-[#2b5278]/50 transition"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                            </svg>
                            Import Data
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json"
                            className="hidden"
                            onChange={handleImport}
                        />
                    </div>

                    {importStatus === "success" && (
                        <div className="text-green-400 text-sm flex items-center gap-1.5">
                            <AppleEmoji native="✅" size={14} />
                            Data imported successfully! Reloading...
                        </div>
                    )}
                    {importStatus === "error" && (
                        <div className="text-red-400 text-sm flex items-center gap-1.5">
                            <AppleEmoji native="❌" size={14} />
                            Failed to import data. Please check the file format.
                        </div>
                    )}

                    <div className="text-xs text-gray-500 flex items-center gap-1.5">
                        <AppleEmoji native="⚠️" size={14} />
                        Importing data will overwrite your current settings and reload the app.
                    </div>
                </div>
            </div>
        </div>
    );
}
