import type { VoiceParticipant } from "../../types";

interface VoiceCallOverlayProps {
    participants: VoiceParticipant[];
    callDuration: number;
    isMuted: boolean;
    isVideoOn: boolean;
    browserId: string;
    onToggleMute: () => void;
    onToggleVideo: () => void;
    onLeave: () => void;
}

export default function VoiceCallOverlay({
    participants,
    callDuration,
    isMuted,
    isVideoOn,
    browserId,
    onToggleMute,
    onToggleVideo,
    onLeave,
}: VoiceCallOverlayProps) {
    const formatDuration = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, "0")}`;
    };

    // Colors for participant avatars
    const colors = ["#4ea4f6", "#e17076", "#7bc862", "#ee7aae", "#e5a64e", "#6ec9cb"];
    const getColor = (index: number) => colors[index % colors.length];

    return (
        <div className="bg-[#1e2c3a] border-b border-[#2b5278]/50 shrink-0 animate-in">
            {/* Main call bar */}
            <div className="flex items-center gap-3 px-4 py-2.5">
                {/* Pulsing indicator */}
                <div className="relative shrink-0">
                    <div className="w-3 h-3 bg-green-400 rounded-full" />
                    <div className="absolute inset-0 w-3 h-3 bg-green-400 rounded-full animate-ping opacity-40" />
                </div>

                {/* Participant avatars (stacked) */}
                <div className="flex -space-x-2">
                    {participants.slice(0, 5).map((p, i) => (
                        <div
                            key={p.socketId}
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold border-2 border-[#1e2c3a]"
                            style={{ backgroundColor: getColor(i), zIndex: 5 - i }}
                            title={p.name}
                        >
                            {p.name.charAt(0).toUpperCase()}
                        </div>
                    ))}
                    {participants.length > 5 && (
                        <div className="w-8 h-8 rounded-full bg-[#2b5278] flex items-center justify-center text-white text-xs font-bold border-2 border-[#1e2c3a]">
                            +{participants.length - 5}
                        </div>
                    )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium">
                        Voice Chat · {participants.length} {participants.length === 1 ? "person" : "people"}
                    </div>
                    <div className="text-gray-400 text-xs">
                        {formatDuration(callDuration)}
                        {isMuted && " · Muted"}
                    </div>
                </div>

                {/* Mute button */}
                <button
                    onClick={onToggleMute}
                    className={`p-2.5 rounded-full transition ${
                        isMuted
                            ? "bg-red-500/20 text-red-400"
                            : "bg-[#2b5278] text-white hover:bg-[#3a6a9a]"
                    }`}
                    title={isMuted ? "Unmute" : "Mute"}
                >
                    {isMuted ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                        </svg>
                    ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                    )}
                </button>

                {/* Camera toggle */}
                <button
                    onClick={onToggleVideo}
                    className={`p-2.5 rounded-full transition ${
                        isVideoOn
                            ? "bg-[#4ea4f6]/20 text-[#4ea4f6]"
                            : "bg-[#2b5278] text-white hover:bg-[#3a6a9a]"
                    }`}
                    title={isVideoOn ? "Turn Off Camera" : "Turn On Camera"}
                >
                    {isVideoOn ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                    ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                    )}
                </button>

                {/* Leave button */}
                <button
                    onClick={onLeave}
                    className="p-2.5 rounded-full bg-red-500/20 text-red-400 hover:bg-red-500/30 transition"
                    title="Leave voice chat"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
                    </svg>
                </button>
            </div>

            {/* Expanded participant list (show names) */}
            {participants.length > 0 && (
                <div className="flex items-center gap-1.5 px-4 pb-2 overflow-x-auto scrollbar-hide">
                    {participants.map((p, i) => (
                        <span
                            key={p.socketId}
                            className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${
                                p.browserId === browserId
                                    ? "bg-[#4ea4f6]/20 text-[#4ea4f6]"
                                    : "bg-[#2b5278]/40 text-gray-300"
                            }`}
                        >
                            {p.name}{p.browserId === browserId ? " (You)" : ""}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Small banner shown when NOT in call but others are (join prompt) ───
export function VoiceCallBanner({
    participantCount,
    participantNames,
    onJoin,
}: {
    participantCount: number;
    participantNames: string[];
    onJoin: () => void;
}) {
    if (participantCount === 0) return null;

    const namePreview =
        participantNames.length <= 2
            ? participantNames.join(" and ")
            : `${participantNames.slice(0, 2).join(", ")} and ${participantNames.length - 2} more`;

    return (
        <div className="flex items-center gap-3 px-4 py-2 bg-[#1e2c3a] border-b border-[#2b5278]/30 shrink-0">
            {/* Pulsing dot */}
            <div className="relative shrink-0">
                <div className="w-2.5 h-2.5 bg-green-400 rounded-full" />
                <div className="absolute inset-0 w-2.5 h-2.5 bg-green-400 rounded-full animate-ping opacity-40" />
            </div>

            <div className="flex-1 min-w-0">
                <span className="text-sm text-gray-300">
                    {namePreview} in voice chat
                </span>
            </div>

            <button
                onClick={onJoin}
                className="px-4 py-1.5 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-full transition"
            >
                Join
            </button>
        </div>
    );
}
