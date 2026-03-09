import { getNativeEmojiStyle, getEmojiStyle } from "../../lib/emojiService";

interface AppleEmojiProps {
    /** Native emoji character (e.g. "😀") */
    native?: string;
    /** Sprite sheet X coordinate (use when you already have it) */
    sheetX?: number;
    /** Sprite sheet Y coordinate (use when you already have it) */
    sheetY?: number;
    /** Display size in pixels (default: 20) */
    size?: number;
    className?: string;
}

/**
 * Renders an emoji using the Apple emoji sprite sheet.
 * Falls back to native emoji text if the Apple image is not available.
 */
export default function AppleEmoji({ native, sheetX, sheetY, size = 20, className }: AppleEmojiProps) {
    // If sheet coordinates are provided directly, use them
    if (sheetX !== undefined && sheetY !== undefined) {
        return (
            <span
                className={className}
                style={getEmojiStyle(sheetX, sheetY, size)}
                role="img"
            />
        );
    }

    // Look up by native character
    if (native) {
        const style = getNativeEmojiStyle(native, size);
        if (style) {
            return (
                <span
                    className={className}
                    style={style}
                    role="img"
                    aria-label={native}
                />
            );
        }
        // Fallback to native emoji text
        return <span className={className} style={{ fontSize: size * 0.8 }}>{native}</span>;
    }

    return null;
}
