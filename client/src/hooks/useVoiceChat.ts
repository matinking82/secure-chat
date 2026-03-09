import { useState, useRef, useCallback, useEffect } from "react";
import type { Socket } from "socket.io-client";
import type { VoiceParticipant } from "../types";

const ICE_SERVERS: RTCConfiguration = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
    ],
};

interface PeerConnection {
    pc: RTCPeerConnection;
    audioEl: HTMLAudioElement;
    stream: MediaStream;
    makingOffer: boolean;
    videoSender: RTCRtpSender | null;
}

interface UseVoiceChatOptions {
    socket: Socket | null;
    chatId: string;
    browserId: string;
    displayName: string;
}

export function useVoiceChat({ socket, chatId, browserId, displayName }: UseVoiceChatOptions) {
    const [isInCall, setIsInCall] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isVideoOn, setIsVideoOn] = useState(false);
    const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
    const [callDuration, setCallDuration] = useState(0);
    const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);

    const localStreamRef = useRef<MediaStream | null>(null);
    const peersRef = useRef<Map<string, PeerConnection>>(new Map());
    const callTimerRef = useRef<ReturnType<typeof setInterval>>();
    const isInCallRef = useRef(false);
    const chatIdRef = useRef(chatId);
    const isVideoOnRef = useRef(false);

    // Keep refs in sync
    useEffect(() => {
        chatIdRef.current = chatId;
    }, [chatId]);

    // ─── Update remote streams state from peer map ───
    const syncRemoteStreams = useCallback(() => {
        const map = new Map<string, MediaStream>();
        peersRef.current.forEach((peer, socketId) => {
            if (peer.stream.getTracks().length > 0) {
                map.set(socketId, peer.stream);
            }
        });
        setRemoteStreams(new Map(map));
    }, []);

    // ─── Create a peer connection to a remote user ───
    const createPeerConnection = useCallback(
        (remoteSocketId: string, localStr: MediaStream): RTCPeerConnection => {
            // If we already have a connection to this peer, return it
            const existing = peersRef.current.get(remoteSocketId);
            if (existing) return existing.pc;

            const pc = new RTCPeerConnection(ICE_SERVERS);

            // Add all local tracks (audio + video if present)
            let videoSender: RTCRtpSender | null = null;
            localStr.getTracks().forEach((track) => {
                const sender = pc.addTrack(track, localStr);
                if (track.kind === "video") videoSender = sender;
            });

            // Handle ICE candidates
            pc.onicecandidate = (event) => {
                if (event.candidate && socket) {
                    socket.emit("voice_ice_candidate", {
                        chatId: chatIdRef.current,
                        targetSocketId: remoteSocketId,
                        candidate: event.candidate.toJSON(),
                    });
                }
            };

            // Remote stream
            const remoteStream = new MediaStream();

            // Audio element for playback
            const audioEl = document.createElement("audio");
            audioEl.autoplay = true;
            audioEl.setAttribute("playsinline", "true");

            pc.ontrack = (event) => {
                // Remove old tracks of same kind to avoid duplicates
                const oldTracks = remoteStream.getTracks().filter(t => t.kind === event.track.kind);
                oldTracks.forEach(t => remoteStream.removeTrack(t));

                // Add the track to our combined remote stream
                remoteStream.addTrack(event.track);
                // Also set audio element for audio playback
                if (event.track.kind === "audio") {
                    audioEl.srcObject = new MediaStream([event.track]);
                }
                syncRemoteStreams();

                // Handle track lifecycle events for proper UI updates
                event.track.onended = () => {
                    remoteStream.removeTrack(event.track);
                    syncRemoteStreams();
                };
                event.track.onmute = () => syncRemoteStreams();
                event.track.onunmute = () => syncRemoteStreams();
            };

            // No onnegotiationneeded — we handle all negotiation explicitly
            // to avoid double-offer conflicts.
            const peerEntry: PeerConnection = { pc, audioEl, stream: remoteStream, makingOffer: false, videoSender };
            peersRef.current.set(remoteSocketId, peerEntry);

            return pc;
        },
        [socket, syncRemoteStreams]
    );

    // ─── Close a specific peer connection ───
    const closePeer = useCallback((socketId: string) => {
        const peer = peersRef.current.get(socketId);
        if (peer) {
            peer.pc.close();
            peer.audioEl.srcObject = null;
            peer.audioEl.remove();
            peer.stream.getTracks().forEach((t) => t.stop());
            peersRef.current.delete(socketId);
            syncRemoteStreams();
        }
    }, [syncRemoteStreams]);

    // ─── Join call ───
    const joinCall = useCallback(async () => {
        if (!socket || isInCallRef.current) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            localStreamRef.current = stream;
            setLocalStream(stream);
            isInCallRef.current = true;
            setIsInCall(true);
            setCallDuration(0);
            setIsMuted(false);
            setIsVideoOn(false);
            isVideoOnRef.current = false;

            // Start timer
            callTimerRef.current = setInterval(() => {
                setCallDuration((prev) => prev + 1);
            }, 1000);

            // Tell server
            socket.emit("voice_join", {
                chatId: chatIdRef.current,
                browserId,
                name: displayName,
            });
        } catch (err) {
            console.error("Microphone access denied:", err);
            alert("Microphone access is required for voice chat");
        }
    }, [socket, browserId, displayName]);

    // ─── Leave call ───
    const leaveCall = useCallback(() => {
        if (!isInCallRef.current) return;

        peersRef.current.forEach((_, socketId) => closePeer(socketId));
        peersRef.current.clear();

        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach((t) => t.stop());
            localStreamRef.current = null;
        }
        setLocalStream(null);

        if (callTimerRef.current) clearInterval(callTimerRef.current);

        isInCallRef.current = false;
        isVideoOnRef.current = false;
        setIsInCall(false);
        setIsVideoOn(false);
        setCallDuration(0);
        setParticipants([]);
        setRemoteStreams(new Map());

        socket?.emit("voice_leave", { chatId: chatIdRef.current });
    }, [socket, closePeer]);

    // ─── Toggle mute ───
    const toggleMute = useCallback(() => {
        if (localStreamRef.current) {
            const audioTrack = localStreamRef.current.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                setIsMuted(!audioTrack.enabled);
            }
        }
    }, []);

    // ─── Toggle video ───
    const toggleVideo = useCallback(async () => {
        if (!localStreamRef.current || !isInCallRef.current) return;

        if (isVideoOnRef.current) {
            // ─── Turn OFF video ───
            // Stop and remove video tracks from local stream
            const videoTracks = localStreamRef.current.getVideoTracks();
            videoTracks.forEach((track) => {
                track.stop();
                localStreamRef.current?.removeTrack(track);
            });

            // Use replaceTrack(null) on all peers — no renegotiation needed
            for (const [, peer] of peersRef.current.entries()) {
                if (peer.videoSender) {
                    try {
                        await peer.videoSender.replaceTrack(null);
                    } catch (err) {
                        console.error("replaceTrack(null) error:", err);
                    }
                }
            }

            isVideoOnRef.current = false;
            setIsVideoOn(false);
            setLocalStream(new MediaStream(localStreamRef.current.getTracks()));

            socket?.emit("voice_toggle_video", {
                chatId: chatIdRef.current,
                videoEnabled: false,
            });
        } else {
            // ─── Turn ON video ───
            try {
                const videoStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
                });
                const videoTrack = videoStream.getVideoTracks()[0];
                localStreamRef.current.addTrack(videoTrack);

                for (const [socketId, peer] of peersRef.current.entries()) {
                    if (peer.videoSender) {
                        // Already have a video sender — use replaceTrack (no renegotiation)
                        try {
                            await peer.videoSender.replaceTrack(videoTrack);
                        } catch (err) {
                            console.error("replaceTrack error:", err);
                        }
                    } else {
                        // First time adding video — need addTrack + renegotiation
                        peer.videoSender = peer.pc.addTrack(videoTrack, localStreamRef.current!);
                        try {
                            peer.makingOffer = true;
                            const offer = await peer.pc.createOffer();
                            await peer.pc.setLocalDescription(offer);
                            socket?.emit("voice_offer", {
                                chatId: chatIdRef.current,
                                targetSocketId: socketId,
                                sdp: peer.pc.localDescription,
                            });
                        } catch (err) {
                            console.error("Video renegotiation error:", err);
                        } finally {
                            peer.makingOffer = false;
                        }
                    }
                }

                isVideoOnRef.current = true;
                setIsVideoOn(true);
                setLocalStream(new MediaStream(localStreamRef.current.getTracks()));

                socket?.emit("voice_toggle_video", {
                    chatId: chatIdRef.current,
                    videoEnabled: true,
                });
            } catch (err) {
                console.error("Camera access denied:", err);
                alert("Camera access is required for video");
            }
        }
    }, [socket]);

    // ─── Socket event handlers ───
    useEffect(() => {
        if (!socket) return;

        // Someone joined — create offer TO them
        const handleUserJoined = async (data: { chatId: string; participant: VoiceParticipant }) => {
            if (data.chatId !== chatIdRef.current) return;
            if (!isInCallRef.current || !localStreamRef.current) return;
            if (data.participant.socketId === socket.id) return;

            const pc = createPeerConnection(data.participant.socketId, localStreamRef.current);
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                socket.emit("voice_offer", {
                    chatId: chatIdRef.current,
                    targetSocketId: data.participant.socketId,
                    sdp: offer,
                });
            } catch (err) {
                console.error("Failed to create offer:", err);
            }
        };

        // Received offer — create answer (with polite peer logic)
        const handleOffer = async (data: { chatId: string; fromSocketId: string; sdp: RTCSessionDescriptionInit }) => {
            if (data.chatId !== chatIdRef.current) return;
            if (!isInCallRef.current || !localStreamRef.current) return;

            let peer = peersRef.current.get(data.fromSocketId);
            const isNewPeer = !peer;
            const pc = isNewPeer
                ? createPeerConnection(data.fromSocketId, localStreamRef.current)
                : peer!.pc;

            peer = peersRef.current.get(data.fromSocketId)!;

            // Handle glare (both sides sending offers simultaneously)
            const offerCollision =
                data.sdp.type === "offer" &&
                (peer.makingOffer || pc.signalingState !== "stable");

            if (offerCollision) {
                // We're the polite peer — rollback and accept their offer
                await pc.setLocalDescription({ type: "rollback" });
            }

            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));

            if (data.sdp.type === "offer") {
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                socket.emit("voice_answer", {
                    chatId: chatIdRef.current,
                    targetSocketId: data.fromSocketId,
                    sdp: answer,
                });
            }
        };

        // Received answer
        const handleAnswer = async (data: { chatId: string; fromSocketId: string; sdp: RTCSessionDescriptionInit }) => {
            if (data.chatId !== chatIdRef.current) return;
            const peer = peersRef.current.get(data.fromSocketId);
            if (peer) {
                try {
                    if (peer.pc.signalingState === "have-local-offer") {
                        await peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                    }
                } catch (err) {
                    console.error("Failed to set remote description for answer:", err);
                }
            }
        };

        // Received ICE candidate
        const handleIceCandidate = async (data: { chatId: string; fromSocketId: string; candidate: RTCIceCandidateInit }) => {
            if (data.chatId !== chatIdRef.current) return;
            const peer = peersRef.current.get(data.fromSocketId);
            if (peer) {
                try {
                    await peer.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                } catch (err) {
                    console.error("Failed to add ICE candidate:", err);
                }
            }
        };

        // Someone left
        const handleUserLeft = (data: { chatId: string; participant: VoiceParticipant }) => {
            if (data.chatId !== chatIdRef.current) return;
            closePeer(data.participant.socketId);
        };

        // Updated participant list
        const handleParticipants = (data: { chatId: string; participants: VoiceParticipant[] }) => {
            if (data.chatId !== chatIdRef.current) return;
            setParticipants(data.participants);
        };

        // Video status change
        const handleVideoStatus = (data: { chatId: string; socketId: string; videoEnabled: boolean }) => {
            if (data.chatId !== chatIdRef.current) return;
            setParticipants((prev) =>
                prev.map((p) =>
                    p.socketId === data.socketId ? { ...p, videoEnabled: data.videoEnabled } : p
                )
            );
        };

        socket.on("voice_user_joined", handleUserJoined);
        socket.on("voice_offer", handleOffer);
        socket.on("voice_answer", handleAnswer);
        socket.on("voice_ice_candidate", handleIceCandidate);
        socket.on("voice_user_left", handleUserLeft);
        socket.on("voice_participants", handleParticipants);
        socket.on("voice_video_status", handleVideoStatus);

        return () => {
            socket.off("voice_user_joined", handleUserJoined);
            socket.off("voice_offer", handleOffer);
            socket.off("voice_answer", handleAnswer);
            socket.off("voice_ice_candidate", handleIceCandidate);
            socket.off("voice_user_left", handleUserLeft);
            socket.off("voice_participants", handleParticipants);
            socket.off("voice_video_status", handleVideoStatus);
        };
    }, [socket, createPeerConnection, closePeer]);

    // Fetch current participants when entering a chat
    useEffect(() => {
        if (socket && chatId) {
            socket.emit("voice_get_participants", chatId);
        }
    }, [socket, chatId]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (isInCallRef.current) {
                peersRef.current.forEach((peer) => {
                    peer.pc.close();
                    peer.audioEl.srcObject = null;
                    peer.audioEl.remove();
                });
                peersRef.current.clear();

                if (localStreamRef.current) {
                    localStreamRef.current.getTracks().forEach((t) => t.stop());
                    localStreamRef.current = null;
                }

                if (callTimerRef.current) clearInterval(callTimerRef.current);
            }
        };
    }, []);

    return {
        isInCall,
        isMuted,
        isVideoOn,
        participants,
        callDuration,
        localStream,
        remoteStreams,
        joinCall,
        leaveCall,
        toggleMute,
        toggleVideo,
    };
}
