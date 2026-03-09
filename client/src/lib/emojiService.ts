import { createElement, type ReactNode } from "react";
import appleEmojiCategories from "./appleEmojiData.json";
import sheetUrl from "emoji-datasource-apple/img/apple/sheets/32.png";

// The sprite sheet is 62 columns x 62 rows, each cell is (size + 2)px
// We use the 32px sheet from emoji-datasource-apple
const SHEET_COLUMNS = 62;
const SHEET_ROWS = 62;
const SHEET_EMOJI_SIZE = 32; // px per emoji in the sheet
const SHEET_CELL_SIZE = SHEET_EMOJI_SIZE + 2; // 1px border each side
const SHEET_URL = sheetUrl;

export interface EmojiEntry {
    unified: string;
    sheetX: number;
    sheetY: number;
}

export interface EmojiCategory {
    name: string;
    iconUnified: string;
    emojis: EmojiEntry[];
}

// Process the pre-built category data
export const EMOJI_CATEGORIES: EmojiCategory[] = (
    appleEmojiCategories as { name: string; icon: string; emojis: [string, number, number][] }[]
).map((cat) => ({
    name: cat.name,
    iconUnified: cat.icon,
    emojis: cat.emojis.map(([u, x, y]) => ({
        unified: u,
        sheetX: x,
        sheetY: y,
    })),
}));

// Build a lookup map from native emoji character to sheet position
const nativeToSheetMap = new Map<string, EmojiEntry>();
for (const cat of EMOJI_CATEGORIES) {
    for (const e of cat.emojis) {
        const native = unifiedToNative(e.unified);
        nativeToSheetMap.set(native, e);
        // Also index without variation selectors for flexible matching
        const stripped = native.replace(/\ufe0f/g, "");
        if (stripped !== native && !nativeToSheetMap.has(stripped)) {
            nativeToSheetMap.set(stripped, e);
        }
    }
}

// Build a regex that matches any known emoji character (longest match first)
let _emojiRegex: RegExp | null = null;
function getEmojiRegex(): RegExp {
    if (!_emojiRegex) {
        const emojiPatterns = Array.from(nativeToSheetMap.keys())
            .sort((a, b) => b.length - a.length) // longest first for greedy matching
            .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        _emojiRegex = new RegExp(`(${emojiPatterns.join("|")})`, "g");
    }
    return _emojiRegex;
}

/** Convert a unified codepoint string (e.g. "1F600") to a native emoji character */
export function unifiedToNative(unified: string): string {
    return unified
        .split("-")
        .map((hex) => String.fromCodePoint(parseInt(hex, 16)))
        .join("");
}

/** Look up sheet position for a native emoji character */
export function lookupNativeEmoji(native: string): EmojiEntry | undefined {
    return (
        nativeToSheetMap.get(native) ??
        nativeToSheetMap.get(native.replace(/\ufe0f/g, ""))
    );
}

/** Get CSS style object to render an emoji from the Apple sprite sheet */
export function getEmojiStyle(
    sheetX: number,
    sheetY: number,
    displaySize: number
): React.CSSProperties {
    const scale = displaySize / SHEET_EMOJI_SIZE;
    const cellScaled = SHEET_CELL_SIZE * scale;
    const borderScaled = 1 * scale;
    const bgWidth = SHEET_COLUMNS * cellScaled;
    const bgHeight = SHEET_ROWS * cellScaled;
    const posX = -(sheetX * cellScaled + borderScaled);
    const posY = -(sheetY * cellScaled + borderScaled);

    return {
        display: "inline-block",
        width: displaySize,
        height: displaySize,
        backgroundImage: `url(${SHEET_URL})`,
        backgroundSize: `${bgWidth}px ${bgHeight}px`,
        backgroundPosition: `${posX}px ${posY}px`,
        backgroundRepeat: "no-repeat",
    };
}

/** Get CSS style for a native emoji character (returns undefined if not found) */
export function getNativeEmojiStyle(
    native: string,
    displaySize: number
): React.CSSProperties | undefined {
    const entry = lookupNativeEmoji(native);
    if (!entry) return undefined;
    return getEmojiStyle(entry.sheetX, entry.sheetY, displaySize);
}

export interface RenderTextWithEmojiOptions {
    measurementFont?: string;
    reserveNativeAdvanceWidth?: boolean;
    emojiVerticalAlign?: React.CSSProperties["verticalAlign"];
}

let emojiMeasureContext: CanvasRenderingContext2D | null | undefined;
const emojiAdvanceWidthCache = new Map<string, number>();

function measureEmojiAdvanceWidth(emoji: string, font: string): number | undefined {
    if (typeof document === "undefined") return undefined;

    if (emojiMeasureContext === undefined) {
        const canvas = document.createElement("canvas");
        emojiMeasureContext = canvas.getContext("2d");
    }

    if (!emojiMeasureContext) return undefined;

    const cacheKey = `${font}:${emoji}`;
    const cachedWidth = emojiAdvanceWidthCache.get(cacheKey);
    if (cachedWidth !== undefined) {
        return cachedWidth;
    }

    emojiMeasureContext.font = font;
    const measuredWidth = emojiMeasureContext.measureText(emoji).width;
    if (!Number.isFinite(measuredWidth) || measuredWidth <= 0) {
        return undefined;
    }

    emojiAdvanceWidthCache.set(cacheKey, measuredWidth);
    return measuredWidth;
}

