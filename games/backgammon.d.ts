export interface BackgammonState {
    p1: string;
    p2: string;
    points: {
        color: string;
        count: number;
    }[];
    turn: number;
    dice: number[];
    barWhite: number;
    barBlack: number;
    offWhite: number;
    offBlack: number;
    winner: number;
    remainingMoves: number[];
}
export declare function parseBackgammon(text: string): BackgammonState | null;
export declare function serializeBackgammon(s: BackgammonState): string;
export declare function backgammonGetValidMoves(state: BackgammonState, playerNum: number, dieValue: number): {
    from: number;
    to: number;
}[];
export declare function backgammonRollDice(state: BackgammonState, playerNum: number): BackgammonState | null;
export declare function backgammonApplyMove(state: BackgammonState, from: number, to: number, playerNum: number): BackgammonState | null;
//# sourceMappingURL=backgammon.d.ts.map