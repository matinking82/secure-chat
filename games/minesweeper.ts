// ─── Minesweeper game logic (server-side) ───
import crypto from "crypto";
// Format: GAME::MINESWEEPER::{creator}:{rows}:{cols}:{mines}:{revealed}:{flagged}:{minePositions}:{status}
// revealed: comma-separated list of revealed cell indices
// flagged: comma-separated list of flagged cell indices
// minePositions: comma-separated list of mine cell indices
// status: 0=playing, 1=won, 2=lost

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

export function parseMinesweeper(text: string): MinesweeperState | null {
    if (!text.startsWith("GAME::MINESWEEPER::")) return null;
    const parts = text.slice("GAME::MINESWEEPER::".length).split(":");
    if (parts.length < 8) return null;

    const creator = parts[0];
    const rows = parseInt(parts[1]) || 8;
    const cols = parseInt(parts[2]) || 8;
    const mineCount = parseInt(parts[3]) || 10;
    const revealed = new Set(parts[4] ? parts[4].split(",").filter(s => s).map(Number) : []);
    const flagged = new Set(parts[5] ? parts[5].split(",").filter(s => s).map(Number) : []);
    const mines = new Set(parts[6] ? parts[6].split(",").filter(s => s).map(Number) : []);
    const status = parseInt(parts[7]) || 0;

    return { creator, rows, cols, mineCount, revealed, flagged, mines, status };
}

export function serializeMinesweeper(s: MinesweeperState): string {
    const revealed = Array.from(s.revealed).join(",");
    const flagged = Array.from(s.flagged).join(",");
    const mines = Array.from(s.mines).join(",");
    return `GAME::MINESWEEPER::${s.creator}:${s.rows}:${s.cols}:${s.mineCount}:${revealed}:${flagged}:${mines}:${s.status}`;
}

function getNeighbors(idx: number, rows: number, cols: number): number[] {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const neighbors: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
                neighbors.push(nr * cols + nc);
            }
        }
    }
    return neighbors;
}

export function minesweeperCountAdjacent(idx: number, mines: Set<number>, rows: number, cols: number): number {
    return getNeighbors(idx, rows, cols).filter(n => mines.has(n)).length;
}

export function minesweeperReveal(state: MinesweeperState, idx: number): MinesweeperState | null {
    if (state.status !== 0) return null;
    if (idx < 0 || idx >= state.rows * state.cols) return null;
    if (state.revealed.has(idx)) return null;
    if (state.flagged.has(idx)) return null;

    // If mines haven't been placed yet (first click), generate them
    let mines = new Set(state.mines);
    if (mines.size === 0) {
        const total = state.rows * state.cols;
        const excluded = new Set([idx, ...getNeighbors(idx, state.rows, state.cols)]);
        const available: number[] = [];
        for (let i = 0; i < total; i++) {
            if (!excluded.has(i)) available.push(i);
        }
        // Shuffle and pick
        for (let i = available.length - 1; i > 0; i--) {
            const j = crypto.randomInt(0, i + 1);
            [available[i], available[j]] = [available[j], available[i]];
        }
        const count = Math.min(state.mineCount, available.length);
        for (let i = 0; i < count; i++) {
            mines.add(available[i]);
        }
    }

    // Check if hit a mine
    if (mines.has(idx)) {
        // Reveal all mines
        const newRevealed = new Set(state.revealed);
        mines.forEach(m => newRevealed.add(m));
        newRevealed.add(idx);
        return { ...state, revealed: newRevealed, mines, status: 2 };
    }

    // Flood fill reveal
    const newRevealed = new Set(state.revealed);
    const stack = [idx];
    while (stack.length > 0) {
        const curr = stack.pop()!;
        if (newRevealed.has(curr)) continue;
        newRevealed.add(curr);
        const adjCount = minesweeperCountAdjacent(curr, mines, state.rows, state.cols);
        if (adjCount === 0) {
            for (const n of getNeighbors(curr, state.rows, state.cols)) {
                if (!newRevealed.has(n) && !mines.has(n)) {
                    stack.push(n);
                }
            }
        }
    }

    // Check win
    const totalCells = state.rows * state.cols;
    const won = newRevealed.size === totalCells - mines.size;

    return { ...state, revealed: newRevealed, mines, status: won ? 1 : 0 };
}

export function minesweeperToggleFlag(state: MinesweeperState, idx: number): MinesweeperState | null {
    if (state.status !== 0) return null;
    if (idx < 0 || idx >= state.rows * state.cols) return null;
    if (state.revealed.has(idx)) return null;

    const newFlagged = new Set(state.flagged);
    if (newFlagged.has(idx)) {
        newFlagged.delete(idx);
    } else {
        newFlagged.add(idx);
    }

    return { ...state, flagged: newFlagged };
}
