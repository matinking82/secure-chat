import { useState, useCallback } from "react";
import { getBrowserId } from "../../lib/storage";
import { useChat } from "../../contexts/ChatContext";

// ─── Constants ───
const BOARD_SIZE = 8;
const EMPTY = "";
const WHITE = "w";
const BLACK = "b";

// Piece characters for display
const PIECE_SYMBOLS: Record<string, string> = {
    wK: "♔", wQ: "♕", wR: "♖", wB: "♗", wN: "♘", wP: "♙",
    bK: "♚", bQ: "♛", bR: "♜", bB: "♝", bN: "♞", bP: "♟",
};

// ─── Game state ───
export interface ChessState {
    p1: string; // browserId of white
    p2: string; // browserId of black, "?" if open
    board: string[][]; // 8x8, each cell is "" or "wP", "bK", etc.
    turn: string; // "w" or "b"
    winner: string; // "" = none, "w" = white, "b" = black, "d" = draw
    lastMove: string; // e.g. "e2e4" for highlighting
    castling: string; // e.g. "KQkq" for available castling rights
    enPassant: string; // e.g. "e3" or ""
}

// Initial board setup
function initialBoard(): string[][] {
    return [
        ["bR", "bN", "bB", "bQ", "bK", "bB", "bN", "bR"],
        ["bP", "bP", "bP", "bP", "bP", "bP", "bP", "bP"],
        ["", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["wP", "wP", "wP", "wP", "wP", "wP", "wP", "wP"],
        ["wR", "wN", "wB", "wQ", "wK", "wB", "wN", "wR"],
    ];
}

/** Create a fresh chess game state string (unencrypted) */
export function createChess(initiatorBrowserId: string): string {
    const board = initialBoard();
    const boardStr = board.flat().map(c => c || "--").join(",");
    return `GAME::CHESS::${initiatorBrowserId}:?:${boardStr}:w::KQkq:`;
}

/** Check if a decrypted message text is a Chess game */
export function isChessMessage(text: string): boolean {
    return text.startsWith("GAME::CHESS::");
}

/** Parse game state from message text */
export function parseChess(text: string): ChessState | null {
    if (!isChessMessage(text)) return null;
    const parts = text.slice("GAME::CHESS::".length).split(":");
    if (parts.length < 7) return null;

    const p1 = parts[0];
    const p2 = parts[1];
    const boardStr = parts[2];
    const turn = parts[3] || "w";
    const winner = parts[4] || "";
    const castling = parts[5] || "";
    const enPassant = parts[6] || "";
    const lastMove = parts[7] || "";

    const cells = boardStr.split(",");
    if (cells.length !== 64) return null;

    const board: string[][] = [];
    for (let r = 0; r < 8; r++) {
        const row: string[] = [];
        for (let c = 0; c < 8; c++) {
            const cell = cells[r * 8 + c];
            row.push(cell === "--" ? "" : cell);
        }
        board.push(row);
    }

    return { p1, p2, board, turn, winner, lastMove, castling, enPassant };
}

/** Serialize game state to message format */
export function serializeChess(state: ChessState): string {
    const boardStr = state.board.flat().map(c => c || "--").join(",");
    return `GAME::CHESS::${state.p1}:${state.p2}:${boardStr}:${state.turn}:${state.winner}:${state.castling}:${state.enPassant}:${state.lastMove}`;
}

// ─── Move validation ───

function isInBounds(r: number, c: number): boolean {
    return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function pieceColor(piece: string): string {
    return piece ? piece[0] : "";
}

function pieceType(piece: string): string {
    return piece ? piece[1] : "";
}

/** Get all squares a piece can move to (pseudo-legal, before checking for check) */
function getPseudoLegalMoves(board: string[][], row: number, col: number, castling: string, enPassant: string): [number, number][] {
    const piece = board[row][col];
    if (!piece) return [];
    const color = pieceColor(piece);
    const type = pieceType(piece);
    const moves: [number, number][] = [];
    const enemy = color === WHITE ? BLACK : WHITE;

    const addIfValid = (r: number, c: number) => {
        if (isInBounds(r, c) && pieceColor(board[r][c]) !== color) {
            moves.push([r, c]);
        }
    };

    if (type === "P") {
        const dir = color === WHITE ? -1 : 1;
        const startRow = color === WHITE ? 6 : 1;
        // Forward
        if (isInBounds(row + dir, col) && !board[row + dir][col]) {
            moves.push([row + dir, col]);
            // Double move from start
            if (row === startRow && !board[row + 2 * dir][col]) {
                moves.push([row + 2 * dir, col]);
            }
        }
        // Captures
        for (const dc of [-1, 1]) {
            const nr = row + dir;
            const nc = col + dc;
            if (isInBounds(nr, nc) && board[nr][nc] && pieceColor(board[nr][nc]) === enemy) {
                moves.push([nr, nc]);
            }
            // En passant
            if (enPassant) {
                const epCol = enPassant.charCodeAt(0) - 97; // 'a' = 0
                const epRow = 8 - parseInt(enPassant[1]);
                if (nr === epRow && nc === epCol) {
                    moves.push([nr, nc]);
                }
            }
        }
    } else if (type === "N") {
        const knightMoves = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
        for (const [dr, dc] of knightMoves) addIfValid(row + dr, col + dc);
    } else if (type === "B") {
        for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
            for (let i = 1; i < 8; i++) {
                const nr = row + dr * i, nc = col + dc * i;
                if (!isInBounds(nr, nc)) break;
                if (board[nr][nc]) {
                    if (pieceColor(board[nr][nc]) === enemy) moves.push([nr, nc]);
                    break;
                }
                moves.push([nr, nc]);
            }
        }
    } else if (type === "R") {
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            for (let i = 1; i < 8; i++) {
                const nr = row + dr * i, nc = col + dc * i;
                if (!isInBounds(nr, nc)) break;
                if (board[nr][nc]) {
                    if (pieceColor(board[nr][nc]) === enemy) moves.push([nr, nc]);
                    break;
                }
                moves.push([nr, nc]);
            }
        }
    } else if (type === "Q") {
        for (const [dr, dc] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
            for (let i = 1; i < 8; i++) {
                const nr = row + dr * i, nc = col + dc * i;
                if (!isInBounds(nr, nc)) break;
                if (board[nr][nc]) {
                    if (pieceColor(board[nr][nc]) === enemy) moves.push([nr, nc]);
                    break;
                }
                moves.push([nr, nc]);
            }
        }
    } else if (type === "K") {
        for (const [dr, dc] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
            addIfValid(row + dr, col + dc);
        }
        // Castling
        const kingRow = color === WHITE ? 7 : 0;
        if (row === kingRow && col === 4) {
            // Kingside
            const ksChar = color === WHITE ? "K" : "k";
            if (castling.includes(ksChar) && !board[kingRow][5] && !board[kingRow][6] && board[kingRow][7] === `${color}R`) {
                if (!isSquareAttacked(board, kingRow, 4, enemy) && !isSquareAttacked(board, kingRow, 5, enemy) && !isSquareAttacked(board, kingRow, 6, enemy)) {
                    moves.push([kingRow, 6]);
                }
            }
            // Queenside
            const qsChar = color === WHITE ? "Q" : "q";
            if (castling.includes(qsChar) && !board[kingRow][3] && !board[kingRow][2] && !board[kingRow][1] && board[kingRow][0] === `${color}R`) {
                if (!isSquareAttacked(board, kingRow, 4, enemy) && !isSquareAttacked(board, kingRow, 3, enemy) && !isSquareAttacked(board, kingRow, 2, enemy)) {
                    moves.push([kingRow, 2]);
                }
            }
        }
    }

    return moves;
}

