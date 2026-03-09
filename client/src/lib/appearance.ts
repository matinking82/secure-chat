import type {
    AppearanceSettings,
    AppearanceThemePresetId,
    BackgroundEffectPresetId,
    BubbleStyleId,
    ChatBackgroundPresetId,
    DensityMode,
} from "../types";

interface ThemePreset {
    id: AppearanceThemePresetId;
    label: string;
    description: string;
    preview: string;
    colors: {
        base: string;
        surface1: string;
        surface2: string;
        surface3: string;
        border: string;
        borderSoft: string;
        text: string;
        muted: string;
        accent: string;
        messageIn: string;
        messageOut: string;
        appBackdrop: string;
    };
}

interface WallpaperPreset {
    id: ChatBackgroundPresetId;
    label: string;
    description: string;
    preview: string;
    background: string;
}

interface EffectPreset {
    id: BackgroundEffectPresetId;
    label: string;
    description: string;
    preview: string;
    background: string;
}

interface ChoiceOption<T extends string> {
    id: T;
    label: string;
    description: string;
}

export const THEME_PRESETS: Record<AppearanceThemePresetId, ThemePreset> = {
    default: {
        id: "default",
        label: "Classic Night",
        description: "The current SecureChat look with subtle Telegram-inspired depth.",
        preview: "linear-gradient(135deg, #0e1621 0%, #17212b 50%, #203040 100%)",
        colors: {
            base: "#0e1621",
            surface1: "#17212b",
            surface2: "#1e2c3a",
            surface3: "#242f3d",
            border: "#0e1621",
            borderSoft: "rgba(78, 164, 246, 0.18)",
            text: "#ffffff",
            muted: "#93a4b7",
            accent: "#4ea4f6",
            messageIn: "#182533",
            messageOut: "#2b5278",
            appBackdrop: "radial-gradient(circle at top, rgba(78, 164, 246, 0.12), transparent 34%), linear-gradient(180deg, #0e1621 0%, #0b131c 100%)",
        },
    },
    midnight: {
        id: "midnight",
        label: "Midnight Neon",
        description: "Dark OLED surfaces with a brighter electric glow.",
        preview: "linear-gradient(135deg, #06080f 0%, #0c1220 45%, #101b2e 100%)",
        colors: {
            base: "#06080f",
            surface1: "#0c1220",
            surface2: "#121b2c",
            surface3: "#172235",
            border: "#05070c",
            borderSoft: "rgba(108, 92, 231, 0.24)",
            text: "#f8fbff",
            muted: "#9fb0c4",
            accent: "#6c5ce7",
            messageIn: "#10192a",
            messageOut: "#3c3a83",
            appBackdrop: "radial-gradient(circle at top, rgba(108, 92, 231, 0.2), transparent 36%), linear-gradient(180deg, #05070d 0%, #06080f 100%)",
        },
    },
    aurora: {
        id: "aurora",
        label: "Aurora Mist",
        description: "Cool northern gradients with softened glass panels.",
        preview: "linear-gradient(135deg, #0b1720 0%, #132a2b 40%, #183246 100%)",
        colors: {
            base: "#08141b",
            surface1: "#102129",
            surface2: "#16303a",
            surface3: "#1b3944",
            border: "#071218",
            borderSoft: "rgba(65, 223, 214, 0.2)",
            text: "#effcff",
            muted: "#a5c0c3",
            accent: "#41dfd6",
            messageIn: "#13313a",
            messageOut: "#1f616c",
            appBackdrop: "radial-gradient(circle at top, rgba(65, 223, 214, 0.18), transparent 34%), linear-gradient(180deg, #08141b 0%, #091b22 100%)",
        },
    },
    dusk: {
        id: "dusk",
        label: "Rose Dusk",
        description: "Warmer messenger tones with peach and rose accents.",
        preview: "linear-gradient(135deg, #1b1016 0%, #251725 45%, #35212f 100%)",
        colors: {
            base: "#140d12",
            surface1: "#21131d",
            surface2: "#2b1825",
            surface3: "#331f2d",
            border: "#110910",
            borderSoft: "rgba(255, 135, 135, 0.22)",
            text: "#fff5f7",
            muted: "#c4a8b1",
            accent: "#ff8787",
            messageIn: "#281723",
            messageOut: "#7b394b",
            appBackdrop: "radial-gradient(circle at top, rgba(255, 135, 135, 0.16), transparent 35%), linear-gradient(180deg, #140d12 0%, #181018 100%)",
        },
    },
    forest: {
        id: "forest",
        label: "Forest Glass",
        description: "Deep greens with calm earthy message bubbles.",
        preview: "linear-gradient(135deg, #0a1511 0%, #12211a 40%, #1a3025 100%)",
        colors: {
            base: "#09120e",
            surface1: "#0f1d17",
            surface2: "#15261d",
            surface3: "#1b3126",
            border: "#08100c",
            borderSoft: "rgba(93, 214, 135, 0.22)",
            text: "#f5fff8",
            muted: "#a6c0b1",
            accent: "#5dd687",
            messageIn: "#13251c",
            messageOut: "#2f6c49",
            appBackdrop: "radial-gradient(circle at top, rgba(93, 214, 135, 0.16), transparent 34%), linear-gradient(180deg, #09120e 0%, #0b1510 100%)",
        },
    },
    mono: {
        id: "mono",
        label: "Graphite",
        description: "Neutral monochrome for a minimal look.",
        preview: "linear-gradient(135deg, #101113 0%, #181a1f 45%, #20242b 100%)",
        colors: {
            base: "#0d0e11",
            surface1: "#17191d",
            surface2: "#1e2127",
            surface3: "#252931",
            border: "#090a0c",
            borderSoft: "rgba(200, 205, 214, 0.18)",
            text: "#f5f7fa",
            muted: "#aab1bc",
            accent: "#cfd6df",
            messageIn: "#1c2026",
            messageOut: "#4e5968",
            appBackdrop: "radial-gradient(circle at top, rgba(207, 214, 223, 0.12), transparent 32%), linear-gradient(180deg, #0d0e11 0%, #121418 100%)",
        },
    },
};

