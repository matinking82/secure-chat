import { useEffect } from "react";

// ─── Card SVG Component ───
// Maps suit+rank to the actual SVG files in /cards/

const SUIT_MAP: Record<number, string> = {
    1: "spades",
    2: "hearts",
    3: "diamonds",
    4: "clubs",
};

const RANK_FILE_MAP_HOKM: Record<number, string> = {
    2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10",
    11: "jack", 12: "queen", 13: "king", 14: "ace",
};

const RANK_FILE_MAP_CHAARBARG: Record<number, string> = {
    1: "ace", 2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10",
    11: "jack", 12: "queen", 13: "king",
};

/** Get card image URL for Hokm games (rank 2-14, 14=Ace) */
export function getCardUrl(suit: number, rank: number): string {
    const suitName = SUIT_MAP[suit];
    const rankName = RANK_FILE_MAP_HOKM[rank];
    if (!suitName || !rankName) return "";
    return `/cards/${rankName}_of_${suitName}.svg`;
}

/** Get card image URL for ChaarBarg (rank 1-13, 1=Ace) */
export function getCardUrlChaarBarg(suit: number, rank: number): string {
    const suitName = SUIT_MAP[suit];
    const rankName = RANK_FILE_MAP_CHAARBARG[rank];
    if (!suitName || !rankName) return "";
    return `/cards/${rankName}_of_${suitName}.svg`;
}

/** Card back URL */
export const CARD_BACK_URL = "/cards/back.svg";

// All card file URLs for preloading
const ALL_CARD_URLS: string[] = [];
for (const suit of ["clubs", "diamonds", "hearts", "spades"]) {
    for (const rank of ["ace", "2", "3", "4", "5", "6", "7", "8", "9", "10", "jack", "queen", "king"]) {
        ALL_CARD_URLS.push(`/cards/${rank}_of_${suit}.svg`);
    }
}

/** Preload/cache all card SVGs */
export function preloadCardImages(): void {
    for (const url of ALL_CARD_URLS) {
        const img = new Image();
        img.src = url;
    }
}

/** Card SVG display component */
export default function CardSvg({
    suit,
    rank,
    variant = "hokm",
    width = 56,
    height = 80,
    onClick,
    disabled,
    highlight,
    selected,
    className = "",
    style,
    label,
}: {
    suit: number;
    rank: number;
    variant?: "hokm" | "chaarbarg";
    width?: number;
    height?: number;
    onClick?: () => void;
    disabled?: boolean;
    highlight?: boolean;
    selected?: boolean;
    className?: string;
    style?: React.CSSProperties;
    label?: string;
}) {
    const url = variant === "chaarbarg" ? getCardUrlChaarBarg(suit, rank) : getCardUrl(suit, rank);

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`relative rounded-lg overflow-hidden transition-all duration-150 shrink-0
                ${highlight ? "ring-2 ring-yellow-400 shadow-[0_0_12px_rgba(250,204,21,0.4)] scale-105 z-10" : ""}
                ${selected ? "ring-2 ring-green-400 shadow-[0_0_12px_rgba(74,222,128,0.4)] scale-105 z-10" : ""}
                ${disabled && !highlight && !selected ? "opacity-50 grayscale-[0.3]" : ""}
                ${!disabled ? "hover:scale-110 hover:-translate-y-1.5 hover:shadow-lg cursor-pointer active:scale-100" : ""}
                ${className}`}
            style={{
                width,
                height,
                ...style,
            }}
            title={label}
        >
            <img
                src={url}
                alt={label || "card"}
                draggable={false}
                className="w-full h-full object-contain pointer-events-none"
                style={{ borderRadius: "inherit" }}
            />
        </button>
    );
}

/** Hook to preload card images when component mounts */
export function useCardPreloader() {
    useEffect(() => {
        preloadCardImages();
    }, []);
}