/** Check if a square is attacked by a given color */
function isSquareAttacked(board: string[][], row: number, col: number, attackerColor: string): boolean {
    // Check pawn attacks
    const pawnDir = attackerColor === WHITE ? 1 : -1;
    for (const dc of [-1, 1]) {
        const pr = row + pawnDir;
        const pc = col + dc;
        if (isInBounds(pr, pc) && board[pr][pc] === `${attackerColor}P`) return true;
    }

    // Knight attacks
    for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
        const nr = row + dr, nc = col + dc;
        if (isInBounds(nr, nc) && board[nr][nc] === `${attackerColor}N`) return true;
    }

    // Bishop/Queen diagonal attacks
    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        for (let i = 1; i < 8; i++) {
            const nr = row + dr * i, nc = col + dc * i;
            if (!isInBounds(nr, nc)) break;
            if (board[nr][nc]) {
                const p = board[nr][nc];
                if (p === `${attackerColor}B` || p === `${attackerColor}Q`) return true;
                break;
            }
        }
    }

    // Rook/Queen straight attacks
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        for (let i = 1; i < 8; i++) {
            const nr = row + dr * i, nc = col + dc * i;
            if (!isInBounds(nr, nc)) break;
            if (board[nr][nc]) {
                const p = board[nr][nc];
                if (p === `${attackerColor}R` || p === `${attackerColor}Q`) return true;
                break;
            }
        }
    }

    // King attacks
    for (const [dr, dc] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
        const nr = row + dr, nc = col + dc;
        if (isInBounds(nr, nc) && board[nr][nc] === `${attackerColor}K`) return true;
    }

    return false;
}

