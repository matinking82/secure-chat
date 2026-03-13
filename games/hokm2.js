"use strict";
// ─── Hokm 2-Player game logic (server-side) ───
// Format: GAME::HOKM2::{p1}:{p2}:{hakem}:{trump}:{turn}:{p1tricks}:{p2tricks}:{p1score}:{p2score}:{hands}:{trick}:{phase}:{leadSuit}:{drawPile}:{drawnCard}:{hakemDiscardCount}
// hakem: 1 or 2 (who is hakem this round)
// trump: 0=none,1=spades,2=hearts,3=diamonds,4=clubs
// turn: 1 or 2
// p1tricks/p2tricks: tricks won this round (0-13)
// p1score/p2score: rounds won (match score, first to 7)
// phase: 0=waiting, 1=selectTrump, 2=playing, 3=roundOver, 4=matchOver,
//        5=discardHakem, 6=discardOther, 7=drawPhase
// hands: h1:[card,...];h2:[card,...] (each card is suitRank e.g. S14=Ace of Spades)
// trick: card1,card2 (cards played this trick)
// leadSuit: 0-4 suit of first card played in current trick
// drawPile: card1,card2,... (remaining undealt cards)
// drawnCard: card or empty (the card revealed from draw pile for current player to accept/refuse)
// hakemDiscardCount: 0,2,3 (how many cards hakem discarded)
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseHokm2 = parseHokm2;
exports.serializeHokm2 = serializeHokm2;
exports.hokm2StartRound = hokm2StartRound;
exports.hokm2SelectTrump = hokm2SelectTrump;
exports.hokm2DiscardCards = hokm2DiscardCards;
exports.hokm2DrawCard = hokm2DrawCard;
exports.hokm2PlayCard = hokm2PlayCard;
exports.hokm2NewRound = hokm2NewRound;
const SUITS = ["", "S", "H", "D", "C"]; // 1=Spades,2=Hearts,3=Diamonds,4=Clubs
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
function encodeCardList(cards) {
    return cards.map(cardToStr).join(",");
}
function decodeCardList(s) {
    if (!s)
        return [];
    return s.split(",").filter(x => x).map(strToCard);
}
function parseHokm2(text) {
    if (!text.startsWith("GAME::HOKM2::"))
        return null;
    const parts = text.slice("GAME::HOKM2::".length).split(":");
    if (parts.length < 12)
        return null;
    const hands = decodeHands(parts[9]);
    const { trick, trickPlayers } = decodeTrick(parts[10]);
    // Parse new fields (backward compatible)
    const drawPile = parts.length > 13 ? decodeCardList(parts[13]) : [];
    const drawnCard = parts.length > 14 && parts[14] ? strToCard(parts[14]) : null;
    const hakemDiscardCount = parts.length > 15 ? (parseInt(parts[15]) || 0) : 0;
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
        drawPile,
        drawnCard,
        hakemDiscardCount,
    };
}
function serializeHokm2(s) {
    const drawnStr = s.drawnCard ? cardToStr(s.drawnCard) : "";
    return `GAME::HOKM2::${s.p1}:${s.p2}:${s.hakem}:${s.trump}:${s.turn}:${s.p1Tricks}:${s.p2Tricks}:${s.p1Score}:${s.p2Score}:${encodeHands(s.hands)}:${encodeTrick(s.trick, s.trickPlayers)}:${s.phase}:${s.leadSuit}:${encodeCardList(s.drawPile)}:${drawnStr}:${s.hakemDiscardCount}`;
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
/** Initialize a new round: deal 5 cards to each, rest goes to draw pile. Hakem selects trump. */
function hokm2StartRound(state) {
    const deck = shuffle(createDeck());
    // Use all 52 cards; deal 5 to each, rest is draw pile
    const h1 = deck.slice(0, 5);
    const h2 = deck.slice(5, 10);
    // Remaining 42 cards go to draw pile
    const drawPile = deck.slice(10);
    return {
        ...state,
        hands: [h1, h2],
        trick: [],
        trickPlayers: [],
        leadSuit: 0,
        p1Tricks: 0,
        p2Tricks: 0,
        turn: state.hakem,
        phase: 1, // selectTrump
        trump: 0,
        drawPile,
        drawnCard: null,
        hakemDiscardCount: 0,
    };
}
/** Hakem selects trump suit (1-4), then moves to discard phase */
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
        phase: 5, // discardHakem
        turn: state.hakem,
    };
}
/** Hakem discards 2 or 3 cards from their 5-card hand */
function hokm2DiscardCards(state, playerNum, cardIndices) {
    if (state.phase === 5) {
        // Hakem discarding
        if (playerNum !== state.hakem)
            return null;
        if (cardIndices.length !== 2 && cardIndices.length !== 3)
            return null;
        const handIdx = playerNum - 1;
        const hand = state.hands[handIdx];
        // Validate indices
        const uniqueIndices = [...new Set(cardIndices)].sort((a, b) => b - a);
        if (uniqueIndices.length !== cardIndices.length)
            return null;
        for (const idx of uniqueIndices) {
            if (idx < 0 || idx >= hand.length)
                return null;
        }
        // Remove discarded cards from hand
        const newHand = [...hand];
        for (const idx of uniqueIndices) {
            newHand.splice(idx, 1);
        }
        const newHands = [...state.hands];
        newHands[handIdx] = newHand;
        const otherPlayer = state.hakem === 1 ? 2 : 1;
        return {
            ...state,
            hands: newHands,
            hakemDiscardCount: cardIndices.length,
            phase: 6, // discardOther
            turn: otherPlayer,
        };
    }
    else if (state.phase === 6) {
        // Other player discarding
        const otherPlayer = state.hakem === 1 ? 2 : 1;
        if (playerNum !== otherPlayer)
            return null;
        // Other player must discard complementary amount
        const requiredDiscard = state.hakemDiscardCount === 2 ? 3 : 2;
        if (cardIndices.length !== requiredDiscard)
            return null;
        const handIdx = playerNum - 1;
        const hand = state.hands[handIdx];
        const uniqueIndices = [...new Set(cardIndices)].sort((a, b) => b - a);
        if (uniqueIndices.length !== cardIndices.length)
            return null;
        for (const idx of uniqueIndices) {
            if (idx < 0 || idx >= hand.length)
                return null;
        }
        const newHand = [...hand];
        for (const idx of uniqueIndices) {
            newHand.splice(idx, 1);
        }
        const newHands = [...state.hands];
        newHands[handIdx] = newHand;
        // Determine who starts draw phase: the player who has 2 cards (discarded 3)
        let drawStarter;
        if (state.hakemDiscardCount === 3) {
            drawStarter = state.hakem; // hakem discarded 3, has 2 cards
        }
        else {
            drawStarter = otherPlayer; // other player discarded 3, has 2 cards
        }
        // Reveal top card for the draw starter
        const drawPile = [...state.drawPile];
        let drawnCard = null;
        if (drawPile.length > 0) {
            drawnCard = drawPile.shift();
        }
        return {
            ...state,
            hands: newHands,
            phase: 7, // drawPhase
            turn: drawStarter,
            drawPile,
            drawnCard,
        };
    }
    return null;
}
/** Draw phase: player accepts or refuses the shown top card */
function hokm2DrawCard(state, playerNum, accept) {
    if (state.phase !== 7)
        return null;
    if (playerNum !== state.turn)
        return null;
    if (!state.drawnCard)
        return null;
    const handIdx = playerNum - 1;
    const newHands = [
        [...state.hands[0]],
        [...state.hands[1]],
    ];
    const drawPile = [...state.drawPile];
    if (accept) {
        // Player accepts the shown card → add to their hand
        newHands[handIdx].push(state.drawnCard);
        // Next card from draw pile is discarded (unseen)
        if (drawPile.length > 0) {
            drawPile.shift(); // discard unseen
        }
    }
    else {
        // Player refuses → next card from draw pile goes to their hand
        if (drawPile.length > 0) {
            const nextCard = drawPile.shift();
            newHands[handIdx].push(nextCard);
        }
        else {
            // No more cards to draw, the shown card is added instead
            newHands[handIdx].push(state.drawnCard);
        }
    }
    // Switch to next player
    const otherPlayer = playerNum === 1 ? 2 : 1;
    // Check if draw pile is empty (no more cards to reveal)
    if (drawPile.length === 0) {
        // Draw phase complete, move to playing
        return {
            ...state,
            hands: newHands,
            drawPile: [],
            drawnCard: null,
            phase: 2, // playing
            turn: state.hakem, // hakem leads first trick
        };
    }
    // Reveal next card for the other player
    const nextDrawn = drawPile.shift();
    // Check again if pile is now empty after revealing
    return {
        ...state,
        hands: newHands,
        drawPile,
        drawnCard: nextDrawn,
        turn: otherPlayer,
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