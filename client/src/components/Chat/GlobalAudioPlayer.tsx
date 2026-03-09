import Modal from "../ui/Modal";
import { useAudioPlayer } from "../../contexts/AudioPlayerContext";

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
        closeTrack,
        openDetails,
        closeDetails,
    } = useAudioPlayer();

    if (!currentTrack) return null;

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
                                <div className="text-sm font-semibold text-white truncate">{currentTrack.title}</div>
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

            <Modal open={detailsOpen} onClose={closeDetails} title="Now Playing">
                <div className="space-y-5">
                    <div className="rounded-2xl border border-[#2b5278]/30 bg-[#0e1621]/70 p-5 text-center">
                        <div className="text-5xl mb-4">{currentTrack.isVoice ? "🎙️" : "🎵"}</div>
                        <div className="text-white text-lg font-semibold break-words">{currentTrack.title}</div>
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

                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => void togglePlayback()}
                            className="flex-1 py-3 rounded-xl bg-[#4ea4f6] hover:bg-[#3d93e5] text-white font-medium transition disabled:opacity-60"
                            disabled={loading}
                        >
                            {loading ? "Loading..." : playing ? "Pause" : "Play"}
                        </button>
                        <button
                            onClick={closeTrack}
                            className="px-5 py-3 rounded-xl border border-[#2b5278]/50 text-gray-300 hover:text-white hover:bg-[#1e2c3a] transition"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </Modal>
        </>
    );
}
