import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
    EMOJI_CATEGORIES,
    unifiedToNative,
    getEmojiStyle,
    recordEmojiUsage,
    getFrequentlyUsedCategory,
    lookupNativeEmoji,
} from "../../lib/emojiService";
import {
    getSavedGifs,
    saveGif,
    removeGif,
    getSavedStickers,
    saveSticker,
    removeSticker,
    type GifStickerItem,
} from "../../lib/gifStickerStore";

type PanelTab = "emoji" | "gif" | "sticker";

interface EmojiPickerProps {
    onSelect: (emoji: string) => void;
    onClose: () => void;
    onSendGif?: (file: File) => void;
    onSendSticker?: (file: File) => void;
}

export default function EmojiPicker({ onSelect, onClose, onSendGif, onSendSticker }: EmojiPickerProps) {
    const [panelTab, setPanelTab] = useState<PanelTab>("emoji");
    const [activeCategory, setActiveCategory] = useState(0);
    const [frequentCategory] = useState(getFrequentlyUsedCategory);
    const panelRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const mountedRef = useRef(false);
    const touchStartXRef = useRef(0);
    const touchStartYRef = useRef(0);

    // GIF / Sticker state
    const [gifs, setGifs] = useState<GifStickerItem[]>([]);
    const [stickers, setStickers] = useState<GifStickerItem[]>([]);
    const [gifUrls, setGifUrls] = useState<Map<string, string>>(new Map());
    const [stickerUrls, setStickerUrls] = useState<Map<string, string>>(new Map());
    const gifInputRef = useRef<HTMLInputElement>(null);
    const stickerInputRef = useRef<HTMLInputElement>(null);

    const isDesktop = useMemo(() =>
        !(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        ('ontouchstart' in window && window.innerWidth < 768)), []);

    const allCategories = [frequentCategory, ...EMOJI_CATEGORIES];

    // Load gifs/stickers when tab changes
    useEffect(() => {
        if (panelTab === "gif") {
            getSavedGifs().then(setGifs);
        } else if (panelTab === "sticker") {
            getSavedStickers().then(setStickers);
        }
    }, [panelTab]);

    // Create object URLs for gifs
    useEffect(() => {
        const urls = new Map<string, string>();
        for (const g of gifs) {
            urls.set(g.id, URL.createObjectURL(g.blob));
        }
        setGifUrls(urls);
        return () => {
            for (const url of urls.values()) URL.revokeObjectURL(url);
        };
    }, [gifs]);

    // Create object URLs for stickers
    useEffect(() => {
        const urls = new Map<string, string>();
        for (const s of stickers) {
            urls.set(s.id, URL.createObjectURL(s.blob));
        }
        setStickerUrls(urls);
        return () => {
            for (const url of urls.values()) URL.revokeObjectURL(url);
        };
    }, [stickers]);

    // Close on click outside
    useEffect(() => {
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

    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartXRef.current = e.touches[0].clientX;
        touchStartYRef.current = e.touches[0].clientY;
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const diffX = touchStartXRef.current - touchEndX;
        const diffY = Math.abs(touchStartYRef.current - touchEndY);
        if (Math.abs(diffX) > 50 && Math.abs(diffX) > diffY) {
            if (panelTab === "emoji") {
                if (diffX > 0) {
                    setActiveCategory((prev) => Math.min(prev + 1, allCategories.length - 1));
                } else {
                    setActiveCategory((prev) => Math.max(prev - 1, 0));
                }
            }
        }
    };

    // ─── GIF handlers ───
    const handleAddGif = useCallback(() => {
        gifInputRef.current?.click();
    }, []);

    const handleGifFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            await saveGif(f, f.name);
        }
        const updated = await getSavedGifs();
        setGifs(updated);
        e.target.value = "";
    }, []);

    const handleSendGif = useCallback((item: GifStickerItem) => {
        if (!onSendGif) return;
        const file = new File([item.blob], item.name, { type: item.mime });
        onSendGif(file);
    }, [onSendGif]);

    const handleRemoveGif = useCallback(async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        await removeGif(id);
        setGifs(prev => prev.filter(g => g.id !== id));
    }, []);

    // ─── Sticker handlers ───
    const handleAddSticker = useCallback(() => {
        stickerInputRef.current?.click();
    }, []);

    const handleStickerFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            await saveSticker(f, f.name);
        }
        const updated = await getSavedStickers();
        setStickers(updated);
        e.target.value = "";
    }, []);

    const handleSendSticker = useCallback((item: GifStickerItem) => {
        if (!onSendSticker) return;
        const file = new File([item.blob], item.name, { type: item.mime });
        onSendSticker(file);
    }, [onSendSticker]);

    const handleRemoveSticker = useCallback(async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        await removeSticker(id);
        setStickers(prev => prev.filter(s => s.id !== id));
    }, []);

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
            {/* Top-level tabs: Emoji | GIF | Sticker */}
            <div className="flex border-b border-white/10">
                {(["emoji", "gif", "sticker"] as PanelTab[]).map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setPanelTab(tab)}
                        className={`flex-1 px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors border-b-2
                            ${panelTab === tab
                                ? "border-[#4ea4f6] text-[#4ea4f6] bg-white/5"
                                : "border-transparent text-gray-400 hover:text-gray-300 hover:bg-white/5"
                            }`}
                    >
                        {tab === "emoji" ? "😀 Emoji" : tab === "gif" ? "🎬 GIF" : "🎨 Sticker"}
                    </button>
                ))}
            </div>

            {/* ─── Emoji panel ─── */}
            {panelTab === "emoji" && (
                <>
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
                    <div
                        ref={gridRef}
                        className="overflow-y-auto p-2"
                        style={{ maxHeight: isDesktop ? "300px" : "220px" }}
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
                </>
            )}

            {/* ─── GIF panel ─── */}
            {panelTab === "gif" && (
                <div className="overflow-y-auto p-2" style={{ maxHeight: isDesktop ? "340px" : "260px" }}>
                    <input
                        ref={gifInputRef}
                        type="file"
                        accept="video/*,image/gif"
                        multiple
                        className="hidden"
                        onChange={handleGifFileChange}
                    />
                    <div className="grid grid-cols-3 gap-1.5">
                        {/* Add button */}
                        <button
                            onClick={handleAddGif}
                            className="aspect-square rounded-lg border-2 border-dashed border-white/20 hover:border-[#4ea4f6]/50 flex flex-col items-center justify-center gap-1 transition-colors hover:bg-white/5"
                        >
                            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            <span className="text-[10px] text-gray-500">Add GIF</span>
                        </button>
                        {gifs.map((g) => {
                            const url = gifUrls.get(g.id);
                            if (!url) return null;
                            const isVideo = g.mime.startsWith("video/");
                            return (
                                <div
                                    key={g.id}
                                    className="relative aspect-square rounded-lg overflow-hidden cursor-pointer group hover:ring-2 hover:ring-[#4ea4f6]/50 transition-all"
                                    onClick={() => handleSendGif(g)}
                                >
                                    {isVideo ? (
                                        <video
                                            src={url}
                                            className="w-full h-full object-cover"
                                            autoPlay
                                            loop
                                            muted
                                            playsInline
                                        />
                                    ) : (
                                        <img src={url} alt={g.name} className="w-full h-full object-cover" />
                                    )}
                                    <button
                                        onClick={(e) => handleRemoveGif(g.id, e)}
                                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                        title="Remove"
                                    >
                                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                    {gifs.length === 0 && (
                        <div className="text-center text-gray-500 text-xs mt-4">
                            No saved GIFs yet. Add videos or GIF images to use them like Telegram GIFs.
                        </div>
                    )}
                </div>
            )}

            {/* ─── Sticker panel ─── */}
            {panelTab === "sticker" && (
                <div className="overflow-y-auto p-2" style={{ maxHeight: isDesktop ? "340px" : "260px" }}>
                    <input
                        ref={stickerInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={handleStickerFileChange}
                    />
                    <div className="grid grid-cols-4 gap-2">
                        {/* Add button */}
                        <button
                            onClick={handleAddSticker}
                            className="aspect-square rounded-lg border-2 border-dashed border-white/20 hover:border-[#4ea4f6]/50 flex flex-col items-center justify-center gap-1 transition-colors hover:bg-white/5"
                        >
                            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            <span className="text-[10px] text-gray-500">Add</span>
                        </button>
                        {stickers.map((s) => {
                            const url = stickerUrls.get(s.id);
                            if (!url) return null;
                            return (
                                <div
                                    key={s.id}
                                    className="relative aspect-square rounded-lg overflow-hidden cursor-pointer group hover:ring-2 hover:ring-[#4ea4f6]/50 transition-all"
                                    onClick={() => handleSendSticker(s)}
                                >
                                    <img src={url} alt={s.name} className="w-full h-full object-contain" />
                                    <button
                                        onClick={(e) => handleRemoveSticker(s.id, e)}
                                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                        title="Remove"
                                    >
                                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                    {stickers.length === 0 && (
                        <div className="text-center text-gray-500 text-xs mt-4">
                            No saved stickers yet. Add images to use them as borderless stickers.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
