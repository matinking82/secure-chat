import { useState, useRef, useEffect, useMemo } from "react";
import { useChat } from "../../contexts/ChatContext";
import { useAudioPlayer } from "../../contexts/AudioPlayerContext";
import { readAudioMetadata } from "../../lib/audioMetadata";
import { upsertChatAudioIndex } from "../../lib/audioIndex";

const FALLBACK_CREATED_AT = "1970-01-01T00:00:00.000Z";

interface AudioPlayerProps {
    src: string;
    encryptedFileUrl?: string;
    chatId: string;
    trackId?: number;
    name?: string;
    isVoice?: boolean;
    createdAt?: string;
}

export default function AudioPlayer({ src, encryptedFileUrl, chatId, trackId, name, isVoice, createdAt }: AudioPlayerProps) {
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
    const [metaTitle, setMetaTitle] = useState("");
    const [artist, setArtist] = useState("");
    const [album, setAlbum] = useState("");
    const progressRef = useRef<HTMLDivElement>(null);
    const chatLabel = chats.find((chat) => chat.chatId === chatId)?.label || chatId;
    const trackKey = `${chatId}:${trackId ?? src}:${isVoice ? "voice" : "audio"}`;
    const sourceFileUrl = encryptedFileUrl || src;
    const isActiveTrack = isCurrentTrack(trackKey);
    const displayedCurrentTime = isActiveTrack ? currentTime : 0;
    const displayedDuration = isActiveTrack ? duration : localDuration;
    const isPlaying = isActiveTrack ? playing : false;
    const title = name || (isVoice ? "Voice message" : "Audio file");
    const resolvedTitle = metaTitle || title;

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const onLoaded = () => setLocalDuration(audio.duration || 0);

        audio.addEventListener("loadedmetadata", onLoaded);
        return () => {
            audio.removeEventListener("loadedmetadata", onLoaded);
        };
    }, [src]);

    useEffect(() => {
        let mounted = true;
        readAudioMetadata(src).then((meta) => {
            if (!mounted || !meta) return;
            setMetaTitle(meta.title || "");
            setArtist(meta.artist || "");
            setAlbum(meta.album || "");
            upsertChatAudioIndex(chatId, [{
                trackKey,
                fileUrl: sourceFileUrl,
                encryptedFileUrl,
                title: meta.title || title,
                chatId,
                chatLabel,
                isVoice,
                createdAt: createdAt || FALLBACK_CREATED_AT,
                artist: meta.artist || undefined,
                album: meta.album || undefined,
            }]);
        });
        return () => {
            mounted = false;
        };
    }, [src, sourceFileUrl, encryptedFileUrl, chatId, trackKey, title, chatLabel, isVoice, createdAt]);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio || !localDuration) return;
        upsertChatAudioIndex(chatId, [{
            trackKey,
            fileUrl: sourceFileUrl,
            encryptedFileUrl,
            title: resolvedTitle,
            chatId,
            chatLabel,
            isVoice,
            createdAt: createdAt || FALLBACK_CREATED_AT,
            artist: artist || undefined,
            album: album || undefined,
            durationSec: localDuration,
        }]);
    }, [localDuration, chatId, trackKey, src, sourceFileUrl, encryptedFileUrl, resolvedTitle, chatLabel, isVoice, artist, album, createdAt]);

    const toggle = () => {
        if (isActiveTrack) {
            void togglePlayback();
        } else {
            void playTrack({
                trackKey,
                previewSrc: src,
                title: resolvedTitle,
                chatId,
                chatLabel,
                isVoice,
                fileUrl: sourceFileUrl,
                artist: artist || undefined,
                album: album || undefined,
                durationSec: displayedDuration || undefined,
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
                title: resolvedTitle,
                chatId,
                chatLabel,
                isVoice,
                startTime: targetTime,
                fileUrl: sourceFileUrl,
                artist: artist || undefined,
                album: album || undefined,
                durationSec: displayedDuration || undefined,
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
        <div className="flex items-center gap-2.5 w-[280px] sm:w-[320px]">
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
                            <div className="text-xs text-white truncate mb-1">{resolvedTitle}</div>
                        )}
                        {artist && (
                            <div className="text-[10px] text-gray-400 truncate mb-1">
                                {artist}{album ? ` • ${album}` : ""}
                            </div>
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
