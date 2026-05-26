export interface SharedAudioTrack {
    trackKey: string;
    src: string;
    title: string;
    chatId: string;
    chatLabel?: string;
    isVoice?: boolean;
    fileUrl?: string;
    createdAt?: string;
    artist?: string;
    album?: string;
    durationSec?: number;
}

export interface PlaySharedAudioInput {
    trackKey: string;
    previewSrc: string;
    title: string;
    chatId: string;
    chatLabel?: string;
    isVoice?: boolean;
    startTime?: number;
    fileUrl?: string;
    createdAt?: string;
    artist?: string;
    album?: string;
    durationSec?: number;
}
