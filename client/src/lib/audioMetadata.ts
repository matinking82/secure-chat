export interface ParsedAudioMetadata {
    title?: string;
    artist?: string;
    album?: string;
    coverArtUrl?: string;
}

interface ReadAudioMetadataOptions {
    includeCoverArt?: boolean;
}

function readSynchsafeInt(bytes: Uint8Array, offset: number): number {
    return (
        ((bytes[offset] & 0x7f) << 21) |
        ((bytes[offset + 1] & 0x7f) << 14) |
        ((bytes[offset + 2] & 0x7f) << 7) |
        (bytes[offset + 3] & 0x7f)
    );
}

function decodeText(data: Uint8Array): string {
    if (!data.length) return "";
    const enc = data[0];
    const payload = data.slice(1);
    if (enc === 0) return new TextDecoder("latin1").decode(payload).replace(/\0/g, "").trim();
    if (enc === 1 || enc === 2) {
        if (payload.length >= 2) {
            if (payload[0] === 0xff && payload[1] === 0xfe) {
                return new TextDecoder("utf-16le").decode(payload.slice(2)).replace(/\0/g, "").trim();
            }
            if (payload[0] === 0xfe && payload[1] === 0xff) {
                const swapped = new Uint8Array(payload.length - 2);
                for (let i = 2; i < payload.length; i += 2) {
                    if (i + 1 < payload.length) {
                        swapped[i - 2] = payload[i + 1];
                        swapped[i - 1] = payload[i];
                    }
                }
                return new TextDecoder("utf-16le").decode(swapped).replace(/\0/g, "").trim();
            }
        }
        return new TextDecoder("utf-16le").decode(payload).replace(/\0/g, "").trim();
    }
    return new TextDecoder("utf-8").decode(payload).replace(/\0/g, "").trim();
}

function indexOfNullByte(bytes: Uint8Array, from: number): number {
    for (let i = from; i < bytes.length; i++) {
        if (bytes[i] === 0) return i;
    }
    return -1;
}

function extractApicImage(frame: Uint8Array): string | undefined {
    if (frame.length < 4) return undefined;
    const textEncoding = frame[0];
    let offset = 1;
    const mimeEnd = indexOfNullByte(frame, offset);
    if (mimeEnd <= offset) return undefined;
    const mime = new TextDecoder("latin1").decode(frame.slice(offset, mimeEnd)).trim();
    if (!mime) return undefined;
    offset = mimeEnd + 1;
    if (offset >= frame.length) return undefined;
    offset += 1; // picture type
    if (offset >= frame.length) return undefined;

    if (textEncoding === 1 || textEncoding === 2) {
        while (offset + 1 < frame.length) {
            if (frame[offset] === 0 && frame[offset + 1] === 0) {
                offset += 2;
                break;
            }
            offset += 2;
        }
    } else {
        const descEnd = indexOfNullByte(frame, offset);
        offset = descEnd >= 0 ? descEnd + 1 : frame.length;
    }

    if (offset >= frame.length) return undefined;
    const imageBytes = frame.slice(offset);
    if (!imageBytes.length) return undefined;

    return URL.createObjectURL(new Blob([imageBytes], { type: mime }));
}

/**
 * Reads ID3 metadata from an audio source.
 * If coverArtUrl is returned, callers must revoke it with URL.revokeObjectURL when no longer needed.
 */
export async function readAudioMetadata(src: string, options?: ReadAudioMetadataOptions): Promise<ParsedAudioMetadata | null> {
    const includeCoverArt = options?.includeCoverArt ?? true;
    try {
        const res = await fetch(src);
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        if (bytes.length < 10) return null;
        if (String.fromCharCode(bytes[0], bytes[1], bytes[2]) !== "ID3") return null;

        const size = readSynchsafeInt(bytes, 6);
        let offset = 10;
        const end = Math.min(bytes.length, 10 + size);
        const out: ParsedAudioMetadata = {};

        while (offset + 10 <= end) {
            const id = String.fromCharCode(
                bytes[offset],
                bytes[offset + 1],
                bytes[offset + 2],
                bytes[offset + 3]
            );
            const frameSize =
                (bytes[offset + 4] << 24) |
                (bytes[offset + 5] << 16) |
                (bytes[offset + 6] << 8) |
                bytes[offset + 7];
            if (!id.trim() || frameSize <= 0 || offset + 10 + frameSize > end) break;
            if (id === "TIT2") out.title = decodeText(bytes.slice(offset + 10, offset + 10 + frameSize));
            if (id === "TPE1") out.artist = decodeText(bytes.slice(offset + 10, offset + 10 + frameSize));
            if (id === "TALB") out.album = decodeText(bytes.slice(offset + 10, offset + 10 + frameSize));
            if (includeCoverArt && id === "APIC" && !out.coverArtUrl) {
                out.coverArtUrl = extractApicImage(bytes.slice(offset + 10, offset + 10 + frameSize));
            }
            if (out.title && out.artist && out.album && (!includeCoverArt || out.coverArtUrl)) break;
            offset += 10 + frameSize;
        }

        if (!out.title && !out.artist && !out.album && !out.coverArtUrl) return null;
        return out;
    } catch {
        return null;
    }
}
