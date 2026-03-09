export interface OthelloState {
    p1: string;
    p2: string;
    board: number[][];
    turn: number;
    winner: number;
}
export declare function parseOthello(text: string): OthelloState | null;
export declare function serializeOthello(s: OthelloState): string;
export declare function othelloGetValidMoves(board: number[][], player: number): [number, number][];
export declare function othelloMakeMove(state: OthelloState, row: number, col: number, playerNum: number): OthelloState | null;
//# sourceMappingURL=othello.d.ts.map