"use strict";
// ─── XO (Tic-Tac-Toe) game logic (server-side) ───
// Format: GAME::XO::{p1}:{p2}:{board9}:{turn}:{winner}
// board9: 9 chars, 0=empty, 1=X(p1), 2=O(p2)
// turn: 1 or 2
// winner: 0=none, 1=X wins, 2=O wins, 3=draw
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseXO = parseXO;
exports.serializeXO = serializeXO;
exports.xoMakeMove = xoMakeMove;
function parseXO(text) {
    if (!text.startsWith("GAME::XO::"))
        return null;
    const parts = text.slice("GAME::XO::".length).split(":");
    if (parts.length < 5)
        return null;
    const boardStr = parts[2];
    if (boardStr.length !== 9)
        return null;
    const board = boardStr.split("").map(c => parseInt(c) || 0);
    return {
        p1: parts[0],
        p2: parts[1],
        board,
        turn: parseInt(parts[3]) || 1,
        winner: parseInt(parts[4]) || 0,
    };
}
function serializeXO(s) {
    return `GAME::XO::${s.p1}:${s.p2}:${s.board.join("")}:${s.turn}:${s.winner}`;
}
const WIN_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
    [0, 4, 8], [2, 4, 6], // diagonals
];
function xoMakeMove(state, pos, playerNum) {
    if (pos < 0 || pos > 8)
        return null;
    if (state.winner !== 0)
        return null;
    if (state.turn !== playerNum)
        return null;
    if (state.board[pos] !== 0)
        return null;
    const newBoard = [...state.board];
    newBoard[pos] = playerNum;
    // Check winner
    let winner = 0;
    for (const [a, b, c] of WIN_LINES) {
        if (newBoard[a] !== 0 && newBoard[a] === newBoard[b] && newBoard[b] === newBoard[c]) {
            winner = newBoard[a];
            break;
        }
    }
    // Check draw
    const isDraw = !winner && newBoard.every(c => c !== 0);
    return {
        ...state,
        board: newBoard,
        turn: playerNum === 1 ? 2 : 1,
        winner: winner || (isDraw ? 3 : 0),
    };
}
//# sourceMappingURL=xo.js.map