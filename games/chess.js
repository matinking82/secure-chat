"use strict";
// ─── Chess game logic (server-side) ───
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseChess = parseChess;
exports.serializeChess = serializeChess;
exports.chessGetLegalMoves = chessGetLegalMoves;
exports.chessApplyMove = chessApplyMove;
function parseChess(text) {
    if (!text.startsWith("GAME::CHESS::"))
        return null;
    const parts = text.slice("GAME::CHESS::".length).split(":");
    if (parts.length < 7)
        return null;
    const p1 = parts[0];
    const p2 = parts[1];
    const boardStr = parts[2];
    const turn = parts[3] || "w";
    const winner = parts[4] || "";
    const castling = parts[5] || "";
    const enPassant = parts[6] || "";
    const lastMove = parts[7] || "";
    const cells = boardStr.split(",");
    if (cells.length !== 64)
        return null;
    const board = [];
    for (let r = 0; r < 8; r++) {
        const row = [];
        for (let c = 0; c < 8; c++) {
            const cell = cells[r * 8 + c];
            row.push(cell === "--" ? "" : cell);
        }
        board.push(row);
    }
    return { p1, p2, board, turn, winner, lastMove, castling, enPassant };
}
function serializeChess(s) {
    const boardStr = s.board.flat().map(c => c || "--").join(",");
    return `GAME::CHESS::${s.p1}:${s.p2}:${boardStr}:${s.turn}:${s.winner}:${s.castling}:${s.enPassant}:${s.lastMove}`;
}
function chessPieceColor(piece) { return piece ? piece[0] : ""; }
function chessPieceType(piece) { return piece ? piece[1] : ""; }
function chessIsInBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function chessIsSquareAttacked(board, row, col, attackerColor) {
    const pawnDir = attackerColor === "w" ? 1 : -1;
    for (const dc of [-1, 1]) {
        const pr = row + pawnDir, pc = col + dc;
        if (chessIsInBounds(pr, pc) && board[pr][pc] === `${attackerColor}P`)
            return true;
    }
    for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
        const nr = row + dr, nc = col + dc;
        if (chessIsInBounds(nr, nc) && board[nr][nc] === `${attackerColor}N`)
            return true;
    }
    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        for (let i = 1; i < 8; i++) {
            const nr = row + dr * i, nc = col + dc * i;
            if (!chessIsInBounds(nr, nc))
                break;
            if (board[nr][nc]) {
                if (board[nr][nc] === `${attackerColor}B` || board[nr][nc] === `${attackerColor}Q`)
                    return true;
                break;
            }
        }
    }
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        for (let i = 1; i < 8; i++) {
            const nr = row + dr * i, nc = col + dc * i;
            if (!chessIsInBounds(nr, nc))
                break;
            if (board[nr][nc]) {
                if (board[nr][nc] === `${attackerColor}R` || board[nr][nc] === `${attackerColor}Q`)
                    return true;
                break;
            }
        }
    }
    for (const [dr, dc] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
        const nr = row + dr, nc = col + dc;
        if (chessIsInBounds(nr, nc) && board[nr][nc] === `${attackerColor}K`)
            return true;
    }
    return false;
}
function chessFindKing(board, color) {
    for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++)
            if (board[r][c] === `${color}K`)
                return [r, c];
    return null;
}
function chessIsInCheck(board, color) {
    const kp = chessFindKing(board, color);
    if (!kp)
        return false;
    return chessIsSquareAttacked(board, kp[0], kp[1], color === "w" ? "b" : "w");
}
function chessGetPseudoLegalMoves(board, row, col, castling, enPassant) {
    const piece = board[row][col];
    if (!piece)
        return [];
    const color = chessPieceColor(piece);
    const type = chessPieceType(piece);
    const moves = [];
    const enemy = color === "w" ? "b" : "w";
    const addIfValid = (r, c) => { if (chessIsInBounds(r, c) && chessPieceColor(board[r][c]) !== color)
        moves.push([r, c]); };
    if (type === "P") {
        const dir = color === "w" ? -1 : 1;
        const startRow = color === "w" ? 6 : 1;
        if (chessIsInBounds(row + dir, col) && !board[row + dir][col]) {
            moves.push([row + dir, col]);
            if (row === startRow && !board[row + 2 * dir][col])
                moves.push([row + 2 * dir, col]);
        }
        for (const dc of [-1, 1]) {
            const nr = row + dir, nc = col + dc;
            if (chessIsInBounds(nr, nc) && board[nr][nc] && chessPieceColor(board[nr][nc]) === enemy)
                moves.push([nr, nc]);
            if (enPassant) {
                const epCol = enPassant.charCodeAt(0) - 97;
                const epRow = 8 - parseInt(enPassant[1]);
                if (nr === epRow && nc === epCol)
                    moves.push([nr, nc]);
            }
        }
    }
    else if (type === "N") {
        for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]])
            addIfValid(row + dr, col + dc);
    }
    else if (type === "B") {
        for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
            for (let i = 1; i < 8; i++) {
                const nr = row + dr * i, nc = col + dc * i;
                if (!chessIsInBounds(nr, nc))
                    break;
                if (board[nr][nc]) {
                    if (chessPieceColor(board[nr][nc]) === enemy)
                        moves.push([nr, nc]);
                    break;
                }
                moves.push([nr, nc]);
            }
        }
    }
    else if (type === "R") {
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            for (let i = 1; i < 8; i++) {
                const nr = row + dr * i, nc = col + dc * i;
                if (!chessIsInBounds(nr, nc))
                    break;
                if (board[nr][nc]) {
                    if (chessPieceColor(board[nr][nc]) === enemy)
                        moves.push([nr, nc]);
                    break;
                }
                moves.push([nr, nc]);
            }
        }
    }
    else if (type === "Q") {
        for (const [dr, dc] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
            for (let i = 1; i < 8; i++) {
                const nr = row + dr * i, nc = col + dc * i;
                if (!chessIsInBounds(nr, nc))
                    break;
                if (board[nr][nc]) {
                    if (chessPieceColor(board[nr][nc]) === enemy)
                        moves.push([nr, nc]);
                    break;
                }
                moves.push([nr, nc]);
            }
        }
    }
    else if (type === "K") {
        for (const [dr, dc] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]])
            addIfValid(row + dr, col + dc);
        const kingRow = color === "w" ? 7 : 0;
        if (row === kingRow && col === 4) {
            const ksChar = color === "w" ? "K" : "k";
            if (castling.includes(ksChar) && !board[kingRow][5] && !board[kingRow][6] && board[kingRow][7] === `${color}R`) {
                if (!chessIsSquareAttacked(board, kingRow, 4, enemy) && !chessIsSquareAttacked(board, kingRow, 5, enemy) && !chessIsSquareAttacked(board, kingRow, 6, enemy))
                    moves.push([kingRow, 6]);
            }
            const qsChar = color === "w" ? "Q" : "q";
            if (castling.includes(qsChar) && !board[kingRow][3] && !board[kingRow][2] && !board[kingRow][1] && board[kingRow][0] === `${color}R`) {
                if (!chessIsSquareAttacked(board, kingRow, 4, enemy) && !chessIsSquareAttacked(board, kingRow, 3, enemy) && !chessIsSquareAttacked(board, kingRow, 2, enemy))
                    moves.push([kingRow, 2]);
            }
        }
    }
    return moves;
}
function chessGetLegalMoves(state, row, col) {
    const piece = state.board[row][col];
    if (!piece)
        return [];
    const color = chessPieceColor(piece);
    return chessGetPseudoLegalMoves(state.board, row, col, state.castling, state.enPassant).filter(([tr, tc]) => {
        const nb = state.board.map(r => [...r]);
        nb[tr][tc] = piece;
        nb[row][col] = "";
        if (chessPieceType(piece) === "P" && tc !== col && !state.board[tr][tc])
            nb[row][tc] = "";
        if (chessPieceType(piece) === "K" && Math.abs(tc - col) === 2) {
            const kr = color === "w" ? 7 : 0;
            if (tc === 6) {
                nb[kr][5] = nb[kr][7];
                nb[kr][7] = "";
            }
            else if (tc === 2) {
                nb[kr][3] = nb[kr][0];
                nb[kr][0] = "";
            }
        }
        return !chessIsInCheck(nb, color);
    });
}
function chessApplyMove(state, fromRow, fromCol, toRow, toCol, promotion) {
    const piece = state.board[fromRow][fromCol];
    if (!piece)
        return null;
    const color = chessPieceColor(piece);
    if (color !== state.turn)
        return null;
    const lm = chessGetLegalMoves(state, fromRow, fromCol);
    if (!lm.some(([r, c]) => r === toRow && c === toCol))
        return null;
    const nb = state.board.map(r => [...r]);
    let nc = state.castling;
    let ne = "";
    if (chessPieceType(piece) === "P" && toCol !== fromCol && !state.board[toRow][toCol])
        nb[fromRow][toCol] = "";
    if (chessPieceType(piece) === "K" && Math.abs(toCol - fromCol) === 2) {
        const kr = color === "w" ? 7 : 0;
        if (toCol === 6) {
            nb[kr][5] = nb[kr][7];
            nb[kr][7] = "";
        }
        else if (toCol === 2) {
            nb[kr][3] = nb[kr][0];
            nb[kr][0] = "";
        }
    }
    nb[toRow][toCol] = piece;
    nb[fromRow][fromCol] = "";
    if (chessPieceType(piece) === "P" && (toRow === 0 || toRow === 7))
        nb[toRow][toCol] = `${color}${promotion || "Q"}`;
    if (chessPieceType(piece) === "K") {
        if (color === "w")
            nc = nc.replace("K", "").replace("Q", "");
        else
            nc = nc.replace("k", "").replace("q", "");
    }
    if (chessPieceType(piece) === "R") {
        if (fromRow === 7 && fromCol === 0)
            nc = nc.replace("Q", "");
        if (fromRow === 7 && fromCol === 7)
            nc = nc.replace("K", "");
        if (fromRow === 0 && fromCol === 0)
            nc = nc.replace("q", "");
        if (fromRow === 0 && fromCol === 7)
            nc = nc.replace("k", "");
    }
    if (toRow === 0 && toCol === 0)
        nc = nc.replace("q", "");
    if (toRow === 0 && toCol === 7)
        nc = nc.replace("k", "");
    if (toRow === 7 && toCol === 0)
        nc = nc.replace("Q", "");
    if (toRow === 7 && toCol === 7)
        nc = nc.replace("K", "");
    if (chessPieceType(piece) === "P" && Math.abs(toRow - fromRow) === 2) {
        const epR = (fromRow + toRow) / 2;
        ne = String.fromCharCode(97 + fromCol) + (8 - epR);
    }
    const nextTurn = color === "w" ? "b" : "w";
    let hasLegal = false;
    for (let r = 0; r < 8 && !hasLegal; r++)
        for (let c = 0; c < 8 && !hasLegal; c++) {
            if (nb[r][c] && chessPieceColor(nb[r][c]) === nextTurn) {
                if (chessGetLegalMoves({ ...state, board: nb, turn: nextTurn, castling: nc, enPassant: ne }, r, c).length > 0)
                    hasLegal = true;
            }
        }
    let winner = "";
    if (!hasLegal) {
        winner = chessIsInCheck(nb, nextTurn) ? color : "d";
    }
    const lmStr = String.fromCharCode(97 + fromCol) + (8 - fromRow) + String.fromCharCode(97 + toCol) + (8 - toRow);
    return { ...state, board: nb, turn: nextTurn, winner, lastMove: lmStr, castling: nc, enPassant: ne };
}
//# sourceMappingURL=chess.js.map