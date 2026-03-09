// ─── Othello/Reversi game logic (server-side) ───
// Format: GAME::OTHELLO::{p1}:{p2}:{board64}:{turn}:{winner}
// board64: 64 chars, 0=empty, 1=black(p1), 2=white(p2)
// turn: 1 or 2
// winner: 0=none, 1=black wins, 2=white wins, 3=draw

const SIZE = 8;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;

export interface OthelloState {
    p1: string;
    p2: string;
    board: number[][];
    turn: number;
    winner: number;
}

export function parseOthello(text: string): OthelloState | null {
    if (!text.startsWith("GAME::OTHELLO::")) return null;
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

export function serializeOthello(s: OthelloState): string {
    const boardStr = s.board.flat().join("");
    return `GAME::OTHELLO::${s.p1}:${s.p2}:${boardStr}:${s.turn}:${s.winner}`;
}

const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

function getFlips(board: number[][], row: number, col: number, player: number): [number, number][] {
    const opponent = player === BLACK ? WHITE : BLACK;
    const allFlips: [number, number][] = [];

    for (const [dr, dc] of DIRS) {
        const flips: [number, number][] = [];
        let r = row + dr, c = col + dc;
        while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r][c] === opponent) {
            flips.push([r, c]);
            r += dr;
            c += dc;
        }
        if (flips.length > 0 && r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r][c] === player) {
            allFlips.push(...flips);
        }
    }

    return allFlips;
}

export function othelloGetValidMoves(board: number[][], player: number): [number, number][] {
    const moves: [number, number][] = [];
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (board[r][c] === EMPTY && getFlips(board, r, c, player).length > 0) {
                moves.push([r, c]);
            }
        }
    }
    return moves;
}

export function othelloMakeMove(state: OthelloState, row: number, col: number, playerNum: number): OthelloState | null {
    if (state.winner !== 0) return null;
    if (state.turn !== playerNum) return null;
    if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return null;
    if (state.board[row][col] !== EMPTY) return null;

    const flips = getFlips(state.board, row, col, playerNum);
    if (flips.length === 0) return null;

    const newBoard = state.board.map(r => [...r]);
    newBoard[row][col] = playerNum;
    for (const [fr, fc] of flips) {
        newBoard[fr][fc] = playerNum;
    }

    const opponent = playerNum === BLACK ? WHITE : BLACK;
    let nextTurn = opponent;

    // Check if opponent has valid moves
    const opponentMoves = othelloGetValidMoves(newBoard, opponent);
    if (opponentMoves.length === 0) {
        // Check if current player has moves
        const currentMoves = othelloGetValidMoves(newBoard, playerNum);
        if (currentMoves.length === 0) {
            // Game over - count pieces
            let blackCount = 0, whiteCount = 0;
            for (let r = 0; r < SIZE; r++) {
                for (let c = 0; c < SIZE; c++) {
                    if (newBoard[r][c] === BLACK) blackCount++;
                    else if (newBoard[r][c] === WHITE) whiteCount++;
                }
            }
            const winner = blackCount > whiteCount ? BLACK : whiteCount > blackCount ? WHITE : 3;
            return { ...state, board: newBoard, turn: nextTurn, winner };
        } else {
            // Pass - current player goes again
            nextTurn = playerNum;
        }
    }

    return { ...state, board: newBoard, turn: nextTurn, winner: 0 };
}
