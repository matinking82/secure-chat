import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import multer from "multer";
import { body, validationResult } from "express-validator";
import webpush from "web-push";
import { v4 as uuidv4 } from "uuid";
import http from "http";
import { Server as SocketIOServer } from "socket.io";

// ─── Game imports ───
import { parseC4, serializeC4, c4DropPiece, C4_P1, C4_P2 } from "./games/connect4";
import { parseChess, serializeChess, chessApplyMove } from "./games/chess";
import { parseXO, serializeXO, xoMakeMove } from "./games/xo";
import { parseMinesweeper, serializeMinesweeper, minesweeperReveal, minesweeperToggleFlag } from "./games/minesweeper";
import { parseOthello, serializeOthello, othelloMakeMove } from "./games/othello";
import { parseBackgammon, serializeBackgammon, backgammonRollDice, backgammonApplyMove } from "./games/backgammon";
import { parseHokm2, serializeHokm2, hokm2StartRound, hokm2SelectTrump, hokm2PlayCard, hokm2NewRound, hokm2DiscardCards, hokm2DrawCard } from "./games/hokm2";
import { parseHokm4, serializeHokm4, hokm4StartRound, hokm4SelectTrump, hokm4PlayCard, hokm4NewRound, hokm4JoinPlayer, hokm4AllJoined } from "./games/hokm4";
import { parseChaarBarg, serializeChaarBarg, chaarBargStartRound, chaarBargPlayCard, chaarBargNewRound } from "./games/chaarbarg";

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
    cors: { origin: "*" },
    maxHttpBufferSize: 30 * 1024 * 1024,
});

app.use(cors());
app.use(express.json());

// ─── Files directory ───
const FILES_DIR = path.join(__dirname, "files");

if (fs.existsSync(FILES_DIR)) {
    fs.rmSync(FILES_DIR, { recursive: true, force: true });
}
fs.mkdirSync(FILES_DIR, { recursive: true });

// ─── Multer setup (25MB limit for encrypted files) ───
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FILES_DIR),
    filename: (_req, file, cb) => {
        const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        cb(null, unique + ext);
    },
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

// ─── Message type ───
interface ChatMessage {
    id: number;
    text: string;
    name: string;
    browserId: string;
    createdAt: Date;
    file?: string;
    fileType?: string;
    originalName?: string;
    replyToId?: number;
    edited?: boolean;
    reactions?: { [emoji: string]: string[] }; // emoji -> browserId[]
    seenBy?: string[]; // browserIds that have seen this message
    tags?: { browserId: string; name: string }[];
}

const chat = {} as { [key: string]: ChatMessage[] };
let globalMsgId = 0;

// ─── Browser ID → name tracking for duplicate name resolution ───
const chatNameMaps: { [chatId: string]: { [browserId: string]: string } } = {};

// ─── Public key registry (browserId → publicKey JWK string) ───
const publicKeyRegistry: { [browserId: string]: string } = {};

// ─── Verified socket → browserId mapping ───
const socketBrowserIdMap: { [socketId: string]: string } = {};

// ─── Send message tokens (browserId → { token, expiresAt }) ───
const sendTokens: { [browserId: string]: { token: string; expiresAt: number } } = {};

function generateSendToken(browserId: string): string {
    const token = crypto.randomBytes(32).toString("hex");
    sendTokens[browserId] = { token, expiresAt: Date.now() + 60000 }; // 60 second expiry
    return token;
}

function validateAndConsumeSendToken(browserId: string, token: string): boolean {
    const entry = sendTokens[browserId];
    if (!entry) return false;
    if (entry.token !== token || Date.now() > entry.expiresAt) {
        delete sendTokens[browserId];
        return false;
    }
    delete sendTokens[browserId];
    return true;
}

// ─── Verify ECDSA signature using Node.js crypto ───
async function verifySignature(
    publicKeyJwk: JsonWebKey,
    signature: string,
    data: string
): Promise<boolean> {
    try {
        // Convert JWK to a format Node.js can use
        const keyObject = crypto.createPublicKey({ key: publicKeyJwk as crypto.JsonWebKey, format: "jwk" });
        const verify = crypto.createVerify("SHA256");
        verify.update(data);
        verify.end();
        return verify.verify(
            { key: keyObject, dsaEncoding: "ieee-p1363" },
            Buffer.from(signature, "base64")
        );
    } catch {
        return false;
    }
}

// Get verified browserId for a socket, or null if not verified
function getVerifiedBrowserId(socketId: string): string | null {
    return socketBrowserIdMap[socketId] || null;
}

function resolveDisplayName(
    chatId: string,
    browserId: string,
    requestedName: string
): string {
    if (!chatNameMaps[chatId]) chatNameMaps[chatId] = {};
    const nameMap = chatNameMaps[chatId];

    // If this browserId already has a name assigned and it matches, keep it
    if (nameMap[browserId]) {
        const oldBase = nameMap[browserId].replace(/-\d+$/, "");
        if (oldBase === requestedName || nameMap[browserId] === requestedName) {
            return nameMap[browserId];
        }
    }

    // Check if another browserId already uses this name
    const conflicts: string[] = [];
    for (const [bid, name] of Object.entries(nameMap)) {
        if (bid !== browserId) {
            const baseName = name.replace(/-\d+$/, "");
            if (baseName === requestedName || name === requestedName) {
                conflicts.push(name);
            }
        }
    }

    let finalName = requestedName;
    if (conflicts.length > 0) {
        let suffix = 1;
        while (
            Object.values(nameMap).includes(`${requestedName}-${suffix}`)
        ) {
            suffix++;
        }
        finalName = `${requestedName}-${suffix}`;
    }

    nameMap[browserId] = finalName;
    return finalName;
}

