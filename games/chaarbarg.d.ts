export interface Card {
    suit: number;
    rank: number;
}
export interface ChaarBargState {
    p1: string;
    p2: string;
    turn: number;
    phase: number;
    p1Score: number;
    p2Score: number;
    hands: [Card[], Card[]];
    center: Card[];
    captures: [Card[], Card[]];
    drawPile: Card[];
    lastCapture: number;
    p1Surs: number;
    p2Surs: number;
    roundStarter: number;
}
export declare function parseChaarBarg(text: string): ChaarBargState | null;
export declare function serializeChaarBarg(s: ChaarBargState): string;
/** Get all valid capture combinations for a played card against center cards */
export declare function getCaptureCombinations(playedCard: Card, center: Card[]): Card[][];
/** Play a card. If captureIndices is provided, capture those center cards. Otherwise place on table. */
export declare function chaarBargPlayCard(state: ChaarBargState, playerNum: number, cardIndex: number, captureChoice: number): ChaarBargState | null;
/** Start a new round */
export declare function chaarBargStartRound(state: ChaarBargState): ChaarBargState;
/** Start a new round after roundOver */
export declare function chaarBargNewRound(state: ChaarBargState): ChaarBargState | null;
//# sourceMappingURL=chaarbarg.d.ts.map