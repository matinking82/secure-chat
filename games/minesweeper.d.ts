export interface MinesweeperState {
    creator: string;
    rows: number;
    cols: number;
    mineCount: number;
    revealed: Set<number>;
    flagged: Set<number>;
    mines: Set<number>;
    status: number;
}
export declare function parseMinesweeper(text: string): MinesweeperState | null;
export declare function serializeMinesweeper(s: MinesweeperState): string;
export declare function minesweeperCountAdjacent(idx: number, mines: Set<number>, rows: number, cols: number): number;
export declare function minesweeperReveal(state: MinesweeperState, idx: number): MinesweeperState | null;
export declare function minesweeperToggleFlag(state: MinesweeperState, idx: number): MinesweeperState | null;
//# sourceMappingURL=minesweeper.d.ts.map