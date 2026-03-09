import { getBrowserId } from "../../lib/storage";
import { useChat } from "../../contexts/ChatContext";

// ─── Game state helpers ───

export interface MinesweeperState {
    creator: string;
    rows: number;
    cols: number;
    mineCount: number;
    revealed: Set<number>;
    flagged: Set<number>;
    mines: Set<number>;
    status: number; // 0=playing, 1=won, 2=lost
}

/** Create a fresh Minesweeper game state string */
export function createMinesweeper(creatorBrowserId: string, rows = 8, cols = 8, mines = 10): string {
    return `GAME::MINESWEEPER::${creatorBrowserId}:${rows}:${cols}:${mines}::::0`;
}

/** Check if a decrypted message text is a Minesweeper game */
export function isMinesweeperMessage(text: string): boolean {
    return text.startsWith("GAME::MINESWEEPER::");
}

/** Parse game state from message text */
export function parseMinesweeper(text: string): MinesweeperState | null {
    if (!isMinesweeperMessage(text)) return null;
    const parts = text.slice("GAME::MINESWEEPER::".length).split(":");
    if (parts.length < 8) return null;

    return {
        creator: parts[0],
        rows: parseInt(parts[1]) || 8,
        cols: parseInt(parts[2]) || 8,
        mineCount: parseInt(parts[3]) || 10,
        revealed: new Set(parts[4] ? parts[4].split(",").filter(s => s).map(Number) : []),
        flagged: new Set(parts[5] ? parts[5].split(",").filter(s => s).map(Number) : []),
        mines: new Set(parts[6] ? parts[6].split(",").filter(s => s).map(Number) : []),
        status: parseInt(parts[7]) || 0,
    };
}

function countAdjacent(idx: number, mines: Set<number>, rows: number, cols: number): number {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    let count = 0;
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
                if (mines.has(nr * cols + nc)) count++;
            }
        }
    }
    return count;
}

// ─── Component ───

interface MinesweeperGameProps {
    gameState: MinesweeperState;
    messageId: number;
    chatId: string;
}

export default function MinesweeperGame({ gameState, messageId, chatId }: MinesweeperGameProps) {
    const myBrowserId = getBrowserId();
    const { socket } = useChat();
    const { rows, cols, revealed, flagged, mines, status } = gameState;

    const handleReveal = (idx: number) => {
        if (status !== 0 || revealed.has(idx) || flagged.has(idx)) return;
        socket?.emit("minesweeper_move", {
            chatId,
            messageId,
            index: idx,
            action: "reveal",
            browserId: myBrowserId,
        });
    };

    const handleFlag = (e: React.MouseEvent, idx: number) => {
        e.preventDefault();
        if (status !== 0 || revealed.has(idx)) return;
        socket?.emit("minesweeper_move", {
            chatId,
            messageId,
            index: idx,
            action: "flag",
            browserId: myBrowserId,
        });
    };

    const getCellContent = (idx: number): string => {
        if (flagged.has(idx) && !revealed.has(idx)) return "🚩";
        if (!revealed.has(idx)) return "";
        if (mines.has(idx)) return "💥";
        const adj = countAdjacent(idx, mines, rows, cols);
        return adj > 0 ? String(adj) : "";
    };

    const getNumberColor = (num: string): string => {
        const colors: Record<string, string> = {
            "1": "text-blue-400",
            "2": "text-green-400",
            "3": "text-red-400",
            "4": "text-purple-400",
            "5": "text-orange-400",
            "6": "text-cyan-400",
            "7": "text-pink-400",
            "8": "text-gray-300",
        };
        return colors[num] || "text-white";
    };

    let statusText: string;
    let statusColor = "text-gray-400";
    if (status === 1) {
        statusText = "🎉 All mines cleared!";
        statusColor = "text-green-400";
    } else if (status === 2) {
        statusText = "💥 Game Over!";
        statusColor = "text-red-400";
    } else {
        const remaining = gameState.mineCount - flagged.size;
        statusText = `💣 ${remaining} mines remaining • Right-click to flag`;
    }

    return (
        <div className="select-none">
            <div className="text-center mb-2">
                <div className="text-xs font-semibold tracking-wider uppercase text-gray-500 mb-0.5">
                    💣 Minesweeper
                </div>
                <div className="text-xs text-gray-400">
                    {rows}×{cols} • {gameState.mineCount} mines • Anyone can play!
                </div>
            </div>

            <div
                className="inline-grid gap-[1px] rounded-xl p-1.5"
                style={{
                    gridTemplateColumns: `repeat(${cols}, 1fr)`,
                    background: "linear-gradient(135deg, rgba(30,60,120,0.35), rgba(15,30,60,0.45))",
                    border: "1px solid rgba(255,255,255,0.06)",
                }}
            >
                {Array.from({ length: rows * cols }, (_, idx) => {
                    const content = getCellContent(idx);
                    const isRevealed = revealed.has(idx);
                    const isMine = mines.has(idx) && isRevealed;
                    return (
                        <div
                            key={idx}
                            onClick={() => handleReveal(idx)}
                            onContextMenu={(e) => handleFlag(e, idx)}
                            className={`w-7 h-7 flex items-center justify-center text-xs font-bold rounded transition-all duration-100
                                ${isMine
                                    ? "bg-red-900/40"
                                    : isRevealed
                                        ? "bg-white/[0.03]"
                                        : status === 0
                                            ? "bg-white/[0.08] hover:bg-white/[0.16] cursor-pointer active:scale-95"
                                            : "bg-white/[0.08]"
                                }`}
                            style={{ border: "1px solid rgba(255,255,255,0.06)" }}
                        >
                            <span className={content.length === 1 && !isNaN(parseInt(content)) ? getNumberColor(content) : ""}>
                                {content}
                            </span>
                        </div>
                    );
                })}
            </div>

            <div className={`text-center text-xs mt-2 font-medium ${statusColor}`}>
                {statusText}
            </div>
        </div>
    );
}