// ─── Serve the React app (production build) ───
const CLIENT_DIST = path.join(__dirname, "client", "dist");

if (fs.existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST));
}

// ─── Serve service-worker.js ───
app.get("*service-worker.js*", (_req, res) => {
    try {
        const swPath = path.join(__dirname, "client", "public", "service-worker.js");
        if (fs.existsSync(swPath)) {
            res.sendFile(swPath);
        } else {
            res.sendFile(path.join(__dirname, "service-worker.js"));
        }
    } catch {
        res.status(404).send("not found");
    }
});

// ─── Serve uploaded files ───
app.use("/files", express.static(FILES_DIR));

// ─── VAPID public key (must be before /api/:chatId) ───
app.get("/api/vapid-public-key", (_req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// ─── GET messages with pagination ───
app.get("/api/:chatId", (req, res) => {
    try {
        const chatId = req.params.chatId;
        const messages = chat[chatId] || [];
        const total = messages.length;
        const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
        const offset = parseInt(req.query.offset as string) || 0;

        const start = Math.max(0, total - offset - limit);
        const end = Math.max(0, total - offset);
        const slice = messages.slice(start, end);

        res.json({
            success: true,
            messages: slice,
            total,
            hasMore: start > 0,
        });
    } catch {
        res.status(500).json({ error: "Internal server error" });
    }
});

// ─── POST text message ───
app.post(
    "/api/:chatId",
    body("text").isString(),
    body("name").isString(),
    body("browserId").isString(),
    async (req, res) => {
        try {
            const error = validationResult(req);
            if (!error.isEmpty()) {
                res.status(400).json({ errors: error.array() });
                return;
            }

            // Validate send token for authentication
            const sendToken = req.body.sendToken;
            if (sendToken && !validateAndConsumeSendToken(req.body.browserId, sendToken)) {
                res.status(403).json({ error: "Invalid or expired send token" });
                return;
            }

            const chatId = req.params.chatId;
            if (!chat[chatId]) chat[chatId] = [];

            const displayName = resolveDisplayName(
                chatId,
                req.body.browserId,
                req.body.name
            );

            const msg: ChatMessage = {
                id: ++globalMsgId,
                text: req.body.text,
                name: displayName,
                browserId: req.body.browserId,
                createdAt: new Date(),
                replyToId: req.body.replyToId || undefined,
                tags: req.body.tags || undefined,
            };

            chat[chatId].push(msg);

            // Broadcast via WebSocket (include chatId so clients know which chat)
            io.to(`chat:${chatId}`).emit("new_message", { ...msg, chatId });

            // Push notifications (skip sender)
            
            res.json({ success: true, message: msg });
            notifyAll(
                chatId,
                JSON.stringify({
                    title: "New Message",
                    body: `${msg.name}: ${msg.text ? "text" : "(file)"}`,
                    url: `/chat/${chatId}`,
                }),
                msg.browserId
            );
        } catch {
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

// ─── POST file message (encrypted files) ───
app.post("/api/:chatId/upload", upload.single("file"), async (req, res) => {
    try {
        const chatId = req.params.chatId as string;
        if (!chat[chatId]) chat[chatId] = [];

        if (!req.file) {
            res.status(400).json({ error: "No file uploaded" });
            return;
        }

        const browserId = req.body.browserId || "unknown";

        // Validate send token for authentication
        const sendToken = req.body.sendToken;
        if (sendToken && !validateAndConsumeSendToken(browserId, sendToken)) {
            res.status(403).json({ error: "Invalid or expired send token" });
            return;
        }

        const name = req.body.name || "Anonymous";
        const displayName = resolveDisplayName(chatId, browserId, name);
        const text = req.body.text || "";
        const replyToId = req.body.replyToId
            ? parseInt(req.body.replyToId)
            : undefined;

        const fileType = req.body.fileType || "other";
        const originalName = req.body.originalName || req.file.originalname;

        const msg: ChatMessage = {
            id: ++globalMsgId,
            text,
            name: displayName,
            browserId,
            createdAt: new Date(),
            file: "/files/" + req.file.filename,
            fileType,
            originalName,
            replyToId,
        };

        chat[chatId].push(msg);

        io.to(`chat:${chatId}`).emit("new_message", { ...msg, chatId });

        res.json({ success: true, message: msg });

        notifyAll(
            chatId,
            JSON.stringify({
                title: "New Message",
                body: `${msg.name}: ${msg.text ? "text" : "(file)"}`,
                url: `/chat/${chatId}`,
            }),
            msg.browserId
        );
    } catch {
        res.status(500).json({ error: "Internal server error" });
    }
});

// ─── VAPID Push config ───
webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
);

const subscriptions: {
    [id: string]: { sub: webpush.PushSubscription; chatId: string; browserId?: string };
} = {};

app.post("/api/:chatId/subscribe", express.json(), (req, res) => {
    const sub = req.body.subscription as webpush.PushSubscription;
    const chatId = req.params.chatId;
    const browserId = req.body.browserId as string | undefined;
    if (!sub || !sub.endpoint) {
        return res.status(400).json({ error: "Invalid subscription" });
    }
    const id = uuidv4();
    subscriptions[id] = { sub, chatId, browserId };
    res.json({ success: true, subId: id });
});

app.post("/api/:chatId/unsubscribe", express.json(), (req, res) => {
    const { subId } = req.body;
    delete subscriptions[subId];
    res.json({ success: true });
});

async function notifyAll(chatId: string, payload: string, senderBrowserId?: string) {
    const promises = Object.entries(subscriptions)
        .filter(([, val]) => val.chatId === chatId && (!senderBrowserId || val.browserId !== senderBrowserId))
        .map(([key, val]) => {
            return webpush.sendNotification(val.sub, payload).catch((err) => {
                if (err.statusCode === 410 || err.statusCode === 404) {
                    delete subscriptions[key];
                }
            });
        });
    await Promise.all(promises);
}

// ─── Voice chat participants (in-memory) ───
interface VoiceParticipant {
    socketId: string;
    browserId: string;
    name: string;
    videoEnabled?: boolean;
}
const voiceRooms: { [chatId: string]: VoiceParticipant[] } = {};

// ─── PV (Private) chat pending requests ───
interface PvRequest {
    fromBrowserId: string;
    toBrowserId: string;
    chatKey: string;
    senderName: string;
}
const pvPendingRequests: PvRequest[] = [];

// Map browserId → socketId for online users
function findSocketByBrowserId(browserId: string): string | null {
    for (const [socketId, bid] of Object.entries(socketBrowserIdMap)) {
        if (bid === browserId) return socketId;
    }
    return null;
}

// ─── Socket.IO ───
io.on("connection", (socket) => {
    socket.on("join_chat", (chatId: string) => {
        socket.join(`chat:${chatId}`);
    });

    socket.on("leave_chat", (chatId: string) => {
        socket.leave(`chat:${chatId}`);
    });

    // ─── Register & verify public key with challenge-response ───
    socket.on("register_public_key", async (data: { browserId: string; publicKey: string }) => {
        if (!data.browserId || !data.publicKey) return;

        // Store the public key
        publicKeyRegistry[data.browserId] = data.publicKey;

        // Send a random challenge for the client to sign
        const challenge = crypto.randomBytes(32).toString("base64");
        const expectedBrowserId = data.browserId;
        let challengeExpired = false;

        // Timeout: invalidate challenge after 30 seconds
        const timeout = setTimeout(() => {
            challengeExpired = true;
            socket.removeAllListeners("identity_response");
        }, 30000);

        socket.emit("identity_challenge", { challenge });

        // Listen for the challenge response (one-time)
        socket.once("identity_response", async (response: { browserId: string; signature: string; challenge: string }) => {
            clearTimeout(timeout);
            if (challengeExpired) return;
            if (response.challenge !== challenge) return;
            // Ensure the responding browserId matches the one that registered
            if (response.browserId !== expectedBrowserId) return;

            const pubKeyStr = publicKeyRegistry[response.browserId];
            if (!pubKeyStr) return;

            try {
                const pubKeyJwk = JSON.parse(pubKeyStr);
                const valid = await verifySignature(pubKeyJwk, response.signature, challenge);
                if (valid) {
                    socketBrowserIdMap[socket.id] = response.browserId;
                    socket.emit("identity_verified", { success: true });

                    // Deliver pending PV requests
                    const pendingForUser = pvPendingRequests.filter(r => r.toBrowserId === response.browserId);
                    for (const req of pendingForUser) {
                        socket.emit("pv_invite", {
                            fromBrowserId: req.fromBrowserId,
                            chatKey: req.chatKey,
                            senderName: req.senderName,
                        });
                        // Notify sender that invite was delivered
                        const senderSocketId = findSocketByBrowserId(req.fromBrowserId);
                        if (senderSocketId) {
                            io.to(senderSocketId).emit("pv_confirmed", { toBrowserId: response.browserId, chatKey: req.chatKey });
                        }
                    }
                    // Remove delivered requests
                    for (let i = pvPendingRequests.length - 1; i >= 0; i--) {
                        if (pvPendingRequests[i].toBrowserId === response.browserId) {
                            pvPendingRequests.splice(i, 1);
                        }
                    }
                } else {
                    socket.emit("identity_verified", { success: false });
                }
            } catch {
                socket.emit("identity_verified", { success: false });
            }
        });
    });

    socket.on(
        "typing",
        (data: { chatId: string; name: string; isTyping: boolean }) => {
            socket.to(`chat:${data.chatId}`).emit("user_typing", {
                chatId: data.chatId,
                name: data.name,
                isTyping: data.isTyping,
            });
        }
    );

    // ─── Request send token (for message authentication) ───
    socket.on("request_send_token", (data: { browserId: string }) => {
        const verifiedId = getVerifiedBrowserId(socket.id);
        if (!verifiedId || verifiedId !== data.browserId) {
            socket.emit("send_token", { token: null });
            return;
        }
        const token = generateSendToken(data.browserId);
        socket.emit("send_token", { token });
    });

    // ─── PV (Private) chat request ───
    socket.on("pv_request", (data: { fromBrowserId: string; toBrowserId: string; chatKey: string; senderName: string }) => {
        const verifiedId = getVerifiedBrowserId(socket.id);
        if (!verifiedId || verifiedId !== data.fromBrowserId) return;

        // Check if target user is online
        const targetSocketId = findSocketByBrowserId(data.toBrowserId);
        if (targetSocketId) {
            // Send PV request to the target user immediately
            io.to(targetSocketId).emit("pv_invite", {
                fromBrowserId: data.fromBrowserId,
                chatKey: data.chatKey,
                senderName: data.senderName,
            });
            // Confirm to sender that the request was delivered
            socket.emit("pv_confirmed", { toBrowserId: data.toBrowserId, chatKey: data.chatKey });
        } else {
            // Store pending request for when user comes online
            pvPendingRequests.push({
                fromBrowserId: data.fromBrowserId,
                toBrowserId: data.toBrowserId,
                chatKey: data.chatKey,
                senderName: data.senderName,
            });
        }
    });

    // ─── PV confirmation check (sender checks if their PV was delivered) ───
    socket.on("pv_check_confirmed", (data: { toBrowserId: string; chatKey: string; browserId: string }) => {
        const verifiedId = getVerifiedBrowserId(socket.id);
        if (!verifiedId || verifiedId !== data.browserId) return;

        // Check if target user is online
        const targetSocketId = findSocketByBrowserId(data.toBrowserId);
        if (targetSocketId) {
            // Re-send the PV invite
            io.to(targetSocketId).emit("pv_invite", {
                fromBrowserId: data.browserId,
                chatKey: data.chatKey,
                senderName: "",
            });
            socket.emit("pv_confirmed", { toBrowserId: data.toBrowserId, chatKey: data.chatKey });
        } else {
            socket.emit("pv_not_confirmed", { toBrowserId: data.toBrowserId });
        }
    });

    // ─── Edit message (verified browserId enforced) ───
    socket.on(
        "edit_message",
        (data: { chatId: string; messageId: number; text: string; browserId: string }) => {
            const { chatId, messageId, text, browserId } = data;
            // Enforce: the browserId must match the verified identity of this socket
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messages = chat[chatId];
            if (!messages) return;
            const msg = messages.find((m) => m.id === messageId);
            if (!msg || msg.browserId !== browserId) return; // Only sender can edit
            msg.text = text;
            msg.edited = true;
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId,
                messageId,
                text,
                edited: true,
            });
        }
    );

    // ─── Connect 4 game move (verified browserId, either player can move) ───
    socket.on(
        "game_move",
        (data: { chatId: string; messageId: number; column: number; browserId: string }) => {
            const { chatId, messageId, column, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messages = chat[chatId];
            if (!messages) return;
            const msg = messages.find((m) => m.id === messageId);
            if (!msg) return;

            // Parse the game state from the raw (unencrypted) message text
            const state = parseC4(msg.text);
            if (!state || state.winner !== 0) return;

            // Determine player number
            let playerNum = 0;
            if (browserId === state.p1) {
                playerNum = C4_P1;
            } else if (browserId === state.p2) {
                playerNum = C4_P2;
            } else if (state.p2 === "?" && browserId !== state.p1) {
                // New player joining as P2
                state.p2 = browserId;
                playerNum = C4_P2;
            }
            if (playerNum === 0) return; // spectator, ignore

            // Validate it's this player's turn
            if (state.turn !== playerNum) return;

            // Execute the move server-side
            const newState = c4DropPiece(state, column, playerNum);
            if (!newState) return;

            // Update the message text
            msg.text = serializeC4(newState);
            // Broadcast as an edit so all clients update
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId,
                messageId,
                text: msg.text,
                edited: false, // game edits don't show "edited" badge
            });
        }
    );

    // ─── Chess game move (verified browserId) ───
    socket.on(
        "chess_move",
        (data: { chatId: string; messageId: number; fromRow: number; fromCol: number; toRow: number; toCol: number; promotion?: string; browserId: string }) => {
            const { chatId, messageId, fromRow, fromCol, toRow, toCol, promotion, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messages = chat[chatId];
            if (!messages) return;
            const msg = messages.find((m) => m.id === messageId);
            if (!msg) return;

            const state = parseChess(msg.text);
            if (!state || state.winner !== "") return;

            // Determine player color
            let playerColor = "";
            if (browserId === state.p1) {
                playerColor = "w";
            } else if (browserId === state.p2) {
                playerColor = "b";
            } else if (state.p2 === "?" && browserId !== state.p1) {
                state.p2 = browserId;
                playerColor = "b";
            }
            if (!playerColor) return;
            if (state.turn !== playerColor) return;

            const newState = chessApplyMove(state, fromRow, fromCol, toRow, toCol, promotion);
            if (!newState) return;

            msg.text = serializeChess(newState);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId,
                messageId,
                text: msg.text,
                edited: false,
            });
        }
    );

    // ─── XO (Tic-Tac-Toe) game move (verified browserId) ───
    socket.on(
        "xo_move",
        (data: { chatId: string; messageId: number; position: number; browserId: string }) => {
            const { chatId, messageId, position, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messages = chat[chatId];
            if (!messages) return;
            const msg = messages.find((m) => m.id === messageId);
            if (!msg) return;

            const state = parseXO(msg.text);
            if (!state || state.winner !== 0) return;

            let playerNum = 0;
            if (browserId === state.p1) playerNum = 1;
            else if (browserId === state.p2) playerNum = 2;
            else if (state.p2 === "?" && browserId !== state.p1) {
                state.p2 = browserId;
                playerNum = 2;
            }
            if (playerNum === 0) return;

            const newState = xoMakeMove(state, position, playerNum);
            if (!newState) return;

            msg.text = serializeXO(newState);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId,
                messageId,
                text: msg.text,
                edited: false,
            });
        }
    );

    // ─── Minesweeper game move (any verified user can play) ───
    socket.on(
        "minesweeper_move",
        (data: { chatId: string; messageId: number; index: number; action: string; browserId: string }) => {
            const { chatId, messageId, index, action, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messages = chat[chatId];
            if (!messages) return;
            const msg = messages.find((m) => m.id === messageId);
            if (!msg) return;

            const state = parseMinesweeper(msg.text);
            if (!state) return;

            let newState;
            if (action === "reveal") {
                newState = minesweeperReveal(state, index);
            } else if (action === "flag") {
                newState = minesweeperToggleFlag(state, index);
            }
            if (!newState) return;

            msg.text = serializeMinesweeper(newState);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId,
                messageId,
                text: msg.text,
                edited: false,
            });
        }
    );

    // ─── Othello/Reversi game move (verified browserId) ───
    socket.on(
        "othello_move",
        (data: { chatId: string; messageId: number; row: number; col: number; browserId: string }) => {
            const { chatId, messageId, row, col, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messages = chat[chatId];
            if (!messages) return;
            const msg = messages.find((m) => m.id === messageId);
            if (!msg) return;

            const state = parseOthello(msg.text);
            if (!state || state.winner !== 0) return;

            let playerNum = 0;
            if (browserId === state.p1) playerNum = 1;
            else if (browserId === state.p2) playerNum = 2;
            else if (state.p2 === "?" && browserId !== state.p1) {
                state.p2 = browserId;
                playerNum = 2;
            }
            if (playerNum === 0) return;

            const newState = othelloMakeMove(state, row, col, playerNum);
            if (!newState) return;

            msg.text = serializeOthello(newState);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId,
                messageId,
                text: msg.text,
                edited: false,
            });
        }
    );

    // ─── Backgammon roll dice (verified browserId) ───
    socket.on(
        "backgammon_roll",
        (data: { chatId: string; messageId: number; browserId: string }) => {
            const { chatId, messageId, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messages = chat[chatId];
            if (!messages) return;
            const msg = messages.find((m) => m.id === messageId);
            if (!msg) return;

            const state = parseBackgammon(msg.text);
            if (!state || state.winner !== 0) return;

            let playerNum = 0;
            if (browserId === state.p1) playerNum = 1;
            else if (browserId === state.p2) playerNum = 2;
            else if (state.p2 === "?" && browserId !== state.p1) {
                state.p2 = browserId;
                playerNum = 2;
            }
            if (playerNum === 0) return;

            const newState = backgammonRollDice(state, playerNum);
            if (!newState) return;

            msg.text = serializeBackgammon(newState);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId,
                messageId,
                text: msg.text,
                edited: false,
            });
        }
    );

    // ─── Backgammon move piece (verified browserId) ───
    socket.on(
        "backgammon_move",
        (data: { chatId: string; messageId: number; from: number; to: number; browserId: string }) => {
            const { chatId, messageId, from, to, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messages = chat[chatId];
            if (!messages) return;
            const msg = messages.find((m) => m.id === messageId);
            if (!msg) return;

            const state = parseBackgammon(msg.text);
            if (!state || state.winner !== 0) return;

            let playerNum = 0;
            if (browserId === state.p1) playerNum = 1;
            else if (browserId === state.p2) playerNum = 2;
            if (playerNum === 0) return;

            const newState = backgammonApplyMove(state, from, to, playerNum);
            if (!newState) return;

            msg.text = serializeBackgammon(newState);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId,
                messageId,
                text: msg.text,
                edited: false,
            });
        }
    );

    // ─── Hokm 2-Player: join (triggers round start) ───
    socket.on(
        "hokm2_join",
        (data: { chatId: string; messageId: number; browserId: string }) => {
            const { chatId, messageId, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messages = chat[chatId];
            if (!messages) return;
            const msg = messages.find((m) => m.id === messageId);
            if (!msg) return;

            const state = parseHokm2(msg.text);
            if (!state || state.phase !== 0) return;

            if (state.p2 === "?" && browserId !== state.p1) {
                state.p2 = browserId;
                const started = hokm2StartRound(state);
                msg.text = serializeHokm2(started);
                io.to(`chat:${chatId}`).emit("message_edited", {
                    chatId, messageId, text: msg.text, edited: false,
                });
            }
        }
    );

    // ─── Hokm 2-Player: select trump ───
    socket.on(
        "hokm2_trump",
        (data: { chatId: string; messageId: number; suit: number; browserId: string }) => {
            const { chatId, messageId, suit, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messages = chat[chatId];
            if (!messages) return;
            const msg = messages.find((m) => m.id === messageId);
            if (!msg) return;

            const state = parseHokm2(msg.text);
            if (!state) return;

            // Auto-join p2
            if (state.p2 === "?" && browserId !== state.p1) state.p2 = browserId;
            let playerNum = 0;
            if (browserId === state.p1) playerNum = 1;
            else if (browserId === state.p2) playerNum = 2;
            if (playerNum === 0) return;

            // If phase 0 (waiting), start the round first
            let current = state;
            if (current.phase === 0) {
                current = hokm2StartRound(current);
            }

            const newState = hokm2SelectTrump(current, playerNum, suit);
            if (!newState) return;

            msg.text = serializeHokm2(newState);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId, messageId, text: msg.text, edited: false,
            });
        }
    );

    // ─── Hokm 2-Player: play card ───
    socket.on(
        "hokm2_play",
        (data: { chatId: string; messageId: number; cardIndex: number; browserId: string }) => {
            const { chatId, messageId, cardIndex, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messages = chat[chatId];
            if (!messages) return;
            const msg = messages.find((m) => m.id === messageId);
            if (!msg) return;

            const state = parseHokm2(msg.text);
            if (!state) return;

            let playerNum = 0;
            if (browserId === state.p1) playerNum = 1;
            else if (browserId === state.p2) playerNum = 2;
            if (playerNum === 0) return;

            const newState = hokm2PlayCard(state, playerNum, cardIndex);
            if (!newState) return;

            msg.text = serializeHokm2(newState);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId, messageId, text: msg.text, edited: false,
            });
        }
    );

    // ─── Hokm 2-Player: new round ───
    socket.on(
        "hokm2_newround",
        (data: { chatId: string; messageId: number; browserId: string }) => {
            const { chatId, messageId, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messages = chat[chatId];
            if (!messages) return;
            const msg = messages.find((m) => m.id === messageId);
            if (!msg) return;

            const state = parseHokm2(msg.text);
            if (!state) return;

            const newState = hokm2NewRound(state);
            if (!newState) return;

            msg.text = serializeHokm2(newState);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId, messageId, text: msg.text, edited: false,
            });
        }
    );

    // ─── Hokm 2-Player: discard cards ───
    socket.on(
        "hokm2_discard",
        (data: { chatId: string; messageId: number; cardIndices: number[]; browserId: string }) => {
            const { chatId, messageId, cardIndices, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messages = chat[chatId];
            if (!messages) return;
            const msg = messages.find((m) => m.id === messageId);
            if (!msg) return;

            const state = parseHokm2(msg.text);
            if (!state) return;

            let playerNum = 0;
            if (browserId === state.p1) playerNum = 1;
            else if (browserId === state.p2) playerNum = 2;
            if (playerNum === 0) return;

            const newState = hokm2DiscardCards(state, playerNum, cardIndices);
            if (!newState) return;

            msg.text = serializeHokm2(newState);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId, messageId, text: msg.text, edited: false,
            });
        }
    );

    // ─── Hokm 2-Player: draw card (accept/refuse) ───
    socket.on(
        "hokm2_draw",
        (data: { chatId: string; messageId: number; accept: boolean; browserId: string }) => {
            const { chatId, messageId, accept, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messages = chat[chatId];
            if (!messages) return;
            const msg = messages.find((m) => m.id === messageId);
            if (!msg) return;

            const state = parseHokm2(msg.text);
            if (!state) return;

            let playerNum = 0;
            if (browserId === state.p1) playerNum = 1;
            else if (browserId === state.p2) playerNum = 2;
            if (playerNum === 0) return;

            const newState = hokm2DrawCard(state, playerNum, accept);
            if (!newState) return;

            msg.text = serializeHokm2(newState);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId, messageId, text: msg.text, edited: false,
            });
        }
    );

    // ─── Hokm 4-Player: join ───
    socket.on(
        "hokm4_join",
        (data: { chatId: string; messageId: number; browserId: string }) => {
            const { chatId, messageId, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messages = chat[chatId];
            if (!messages) return;
            const msg = messages.find((m) => m.id === messageId);
            if (!msg) return;

            const state = parseHokm4(msg.text);
            if (!state || state.phase !== 0) return;

            const joined = hokm4JoinPlayer(state, browserId);
            if (!joined) return;

            let current = joined.state;
            if (hokm4AllJoined(current)) {
                current = hokm4StartRound(current);
            }

            msg.text = serializeHokm4(current);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId, messageId, text: msg.text, edited: false,
            });
        }
    );

    // ─── Hokm 4-Player: select trump ───
    socket.on(
        "hokm4_trump",
        (data: { chatId: string; messageId: number; suit: number; browserId: string }) => {
            const { chatId, messageId, suit, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messages = chat[chatId];
            if (!messages) return;
            const msg = messages.find((m) => m.id === messageId);
            if (!msg) return;

            const state = parseHokm4(msg.text);
            if (!state) return;

            // Auto-join
            const joined = hokm4JoinPlayer(state, browserId);
            if (!joined) return;
            let current = joined.state;
            const playerNum = joined.playerNum;

            // If all joined and phase 0, start round
            if (hokm4AllJoined(current) && current.phase === 0) {
                current = hokm4StartRound(current);
            }

            const newState = hokm4SelectTrump(current, playerNum, suit);
            if (!newState) return;

            msg.text = serializeHokm4(newState);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId, messageId, text: msg.text, edited: false,
            });
        }
    );

    // ─── Hokm 4-Player: play card ───
    socket.on(
        "hokm4_play",
        (data: { chatId: string; messageId: number; cardIndex: number; browserId: string }) => {
            const { chatId, messageId, cardIndex, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messages = chat[chatId];
            if (!messages) return;
            const msg = messages.find((m) => m.id === messageId);
            if (!msg) return;

            const state = parseHokm4(msg.text);
            if (!state) return;

            const joined = hokm4JoinPlayer(state, browserId);
            if (!joined) return;
            const playerNum = joined.playerNum;

            const newState = hokm4PlayCard(joined.state, playerNum, cardIndex);
            if (!newState) return;

            msg.text = serializeHokm4(newState);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId, messageId, text: msg.text, edited: false,
            });
        }
    );

    // ─── Hokm 4-Player: new round ───
    socket.on(
        "hokm4_newround",
        (data: { chatId: string; messageId: number; browserId: string }) => {
            const { chatId, messageId, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messages = chat[chatId];
            if (!messages) return;
            const msg = messages.find((m) => m.id === messageId);
            if (!msg) return;

            const state = parseHokm4(msg.text);
            if (!state) return;

            const newState = hokm4NewRound(state);
            if (!newState) return;

            msg.text = serializeHokm4(newState);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId, messageId, text: msg.text, edited: false,
            });
        }
    );

    // ─── Chaar Barg: join (triggers round start) ───
    socket.on(
        "chaarbarg_join",
        (data: { chatId: string; messageId: number; browserId: string }) => {
            const { chatId, messageId, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messages = chat[chatId];
            if (!messages) return;
            const msg = messages.find((m) => m.id === messageId);
            if (!msg) return;

            const state = parseChaarBarg(msg.text);
            if (!state || state.phase !== 0) return;

            if (state.p2 === "?" && browserId !== state.p1) {
                state.p2 = browserId;
                const started = chaarBargStartRound(state);
                msg.text = serializeChaarBarg(started);
                io.to(`chat:${chatId}`).emit("message_edited", {
                    chatId, messageId, text: msg.text, edited: false,
                });
            }
        }
    );

    // ─── Chaar Barg: play card ───
    socket.on(
        "chaarbarg_play",
        (data: { chatId: string; messageId: number; cardIndex: number; captureChoice: number; browserId: string }) => {
            const { chatId, messageId, cardIndex, captureChoice, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messages = chat[chatId];
            if (!messages) return;
            const msg = messages.find((m) => m.id === messageId);
            if (!msg) return;

            const state = parseChaarBarg(msg.text);
            if (!state) return;

            // Auto-join p2
            if (state.p2 === "?" && browserId !== state.p1) state.p2 = browserId;
            let playerNum = 0;
            if (browserId === state.p1) playerNum = 1;
            else if (browserId === state.p2) playerNum = 2;
            if (playerNum === 0) return;

            // If phase 0 (waiting), start the round first
            let current = state;
            if (current.phase === 0) {
                current = chaarBargStartRound(current);
            }

            const newState = chaarBargPlayCard(current, playerNum, cardIndex, captureChoice);
            if (!newState) return;

            msg.text = serializeChaarBarg(newState);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId, messageId, text: msg.text, edited: false,
            });
        }
    );

    // ─── Chaar Barg: new round ───
    socket.on(
        "chaarbarg_newround",
        (data: { chatId: string; messageId: number; browserId: string }) => {
            const { chatId, messageId, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messages = chat[chatId];
            if (!messages) return;
            const msg = messages.find((m) => m.id === messageId);
            if (!msg) return;

            const state = parseChaarBarg(msg.text);
            if (!state) return;

            const newState = chaarBargNewRound(state);
            if (!newState) return;

            msg.text = serializeChaarBarg(newState);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId, messageId, text: msg.text, edited: false,
            });
        }
    );

    // ─── Delete message (verified browserId enforced, sender only) ───
    socket.on(
        "delete_message",
        (data: { chatId: string; messageId: number; browserId: string }) => {
            const { chatId, messageId, browserId } = data;
            // Enforce: the browserId must match the verified identity of this socket
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messages = chat[chatId];
            if (!messages) return;
            const msgIdx = messages.findIndex((m) => m.id === messageId);
            if (msgIdx === -1) return;
            const msg = messages[msgIdx];
            if (msg.browserId !== browserId) return; // Only sender can delete

            // Remove the message and its file if it exists
            if (msg.file) {
                const resolvedPath = path.resolve(__dirname, msg.file.replace(/^\//, ""));
                // Ensure resolved path is within the files directory
                if (resolvedPath.startsWith(path.resolve(FILES_DIR)) && fs.existsSync(resolvedPath)) {
                    fs.promises.unlink(resolvedPath).catch(() => {});
                }
            }
            messages.splice(msgIdx, 1);

            io.to(`chat:${chatId}`).emit("message_deleted", {
                chatId,
                messageId,
            });
        }
    );

    // ─── React to message (verified browserId enforced) ───
    socket.on(
        "react_message",
        (data: { chatId: string; messageId: number; emoji: string; browserId: string }) => {
            const { chatId, messageId, emoji, browserId } = data;
            // Enforce: the browserId must match the verified identity of this socket
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messages = chat[chatId];
            if (!messages) return;
            const msg = messages.find((m) => m.id === messageId);
            if (!msg) return;
            if (!msg.reactions) msg.reactions = {};
            if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
            const idx = msg.reactions[emoji].indexOf(browserId);
            if (idx !== -1) {
                // Toggle off
                msg.reactions[emoji].splice(idx, 1);
                if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
            } else {
                msg.reactions[emoji].push(browserId);
            }
            io.to(`chat:${chatId}`).emit("message_reaction", {
                chatId,
                messageId,
                reactions: msg.reactions,
            });
        }
    );

    // ─── Seen status (verified browserId enforced) ───
    socket.on(
        "message_seen",
        (data: { chatId: string; messageIds: number[]; browserId: string }) => {
            const { chatId, messageIds, browserId } = data;
            // Enforce: the browserId must match the verified identity of this socket
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messages = chat[chatId];
            if (!messages) return;
            const updatedIds: number[] = [];
            for (const msgId of messageIds) {
                const msg = messages.find((m) => m.id === msgId);
                if (msg && msg.browserId !== browserId) {
                    if (!msg.seenBy) msg.seenBy = [];
                    if (!msg.seenBy.includes(browserId)) {
                        msg.seenBy.push(browserId);
                        updatedIds.push(msgId);
                    }
                }
            }
            if (updatedIds.length > 0) {
                io.to(`chat:${chatId}`).emit("message_seen_update", {
                    chatId,
                    updates: updatedIds.map((id) => {
                        const msg = messages.find((m) => m.id === id)!;
                        return { messageId: id, seenBy: msg.seenBy };
                    }),
                });
            }
        }
    );

    // ─── Voice chat signaling ───

    socket.on("voice_join", (data: { chatId: string; browserId: string; name: string }) => {
        const { chatId, browserId, name } = data;
        if (!voiceRooms[chatId]) voiceRooms[chatId] = [];

        // Avoid duplicates
        if (!voiceRooms[chatId].find((p) => p.socketId === socket.id)) {
            voiceRooms[chatId].push({ socketId: socket.id, browserId, name });
        }

        // Tell everyone in the room (including the joiner) the updated list
        io.to(`chat:${chatId}`).emit("voice_participants", {
            chatId,
            participants: voiceRooms[chatId],
        });

        // Tell existing participants that someone joined (so they can initiate offers)
        socket.to(`chat:${chatId}`).emit("voice_user_joined", {
            chatId,
            participant: { socketId: socket.id, browserId, name },
        });
    });

    socket.on("voice_leave", (data: { chatId: string }) => {
        const { chatId } = data;
        removeFromVoiceRoom(socket.id, chatId);
    });

    socket.on("voice_offer", (data: { chatId: string; targetSocketId: string; sdp: any }) => {
        io.to(data.targetSocketId).emit("voice_offer", {
            chatId: data.chatId,
            fromSocketId: socket.id,
            sdp: data.sdp,
        });
    });

    socket.on("voice_answer", (data: { chatId: string; targetSocketId: string; sdp: any }) => {
        io.to(data.targetSocketId).emit("voice_answer", {
            chatId: data.chatId,
            fromSocketId: socket.id,
            sdp: data.sdp,
        });
    });

    socket.on("voice_ice_candidate", (data: { chatId: string; targetSocketId: string; candidate: any }) => {
        io.to(data.targetSocketId).emit("voice_ice_candidate", {
            chatId: data.chatId,
            fromSocketId: socket.id,
            candidate: data.candidate,
        });
    });

    socket.on("voice_get_participants", (chatId: string) => {
        socket.emit("voice_participants", {
            chatId,
            participants: voiceRooms[chatId] || [],
        });
    });

    socket.on("voice_toggle_video", (data: { chatId: string; videoEnabled: boolean }) => {
        const { chatId, videoEnabled } = data;
        if (voiceRooms[chatId]) {
            const participant = voiceRooms[chatId].find((p) => p.socketId === socket.id);
            if (participant) {
                participant.videoEnabled = videoEnabled;
                io.to(`chat:${chatId}`).emit("voice_video_status", {
                    chatId,
                    socketId: socket.id,
                    videoEnabled,
                });
                io.to(`chat:${chatId}`).emit("voice_participants", {
                    chatId,
                    participants: voiceRooms[chatId],
                });
            }
        }
    });

    // ─── Cleanup on disconnect ───
    socket.on("disconnect", () => {
        // Remove verified identity mapping
        delete socketBrowserIdMap[socket.id];

        // Remove from all voice rooms
        for (const chatId of Object.keys(voiceRooms)) {
            removeFromVoiceRoom(socket.id, chatId);
        }
    });
});

function removeFromVoiceRoom(socketId: string, chatId: string) {
    if (!voiceRooms[chatId]) return;
    const idx = voiceRooms[chatId].findIndex((p) => p.socketId === socketId);
    if (idx === -1) return;
    const removed = voiceRooms[chatId].splice(idx, 1)[0];

    // Notify room
    io.to(`chat:${chatId}`).emit("voice_user_left", {
        chatId,
        participant: removed,
    });
    io.to(`chat:${chatId}`).emit("voice_participants", {
        chatId,
        participants: voiceRooms[chatId],
    });

    // Clean up empty rooms
    if (voiceRooms[chatId].length === 0) {
        delete voiceRooms[chatId];
    }
}

// ─── Catch-all: serve React app for client-side routing ───
app.get("*", (_req, res) => {
    const indexPath = path.join(CLIENT_DIST, "index.html");
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(200).send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>SecureChat</title></head><body><div id="root"></div>
<script>window.location.href='http://localhost:5173'+window.location.pathname;</script>
</body></html>`);
    }
});

const PORT = process.env.PORT || 4040;

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