export const THEME_PRESET_LIST = Object.values(THEME_PRESETS);

export const ACCENT_SWATCHES = [
    "#4ea4f6",
    "#6c5ce7",
    "#7c5cff",
    "#ff8787",
    "#ffad5c",
    "#ffd166",
    "#5dd687",
    "#41dfd6",
    "#58b5ff",
    "#f472b6",
] as const;

export const WALLPAPER_PRESETS: Record<ChatBackgroundPresetId, WallpaperPreset> = {
    default: {
        id: "default",
        label: "Secure Mist",
        description: "Subtle blue haze close to the original chat view.",
        preview: "radial-gradient(circle at 20% 40%, rgba(78,164,246,0.35), transparent 38%), radial-gradient(circle at 80% 35%, rgba(30,44,58,0.55), transparent 32%), linear-gradient(135deg, #0e1621 0%, #132131 100%)",
        background: "radial-gradient(circle at 20% 40%, rgba(78,164,246,0.18), transparent 38%), radial-gradient(circle at 80% 35%, rgba(30,44,58,0.42), transparent 32%), linear-gradient(135deg, #0f1925 0%, #132131 100%)",
    },
    aurora: {
        id: "aurora",
        label: "Aurora Veil",
        description: "Smooth teal and emerald ribbons drifting behind chats.",
        preview: "radial-gradient(circle at 20% 30%, rgba(65,223,214,0.55), transparent 34%), radial-gradient(circle at 75% 25%, rgba(93,214,135,0.5), transparent 36%), linear-gradient(135deg, #071218 0%, #10222a 100%)",
        background: "radial-gradient(circle at 20% 30%, rgba(65,223,214,0.32), transparent 34%), radial-gradient(circle at 75% 25%, rgba(93,214,135,0.28), transparent 36%), linear-gradient(135deg, #071218 0%, #10222a 100%)",
    },
    dusk: {
        id: "dusk",
        label: "Dusk Bloom",
        description: "Peach and magenta clouds with a cinematic fade.",
        preview: "radial-gradient(circle at 15% 30%, rgba(255,180,120,0.55), transparent 34%), radial-gradient(circle at 85% 25%, rgba(244,114,182,0.5), transparent 32%), linear-gradient(135deg, #160d16 0%, #261622 100%)",
        background: "radial-gradient(circle at 15% 30%, rgba(255,180,120,0.3), transparent 34%), radial-gradient(circle at 85% 25%, rgba(244,114,182,0.26), transparent 32%), linear-gradient(135deg, #160d16 0%, #261622 100%)",
    },
    ocean: {
        id: "ocean",
        label: "Ocean Room",
        description: "Deep blue glass with long soft gradients.",
        preview: "radial-gradient(circle at 15% 15%, rgba(88,181,255,0.5), transparent 28%), radial-gradient(circle at 85% 20%, rgba(78,164,246,0.4), transparent 28%), linear-gradient(160deg, #08131f 0%, #10263c 100%)",
        background: "radial-gradient(circle at 15% 15%, rgba(88,181,255,0.24), transparent 28%), radial-gradient(circle at 85% 20%, rgba(78,164,246,0.22), transparent 28%), linear-gradient(160deg, #08131f 0%, #10263c 100%)",
    },
    grid: {
        id: "grid",
        label: "Neon Grid",
        description: "A futuristic soft grid like themed messenger wallpapers.",
        preview: "linear-gradient(rgba(78,164,246,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(78,164,246,0.16) 1px, transparent 1px), radial-gradient(circle at top, rgba(78,164,246,0.3), transparent 45%), linear-gradient(135deg, #0c1420 0%, #14243a 100%)",
        background: "linear-gradient(rgba(78,164,246,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(78,164,246,0.08) 1px, transparent 1px), radial-gradient(circle at top, rgba(78,164,246,0.22), transparent 45%), linear-gradient(135deg, #0c1420 0%, #14243a 100%)",
    },
    paper: {
        id: "paper",
        label: "Paper Grain",
        description: "Warm textured paper for a cozy journal feel.",
        preview: "linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0)), repeating-linear-gradient(45deg, rgba(255,255,255,0.045) 0px, rgba(255,255,255,0.045) 2px, transparent 2px, transparent 8px), linear-gradient(135deg, #211919 0%, #2f2420 100%)",
        background: "linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0)), repeating-linear-gradient(45deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 2px, transparent 2px, transparent 8px), linear-gradient(135deg, #211919 0%, #2f2420 100%)",
    },
    stars: {
        id: "stars",
        label: "Starfield",
        description: "Minimal dotted space backdrop with soft starlight.",
        preview: "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.22) 0 1px, transparent 1px), radial-gradient(circle at 65% 25%, rgba(255,255,255,0.16) 0 1.5px, transparent 1.5px), radial-gradient(circle at 80% 60%, rgba(78,164,246,0.34), transparent 25%), linear-gradient(135deg, #090d17 0%, #0f1626 100%)",
        background: "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.15) 0 1px, transparent 1px), radial-gradient(circle at 65% 25%, rgba(255,255,255,0.1) 0 1.5px, transparent 1.5px), radial-gradient(circle at 80% 60%, rgba(78,164,246,0.22), transparent 25%), linear-gradient(135deg, #090d17 0%, #0f1626 100%)",
    },
};

