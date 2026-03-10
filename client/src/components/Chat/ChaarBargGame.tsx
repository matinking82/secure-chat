import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { getBrowserId } from "../../lib/storage";
import { useChat } from "../../contexts/ChatContext";
import CardSvg, { useCardPreloader } from "./CardSvg";

// ─── Types ───

export interface Card {
    suit: number; // 1-4
    rank: number; // 1-13 (1=Ace,11=J,12=Q,13=K)
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

const SUITS = ["", "S", "H", "D", "C"];

function cardToStr(c: Card): string {
    return `${SUITS[c.suit]}${c.rank}`;
}

function strToCard(s: string): Card {
    const suit = SUITS.indexOf(s[0]);
    const rank = parseInt(s.slice(1));
    return { suit, rank };
}

function decodeCards(s: string): Card[] {
    if (!s) return [];
    return s.split(",").filter(x => x).map(strToCard);
}

function isFaceCard(card: Card): boolean {
    return card.rank >= 11;
}

function isJack(card: Card): boolean {
    return card.rank === 11;
}

function getNumericValue(card: Card): number {
    if (card.rank >= 1 && card.rank <= 10) return card.rank;
    return 0;
}

/** Get capture combinations for a card */
function getCaptureCombinations(playedCard: Card, center: Card[]): Card[][] {
    const results: Card[][] = [];

    if (isJack(playedCard)) {
        // Jack captures ALL cards except Kings and Queens
        const capturable = center.filter(c => c.rank !== 12 && c.rank !== 13);
        if (capturable.length > 0) results.push(capturable);
        return results;
    }

    if (isFaceCard(playedCard)) {
        const matches = center.filter(c => c.rank === playedCard.rank);
        for (const m of matches) results.push([m]);
        return results;
    }

    // Numeric card (A-10): played card + captured cards must sum to 11
    const playedValue = getNumericValue(playedCard);
    if (playedValue === 0) return results;

    const targetSum = 11 - playedValue;
    const numericCenter = center.filter(c => !isFaceCard(c));
    findSubsets(numericCenter, targetSum, 0, [], results);
    return results;
}

function findSubsets(cards: Card[], target: number, startIdx: number, current: Card[], results: Card[][]): void {
    if (target === 0 && current.length > 0) {
        results.push([...current]);
        return;
    }
    if (target < 0 || startIdx >= cards.length) return;
    for (let i = startIdx; i < cards.length; i++) {
        const val = getNumericValue(cards[i]);
        if (val > 0) {
            current.push(cards[i]);
            findSubsets(cards, target - val, i + 1, current, results);
            current.pop();
        }
    }
}

/** Create a fresh ChaarBarg game */
export function createChaarBarg(initiatorBrowserId: string): string {
    return `GAME::CHAARBARG::${initiatorBrowserId}:?:1:0:0:0:;::;::0:0,0:1`;
}

export function isChaarBargMessage(text: string): boolean {
    return text.startsWith("GAME::CHAARBARG::");
}

export function parseChaarBarg(text: string): ChaarBargState | null {
    if (!isChaarBargMessage(text)) return null;
    const parts = text.slice("GAME::CHAARBARG::".length).split(":");
    if (parts.length < 12) return null;

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

// ─── Component ───

interface ChaarBargGameProps {
    gameState: ChaarBargState;
    messageId: number;
    chatId: string;
}

export default function ChaarBargGame({ gameState, messageId, chatId }: ChaarBargGameProps) {
    const myBrowserId = getBrowserId();
    const { socket } = useChat();
    const [selectedHandCard, setSelectedHandCard] = useState<number | null>(null);
    const [selectedTableCards, setSelectedTableCards] = useState<Set<number>>(new Set());
    useCardPreloader();

    // ─── Capture display: show played card + captured cards until next player plays ───
    const prevStateRef = useRef<{ center: Card[]; captures: [Card[], Card[]]; turn: number } | null>(null);
    const [captureDisplay, setCaptureDisplay] = useState<{ playedCard: Card; capturedCards: Card[]; player: number } | null>(null);

    useEffect(() => {
        const prev = prevStateRef.current;
        if (prev && gameState.phase === 1) {
            // Check if turn changed (a move was made)
            if (prev.turn !== gameState.turn) {
                // The player who just moved is prev.turn
                const prevPlayer = prev.turn;
                const prevCaptureCount = prev.captures[prevPlayer - 1].length;
                const newCaptureCount = gameState.captures[prevPlayer - 1].length;

                if (newCaptureCount > prevCaptureCount) {
                    // Capture happened — find which cards were captured
                    const newlyCaptured = gameState.captures[prevPlayer - 1].slice(prevCaptureCount);
                    const prevCenterStrs = new Set(prev.center.map(cardToStr));
                    const playedCard = newlyCaptured.find(c => !prevCenterStrs.has(cardToStr(c)));
                    const capturedFromCenter = newlyCaptured.filter(c => prevCenterStrs.has(cardToStr(c)));

                    if (playedCard && capturedFromCenter.length > 0) {
                        setCaptureDisplay({ playedCard, capturedCards: capturedFromCenter, player: prevPlayer });
                    } else {
                        setCaptureDisplay(null);
                    }
                } else {
                    // No capture — clear any existing display
                    setCaptureDisplay(null);
                }
            }
        }
        prevStateRef.current = {
            center: [...gameState.center],
            captures: [[...gameState.captures[0]], [...gameState.captures[1]]],
            turn: gameState.turn,
        };
    }, [gameState.center, gameState.captures, gameState.turn, gameState.phase]);

    const myPlayerNum = (() => {
        if (myBrowserId === gameState.p1) return 1;
        if (myBrowserId === gameState.p2) return 2;
        if (gameState.p2 === "?" && myBrowserId !== gameState.p1) return 2;
        return 0;
    })();

    const isMyTurn = gameState.turn === myPlayerNum && gameState.phase === 1;
    const myHand = myPlayerNum > 0 ? gameState.hands[myPlayerNum - 1] : [];

    // Compute capture combinations for selected hand card
    const captureCombinations = useMemo(() => {
        if (selectedHandCard === null || selectedHandCard >= myHand.length) return [];
        return getCaptureCombinations(myHand[selectedHandCard], gameState.center);
    }, [selectedHandCard, myHand, gameState.center]);

    // Check if selected card is a Jack that can't be played on empty table
    const isJackBlocked = useMemo(() => {
        if (selectedHandCard === null || selectedHandCard >= myHand.length) return false;
        const card = myHand[selectedHandCard];
        return isJack(card) && gameState.center.length === 0 && myHand.length > 1;
    }, [selectedHandCard, myHand, gameState.center]);

    // Check if selected card is a Jack with capturable cards (auto-capture, can't place)
    const isJackWithCapture = useMemo(() => {
        if (selectedHandCard === null || selectedHandCard >= myHand.length) return false;
        const card = myHand[selectedHandCard];
        return isJack(card) && captureCombinations.length > 0;
    }, [selectedHandCard, myHand, captureCombinations]);

    // Check if selected table cards match a valid capture combination
    const matchingCaptureIdx = useMemo(() => {
        if (selectedHandCard === null || selectedTableCards.size === 0) return -1;
        const selectedSet = new Set(
            Array.from(selectedTableCards).map(i => cardToStr(gameState.center[i]))
        );
        for (let ci = 0; ci < captureCombinations.length; ci++) {
            const comboSet = new Set(captureCombinations[ci].map(cardToStr));
            if (comboSet.size === selectedSet.size && [...comboSet].every(c => selectedSet.has(c))) {
                return ci;
            }
        }
        return -1;
    }, [selectedHandCard, selectedTableCards, captureCombinations, gameState.center]);

    const handleHandCardClick = useCallback((index: number) => {
        if (!isMyTurn) return;
        if (selectedHandCard === index) {
            // Double-tap: play without capture
            const card = myHand[index];
            // Jack with capturable cards on table → auto-capture instead
            if (isJack(card) && captureCombinations.length > 0) {
                socket?.emit("chaarbarg_play", {
                    chatId, messageId,
                    cardIndex: index,
                    captureChoice: 0,
                    browserId: myBrowserId,
                });
            } else if (!(isJack(card) && gameState.center.length === 0 && myHand.length > 1)) {
                // Place on table (unless Jack blocked)
                socket?.emit("chaarbarg_play", {
                    chatId, messageId,
                    cardIndex: index,
                    captureChoice: -1,
                    browserId: myBrowserId,
                });
            }
            setSelectedHandCard(null);
            setSelectedTableCards(new Set());
        } else {
            setSelectedHandCard(index);
            setSelectedTableCards(new Set());
        }
    }, [isMyTurn, selectedHandCard, myHand, captureCombinations, gameState.center, socket, chatId, messageId, myBrowserId]);

    const handleTableCardClick = useCallback((index: number) => {
        if (!isMyTurn || selectedHandCard === null || isJackBlocked) return;
        const card = myHand[selectedHandCard];
        // Jack auto-captures, no table selection needed
        if (isJack(card)) return;

        setSelectedTableCards(prev => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
        });
    }, [isMyTurn, selectedHandCard, isJackBlocked, myHand]);

    const handleCapture = useCallback(() => {
        if (selectedHandCard === null || matchingCaptureIdx < 0) return;
        socket?.emit("chaarbarg_play", {
            chatId, messageId,
            cardIndex: selectedHandCard,
            captureChoice: matchingCaptureIdx,
            browserId: myBrowserId,
        });
        setSelectedHandCard(null);
        setSelectedTableCards(new Set());
    }, [selectedHandCard, matchingCaptureIdx, socket, chatId, messageId, myBrowserId]);

    const handleNewRound = () => {
        socket?.emit("chaarbarg_newround", { chatId, messageId, browserId: myBrowserId });
    };

    const handleJoin = () => {
        socket?.emit("chaarbarg_join", { chatId, messageId, browserId: myBrowserId });
    };

    // Count clubs for each player
    const p1Clubs = gameState.captures[0].filter(c => c.suit === 4).length;
    const p2Clubs = gameState.captures[1].filter(c => c.suit === 4).length;

    // Status
    let statusText = "";
    let statusColor = "text-gray-400";

    if (gameState.phase === 0) {
        statusText = gameState.p2 === "?" ? (myPlayerNum === 1 ? "⏳ Waiting for opponent..." : "🎮 Tap Join to play!") : "Starting...";
    } else if (gameState.phase === 1) {
        if (isMyTurn) {
            if (isJackBlocked) {
                statusText = "🚫 Can't play Jack on empty table — pick another card";
                statusColor = "text-orange-400";
            } else if (selectedHandCard === null) {
                statusText = "🃏 Your turn — select a card";
                statusColor = "text-green-400";
            } else if (isJackWithCapture) {
                statusText = "🃏 Tap Jack again to capture all";
                statusColor = "text-green-400";
            } else if (captureCombinations.length > 0) {
                statusText = matchingCaptureIdx >= 0
                    ? "✅ Valid capture! Tap Capture button"
                    : "Select table cards that sum to 11 with your card";
                statusColor = matchingCaptureIdx >= 0 ? "text-green-400" : "text-yellow-400";
            } else {
                statusText = "No captures — tap your card again to place on table";
                statusColor = "text-green-400";
            }
        } else {
            statusText = "⏳ Opponent's turn...";
        }
    } else if (gameState.phase === 2) {
        const p1Pts = gameState.p1Score;
        const p2Pts = gameState.p2Score;
        if (myPlayerNum === 1) {
            statusText = p1Pts > p2Pts ? "🏆 You won this round!" : p1Pts < p2Pts ? "Round over — opponent leads" : "Round over — tie!";
        } else {
            statusText = p2Pts > p1Pts ? "🏆 You won this round!" : p2Pts < p1Pts ? "Round over — opponent leads" : "Round over — tie!";
        }
        statusColor = "text-yellow-400";
    } else if (gameState.phase === 3) {
        const winner = gameState.p1Score >= 62 ? 1 : 2;
        statusText = winner === myPlayerNum ? "🏆🏆 You won the match!" : "Match over — opponent wins";
        statusColor = winner === myPlayerNum ? "text-yellow-400" : "text-red-400";
    }

    return (
        <div className="select-none max-w-sm">
            {/* Header */}
            <div className="text-center mb-3">
                <div className="text-sm font-bold tracking-wide text-gray-300 mb-1">
                    🃏 چهاربرگ — Chaar Barg
                </div>
                <div className="flex items-center justify-center gap-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                        <span className="text-blue-400 font-bold">P1</span>
                        {gameState.p1 === myBrowserId ? " (You)" : ""}
                    </span>
                    <span className="text-gray-600 font-semibold">vs</span>
                    <span className="flex items-center gap-1">
                        <span className="text-red-400 font-bold">P2</span>
                        {gameState.p2 === "?" ? " ???" : gameState.p2 === myBrowserId ? " (You)" : ""}
                    </span>
                </div>
            </div>

            {/* Scores */}
            <div className="flex justify-center gap-3 mb-3 text-xs">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl" style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.2)" }}>
                    <span className="text-blue-400 font-semibold">P1</span>
                    <span className="text-white font-bold text-sm">{gameState.p1Score}</span>
                    <span className="text-gray-500">pts</span>
                    <span className="text-gray-600 mx-0.5">·</span>
                    <span className="text-blue-300 font-bold">{gameState.p1Surs}</span>
                    <span className="text-gray-500">surs</span>
                    <span className="text-gray-600 mx-0.5">·</span>
                    <span className="text-blue-300">♣{p1Clubs}</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl" style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <span className="text-red-400 font-semibold">P2</span>
                    <span className="text-white font-bold text-sm">{gameState.p2Score}</span>
                    <span className="text-gray-500">pts</span>
                    <span className="text-gray-600 mx-0.5">·</span>
                    <span className="text-red-300 font-bold">{gameState.p2Surs}</span>
                    <span className="text-gray-500">surs</span>
                    <span className="text-gray-600 mx-0.5">·</span>
                    <span className="text-red-300">♣{p2Clubs}</span>
                </div>
            </div>

