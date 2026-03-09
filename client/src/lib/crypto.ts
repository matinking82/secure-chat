// ─── AES-256-GCM encryption using Web Crypto API ───

const ITERATIONS = 100000;
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

async function deriveKey(
    password: string,
    salt: string
): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        "PBKDF2",
        false,
        ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: encoder.encode(salt),
            iterations: ITERATIONS,
            hash: "SHA-256",
        },
        keyMaterial,
        { name: "AES-GCM", length: KEY_LENGTH },
        false,
        ["encrypt", "decrypt"]
    );
}

// ─── Text encryption ───

export async function encryptText(
    plaintext: string,
    password: string,
    chatId: string
): Promise<string> {
    if (!password) return plaintext;
    const key = await deriveKey(password, chatId);
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encoder = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encoder.encode(plaintext)
    );
    const ivB64 = uint8ToBase64(iv);
    const ctB64 = uint8ToBase64(new Uint8Array(ciphertext));
    return `ENC::${ivB64}.${ctB64}`;
}

export async function decryptText(
    encrypted: string,
    password: string,
    chatId: string
): Promise<{ text: string; encrypted: boolean; failed: boolean }> {
    if (!encrypted.startsWith("ENC::")) {
        return { text: encrypted, encrypted: false, failed: false };
    }
    if (!password) {
        return { text: "[no encryption key set]", encrypted: true, failed: true };
    }
    try {
        const payload = encrypted.slice(5);
        const dotIdx = payload.indexOf(".");
        const ivB64 = payload.slice(0, dotIdx);
        const ctB64 = payload.slice(dotIdx + 1);
        const iv = base64ToUint8(ivB64);
        const ciphertext = base64ToUint8(ctB64);
        const key = await deriveKey(password, chatId);
        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            key,
            ciphertext
        );
        const decoder = new TextDecoder();
        return { text: decoder.decode(decrypted), encrypted: true, failed: false };
    } catch {
        return { text: "[key mismatch — cannot decrypt]", encrypted: true, failed: true };
    }
}

// ─── File encryption ───

export async function encryptFile(
    data: ArrayBuffer,
    password: string,
    chatId: string
): Promise<ArrayBuffer> {
    if (!password) return data;
    const key = await deriveKey(password, chatId);
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        data
    );
    // Prepend IV (12 bytes) to ciphertext
    const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return combined.buffer;
}

export async function decryptFile(
    data: ArrayBuffer,
    password: string,
    chatId: string
): Promise<ArrayBuffer | null> {
    if (!password) return data;
    try {
        const combined = new Uint8Array(data);
        const iv = combined.slice(0, IV_LENGTH);
        const ciphertext = combined.slice(IV_LENGTH);
        const key = await deriveKey(password, chatId);
        return await crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            key,
            ciphertext
        );
    } catch {
        return null;
    }
}

// ─── Base64 helpers ───

function uint8ToBase64(arr: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < arr.length; i++) {
        binary += String.fromCharCode(arr[i]);
    }
    return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
    const binary = atob(b64);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        arr[i] = binary.charCodeAt(i);
    }
    return arr;
}
