"use strict";
// ─── Connect 4 game logic (server-side) ───
Object.defineProperty(exports, "__esModule", { value: true });
exports.C4_P2 = exports.C4_P1 = void 0;
exports.parseC4 = parseC4;
exports.serializeC4 = serializeC4;
exports.c4DropPiece = c4DropPiece;
const C4_ROWS = 6;
const C4_COLS = 7;
const C4_EMPTY = 0;
exports.C4_P1 = 1;
exports.C4_P2 = 2;
function parseC4(text) {
    if (!text.startsWith("GAME::CONNECT4::"))
        return null;
    const parts = text.slice("GAME::CONNECT4::".length).split(":");
    if (parts.length < 5)
        return null;
    const boardStr = parts[2];
    if (boardStr.length !== C4_ROWS * C4_COLS)
        return null;
    const board = [];
    for (let r = 0; r < C4_ROWS; r++) {
        const row = [];
        for (let c = 0; c < C4_COLS; c++) {
            row.push(parseInt(boardStr[r * C4_COLS + c]) || 0);
        }
        board.push(row);
    }
    return { p1: parts[0], p2: parts[1], board, turn: parseInt(parts[3]) || 1, winner: parseInt(parts[4]) || 0 };
}
function serializeC4(s) {
    return `GAME::CONNECT4::${s.p1}:${s.p2}:${s.board.flat().join("")}:${s.turn}:${s.winner}`;
}
function c4DropPiece(state, col, playerNum) {
    if (col < 0 || col >= C4_COLS || state.winner !== 0 || state.turn !== playerNum)
        return null;
    let targetRow = -1;
    for (let r = C4_ROWS - 1; r >= 0; r--) {
        if (state.board[r][col] === C4_EMPTY) {
            targetRow = r;
            break;
        }
    }
    if (targetRow === -1)
        return null;
    const newBoard = state.board.map((row) => [...row]);
    newBoard[targetRow][col] = playerNum;
    const won = c4CheckWinner(newBoard, targetRow, col, playerNum);
    const draw = !won && newBoard.every((row) => row.every((cell) => cell !== C4_EMPTY));
    return { ...state, board: newBoard, turn: playerNum === exports.C4_P1 ? exports.C4_P2 : exports.C4_P1, winner: won ? playerNum : draw ? 3 : 0 };
}
function c4CheckWinner(board, row, col, player) {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of dirs) {
        let count = 1;
        for (let i = 1; i < 4; i++) {
            const r = row + dr * i, c = col + dc * i;
            if (r < 0 || r >= C4_ROWS || c < 0 || c >= C4_COLS || board[r][c] !== player)
                break;
            count++;
        }
        for (let i = 1; i < 4; i++) {
            const r = row - dr * i, c = col - dc * i;
            if (r < 0 || r >= C4_ROWS || c < 0 || c >= C4_COLS || board[r][c] !== player)
                break;
            count++;
        }
        if (count >= 4)
            return true;
    }
    return false;
}
//# sourceMappingURL=connect4.js.map