"use strict";
// ─── Hokm 2-Player game logic (server-side) ───
// Format: GAME::HOKM2::{p1}:{p2}:{hakem}:{trump}:{turn}:{p1tricks}:{p2tricks}:{p1score}:{p2score}:{phase}:{hands}:{trick}:{leadSuit}
// hakem: 1 or 2 (who is hakem this round)
// trump: 0=none,1=spades,2=hearts,3=diamonds,4=clubs
// turn: 1 or 2
// p1tricks/p2tricks: tricks won this round (0-13)
// p1score/p2score: rounds won (match score, first to 7)
// phase: 0=waiting, 1=selectTrump, 2=playing, 3=roundOver, 4=matchOver
// hands: h1:[card,...];h2:[card,...] (each card is suitRank e.g. S14=Ace of Spades)
// trick: card1,card2 (cards played this trick)
// leadSuit: 0-4 suit of first card played in current trick
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseHokm2 = parseHokm2;
exports.serializeHokm2 = serializeHokm2;
exports.hokm2StartRound = hokm2StartRound;
exports.hokm2SelectTrump = hokm2SelectTrump;
exports.hokm2PlayCard = hokm2PlayCard;
exports.hokm2NewRound = hokm2NewRound;
const SUITS = ["", "S", "H", "D", "C"]; // 1=Spades,2=Hearts,3=Diamonds,4=Clubs
const SUIT_NAMES = ["", "Spades", "Hearts", "Diamonds", "Clubs"];
const RANK_ORDER = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]; // 11=J,12=Q,13=K,14=A
function cardToStr(c) {
    return `${SUITS[c.suit]}${c.rank}`;
}
function strToCard(s) {
    const suitChar = s[0];
    const suit = SUITS.indexOf(suitChar);
    const rank = parseInt(s.slice(1));
    return { suit, rank };
}
function encodeHands(hands) {
    const h1 = hands[0].map(cardToStr).join(",");
    const h2 = hands[1].map(cardToStr).join(",");
    return `${h1};${h2}`;
}
function decodeHands(s) {
    const parts = s.split(";");
    const h1 = parts[0] ? parts[0].split(",").filter(x => x).map(strToCard) : [];
    const h2 = parts[1] ? parts[1].split(",").filter(x => x).map(strToCard) : [];
    return [h1, h2];
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
function parseHokm2(text) {
    if (!text.startsWith("GAME::HOKM2::"))
        return null;
    const parts = text.slice("GAME::HOKM2::".length).split(":");
    if (parts.length < 12)
        return null;
    const hands = decodeHands(parts[9]);
    const { trick, trickPlayers } = decodeTrick(parts[10]);
    return {
        p1: parts[0],
        p2: parts[1],
        hakem: parseInt(parts[2]) || 1,
        trump: parseInt(parts[3]) || 0,
        turn: parseInt(parts[4]) || 1,
        p1Tricks: parseInt(parts[5]) || 0,
        p2Tricks: parseInt(parts[6]) || 0,
        p1Score: parseInt(parts[7]) || 0,
        p2Score: parseInt(parts[8]) || 0,
        phase: parseInt(parts[11]) || 0,
        hands,
        trick,
        trickPlayers,
        leadSuit: parseInt(parts[12]) || 0,
    };
}
function serializeHokm2(s) {
    return `GAME::HOKM2::${s.p1}:${s.p2}:${s.hakem}:${s.trump}:${s.turn}:${s.p1Tricks}:${s.p2Tricks}:${s.p1Score}:${s.p2Score}:${encodeHands(s.hands)}:${encodeTrick(s.trick, s.trickPlayers)}:${s.phase}:${s.leadSuit}`;
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
/** Initialize a new round (deal 5 cards to each, hakem selects trump) */
function hokm2StartRound(state) {
    const deck = shuffle(createDeck());
    // Deal only from 26 cards (2-player hokm uses 26 cards total - 13 each)
    const selected = deck.slice(0, 26);
    // Deal first 5 to each player
    const h1 = selected.slice(0, 5);
    const h2 = selected.slice(5, 10);
    // Store remaining 16 cards somehow - we'll pack them into a special encoding
    // Actually: deal 5 each first, then after trump: deal remaining 8 each
    // We need to store the undelt cards. Let's put them in the trick field temporarily
    // Better: store full hands as dealt but mark phase appropriately
    // Actually let's deal all 13 at once but hakem chooses trump after seeing first 5
    // For simplicity: deal all 13 now. Hakem sees first 5 to pick trump, then all are revealed.
    const p1Hand = selected.slice(0, 13);
    const p2Hand = selected.slice(13, 26);
    return {
        ...state,
        hands: [p1Hand, p2Hand],
        trick: [],
        trickPlayers: [],
        leadSuit: 0,
        p1Tricks: 0,
        p2Tricks: 0,
        turn: state.hakem,
        phase: 1, // selectTrump
        trump: 0,
    };
}
/** Hakem selects trump suit (1-4) */
function hokm2SelectTrump(state, playerNum, suit) {
    if (state.phase !== 1)
        return null;
    if (playerNum !== state.hakem)
        return null;
    if (suit < 1 || suit > 4)
        return null;
    return {
        ...state,
        trump: suit,
        phase: 2, // playing
        turn: state.hakem, // hakem leads first trick
    };
}
/** Play a card */
function hokm2PlayCard(state, playerNum, cardIndex) {
    if (state.phase !== 2)
        return null;
    if (state.turn !== playerNum)
        return null;
    const handIdx = playerNum - 1;
    const hand = state.hands[handIdx];
    if (cardIndex < 0 || cardIndex >= hand.length)
        return null;
    const card = hand[cardIndex];
    // If this is the second card in the trick, must follow suit if possible
    if (state.trick.length === 1) {
        const ledSuit = state.leadSuit;
        const hasSuit = hand.some(c => c.suit === ledSuit);
        if (hasSuit && card.suit !== ledSuit)
            return null; // must follow suit
    }
    // Remove card from hand
    const newHands = [
        [...state.hands[0]],
        [...state.hands[1]],
    ];
    newHands[handIdx] = hand.filter((_, i) => i !== cardIndex);
    const newTrick = [...state.trick, card];
    const newTrickPlayers = [...state.trickPlayers, playerNum];
    let newLeadSuit = state.leadSuit;
    // First card of trick sets lead suit
    if (state.trick.length === 0) {
        newLeadSuit = card.suit;
    }
    // If trick is complete (2 cards)
    if (newTrick.length === 2) {
        const winner = determineTrickWinner(newTrick, newTrickPlayers, newLeadSuit, state.trump);
        let p1Tricks = state.p1Tricks;
        let p2Tricks = state.p2Tricks;
        if (winner === 1)
            p1Tricks++;
        else
            p2Tricks++;
        // Check if round is over (someone reached 7 tricks)
        let phase = state.phase;
        let p1Score = state.p1Score;
        let p2Score = state.p2Score;
        let hakem = state.hakem;
        if (p1Tricks >= 7 || p2Tricks >= 7) {
            const roundWinner = p1Tricks >= 7 ? 1 : 2;
            const loserTricks = roundWinner === 1 ? p2Tricks : p1Tricks;
            // Score: 1 point normally, 2 for baagh (all 13 / opponent got 0)
            const points = loserTricks === 0 ? 2 : 1;
            if (roundWinner === 1)
                p1Score += points;
            else
                p2Score += points;
            // Check match over
            if (p1Score >= 7 || p2Score >= 7) {
                phase = 4; // matchOver
            }
            else {
                phase = 3; // roundOver
                // Winner becomes new hakem
                hakem = roundWinner;
            }
        }
        return {
            ...state,
            hands: newHands,
            trick: [],
            trickPlayers: [],
            leadSuit: 0,
            turn: winner, // winner leads next trick
            p1Tricks,
            p2Tricks,
            p1Score,
            p2Score,
            phase,
            hakem,
        };
    }
    // First card played, switch to other player
    const otherPlayer = playerNum === 1 ? 2 : 1;
    return {
        ...state,
        hands: newHands,
        trick: newTrick,
        trickPlayers: newTrickPlayers,
        leadSuit: newLeadSuit,
        turn: otherPlayer,
    };
}
function determineTrickWinner(trick, players, leadSuit, trump) {
    const [card1, card2] = trick;
    const [player1, player2] = players;
    // If both same suit
    if (card1.suit === card2.suit) {
        return card1.rank > card2.rank ? player1 : player2;
    }
    // If one is trump and other isn't
    if (card1.suit === trump && card2.suit !== trump)
        return player1;
    if (card2.suit === trump && card1.suit !== trump)
        return player2;
    // Both trump (handled by same suit above)
    // Neither is trump - card that followed the lead suit wins
    if (card1.suit === leadSuit)
        return player1;
    if (card2.suit === leadSuit)
        return player2;
    // Fallback (shouldn't happen)
    return player1;
}
/** Start a new round after roundOver */
function hokm2NewRound(state) {
    if (state.phase !== 3)
        return null;
    return hokm2StartRound(state);
}
//# sourceMappingURL=hokm2.js.map