export const WALLPAPER_PRESET_LIST = Object.values(WALLPAPER_PRESETS);

export const EFFECT_PRESETS: Record<BackgroundEffectPresetId, EffectPreset> = {
    none: {
        id: "none",
        label: "None",
        description: "Just the wallpaper, no extra overlay effects.",
        preview: "none",
        background: "none",
    },
    glow: {
        id: "glow",
        label: "Glow Orbs",
        description: "Messenger-style floating color blooms.",
        preview: "radial-gradient(circle at 10% 20%, rgba(255,255,255,0.12), transparent 22%), radial-gradient(circle at 85% 15%, rgba(78,164,246,0.18), transparent 24%), radial-gradient(circle at 60% 80%, rgba(255,135,135,0.12), transparent 22%)",
        background: "radial-gradient(circle at 10% 20%, rgba(255,255,255,0.08), transparent 22%), radial-gradient(circle at 85% 15%, rgba(78,164,246,0.12), transparent 24%), radial-gradient(circle at 60% 80%, rgba(255,135,135,0.08), transparent 22%)",
    },
    grain: {
        id: "grain",
        label: "Film Grain",
        description: "Adds a subtle cinematic texture.",
        preview: "repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 3px)",
        background: "repeating-linear-gradient(0deg, rgba(255,255,255,0.018) 0px, rgba(255,255,255,0.018) 1px, transparent 1px, transparent 3px)",
    },
    prism: {
        id: "prism",
        label: "Prism Lines",
        description: "Angular glass highlights for a modern chat look.",
        preview: "linear-gradient(120deg, transparent 0%, rgba(255,255,255,0.04) 28%, transparent 52%), linear-gradient(300deg, transparent 0%, rgba(255,255,255,0.03) 32%, transparent 60%)",
        background: "linear-gradient(120deg, transparent 0%, rgba(255,255,255,0.03) 28%, transparent 52%), linear-gradient(300deg, transparent 0%, rgba(255,255,255,0.025) 32%, transparent 60%)",
    },
    stars: {
        id: "stars",
        label: "Sparkles",
        description: "Small twinkles inspired by playful messenger themes.",
        preview: "radial-gradient(circle at 12% 16%, rgba(255,255,255,0.18) 0 1px, transparent 1px), radial-gradient(circle at 42% 70%, rgba(255,255,255,0.1) 0 1px, transparent 1px), radial-gradient(circle at 78% 34%, rgba(255,255,255,0.14) 0 1.5px, transparent 1.5px)",
        background: "radial-gradient(circle at 12% 16%, rgba(255,255,255,0.12) 0 1px, transparent 1px), radial-gradient(circle at 42% 70%, rgba(255,255,255,0.08) 0 1px, transparent 1px), radial-gradient(circle at 78% 34%, rgba(255,255,255,0.1) 0 1.5px, transparent 1.5px)",
    },
};

