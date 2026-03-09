import { getBrowserId } from "../../lib/storage";
import { useChat } from "../../contexts/ChatContext";

// ─── Constants ───
const SIZE = 8;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;

// ─── Game state helpers ───

export interface OthelloState {
    p1: string;
    p2: string;
    board: number[][];
    turn: number;
    winner: number;
}

/** Create a fresh Othello game state string */
export function createOthello(initiatorBrowserId: string): string {
    const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    // Standard starting position
    board[3][3] = WHITE;
    board[3][4] = BLACK;
    board[4][3] = BLACK;
    board[4][4] = WHITE;
    const boardStr = board.flat().join("");
    return `GAME::OTHELLO::${initiatorBrowserId}:?:${boardStr}:1:0`;
}

/** Check if a decrypted message text is an Othello game */
export function isOthelloMessage(text: string): boolean {
    return text.startsWith("GAME::OTHELLO::");
}

/** Parse game state from message text */
export function parseOthello(text: string): OthelloState | null {
    if (!isOthelloMessage(text)) return null;
    const parts = text.slice("GAME::OTHELLO::".length).split(":");
    if (parts.length < 5) return null;
    const boardStr = parts[2];
    if (boardStr.length !== 64) return null;

    const board: number[][] = [];
    for (let r = 0; r < SIZE; r++) {
        const row: number[] = [];
        for (let c = 0; c < SIZE; c++) {
            row.push(parseInt(boardStr[r * SIZE + c]) || 0);
        }
        board.push(row);
    }

    return {
        p1: parts[0],
        p2: parts[1],
        board,
        turn: parseInt(parts[3]) || 1,
        winner: parseInt(parts[4]) || 0,
    };
}

// ─── Valid move calculation (client-side for highlighting) ───

const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

function getValidMoves(board: number[][], player: number): [number, number][] {
    const opponent = player === BLACK ? WHITE : BLACK;
    const moves: [number, number][] = [];

    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (board[r][c] !== EMPTY) continue;
            let valid = false;
            for (const [dr, dc] of DIRS) {
                let nr = r + dr, nc = c + dc;
                let hasOpponent = false;
                while (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc] === opponent) {
                    hasOpponent = true;
                    nr += dr;
                    nc += dc;
                }
                if (hasOpponent && nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc] === player) {
                    valid = true;
                    break;
                }
            }
            if (valid) moves.push([r, c]);
        }
    }
    return moves;
}

// ─── Component ───

interface OthelloGameProps {
    gameState: OthelloState;
    messageId: number;
    chatId: string;
}

function PieceIcon({ value, size = 24 }: { value: number; size?: number }) {
    if (value === BLACK) {
        return (
            <svg width={size} height={size} viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" fill="#1a1a2e" stroke="#333" strokeWidth="1" />
                <circle cx="10" cy="10" r="4" fill="rgba(255,255,255,0.1)" />
            </svg>
        );
    }
    if (value === WHITE) {
        return (
            <svg width={size} height={size} viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" fill="#e8e8e8" stroke="#ccc" strokeWidth="1" />
                <circle cx="10" cy="10" r="4" fill="rgba(255,255,255,0.4)" />
            </svg>
        );
    }
    return null;
}

