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
}
export declare function parseHokm2(text: string): Hokm2State | null;
export declare function serializeHokm2(s: Hokm2State): string;
/** Initialize a new round (deal 5 cards to each, hakem selects trump) */
export declare function hokm2StartRound(state: Hokm2State): Hokm2State;
/** Hakem selects trump suit (1-4) */
export declare function hokm2SelectTrump(state: Hokm2State, playerNum: number, suit: number): Hokm2State | null;
/** Play a card */
export declare function hokm2PlayCard(state: Hokm2State, playerNum: number, cardIndex: number): Hokm2State | null;
/** Start a new round after roundOver */
export declare function hokm2NewRound(state: Hokm2State): Hokm2State | null;
//# sourceMappingURL=hokm2.d.ts.map