export const EFFECT_PRESET_LIST = Object.values(EFFECT_PRESETS);

export const BUBBLE_STYLE_OPTIONS: ChoiceOption<BubbleStyleId>[] = [
    { id: "default", label: "Default", description: "Classic filled message bubbles." },
    { id: "soft", label: "Soft", description: "Rounder, more relaxed corners and spacing." },
    { id: "glass", label: "Glass", description: "Frosted translucent bubbles inspired by modern messengers." },
];

export const DENSITY_OPTIONS: ChoiceOption<DensityMode>[] = [
    { id: "comfortable", label: "Comfortable", description: "Current default spacing." },
    { id: "compact", label: "Compact", description: "Denser chat list and message spacing." },
];

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
    themePreset: "default",
    accentColor: THEME_PRESETS.default.colors.accent,
    chatBackgroundPreset: "default",
    backgroundEffect: "none",
    customBackgroundImage: "",
    useCustomBackground: false,
    backgroundDim: 18,
    backgroundBlur: 0,
    backgroundMotion: true,
    interfaceDensity: "comfortable",
    bubbleStyle: "default",
    uiEffects: true,
    sidebarTranslucent: false,
};

const THEME_IDS = new Set(Object.keys(THEME_PRESETS));
const WALLPAPER_IDS = new Set(Object.keys(WALLPAPER_PRESETS));
const EFFECT_IDS = new Set(Object.keys(EFFECT_PRESETS));
const BUBBLE_STYLE_IDS = new Set(BUBBLE_STYLE_OPTIONS.map((option) => option.id));
const DENSITY_IDS = new Set(DENSITY_OPTIONS.map((option) => option.id));

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function normalizeHexColor(color: string | undefined, fallback: string): string {
    if (!color) return fallback;
    const normalized = color.trim();
    return /^#([0-9a-fA-F]{6})$/.test(normalized) ? normalized : fallback;
}

