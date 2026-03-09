import { useState, useRef, useEffect, useMemo } from "react";
import { useChat } from "../../contexts/ChatContext";
import { useAudioPlayer } from "../../contexts/AudioPlayerContext";

interface AudioPlayerProps {
    src: string;
    chatId: string;
    trackId?: number;
    name?: string;
    isVoice?: boolean;
}

export default function AudioPlayer({ src, chatId, trackId, name, isVoice }: AudioPlayerProps) {
    const { chats } = useChat();
    const {
        playing,
        loading,
        currentTime,
        duration,
        playTrack,
        togglePlayback,
        seek: seekToPosition,
        isCurrentTrack,
    } = useAudioPlayer();
    const audioRef = useRef<HTMLAudioElement>(null);
    const [localDuration, setLocalDuration] = useState(0);
    const progressRef = useRef<HTMLDivElement>(null);
    const chatLabel = chats.find((chat) => chat.chatId === chatId)?.label || chatId;
    const trackKey = `${chatId}:${trackId ?? src}:${isVoice ? "voice" : "audio"}`;
    const isActiveTrack = isCurrentTrack(trackKey);
    const displayedCurrentTime = isActiveTrack ? currentTime : 0;
    const displayedDuration = isActiveTrack ? duration : localDuration;
    const isPlaying = isActiveTrack ? playing : false;
    const title = name || (isVoice ? "Voice message" : "Audio file");

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const onLoaded = () => setLocalDuration(audio.duration || 0);

        audio.addEventListener("loadedmetadata", onLoaded);
        return () => {
            audio.removeEventListener("loadedmetadata", onLoaded);
        };
    }, [src]);

    const toggle = () => {
        if (isActiveTrack) {
            void togglePlayback();
        } else {
            void playTrack({
                trackKey,
                previewSrc: src,
                title,
                chatId,
                chatLabel,
                isVoice,
            });
        }
    };

    const handleSeek = (e: React.MouseEvent | React.TouchEvent) => {
        const bar = progressRef.current;
        if (!bar || !displayedDuration) return;

        const rect = bar.getBoundingClientRect();
        const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const targetTime = ratio * displayedDuration;

        if (isActiveTrack) {
            seekToPosition(targetTime);
        } else {
            void playTrack({
                trackKey,
                previewSrc: src,
                title,
                chatId,
                chatLabel,
                isVoice,
                startTime: targetTime,
            });
        }
    };

    const formatTime = (s: number) => {
        if (!s || !isFinite(s)) return "0:00";
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec.toString().padStart(2, "0")}`;
    };

    const progress = displayedDuration > 0 ? (displayedCurrentTime / displayedDuration) * 100 : 0;

    // Generate waveform bars for voice messages
    const waveformBars = useMemo(() => {
        if (!isVoice) return null;
        return Array.from({ length: 32 }, (_, i) => {
            const height = 8 + Math.sin(i * 0.7 + 2) * 8 + Math.cos(i * 1.3) * 6 + (i % 3);
            return Math.max(4, Math.min(24, height));
        });
    }, [isVoice]);

    return (
        <div className={`flex items-center gap-2.5 ${isVoice ? "min-w-[200px] max-w-[280px]" : "min-w-[220px] max-w-[300px]"}`}>
            <audio ref={audioRef} src={src} preload="metadata" />

            {/* Play/Pause button */}
            <button
                onClick={toggle}
                className="w-10 h-10 rounded-full bg-[#4ea4f6] hover:bg-[#3d93e5] flex items-center justify-center shrink-0 transition disabled:opacity-60"
                disabled={loading && isActiveTrack}
            >
                {loading && isActiveTrack ? (
                    <div className="w-4 h-4 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
                ) : isPlaying ? (
                    <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                ) : (
                    <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                    </svg>
                )}
            </button>

            <div className="flex-1 min-w-0">
                {/* Waveform or progress bar */}
                {isVoice && waveformBars ? (
                    <div
                        ref={progressRef}
                        className="flex items-end gap-[2px] h-6 cursor-pointer"
                        onClick={handleSeek}
                    >
                        {waveformBars.map((h, i) => {
                            const barProgress = (i / waveformBars.length) * 100;
                            return (
                                <div
                                    key={i}
                                    className="flex-1 rounded-full transition-colors duration-150"
                                    style={{
                                        height: `${h}px`,
                                        backgroundColor: barProgress <= progress ? "#4ea4f6" : "#3a4a5c",
                                        minWidth: "2px",
                                    }}
                                />
                            );
                        })}
                    </div>
                ) : (
                    <div>
                        {title && (
                            <div className="text-xs text-white truncate mb-1">{title}</div>
                        )}
                        <div
                            ref={progressRef}
                            className="h-1 bg-[#3a4a5c] rounded-full cursor-pointer relative"
                            onClick={handleSeek}
                        >
                            <div
                                className="h-full bg-[#4ea4f6] rounded-full transition-all duration-100 relative"
                                style={{ width: `${progress}%` }}
                            >
                                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md" />
                            </div>
                        </div>
                    </div>
                )}

                {/* Time */}
                <div className="flex justify-between mt-1">
                    <span className="text-[11px] text-gray-400">
                        {formatTime(displayedCurrentTime)}
                    </span>
                    <span className="text-[11px] text-gray-400">{formatTime(displayedDuration)}</span>
                </div>
            </div>
        </div>
    );
}