            {/* Join button */}
            {gameState.phase === 0 && gameState.p2 === "?" && myPlayerNum !== 1 && (
                <div className="flex justify-center mb-3">
                    <button
                        onClick={handleJoin}
                        className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:scale-105 active:scale-95 shadow-lg"
                        style={{ background: "linear-gradient(135deg, #22c55e, #16a34a)" }}
                    >
                        🎮 Join Game
                    </button>
                </div>
            )}

            {/* Capture display banner */}
            {captureDisplay && gameState.phase === 1 && (
                <div className="mb-3 px-3 py-2 rounded-xl" style={{ background: "rgba(250,204,21,0.08)", border: "1px solid rgba(250,204,21,0.2)" }}>
                    <div className="text-[10px] text-yellow-400 text-center mb-1 font-semibold">
                        P{captureDisplay.player} captured:
                    </div>
                    <div className="flex flex-wrap justify-center items-center gap-1">
                        <CardSvg
                            suit={captureDisplay.playedCard.suit}
                            rank={captureDisplay.playedCard.rank}
                            variant="chaarbarg"
                            width={36}
                            height={52}
                            disabled
                            highlight
                        />
                        <span className="text-yellow-400 text-sm font-bold mx-1">→</span>
                        {captureDisplay.capturedCards.map((card, i) => (
                            <CardSvg
                                key={`cap-${cardToStr(card)}-${i}`}
                                suit={card.suit}
                                rank={card.rank}
                                variant="chaarbarg"
                                width={36}
                                height={52}
                                disabled
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Center table */}
            {gameState.phase === 1 && (
                <div className="mb-3">
                    <div className="text-[10px] text-gray-500 text-center mb-1 font-medium">
                        Center Table ({gameState.center.length} cards) · Draw pile: {gameState.drawPile.length}
                    </div>
                    <div className="flex flex-wrap justify-center gap-1 min-h-[70px] px-3 py-2 rounded-xl"
                        style={{ background: "rgba(0,60,30,0.25)", border: "1px solid rgba(74,222,128,0.12)" }}>
                        {gameState.center.length === 0 ? (
                            <div className="text-xs text-gray-600 italic flex items-center">Empty table</div>
                        ) : (
                            gameState.center.map((card, i) => (
                                <CardSvg
                                    key={`c-${cardToStr(card)}-${i}`}
                                    suit={card.suit}
                                    rank={card.rank}
                                    variant="chaarbarg"
                                    width={40}
                                    height={58}
                                    selected={selectedTableCards.has(i)}
                                    onClick={() => handleTableCardClick(i)}
                                    disabled={!isMyTurn || selectedHandCard === null || isJackBlocked || (selectedHandCard !== null && isJack(myHand[selectedHandCard]))}
                                />
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* Capture button */}
            {isMyTurn && selectedHandCard !== null && !isJackBlocked && matchingCaptureIdx >= 0 && (
                <div className="flex justify-center mb-3">
                    <button
                        onClick={handleCapture}
                        className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:scale-105 active:scale-95 shadow-lg"
                        style={{ background: "linear-gradient(135deg, #22c55e, #16a34a)" }}
                    >
                        ✓ Capture
                    </button>
                </div>
            )}

            {/* My hand */}
            {myPlayerNum > 0 && gameState.phase === 1 && (
                <div className="mt-2">
                    <div className="text-[10px] text-gray-500 text-center mb-1 font-medium">Your hand</div>
                    <div className="flex flex-wrap justify-center gap-1">
                        {myHand.map((card, i) => (
                            <CardSvg
                                key={`h-${cardToStr(card)}-${i}`}
                                suit={card.suit}
                                rank={card.rank}
                                variant="chaarbarg"
                                width={44}
                                height={64}
                                onClick={() => handleHandCardClick(i)}
                                disabled={!isMyTurn}
                                highlight={selectedHandCard === i}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Round over */}
            {gameState.phase === 2 && myPlayerNum > 0 && (
                <div className="flex justify-center mt-3">
                    <button
                        onClick={handleNewRound}
                        className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:scale-105 active:scale-95 shadow-lg"
                        style={{ background: "linear-gradient(135deg, #4ea4f6, #2b7de9)" }}
                    >
                        Next Round →
                    </button>
                </div>
            )}

            {/* Status */}
            <div className={`text-center text-xs mt-2.5 font-medium ${statusColor}`}>
                {statusText}
            </div>
        </div>
    );
}
