import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";

export interface SharedAudioTrack {
    trackKey: string;
    src: string;
    title: string;
    chatId: string;
    chatLabel?: string;
    isVoice?: boolean;
}

interface PlaySharedAudioInput {
    trackKey: string;
    previewSrc: string;
    title: string;
    chatId: string;
    chatLabel?: string;
    isVoice?: boolean;
    startTime?: number;
}

interface AudioPlayerContextType {
    currentTrack: SharedAudioTrack | null;
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
    const [currentTrack, setCurrentTrack] = useState<SharedAudioTrack | null>(null);
    const [playing, setPlaying] = useState(false);
    const [loading, setLoading] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const currentTrackRef = useRef<SharedAudioTrack | null>(null);
    const ownedSrcRef = useRef<string | null>(null);
    const requestIdRef = useRef(0);

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
    }, [revokeOwnedSource]);

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

    const playTrack = useCallback(async (input: PlaySharedAudioInput) => {
        const audio = audioRef.current;
        if (!audio) return;

        const activeTrack = currentTrackRef.current;
        if (activeTrack?.trackKey === input.trackKey) {
            if (typeof input.startTime === "number") {
                audio.currentTime = Math.max(0, Math.min(input.startTime, duration || input.startTime));
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
        };
        currentTrackRef.current = nextTrack;
        setCurrentTrack(nextTrack);
        setLoading(true);
        setPlaying(false);
        setCurrentTime(0);
        setDuration(0);
        setError(null);

        try {
            audio.src = input.previewSrc;
            audio.load();
            await waitForAudioMetadata(audio);

            if (requestId !== requestIdRef.current || currentTrackRef.current?.trackKey !== input.trackKey) {
                return;
            }

            if (typeof input.startTime === "number") {
                audio.currentTime = Math.max(0, Math.min(input.startTime, audio.duration || input.startTime));
            }

            setDuration(audio.duration || 0);
            setCurrentTime(audio.currentTime || 0);
            await audio.play();
            setLoading(false);

            void clonePreviewSource(requestId, input.trackKey, input.previewSrc);
        } catch {
            if (requestId !== requestIdRef.current) return;
            setLoading(false);
            setPlaying(false);
            setError("Unable to play this audio file.");
        }
    }, [clonePreviewSource, duration, revokeOwnedSource]);

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

    const openDetails = useCallback(() => setDetailsOpen(true), []);
    const closeDetails = useCallback(() => setDetailsOpen(false), []);
    const isCurrentTrack = useCallback((trackKey: string) => currentTrackRef.current?.trackKey === trackKey, []);
    const isUsingSource = useCallback((src: string | null | undefined) => !!src && currentTrackRef.current?.src === src, []);

    return (
        <AudioPlayerContext.Provider
            value={{
                currentTrack,
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