/**
 * Parse a text string and replace all recognized emoji characters
 * with inline Apple sprite sheet <span> elements.
 * Returns an array of ReactNodes (strings and emoji spans) suitable
 * for rendering inside JSX.
 */
export function renderTextWithEmoji(
    text: string,
    emojiSize = 20,
    options: RenderTextWithEmojiOptions = {},
): ReactNode[] {
    if (!text) return [];

    const regex = getEmojiRegex();
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    let keyIdx = 0;
    const verticalAlign = options.emojiVerticalAlign ?? "text-bottom";

    // Reset regex state
    regex.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        const emojiChar = match[0];
        const entry = lookupNativeEmoji(emojiChar);
        if (!entry) continue; // shouldn't happen but be safe

        // Push text before this emoji
        if (match.index > lastIndex) {
            parts.push(text.slice(lastIndex, match.index));
        }

        const emojiStyle: React.CSSProperties = {
            ...getEmojiStyle(entry.sheetX, entry.sheetY, emojiSize),
            verticalAlign,
        };

        if (options.reserveNativeAdvanceWidth) {
            const measuredWidth = options.measurementFont
                ? measureEmojiAdvanceWidth(emojiChar, options.measurementFont)
                : undefined;

            parts.push(
                createElement(
                    "span",
                    {
                        key: `e${keyIdx++}`,
                        style: {
                            display: "inline-flex",
                            width: measuredWidth ?? emojiSize,
                            height: emojiSize,
                            alignItems: "center",
                            justifyContent: "center",
                            verticalAlign,
                        },
                    },
                    createElement("span", {
                        role: "img",
                        "aria-label": emojiChar,
                        style: emojiStyle,
                    }),
                ),
            );
        } else {
            parts.push(
                createElement("span", {
                    key: `e${keyIdx++}`,
                    role: "img",
                    "aria-label": emojiChar,
                    style: emojiStyle,
                }),
            );
        }

        lastIndex = match.index + emojiChar.length;
    }

    // Push remaining text
    if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
    }

    return parts.length > 0 ? parts : [text];
}

// ─── Emoji History / Frequently Used ───

const EMOJI_HISTORY_KEY = "sc_emoji_history";

/** Default popular emojis shown when user has no history */
const DEFAULT_POPULAR_UNIFIED = [
    "1F602", // 😂
    "2764-FE0F", // ❤️
    "1F44D", // 👍
    "1F62D", // 😭
    "1F525", // 🔥
    "1F64F", // 🙏
    "1F60D", // 😍
    "1F923", // 🤣
    "1F60A", // 😊
    "1F622", // 😢
    "1F44C", // 👌
    "1F499", // 💙
    "1F4AF", // 💯
    "1F389", // 🎉
    "1F44F", // 👏
    "1F60E", // 😎
    "2728",  // ✨
    "1F609", // 😉
    "1F614", // 😔
    "1F44B", // 👋
    "1F60B", // 😋
    "1F61C", // 😜
    "1F49C", // 💜
    "1F495", // 💕
    "1F44E", // 👎
    "1F4AA", // 💪
    "1F618", // 😘
    "1F440", // 👀
    "1F60F", // 😏
    "1F9E1", // 🧡
    "1F49A", // 💚
    "1F631", // 😱
];

function getEmojiHistoryCounts(): Record<string, number> {
    try {
        const raw = localStorage.getItem(EMOJI_HISTORY_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

/** Record an emoji selection – call this whenever a user picks an emoji */
export function recordEmojiUsage(unified: string): void {
    const counts = getEmojiHistoryCounts();
    counts[unified] = (counts[unified] || 0) + 1;
    localStorage.setItem(EMOJI_HISTORY_KEY, JSON.stringify(counts));
}

/** Build the "Frequently Used" category from history (or defaults) */
export function getFrequentlyUsedCategory(): EmojiCategory {
    const counts = getEmojiHistoryCounts();
    const hasHistory = Object.keys(counts).length > 0;

    // Look up an emoji entry by unified code from the main categories
    const lookup = (u: string): EmojiEntry | undefined => {
        for (const cat of EMOJI_CATEGORIES) {
            for (const e of cat.emojis) {
                if (e.unified === u) return e;
            }
        }
        return undefined;
    };

    let emojis: EmojiEntry[];

    if (hasHistory) {
        // Sort by usage count (descending), take top 32
        emojis = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 32)
            .map(([u]) => lookup(u))
            .filter((e): e is EmojiEntry => e !== undefined);

        // If fewer than 32, fill with defaults (no duplicates)
        if (emojis.length < 32) {
            const usedUnified = new Set(emojis.map((e) => e.unified));
            for (const u of DEFAULT_POPULAR_UNIFIED) {
                if (emojis.length >= 32) break;
                if (usedUnified.has(u)) continue;
                const entry = lookup(u);
                if (entry) {
                    emojis.push(entry);
                    usedUnified.add(u);
                }
            }
        }
    } else {
        emojis = DEFAULT_POPULAR_UNIFIED
            .map((u) => lookup(u))
            .filter((e): e is EmojiEntry => e !== undefined);
    }

    return {
        name: "Frequently Used",
        iconUnified: "1F552", // 🕒
        emojis,
    };
}

export { SHEET_URL };
