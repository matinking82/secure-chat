export interface XOState {
    p1: string;
    p2: string;
    board: number[];
    turn: number;
    winner: number;
}
export declare function parseXO(text: string): XOState | null;
export declare function serializeXO(s: XOState): string;
export declare function xoMakeMove(state: XOState, pos: number, playerNum: number): XOState | null;
//# sourceMappingURL=xo.d.ts.map