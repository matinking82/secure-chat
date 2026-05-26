import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "../ui/Modal";
import { useAudioPlayer } from "../../contexts/AudioPlayerContext";
import { readAudioMetadata } from "../../lib/audioMetadata";

function formatTime(totalSeconds: number): string {
    if (!totalSeconds || !isFinite(totalSeconds)) return "0:00";
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function GlobalAudioPlayer() {
    const {
        currentTrack,
        playing,
        loading,
        currentTime,
        duration,
        detailsOpen,
        error,
        togglePlayback,
        seek,
        playNext,
        playPrev,
        playTrack,
        closeTrack,
        openDetails,
        closeDetails,
        playlist,
        currentPlaylistIndex,
    } = useAudioPlayer();

    const [parsedTitle, setParsedTitle] = useState("");
    const [parsedArtist, setParsedArtist] = useState("");
    const [parsedAlbum, setParsedAlbum] = useState("");
    const [coverArtUrl, setCoverArtUrl] = useState("");
    const [playlistMeta, setPlaylistMeta] = useState<Record<string, { title?: string; artist?: string; album?: string }>>({});
    const coverArtUrlRef = useRef("");
    const loadingPlaylistMetaRef = useRef<Set<string>>(new Set());
    const pendingMetaQueueRef = useRef<string[]>([]);
    const activeMetaRequestsRef = useRef(0);
    const loadQueuedPlaylistMetadataRef = useRef<() => void>(() => {});
    const playlistSnapshotRef = useRef(playlist);
    const playlistMetaSnapshotRef = useRef(playlistMeta);
    const maxMetaConcurrent = 3;

    useEffect(() => {
        playlistSnapshotRef.current = playlist;
    }, [playlist]);

    useEffect(() => {
        playlistMetaSnapshotRef.current = playlistMeta;
    }, [playlistMeta]);

    const loadQueuedPlaylistMetadata = useCallback(() => {
        while (activeMetaRequestsRef.current < maxMetaConcurrent && pendingMetaQueueRef.current.length > 0) {
            const key = pendingMetaQueueRef.current.shift();
            if (!key) break;
            const track = playlistSnapshotRef.current.find((item) => item.trackKey === key);
            if (!track) continue;
            if (playlistMetaSnapshotRef.current[track.trackKey]?.title) continue;
            loadingPlaylistMetaRef.current.add(track.trackKey);
            activeMetaRequestsRef.current += 1;
            const src = track.fileUrl || track.src;
            readAudioMetadata(src, { includeCoverArt: false }).then((meta) => {
                if (!meta) return;
                setPlaylistMeta((prev) => ({
                    ...prev,
                    [track.trackKey]: {
                        title: meta.title || track.title,
                        artist: meta.artist || track.artist,
                        album: meta.album || track.album,
                    },
                }));
            }).catch(() => {
                // Ignore metadata read errors for individual playlist rows.
            }).finally(() => {
                loadingPlaylistMetaRef.current.delete(track.trackKey);
                activeMetaRequestsRef.current = Math.max(0, activeMetaRequestsRef.current - 1);
                loadQueuedPlaylistMetadataRef.current();
            });
        }
    }, []);

    useEffect(() => {
        loadQueuedPlaylistMetadataRef.current = loadQueuedPlaylistMetadata;
    }, [loadQueuedPlaylistMetadata]);

    useEffect(() => {
        if (!currentTrack) {
            setParsedTitle("");
            setParsedArtist("");
            setParsedAlbum("");
            if (coverArtUrlRef.current) {
                URL.revokeObjectURL(coverArtUrlRef.current);
                coverArtUrlRef.current = "";
            }
            setCoverArtUrl("");
            return;
        }
        let mounted = true;
        const src = currentTrack.fileUrl || currentTrack.src;
        readAudioMetadata(src, { includeCoverArt: true }).then((meta) => {
            if (!mounted) return;
            if (coverArtUrlRef.current) {
                URL.revokeObjectURL(coverArtUrlRef.current);
                coverArtUrlRef.current = "";
            }
            setParsedTitle(meta?.title || "");
            setParsedArtist(meta?.artist || "");
            setParsedAlbum(meta?.album || "");
            const nextCover = meta?.coverArtUrl || "";
            coverArtUrlRef.current = nextCover;
            setCoverArtUrl(nextCover);
        }).catch(() => {
            if (!mounted) return;
            if (coverArtUrlRef.current) {
                URL.revokeObjectURL(coverArtUrlRef.current);
                coverArtUrlRef.current = "";
            }
            setParsedTitle("");
            setParsedArtist("");
            setParsedAlbum("");
            setCoverArtUrl("");
        });
        return () => {
            mounted = false;
        };
    }, [currentTrack]);

    useEffect(() => {
        playlist.forEach((track) => {
            if (loadingPlaylistMetaRef.current.has(track.trackKey)) return;
            if (playlistMeta[track.trackKey]?.title) return;
            if (!pendingMetaQueueRef.current.includes(track.trackKey)) {
                pendingMetaQueueRef.current.push(track.trackKey);
            }
        });
        loadQueuedPlaylistMetadataRef.current();
    }, [playlist, playlistMeta, loadQueuedPlaylistMetadata]);

    useEffect(() => {
        return () => {
            if (coverArtUrlRef.current) {
                URL.revokeObjectURL(coverArtUrlRef.current);
                coverArtUrlRef.current = "";
            }
        };
    }, []);

    const displayPlaylist = useMemo(() => playlist.map((track) => {
        const meta = playlistMeta[track.trackKey];
        return {
            ...track,
            title: meta?.title || track.title,
            artist: meta?.artist || track.artist,
            album: meta?.album || track.album,
        };
    }), [playlist, playlistMeta]);

    if (!currentTrack) return null;

    const displayTitle = parsedTitle || currentTrack.title;
    const displayArtist = parsedArtist || currentTrack.artist;
    const displayAlbum = parsedAlbum || currentTrack.album;
    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    const handleSeek = (event: React.MouseEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        seek(ratio * duration);
    };

    return (
        <>
            <div
                className="shrink-0 border-b border-[#0e1621] bg-[#17212b]"
                style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
            >
                <div
                    onClick={openDetails}
                    className="flex items-center gap-3 px-3 py-2.5 md:px-4 cursor-pointer select-none"
                >
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            void togglePlayback();
                        }}
                        className="w-10 h-10 rounded-full bg-[#4ea4f6] hover:bg-[#3d93e5] text-white flex items-center justify-center shrink-0 transition disabled:opacity-60"
                        disabled={loading}
                        title={playing ? "Pause" : "Play"}
                    >
                        {loading ? (
                            <div className="w-4 h-4 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
                        ) : playing ? (
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                            </svg>
                        ) : (
                            <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                            </svg>
                        )}
                    </button>

                    <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2 min-w-0">
                            <span className="text-lg shrink-0 mt-0.5 hidden sm:inline">{currentTrack.isVoice ? "🎙️" : "🎵"}</span>
                            <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-white truncate">{displayTitle}</div>
                                <div className="text-xs text-[#4ea4f6] truncate">
                                    {currentTrack.chatLabel || currentTrack.chatId}
                                </div>
                            </div>
                            <div className="text-xs text-gray-400 shrink-0 whitespace-nowrap pl-2">
                                {formatTime(currentTime)} / {formatTime(duration)}
                            </div>
                        </div>
                        <div className="mt-2 h-1 rounded-full bg-[#0e1621]/80 overflow-hidden">
                            <div
                                className="h-full rounded-full bg-[#4ea4f6] transition-all duration-150"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    </div>

                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            closeTrack();
                        }}
                        className="w-9 h-9 rounded-full text-gray-400 hover:text-white hover:bg-[#1e2c3a] flex items-center justify-center shrink-0 transition"
                        title="Close player"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>

            <Modal open={detailsOpen} onClose={closeDetails} title="Now Playing" panelClassName="max-w-[min(96vw,1200px)] lg:max-w-[1100px]">
                <div className="space-y-5 xl:space-y-0 xl:grid xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,1fr)] xl:gap-6">
                    <div className="space-y-4 sm:space-y-5 min-w-0">
                        <div className="rounded-2xl border border-[#2b5278]/30 bg-[#0e1621]/70 p-5 text-center">
                            {coverArtUrl ? (
                                <img
                                    src={coverArtUrl}
                                    alt="Album cover"
                                    className="w-28 h-28 object-cover rounded-xl mx-auto mb-4 border border-[#2b5278]/40"
                                />
                            ) : (
                                <div className="text-5xl mb-4">{currentTrack.isVoice ? "🎙️" : "🎵"}</div>
                            )}
                            <div className="text-white text-lg font-semibold break-words">{displayTitle}</div>
                            {(displayArtist || displayAlbum) && (
                                <div className="text-sm text-gray-400 mt-1">
                                    {[displayArtist, displayAlbum].filter(Boolean).join(" • ")}
                                </div>
                            )}
                            <div className="text-sm text-gray-400 mt-1">
                                {currentTrack.chatLabel || currentTrack.chatId}
                            </div>
                            <div className="text-xs uppercase tracking-[0.2em] text-[#4ea4f6] mt-3">
                                {currentTrack.isVoice ? "Voice message" : "Audio file"}
                            </div>
                        </div>

                        <div>
                            <div
                                className="h-2 rounded-full bg-[#0e1621] cursor-pointer overflow-hidden"
                                onClick={handleSeek}
                            >
                                <div
                                    className="h-full rounded-full bg-[#4ea4f6] transition-all duration-150"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <div className="flex justify-between mt-2 text-xs text-gray-400">
                                <span>{formatTime(currentTime)}</span>
                                <span>{formatTime(duration)}</span>
                            </div>
                        </div>

                        {error && (
                            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                                {error}
                            </div>
                        )}

                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => void playPrev()}
                                className="w-11 h-11 rounded-xl border border-[#2b5278]/50 text-gray-300 hover:text-white hover:bg-[#1e2c3a] transition flex items-center justify-center"
                                title="Previous"
                            >
                                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M6 5h2v14H6V5zm3 7l9 7V5l-9 7z" />
                                </svg>
                            </button>
                            <button
                                onClick={() => void togglePlayback()}
                                className="flex-1 py-3 rounded-xl bg-[#4ea4f6] hover:bg-[#3d93e5] text-white font-medium transition disabled:opacity-60 flex items-center justify-center"
                                disabled={loading}
                                title={loading ? "Loading" : playing ? "Pause" : "Play"}
                            >
                                {loading ? (
                                    <div className="w-4 h-4 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
                                ) : playing ? (
                                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                                    </svg>
                                ) : (
                                    <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M8 5v14l11-7z" />
                                    </svg>
                                )}
                            </button>
                            <button
                                onClick={() => void playNext()}
                                className="w-11 h-11 rounded-xl border border-[#2b5278]/50 text-gray-300 hover:text-white hover:bg-[#1e2c3a] transition flex items-center justify-center"
                                title="Next"
                            >
                                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M16 5h2v14h-2V5zM7 5v14l9-7-9-7z" />
                                </svg>
                            </button>
                            <button
                                onClick={closeTrack}
                                className="w-11 h-11 rounded-xl border border-[#2b5278]/50 text-gray-300 hover:text-white hover:bg-[#1e2c3a] transition flex items-center justify-center"
                                title="Close"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    {displayPlaylist.length > 1 && (
                        <div className="space-y-2 xl:pl-1 min-w-0">
                            <div className="text-xs text-gray-400 text-center xl:text-left">
                                Track {currentPlaylistIndex >= 0 ? currentPlaylistIndex + 1 : 1} of {displayPlaylist.length}
                            </div>
                            <div className="max-h-[34dvh] sm:max-h-[42dvh] xl:max-h-[56dvh] overflow-y-auto rounded-xl border border-[#2b5278]/30 bg-[#0e1621]/50 divide-y divide-[#2b5278]/20">
                                {displayPlaylist.map((track, idx) => {
                                    const isActive = idx === currentPlaylistIndex;
                                    return (
                                        <button
                                            key={track.trackKey}
                                            onClick={() => void playTrack({
                                                trackKey: track.trackKey,
                                                previewSrc: track.fileUrl || track.src,
                                                title: track.title,
                                                chatId: track.chatId,
                                                chatLabel: track.chatLabel,
                                                isVoice: track.isVoice,
                                                fileUrl: track.fileUrl,
                                                createdAt: track.createdAt,
                                                artist: track.artist,
                                                album: track.album,
                                                durationSec: track.durationSec,
                                            })}
                                            className={`w-full text-left px-3 py-2 transition ${isActive ? "bg-[#4ea4f6]/20 text-white" : "text-gray-300 hover:bg-[#1e2c3a]"}`}
                                            title={track.title}
                                        >
                                            <div className="flex items-center gap-2">
                                                <div className="text-sm truncate flex-1">{track.title}</div>
                                                <div className="text-[11px] text-gray-400 shrink-0">
                                                    {formatTime(track.durationSec || 0)}
                                                </div>
                                            </div>
                                            <div className="text-[11px] text-gray-400 truncate">
                                                {[track.artist, track.album].filter(Boolean).join(" • ") || (track.chatLabel || track.chatId)}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </Modal>
        </>
    );
}
