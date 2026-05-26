import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import multer from "multer";
import { body, validationResult } from "express-validator";
import webpush from "web-push";
import { v4 as uuidv4 } from "uuid";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import mysql from "mysql2/promise";
import { Bot } from "grammy";

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

// ─── CORS configuration (restrict to allowed origins) ───
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : undefined; // undefined = allow all (dev mode)

const corsOptions: cors.CorsOptions = ALLOWED_ORIGINS
    ? { origin: ALLOWED_ORIGINS }
    : {};

const io = new SocketIOServer(server, {
    cors: corsOptions,
    maxHttpBufferSize: 30 * 1024 * 1024,
});

app.use(cors(corsOptions));

// ─── Security headers ───
app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
});

app.use(express.json({ limit: "1mb" }));

// ─── Files directory ───
const FILES_DIR = path.join(__dirname, "files");

if (!fs.existsSync(FILES_DIR)) {
    fs.mkdirSync(FILES_DIR, { recursive: true });
}

// ─── Multer setup (50MB limit for encrypted files) ───
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FILES_DIR),
    filename: (_req, file, cb) => {
        const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        cb(null, unique + ext);
    },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });
const adminNotificationUpload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

async function hasAllowedImageSignature(filePath: string): Promise<boolean> {
    const handle = await fs.promises.open(filePath, "r");
    try {
        const buffer = Buffer.alloc(16);
        const { bytesRead } = await handle.read(buffer, 0, 16, 0);
        if (bytesRead < 4) return false;
        // PNG
        if (
            buffer[0] === 0x89 &&
            buffer[1] === 0x50 &&
            buffer[2] === 0x4e &&
            buffer[3] === 0x47
        ) return true;
        // JPEG
        if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
        // GIF
        if (
            buffer[0] === 0x47 &&
            buffer[1] === 0x49 &&
            buffer[2] === 0x46 &&
            buffer[3] === 0x38
        ) return true;
        // WEBP (RIFF....WEBP)
        if (
            bytesRead >= 12 &&
            buffer[0] === 0x52 &&
            buffer[1] === 0x49 &&
            buffer[2] === 0x46 &&
            buffer[3] === 0x46 &&
            buffer[8] === 0x57 &&
            buffer[9] === 0x45 &&
            buffer[10] === 0x42 &&
            buffer[11] === 0x50
        ) return true;
        return false;
    } finally {
        await handle.close();
    }
}

function cleanupUploadedFile(file: Express.Multer.File | undefined): void {
    if (!file) return;
    fs.promises.unlink(file.path).catch(() => {});
}

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
    fileSize?: number;
    mediaDurationSec?: number;
    replyToId?: number;
    edited?: boolean;
    reactions?: { [emoji: string]: string[] }; // emoji -> browserId[]
    seenBy?: string[]; // browserIds that have seen this message
    tags?: { browserId: string; name: string }[];
}

interface ChatMessageRow {
    id: number;
    chat_id_hash: string;
    text: string;
    name: string;
    browser_id: string;
    created_at: Date | string;
    file: string | null;
    file_type: string | null;
    original_name: string | null;
    file_size: number | null;
    media_duration_sec: number | null;
    reply_to_id: number | null;
    edited: number;
    reactions: string | null;
    seen_by: string | null;
    tags: string | null;
}

interface AdminNotificationRow {
    id: number;
    title: string;
    text: string;
    image_url: string | null;
    created_at: Date | string;
}

interface AdminNotificationStatsRow {
    id: number;
    title: string;
    text: string;
    image_url: string | null;
    created_at: Date | string;
}

function toStoredChatId(rawChatId: string): string {
    return crypto
        .createHash("sha256")
        .update(rawChatId.trim())
        .digest("hex");
}

let globalMsgId = 0;

const mysqlHost = process.env.MYSQL_HOST || "127.0.0.1";
const mysqlPort = Number(process.env.MYSQL_PORT || "3306");
const mysqlUser = process.env.MYSQL_USER;
const mysqlPassword = process.env.MYSQL_PASSWORD;
const mysqlDatabase = process.env.MYSQL_DATABASE || process.env.MYSQL_DB;

const mysqlConfigured = Boolean(mysqlUser && mysqlPassword && mysqlDatabase);
let mysqlPool: mysql.Pool | null = null;
let mysqlReady = false;

function parseJsonValue<T>(value: unknown): T | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value !== "string") {
        return value as T;
    }
    if (value.trim() === "") return undefined;
    try {
        return JSON.parse(value) as T;
    } catch {
        return undefined;
    }
}

function rowToChatMessage(row: ChatMessageRow): ChatMessage {
    return {
        id: row.id,
        text: row.text,
        name: row.name,
        browserId: row.browser_id,
        createdAt: new Date(row.created_at),
        file: row.file || undefined,
        fileType: row.file_type || undefined,
        originalName: row.original_name || undefined,
        fileSize: row.file_size ?? undefined,
        mediaDurationSec: row.media_duration_sec ?? undefined,
        replyToId: row.reply_to_id ?? undefined,
        edited: row.edited ? true : undefined,
        reactions: parseJsonValue<{ [emoji: string]: string[] }>(row.reactions),
        seenBy: parseJsonValue<string[]>(row.seen_by),
        tags: parseJsonValue<{ browserId: string; name: string }[]>(row.tags),
    };
}

