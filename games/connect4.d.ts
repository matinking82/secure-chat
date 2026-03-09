export declare const C4_P1 = 1;
export declare const C4_P2 = 2;
export interface C4State {
    p1: string;
    p2: string;
    board: number[][];
    turn: number;
    winner: number;
}
export declare function parseC4(text: string): C4State | null;
export declare function serializeC4(s: C4State): string;
export declare function c4DropPiece(state: C4State, col: number, playerNum: number): C4State | null;
//# sourceMappingURL=connect4.d.ts.map