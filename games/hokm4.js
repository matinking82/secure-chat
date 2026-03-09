"use strict";
// ─── Hokm 4-Player game logic (server-side) ───
// Format: GAME::HOKM4::{p1}:{p2}:{p3}:{p4}:{hakem}:{trump}:{turn}:{t1tricks}:{t2tricks}:{t1score}:{t2score}:{phase}:{hands}:{trick}:{leadSuit}
// Teams: Team1 = p1+p3 (opposite), Team2 = p2+p4 (opposite)
// hakem: 1-4 (which player is hakem)
// trump: 0=none,1=spades,2=hearts,3=diamonds,4=clubs
// turn: 1-4
// t1tricks/t2tricks: tricks won this round
// t1score/t2score: rounds won
// phase: 0=waiting,1=selectTrump,2=playing,3=roundOver,4=matchOver
// hands: h1;h2;h3;h4
// trick: playerCard,playerCard,...
// leadSuit: 0-4
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseHokm4 = parseHokm4;
exports.serializeHokm4 = serializeHokm4;
exports.hokm4StartRound = hokm4StartRound;
exports.hokm4SelectTrump = hokm4SelectTrump;
exports.hokm4PlayCard = hokm4PlayCard;
exports.hokm4NewRound = hokm4NewRound;
exports.hokm4JoinPlayer = hokm4JoinPlayer;
exports.hokm4AllJoined = hokm4AllJoined;
const SUITS = ["", "S", "H", "D", "C"];
const RANK_ORDER = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
function cardToStr(c) {
    return `${SUITS[c.suit]}${c.rank}`;
}
function strToCard(s) {
    const suit = SUITS.indexOf(s[0]);
    const rank = parseInt(s.slice(1));
    return { suit, rank };
}
function encodeHands4(hands) {
    return hands.map(h => h.map(cardToStr).join(",")).join(";");
}
function decodeHands4(s) {
    const parts = s.split(";");
    const result = [];
    for (let i = 0; i < 4; i++) {
        result.push(parts[i] ? parts[i].split(",").filter(x => x).map(strToCard) : []);
    }
    return result;
}
function encodeTrick(trick, players) {
    if (trick.length === 0)
        return "";
    return trick.map((c, i) => `${players[i]}${cardToStr(c)}`).join(",");
}
function decodeTrick(s) {
    if (!s)
        return { trick: [], trickPlayers: [] };
    const parts = s.split(",").filter(x => x);
    const trick = [];
    const trickPlayers = [];
    for (const p of parts) {
        trickPlayers.push(parseInt(p[0]));
        trick.push(strToCard(p.slice(1)));
    }
    return { trick, trickPlayers };
}
function getTeam(playerNum) {
    // p1(1), p3(3) = Team 1; p2(2), p4(4) = Team 2
    return playerNum % 2 === 1 ? 1 : 2;
}
function nextPlayerClockwise(current) {
    return current === 4 ? 1 : current + 1;
}
function parseHokm4(text) {
    if (!text.startsWith("GAME::HOKM4::"))
        return null;
    const parts = text.slice("GAME::HOKM4::".length).split(":");
    if (parts.length < 15)
        return null;
    const hands = decodeHands4(parts[11]);
    const { trick, trickPlayers } = decodeTrick(parts[12]);
    return {
        p1: parts[0],
        p2: parts[1],
        p3: parts[2],
        p4: parts[3],
        hakem: parseInt(parts[4]) || 1,
        trump: parseInt(parts[5]) || 0,
        turn: parseInt(parts[6]) || 1,
        t1Tricks: parseInt(parts[7]) || 0,
        t2Tricks: parseInt(parts[8]) || 0,
        t1Score: parseInt(parts[9]) || 0,
        t2Score: parseInt(parts[10]) || 0,
        phase: parseInt(parts[13]) || 0,
        hands,
        trick,
        trickPlayers,
        leadSuit: parseInt(parts[14]) || 0,
    };
}
function serializeHokm4(s) {
    return `GAME::HOKM4::${s.p1}:${s.p2}:${s.p3}:${s.p4}:${s.hakem}:${s.trump}:${s.turn}:${s.t1Tricks}:${s.t2Tricks}:${s.t1Score}:${s.t2Score}:${encodeHands4(s.hands)}:${encodeTrick(s.trick, s.trickPlayers)}:${s.phase}:${s.leadSuit}`;
}
function createDeck() {
    const deck = [];
    for (let suit = 1; suit <= 4; suit++) {
        for (const rank of RANK_ORDER) {
            deck.push({ suit, rank });
        }
    }
    return deck;
}
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
function hokm4StartRound(state) {
    const deck = shuffle(createDeck());
    // Deal 13 cards to each player
    const h1 = deck.slice(0, 13);
    const h2 = deck.slice(13, 26);
    const h3 = deck.slice(26, 39);
    const h4 = deck.slice(39, 52);
    return {
        ...state,
        hands: [h1, h2, h3, h4],
        trick: [],
        trickPlayers: [],
        leadSuit: 0,
        t1Tricks: 0,
        t2Tricks: 0,
        turn: state.hakem,
        phase: 1, // selectTrump
        trump: 0,
    };
}
function hokm4SelectTrump(state, playerNum, suit) {
    if (state.phase !== 1)
        return null;
    if (playerNum !== state.hakem)
        return null;
    if (suit < 1 || suit > 4)
        return null;
    return {
        ...state,
        trump: suit,
        phase: 2,
        turn: state.hakem, // hakem leads first trick
    };
}
function hokm4PlayCard(state, playerNum, cardIndex) {
    if (state.phase !== 2)
        return null;
    if (state.turn !== playerNum)
        return null;
    const handIdx = playerNum - 1;
    const hand = state.hands[handIdx];
    if (cardIndex < 0 || cardIndex >= hand.length)
        return null;
    const card = hand[cardIndex];
    // Must follow suit if possible (unless first card of trick)
    if (state.trick.length > 0) {
        const ledSuit = state.leadSuit;
        const hasSuit = hand.some(c => c.suit === ledSuit);
        if (hasSuit && card.suit !== ledSuit)
            return null;
    }
    // Remove card from hand
    const newHands = [
        [...state.hands[0]],
        [...state.hands[1]],
        [...state.hands[2]],
        [...state.hands[3]],
    ];
    newHands[handIdx] = hand.filter((_, i) => i !== cardIndex);
    const newTrick = [...state.trick, card];
    const newTrickPlayers = [...state.trickPlayers, playerNum];
    let newLeadSuit = state.leadSuit;
    if (state.trick.length === 0) {
        newLeadSuit = card.suit;
    }
    // Trick complete when 4 cards played
    if (newTrick.length === 4) {
        const winnerPlayer = determineTrickWinner4(newTrick, newTrickPlayers, newLeadSuit, state.trump);
        const winnerTeam = getTeam(winnerPlayer);
        let t1Tricks = state.t1Tricks;
        let t2Tricks = state.t2Tricks;
        if (winnerTeam === 1)
            t1Tricks++;
        else
            t2Tricks++;
        let phase = state.phase;
        let t1Score = state.t1Score;
        let t2Score = state.t2Score;
        let hakem = state.hakem;
        if (t1Tricks >= 7 || t2Tricks >= 7) {
            const roundWinnerTeam = t1Tricks >= 7 ? 1 : 2;
            const loserTricks = roundWinnerTeam === 1 ? t2Tricks : t1Tricks;
            const points = loserTricks === 0 ? 2 : 1; // baagh = 2 points
            if (roundWinnerTeam === 1)
                t1Score += points;
            else
                t2Score += points;
            if (t1Score >= 7 || t2Score >= 7) {
                phase = 4; // matchOver
            }
            else {
                phase = 3; // roundOver
                // Hakem transfer: if hakem's team lost, opponent team gets hakem
                const hakemTeam = getTeam(hakem);
                if (hakemTeam !== roundWinnerTeam) {
                    // Transfer to player right of previous hakem on winning team
                    hakem = nextPlayerClockwise(hakem);
                    // Make sure new hakem is on winning team
                    if (getTeam(hakem) !== roundWinnerTeam) {
                        hakem = nextPlayerClockwise(hakem);
                    }
                }
                // If hakem's team won, hakem stays
            }
        }
        return {
            ...state,
            hands: newHands,
            trick: [],
            trickPlayers: [],
            leadSuit: 0,
            turn: winnerPlayer,
            t1Tricks,
            t2Tricks,
            t1Score,
            t2Score,
            phase,
            hakem,
        };
    }
    // Next player clockwise
    return {
        ...state,
        hands: newHands,
        trick: newTrick,
        trickPlayers: newTrickPlayers,
        leadSuit: newLeadSuit,
        turn: nextPlayerClockwise(playerNum),
    };
}
function determineTrickWinner4(trick, players, leadSuit, trump) {
    let bestIdx = 0;
    for (let i = 1; i < trick.length; i++) {
        if (beats(trick[i], trick[bestIdx], leadSuit, trump)) {
            bestIdx = i;
        }
    }
    return players[bestIdx];
}
function beats(challenger, current, leadSuit, trump) {
    // Trump beats non-trump
    if (challenger.suit === trump && current.suit !== trump)
        return true;
    if (current.suit === trump && challenger.suit !== trump)
        return false;
    // Both trump: higher rank wins
    if (challenger.suit === trump && current.suit === trump) {
        return challenger.rank > current.rank;
    }
    // Neither trump: lead suit beats non-lead suit
    if (challenger.suit === leadSuit && current.suit !== leadSuit)
        return true;
    if (current.suit === leadSuit && challenger.suit !== leadSuit)
        return false;
    // Same suit: higher rank wins
    if (challenger.suit === current.suit) {
        return challenger.rank > current.rank;
    }
    // Different non-lead, non-trump suits -> current holds
    return false;
}
function hokm4NewRound(state) {
    if (state.phase !== 3)
        return null;
    return hokm4StartRound(state);
}
/** Assign a player to an empty slot, return the player number (1-4) or 0 if failed */
function hokm4JoinPlayer(state, browserId) {
    if (browserId === state.p1)
        return { state, playerNum: 1 };
    if (browserId === state.p2)
        return { state, playerNum: 2 };
    if (browserId === state.p3)
        return { state, playerNum: 3 };
    if (browserId === state.p4)
        return { state, playerNum: 4 };
    const newState = { ...state };
    if (state.p2 === "?") {
        newState.p2 = browserId;
        return { state: newState, playerNum: 2 };
    }
    if (state.p3 === "?") {
        newState.p3 = browserId;
        return { state: newState, playerNum: 3 };
    }
    if (state.p4 === "?") {
        newState.p4 = browserId;
        return { state: newState, playerNum: 4 };
    }
    return null; // all slots taken
}
/** Check if all 4 players have joined */
function hokm4AllJoined(state) {
    return state.p1 !== "?" && state.p2 !== "?" && state.p3 !== "?" && state.p4 !== "?";
}
//# sourceMappingURL=hokm4.js.map