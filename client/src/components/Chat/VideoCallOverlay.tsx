import { useCallback, useState, useEffect } from "react";
import type { VoiceParticipant } from "../../types";

interface VideoCallOverlayProps {
    participants: VoiceParticipant[];
    callDuration: number;
    isMuted: boolean;
    isVideoOn: boolean;
    browserId: string;
    localStream: MediaStream | null;
    remoteStreams: Map<string, MediaStream>;
    onToggleMute: () => void;
    onToggleVideo: () => void;
    onLeave: () => void;
}

// ─── Individual video tile ───
function VideoTile({
    participant,
    stream,
    isLocal,
    isMuted,
    color,
    videoEnabled,
}: {
    participant: VoiceParticipant;
    stream: MediaStream | null;
    isLocal: boolean;
    isMuted?: boolean;
    color: string;
    videoEnabled: boolean;
}) {
    // Use the signaled videoEnabled flag as the primary source of truth.
    // For local: the parent passes the local isVideoOn state.
    // For remote: participant.videoEnabled is synced via socket events.
    // Additionally check that the stream actually has a live video track.
    const [hasLiveTrack, setHasLiveTrack] = useState(false);

    useEffect(() => {
        if (!stream) { setHasLiveTrack(false); return; }

        const checkTrack = () => {
            const has = stream.getVideoTracks().some(
                (t) => t.readyState === "live"
            );
            setHasLiveTrack(has);
        };

        checkTrack();

        const cleanups: (() => void)[] = [];

        const attachTrackListeners = () => {
            cleanups.forEach(fn => fn());
            cleanups.length = 0;

            stream.getVideoTracks().forEach((track) => {
                const h = () => checkTrack();
                track.addEventListener("mute", h);
                track.addEventListener("unmute", h);
                track.addEventListener("ended", h);
                cleanups.push(() => {
                    track.removeEventListener("mute", h);
                    track.removeEventListener("unmute", h);
                    track.removeEventListener("ended", h);
                });
            });
        };

        attachTrackListeners();

        const onStreamChange = () => {
            attachTrackListeners();
            checkTrack();
        };
        stream.addEventListener("addtrack", onStreamChange);
        stream.addEventListener("removetrack", onStreamChange);

        return () => {
            cleanups.forEach(fn => fn());
            stream.removeEventListener("addtrack", onStreamChange);
            stream.removeEventListener("removetrack", onStreamChange);
        };
    }, [stream]);

    // Video is shown only when the signaled flag says ON and we have a stream
    const showVideo = videoEnabled && stream && hasLiveTrack;

    // Ref callback: sets srcObject every time the <video> element mounts.
    const videoRefCb = useCallback(
        (el: HTMLVideoElement | null) => {
            if (el && stream) {
                el.srcObject = stream;
            }
        },
        [stream, showVideo]
    );

    return (
        <div className="relative rounded-2xl overflow-hidden bg-[#1a2735] flex items-center justify-center min-h-0">
            {showVideo ? (
                <video
                    ref={videoRefCb}
                    autoPlay
                    playsInline
                    muted={isLocal}
                    className={`w-full h-full object-cover ${isLocal ? "scale-x-[-1]" : ""}`}
                />
            ) : (
                // Avatar fallback
                <div className="flex flex-col items-center gap-3">
                    <div
                        className="w-20 h-20 sm:w-24 sm:h-24 rounded-full flex items-center justify-center text-white text-3xl sm:text-4xl font-bold"
                        style={{ backgroundColor: color }}
                    >
                        {participant.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-white text-sm font-medium">
                        {participant.name}{isLocal ? " (You)" : ""}
                    </span>
                </div>
            )}

            {/* Name label overlay */}
            {showVideo && (
                <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/50 backdrop-blur-sm rounded-lg px-2 py-1">
                    <span className="text-white text-xs font-medium">
                        {participant.name}{isLocal ? " (You)" : ""}
                    </span>
                    {(isLocal ? isMuted : false) && (
                        <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                        </svg>
                    )}
                </div>
            )}

            {/* Muted indicator (no video) */}
            {!showVideo && isLocal && isMuted && (
                <div className="absolute bottom-2 right-2 p-1.5 bg-red-500/30 rounded-full">
                    <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                </div>
            )}
        </div>
    );
}

const COLORS = ["#4ea4f6", "#e17076", "#7bc862", "#ee7aae", "#e5a64e", "#6ec9cb"];

export default function VideoCallOverlay({
    participants,
    callDuration,
    isMuted,
    isVideoOn,
    browserId,
    localStream,
    remoteStreams,
    onToggleMute,
    onToggleVideo,
    onLeave,
}: VideoCallOverlayProps) {
    const formatDuration = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, "0")}`;
    };

    // Find the local participant
    const localParticipant = participants.find((p) => p.browserId === browserId);
    // Remote participants
    const remoteParticipants = participants.filter((p) => p.browserId !== browserId);

    // Total tiles: remotes + self
    const totalTiles = remoteParticipants.length + (localParticipant ? 1 : 0);

    // Grid class based on number of tiles
    const getGridClass = () => {
        if (totalTiles <= 1) return "grid-cols-1 grid-rows-1";
        if (totalTiles === 2) return "grid-cols-1 sm:grid-cols-2 grid-rows-2 sm:grid-rows-1";
        if (totalTiles <= 4) return "grid-cols-2 grid-rows-2";
        return "grid-cols-2 grid-rows-3";
    };

    return (
        <div className="fixed inset-0 z-[250] bg-[#0e1621] flex flex-col">
            {/* Top bar */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#17212b]/80 backdrop-blur-sm shrink-0 z-10">
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <div className="w-2.5 h-2.5 bg-green-400 rounded-full" />
                        <div className="absolute inset-0 w-2.5 h-2.5 bg-green-400 rounded-full animate-ping opacity-40" />
                    </div>
                    <div>
                        <div className="text-white text-sm font-medium">
                            Video Call · {participants.length} {participants.length === 1 ? "person" : "people"}
                        </div>
                        <div className="text-gray-400 text-xs">{formatDuration(callDuration)}</div>
                    </div>
                </div>
            </div>

            {/* Video grid */}
            <div className={`flex-1 min-h-0 grid ${getGridClass()} gap-2 p-2`}>
                {/* Local tile */}
                {localParticipant && (
                    <VideoTile
                        participant={localParticipant}
                        stream={localStream}
                        isLocal
                        isMuted={isMuted}
                        videoEnabled={isVideoOn}
                        color={COLORS[participants.indexOf(localParticipant) % COLORS.length]}
                    />
                )}

                {/* Remote tiles */}
                {remoteParticipants.map((p, i) => (
                    <VideoTile
                        key={p.socketId}
                        participant={p}
                        stream={remoteStreams.get(p.socketId) ?? null}
                        isLocal={false}
                        videoEnabled={!!p.videoEnabled}
                        color={COLORS[(i + 1) % COLORS.length]}
                    />
                ))}
            </div>

            {/* Control bar */}
            <div className="flex items-center justify-center gap-4 px-4 py-4 bg-[#17212b]/80 backdrop-blur-sm shrink-0">
                {/* Mute mic */}
                <button
                    onClick={onToggleMute}
                    className={`p-4 rounded-full transition ${
                        isMuted ? "bg-red-500 text-white" : "bg-[#2b5278] text-white hover:bg-[#3a6a9a]"
                    }`}
                    title={isMuted ? "Unmute" : "Mute"}
                >
                    {isMuted ? (
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                        </svg>
                    ) : (
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                    )}
                </button>

                {/* Toggle camera */}
                <button
                    onClick={onToggleVideo}
                    className={`p-4 rounded-full transition ${
                        !isVideoOn ? "bg-red-500 text-white" : "bg-[#2b5278] text-white hover:bg-[#3a6a9a]"
                    }`}
                    title={isVideoOn ? "Turn Off Camera" : "Turn On Camera"}
                >
                    {isVideoOn ? (
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                    ) : (
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                    )}
                </button>

                {/* Leave call */}
                <button
                    onClick={onLeave}
                    className="p-4 rounded-full bg-red-500 text-white hover:bg-red-600 transition"
                    title="Leave call"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
                    </svg>
                </button>
            </div>
        </div>
    );
}