/** Find king position */
function findKing(board: string[][], color: string): [number, number] | null {
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (board[r][c] === `${color}K`) return [r, c];
        }
    }
    return null;
}

/** Check if king of given color is in check */
function isInCheck(board: string[][], color: string): boolean {
    const kingPos = findKing(board, color);
    if (!kingPos) return false;
    const enemy = color === WHITE ? BLACK : WHITE;
    return isSquareAttacked(board, kingPos[0], kingPos[1], enemy);
}

/** Get legal moves for a piece (filters pseudo-legal by check) */
function getLegalMoves(state: ChessState, row: number, col: number): [number, number][] {
    const piece = state.board[row][col];
    if (!piece) return [];
    const color = pieceColor(piece);
    const pseudoMoves = getPseudoLegalMoves(state.board, row, col, state.castling, state.enPassant);

    return pseudoMoves.filter(([tr, tc]) => {
        // Simulate move
        const newBoard = state.board.map(r => [...r]);
        newBoard[tr][tc] = piece;
        newBoard[row][col] = "";

        // Handle en passant capture
        if (pieceType(piece) === "P" && tc !== col && !state.board[tr][tc]) {
            newBoard[row][tc] = ""; // Remove captured pawn
        }

        // Handle castling — move the rook too
        if (pieceType(piece) === "K" && Math.abs(tc - col) === 2) {
            const kingRow = color === WHITE ? 7 : 0;
            if (tc === 6) { // Kingside
                newBoard[kingRow][5] = newBoard[kingRow][7];
                newBoard[kingRow][7] = "";
            } else if (tc === 2) { // Queenside
                newBoard[kingRow][3] = newBoard[kingRow][0];
                newBoard[kingRow][0] = "";
            }
        }

        return !isInCheck(newBoard, color);
    });
}

