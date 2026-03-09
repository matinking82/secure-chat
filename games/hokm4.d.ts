export interface Card {
    suit: number;
    rank: number;
}
export interface Hokm4State {
    p1: string;
    p2: string;
    p3: string;
    p4: string;
    hakem: number;
    trump: number;
    turn: number;
    t1Tricks: number;
    t2Tricks: number;
    t1Score: number;
    t2Score: number;
    phase: number;
    hands: [Card[], Card[], Card[], Card[]];
    trick: Card[];
    trickPlayers: number[];
    leadSuit: number;
}
export declare function parseHokm4(text: string): Hokm4State | null;
export declare function serializeHokm4(s: Hokm4State): string;
export declare function hokm4StartRound(state: Hokm4State): Hokm4State;
export declare function hokm4SelectTrump(state: Hokm4State, playerNum: number, suit: number): Hokm4State | null;
export declare function hokm4PlayCard(state: Hokm4State, playerNum: number, cardIndex: number): Hokm4State | null;
export declare function hokm4NewRound(state: Hokm4State): Hokm4State | null;
/** Assign a player to an empty slot, return the player number (1-4) or 0 if failed */
export declare function hokm4JoinPlayer(state: Hokm4State, browserId: string): {
    state: Hokm4State;
    playerNum: number;
} | null;
/** Check if all 4 players have joined */
export declare function hokm4AllJoined(state: Hokm4State): boolean;
//# sourceMappingURL=hokm4.d.ts.map