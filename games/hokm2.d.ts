export interface Card {
    suit: number;
    rank: number;
}
export interface Hokm2State {
    p1: string;
    p2: string;
    hakem: number;
    trump: number;
    turn: number;
    p1Tricks: number;
    p2Tricks: number;
    p1Score: number;
    p2Score: number;
    phase: number;
    hands: [Card[], Card[]];
    trick: Card[];
    trickPlayers: number[];
    leadSuit: number;
    drawPile: Card[];
    drawnCard: Card | null;
    hakemDiscardCount: number;
}
export declare function parseHokm2(text: string): Hokm2State | null;
export declare function serializeHokm2(s: Hokm2State): string;
/** Initialize a new round: deal 5 cards to each, rest goes to draw pile. Hakem selects trump. */
export declare function hokm2StartRound(state: Hokm2State): Hokm2State;
/** Hakem selects trump suit (1-4), then moves to discard phase */
export declare function hokm2SelectTrump(state: Hokm2State, playerNum: number, suit: number): Hokm2State | null;
/** Hakem discards 2 or 3 cards from their 5-card hand */
export declare function hokm2DiscardCards(state: Hokm2State, playerNum: number, cardIndices: number[]): Hokm2State | null;
/** Draw phase: player accepts or refuses the shown top card */
export declare function hokm2DrawCard(state: Hokm2State, playerNum: number, accept: boolean): Hokm2State | null;
/** Play a card */
export declare function hokm2PlayCard(state: Hokm2State, playerNum: number, cardIndex: number): Hokm2State | null;
/** Start a new round after roundOver */
export declare function hokm2NewRound(state: Hokm2State): Hokm2State | null;
//# sourceMappingURL=hokm2.d.ts.map