/** Apply a move and return new state */
export function applyMove(state: ChessState, fromRow: number, fromCol: number, toRow: number, toCol: number, promotion?: string): ChessState | null {
    const piece = state.board[fromRow][fromCol];
    if (!piece) return null;
    const color = pieceColor(piece);

    // Validate it's the right turn
    if (color !== state.turn) return null;

    const legalMoves = getLegalMoves(state, fromRow, fromCol);
    if (!legalMoves.some(([r, c]) => r === toRow && c === toCol)) return null;

    const newBoard = state.board.map(r => [...r]);
    let newCastling = state.castling;
    let newEnPassant = "";

    // Handle en passant capture
    if (pieceType(piece) === "P" && toCol !== fromCol && !state.board[toRow][toCol]) {
        newBoard[fromRow][toCol] = ""; // Remove captured pawn
    }

    // Handle castling — move the rook too
    if (pieceType(piece) === "K" && Math.abs(toCol - fromCol) === 2) {
        const kingRow = color === WHITE ? 7 : 0;
        if (toCol === 6) { // Kingside
            newBoard[kingRow][5] = newBoard[kingRow][7];
            newBoard[kingRow][7] = "";
        } else if (toCol === 2) { // Queenside
            newBoard[kingRow][3] = newBoard[kingRow][0];
            newBoard[kingRow][0] = "";
        }
    }

    // Move piece
    newBoard[toRow][toCol] = piece;
    newBoard[fromRow][fromCol] = "";

    // Pawn promotion
    if (pieceType(piece) === "P" && (toRow === 0 || toRow === 7)) {
        newBoard[toRow][toCol] = `${color}${promotion || "Q"}`;
    }

    // Update castling rights
    if (pieceType(piece) === "K") {
        if (color === WHITE) newCastling = newCastling.replace("K", "").replace("Q", "");
        else newCastling = newCastling.replace("k", "").replace("q", "");
    }
    if (pieceType(piece) === "R") {
        if (fromRow === 7 && fromCol === 0) newCastling = newCastling.replace("Q", "");
        if (fromRow === 7 && fromCol === 7) newCastling = newCastling.replace("K", "");
        if (fromRow === 0 && fromCol === 0) newCastling = newCastling.replace("q", "");
        if (fromRow === 0 && fromCol === 7) newCastling = newCastling.replace("k", "");
    }
    // If a rook is captured
    if (toRow === 0 && toCol === 0) newCastling = newCastling.replace("q", "");
    if (toRow === 0 && toCol === 7) newCastling = newCastling.replace("k", "");
    if (toRow === 7 && toCol === 0) newCastling = newCastling.replace("Q", "");
    if (toRow === 7 && toCol === 7) newCastling = newCastling.replace("K", "");

    // En passant tracking
    if (pieceType(piece) === "P" && Math.abs(toRow - fromRow) === 2) {
        const epRow = (fromRow + toRow) / 2;
        newEnPassant = String.fromCharCode(97 + fromCol) + (8 - epRow);
    }

    const nextTurn = color === WHITE ? BLACK : WHITE;

    // Check for checkmate/stalemate
    let hasLegalMove = false;
    for (let r = 0; r < 8 && !hasLegalMove; r++) {
        for (let c = 0; c < 8 && !hasLegalMove; c++) {
            if (newBoard[r][c] && pieceColor(newBoard[r][c]) === nextTurn) {
                const tempState: ChessState = { ...state, board: newBoard, turn: nextTurn, castling: newCastling, enPassant: newEnPassant };
                if (getLegalMoves(tempState, r, c).length > 0) {
                    hasLegalMove = true;
                }
            }
        }
    }

    let winner = "";
    if (!hasLegalMove) {
        if (isInCheck(newBoard, nextTurn)) {
            winner = color; // Checkmate
        } else {
            winner = "d"; // Stalemate
        }
    }

    const lastMove = String.fromCharCode(97 + fromCol) + (8 - fromRow) + String.fromCharCode(97 + toCol) + (8 - toRow);

    return {
        ...state,
        board: newBoard,
        turn: nextTurn,
        winner,
        lastMove,
        castling: newCastling,
        enPassant: newEnPassant,
    };
}

// ─── Component ───

interface ChessGameProps {
    gameState: ChessState;
    messageId: number;
    chatId: string;
}

