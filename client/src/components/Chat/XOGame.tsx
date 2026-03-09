import { getBrowserId } from "../../lib/storage";
import { useChat } from "../../contexts/ChatContext";

// ─── Game state helpers ───

export interface XOState {
    p1: string;
    p2: string;
    board: number[];
    turn: number;
    winner: number;
}

/** Create a fresh XO game state string */
export function createXO(initiatorBrowserId: string): string {
    return `GAME::XO::${initiatorBrowserId}:?:000000000:1:0`;
}

/** Check if a decrypted message text is an XO game */
export function isXOMessage(text: string): boolean {
    return text.startsWith("GAME::XO::");
}

/** Parse game state from message text */
export function parseXO(text: string): XOState | null {
    if (!isXOMessage(text)) return null;
    const parts = text.slice("GAME::XO::".length).split(":");
    if (parts.length < 5) return null;
    const boardStr = parts[2];
    if (boardStr.length !== 9) return null;
    const board = boardStr.split("").map(c => parseInt(c) || 0);
    return {
        p1: parts[0],
        p2: parts[1],
        board,
        turn: parseInt(parts[3]) || 1,
        winner: parseInt(parts[4]) || 0,
    };
}

// ─── Component ───

interface XOGameProps {
    gameState: XOState;
    messageId: number;
    chatId: string;
}

function CellContent({ value }: { value: number }) {
    if (value === 1) {
        return (
            <svg width="28" height="28" viewBox="0 0 28 28">
                <line x1="6" y1="6" x2="22" y2="22" stroke="#4ea4f6" strokeWidth="3" strokeLinecap="round" />
                <line x1="22" y1="6" x2="6" y2="22" stroke="#4ea4f6" strokeWidth="3" strokeLinecap="round" />
            </svg>
        );
    }
    if (value === 2) {
        return (
            <svg width="28" height="28" viewBox="0 0 28 28">
                <circle cx="14" cy="14" r="9" fill="none" stroke="#ef4444" strokeWidth="3" />
            </svg>
        );
    }
    return null;
}

export default function XOGame({ gameState, messageId, chatId }: XOGameProps) {
    const myBrowserId = getBrowserId();
    const { socket } = useChat();

    const myPlayerNum = (() => {
        if (myBrowserId === gameState.p1) return 1;
        if (myBrowserId === gameState.p2) return 2;
        if (gameState.p2 === "?" && myBrowserId !== gameState.p1) return 2;
        return 0;
    })();

    const isMyTurn = gameState.winner === 0 && gameState.turn === myPlayerNum;
    const gameOver = gameState.winner !== 0;

    const handleCellClick = (pos: number) => {
        if (!isMyTurn || gameOver || gameState.board[pos] !== 0) return;
        socket?.emit("xo_move", {
            chatId,
            messageId,
            position: pos,
            browserId: myBrowserId,
        });
    };

    let statusText: string;
    let statusColor = "text-gray-400";
    if (gameState.winner === 3) {
        statusText = "🤝 Draw!";
        statusColor = "text-yellow-400";
    } else if (gameState.winner === 1) {
        statusText = gameState.p1 === myBrowserId ? "🏆 You won!" : "✕ X wins!";
        statusColor = gameState.p1 === myBrowserId ? "text-yellow-400" : "text-blue-400";
    } else if (gameState.winner === 2) {
        statusText = gameState.p2 === myBrowserId ? "🏆 You won!" : "⭕ O wins!";
        statusColor = gameState.p2 === myBrowserId ? "text-yellow-400" : "text-red-400";
    } else if (gameState.p2 === "?") {
        statusText = gameState.p1 === myBrowserId
            ? "⏳ Waiting for opponent..."
            : "🎮 Tap to join!";
    } else if (isMyTurn) {
        statusText = `Your turn ${myPlayerNum === 1 ? "✕" : "⭕"}`;
        statusColor = "text-white";
    } else {
        statusText = `${gameState.turn === 1 ? "✕" : "⭕"} Opponent's turn`;
    }

    return (
        <div className="select-none">
            <div className="text-center mb-2">
                <div className="text-xs font-semibold tracking-wider uppercase text-gray-500 mb-0.5">
                    🎮 Tic-Tac-Toe
                </div>
                <div className="flex items-center justify-center gap-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                        <span className="text-[#4ea4f6] font-bold">✕</span>
                        {gameState.p1 === myBrowserId ? "You" : "P1"}
                    </span>
                    <span className="text-gray-600">vs</span>
                    <span className="flex items-center gap-1">
                        <span className="text-red-400 font-bold">⭕</span>
                        {gameState.p2 === "?" ? "???" : gameState.p2 === myBrowserId ? "You" : "P2"}
                    </span>
                </div>
            </div>

            <div
                className="inline-grid gap-[2px] rounded-xl p-2"
                style={{
                    gridTemplateColumns: "repeat(3, 1fr)",
                    background: "linear-gradient(135deg, rgba(30,60,120,0.35), rgba(15,30,60,0.45))",
                    border: "1px solid rgba(255,255,255,0.06)",
                }}
            >
                {gameState.board.map((cell, i) => (
                    <div
                        key={i}
                        onClick={() => handleCellClick(i)}
                        className={`w-12 h-12 flex items-center justify-center rounded-lg transition-all duration-150
                            ${cell === 0 && isMyTurn
                                ? "bg-white/[0.04] hover:bg-white/[0.12] cursor-pointer"
                                : "bg-white/[0.02]"
                            }`}
                        style={{ border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                        <CellContent value={cell} />
                    </div>
                ))}
            </div>

            <div className={`text-center text-xs mt-2 font-medium ${statusColor}`}>
                {statusText}
            </div>
        </div>
    );
}