export default function OthelloGame({ gameState, messageId, chatId }: OthelloGameProps) {
    const myBrowserId = getBrowserId();
    const { socket } = useChat();

    const myPlayerNum = (() => {
        if (myBrowserId === gameState.p1) return BLACK;
        if (myBrowserId === gameState.p2) return WHITE;
        if (gameState.p2 === "?" && myBrowserId !== gameState.p1) return WHITE;
        return 0;
    })();

    const isMyTurn = gameState.winner === 0 && gameState.turn === myPlayerNum;
    const gameOver = gameState.winner !== 0;

    const validMoves = isMyTurn ? getValidMoves(gameState.board, myPlayerNum) : [];
    const validMoveSet = new Set(validMoves.map(([r, c]) => `${r},${c}`));

    const handleCellClick = (row: number, col: number) => {
        if (!isMyTurn || gameOver) return;
        if (!validMoveSet.has(`${row},${col}`)) return;
        socket?.emit("othello_move", {
            chatId,
            messageId,
            row,
            col,
            browserId: myBrowserId,
        });
    };

    // Count pieces
    let blackCount = 0, whiteCount = 0;
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (gameState.board[r][c] === BLACK) blackCount++;
            else if (gameState.board[r][c] === WHITE) whiteCount++;
        }
    }

    let statusText: string;
    let statusColor = "text-gray-400";
    if (gameState.winner === 3) {
        statusText = "🤝 Draw!";
        statusColor = "text-yellow-400";
    } else if (gameState.winner === BLACK) {
        statusText = gameState.p1 === myBrowserId ? "🏆 You won!" : "⚫ Black wins!";
        statusColor = gameState.p1 === myBrowserId ? "text-yellow-400" : "text-gray-300";
    } else if (gameState.winner === WHITE) {
        statusText = gameState.p2 === myBrowserId ? "🏆 You won!" : "⚪ White wins!";
        statusColor = gameState.p2 === myBrowserId ? "text-yellow-400" : "text-gray-300";
    } else if (gameState.p2 === "?") {
        statusText = gameState.p1 === myBrowserId
            ? "⏳ Waiting for opponent..."
            : "🎮 Tap to join!";
    } else if (isMyTurn) {
        statusText = `Your turn ${myPlayerNum === BLACK ? "⚫" : "⚪"} (${validMoves.length} moves)`;
        statusColor = "text-white";
    } else {
        statusText = `${gameState.turn === BLACK ? "⚫" : "⚪"} Opponent's turn`;
    }

    return (
        <div className="select-none">
            <div className="text-center mb-2">
                <div className="text-xs font-semibold tracking-wider uppercase text-gray-500 mb-0.5">
                    🎮 Othello
                </div>
                <div className="flex items-center justify-center gap-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                        <PieceIcon value={BLACK} size={14} />
                        {gameState.p1 === myBrowserId ? "You" : "P1"} ({blackCount})
                    </span>
                    <span className="text-gray-600">vs</span>
                    <span className="flex items-center gap-1">
                        <PieceIcon value={WHITE} size={14} />
                        {gameState.p2 === "?" ? "???" : gameState.p2 === myBrowserId ? "You" : "P2"} ({whiteCount})
                    </span>
                </div>
            </div>

            <div
                className="inline-grid gap-[1px] rounded-xl p-1.5"
                style={{
                    gridTemplateColumns: `repeat(${SIZE}, 1fr)`,
                    background: "linear-gradient(135deg, rgba(0,80,40,0.5), rgba(0,60,30,0.6))",
                    border: "1px solid rgba(255,255,255,0.06)",
                }}
            >
                {gameState.board.map((row, r) =>
                    row.map((cell, c) => {
                        const isValidMove = validMoveSet.has(`${r},${c}`);
                        return (
                            <div
                                key={`${r}-${c}`}
                                onClick={() => handleCellClick(r, c)}
                                className={`w-8 h-8 flex items-center justify-center rounded-sm transition-all duration-100
                                    ${isValidMove
                                        ? "bg-green-800/50 hover:bg-green-700/60 cursor-pointer"
                                        : "bg-green-900/30"
                                    }`}
                                style={{ border: "1px solid rgba(255,255,255,0.05)" }}
                            >
                                {cell !== EMPTY ? (
                                    <PieceIcon value={cell} />
                                ) : isValidMove ? (
                                    <div className="w-3 h-3 rounded-full bg-white/20" />
                                ) : null}
                            </div>
                        );
                    })
                )}
            </div>

            <div className={`text-center text-xs mt-2 font-medium ${statusColor}`}>
                {statusText}
            </div>
        </div>
    );
}
