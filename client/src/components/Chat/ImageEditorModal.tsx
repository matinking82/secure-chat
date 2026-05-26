import { useEffect, useMemo, useRef, useState } from "react";

interface ImageEditorModalProps {
    file: File;
    onApply: (file: File) => void;
    onClose: () => void;
}

interface Point {
    x: number;
    y: number;
}

interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export default function ImageEditorModal({ file, onApply, onClose }: ImageEditorModalProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [drawMode, setDrawMode] = useState(false);
    const [cropMode, setCropMode] = useState(false);
    const [brushSize, setBrushSize] = useState(4);
    const [brushColor, setBrushColor] = useState("#ff3b30");
    const [isDrawing, setIsDrawing] = useState(false);
    const [lastPoint, setLastPoint] = useState<Point | null>(null);
    const [cropStart, setCropStart] = useState<Point | null>(null);
    const [cropRect, setCropRect] = useState<Rect | null>(null);
    const [saving, setSaving] = useState(false);
    const [originalDataUrl, setOriginalDataUrl] = useState<string | null>(null);

    useEffect(() => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const maxDim = 1600;
            const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
            canvas.width = Math.max(1, Math.round(img.width * ratio));
            canvas.height = Math.max(1, Math.round(img.height * ratio));
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            setOriginalDataUrl(canvas.toDataURL("image/png"));
        };
        img.src = url;
        return () => URL.revokeObjectURL(url);
    }, [file]);

    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", handleKey);
        return () => document.removeEventListener("keydown", handleKey);
    }, [onClose]);

    const mapPoint = (clientX: number, clientY: number): Point | null => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const x = ((clientX - rect.left) / rect.width) * canvas.width;
        const y = ((clientY - rect.top) / rect.height) * canvas.height;
        return {
            x: Math.max(0, Math.min(canvas.width, x)),
            y: Math.max(0, Math.min(canvas.height, y)),
        };
    };

    const startCrop = (p: Point) => {
        setCropStart(p);
        setCropRect({ x: p.x, y: p.y, w: 0, h: 0 });
    };

    const updateCrop = (p: Point) => {
        if (!cropStart) return;
        const x = Math.min(cropStart.x, p.x);
        const y = Math.min(cropStart.y, p.y);
        const w = Math.abs(p.x - cropStart.x);
        const h = Math.abs(p.y - cropStart.y);
        setCropRect({ x, y, w, h });
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const p = mapPoint(e.clientX, e.clientY);
        if (!p) return;
        if (cropMode) {
            startCrop(p);
            return;
        }
        if (!drawMode) return;
        setIsDrawing(true);
        setLastPoint(p);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const p = mapPoint(e.clientX, e.clientY);
        if (!p) return;
        if (cropMode && cropStart) {
            updateCrop(p);
            return;
        }
        if (!drawMode || !isDrawing || !lastPoint) return;
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = brushColor;
        ctx.lineWidth = brushSize;
        ctx.beginPath();
        ctx.moveTo(lastPoint.x, lastPoint.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        setLastPoint(p);
    };

    const handlePointerUp = () => {
        setIsDrawing(false);
        setLastPoint(null);
        setCropStart(null);
    };

    const applyCrop = () => {
        const canvas = canvasRef.current;
        if (!canvas || !cropRect || cropRect.w < 10 || cropRect.h < 10) return;
        const tmp = document.createElement("canvas");
        tmp.width = Math.round(cropRect.w);
        tmp.height = Math.round(cropRect.h);
        const ctx = tmp.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(
            canvas,
            cropRect.x,
            cropRect.y,
            cropRect.w,
            cropRect.h,
            0,
            0,
            tmp.width,
            tmp.height,
        );
        canvas.width = tmp.width;
        canvas.height = tmp.height;
        const cctx = canvas.getContext("2d");
        if (!cctx) return;
        cctx.clearRect(0, 0, canvas.width, canvas.height);
        cctx.drawImage(tmp, 0, 0);
        setCropRect(null);
        setCropMode(false);
    };

    const rotateRight = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const tmp = document.createElement("canvas");
        tmp.width = canvas.height;
        tmp.height = canvas.width;
        const ctx = tmp.getContext("2d");
        if (!ctx) return;
        ctx.translate(tmp.width / 2, tmp.height / 2);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
        canvas.width = tmp.width;
        canvas.height = tmp.height;
        const cctx = canvas.getContext("2d");
        if (!cctx) return;
        cctx.clearRect(0, 0, canvas.width, canvas.height);
        cctx.drawImage(tmp, 0, 0);
        setCropRect(null);
    };

    const resetImage = () => {
        if (!originalDataUrl) return;
        const img = new Image();
        img.onload = () => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            setCropRect(null);
            setCropMode(false);
        };
        img.src = originalDataUrl;
    };

    const handleApply = async () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        setSaving(true);
        try {
            const type = file.type.startsWith("image/") ? file.type : "image/png";
            const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.95));
            if (!blob) return;
            const ext = type.includes("jpeg") ? "jpg" : type.split("/")[1] || "png";
            const baseName = file.name.replace(/\.[^.]+$/, "");
            onApply(new File([blob], `${baseName}-edited.${ext}`, { type }));
        } finally {
            setSaving(false);
        }
    };

    const cropOverlayStyle = useMemo<React.CSSProperties>(() => {
        if (!cropRect) return { display: "none" };
        const canvas = canvasRef.current;
        if (!canvas) return { display: "none" };
        const rect = canvas.getBoundingClientRect();
        const scaleX = rect.width / canvas.width;
        const scaleY = rect.height / canvas.height;
        return {
            left: cropRect.x * scaleX,
            top: cropRect.y * scaleY,
            width: cropRect.w * scaleX,
            height: cropRect.h * scaleY,
        };
    }, [cropRect]);

    return (
        <div className="fixed inset-0 z-[310] bg-black/80 flex items-center justify-center p-3" onClick={onClose}>
            <div className="w-full max-w-4xl h-[90vh] bg-[#17212b] rounded-2xl border border-[#2b5278]/50 flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="px-4 py-3 border-b border-[#2b5278]/40 flex items-center justify-between">
                    <h3 className="text-white font-semibold text-sm">Edit image</h3>
                    <button onClick={onClose} className="text-gray-300 hover:text-white p-1.5 rounded-full hover:bg-white/10" title="Close">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div className="px-3 py-2 border-b border-[#2b5278]/40 flex flex-wrap items-center gap-2 text-sm">
                    <button
                        onClick={() => { setDrawMode((v) => !v); setCropMode(false); }}
                        className={`p-2 rounded-lg ${drawMode ? "bg-[#4ea4f6] text-white" : "bg-[#1e2c3a] text-gray-200 hover:text-white"}`}
                        title="Draw"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                    </button>
                    <button
                        onClick={() => { setCropMode((v) => !v); setDrawMode(false); }}
                        className={`p-2 rounded-lg ${cropMode ? "bg-[#4ea4f6] text-white" : "bg-[#1e2c3a] text-gray-200 hover:text-white"}`}
                        title="Crop"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v13a2 2 0 002 2h11M4 7h13a2 2 0 012 2v11" />
                        </svg>
                    </button>
                    <button onClick={applyCrop} className="p-2 rounded-lg bg-[#1e2c3a] text-gray-200 hover:text-white disabled:opacity-50" disabled={!cropRect} title="Apply crop">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    </button>
                    <button onClick={rotateRight} className="p-2 rounded-lg bg-[#1e2c3a] text-gray-200 hover:text-white" title="Rotate">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                    <button onClick={resetImage} className="p-2 rounded-lg bg-[#1e2c3a] text-gray-200 hover:text-white" title="Reset">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8m0-5v5h5" />
                        </svg>
                    </button>
                    <div className="flex items-center gap-1.5 text-gray-300">
                        <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} className="w-8 h-8 rounded bg-transparent border-0 p-0" />
                        <input type="range" min={1} max={24} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} />
                    </div>
                </div>
                <div className="flex-1 overflow-auto p-3">
                    <div className="relative inline-block max-w-full">
                        <canvas
                            ref={canvasRef}
                            className="max-w-full max-h-[65vh] rounded-lg bg-black/30 touch-none"
                            onPointerDown={handlePointerDown}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerLeave={handlePointerUp}
                        />
                        <div className="absolute border-2 border-[#4ea4f6] bg-[#4ea4f6]/15 pointer-events-none" style={cropOverlayStyle} />
                    </div>
                </div>
                <div className="px-4 py-3 border-t border-[#2b5278]/40 flex items-center justify-end gap-2">
                    <button onClick={onClose} className="p-2 rounded-full bg-[#1e2c3a] text-gray-200 hover:text-white" title="Cancel">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                    <button onClick={handleApply} disabled={saving} className="p-2 rounded-full bg-[#4ea4f6] text-white disabled:opacity-60" title="Apply">
                        {saving ? (
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" role="status" aria-label="Saving image" />
                        ) : (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
