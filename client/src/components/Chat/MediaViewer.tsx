import { useState, useRef, useCallback, useEffect } from "react";

interface MediaViewerProps {
    type: "image" | "video";
    src: string;
    alt?: string;
    onClose: () => void;
}

export default function MediaViewer({ type, src, alt, onClose }: MediaViewerProps) {
    const [scale, setScale] = useState(1);
    const [translate, setTranslate] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);
    const lastPos = useRef({ x: 0, y: 0 });
    const lastPinchDist = useRef<number | null>(null);
    const lastPinchScale = useRef(1);
    const animationFrame = useRef<number>(0);

    // ─── Reset transform ───
    const resetTransform = useCallback(() => {
        setScale(1);
        setTranslate({ x: 0, y: 0 });
    }, []);

    // ─── Close on Escape ───
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", handleKey);
        return () => document.removeEventListener("keydown", handleKey);
    }, [onClose]);

    // ─── Mouse wheel zoom (images only) ───
    const handleWheel = useCallback(
        (e: React.WheelEvent) => {
            if (type !== "image") return;
            e.stopPropagation();

            const delta = e.deltaY > 0 ? -0.15 : 0.15;
            setScale((prev) => {
                const next = Math.min(Math.max(prev + delta, 0.5), 8);
                // If zooming back to ~1, reset position
                if (next <= 1.05) {
                    setTranslate({ x: 0, y: 0 });
                    return 1;
                }
                return next;
            });
        },
        [type]
    );

    // ─── Double click/tap to toggle zoom ───
    const handleDoubleClick = useCallback(
        (e: React.MouseEvent) => {
            if (type !== "image") return;
            e.stopPropagation();
            if (scale > 1.1) {
                resetTransform();
            } else {
                setScale(3);
            }
        },
        [type, scale, resetTransform]
    );

    // ─── Mouse drag for panning ───
    const handleMouseDown = useCallback(
        (e: React.MouseEvent) => {
            if (type !== "image" || scale <= 1) return;
            e.preventDefault();
            setIsDragging(true);
            lastPos.current = { x: e.clientX, y: e.clientY };
        },
        [type, scale]
    );

    const handleMouseMove = useCallback(
        (e: React.MouseEvent) => {
            if (!isDragging || scale <= 1) return;
            cancelAnimationFrame(animationFrame.current);
            animationFrame.current = requestAnimationFrame(() => {
                const dx = e.clientX - lastPos.current.x;
                const dy = e.clientY - lastPos.current.y;
                lastPos.current = { x: e.clientX, y: e.clientY };
                setTranslate((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
            });
        },
        [isDragging, scale]
    );

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);

    // ─── Touch: pinch to zoom + drag to pan ───
    const handleTouchStart = useCallback(
        (e: React.TouchEvent) => {
            if (type !== "image") return;

            if (e.touches.length === 2) {
                // Pinch start
                const dist = getTouchDist(e.touches);
                lastPinchDist.current = dist;
                lastPinchScale.current = scale;
            } else if (e.touches.length === 1 && scale > 1) {
                // Pan start
                setIsDragging(true);
                lastPos.current = {
                    x: e.touches[0].clientX,
                    y: e.touches[0].clientY,
                };
            }
        },
        [type, scale]
    );

    const handleTouchMove = useCallback(
        (e: React.TouchEvent) => {
            if (type !== "image") return;

            if (e.touches.length === 2 && lastPinchDist.current !== null) {
                // Pinch zoom
                e.preventDefault();
                const dist = getTouchDist(e.touches);
                const newScale = (dist / lastPinchDist.current) * lastPinchScale.current;
                setScale(Math.min(Math.max(newScale, 0.5), 8));
            } else if (e.touches.length === 1 && isDragging && scale > 1) {
                // Pan
                cancelAnimationFrame(animationFrame.current);
                animationFrame.current = requestAnimationFrame(() => {
                    const dx = e.touches[0].clientX - lastPos.current.x;
                    const dy = e.touches[0].clientY - lastPos.current.y;
                    lastPos.current = {
                        x: e.touches[0].clientX,
                        y: e.touches[0].clientY,
                    };
                    setTranslate((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
                });
            }
        },
        [type, isDragging, scale]
    );

    const handleTouchEnd = useCallback(
        (e: React.TouchEvent) => {
            if (e.touches.length < 2) {
                lastPinchDist.current = null;
            }
            if (e.touches.length === 0) {
                setIsDragging(false);
                // Snap back if scale is too low
                if (scale < 1) {
                    resetTransform();
                }
            }
        },
        [scale, resetTransform]
    );

    // ─── Backdrop click to close ───
    const handleBackdropClick = useCallback(
        (e: React.MouseEvent) => {
            // Only close if clicking on the backdrop itself (not the media)
            if (e.target === e.currentTarget) {
                onClose();
            }
        },
        [onClose]
    );

    return (
        <div
            className="fixed inset-0 z-[300] bg-black/90 flex items-center justify-center"
            onClick={handleBackdropClick}
        >
            {/* Top bar */}
            <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 z-10 bg-gradient-to-b from-black/60 to-transparent">
                <span className="text-white text-sm truncate max-w-[70%] opacity-80">
                    {alt || ""}
                </span>
                <div className="flex items-center gap-2">
                    {type === "image" && scale > 1 && (
                        <button
                            onClick={resetTransform}
                            className="text-white/70 hover:text-white p-2 transition"
                            title="Reset zoom"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                            </svg>
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="text-white/70 hover:text-white p-2 transition"
                        title="Close"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Media content */}
            <div
                ref={containerRef}
                className="w-full h-full flex items-center justify-center overflow-hidden touch-none"
                onWheel={handleWheel}
                onDoubleClick={handleDoubleClick}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                {type === "image" ? (
                    <img
                        src={src}
                        alt={alt || "Image"}
                        className="max-w-[95vw] max-h-[90vh] object-contain select-none"
                        style={{
                            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
                            transition: isDragging ? "none" : "transform 0.2s ease-out",
                            cursor: scale > 1 ? (isDragging ? "grabbing" : "grab") : "default",
                        }}
                        draggable={false}
                        onClick={(e) => e.stopPropagation()}
                    />
                ) : (
                    <video
                        src={src}
                        controls
                        autoPlay
                        className="max-w-[95vw] max-h-[90vh] object-contain"
                        onClick={(e) => e.stopPropagation()}
                    />
                )}
            </div>

            {/* Zoom indicator (images only) */}
            {type === "image" && scale !== 1 && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full">
                    {Math.round(scale * 100)}%
                </div>
            )}
        </div>
    );
}

function getTouchDist(touches: React.TouchList): number {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}
