import { getBrowserId } from "../../lib/storage";
import { useChat } from "../../contexts/ChatContext";

// ─── Constants ───
const ROWS = 6;
const COLS = 7;
const EMPTY = 0;
const P1 = 1;
const P2 = 2;

// ─── Game state helpers ───

export interface Connect4State {
    p1: string; // browserId of player 1 (🔵)
    p2: string; // browserId of player 2 (🔴), "?" if open
    board: number[][]; // ROWS x COLS, 0 = empty, 1 = P1, 2 = P2
    turn: number; // 1 or 2
    winner: number; // 0 = none, 1 = P1, 2 = P2, 3 = draw
}

/** Create a fresh game state string (unencrypted) */
export function createConnect4(initiatorBrowserId: string): string {
    const board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    const boardStr = board.flat().map(String).join("");
    return `GAME::CONNECT4::${initiatorBrowserId}:?:${boardStr}:1:0`;
}

/** Check if a decrypted message text is a Connect 4 game */
export function isConnect4Message(text: string): boolean {
    return text.startsWith("GAME::CONNECT4::");
}

/** Parse game state from message text */
export function parseConnect4(text: string): Connect4State | null {
    if (!isConnect4Message(text)) return null;
    const parts = text.slice("GAME::CONNECT4::".length).split(":");
    if (parts.length < 5) return null;

    const p1 = parts[0];
    const p2 = parts[1];
    const boardStr = parts[2];
    const turn = parseInt(parts[3]) || 1;
    const winner = parseInt(parts[4]) || 0;

    if (boardStr.length !== ROWS * COLS) return null;

    const board: number[][] = [];
    for (let r = 0; r < ROWS; r++) {
        const row: number[] = [];
        for (let c = 0; c < COLS; c++) {
            row.push(parseInt(boardStr[r * COLS + c]) || 0);
        }
        board.push(row);
    }

    return { p1, p2, board, turn, winner };
}

/** Serialize game state back to message format */
export function serializeConnect4(state: Connect4State): string {
    const boardStr = state.board.flat().map(String).join("");
    return `GAME::CONNECT4::${state.p1}:${state.p2}:${boardStr}:${state.turn}:${state.winner}`;
}

/** Drop a piece into a column. Returns new state or null if invalid. */
export function dropPiece(state: Connect4State, col: number, playerNum: number): Connect4State | null {
    if (col < 0 || col >= COLS) return null;
    if (state.winner !== 0) return null;
    if (state.turn !== playerNum) return null;

    let targetRow = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
        if (state.board[r][col] === EMPTY) {
            targetRow = r;
            break;
        }
    }
    if (targetRow === -1) return null; // column full

    const newBoard = state.board.map((row) => [...row]);
    newBoard[targetRow][col] = playerNum;

    const winner = checkWinner(newBoard, targetRow, col, playerNum);
    const isDraw = !winner && newBoard.every((row) => row.every((cell) => cell !== EMPTY));

    return {
        ...state,
        board: newBoard,
        turn: playerNum === P1 ? P2 : P1,
        winner: winner ? playerNum : isDraw ? 3 : 0,
    };
}

/** Check if the last move at (row, col) creates a 4-in-a-row */
function checkWinner(board: number[][], row: number, col: number, player: number): boolean {
    const directions = [
        [0, 1],  // horizontal
        [1, 0],  // vertical
        [1, 1],  // diagonal ↘
        [1, -1], // diagonal ↗
    ];

    for (const [dr, dc] of directions) {
        let count = 1;
        for (let i = 1; i < 4; i++) {
            const r = row + dr * i;
            const c = col + dc * i;
            if (r < 0 || r >= ROWS || c < 0 || c >= COLS || board[r][c] !== player) break;
            count++;
        }
        for (let i = 1; i < 4; i++) {
            const r = row - dr * i;
            const c = col - dc * i;
            if (r < 0 || r >= ROWS || c < 0 || c >= COLS || board[r][c] !== player) break;
            count++;
        }
        if (count >= 4) return true;
    }
    return false;
}

// ─── Cell rendering ───

function CellIcon({ value, size = 26 }: { value: number; size?: number }) {
    if (value === P1) {
        return (
            <svg width={size} height={size} viewBox="0 0 26 26">
                <circle cx="13" cy="13" r="11" fill="#3b82f6" />
                <circle cx="13" cy="13" r="7" fill="#60a5fa" fillOpacity="0.5" />
            </svg>
        );
    }
    if (value === P2) {
        return (
            <svg width={size} height={size} viewBox="0 0 26 26">
                <circle cx="13" cy="13" r="11" fill="#ef4444" />
                <circle cx="13" cy="13" r="7" fill="#f87171" fillOpacity="0.5" />
            </svg>
        );
    }
    return (
        <svg width={size} height={size} viewBox="0 0 26 26">
            <circle cx="13" cy="13" r="11" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
        </svg>
    );
}