async function initMysql(): Promise<void> {
    if (!mysqlConfigured) {
        throw new Error("Missing MySQL configuration in .env. Required: MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE.");
    }
    mysqlPool = mysql.createPool({
        host: mysqlHost,
        port: mysqlPort,
        user: mysqlUser!,
        password: mysqlPassword!,
        database: mysqlDatabase!,
        waitForConnections: true,
        connectionLimit: 10,
    });
    await mysqlPool.query(`
        CREATE TABLE IF NOT EXISTS chat_messages (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            chat_id_hash CHAR(64) NOT NULL,
            text MEDIUMTEXT NOT NULL,
            name VARCHAR(255) NOT NULL,
            browser_id VARCHAR(255) NOT NULL,
            created_at DATETIME(3) NOT NULL,
            file VARCHAR(512) NULL,
            file_type VARCHAR(100) NULL,
            original_name VARCHAR(512) NULL,
            file_size BIGINT NULL,
            media_duration_sec DOUBLE NULL,
            reply_to_id BIGINT UNSIGNED NULL,
            edited TINYINT(1) NOT NULL DEFAULT 0,
            reactions JSON NULL,
            seen_by JSON NULL,
            tags JSON NULL,
            PRIMARY KEY (id),
            KEY idx_chat_created (chat_id_hash, id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    const [chatCreatedAtIndexRows] = await mysqlPool.query(
        `SELECT COUNT(*) AS total
         FROM information_schema.statistics
         WHERE table_schema = DATABASE()
           AND table_name = 'chat_messages'
           AND index_name = 'idx_chat_created_at'`
    );
    const hasChatCreatedAtIndex =
        Array.isArray(chatCreatedAtIndexRows) &&
        chatCreatedAtIndexRows.length > 0 &&
        Number((chatCreatedAtIndexRows[0] as { total?: number }).total || 0) > 0;
    if (!hasChatCreatedAtIndex) {
        await mysqlPool.query("ALTER TABLE chat_messages ADD INDEX idx_chat_created_at (chat_id_hash, created_at)");
    }
    const [fileSizeColumnRows] = await mysqlPool.query(
        `SELECT COUNT(*) AS total
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'chat_messages'
           AND column_name = 'file_size'`
    );
    const hasFileSizeColumn =
        Array.isArray(fileSizeColumnRows) &&
        fileSizeColumnRows.length > 0 &&
        Number((fileSizeColumnRows[0] as { total?: number }).total || 0) > 0;
    if (!hasFileSizeColumn) {
        await mysqlPool.query("ALTER TABLE chat_messages ADD COLUMN file_size BIGINT NULL AFTER original_name");
    }
    const [mediaDurationColumnRows] = await mysqlPool.query(
        `SELECT COUNT(*) AS total
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'chat_messages'
           AND column_name = 'media_duration_sec'`
    );
    const hasMediaDurationColumn =
        Array.isArray(mediaDurationColumnRows) &&
        mediaDurationColumnRows.length > 0 &&
        Number((mediaDurationColumnRows[0] as { total?: number }).total || 0) > 0;
    if (!hasMediaDurationColumn) {
        await mysqlPool.query("ALTER TABLE chat_messages ADD COLUMN media_duration_sec DOUBLE NULL AFTER file_size");
    }
    await mysqlPool.query(`
        CREATE TABLE IF NOT EXISTS notifications (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            title VARCHAR(255) NOT NULL,
            text TEXT NOT NULL,
            image_url TEXT NULL,
            created_at DATETIME(3) NOT NULL,
            expires_at DATETIME(3) NOT NULL,
            PRIMARY KEY (id),
            KEY idx_notifications_expires_at (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    const [notificationImageRows] = await mysqlPool.query(
        `SELECT COUNT(*) AS total
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'notifications'
           AND column_name = 'image_url'`
    );
    const hasImageColumn =
        Array.isArray(notificationImageRows) &&
        notificationImageRows.length > 0 &&
        Number((notificationImageRows[0] as { total?: number }).total || 0) > 0;
    if (!hasImageColumn) {
        await mysqlPool.query("ALTER TABLE notifications ADD COLUMN image_url TEXT NULL AFTER text");
    }
    const [notificationColumnRows] = await mysqlPool.query(
        `SELECT COUNT(*) AS total
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'notifications'
           AND column_name = 'target_browser_id'`
    );
    const hasTargetColumn =
        Array.isArray(notificationColumnRows) &&
        notificationColumnRows.length > 0 &&
        Number((notificationColumnRows[0] as { total?: number }).total || 0) > 0;
    if (!hasTargetColumn) {
        // nothing to migrate
    } else {
        const [targetIndexRows] = await mysqlPool.query(
            `SELECT COUNT(*) AS total
             FROM information_schema.statistics
             WHERE table_schema = DATABASE()
               AND table_name = 'notifications'
               AND index_name = 'idx_target_browser_id'`
        );
        const hasTargetIndex =
            Array.isArray(targetIndexRows) &&
            targetIndexRows.length > 0 &&
            Number((targetIndexRows[0] as { total?: number }).total || 0) > 0;
        if (hasTargetIndex) {
            await mysqlPool.query("ALTER TABLE notifications DROP INDEX idx_target_browser_id");
        }
        await mysqlPool.query("ALTER TABLE notifications DROP COLUMN target_browser_id");
    }
    await mysqlPool.query("DROP TABLE IF EXISTS notification_reads");
    await mysqlPool.query(`
        CREATE TABLE IF NOT EXISTS known_browser_ids (
            browser_id VARCHAR(255) NOT NULL,
            first_seen_at DATETIME(3) NOT NULL,
            PRIMARY KEY (browser_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await mysqlPool.query(`
        CREATE TABLE IF NOT EXISTS invites (
            id VARCHAR(64) NOT NULL,
            data TEXT NOT NULL,
            expires_at DATETIME(3) NOT NULL,
            PRIMARY KEY (id),
            KEY idx_invites_expires_at (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await mysqlPool.query(`
        CREATE TABLE IF NOT EXISTS send_tokens (
            browser_id VARCHAR(255) NOT NULL,
            token VARCHAR(128) NOT NULL,
            expires_at DATETIME(3) NOT NULL,
            PRIMARY KEY (browser_id),
            KEY idx_send_tokens_expires_at (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await mysqlPool.query(`
        CREATE TABLE IF NOT EXISTS pv_pending_requests (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            from_browser_id VARCHAR(255) NOT NULL,
            to_browser_id VARCHAR(255) NOT NULL,
            chat_key VARCHAR(255) NOT NULL,
            sender_name VARCHAR(255) NOT NULL,
            created_at DATETIME(3) NOT NULL,
            PRIMARY KEY (id),
            KEY idx_pv_pending_to_browser (to_browser_id),
            KEY idx_pv_pending_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await mysqlPool.query(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id VARCHAR(64) NOT NULL,
            endpoint TEXT NOT NULL,
            p256dh_key TEXT NOT NULL,
            auth_key TEXT NOT NULL,
            chat_id VARCHAR(255) NOT NULL,
            browser_id VARCHAR(255) NULL,
            created_at DATETIME(3) NOT NULL,
            PRIMARY KEY (id),
            KEY idx_push_subscriptions_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await mysqlPool.query(`
        CREATE TABLE IF NOT EXISTS bot_notifications (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            chat_id_hash CHAR(64) NOT NULL,
            browser_id VARCHAR(255) NOT NULL,
            user_id VARCHAR(255) NOT NULL,
            bot_token VARCHAR(512) NOT NULL,
            name VARCHAR(255) NOT NULL,
            created_at DATETIME(3) NOT NULL,
            PRIMARY KEY (id),
            KEY idx_bot_notifications_chat_hash (chat_id_hash),
            KEY idx_bot_notifications_browser (browser_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    const [botNotificationBrowserIdRows] = await mysqlPool.query(
        `SELECT COUNT(*) AS total
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'bot_notifications'
           AND column_name = 'browser_id'`
    );
    const hasBotNotificationBrowserIdColumn =
        Array.isArray(botNotificationBrowserIdRows) &&
        botNotificationBrowserIdRows.length > 0 &&
        Number((botNotificationBrowserIdRows[0] as { total?: number }).total || 0) > 0;
    if (!hasBotNotificationBrowserIdColumn) {
        await mysqlPool.query("ALTER TABLE bot_notifications ADD COLUMN browser_id VARCHAR(255) NOT NULL DEFAULT '' AFTER chat_id_hash");
    }
    const [rows] = await mysqlPool.query("SELECT COALESCE(MAX(id), 0) AS maxId FROM chat_messages");
    const maxId = Array.isArray(rows) && rows.length > 0 ? Number((rows[0] as { maxId?: number }).maxId || 0) : 0;
    globalMsgId = maxId;
    mysqlReady = true;
    console.info("MySQL storage initialized.");
}

async function getMessages(chatId: string): Promise<ChatMessage[]> {
    if (!mysqlReady || !mysqlPool) return [];
    const [rows] = await mysqlPool.query(
        `SELECT id, chat_id_hash, text, name, browser_id, created_at, file, file_type, original_name, file_size, media_duration_sec,
                reply_to_id, edited, reactions, seen_by, tags
         FROM chat_messages
         WHERE chat_id_hash = ?
         ORDER BY id ASC`,
        [toStoredChatId(chatId)]
    );
    return (rows as ChatMessageRow[]).map(rowToChatMessage);
}

async function getMessagesPage(chatId: string, offset: number, limit: number): Promise<{ messages: ChatMessage[]; total: number }> {
    if (!mysqlReady || !mysqlPool) return { messages: [], total: 0 };
    const [countRows] = await mysqlPool.query(
        "SELECT COUNT(*) AS total FROM chat_messages WHERE chat_id_hash = ?",
        [toStoredChatId(chatId)]
    );
    const total = Array.isArray(countRows) && countRows.length > 0
        ? Number((countRows[0] as { total?: number }).total || 0)
        : 0;
    const safeOffset = Math.max(0, offset);
    const safeLimit = Math.max(0, Math.min(limit, 100));
    const innerOffset = Math.max(0, total - safeOffset - safeLimit);
    const innerLimit = Math.max(0, Math.min(safeLimit, total - safeOffset));
    if (innerLimit === 0) return { messages: [], total };
    const [rows] = await mysqlPool.query(
        `SELECT id, chat_id_hash, text, name, browser_id, created_at, file, file_type, original_name, file_size, media_duration_sec,
                reply_to_id, edited, reactions, seen_by, tags
         FROM chat_messages
         WHERE chat_id_hash = ?
         ORDER BY id ASC
         LIMIT ? OFFSET ?`,
        [toStoredChatId(chatId), innerLimit, innerOffset]
    );
    return { messages: (rows as ChatMessageRow[]).map(rowToChatMessage), total };
}

async function getMessageById(chatId: string, messageId: number): Promise<ChatMessage | null> {
    if (!mysqlReady || !mysqlPool) return null;
    const [rows] = await mysqlPool.query(
        `SELECT id, chat_id_hash, text, name, browser_id, created_at, file, file_type, original_name, file_size, media_duration_sec,
                reply_to_id, edited, reactions, seen_by, tags
         FROM chat_messages
         WHERE chat_id_hash = ? AND id = ?
         LIMIT 1`,
        [toStoredChatId(chatId), messageId]
    );
    const row = Array.isArray(rows) && rows.length > 0 ? (rows[0] as ChatMessageRow) : null;
    return row ? rowToChatMessage(row) : null;
}

async function getMessagesByIds(chatId: string, messageIds: number[]): Promise<Map<number, ChatMessage>> {
    const result = new Map<number, ChatMessage>();
    if (!mysqlReady || !mysqlPool) return result;
    if (messageIds.length > MAX_SEEN_UPDATE_MESSAGE_IDS * 2) return result;
    const uniqueIds = Array.from(new Set(messageIds.filter((id) => Number.isFinite(id)))).slice(0, MAX_SEEN_UPDATE_MESSAGE_IDS);
    if (uniqueIds.length === 0) return result;
    const placeholders = uniqueIds.map(() => "?").join(", ");
    const [rows] = await mysqlPool.query(
        `SELECT id, chat_id_hash, text, name, browser_id, created_at, file, file_type, original_name, file_size, media_duration_sec,
                reply_to_id, edited, reactions, seen_by, tags
         FROM chat_messages
         WHERE chat_id_hash = ? AND id IN (${placeholders})`,
        [toStoredChatId(chatId), ...uniqueIds]
    );
    for (const row of rows as ChatMessageRow[]) {
        const msg = rowToChatMessage(row);
        result.set(msg.id, msg);
    }
    return result;
}

async function getLatestMessage(chatId: string): Promise<ChatMessage | null> {
    if (!mysqlReady || !mysqlPool) return null;
    const [rows] = await mysqlPool.query(
        `SELECT id, chat_id_hash, text, name, browser_id, created_at, file, file_type, original_name, file_size, media_duration_sec,
                reply_to_id, edited, reactions, seen_by, tags
         FROM chat_messages
         WHERE chat_id_hash = ?
         ORDER BY id DESC
         LIMIT 1`,
        [toStoredChatId(chatId)]
    );
    const row = Array.isArray(rows) && rows.length > 0 ? (rows[0] as ChatMessageRow) : null;
    return row ? rowToChatMessage(row) : null;
}

async function countMessagesSince(chatId: string, sinceIso?: string): Promise<number> {
    if (!mysqlReady || !mysqlPool) return 0;
    if (!sinceIso) return 0;
    const sinceDate = new Date(sinceIso);
    if (Number.isNaN(sinceDate.getTime())) return 0;
    const [rows] = await mysqlPool.query<{ total: number }[]>(
        "SELECT COUNT(*) AS total FROM chat_messages WHERE chat_id_hash = ? AND created_at > ?",
        [toStoredChatId(chatId), sinceDate]
    );
    return rows.length > 0 ? Number(rows[0].total || 0) : 0;
}

async function saveInvite(id: string, data: string, expiresAtMs: number): Promise<void> {
    if (!mysqlReady || !mysqlPool) return;
    const expiresAt = new Date(expiresAtMs);
    await mysqlPool.query(
        "INSERT INTO invites (id, data, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = ?, expires_at = ?",
        [id, data, expiresAt, data, expiresAt]
    );
}

async function getInvite(id: string): Promise<InviteRecord | null> {
    if (!mysqlReady || !mysqlPool) return null;
    const [rows] = await mysqlPool.query(
        "SELECT id, data, expires_at FROM invites WHERE id = ? LIMIT 1",
        [id]
    );
    const row = Array.isArray(rows) && rows.length > 0 ? (rows[0] as InviteRow) : null;
    if (!row) return null;
    return { data: row.data, expiresAt: new Date(row.expires_at).getTime() };
}

async function cleanupExpiredInvitesInDb(): Promise<void> {
    if (!mysqlReady || !mysqlPool) return;
    await mysqlPool.query("DELETE FROM invites WHERE expires_at <= NOW(3)");
}

async function saveSendToken(browserId: string, token: string, expiresAtMs: number): Promise<void> {
    if (!mysqlReady || !mysqlPool) return;
    const expiresAt = new Date(expiresAtMs);
    await mysqlPool.query(
        "INSERT INTO send_tokens (browser_id, token, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE token = ?, expires_at = ?",
        [browserId, token, expiresAt, token, expiresAt]
    );
}

async function getSendToken(browserId: string): Promise<{ token: string; expiresAt: number } | null> {
    if (!mysqlReady || !mysqlPool) {
        return sendTokens[browserId] || null;
    }
    const [rows] = await mysqlPool.query(
        "SELECT browser_id, token, expires_at FROM send_tokens WHERE browser_id = ? LIMIT 1",
        [browserId]
    );
    const row = Array.isArray(rows) && rows.length > 0 ? (rows[0] as SendTokenRow) : null;
    if (!row) return null;
    return { token: row.token, expiresAt: new Date(row.expires_at).getTime() };
}

async function validateSendTokenWithFallback(browserId: string, token: string): Promise<boolean> {
    const valid = validateSendToken(browserId, token);
    if (valid) return true;
    if (!mysqlReady || !mysqlPool) return false;
    const dbToken = await getSendToken(browserId);
    if (!dbToken) return false;
    if (Date.now() > dbToken.expiresAt) {
        delete sendTokens[browserId];
        void deleteSendToken(browserId).catch(() => {});
        return false;
    }
    sendTokens[browserId] = dbToken;
    return dbToken.token === token;
}

async function deleteSendToken(browserId: string): Promise<void> {
    if (!mysqlReady || !mysqlPool) return;
    await mysqlPool.query("DELETE FROM send_tokens WHERE browser_id = ?", [browserId]);
}

async function cleanupExpiredSendTokensInDb(): Promise<void> {
    if (!mysqlReady || !mysqlPool) return;
    await mysqlPool.query("DELETE FROM send_tokens WHERE expires_at <= NOW(3)");
}

async function addPvPendingRequest(request: PvRequest): Promise<void> {
    if (!mysqlReady || !mysqlPool) return;
    await mysqlPool.query(
        "INSERT INTO pv_pending_requests (from_browser_id, to_browser_id, chat_key, sender_name, created_at) VALUES (?, ?, ?, ?, NOW(3))",
        [request.fromBrowserId, request.toBrowserId, request.chatKey, request.senderName]
    );
}

async function removePvPendingRequestsForUser(toBrowserId: string): Promise<void> {
    if (!mysqlReady || !mysqlPool) return;
    await mysqlPool.query("DELETE FROM pv_pending_requests WHERE to_browser_id = ?", [toBrowserId]);
}

async function saveSubscription(
    id: string,
    sub: webpush.PushSubscription,
    chatId: string,
    browserId: string | undefined,
    createdAtMs: number
): Promise<void> {
    if (!mysqlReady || !mysqlPool) return;
    const p256dh = sub.keys?.p256dh || "";
    const auth = sub.keys?.auth || "";
    if (!sub.endpoint || !p256dh || !auth) return;
    const createdAt = new Date(createdAtMs);
    await mysqlPool.query(
        "INSERT INTO push_subscriptions (id, endpoint, p256dh_key, auth_key, chat_id, browser_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE endpoint = ?, p256dh_key = ?, auth_key = ?, chat_id = ?, browser_id = ?, created_at = ?",
        [id, sub.endpoint, p256dh, auth, chatId, browserId || null, createdAt, sub.endpoint, p256dh, auth, chatId, browserId || null, createdAt]
    );
}

async function deleteSubscription(id: string): Promise<void> {
    if (!mysqlReady || !mysqlPool) return;
    await mysqlPool.query("DELETE FROM push_subscriptions WHERE id = ?", [id]);
}

async function deleteExpiredSubscriptionsInDb(): Promise<void> {
    if (!mysqlReady || !mysqlPool) return;
    await mysqlPool.query("DELETE FROM push_subscriptions WHERE created_at <= DATE_SUB(NOW(3), INTERVAL 7 DAY)");
}

async function saveBotNotification(chatId: string, browserId: string, userId: string, botToken: string, name: string): Promise<void> {
    if (!mysqlReady || !mysqlPool) return;
    await mysqlPool.query(
        "INSERT INTO bot_notifications (chat_id_hash, browser_id, user_id, bot_token, name, created_at) VALUES (?, ?, ?, ?, ?, NOW(3))",
        [toStoredChatId(chatId), browserId, userId, botToken, name]
    );
}

async function getBotNotificationsForBrowserAndChat(browserId: string, chatId: string): Promise<BotNotificationRow[]> {
    if (!mysqlReady || !mysqlPool) return [];
    const [rows] = await mysqlPool.query(
        `SELECT id, chat_id_hash, browser_id, user_id, bot_token, name, created_at
         FROM bot_notifications
         WHERE browser_id = ? AND chat_id_hash = ?
         ORDER BY id DESC`,
        [browserId, toStoredChatId(chatId)]
    );
    return rows as BotNotificationRow[];
}

async function getBotNotificationsForChat(chatId: string): Promise<BotNotificationRow[]> {
    if (!mysqlReady || !mysqlPool) return [];
    const [rows] = await mysqlPool.query(
        `SELECT id, chat_id_hash, browser_id, user_id, bot_token, name, created_at
         FROM bot_notifications
         WHERE chat_id_hash = ?
         ORDER BY id DESC`,
        [toStoredChatId(chatId)]
    );
    return rows as BotNotificationRow[];
}

async function deleteBotNotification(notificationId: number, browserId: string, chatId: string): Promise<boolean> {
    if (!mysqlReady || !mysqlPool) return false;
    const [result] = await mysqlPool.query(
        "DELETE FROM bot_notifications WHERE id = ? AND browser_id = ? AND chat_id_hash = ?",
        [notificationId, browserId, toStoredChatId(chatId)]
    );
    return Number((result as { affectedRows?: number }).affectedRows || 0) > 0;
}

async function bootstrapRuntimeStateFromMysql(): Promise<void> {
    if (!mysqlReady || !mysqlPool) return;

    await cleanupExpiredInvitesInDb();
    await cleanupExpiredSendTokensInDb();
    await deleteExpiredSubscriptionsInDb();

    const [sendTokenRows] = await mysqlPool.query("SELECT browser_id, token, expires_at FROM send_tokens");
    for (const row of sendTokenRows as SendTokenRow[]) {
        sendTokens[row.browser_id] = { token: row.token, expiresAt: new Date(row.expires_at).getTime() };
    }
}

async function upsertMessage(chatId: string, msg: ChatMessage): Promise<void> {
    if (!mysqlReady || !mysqlPool) return;
    await mysqlPool.query(
        `INSERT INTO chat_messages
            (id, chat_id_hash, text, name, browser_id, created_at, file, file_type, original_name, file_size, media_duration_sec, reply_to_id, edited, reactions, seen_by, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            text = VALUES(text),
            name = VALUES(name),
            browser_id = VALUES(browser_id),
            created_at = VALUES(created_at),
            file = VALUES(file),
            file_type = VALUES(file_type),
            original_name = VALUES(original_name),
            file_size = VALUES(file_size),
            media_duration_sec = VALUES(media_duration_sec),
            reply_to_id = VALUES(reply_to_id),
            edited = VALUES(edited),
            reactions = VALUES(reactions),
            seen_by = VALUES(seen_by),
            tags = VALUES(tags)`,
        [
            msg.id,
            toStoredChatId(chatId),
            msg.text,
            msg.name,
            msg.browserId,
            msg.createdAt,
            msg.file || null,
            msg.fileType || null,
            msg.originalName || null,
            msg.fileSize ?? null,
            msg.mediaDurationSec ?? null,
            msg.replyToId ?? null,
            msg.edited ? 1 : 0,
            msg.reactions ? JSON.stringify(msg.reactions) : null,
            msg.seenBy ? JSON.stringify(msg.seenBy) : null,
            msg.tags ? JSON.stringify(msg.tags) : null,
        ]
    );
}

async function upsertMessages(chatId: string, messages: ChatMessage[]): Promise<void> {
    if (!mysqlReady || !mysqlPool || messages.length === 0) return;
    const storedChatId = toStoredChatId(chatId);
    for (let batchStartIndex = 0; batchStartIndex < messages.length; batchStartIndex += DB_UPSERT_BATCH_SIZE) {
        const chunk = messages.slice(batchStartIndex, batchStartIndex + DB_UPSERT_BATCH_SIZE);
        const valuesSql = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
        const params: Array<string | number | Date | null> = [];
        for (const msg of chunk) {
            params.push(
                msg.id,
                storedChatId,
                msg.text,
                msg.name,
                msg.browserId,
                msg.createdAt,
                msg.file || null,
                msg.fileType || null,
                msg.originalName || null,
                msg.fileSize ?? null,
                msg.mediaDurationSec ?? null,
                msg.replyToId ?? null,
                msg.edited ? 1 : 0,
                msg.reactions ? JSON.stringify(msg.reactions) : null,
                msg.seenBy ? JSON.stringify(msg.seenBy) : null,
                msg.tags ? JSON.stringify(msg.tags) : null
            );
        }
        await mysqlPool.query(
            `INSERT INTO chat_messages
                (id, chat_id_hash, text, name, browser_id, created_at, file, file_type, original_name, file_size, media_duration_sec, reply_to_id, edited, reactions, seen_by, tags)
             VALUES ${valuesSql}
             ON DUPLICATE KEY UPDATE
                text = VALUES(text),
                name = VALUES(name),
                browser_id = VALUES(browser_id),
                created_at = VALUES(created_at),
                file = VALUES(file),
                file_type = VALUES(file_type),
                original_name = VALUES(original_name),
                file_size = VALUES(file_size),
                media_duration_sec = VALUES(media_duration_sec),
                reply_to_id = VALUES(reply_to_id),
                edited = VALUES(edited),
                reactions = VALUES(reactions),
                seen_by = VALUES(seen_by),
                tags = VALUES(tags)`,
            params
        );
    }
}

async function deleteMessageById(chatId: string, messageId: number): Promise<void> {
    if (!mysqlReady || !mysqlPool) return;
    await mysqlPool.query(
        "DELETE FROM chat_messages WHERE chat_id_hash = ? AND id = ? LIMIT 1",
        [toStoredChatId(chatId), messageId]
    );
}

async function getChatCount(): Promise<number> {
    if (!mysqlReady || !mysqlPool) return 0;
    const [rows] = await mysqlPool.query("SELECT COUNT(DISTINCT chat_id_hash) AS total FROM chat_messages");
    return Array.isArray(rows) && rows.length > 0 ? Number((rows[0] as { total?: number }).total || 0) : 0;
}

async function cleanupExpiredNotifications(): Promise<void> {
    if (!mysqlReady || !mysqlPool) return;
    await mysqlPool.query("DELETE FROM notifications WHERE expires_at <= NOW(3)");
}

async function getActiveNotificationStats(): Promise<
    { title: string; text: string; imageUrl?: string; date: string; seenCount: number }[]
> {
    if (!mysqlReady || !mysqlPool) return [];
    await cleanupExpiredNotifications();
    const [rows] = await mysqlPool.query(
        `SELECT n.id, n.title, n.text, n.image_url, n.created_at
         FROM notifications n
         WHERE n.expires_at > NOW(3)
         ORDER BY n.created_at DESC`
    );
    return (rows as AdminNotificationStatsRow[]).map((row) => ({
        title: row.title,
        text: row.text,
        imageUrl: row.image_url || undefined,
        date: new Date(row.created_at).toISOString(),
        seenCount: 0, // seen state is client-side only
    }));
}

async function getTotalKnownUsers(): Promise<number> {
    if (!mysqlReady || !mysqlPool) return knownBrowserIds.size;
    const [rows] = await mysqlPool.query("SELECT COUNT(*) AS total FROM known_browser_ids");
    return Array.isArray(rows) && rows.length > 0 ? Number((rows[0] as { total?: number }).total || 0) : 0;
}

async function rememberBrowserId(browserId: string): Promise<void> {
    knownBrowserIds.add(browserId);
    if (!mysqlReady || !mysqlPool) return;
    await mysqlPool.query(
        "INSERT IGNORE INTO known_browser_ids (browser_id, first_seen_at) VALUES (?, NOW(3))",
        [browserId]
    );
}

// ─── Memory limits ───
const MAX_MESSAGE_TEXT_LENGTH = 50000; // 50KB text limit
const MAX_SEEN_UPDATE_MESSAGE_IDS = 500;
const DB_UPSERT_BATCH_SIZE = 100;
const MAX_PV_PENDING_REQUESTS = 1000;
const SUBSCRIPTION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_TELEGRAM_USER_ID_LENGTH = 255;
const MAX_TELEGRAM_BOT_TOKEN_LENGTH = 512;
const MAX_TELEGRAM_NOTIFICATION_NAME_LENGTH = 255;
const MAX_TELEGRAM_BOT_CACHE_SIZE = 100;
const MAX_INVITE_TTL_HOURS = 168; // 7 days
const MAX_INVITE_TTL_MINUTES = MAX_INVITE_TTL_HOURS * 60;
const INVITE_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes
const NOTIFICATION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // every hour
const MESSAGE_DELIVERY_RETRY_INTERVAL_MS = 10 * 1000;
const MESSAGE_DELIVERY_RETRY_WINDOW_MS = 60 * 1000;

// ─── Rate limiter for file system access routes ───
const fileRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // max 100 requests per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests" },
});
const inviteReadRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests" },
});
const adminRouteRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests" },
});
const notificationReadRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests" },
});

// ─── Browser ID → name tracking for duplicate name resolution ───
const chatNameMaps: { [chatId: string]: { [browserId: string]: string } } = {};

// ─── Public key registry (browserId → publicKey JWK string) ───
const publicKeyRegistry: { [browserId: string]: string } = {};

// ─── Verified socket → browserId mapping ───
const socketBrowserIdMap: { [socketId: string]: string } = {};
const pendingMessageDeliveries = new Map<string, { startedAt: number; timeoutId: ReturnType<typeof setTimeout> }>();

// ─── Browser ban list (persisted in ban.txt) ───
const BAN_FILE = path.join(__dirname, "ban.txt");
const bannedBrowserIds = new Set<string>();

function loadBansFromFile() {
    try {
        if (!fs.existsSync(BAN_FILE)) {
            console.info("ban.txt not found; starting with an empty ban list");
            return;
        }
        const content = fs.readFileSync(BAN_FILE, "utf8");
        bannedBrowserIds.clear();
        for (const line of content.split(/\r?\n/)) {
            const browserId = line.trim();
            if (browserId) bannedBrowserIds.add(browserId);
        }
    } catch (error) {
        console.error("Failed to load ban list:", error);
    }
}

function saveBansToFile() {
    try {
        const content = Array.from(bannedBrowserIds).join("\n");
        fs.writeFileSync(BAN_FILE, content ? `${content}\n` : "");
        return true;
    } catch (error) {
        console.error("Failed to save ban list:", error);
        return false;
    }
}

function constantTimeEqual(a: string, b: string): boolean {
    const aHash = crypto.createHash("sha256").update(a).digest();
    const bHash = crypto.createHash("sha256").update(b).digest();
    return crypto.timingSafeEqual(aHash, bHash);
}

// ─── Send message tokens (browserId → { token, expiresAt }) ───
const sendTokens: { [browserId: string]: { token: string; expiresAt: number } } = {};
const knownBrowserIds = new Set<string>();

function generateSendToken(browserId: string): string {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + 30 * 60 * 1000;
    sendTokens[browserId] = { token, expiresAt }; // 30 minute expiry
    void saveSendToken(browserId, token, expiresAt).catch(() => {});
    return token;
}

function validateSendToken(browserId: string, token: string): boolean {
    const entry = sendTokens[browserId];
    if (!entry) return false;
    if (entry.token !== token || Date.now() > entry.expiresAt) {
        delete sendTokens[browserId];
        void deleteSendToken(browserId).catch(() => {});
        return false;
    }
    return true;
}

function getAdminCredentials(req: express.Request): { username: string; password: string } {
    const bodyUsername = typeof req.body?.adminUsername === "string" ? req.body.adminUsername : "";
    const bodyPassword = typeof req.body?.adminPassword === "string" ? req.body.adminPassword : "";
    if (bodyUsername || bodyPassword) {
        return { username: bodyUsername, password: bodyPassword };
    }

    const header = req.headers.authorization || "";
    if (header.startsWith("Basic ")) {
        const base64Payload = header.slice(6).trim();
        try {
            const decoded = Buffer.from(base64Payload, "base64").toString("utf8");
            const separatorIndex = decoded.indexOf(":");
            if (separatorIndex >= 0) {
                return {
                    username: decoded.slice(0, separatorIndex),
                    password: decoded.slice(separatorIndex + 1),
                };
            }
        } catch {
            return { username: "", password: "" };
        }
    }

    return { username: "", password: "" };
}

function isAdminAuthorized(req: express.Request): boolean {
    const expectedUsername = process.env.ADMIN_USERNAME || "";
    const expectedPassword = process.env.ADMIN_PASSWORD || "";
    if (!expectedUsername || !expectedPassword) return false;
    const { username, password } = getAdminCredentials(req);
    return constantTimeEqual(username, expectedUsername) && constantTimeEqual(password, expectedPassword);
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

function getMessageDeliveryKey(chatId: string, messageId: number, browserId: string): string {
    return `${chatId}::${messageId}::${browserId}`;
}

function parseMessageDeliveryKey(key: string): { chatId: string; messageId: number; browserId: string } | null {
    const keyParts = key.split("::");
    if (keyParts.length !== 3) return null;
    const [chatId, messageIdRaw, browserId] = keyParts;
    const messageId = Number(messageIdRaw);
    if (!chatId || !browserId || !Number.isFinite(messageId)) return null;
    return { chatId, messageId, browserId };
}

function clearPendingMessageDelivery(chatId: string, messageId: number, browserId: string): void {
    const key = getMessageDeliveryKey(chatId, messageId, browserId);
    const pending = pendingMessageDeliveries.get(key);
    if (!pending) return;
    clearTimeout(pending.timeoutId);
    pendingMessageDeliveries.delete(key);
}

function getSubscribedVerifiedBrowserIds(chatId: string): string[] {
    const room = io.sockets.adapter.rooms.get(`chat:${chatId}`);
    if (!room) return [];
    const browserIds = new Set<string>();
    room.forEach((socketId) => {
        const browserId = getVerifiedBrowserId(socketId);
        if (browserId) browserIds.add(browserId);
    });
    return Array.from(browserIds);
}

function emitToBrowserInChat(chatId: string, browserId: string, event: string, payload: unknown): void {
    const room = io.sockets.adapter.rooms.get(`chat:${chatId}`);
    if (!room) return;
    room.forEach((socketId) => {
        if (socketBrowserIdMap[socketId] === browserId) {
            io.to(socketId).emit(event, payload);
        }
    });
}

function scheduleMessageDeliveryRetry(chatId: string, messageId: number, browserId: string): void {
    const key = getMessageDeliveryKey(chatId, messageId, browserId);
    if (pendingMessageDeliveries.has(key)) return;

    const startedAt = Date.now();
    const runRetry = () => {
        const pending = pendingMessageDeliveries.get(key);
        if (!pending) return;

        if (Date.now() - startedAt >= MESSAGE_DELIVERY_RETRY_WINDOW_MS) {
            clearTimeout(pending.timeoutId);
            pendingMessageDeliveries.delete(key);
            return;
        }

        emitToBrowserInChat(chatId, browserId, "request_message_http_refresh", {
            chatId,
            messageId,
        });

        const nextTimeoutId = setTimeout(runRetry, MESSAGE_DELIVERY_RETRY_INTERVAL_MS);
        pendingMessageDeliveries.set(key, { startedAt: pending.startedAt, timeoutId: nextTimeoutId });
    };

    const timeoutId = setTimeout(runRetry, MESSAGE_DELIVERY_RETRY_INTERVAL_MS);
    pendingMessageDeliveries.set(key, { startedAt, timeoutId });
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

loadBansFromFile();

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

// ─── Serve uploaded files (only accessible to users who know the chatId) ───
// Files are encrypted client-side, but we still restrict enumeration
app.get("/files/:filename", fileRateLimiter, (req, res) => {
    const filename = req.params.filename as string;
    // Sanitize filename - only allow alphanumeric, dash, dot, underscore (no spaces)
    if (!/^[\w\-.]+$/.test(filename)) {
        return res.status(400).json({ error: "Invalid filename" });
    }
    const filePath = path.join(FILES_DIR, filename);
    const resolvedPath = path.resolve(filePath);
    // Ensure resolved path is within the files directory (prevent path traversal)
    if (!resolvedPath.startsWith(path.resolve(FILES_DIR))) {
        return res.status(403).json({ error: "Access denied" });
    }
    if (!fs.existsSync(resolvedPath)) {
        return res.status(404).json({ error: "File not found" });
    }
    res.sendFile(resolvedPath);
});

// ─── VAPID public key (must be before /api/:chatId) ───
app.get("/api/vapid-public-key", (_req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

const banStatusRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests" },
});

app.get("/api/status/:browserId", banStatusRateLimiter, (req, res) => {
    const rawBrowserId = req.params.browserId;
    const browserId = typeof rawBrowserId === "string" ? rawBrowserId.trim() : "";
    res.json({ ban: browserId ? bannedBrowserIds.has(browserId) : false });
});

app.post("/api/invites", (req, res) => {
    try {
        const data = typeof req.body?.data === "string" ? req.body.data : "";
        const ttlValue = Number(req.body?.ttlValue);
        const ttlUnit = req.body?.ttlUnit === "hour" ? "hour" : "minute";
        if (!data || !Number.isFinite(ttlValue) || ttlValue <= 0) {
            res.status(400).json({ error: "Invalid invite payload" });
            return;
        }
        const requestedTtlMs = (ttlUnit === "hour" ? 60 * 60 * 1000 : 60 * 1000) * ttlValue;
        // Cap invite lifetime to one week.
        const maxTtlMs = MAX_INVITE_TTL_HOURS * 60 * 60 * 1000;
        const ttlMs = Math.min(requestedTtlMs, maxTtlMs);
        const id = uuidv4();
        const expiresAt = Date.now() + ttlMs;
        void saveInvite(id, data, expiresAt).catch(() => {});
        res.json({ success: true, id });
    } catch {
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get("/api/invites/:id", inviteReadRateLimiter, async (req, res) => {
    try {
        const inviteIdRaw = req.params.id;
        const inviteId = Array.isArray(inviteIdRaw) ? inviteIdRaw[0] : inviteIdRaw;
        if (!inviteId) {
            res.status(400).json({ error: "Invalid invite id" });
            return;
        }
        const invite = await getInvite(inviteId);
        if (!invite) {
            res.status(404).json({ error: "Invite not found" });
            return;
        }
        if (Date.now() > invite.expiresAt) {
            void cleanupExpiredInvitesInDb().catch(() => {});
            res.status(410).json({ error: "Invite expired" });
            return;
        }
        res.json({ success: true, data: invite.data });
    } catch {
        res.status(500).json({ error: "Internal server error" });
    }
});

const banUserRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests" },
});


// ─── VAPID Push config ───
webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
);

app.post("/api/:chatId/subscribe", express.json(), (req, res) => {
    const sub = req.body.subscription as webpush.PushSubscription;
    const chatId = req.params.chatId;
    const browserId = req.body.browserId as string | undefined;
    if (!sub || !sub.endpoint) {
        return res.status(400).json({ error: "Invalid subscription" });
    }
    const id = uuidv4();
    const createdAt = Date.now();
    void saveSubscription(id, sub, chatId, browserId, createdAt).catch(() => {});
    res.json({ success: true, subId: id });
});

app.post("/api/:chatId/unsubscribe", express.json(), (req, res) => {
    const { subId } = req.body;
    void deleteSubscription(subId).catch(() => {});
    res.json({ success: true });
});

app.post("/api/bot-notifications/list", async (req, res) => {
    try {
        if (!mysqlReady || !mysqlPool) {
            res.status(503).json({ error: "Storage unavailable" });
            return;
        }
        const chatId = typeof req.body?.chatId === "string" ? req.body.chatId.trim() : "";
        const browserId = typeof req.body?.browserId === "string" ? req.body.browserId.trim() : "";
        const sendToken = typeof req.body?.sendToken === "string" ? req.body.sendToken : "";
        if (!chatId || !browserId || !sendToken || !(await validateSendTokenWithFallback(browserId, sendToken))) {
            res.status(403).json({ error: "Invalid or expired send token" });
            return;
        }
        const rows = await getBotNotificationsForBrowserAndChat(browserId, chatId);
        res.json({
            success: true,
            notifications: rows.map((row) => ({
                id: row.id,
                userId: row.user_id,
                name: row.name,
            })),
        });
    } catch {
        res.status(500).json({ error: "Internal server error" });
    }
});

app.delete("/api/:chatId/bot-notifications/:notificationId", async (req, res) => {
    try {
        if (!mysqlReady || !mysqlPool) {
            res.status(503).json({ error: "Storage unavailable" });
            return;
        }
        const chatId = typeof req.params?.chatId === "string" ? req.params.chatId.trim() : "";
        const notificationId = Number.parseInt(req.params?.notificationId || "", 10);
        const browserId = typeof req.body?.browserId === "string" ? req.body.browserId.trim() : "";
        const sendToken = typeof req.body?.sendToken === "string" ? req.body.sendToken : "";
        if (!chatId || !browserId || !sendToken || !Number.isFinite(notificationId) || notificationId <= 0) {
            res.status(400).json({ error: "chatId, notificationId, browserId, and send token are required" });
            return;
        }
        if (!(await validateSendTokenWithFallback(browserId, sendToken))) {
            res.status(403).json({ error: "Invalid or expired send token" });
            return;
        }
        const deleted = await deleteBotNotification(notificationId, browserId, chatId);
        if (!deleted) {
            res.status(404).json({ error: "Notification not found" });
            return;
        }
        res.json({ success: true });
    } catch {
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post("/api/:chatId/bot-notifications", async (req, res) => {
    try {
        if (!mysqlReady || !mysqlPool) {
            res.status(503).json({ error: "Storage unavailable" });
            return;
        }
        const chatId = req.params.chatId;
        const browserId = typeof req.body?.browserId === "string" ? req.body.browserId.trim() : "";
        const sendToken = typeof req.body?.sendToken === "string" ? req.body.sendToken : "";
        const userId = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";
        const botTokenRaw =
            typeof req.body?.botToken === "string"
                ? req.body.botToken
                : (typeof req.body?.bottoken === "string" ? req.body.bottoken : "");
        const botToken = botTokenRaw.trim();
        const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
        if (!chatId || !browserId || !sendToken || !userId || !botToken || !name) {
            res.status(400).json({ error: "chatId, userId, bot token, and name are required" });
            return;
        }
        if (!(await validateSendTokenWithFallback(browserId, sendToken))) {
            res.status(403).json({ error: "Invalid or expired send token" });
            return;
        }
        if (
            browserId.length > 255
            || !/^[\w-]+$/.test(browserId)
            || userId.length > MAX_TELEGRAM_USER_ID_LENGTH
            || botToken.length > MAX_TELEGRAM_BOT_TOKEN_LENGTH
            || name.length > MAX_TELEGRAM_NOTIFICATION_NAME_LENGTH
        ) {
            res.status(400).json({ error: "browserId, userId, bot token, or name is invalid or too long" });
            return;
        }
        await saveBotNotification(chatId, browserId, userId, botToken, name);
        res.json({ success: true });
    } catch {
        res.status(500).json({ error: "Internal server error" });
    }
});

app.patch("/api/banuser", banUserRateLimiter, express.json(), (req, res) => {
    const browserId = typeof req.body?.browserId === "string" ? req.body.browserId.trim() : "";
    const shouldBan = Boolean(req.body?.ban);
    const adminUsername = typeof req.body?.adminUsername === "string" ? req.body.adminUsername : "";
    const adminPassword = typeof req.body?.adminPassword === "string" ? req.body.adminPassword : "";

    if (!browserId) {
        res.status(400).json({ error: "browserId is required" });
        return;
    }

    const expectedUsername = process.env.ADMIN_USERNAME || "";
    const expectedPassword = process.env.ADMIN_PASSWORD || "";
    if (!expectedUsername || !expectedPassword) {
        res.status(503).json({ error: "Admin credentials not configured" });
        return;
    }
    if (
        !constantTimeEqual(adminUsername, expectedUsername) ||
        !constantTimeEqual(adminPassword, expectedPassword)
    ) {
        res.status(403).json({ error: "Unauthorized" });
        return;
    }

    if (shouldBan) {
        bannedBrowserIds.add(browserId);
    } else {
        bannedBrowserIds.delete(browserId);
    }
    if (!saveBansToFile()) {
        if (shouldBan) bannedBrowserIds.delete(browserId);
        else bannedBrowserIds.add(browserId);
        res.status(500).json({ error: "Failed to persist ban list" });
        return;
    }
    res.json({ success: true, ban: bannedBrowserIds.has(browserId) });
});

app.post("/api/notification", adminRouteRateLimiter, adminNotificationUpload.single("image"), async (req, res) => {
    try {
        if (!isAdminAuthorized(req)) {
            cleanupUploadedFile(req.file);
            res.status(403).json({ error: "Unauthorized" });
            return;
        }
        if (!mysqlReady || !mysqlPool) {
            cleanupUploadedFile(req.file);
            res.status(503).json({ error: "Storage unavailable" });
            return;
        }

        const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
        const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
        const hasDeprecatedImageUrlField = typeof req.body?.imageUrl === "string" && req.body.imageUrl.trim().length > 0;
        const imageUrl = req.file ? `/files/${req.file.filename}` : null;
        if (hasDeprecatedImageUrlField) {
            cleanupUploadedFile(req.file);
            res.status(400).json({ error: "The imageUrl field is deprecated. Please upload an image file directly or omit the image." });
            return;
        }
        if (req.file) {
            const signatureOk = await hasAllowedImageSignature(req.file.path).catch(() => false);
            if (!signatureOk) {
                cleanupUploadedFile(req.file);
                res.status(400).json({ error: "Invalid image file type. Supported formats: PNG, JPEG, GIF, WEBP." });
                return;
            }
        }
        const inputDate = typeof req.body?.date === "string" ? req.body.date.trim() : "";
        if (!title || !text) {
            cleanupUploadedFile(req.file);
            res.status(400).json({ error: "title and text are required" });
            return;
        }

        const createdAt = inputDate ? new Date(inputDate) : new Date();
        if (Number.isNaN(createdAt.getTime())) {
            cleanupUploadedFile(req.file);
            res.status(400).json({ error: "Invalid date" });
            return;
        }
        const expiresAt = new Date(createdAt.getTime() + 48 * 60 * 60 * 1000);
        const [insertResult] = await mysqlPool.query(
            "INSERT INTO notifications (title, text, image_url, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
            [title, text, imageUrl, createdAt, expiresAt]
        );

        const notificationId = Number((insertResult as mysql.ResultSetHeader).insertId || 0);
        const payload = {
            id: notificationId,
            title,
            text,
            imageUrl: imageUrl || undefined,
            date: createdAt.toISOString(),
        };
        io.emit("admin_notification_created", payload);
        res.json({ success: true, ...payload });
    } catch {
        cleanupUploadedFile(req.file);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get("/api/notifications", notificationReadRateLimiter, async (req, res) => {
    try {
        if (!mysqlReady || !mysqlPool) {
            res.status(503).json({ error: "Storage unavailable" });
            return;
        }

        await cleanupExpiredNotifications();
        const [rows] = await mysqlPool.query(
            `SELECT n.id, n.title, n.text, n.image_url, n.created_at
             FROM notifications n
             WHERE n.expires_at > NOW(3)
             ORDER BY n.created_at DESC`,
        );

        const notifications = (rows as AdminNotificationRow[]).map((row) => ({
            id: row.id,
            title: row.title,
            text: row.text,
            imageUrl: row.image_url || undefined,
            date: new Date(row.created_at).toISOString(),
            seen: false,
        }));
        res.json({ success: true, notifications });
    } catch {
        res.status(500).json({ error: "Internal server error" });
    }
});

async function notifyAll(chatId: string, payload: string, senderBrowserId?: string) {
    const subscriptionsForChat = await getSubscriptionsForChat(chatId, senderBrowserId);
    const promises = subscriptionsForChat.map(({ id, sub }) => {
        return webpush.sendNotification(sub, payload).catch((err) => {
            if (err.statusCode === 410 || err.statusCode === 404) {
                void deleteSubscription(id).catch(() => {});
            }
        });
    });
    await Promise.all(promises);
}

const telegramBotCache = new Map<string, Bot>();

function getTelegramBot(token: string): Bot {
    const existing = telegramBotCache.get(token);
    if (existing) return existing;
    if (telegramBotCache.size >= MAX_TELEGRAM_BOT_CACHE_SIZE) {
        const oldestToken = telegramBotCache.keys().next().value;
        if (typeof oldestToken === "string") {
            telegramBotCache.delete(oldestToken);
        }
    }
    const botOptions = process.env.PROXY_TELEGRAM_API ? {
        client: {
            apiRoot: process.env.PROXY_TELEGRAM_API
        }
    } : undefined;
    const bot = new Bot(token, botOptions);
    telegramBotCache.set(token, bot);
    return bot;
}

async function notifyTelegramBots(chatId: string, msg: ChatMessage, onlineBrowserIds?: Set<string>): Promise<void> {
    const rows = await getBotNotificationsForChat(chatId);
    if (rows.length === 0) return;
    const onlineRecipientBrowserIds = onlineBrowserIds ?? new Set(getSubscribedVerifiedBrowserIds(chatId));
    const telegramMessage = msg.file
        ? `${msg.name}: sent a file in a chat`
        : `${msg.name}: sent a text message in a chat`;
    const sendPromises = rows
        .filter((row) => row.browser_id !== msg.browserId && !onlineRecipientBrowserIds.has(row.browser_id))
        .map((row) => {
        const bot = getTelegramBot(row.bot_token);
        return bot.api.sendMessage(row.user_id, telegramMessage).catch((error) => {
            console.error("Failed to send telegram notification", {
                notificationId: row.id,
                userId: row.user_id,
                error: error instanceof Error ? error.message : "unknown_error",
            });
        });
    });
    await Promise.all(sendPromises);
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
interface InviteRecord {
    data: string;
    expiresAt: number;
}

interface InviteRow {
    id: string;
    data: string;
    expires_at: Date | string;
}

interface SendTokenRow {
    browser_id: string;
    token: string;
    expires_at: Date | string;
}

interface PvPendingRequestRow {
    id: number;
    from_browser_id: string;
    to_browser_id: string;
    chat_key: string;
    sender_name: string;
}

interface PushSubscriptionRow {
    id: string;
    endpoint: string;
    p256dh_key: string;
    auth_key: string;
    chat_id: string;
    browser_id: string | null;
    created_at: Date | string;
}

interface BotNotificationRow {
    id: number;
    chat_id_hash: string;
    browser_id: string;
    user_id: string;
    bot_token: string;
    name: string;
    created_at: Date | string;
}

async function getPvPendingRequestsForUser(toBrowserId: string): Promise<PvRequest[]> {
    if (!mysqlReady || !mysqlPool) return [];
    const [rows] = await mysqlPool.query(
        "SELECT from_browser_id, to_browser_id, chat_key, sender_name FROM pv_pending_requests WHERE to_browser_id = ? ORDER BY id ASC",
        [toBrowserId]
    );
    return (rows as PvPendingRequestRow[]).map((row) => ({
        fromBrowserId: row.from_browser_id,
        toBrowserId: row.to_browser_id,
        chatKey: row.chat_key,
        senderName: row.sender_name,
    }));
}

async function getPvPendingRequestCount(): Promise<number> {
    if (!mysqlReady || !mysqlPool) return 0;
    const [rows] = await mysqlPool.query("SELECT COUNT(*) AS total FROM pv_pending_requests");
    return Array.isArray(rows) && rows.length > 0 ? Number((rows[0] as { total?: number }).total || 0) : 0;
}

async function getSubscriptionsForChat(chatId: string, senderBrowserId?: string): Promise<Array<{ id: string; sub: webpush.PushSubscription }>> {
    if (!mysqlReady || !mysqlPool) return [];
    const [rows] = await mysqlPool.query(
        `SELECT id, endpoint, p256dh_key, auth_key
         FROM push_subscriptions
         WHERE chat_id = ?
           AND (? IS NULL OR browser_id IS NULL OR browser_id <> ?)`,
        [chatId, senderBrowserId || null, senderBrowserId || null]
    );
    return (rows as PushSubscriptionRow[]).map((row) => ({
        id: row.id,
        sub: {
            endpoint: row.endpoint,
            keys: {
                p256dh: row.p256dh_key,
                auth: row.auth_key,
            },
        },
    }));
}

const sendTokenCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [browserId, entry] of Object.entries(sendTokens)) {
        if (entry.expiresAt <= now) {
            delete sendTokens[browserId];
            void deleteSendToken(browserId).catch(() => {});
        }
    }
    void cleanupExpiredSendTokensInDb().catch(() => {});
}, 60 * 1000);
sendTokenCleanupInterval.unref();

const inviteCleanupInterval = setInterval(() => {
    void cleanupExpiredInvitesInDb().catch(() => {});
}, INVITE_CLEANUP_INTERVAL_MS);
inviteCleanupInterval.unref();

const subscriptionCleanupInterval = setInterval(() => {
    void deleteExpiredSubscriptionsInDb().catch(() => {});
}, 60 * 60 * 1000); // Run every hour
subscriptionCleanupInterval.unref();

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

    socket.on(
        "message_delivered",
        (data: { chatId: string; messageId: number; browserId: string }) => {
            const { chatId, messageId, browserId } = data || {};
            if (!chatId || !Number.isFinite(messageId) || !browserId) return;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            clearPendingMessageDelivery(chatId, messageId, browserId);
        }
    );

    socket.on(
        "http_messages_updated",
        (data: { chatId: string; messageId: number; browserId: string }) => {
            const { chatId, messageId, browserId } = data || {};
            if (!chatId || !Number.isFinite(messageId) || !browserId) return;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            clearPendingMessageDelivery(chatId, messageId, browserId);
        }
    );

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
                    void rememberBrowserId(response.browserId);
                    socket.emit("identity_verified", { success: true });

                    // Deliver pending PV requests
                    const pendingForUser = await getPvPendingRequestsForUser(response.browserId);
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
                    await removePvPendingRequestsForUser(response.browserId);
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
        socket.emit("send_token", { token, expiresAt: Date.now() + 30 * 60 * 1000 });
    });

    // ─── PV (Private) chat request ───
    socket.on("pv_request", async (data: { fromBrowserId: string; toBrowserId: string; chatKey: string; senderName: string }) => {
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
            // Store pending request for when user comes online (with limit)
            const pendingCount = await getPvPendingRequestCount();
            if (pendingCount < MAX_PV_PENDING_REQUESTS) {
                const pendingRequest: PvRequest = {
                    fromBrowserId: data.fromBrowserId,
                    toBrowserId: data.toBrowserId,
                    chatKey: data.chatKey,
                    senderName: data.senderName,
                };
                try {
                    await addPvPendingRequest(pendingRequest);
                } catch {
                    // Ignore DB persistence failure for this transient request
                }
            }
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
        async (data: { chatId: string; messageId: number; text: string; browserId: string }) => {
            const { chatId, messageId, text, browserId } = data;
            // Enforce: the browserId must match the verified identity of this socket
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const msg = await getMessageById(chatId, messageId);
            if (!msg || msg.browserId !== browserId) return; // Only sender can edit
            msg.text = text;
            msg.edited = true;
            await upsertMessage(chatId, msg);
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
        async (data: { chatId: string; messageId: number; column: number; browserId: string }) => {
            const { chatId, messageId, column, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const msg = await getMessageById(chatId, messageId);
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
            await upsertMessage(chatId, msg);
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
        async (data: { chatId: string; messageId: number; fromRow: number; fromCol: number; toRow: number; toCol: number; promotion?: string; browserId: string }) => {
            const { chatId, messageId, fromRow, fromCol, toRow, toCol, promotion, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const msg = await getMessageById(chatId, messageId);
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
            await upsertMessage(chatId, msg);
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
        async (data: { chatId: string; messageId: number; position: number; browserId: string }) => {
            const { chatId, messageId, position, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const msg = await getMessageById(chatId, messageId);
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
            await upsertMessage(chatId, msg);
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
        async (data: { chatId: string; messageId: number; index: number; action: string; browserId: string }) => {
            const { chatId, messageId, index, action, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const msg = await getMessageById(chatId, messageId);
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
            await upsertMessage(chatId, msg);
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
        async (data: { chatId: string; messageId: number; row: number; col: number; browserId: string }) => {
            const { chatId, messageId, row, col, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const msg = await getMessageById(chatId, messageId);
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
            await upsertMessage(chatId, msg);
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
        async (data: { chatId: string; messageId: number; browserId: string }) => {
            const { chatId, messageId, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const msg = await getMessageById(chatId, messageId);
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
            await upsertMessage(chatId, msg);
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
        async (data: { chatId: string; messageId: number; from: number; to: number; browserId: string }) => {
            const { chatId, messageId, from, to, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const msg = await getMessageById(chatId, messageId);
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
            await upsertMessage(chatId, msg);
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
        async (data: { chatId: string; messageId: number; browserId: string }) => {
            const { chatId, messageId, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const msg = await getMessageById(chatId, messageId);
            if (!msg) return;

            const state = parseHokm2(msg.text);
            if (!state || state.phase !== 0) return;

            if (state.p2 === "?" && browserId !== state.p1) {
                state.p2 = browserId;
                const started = hokm2StartRound(state);
                msg.text = serializeHokm2(started);
                await upsertMessage(chatId, msg);
                io.to(`chat:${chatId}`).emit("message_edited", {
                    chatId, messageId, text: msg.text, edited: false,
                });
            }
        }
    );

    // ─── Hokm 2-Player: select trump ───
    socket.on(
        "hokm2_trump",
        async (data: { chatId: string; messageId: number; suit: number; browserId: string }) => {
            const { chatId, messageId, suit, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const msg = await getMessageById(chatId, messageId);
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
            await upsertMessage(chatId, msg);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId, messageId, text: msg.text, edited: false,
            });
        }
    );

    // ─── Hokm 2-Player: play card ───
    socket.on(
        "hokm2_play",
        async (data: { chatId: string; messageId: number; cardIndex: number; browserId: string }) => {
            const { chatId, messageId, cardIndex, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const msg = await getMessageById(chatId, messageId);
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
            await upsertMessage(chatId, msg);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId, messageId, text: msg.text, edited: false,
            });
        }
    );

    // ─── Hokm 2-Player: new round ───
    socket.on(
        "hokm2_newround",
        async (data: { chatId: string; messageId: number; browserId: string }) => {
            const { chatId, messageId, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const msg = await getMessageById(chatId, messageId);
            if (!msg) return;

            const state = parseHokm2(msg.text);
            if (!state) return;

            const newState = hokm2NewRound(state);
            if (!newState) return;

            msg.text = serializeHokm2(newState);
            await upsertMessage(chatId, msg);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId, messageId, text: msg.text, edited: false,
            });
        }
    );

    // ─── Hokm 2-Player: discard cards ───
    socket.on(
        "hokm2_discard",
        async (data: { chatId: string; messageId: number; cardIndices: number[]; browserId: string }) => {
            const { chatId, messageId, cardIndices, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const msg = await getMessageById(chatId, messageId);
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
            await upsertMessage(chatId, msg);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId, messageId, text: msg.text, edited: false,
            });
        }
    );

    // ─── Hokm 2-Player: draw card (accept/refuse) ───
    socket.on(
        "hokm2_draw",
        async (data: { chatId: string; messageId: number; accept: boolean; browserId: string }) => {
            const { chatId, messageId, accept, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const msg = await getMessageById(chatId, messageId);
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
            await upsertMessage(chatId, msg);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId, messageId, text: msg.text, edited: false,
            });
        }
    );

    // ─── Hokm 4-Player: join ───
    socket.on(
        "hokm4_join",
        async (data: { chatId: string; messageId: number; browserId: string }) => {
            const { chatId, messageId, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const msg = await getMessageById(chatId, messageId);
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
            await upsertMessage(chatId, msg);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId, messageId, text: msg.text, edited: false,
            });
        }
    );

    // ─── Hokm 4-Player: select trump ───
    socket.on(
        "hokm4_trump",
        async (data: { chatId: string; messageId: number; suit: number; browserId: string }) => {
            const { chatId, messageId, suit, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const msg = await getMessageById(chatId, messageId);
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
            await upsertMessage(chatId, msg);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId, messageId, text: msg.text, edited: false,
            });
        }
    );

    // ─── Hokm 4-Player: play card ───
    socket.on(
        "hokm4_play",
        async (data: { chatId: string; messageId: number; cardIndex: number; browserId: string }) => {
            const { chatId, messageId, cardIndex, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const msg = await getMessageById(chatId, messageId);
            if (!msg) return;

            const state = parseHokm4(msg.text);
            if (!state) return;

            const joined = hokm4JoinPlayer(state, browserId);
            if (!joined) return;
            const playerNum = joined.playerNum;

            const newState = hokm4PlayCard(joined.state, playerNum, cardIndex);
            if (!newState) return;

            msg.text = serializeHokm4(newState);
            await upsertMessage(chatId, msg);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId, messageId, text: msg.text, edited: false,
            });
        }
    );

    // ─── Hokm 4-Player: new round ───
    socket.on(
        "hokm4_newround",
        async (data: { chatId: string; messageId: number; browserId: string }) => {
            const { chatId, messageId, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const msg = await getMessageById(chatId, messageId);
            if (!msg) return;

            const state = parseHokm4(msg.text);
            if (!state) return;

            const newState = hokm4NewRound(state);
            if (!newState) return;

            msg.text = serializeHokm4(newState);
            await upsertMessage(chatId, msg);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId, messageId, text: msg.text, edited: false,
            });
        }
    );

    // ─── Chaar Barg: join (triggers round start) ───
    socket.on(
        "chaarbarg_join",
        async (data: { chatId: string; messageId: number; browserId: string }) => {
            const { chatId, messageId, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const msg = await getMessageById(chatId, messageId);
            if (!msg) return;

            const state = parseChaarBarg(msg.text);
            if (!state || state.phase !== 0) return;

            if (state.p2 === "?" && browserId !== state.p1) {
                state.p2 = browserId;
                const started = chaarBargStartRound(state);
                msg.text = serializeChaarBarg(started);
                await upsertMessage(chatId, msg);
                io.to(`chat:${chatId}`).emit("message_edited", {
                    chatId, messageId, text: msg.text, edited: false,
                });
            }
        }
    );

    // ─── Chaar Barg: play card ───
    socket.on(
        "chaarbarg_play",
        async (data: { chatId: string; messageId: number; cardIndex: number; captureChoice: number; browserId: string }) => {
            const { chatId, messageId, cardIndex, captureChoice, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const msg = await getMessageById(chatId, messageId);
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
            await upsertMessage(chatId, msg);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId, messageId, text: msg.text, edited: false,
            });
        }
    );

    // ─── Chaar Barg: new round ───
    socket.on(
        "chaarbarg_newround",
        async (data: { chatId: string; messageId: number; browserId: string }) => {
            const { chatId, messageId, browserId } = data;
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const msg = await getMessageById(chatId, messageId);
            if (!msg) return;

            const state = parseChaarBarg(msg.text);
            if (!state) return;

            const newState = chaarBargNewRound(state);
            if (!newState) return;

            msg.text = serializeChaarBarg(newState);
            await upsertMessage(chatId, msg);
            io.to(`chat:${chatId}`).emit("message_edited", {
                chatId, messageId, text: msg.text, edited: false,
            });
        }
    );

    // ─── Delete message (verified browserId enforced, sender only) ───
    socket.on(
        "delete_message",
        async (data: { chatId: string; messageId: number; browserId: string }) => {
            const { chatId, messageId, browserId } = data;
            // Enforce: the browserId must match the verified identity of this socket
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const msg = await getMessageById(chatId, messageId);
            if (!msg) return;
            if (msg.browserId !== browserId) return; // Only sender can delete

            // Remove the message and its file if it exists
            if (msg.file) {
                const resolvedPath = path.resolve(__dirname, msg.file.replace(/^\//, ""));
                // Ensure resolved path is within the files directory
                if (resolvedPath.startsWith(path.resolve(FILES_DIR)) && fs.existsSync(resolvedPath)) {
                    fs.promises.unlink(resolvedPath).catch(() => {});
                }
            }
            await deleteMessageById(chatId, messageId);

            io.to(`chat:${chatId}`).emit("message_deleted", {
                chatId,
                messageId,
            });
        }
    );

    // ─── React to message (verified browserId enforced) ───
    socket.on(
        "react_message",
        async (data: { chatId: string; messageId: number; emoji: string; browserId: string }) => {
            const { chatId, messageId, emoji, browserId } = data;
            // Enforce: the browserId must match the verified identity of this socket
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const msg = await getMessageById(chatId, messageId);
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
            await upsertMessage(chatId, msg);
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
        async (data: { chatId: string; messageIds: number[]; browserId: string }) => {
            const { chatId, messageIds, browserId } = data;
            // Enforce: the browserId must match the verified identity of this socket
            const verifiedId = getVerifiedBrowserId(socket.id);
            if (!verifiedId || verifiedId !== browserId) return;
            const messagesById = await getMessagesByIds(chatId, messageIds);
            const updatedMessages: ChatMessage[] = [];
            const updates: Array<{ messageId: number; seenBy: string[] }> = [];
            for (const msgId of messageIds) {
                const msg = messagesById.get(msgId);
                if (msg && msg.browserId !== browserId) {
                    if (!msg.seenBy) msg.seenBy = [];
                    if (!msg.seenBy.includes(browserId)) {
                        msg.seenBy.push(browserId);
                        updatedMessages.push(msg);
                        updates.push({ messageId: msgId, seenBy: msg.seenBy });
                    }
                }
            }
            if (updatedMessages.length > 0) {
                await upsertMessages(chatId, updatedMessages);
                io.to(`chat:${chatId}`).emit("message_seen_update", {
                    chatId,
                    updates,
                });
            }
        }
    );

    // ─── Voice chat signaling ───

    socket.on("voice_join", (data: { chatId: string; browserId: string; name: string }) => {
        const { chatId, browserId, name } = data;
        // Verify browserId matches the authenticated socket identity
        const verifiedId = getVerifiedBrowserId(socket.id);
        if (!verifiedId || verifiedId !== browserId) return;

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
        const verifiedBrowserId = socketBrowserIdMap[socket.id];
        if (verifiedBrowserId) {
            for (const [key, pending] of pendingMessageDeliveries.entries()) {
                const parsedKey = parseMessageDeliveryKey(key);
                if (parsedKey && parsedKey.browserId === verifiedBrowserId) {
                    clearTimeout(pending.timeoutId);
                    pendingMessageDeliveries.delete(key);
                }
            }
        }
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

app.get("/api/statistics", adminRouteRateLimiter, async (req, res) => {
    try {
        const expectedUsername = process.env.ADMIN_USERNAME || "";
        const expectedPassword = process.env.ADMIN_PASSWORD || "";
        if (!expectedUsername || !expectedPassword) {
            res.status(503).json({ error: "Admin credentials not configured" });
            return;
        }
        if (!isAdminAuthorized(req)) {
            res.status(403).json({ error: "Unauthorized" });
            return;
        }

        const onlineUsers = new Set(Object.values(socketBrowserIdMap)).size;
        const totalUsers = await getTotalKnownUsers();
        const totalMessages = globalMsgId;
        const totalActiveChats = await getChatCount();
        const notifications = await getActiveNotificationStats();

        res.json({
            onlineUsers,
            totalUsers,
            totalMessages,
            totalActiveChats,
            notifications,
        });
    } catch {
        res.status(500).json({ error: "Internal server error" });
    }
});

// ─── GET messages with pagination ───
app.get("/api/:chatId", async (req, res) => {
    try {
        const chatId = req.params.chatId;
        const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
        const offset = parseInt(req.query.offset as string) || 0;
        const page = await getMessagesPage(chatId, offset, limit);
        const start = Math.max(0, page.total - offset - limit);

        res.json({
            success: true,
            messages: page.messages,
            total: page.total,
            hasMore: start > 0,
        });
    } catch {
        res.status(500).json({ error: "Internal server error" });
    }
});

// ─── Batch fetch last messages for multiple chats ───
app.post("/api/chats/last-messages", async (req, res) => {
    try {
        const chatsInput = Array.isArray(req.body?.chats) ? req.body.chats : [];
        const sanitizedChats = chatsInput
            .filter((entry: unknown): entry is { chatId: string; lastOpenedAt?: string } => (
                typeof entry === "object"
                && entry !== null
                && typeof (entry as { chatId?: unknown }).chatId === "string"
                && (entry as { chatId: string }).chatId.trim().length > 0
            ))
            .slice(0, 500);

        const chats: { [chatId: string]: { message: ChatMessage | null; unreadSinceLastOpenedCount: number } } = {};
        for (const entry of sanitizedChats) {
            const chatId = entry.chatId;
            const message = await getLatestMessage(chatId);
            const unreadSinceLastOpenedCount = await countMessagesSince(
                chatId,
                typeof entry.lastOpenedAt === "string" ? entry.lastOpenedAt : undefined
            );
            chats[chatId] = {
                message,
                unreadSinceLastOpenedCount,
            };
        }

        res.json({ success: true, chats });
    } catch {
        res.status(500).json({ error: "Internal server error" });
    }
});

// ─── Validate send token without consuming ───
app.post("/api/validate-sendtoken", async (req, res) => {
    try {
        const browserId = typeof req.body?.browserId === "string" ? req.body.browserId : "";
        const token = typeof req.body?.token === "string" ? req.body.token : "";
        if (!browserId || !token) {
            res.status(400).json({ valid: false });
            return;
        }
        const valid = await validateSendTokenWithFallback(browserId, token);
        res.json({ valid });
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

            // Validate send token for authentication (mandatory)
            const sendToken = req.body.sendToken;
            if (!sendToken || !(await validateSendTokenWithFallback(req.body.browserId, sendToken))) {
                res.status(403).json({ error: "Invalid or expired send token" });
                return;
            }

            const chatId = req.params.chatId;
            // Enforce message text length limit
            if (req.body.text && req.body.text.length > MAX_MESSAGE_TEXT_LENGTH) {
                res.status(400).json({ error: "Message text too long" });
                return;
            }

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

            await upsertMessage(chatId, msg);

            // Broadcast via WebSocket (include chatId so clients know which chat)
            io.to(`chat:${chatId}`).emit("new_message", { ...msg, chatId });
            const onlineBrowserIds = new Set(getSubscribedVerifiedBrowserIds(chatId));
            onlineBrowserIds.forEach((browserId) => {
                scheduleMessageDeliveryRetry(chatId, msg.id, browserId);
            });

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
            void notifyTelegramBots(chatId, msg, onlineBrowserIds);
        } catch {
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

// ─── POST file message (encrypted files) ───
app.post("/api/:chatId/upload", fileRateLimiter, upload.single("file"), async (req, res) => {
    try {
        const chatId = req.params.chatId as string;
        if (!req.file) {
            res.status(400).json({ error: "No file uploaded" });
            return;
        }

        const browserId = req.body.browserId;
        if (!browserId) {
            // Clean up uploaded file since we're rejecting the request
            if (req.file) fs.promises.unlink(req.file.path).catch(() => {});
            res.status(400).json({ error: "browserId is required" });
            return;
        }

        // Validate send token for authentication (mandatory)
        const sendToken = req.body.sendToken;
        if (!sendToken || !(await validateSendTokenWithFallback(browserId, sendToken))) {
            // Clean up uploaded file since we're rejecting the request
            if (req.file) fs.promises.unlink(req.file.path).catch(() => {});
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
        const parsedFileSize = Number(req.body.fileSize);
        const fileSize = Number.isFinite(parsedFileSize) && parsedFileSize > 0
            ? Math.floor(parsedFileSize)
            : req.file.size;
        const parsedMediaDurationSec = Number(req.body.mediaDurationSec);
        const mediaDurationSec = Number.isFinite(parsedMediaDurationSec) && parsedMediaDurationSec >= 0
            ? parsedMediaDurationSec
            : undefined;

        const msg: ChatMessage = {
            id: ++globalMsgId,
            text,
            name: displayName,
            browserId,
            createdAt: new Date(),
            file: "/files/" + req.file.filename,
            fileType,
            originalName,
            fileSize,
            mediaDurationSec,
            replyToId,
        };

        await upsertMessage(chatId, msg);

        io.to(`chat:${chatId}`).emit("new_message", { ...msg, chatId });
        const onlineBrowserIds = new Set(getSubscribedVerifiedBrowserIds(chatId));
        onlineBrowserIds.forEach((browserId) => {
            scheduleMessageDeliveryRetry(chatId, msg.id, browserId);
        });

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
        void notifyTelegramBots(chatId, msg, onlineBrowserIds);
    } catch {
        res.status(500).json({ error: "Internal server error" });
    }
});

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

async function startServer() {
    await initMysql();
    await bootstrapRuntimeStateFromMysql();
    setInterval(() => {
        void Promise.allSettled([
            cleanupExpiredNotifications(),
            cleanupExpiredInvitesInDb(),
            cleanupExpiredSendTokensInDb(),
            deleteExpiredSubscriptionsInDb(),
        ]).then((results) => {
            const failures = results
                .filter((result): result is PromiseRejectedResult => result.status === "rejected")
                .map((result) => String(result.reason));
            if (failures.length > 0) {
                console.error("Failed cleaning up expired data:", failures);
            }
        });
    }, NOTIFICATION_CLEANUP_INTERVAL_MS).unref();
    server.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
    });
}

startServer().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
});
