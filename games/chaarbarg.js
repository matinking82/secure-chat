"use strict";
// ─── Chaar Barg / Yazdah (11) game logic (server-side) ───
// Capture card game: cards sum to 11, face cards match only, Jack sweeps numerics
// Format: GAME::CHAARBARG::{p1}:{p2}:{turn}:{phase}:{p1score}:{p2score}:{hands}:{center}:{captures}:{drawPile}:{lastCapture}:{surs}
// phase: 0=waiting,1=playing,2=roundOver,3=matchOver
// hands: h1;h2 (card lists)
// center: card list (face-up center cards)
// captures: c1;c2 (captured card lists per player)
// drawPile: remaining cards
// lastCapture: 1 or 2 (which player captured last)
// surs: s1,s2 (sur count per player)
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseChaarBarg = parseChaarBarg;
exports.serializeChaarBarg = serializeChaarBarg;
exports.getCaptureCombinations = getCaptureCombinations;
exports.chaarBargPlayCard = chaarBargPlayCard;
exports.chaarBargStartRound = chaarBargStartRound;
exports.chaarBargNewRound = chaarBargNewRound;
const SUITS = ["", "S", "H", "D", "C"];
function cardToStr(c) {
    return `${SUITS[c.suit]}${c.rank}`;
}
function strToCard(s) {
    const suit = SUITS.indexOf(s[0]);
    const rank = parseInt(s.slice(1));
    return { suit, rank };
}
function encodeCards(cards) {
    return cards.map(cardToStr).join(",");
}
function decodeCards(s) {
    if (!s)
        return [];
    return s.split(",").filter(x => x).map(strToCard);
}
function parseChaarBarg(text) {
    if (!text.startsWith("GAME::CHAARBARG::"))
        return null;
    const parts = text.slice("GAME::CHAARBARG::".length).split(":");
    if (parts.length < 12)
        return null;
    const handsParts = parts[6].split(";");
    const capturesParts = parts[8].split(";");
    const surParts = parts[11].split(",");
    return {
        p1: parts[0],
        p2: parts[1],
        turn: parseInt(parts[2]) || 1,
        phase: parseInt(parts[3]) || 0,
        p1Score: parseInt(parts[4]) || 0,
        p2Score: parseInt(parts[5]) || 0,
        hands: [
            decodeCards(handsParts[0] || ""),
            decodeCards(handsParts[1] || ""),
        ],
        center: decodeCards(parts[7]),
        captures: [
            decodeCards(capturesParts[0] || ""),
            decodeCards(capturesParts[1] || ""),
        ],
        drawPile: decodeCards(parts[9]),
        lastCapture: parseInt(parts[10]) || 0,
        p1Surs: parseInt(surParts[0]) || 0,
        p2Surs: parseInt(surParts[1]) || 0,
        roundStarter: parts[12] ? parseInt(parts[12]) || 1 : 1,
    };
}
function serializeChaarBarg(s) {
    const hands = `${encodeCards(s.hands[0])};${encodeCards(s.hands[1])}`;
    const captures = `${encodeCards(s.captures[0])};${encodeCards(s.captures[1])}`;
    const surs = `${s.p1Surs},${s.p2Surs}`;
    return `GAME::CHAARBARG::${s.p1}:${s.p2}:${s.turn}:${s.phase}:${s.p1Score}:${s.p2Score}:${hands}:${encodeCards(s.center)}:${captures}:${encodeCards(s.drawPile)}:${s.lastCapture}:${surs}:${s.roundStarter}`;
}
function createDeck() {
    const deck = [];
    for (let suit = 1; suit <= 4; suit++) {
        for (let rank = 1; rank <= 13; rank++) {
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
function getNumericValue(card) {
    // A=1, 2-10 face value, J/Q/K = special (not numeric for summing)
    if (card.rank >= 1 && card.rank <= 10)
        return card.rank;
    return 0; // face cards have no numeric value for summing
}
function isFaceCard(card) {
    return card.rank >= 11; // J=11, Q=12, K=13
}
function isJack(card) {
    return card.rank === 11;
}
/** Get all valid capture combinations for a played card against center cards */
function getCaptureCombinations(playedCard, center) {
    const results = [];
    if (isJack(playedCard)) {
        // Jack captures ALL cards except Kings and Queens
        const capturable = center.filter(c => c.rank !== 12 && c.rank !== 13);
        if (capturable.length > 0) {
            results.push(capturable);
        }
        return results;
    }
    if (isFaceCard(playedCard)) {
        // Q captures Q, K captures K only
        const matches = center.filter(c => c.rank === playedCard.rank);
        for (const m of matches) {
            results.push([m]);
        }
        return results;
    }
    // Numeric card (A-10): played card + captured cards must sum to 11
    const playedValue = getNumericValue(playedCard);
    if (playedValue === 0)
        return results;
    const targetSum = 11 - playedValue;
    // Get only numeric center cards for summing (face cards can't be captured by number cards)
    const numericCenter = center.filter(c => !isFaceCard(c));
    findSubsets(numericCenter, targetSum, 0, [], results);
    return results;
}
function findSubsets(cards, target, startIdx, current, results) {
    if (target === 0 && current.length > 0) {
        results.push([...current]);
        return;
    }
    if (target < 0 || startIdx >= cards.length)
        return;
    for (let i = startIdx; i < cards.length; i++) {
        const val = getNumericValue(cards[i]);
        if (val > 0) {
            current.push(cards[i]);
            findSubsets(cards, target - val, i + 1, current, results);
            current.pop();
        }
    }
}
/** Play a card. If captureIndices is provided, capture those center cards. Otherwise place on table. */
function chaarBargPlayCard(state, playerNum, cardIndex, captureChoice // index into getCaptureCombinations result, -1 = no capture (place on table)
) {
    if (state.phase !== 1)
        return null;
    if (state.turn !== playerNum)
        return null;
    const handIdx = playerNum - 1;
    const hand = state.hands[handIdx];
    if (cardIndex < 0 || cardIndex >= hand.length)
        return null;
    const playedCard = hand[cardIndex];
    // Jack cannot be played on empty table unless it's the only card in hand
    if (isJack(playedCard) && state.center.length === 0 && hand.length > 1) {
        return null;
    }
    const combinations = getCaptureCombinations(playedCard, state.center);
    // Remove card from hand
    const newHands = [[...state.hands[0]], [...state.hands[1]]];
    newHands[handIdx] = hand.filter((_, i) => i !== cardIndex);
    let newCenter = [...state.center];
    const newCaptures = [[...state.captures[0]], [...state.captures[1]]];
    let lastCapture = state.lastCapture;
    let p1Surs = state.p1Surs;
    let p2Surs = state.p2Surs;
    if (captureChoice >= 0 && captureChoice < combinations.length) {
        // Capture
        const captured = combinations[captureChoice];
        const capturedSet = new Set(captured.map(cardToStr));
        // Remove captured cards from center
        newCenter = newCenter.filter(c => !capturedSet.has(cardToStr(c)));
        // Add captured cards + played card to player's capture pile
        newCaptures[handIdx] = [...newCaptures[handIdx], playedCard, ...captured];
        lastCapture = playerNum;
        // Check for Sur (table cleared, not by Jack, not in last round)
        if (newCenter.length === 0 && !isJack(playedCard) && state.drawPile.length > 0) {
            if (playerNum === 1)
                p1Surs++;
            else
                p2Surs++;
        }
    }
    else {
        // No capture - place card on center
        newCenter.push(playedCard);
    }
    // Switch turn
    const nextTurn = playerNum === 1 ? 2 : 1;
    // Check if both hands empty - need to deal more or end round
    let newDrawPile = [...state.drawPile];
    let phase = state.phase;
    if (newHands[0].length === 0 && newHands[1].length === 0) {
        if (newDrawPile.length > 0) {
            // Deal 4 more cards to each
            const deal1 = newDrawPile.splice(0, Math.min(4, newDrawPile.length));
            const deal2 = newDrawPile.splice(0, Math.min(4, newDrawPile.length));
            newHands[0] = deal1;
            newHands[1] = deal2;
        }
        else {
            // Round over - last capturer takes remaining center cards
            if (newCenter.length > 0 && lastCapture > 0) {
                newCaptures[lastCapture - 1] = [...newCaptures[lastCapture - 1], ...newCenter];
                newCenter = [];
                // This final sweep does NOT count as Sur
            }
            phase = 2; // roundOver
        }
    }
    const newState = {
        ...state,
        hands: newHands,
        center: newCenter,
        captures: newCaptures,
        drawPile: newDrawPile,
        lastCapture,
        turn: nextTurn,
        phase,
        p1Surs,
        p2Surs,
    };
    // If round over, calculate scores
    if (phase === 2) {
        return calculateRoundScores(newState);
    }
    return newState;
}
function calculateRoundScores(state) {
    let p1Points = 0;
    let p2Points = 0;
    for (let pIdx = 0; pIdx < 2; pIdx++) {
        const pile = state.captures[pIdx];
        let points = 0;
        for (const card of pile) {
            // Each Ace = 1 point
            if (card.rank === 1)
                points += 1;
            // Each Jack = 1 point
            if (card.rank === 11)
                points += 1;
            // 2 of Clubs (suit 4) = 2 points
            if (card.rank === 2 && card.suit === 4)
                points += 2;
            // 10 of Diamonds (suit 3) = 3 points
            if (card.rank === 10 && card.suit === 3)
                points += 3;
        }
        // Sur points (5 each)
        if (pIdx === 0)
            points += state.p1Surs * 5;
        else
            points += state.p2Surs * 5;
        if (pIdx === 0)
            p1Points = points;
        else
            p2Points = points;
    }
    // Most Clubs = 7 points (suit 4 = Clubs)
    const p1Clubs = state.captures[0].filter(c => c.suit === 4).length;
    const p2Clubs = state.captures[1].filter(c => c.suit === 4).length;
    if (p1Clubs > p2Clubs)
        p1Points += 7;
    else if (p2Clubs > p1Clubs)
        p2Points += 7;
    // tie = no bonus
    const newP1Score = state.p1Score + p1Points;
    const newP2Score = state.p2Score + p2Points;
    // Check match over (target 62)
    let phase = state.phase;
    if (newP1Score >= 62 || newP2Score >= 62) {
        phase = 3; // matchOver
    }
    return {
        ...state,
        p1Score: newP1Score,
        p2Score: newP2Score,
        phase,
    };
}
/** Start a new round */
function chaarBargStartRound(state) {
    const deck = shuffle(createDeck());
    // Deal 4 to each player, 4 to center
    const h1 = deck.slice(0, 4);
    const h2 = deck.slice(4, 8);
    const center = deck.slice(8, 12);
    const drawPile = deck.slice(12);
    return {
        ...state,
        hands: [h1, h2],
        center,
        captures: [[], []],
        drawPile,
        turn: state.roundStarter || 1,
        phase: 1,
        lastCapture: 0,
        p1Surs: 0,
        p2Surs: 0,
    };
}
/** Start a new round after roundOver */
function chaarBargNewRound(state) {
    if (state.phase !== 2)
        return null;
    // Alternate the starting player each round
    const nextStarter = (state.roundStarter || 1) === 1 ? 2 : 1;
    return chaarBargStartRound({ ...state, roundStarter: nextStarter });
}
//# sourceMappingURL=chaarbarg.js.map