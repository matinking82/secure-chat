import { useState, useRef, useEffect, useMemo } from "react";
import {
    EMOJI_CATEGORIES,
    unifiedToNative,
    getEmojiStyle,
    recordEmojiUsage,
    getFrequentlyUsedCategory,
    lookupNativeEmoji,
} from "../../lib/emojiService";

interface EmojiPickerProps {
    onSelect: (emoji: string) => void;
    onClose: () => void;
}

export default function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
    const [activeCategory, setActiveCategory] = useState(0);
    const [frequentCategory] = useState(getFrequentlyUsedCategory);
    const panelRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const mountedRef = useRef(false);
    const touchStartXRef = useRef(0);
    const touchStartYRef = useRef(0);
    const swipingRef = useRef(false);

    const isDesktop = useMemo(() =>
        !(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        ('ontouchstart' in window && window.innerWidth < 768)), []);

    // All categories: Frequently Used first, then the built-in ones
    const allCategories = [frequentCategory, ...EMOJI_CATEGORIES];

    // Close on click outside
    useEffect(() => {
        // Set mounted flag after initial render to avoid closing from the
        // same click that opened the picker.
        requestAnimationFrame(() => { mountedRef.current = true; });

        const handleClick = (e: MouseEvent) => {
            if (!mountedRef.current) return;
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener("mousedown", handleClick);
        return () => {
            mountedRef.current = false;
            document.removeEventListener("mousedown", handleClick);
        };
    }, [onClose]);

    const handleSelect = (unified: string) => {
        recordEmojiUsage(unified);
        onSelect(unifiedToNative(unified));
    };

    // Swipe left/right to change category (like Telegram)
    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartXRef.current = e.touches[0].clientX;
        touchStartYRef.current = e.touches[0].clientY;
        swipingRef.current = false;
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const diffX = touchStartXRef.current - touchEndX;
        const diffY = Math.abs(touchStartYRef.current - touchEndY);
        
        // Only count as horizontal swipe if horizontal movement > vertical and > 50px
        if (Math.abs(diffX) > 50 && Math.abs(diffX) > diffY) {
            if (diffX > 0) {
                // Swiped left → next category
                setActiveCategory((prev) => Math.min(prev + 1, allCategories.length - 1));
            } else {
                // Swiped right → previous category
                setActiveCategory((prev) => Math.max(prev - 1, 0));
            }
        }
    };

    // Desktop: floating panel style (like Telegram)
    // Mobile: full-width bottom panel (unchanged)
    const panelClasses = isDesktop
        ? "absolute bottom-full left-0 mb-2 w-[380px] rounded-2xl border border-white/10 shadow-2xl backdrop-blur-xl z-20 animate-in"
        : "absolute bottom-full left-0 right-0 border-t border-[#0e1621] shadow-lg z-20 animate-in";

    return (
        <div
            ref={panelRef}
            className={panelClasses}
            style={{
                maxHeight: isDesktop ? "420px" : "320px",
                backgroundColor: 'var(--sc-surface-1, #17212b)',
            }}
        >
            {/* Category tabs */}
            <div className="flex border-b border-white/10 px-1 overflow-x-auto">
                    {allCategories.map((cat, idx) => {
                        const iconEmoji = cat.emojis[0];
                        const iconStyle = idx === 0
                            ? getEmojiStyle(
                                lookupNativeEmoji(unifiedToNative(cat.iconUnified))?.sheetX ?? iconEmoji?.sheetX ?? 0,
                                lookupNativeEmoji(unifiedToNative(cat.iconUnified))?.sheetY ?? iconEmoji?.sheetY ?? 0,
                                20
                            )
                            : getEmojiStyle(iconEmoji?.sheetX ?? 0, iconEmoji?.sheetY ?? 0, 20);
                        return (
                            <button
                                key={cat.name}
                                onClick={() => setActiveCategory(idx)}
                                className={`px-3 py-2 shrink-0 transition-colors border-b-2
                                    ${activeCategory === idx
                                        ? "border-[#4ea4f6] bg-white/5"
                                        : "border-transparent hover:bg-white/5"
                                    }`}
                                title={cat.name}
                            >
                                <span role="img" style={iconStyle} />
                            </button>
                        );
                    })}
                </div>

            {/* Emoji grid — swipeable */}
            <div
                ref={gridRef}
                className="overflow-y-auto p-2"
                style={{ maxHeight: isDesktop ? "340px" : "260px" }}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
            >
                <div className="text-xs text-gray-500 px-1 py-1 mb-1">
                    {allCategories[activeCategory].name}
                </div>
                <div className={`grid ${isDesktop ? "grid-cols-9" : "grid-cols-8"} gap-0.5`}>
                    {allCategories[activeCategory].emojis.map((emoji) => (
                        <button
                            key={emoji.unified}
                            onClick={() => handleSelect(emoji.unified)}
                            className="w-10 h-10 flex items-center justify-center
                                       rounded-lg hover:bg-white/10 active:bg-white/15
                                       transition-colors"
                        >
                            <span role="img" style={getEmojiStyle(emoji.sheetX, emoji.sheetY, 28)} />
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
