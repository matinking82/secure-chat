import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { getChatAudioIndex } from "../lib/audioIndex";
import { fetchFileWithCache, getDecryptedUrl, setDecryptedUrl } from "../lib/fileCache";
import { getEncryptionKey } from "../lib/storage";
import type { SharedAudioTrack, PlaySharedAudioInput } from "./audioPlayerTypes";

interface AudioPlayerContextType {
    currentTrack: SharedAudioTrack | null;
    playlist: SharedAudioTrack[];
    currentPlaylistIndex: number;
    playing: boolean;
    loading: boolean;
    currentTime: number;
    duration: number;
    detailsOpen: boolean;
    error: string | null;
    playTrack: (input: PlaySharedAudioInput) => Promise<void>;
    pause: () => void;
    resume: () => Promise<void>;
    togglePlayback: () => Promise<void>;
    seek: (time: number) => void;
    playNext: () => Promise<void>;
    playPrev: () => Promise<void>;
    closeTrack: () => void;
    openDetails: () => void;
    closeDetails: () => void;
    isCurrentTrack: (trackKey: string) => boolean;
    isUsingSource: (src: string | null | undefined) => boolean;
}

const AudioPlayerContext = createContext<AudioPlayerContextType | null>(null);

function waitForAudioMetadata(audio: HTMLAudioElement): Promise<void> {
    if (audio.readyState >= 1) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const handleLoaded = () => {
            cleanup();
            resolve();
        };
        const handleError = () => {
            cleanup();
            reject(new Error("Unable to load audio metadata"));
        };
        const cleanup = () => {
            audio.removeEventListener("loadedmetadata", handleLoaded);
            audio.removeEventListener("error", handleError);
        };

        audio.addEventListener("loadedmetadata", handleLoaded, { once: true });
        audio.addEventListener("error", handleError, { once: true });
    });
}

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
    const toPlayInput = (track: SharedAudioTrack): PlaySharedAudioInput => ({
        trackKey: track.trackKey,
        previewSrc: track.src,
        title: track.title,
        chatId: track.chatId,
        chatLabel: track.chatLabel,
        isVoice: track.isVoice,
        fileUrl: track.fileUrl,
        createdAt: track.createdAt,
        artist: track.artist,
        album: track.album,
    });
    const [currentTrack, setCurrentTrack] = useState<SharedAudioTrack | null>(null);
    const [playlist, setPlaylist] = useState<SharedAudioTrack[]>([]);
    const [playing, setPlaying] = useState(false);
    const [loading, setLoading] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const currentTrackRef = useRef<SharedAudioTrack | null>(null);
    const playlistRef = useRef<SharedAudioTrack[]>([]);
    const playTrackRef = useRef<((input: PlaySharedAudioInput) => Promise<void>) | null>(null);
    const ownedSrcRef = useRef<string | null>(null);
    const requestIdRef = useRef(0);
    const currentChatIdRef = useRef<string | null>(null);
    const revokeOwnedSource = useCallback(() => {
        if (ownedSrcRef.current) {
            URL.revokeObjectURL(ownedSrcRef.current);
            ownedSrcRef.current = null;
        }
    }, []);

    const closeTrack = useCallback(() => {
        requestIdRef.current += 1;
        const audio = audioRef.current;
        if (audio) {
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
        }
        revokeOwnedSource();
        currentTrackRef.current = null;
        setCurrentTrack(null);
        setPlaying(false);
        setLoading(false);
        setCurrentTime(0);
        setDuration(0);
        setError(null);
        setDetailsOpen(false);
        setPlaylist([]);
        currentChatIdRef.current = null;
    }, [revokeOwnedSource]);

    const refreshPlaylistForChat = useCallback((chatId: string) => {
        const indexed = getChatAudioIndex(chatId);
        const active = currentTrackRef.current;
        const candidateMap = new Map<string, SharedAudioTrack>();
        for (const item of indexed) {
            const indexedFileUrl = item.encryptedFileUrl || item.fileUrl;
            candidateMap.set(item.trackKey, {
                trackKey: item.trackKey,
                src: indexedFileUrl,
                fileUrl: indexedFileUrl,
                title: item.title,
                chatId: item.chatId,
                chatLabel: item.chatLabel || active?.chatLabel,
                isVoice: item.isVoice,
                createdAt: item.createdAt,
                artist: item.artist,
                album: item.album,
                durationSec: item.durationSec,
            });
        }
        if (active && active.chatId === chatId) {
            const indexedActive = candidateMap.get(active.trackKey);
            candidateMap.set(active.trackKey, {
                ...indexedActive,
                ...active,
                title: active.title || indexedActive?.title || active.fileUrl || "Audio file",
                artist: active.artist || indexedActive?.artist,
                album: active.album || indexedActive?.album,
                durationSec: active.durationSec || indexedActive?.durationSec,
            });
        }
        const bySource = new Map<string, SharedAudioTrack>();
        for (const track of candidateMap.values()) {
            const dedupeKey = JSON.stringify([track.fileUrl || track.src, !!track.isVoice]);
            const existing = bySource.get(dedupeKey);
            const isActive = active?.trackKey === track.trackKey;
            if (!existing || isActive) {
                bySource.set(dedupeKey, track);
            }
        }
        const nextPlaylist = Array.from(bySource.values()).filter((track) => !track.isVoice).sort((a, b) => {
            const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return at - bt;
        });
        setPlaylist(nextPlaylist);
    }, []);

    useEffect(() => {
        const audio = new Audio();
        audio.preload = "metadata";
        audioRef.current = audio;

        const handleLoadedMetadata = () => {
            setDuration(audio.duration || 0);
            setCurrentTime(audio.currentTime || 0);
        };
        const handleTimeUpdate = () => {
            setCurrentTime(audio.currentTime || 0);
        };
        const handlePlay = () => setPlaying(true);
        const handlePause = () => setPlaying(false);
        const handleEnded = () => {
            const active = currentTrackRef.current;
            if (active) {
                const currentPlaylist = playlistRef.current;
                const index = currentPlaylist.findIndex((t) => t.trackKey === active.trackKey);
                if (index >= 0 && index < currentPlaylist.length - 1) {
                    const next = currentPlaylist[index + 1];
                    if (playTrackRef.current) {
                        void playTrackRef.current(toPlayInput(next));
                    }
                    return;
                }
            }
            closeTrack();
        };
        const handleError = () => {
            setLoading(false);
            setPlaying(false);
            setError("Unable to play this audio file.");
        };

        audio.addEventListener("loadedmetadata", handleLoadedMetadata);
        audio.addEventListener("timeupdate", handleTimeUpdate);
        audio.addEventListener("play", handlePlay);
        audio.addEventListener("pause", handlePause);
        audio.addEventListener("ended", handleEnded);
        audio.addEventListener("error", handleError);

        return () => {
            audio.pause();
            audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
            audio.removeEventListener("timeupdate", handleTimeUpdate);
            audio.removeEventListener("play", handlePlay);
            audio.removeEventListener("pause", handlePause);
            audio.removeEventListener("ended", handleEnded);
            audio.removeEventListener("error", handleError);
            revokeOwnedSource();
        };
    }, [closeTrack, revokeOwnedSource]);

    useEffect(() => {
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<{ chatId?: string }>).detail;
            const chatId = detail?.chatId;
            if (!chatId || chatId !== currentChatIdRef.current) return;
            refreshPlaylistForChat(chatId);
        };
        window.addEventListener("sc-audio-index-updated", handler as EventListener);
        return () => window.removeEventListener("sc-audio-index-updated", handler as EventListener);
    }, [refreshPlaylistForChat]);

    const clonePreviewSource = useCallback(async (requestId: number, trackKey: string, previewSrc: string) => {
        try {
            const res = await fetch(previewSrc);
            const blob = await res.blob();
            if (requestId !== requestIdRef.current || currentTrackRef.current?.trackKey !== trackKey) {
                return;
            }

            const ownedSrc = URL.createObjectURL(blob);
            const audio = audioRef.current;
            if (!audio) {
                URL.revokeObjectURL(ownedSrc);
                return;
            }
            if (requestId !== requestIdRef.current || currentTrackRef.current?.trackKey !== trackKey) {
                URL.revokeObjectURL(ownedSrc);
                return;
            }

            const wasPlaying = !audio.paused;
            const seekTo = audio.currentTime || 0;

            audio.src = ownedSrc;
            audio.load();
            await waitForAudioMetadata(audio);

            if (requestId !== requestIdRef.current || currentTrackRef.current?.trackKey !== trackKey) {
                URL.revokeObjectURL(ownedSrc);
                return;
            }

            audio.currentTime = Math.min(seekTo, audio.duration || seekTo);
            setDuration(audio.duration || 0);
            setCurrentTime(audio.currentTime || 0);
            revokeOwnedSource();
            ownedSrcRef.current = ownedSrc;

            const nextTrack = currentTrackRef.current
                ? { ...currentTrackRef.current, src: ownedSrc }
                : null;
            currentTrackRef.current = nextTrack;
            setCurrentTrack(nextTrack);

            if (wasPlaying) {
                await audio.play();
            }
        } catch {
            // Best-effort cloning. The preview source keeps playing even if this fails.
        }
    }, [revokeOwnedSource]);

    const resolveTrackSrc = useCallback(async (track: PlaySharedAudioInput): Promise<string> => {
        const preferred = track.previewSrc;
        if (preferred.startsWith("blob:")) return preferred;
        const fileUrl = track.fileUrl || preferred;
        const cached = getDecryptedUrl(track.chatId, fileUrl);
        if (cached) return cached;
        const key = getEncryptionKey(track.chatId);
        const { data } = await fetchFileWithCache(fileUrl, key, track.chatId);
        const blob = new Blob([data], { type: track.isVoice ? "audio/ogg" : "audio/mpeg" });
        const blobUrl = URL.createObjectURL(blob);
        setDecryptedUrl(track.chatId, fileUrl, blobUrl);
        return blobUrl;
    }, []);

    const playTrack = useCallback(async (input: PlaySharedAudioInput) => {
        const audio = audioRef.current;
        if (!audio) return;

        const activeTrack = currentTrackRef.current;
        if (activeTrack?.trackKey === input.trackKey) {
            if (typeof input.startTime === "number") {
                audio.currentTime = Math.max(0, Math.min(input.startTime, audio.duration || input.startTime));
                setCurrentTime(audio.currentTime || 0);
            }
            try {
                await audio.play();
            } catch {
                setError("Unable to resume this audio file.");
            }
            return;
        }

        requestIdRef.current += 1;
        const requestId = requestIdRef.current;

        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        revokeOwnedSource();

        const nextTrack: SharedAudioTrack = {
            trackKey: input.trackKey,
            src: input.previewSrc,
            title: input.title,
            chatId: input.chatId,
            chatLabel: input.chatLabel,
            isVoice: input.isVoice,
            fileUrl: input.fileUrl,
            createdAt: input.createdAt,
            artist: input.artist,
            album: input.album,
            durationSec: input.durationSec,
        };
        currentTrackRef.current = nextTrack;
        setCurrentTrack(nextTrack);
        currentChatIdRef.current = input.chatId;
        refreshPlaylistForChat(input.chatId);
        setLoading(true);
        setPlaying(false);
        setCurrentTime(0);
        setDuration(0);
        setError(null);

        try {
            const resolvedSrc = await resolveTrackSrc(input);
            audio.src = resolvedSrc;
            audio.load();
            await waitForAudioMetadata(audio);

            if (requestId !== requestIdRef.current || currentTrackRef.current?.trackKey !== input.trackKey) {
                return;
            }

            if (typeof input.startTime === "number") {
                audio.currentTime = Math.max(0, Math.min(input.startTime, audio.duration || input.startTime));
            }

            currentTrackRef.current = {
                ...nextTrack,
                src: resolvedSrc,
                durationSec: audio.duration || nextTrack.durationSec,
            };
            setCurrentTrack(currentTrackRef.current);
            setDuration(audio.duration || 0);
            setCurrentTime(audio.currentTime || 0);
            await audio.play();
            setLoading(false);

            void clonePreviewSource(requestId, input.trackKey, resolvedSrc);
        } catch {
            if (requestId !== requestIdRef.current) return;
            setLoading(false);
            setPlaying(false);
            setError("Unable to play this audio file.");
        }
    }, [clonePreviewSource, refreshPlaylistForChat, resolveTrackSrc, revokeOwnedSource]);

    useEffect(() => {
        playlistRef.current = playlist;
    }, [playlist]);

    useEffect(() => {
        playTrackRef.current = playTrack;
    }, [playTrack]);

    const pause = useCallback(() => {
        audioRef.current?.pause();
    }, []);

    const resume = useCallback(async () => {
        const audio = audioRef.current;
        if (!audio || !currentTrackRef.current) return;
        try {
            await audio.play();
        } catch {
            setError("Unable to resume this audio file.");
        }
    }, []);

    const togglePlayback = useCallback(async () => {
        const audio = audioRef.current;
        if (!audio || !currentTrackRef.current) return;
        if (audio.paused) {
            await resume();
        } else {
            pause();
        }
    }, [pause, resume]);

    const seek = useCallback((time: number) => {
        const audio = audioRef.current;
        if (!audio || !currentTrackRef.current) return;
        audio.currentTime = Math.max(0, Math.min(time, audio.duration || time));
        setCurrentTime(audio.currentTime || 0);
    }, []);

    const playNext = useCallback(async () => {
        if (!currentTrackRef.current) return;
        const index = playlist.findIndex((t) => t.trackKey === currentTrackRef.current?.trackKey);
        if (index < 0 || index >= playlist.length - 1) return;
        const next = playlist[index + 1];
        await playTrack(toPlayInput(next));
    }, [playTrack, playlist]);

    const playPrev = useCallback(async () => {
        if (!currentTrackRef.current) return;
        const index = playlist.findIndex((t) => t.trackKey === currentTrackRef.current?.trackKey);
        if (index <= 0) return;
        const prev = playlist[index - 1];
        await playTrack(toPlayInput(prev));
    }, [playTrack, playlist]);

    const currentPlaylistIndex = currentTrack
        ? playlist.findIndex((t) => t.trackKey === currentTrack.trackKey)
        : -1;

    const openDetails = useCallback(() => setDetailsOpen(true), []);
    const closeDetails = useCallback(() => setDetailsOpen(false), []);
    const isCurrentTrack = useCallback((trackKey: string) => currentTrackRef.current?.trackKey === trackKey, []);
    const isUsingSource = useCallback((src: string | null | undefined) => !!src && currentTrackRef.current?.src === src, []);

    return (
        <AudioPlayerContext.Provider
            value={{
                currentTrack,
                playlist,
                currentPlaylistIndex,
                playing,
                loading,
                currentTime,
                duration,
                detailsOpen,
                error,
                playTrack,
                pause,
                resume,
                togglePlayback,
                seek,
                playNext,
                playPrev,
                closeTrack,
                openDetails,
                closeDetails,
                isCurrentTrack,
                isUsingSource,
            }}
        >
            {children}
        </AudioPlayerContext.Provider>
    );
}

export function useAudioPlayer() {
    const context = useContext(AudioPlayerContext);
    if (!context) {
        throw new Error("useAudioPlayer must be used within an AudioPlayerProvider");
    }
    return context;
}
