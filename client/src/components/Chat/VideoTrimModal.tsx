import { useEffect, useMemo, useRef, useState } from "react";

interface VideoTrimModalProps {
    file: File;
    onApply: (file: File) => void;
    onClose: () => void;
}

const MAX_TRIM_DURATION_SECONDS = 30;

export default function VideoTrimModal({ file, onApply, onClose }: VideoTrimModalProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [duration, setDuration] = useState(0);
    const [startTime, setStartTime] = useState(0);
    const [endTime, setEndTime] = useState(0);
    const [previewTime, setPreviewTime] = useState(0);
    const [saving, setSaving] = useState(false);

    const objectUrl = useMemo(() => URL.createObjectURL(file), [file]);
    useEffect(() => () => URL.revokeObjectURL(objectUrl), [objectUrl]);

    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", handleKey);
        return () => document.removeEventListener("keydown", handleKey);
    }, [onClose]);

    const clampWindow = (start: number, end: number): [number, number] => {
        if (!duration) return [0, 0];
        let s = Math.max(0, Math.min(start, duration));
        let e = Math.max(0, Math.min(end, duration));
        if (e < s) [s, e] = [e, s];
        if (e - s > MAX_TRIM_DURATION_SECONDS) {
            e = s + MAX_TRIM_DURATION_SECONDS;
            if (e > duration) {
                e = duration;
                s = Math.max(0, e - MAX_TRIM_DURATION_SECONDS);
            }
        }
        return [s, e];
    };

    const handleLoadedMetadata = () => {
        const d = videoRef.current?.duration || 0;
        setDuration(d);
        setStartTime(0);
        setEndTime(d);
        setPreviewTime(0);
    };

    const handleStartChange = (value: number) => {
        const [s, e] = clampWindow(value, endTime);
        setStartTime(s);
        setEndTime(e);
        setPreviewTime(s);
        if (videoRef.current) videoRef.current.currentTime = s;
    };

    const handleEndChange = (value: number) => {
        const [s, e] = clampWindow(startTime, value);
        setStartTime(s);
        setEndTime(e);
        setPreviewTime(Math.min(Math.max(previewTime, s), e));
    };

    const handleApply = async () => {
        setSaving(true);
        try {
            const [s, e] = clampWindow(startTime, endTime);
            const video = videoRef.current;
            if (!video) return;

            // Best-effort browser-native trim via captureStream + MediaRecorder.
            const capture = (video as HTMLVideoElement & {
                captureStream?: () => MediaStream;
                mozCaptureStream?: () => MediaStream;
            }).captureStream?.() || (video as HTMLVideoElement & { mozCaptureStream?: () => MediaStream }).mozCaptureStream?.();

            if (!capture || typeof MediaRecorder === "undefined") {
                // Fallback: keep original file when stream recording is unsupported.
                onApply(file);
                return;
            }

            const mimeCandidates = [
                "video/webm;codecs=vp9,opus",
                "video/webm;codecs=vp8,opus",
                "video/webm",
                "video/mp4",
            ];
            const recorderMime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || "";
            const recorder = recorderMime
                ? new MediaRecorder(capture, { mimeType: recorderMime })
                : new MediaRecorder(capture);
            const chunks: BlobPart[] = [];

            const trimmedBlob = await new Promise<Blob>((resolve, reject) => {
                let stopTimer: ReturnType<typeof setTimeout> | null = null;

                recorder.ondataavailable = (ev) => {
                    if (ev.data && ev.data.size > 0) chunks.push(ev.data);
                };
                recorder.onerror = () => {
                    reject(new Error("Video trim recording failed"));
                };
                recorder.onstop = () => {
                    if (stopTimer) clearTimeout(stopTimer);
                    const blobType = recorder.mimeType || "video/webm";
                    resolve(new Blob(chunks, { type: blobType }));
                };

                video.pause();
                video.currentTime = s;
                const playPromise = video.play();
                void playPromise?.catch(reject);

                recorder.start(100);
                stopTimer = setTimeout(() => {
                    if (recorder.state !== "inactive") recorder.stop();
                    video.pause();
                }, Math.max(100, (e - s) * 1000));
            });

            const originalName = file.name;
            const extension = trimmedBlob.type.includes("mp4") ? "mp4" : "webm";
            const baseName = originalName.replace(/\.[^.]+$/, "") || "video";
            const outName = `${baseName}-trimmed.${extension}`;
            const outFile = new File([trimmedBlob], outName, {
                type: trimmedBlob.type || file.type || "video/webm",
            });
            onApply(outFile);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[310] bg-black/80 flex items-center justify-center p-3" onClick={onClose}>
            <div className="w-full max-w-3xl bg-[#17212b] rounded-2xl border border-[#2b5278]/50 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="px-4 py-3 border-b border-[#2b5278]/40 flex items-center justify-between">
                    <h3 className="text-white font-semibold text-sm">Trim video</h3>
                    <button onClick={onClose} className="text-gray-300 hover:text-white p-1.5 rounded-full hover:bg-white/10" title="Close">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div className="p-4 space-y-4">
                    <video
                        ref={videoRef}
                        src={objectUrl}
                        controls
                        className="w-full max-h-[50vh] rounded-lg bg-black"
                        onLoadedMetadata={handleLoadedMetadata}
                        onTimeUpdate={(e) => setPreviewTime((e.target as HTMLVideoElement).currentTime)}
                    />
                    <div className="text-xs text-gray-300">
                        Maximum clip length: {MAX_TRIM_DURATION_SECONDS}s
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs text-gray-300 block">Start: {startTime.toFixed(1)}s</label>
                        <input
                            type="range"
                            min={0}
                            max={duration || 0}
                            step={0.1}
                            value={startTime}
                            onChange={(e) => handleStartChange(Number(e.target.value))}
                            className="w-full"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs text-gray-300 block">End: {endTime.toFixed(1)}s</label>
                        <input
                            type="range"
                            min={0}
                            max={duration || 0}
                            step={0.1}
                            value={endTime}
                            onChange={(e) => handleEndChange(Number(e.target.value))}
                            className="w-full"
                        />
                    </div>
                    <div className="text-xs text-gray-400">
                        Clip duration: {Math.max(0, endTime - startTime).toFixed(1)}s • Preview: {previewTime.toFixed(1)}s
                    </div>
                </div>
                <div className="px-4 py-3 border-t border-[#2b5278]/40 flex items-center justify-end gap-2">
                    <button onClick={onClose} className="p-2 rounded-full bg-[#1e2c3a] text-gray-200 hover:text-white" title="Cancel">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                    <button onClick={handleApply} disabled={saving} className="p-2 rounded-full bg-[#4ea4f6] text-white disabled:opacity-60" title="Apply trim">
                        {saving ? (
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" role="status" aria-label="Applying trim" />
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