export default function ChessGame({ gameState, messageId, chatId }: ChessGameProps) {
    const myBrowserId = getBrowserId();
    const { socket } = useChat();
    const [selected, setSelected] = useState<[number, number] | null>(null);
    const [legalMoves, setLegalMoves] = useState<[number, number][]>([]);
    const [promotionPending, setPromotionPending] = useState<{ from: [number, number]; to: [number, number] } | null>(null);

    // Determine my color
    const myColor = (() => {
        if (myBrowserId === gameState.p1) return WHITE;
        if (myBrowserId === gameState.p2) return BLACK;
        if (gameState.p2 === "?" && myBrowserId !== gameState.p1) return BLACK;
        return ""; // spectator
    })();

    const isMyTurn = gameState.winner === "" && gameState.turn === myColor;
    const gameOver = gameState.winner !== "";

    const handleSquareClick = useCallback((row: number, col: number) => {
        if (promotionPending) return;
        if (gameOver) return;

        const piece = gameState.board[row][col];

        if (selected) {
            // Check if clicking on own piece to reselect
            if (piece && pieceColor(piece) === myColor) {
                const moves = getLegalMoves(gameState, row, col);
                setSelected([row, col]);
                setLegalMoves(moves);
                return;
            }

            // Try to move
            if (legalMoves.some(([r, c]) => r === row && c === col)) {
                const fromPiece = gameState.board[selected[0]][selected[1]];
                // Check for pawn promotion
                if (pieceType(fromPiece) === "P" && (row === 0 || row === 7)) {
                    setPromotionPending({ from: selected, to: [row, col] });
                    return;
                }

                // Send move to server
                socket?.emit("chess_move", {
                    chatId,
                    messageId,
                    fromRow: selected[0],
                    fromCol: selected[1],
                    toRow: row,
                    toCol: col,
                    browserId: myBrowserId,
                });
                setSelected(null);
                setLegalMoves([]);
            } else {
                setSelected(null);
                setLegalMoves([]);
            }
        } else if (piece && pieceColor(piece) === myColor && isMyTurn) {
            const moves = getLegalMoves(gameState, row, col);
            setSelected([row, col]);
            setLegalMoves(moves);
        }
    }, [selected, legalMoves, gameState, myColor, isMyTurn, gameOver, promotionPending, socket, chatId, messageId, myBrowserId]);

    const handlePromotion = (pieceType: string) => {
        if (!promotionPending) return;
        socket?.emit("chess_move", {
            chatId,
            messageId,
            fromRow: promotionPending.from[0],
            fromCol: promotionPending.from[1],
            toRow: promotionPending.to[0],
            toCol: promotionPending.to[1],
            promotion: pieceType,
            browserId: myBrowserId,
        });
        setPromotionPending(null);
        setSelected(null);
        setLegalMoves([]);
    };

    // Parse last move for highlighting
    const lastMoveSquares: [number, number][] = [];
    if (gameState.lastMove && gameState.lastMove.length === 4) {
        const fc = gameState.lastMove.charCodeAt(0) - 97;
        const fr = 8 - parseInt(gameState.lastMove[1]);
        const tc = gameState.lastMove.charCodeAt(2) - 97;
        const tr = 8 - parseInt(gameState.lastMove[3]);
        lastMoveSquares.push([fr, fc], [tr, tc]);
    }

    // Check indicator
    const inCheck = gameState.winner === "" && isInCheck(gameState.board, gameState.turn);
    const checkedKingPos = inCheck ? findKing(gameState.board, gameState.turn) : null;

    // Status text
    let statusText: string;
    let statusColor = "text-gray-400";
    if (gameState.winner === "d") {
        statusText = "🤝 Draw (Stalemate)!";
        statusColor = "text-yellow-400";
    } else if (gameState.winner === WHITE) {
        statusText = myColor === WHITE ? "🏆 You won!" : "♔ White wins!";
        statusColor = myColor === WHITE ? "text-yellow-400" : "text-gray-300";
    } else if (gameState.winner === BLACK) {
        statusText = myColor === BLACK ? "🏆 You won!" : "♚ Black wins!";
        statusColor = myColor === BLACK ? "text-yellow-400" : "text-gray-300";
    } else if (gameState.p2 === "?") {
        statusText = gameState.p1 === myBrowserId
            ? "⏳ Waiting for opponent..."
            : "♟ Tap a piece to join!";
    } else if (isMyTurn) {
        statusText = inCheck ? `⚠️ Check! Your turn (${myColor === WHITE ? "♔" : "♚"})` : `Your turn (${myColor === WHITE ? "♔" : "♚"})`;
        statusColor = inCheck ? "text-red-400" : "text-white";
    } else {
        statusText = `${gameState.turn === WHITE ? "♔" : "♚"} Opponent's turn`;
    }

    // Board display (flipped for black player)
    const displayBoard = myColor === BLACK
        ? gameState.board.map(r => [...r].reverse()).reverse()
        : gameState.board;

    const mapCoords = (displayRow: number, displayCol: number): [number, number] => {
        if (myColor === BLACK) {
            return [7 - displayRow, 7 - displayCol];
        }
        return [displayRow, displayCol];
    };

    return (
        <div className="select-none">
            {/* Header */}
            <div className="text-center mb-2">
                <div className="text-xs font-semibold tracking-wider uppercase text-gray-500 mb-0.5">
                    ♟ Chess
                </div>
                <div className="flex items-center justify-center gap-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                        ♔ {gameState.p1 === myBrowserId ? "You" : "White"}
                    </span>
                    <span className="text-gray-600">vs</span>
                    <span className="flex items-center gap-1">
                        ♚ {gameState.p2 === "?" ? "???" : gameState.p2 === myBrowserId ? "You" : "Black"}
                    </span>
                </div>
            </div>

            {/* Board */}
            <div
                className="inline-grid rounded-lg overflow-hidden"
                style={{
                    gridTemplateColumns: `repeat(8, 1fr)`,
                    border: "2px solid rgba(255,255,255,0.15)",
                }}
            >
                {displayBoard.map((row, displayRow) =>
                    row.map((cell, displayCol) => {
                        const [realRow, realCol] = mapCoords(displayRow, displayCol);
                        const isDark = (realRow + realCol) % 2 === 1;
                        const isSelected = selected && selected[0] === realRow && selected[1] === realCol;
                        const isLegalTarget = legalMoves.some(([r, c]) => r === realRow && c === realCol);
                        const isLastMove = lastMoveSquares.some(([r, c]) => r === realRow && c === realCol);
                        const isCheckedKing = checkedKingPos && checkedKingPos[0] === realRow && checkedKingPos[1] === realCol;
                        const piece = gameState.board[realRow][realCol];

                        let bg = isDark ? "rgba(139,115,85,0.6)" : "rgba(235,220,190,0.6)";
                        if (isLastMove) bg = isDark ? "rgba(170,162,58,0.65)" : "rgba(205,210,106,0.65)";
                        if (isSelected) bg = "rgba(78,164,246,0.5)";
                        if (isCheckedKing) bg = "rgba(255,60,60,0.5)";

                        return (
                            <div
                                key={`${displayRow}-${displayCol}`}
                                className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center relative cursor-pointer"
                                style={{ background: bg }}
                                onClick={() => handleSquareClick(realRow, realCol)}
                            >
                                {piece && (
                                    <span className="text-lg md:text-xl" style={{
                                        textShadow: pieceColor(piece) === WHITE
                                            ? "0 1px 2px rgba(0,0,0,0.5)"
                                            : "0 1px 2px rgba(0,0,0,0.3)",
                                        filter: pieceColor(piece) === BLACK ? "drop-shadow(0 1px 1px rgba(255,255,255,0.2))" : undefined,
                                        color: pieceColor(piece) === WHITE ? undefined : "rgb(0, 0, 0)"
                                    }}>
                                        {PIECE_SYMBOLS[piece] || ""}
                                    </span>
                                )}
                                {/* Legal move indicator */}
                                {isLegalTarget && !piece && (
                                    <div className="absolute w-3 h-3 rounded-full bg-black/20" />
                                )}
                                {isLegalTarget && piece && (
                                    <div className="absolute inset-0 border-2 border-black/30 rounded-sm" />
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {/* Promotion dialog */}
            {promotionPending && (
                <div className="flex items-center justify-center gap-2 mt-2 bg-[#1e2c3a] rounded-lg p-2">
                    <span className="text-xs text-gray-400 mr-1">Promote to:</span>
                    {["Q", "R", "B", "N"].map((pt) => (
                        <button
                            key={pt}
                            onClick={() => handlePromotion(pt)}
                            className="w-8 h-8 flex items-center justify-center rounded bg-white/10 hover:bg-white/20 transition text-lg"
                        >
                            {PIECE_SYMBOLS[`${myColor}${pt}`]}
                        </button>
                    ))}
                </div>
            )}

            {/* Status */}
            <div className={`text-center text-xs mt-2 font-medium ${statusColor}`}>
                {statusText}
            </div>
        </div>
    );
}