// ─── Component ───

interface Connect4GameProps {
    gameState: Connect4State;
    messageId: number;
    chatId: string;
}

export default function Connect4Game({ gameState, messageId, chatId }: Connect4GameProps) {
    const myBrowserId = getBrowserId();
    const { socket } = useChat();

    // Determine my player number
    const myPlayerNum = (() => {
        if (myBrowserId === gameState.p1) return P1;
        if (myBrowserId === gameState.p2) return P2;
        if (gameState.p2 === "?" && myBrowserId !== gameState.p1) return P2;
        return 0; // spectator
    })();

    const isMyTurn = gameState.winner === 0 && gameState.turn === myPlayerNum;
    const gameOver = gameState.winner !== 0;

    const handleColumnClick = (col: number) => {
        if (!isMyTurn || gameOver) return;
        // Send the move to the server — server validates and processes
        socket?.emit("game_move", {
            chatId,
            messageId,
            column: col,
            browserId: myBrowserId,
        });
    };

    // Status
    let statusText: string;
    let statusColor = "text-gray-400";
    if (gameState.winner === 3) {
        statusText = "🤝 Draw!";
        statusColor = "text-yellow-400";
    } else if (gameState.winner === P1) {
        statusText = gameState.p1 === myBrowserId ? "🏆 You won!" : "🔵 Blue wins!";
        statusColor = gameState.p1 === myBrowserId ? "text-yellow-400" : "text-blue-400";
    } else if (gameState.winner === P2) {
        statusText = gameState.p2 === myBrowserId ? "🏆 You won!" : "🔴 Red wins!";
        statusColor = gameState.p2 === myBrowserId ? "text-yellow-400" : "text-red-400";
    } else if (gameState.p2 === "?") {
        statusText = gameState.p1 === myBrowserId
            ? "⏳ Waiting for opponent..."
            : "🎮 Tap a column to join!";
    } else if (isMyTurn) {
        statusText = `Your turn ${myPlayerNum === P1 ? "🔵" : "🔴"}`;
        statusColor = "text-white";
    } else {
        statusText = `${gameState.turn === P1 ? "🔵" : "🔴"} Opponent's turn`;
    }

    return (
        <div className="select-none">
            {/* Header */}
            <div className="text-center mb-2">
                <div className="text-xs font-semibold tracking-wider uppercase text-gray-500 mb-0.5">
                    🎮 Connect 4
                </div>
                <div className="flex items-center justify-center gap-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                        <CellIcon value={P1} size={14} />
                        {gameState.p1 === myBrowserId ? "You" : "P1"}
                    </span>
                    <span className="text-gray-600">vs</span>
                    <span className="flex items-center gap-1">
                        <CellIcon value={P2} size={14} />
                        {gameState.p2 === "?" ? "???" : gameState.p2 === myBrowserId ? "You" : "P2"}
                    </span>
                </div>
            </div>

            {/* Column drop buttons (glass style) */}
            {!gameOver && (
                <div
                    className="grid gap-[3px] mb-1"
                    style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}
                >
                    {Array.from({ length: COLS }, (_, col) => {
                        const colFull = gameState.board[0][col] !== EMPTY;
                        const canDrop = isMyTurn && !colFull;
                        return (
                            <button
                                key={col}
                                onClick={() => handleColumnClick(col)}
                                disabled={!canDrop}
                                className={`h-7 rounded-lg text-xs font-bold transition-all duration-150 border
                                    ${canDrop
                                        ? "bg-white/[0.07] border-white/[0.12] text-white/70 hover:bg-white/[0.14] hover:border-white/[0.22] hover:text-white hover:shadow-[0_0_12px_rgba(255,255,255,0.06)] active:scale-95 active:bg-white/[0.18] backdrop-blur-sm cursor-pointer"
                                        : "bg-transparent border-transparent text-white/20 cursor-default"
                                    }`}
                            >
                                ↓
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Board */}
            <div
                className="inline-grid gap-[3px] rounded-xl p-2"
                style={{
                    gridTemplateColumns: `repeat(${COLS}, 1fr)`,
                    background: "linear-gradient(135deg, rgba(30,60,120,0.35), rgba(15,30,60,0.45))",
                    border: "1px solid rgba(255,255,255,0.06)",
                }}
            >
                {gameState.board.map((row, r) =>
                    row.map((cell, c) => (
                        <div
                            key={`${r}-${c}`}
                            className="w-7 h-7 flex items-center justify-center"
                            onClick={() => {
                                if (cell === EMPTY && isMyTurn) handleColumnClick(c);
                            }}
                            style={{ cursor: cell === EMPTY && isMyTurn ? "pointer" : "default" }}
                        >
                            <CellIcon value={cell} />
                        </div>
                    ))
                )}
            </div>

            {/* Status */}
            <div className={`text-center text-xs mt-2 font-medium ${statusColor}`}>
                {statusText}
            </div>
        </div>
    );
}