function hexToRgba(hex: string, alpha: number): string {
    const safeHex = normalizeHexColor(hex, "#4ea4f6").replace("#", "");
    const r = parseInt(safeHex.slice(0, 2), 16);
    const g = parseInt(safeHex.slice(2, 4), 16);
    const b = parseInt(safeHex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function escapeCssUrl(url: string): string {
    return url.replace(/"/g, '\\"');
}

export function sanitizeAppearanceSettings(input?: Partial<AppearanceSettings>): AppearanceSettings {
    const merged = { ...DEFAULT_APPEARANCE_SETTINGS, ...(input || {}) };
    return {
        themePreset: THEME_IDS.has(merged.themePreset) ? merged.themePreset : DEFAULT_APPEARANCE_SETTINGS.themePreset,
        accentColor: normalizeHexColor(merged.accentColor, DEFAULT_APPEARANCE_SETTINGS.accentColor),
        chatBackgroundPreset: WALLPAPER_IDS.has(merged.chatBackgroundPreset)
            ? merged.chatBackgroundPreset
            : DEFAULT_APPEARANCE_SETTINGS.chatBackgroundPreset,
        backgroundEffect: EFFECT_IDS.has(merged.backgroundEffect)
            ? merged.backgroundEffect
            : DEFAULT_APPEARANCE_SETTINGS.backgroundEffect,
        customBackgroundImage: typeof merged.customBackgroundImage === "string" ? merged.customBackgroundImage : "",
        useCustomBackground: Boolean(merged.useCustomBackground),
        backgroundDim: clamp(Number(merged.backgroundDim) || 0, 0, 70),
        backgroundBlur: clamp(Number(merged.backgroundBlur) || 0, 0, 24),
        backgroundMotion: merged.backgroundMotion !== false,
        interfaceDensity: DENSITY_IDS.has(merged.interfaceDensity)
            ? merged.interfaceDensity
            : DEFAULT_APPEARANCE_SETTINGS.interfaceDensity,
        bubbleStyle: BUBBLE_STYLE_IDS.has(merged.bubbleStyle)
            ? merged.bubbleStyle
            : DEFAULT_APPEARANCE_SETTINGS.bubbleStyle,
        uiEffects: merged.uiEffects !== false,
        sidebarTranslucent: Boolean(merged.sidebarTranslucent),
    };
}

export function buildAppearanceStyle(input?: Partial<AppearanceSettings>): Record<string, string> {
    const appearance = sanitizeAppearanceSettings(input);
    const theme = THEME_PRESETS[appearance.themePreset] ?? THEME_PRESETS.default;
    const accent = normalizeHexColor(appearance.accentColor, theme.colors.accent);
    const wallpaper = appearance.useCustomBackground && appearance.customBackgroundImage
        ? `url("${escapeCssUrl(appearance.customBackgroundImage)}")`
        : WALLPAPER_PRESETS[appearance.chatBackgroundPreset].background;
    const effect = EFFECT_PRESETS[appearance.backgroundEffect]?.background ?? "none";

    return {
        "--sc-bg": theme.colors.base,
        "--sc-surface-1": theme.colors.surface1,
        "--sc-surface-2": theme.colors.surface2,
        "--sc-surface-3": theme.colors.surface3,
        "--sc-border": theme.colors.border,
        "--sc-border-soft": theme.colors.borderSoft,
        "--sc-text": theme.colors.text,
        "--sc-muted": theme.colors.muted,
        "--sc-accent": accent,
        "--sc-accent-soft": hexToRgba(accent, 0.18),
        "--sc-accent-strong": hexToRgba(accent, 0.32),
        "--sc-message-in": theme.colors.messageIn,
        "--sc-message-out": theme.colors.messageOut,
        "--sc-app-backdrop": theme.colors.appBackdrop,
        "--sc-chat-wallpaper": wallpaper,
        "--sc-chat-effect": effect,
        "--sc-chat-dim": `${appearance.backgroundDim / 100}`,
        "--sc-chat-dim-strong": `${Math.min(0.92, appearance.backgroundDim / 100 + 0.12)}`,
        "--sc-chat-blur": `${appearance.backgroundBlur}px`,
        "--sc-chat-blur-scale": `${1 + appearance.backgroundBlur * 0.01}`,
        "--sc-panel-opacity": appearance.sidebarTranslucent ? "0.78" : "1",
        "--sc-panel-blur": appearance.sidebarTranslucent ? "18px" : "0px",
        "--sc-effect-strength": appearance.uiEffects ? "1" : "0",
    };
}

export async function compressImageFileToDataUrl(file: File): Promise<string> {
    const readAsDataUrl = () =>
        new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(reader.error || new Error("Failed to read image file"));
            reader.readAsDataURL(file);
        });

    const sourceUrl = await readAsDataUrl();

    const loadImage = () =>
        new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error("Failed to decode image"));
            image.src = sourceUrl;
        });

    const image = await loadImage();
    const maxSide = 1600;
    const longestSide = Math.max(image.width, image.height);
    const scale = longestSide > maxSide ? maxSide / longestSide : 1;
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
        return sourceUrl;
    }

    ctx.drawImage(image, 0, 0, width, height);

    const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
    let result = canvas.toDataURL(outputType, outputType === "image/png" ? undefined : 0.84);

    if (result.length > 3_500_000 && outputType !== "image/png") {
        result = canvas.toDataURL("image/jpeg", 0.72);
    }

    return result;
}
