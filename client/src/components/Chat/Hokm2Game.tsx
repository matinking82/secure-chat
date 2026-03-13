import { useState, useMemo, useRef, useEffect } from "react";
import { getBrowserId } from "../../lib/storage";
import { useChat } from "../../contexts/ChatContext";
import CardSvg, { useCardPreloader } from "./CardSvg";

// ─── Types ───

export interface Card {
    suit: number; // 1=Spades,2=Hearts,3=Diamonds,4=Clubs
    rank: number; // 2-14 (14=Ace)
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

const SUITS = ["", "S", "H", "D", "C"];
const SUIT_SYMBOLS: Record<number, string> = { 1: "♠", 2: "♥", 3: "♦", 4: "♣" };
const SUIT_COLORS: Record<number, string> = { 1: "#e2e8f0", 2: "#ef4444", 3: "#ef4444", 4: "#e2e8f0" };
const SUIT_NAMES: Record<number, string> = { 1: "Spades", 2: "Hearts", 3: "Diamonds", 4: "Clubs" };

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

function decodeTrick(s: string): { trick: Card[]; trickPlayers: number[] } {
    if (!s) return { trick: [], trickPlayers: [] };
    const parts = s.split(",").filter(x => x);
    const trick: Card[] = [];
    const trickPlayers: number[] = [];
    for (const p of parts) {
        trickPlayers.push(parseInt(p[0]));
        trick.push(strToCard(p.slice(1)));
    }
    return { trick, trickPlayers };
}

/** Create a fresh Hokm2 game */
export function createHokm2(initiatorBrowserId: string): string {
    return `GAME::HOKM2::${initiatorBrowserId}:?:1:0:1:0:0:0:0:;:0:0:::0`;
}

export function isHokm2Message(text: string): boolean {
    return text.startsWith("GAME::HOKM2::");
}

export function parseHokm2(text: string): Hokm2State | null {
    if (!isHokm2Message(text)) return null;
    const parts = text.slice("GAME::HOKM2::".length).split(":");
    if (parts.length < 12) return null;

    const hands: [Card[], Card[]] = (() => {
        const hp = parts[9].split(";");
        return [decodeCards(hp[0] || ""), decodeCards(hp[1] || "")];
    })();
    const { trick, trickPlayers } = decodeTrick(parts[10]);

    // Parse new fields (backward compatible)
    const drawPile = parts.length > 13 ? decodeCards(parts[13]) : [];
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

// ─── Component ───

const TRICK_DISPLAY_DURATION_MS = 1500;

interface Hokm2GameProps {
    gameState: Hokm2State;
    messageId: number;
    chatId: string;
}

export default function Hokm2Game({ gameState, messageId, chatId }: Hokm2GameProps) {
    const myBrowserId = getBrowserId();
    const { socket } = useChat();
    useCardPreloader();

    // ─── Trick completion delay ───
    const prevTrickRef = useRef<{ trick: Card[]; trickPlayers: number[]; hands: [Card[], Card[]] }>({ trick: [], trickPlayers: [], hands: [[], []] });
    const [completedTrick, setCompletedTrick] = useState<{ trick: Card[]; trickPlayers: number[] } | null>(null);

    // ─── Discard selection ───
    const [selectedDiscards, setSelectedDiscards] = useState<Set<number>>(new Set());

    useEffect(() => {
        const prevTrick = prevTrickRef.current;
        if (prevTrick.trick.length === 1 && gameState.trick.length === 0) {
            for (let i = 0; i < prevTrick.hands.length; i++) {
                const prevHand = prevTrick.hands[i];
                const currentHand = gameState.hands[i];
                for (const card of prevHand) {
                    if (!currentHand.find(c => c.rank === card.rank && c.suit === card.suit)) {
                        prevTrick.trick.push(card);
                    }
                }
            }
            if (prevTrick.trickPlayers[0] === 1) {
                prevTrick.trickPlayers.push(2);
            } else {
                prevTrick.trickPlayers.push(1);
            }
            setCompletedTrick({ trick: prevTrick.trick, trickPlayers: prevTrick.trickPlayers });
            setTimeout(() => setCompletedTrick(null), TRICK_DISPLAY_DURATION_MS);
            prevTrickRef.current = { trick: gameState.trick, trickPlayers: gameState.trickPlayers, hands: gameState.hands };
        }
        prevTrickRef.current = { trick: gameState.trick, trickPlayers: gameState.trickPlayers, hands: gameState.hands };
    }, [gameState.trick, gameState.trickPlayers]);

    // Reset discard selection when phase changes
    useEffect(() => {
        setSelectedDiscards(new Set());
    }, [gameState.phase]);

    const displayTrick = completedTrick ?? { trick: gameState.trick, trickPlayers: gameState.trickPlayers };
    const isTrickCompleteDisplay = completedTrick !== null;

    const myPlayerNum = (() => {
        if (myBrowserId === gameState.p1) return 1;
        if (myBrowserId === gameState.p2) return 2;
        if (gameState.p2 === "?" && myBrowserId !== gameState.p1) return 2;
        return 0;
    })();

    const isMyTurn = gameState.turn === myPlayerNum && gameState.phase === 2;
    const isHakem = myPlayerNum === gameState.hakem;
    const myHand = myPlayerNum > 0 ? gameState.hands[myPlayerNum - 1] : [];

    const sortedHand = useMemo(() => {
        return [...myHand].sort((a, b) => a.suit === b.suit ? b.rank - a.rank : a.suit - b.suit);
    }, [myHand]);

    const playableCards = useMemo(() => {
        if (!isMyTurn) return new Set<string>();
        const set = new Set<string>();
        if (gameState.trick.length === 1) {
            const hasSuit = sortedHand.some(c => c.suit === gameState.leadSuit);
            for (const c of sortedHand) {
                if (!hasSuit || c.suit === gameState.leadSuit) set.add(cardToStr(c));
            }
        } else {
            for (const c of sortedHand) set.add(cardToStr(c));
        }
        return set;
    }, [isMyTurn, sortedHand, gameState.trick, gameState.leadSuit]);

    // ─── Discard phase helpers ───
    const isDiscardPhase = gameState.phase === 5 || gameState.phase === 6;
    const isMyDiscard = isDiscardPhase && gameState.turn === myPlayerNum;

    const discardMin = (() => {
        if (gameState.phase === 5) return 2; // hakem can discard 2 or 3
        if (gameState.phase === 6) {
            return gameState.hakemDiscardCount === 2 ? 3 : 2;
        }
        return 0;
    })();

    const discardMax = (() => {
        if (gameState.phase === 5) return 3;
        if (gameState.phase === 6) {
            return gameState.hakemDiscardCount === 2 ? 3 : 2;
        }
        return 0;
    })();

    const canConfirmDiscard = isMyDiscard && selectedDiscards.size >= discardMin && selectedDiscards.size <= discardMax;

    const toggleDiscardCard = (idx: number) => {
        if (!isMyDiscard) return;
        setSelectedDiscards(prev => {
            const next = new Set(prev);
            if (next.has(idx)) {
                next.delete(idx);
            } else {
                if (next.size < discardMax) {
                    next.add(idx);
                }
            }
            return next;
        });
    };

    // ─── Draw phase helpers ───
    const isDrawPhase = gameState.phase === 7;
    const isMyDraw = isDrawPhase && gameState.turn === myPlayerNum;

    const handleSelectTrump = (suit: number) => {
        socket?.emit("hokm2_trump", { chatId, messageId, suit, browserId: myBrowserId });
    };

    const handlePlayCard = (card: Card) => {
        if (!isMyTurn) return;
        const handIdx = myHand.findIndex(c => c.suit === card.suit && c.rank === card.rank);
        if (handIdx === -1) return;
        socket?.emit("hokm2_play", { chatId, messageId, cardIndex: handIdx, browserId: myBrowserId });
    };

    const handleConfirmDiscard = () => {
        if (!canConfirmDiscard) return;
        const indices = Array.from(selectedDiscards);
        // Map sorted hand indices back to original hand indices
        const originalIndices = indices.map(sortedIdx => {
            const card = sortedHand[sortedIdx];
            return myHand.findIndex(c => c.suit === card.suit && c.rank === card.rank);
        });
        socket?.emit("hokm2_discard", { chatId, messageId, cardIndices: originalIndices, browserId: myBrowserId });
    };

    const handleDrawAccept = () => {
        if (!isMyDraw) return;
        socket?.emit("hokm2_draw", { chatId, messageId, accept: true, browserId: myBrowserId });
    };

    const handleDrawRefuse = () => {
        if (!isMyDraw) return;
        socket?.emit("hokm2_draw", { chatId, messageId, accept: false, browserId: myBrowserId });
    };

    const handleNewRound = () => {
        socket?.emit("hokm2_newround", { chatId, messageId, browserId: myBrowserId });
    };

    const handleJoin = () => {
        socket?.emit("hokm2_join", { chatId, messageId, browserId: myBrowserId });
    };

    // Status
    let statusText = "";
    let statusColor = "text-gray-400";

    if (gameState.phase === 0) {
        if (gameState.p2 === "?") {
            statusText = myPlayerNum === 1 ? "\u23F3 Waiting for opponent..." : "\uD83C\uDFAE Tap Join to play!";
        } else {
            statusText = "Starting...";
        }
    } else if (gameState.phase === 1) {
        statusText = isHakem ? "\uD83D\uDC51 You are Hakem! Select trump suit" : "\uD83D\uDC51 Hakem is selecting trump...";
        statusColor = isHakem ? "text-yellow-400" : "text-gray-400";
    } else if (gameState.phase === 2) {
        statusText = isMyTurn ? "\uD83C\uDFAF Your turn \u2014 play a card" : "\u23F3 Opponent's turn...";
        statusColor = isMyTurn ? "text-green-400" : "text-gray-400";
    } else if (gameState.phase === 3) {
        const winner = gameState.p1Tricks >= 7 ? 1 : 2;
        statusText = winner === myPlayerNum ? "\uD83C\uDFC6 You won this round!" : "\uD83D\uDE14 You lost this round";
        statusColor = winner === myPlayerNum ? "text-yellow-400" : "text-red-400";
    } else if (gameState.phase === 4) {
        const winner = gameState.p1Score >= 7 ? 1 : 2;
        statusText = winner === myPlayerNum ? "\uD83C\uDFC6\uD83C\uDFC6 You won the match!" : "Match over \u2014 opponent wins";
        statusColor = winner === myPlayerNum ? "text-yellow-400" : "text-red-400";
    } else if (gameState.phase === 5) {
        if (isHakem && myPlayerNum === gameState.turn) {
            statusText = "\uD83D\uDC51 Discard 2 or 3 cards from your hand";
            statusColor = "text-yellow-400";
        } else {
            statusText = "\uD83D\uDC51 Hakem is discarding cards...";
        }
    } else if (gameState.phase === 6) {
        if (myPlayerNum === gameState.turn) {
            const required = gameState.hakemDiscardCount === 2 ? 3 : 2;
            statusText = `\uD83C\uDCCF Discard ${required} cards from your hand`;
            statusColor = "text-yellow-400";
        } else {
            statusText = "\u23F3 Opponent is discarding cards...";
        }
    } else if (gameState.phase === 7) {
        if (isMyDraw) {
            statusText = "\uD83C\uDCCF Accept or refuse the drawn card";
            statusColor = "text-green-400";
        } else {
            statusText = "\u23F3 Opponent is drawing...";
        }
    }

    return (
        <div className="select-none max-w-sm">
            {/* Header */}
            <div className="text-center mb-3">
                <div className="text-sm font-bold tracking-wide text-gray-300 mb-1">
                    {"\uD83C\uDCCF"} {"\u062D\u06A9\u0645 \u062F\u0648 \u0646\u0641\u0631\u0647"} {"\u2014"} Hokm 2P
                </div>
                <div className="flex items-center justify-center gap-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                        {gameState.hakem === 1 && <span className="text-yellow-400">{"\uD83D\uDC51"}</span>}
                        <span className="text-blue-400 font-bold">P1</span>
                        {gameState.p1 === myBrowserId ? " (You)" : ""}
                    </span>
                    <span className="text-gray-600 font-semibold">vs</span>
                    <span className="flex items-center gap-1">
                        {gameState.hakem === 2 && <span className="text-yellow-400">{"\uD83D\uDC51"}</span>}
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
                    <span className="text-gray-600 mx-0.5">{"\u00B7"}</span>
                    <span className="text-blue-300 font-bold">{gameState.p1Tricks}</span>
                    <span className="text-gray-500">tricks</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl" style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <span className="text-red-400 font-semibold">P2</span>
                    <span className="text-white font-bold text-sm">{gameState.p2Score}</span>
                    <span className="text-gray-500">pts</span>
                    <span className="text-gray-600 mx-0.5">{"\u00B7"}</span>
                    <span className="text-red-300 font-bold">{gameState.p2Tricks}</span>
                    <span className="text-gray-500">tricks</span>
                </div>
            </div>

            {/* Trump indicator */}
            {gameState.trump > 0 && (
                <div className="flex justify-center mb-3">
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs"
                        style={{ background: "rgba(250,204,21,0.1)", border: "1px solid rgba(250,204,21,0.25)" }}>
                        <span className="text-yellow-400 font-semibold">Trump:</span>
                        <span style={{ color: SUIT_COLORS[gameState.trump] }} className="text-base font-bold">
                            {SUIT_SYMBOLS[gameState.trump]}
                        </span>
                        <span className="text-gray-400">{SUIT_NAMES[gameState.trump]}</span>
                    </div>
                </div>
            )}

            {/* Join button */}
            {gameState.phase === 0 && gameState.p2 === "?" && myPlayerNum !== 1 && (
                <div className="flex justify-center mb-3">
                    <button
                        onClick={handleJoin}
                        className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:scale-105 active:scale-95 shadow-lg"
                        style={{ background: "linear-gradient(135deg, #22c55e, #16a34a)" }}
                    >
                        {"\uD83C\uDFAE"} Join Game
                    </button>
                </div>
            )}

            {/* Trump selection */}
            {gameState.phase === 1 && isHakem && (
                <div className="flex flex-col items-center gap-2.5 mb-3">
                    <div className="text-xs text-yellow-400 font-semibold">{"\uD83D\uDC51"} Select Trump Suit ({"\u062D\u06A9\u0645"})</div>
                    <div className="flex gap-2">
                        {[1, 2, 3, 4].map(suit => (
                            <button
                                key={suit}
                                onClick={() => handleSelectTrump(suit)}
                                className="w-14 h-16 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all hover:scale-110 active:scale-95 shadow-md"
                                style={{
                                    background: "linear-gradient(160deg, rgba(40,40,70,0.95), rgba(20,20,40,0.95))",
                                    border: "1px solid rgba(255,255,255,0.12)",
                                }}
                            >
                                <span className="text-2xl" style={{ color: SUIT_COLORS[suit] }}>{SUIT_SYMBOLS[suit]}</span>
                                <span className="text-[8px] text-gray-400 font-medium">{SUIT_NAMES[suit]}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Draw phase: show drawn card and accept/refuse buttons */}
            {isDrawPhase && (
                <div className="flex flex-col items-center gap-2.5 mb-3">
                    <div className="text-xs text-gray-400 font-medium">
                        Draw pile: {gameState.drawPile.length} cards remaining
                    </div>
                    {gameState.drawnCard && isMyDraw && (
                        <div className="flex flex-col items-center gap-2">
                            <div className="text-xs text-gray-500">Top card:</div>
                            <CardSvg suit={gameState.drawnCard.suit} rank={gameState.drawnCard.rank} width={60} height={88} disabled />
                            <div className="flex gap-2 mt-1">
                                <button
                                    onClick={handleDrawAccept}
                                    className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition-all hover:scale-105 active:scale-95 shadow-md"
                                    style={{ background: "linear-gradient(135deg, #22c55e, #16a34a)" }}
                                >
                                    {"\u2713"} Accept
                                </button>
                                <button
                                    onClick={handleDrawRefuse}
                                    className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition-all hover:scale-105 active:scale-95 shadow-md"
                                    style={{ background: "linear-gradient(135deg, #ef4444, #dc2626)" }}
                                >
                                    {"\u2717"} Refuse
                                </button>
                            </div>
                        </div>
                    )}
                    {gameState.drawnCard && !isMyDraw && (
                        <div className="flex flex-col items-center gap-2 py-3">
                            <div className="text-xs text-gray-500 italic">{"\u23F3"} Opponent is choosing...</div>
                        </div>
                    )}
                </div>
            )}

            {/* Discard phase: confirm button */}
            {isDiscardPhase && isMyDiscard && (
                <div className="flex flex-col items-center gap-2 mb-3">
                    <div className="text-xs text-gray-400">
                        {gameState.phase === 5
                            ? `Select ${discardMin} or ${discardMax} cards to discard (${selectedDiscards.size} selected)`
                            : `Select ${discardMin} cards to discard (${selectedDiscards.size}/${discardMin} selected)`
                        }
                    </div>
                    {canConfirmDiscard && (
                        <button
                            onClick={handleConfirmDiscard}
                            className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:scale-105 active:scale-95 shadow-lg"
                            style={{ background: "linear-gradient(135deg, #ef4444, #dc2626)" }}
                        >
                            {"\uD83D\uDDD1"} Discard {selectedDiscards.size} cards
                        </button>
                    )}
                </div>
            )}

            {/* Trick area */}
            {(gameState.phase === 2 || isTrickCompleteDisplay) && (
                <div className={`flex justify-center gap-4 mb-3 min-h-[90px] items-center py-2 px-4 rounded-xl mx-auto transition-all ${isTrickCompleteDisplay ? "ring-2 ring-yellow-400/40" : ""}`}
                    style={{ background: "rgba(0,60,30,0.25)", border: "1px solid rgba(74,222,128,0.1)" }}>
                    {displayTrick.trick.length === 0 ? (
                        <div className="text-xs text-gray-600 italic">Play a card to start the trick</div>
                    ) : (
                        displayTrick.trick.map((card, i) => (
                            <div key={i} className="flex flex-col items-center gap-1">
                                <span className="text-[9px] text-gray-500 font-medium">
                                    P{displayTrick.trickPlayers[i]}
                                </span>
                                <CardSvg suit={card.suit} rank={card.rank} width={52} height={76} disabled />
                            </div>
                        ))
                    )}
                </div>
            )}

            {/* My hand */}
            {myPlayerNum > 0 && gameState.phase >= 1 && gameState.phase !== 3 && gameState.phase !== 4 && (
                <div className="mt-2">
                    <div className="text-[10px] text-gray-500 text-center mb-1 font-medium">Your hand ({sortedHand.length})</div>
                    <div className="flex flex-wrap justify-center gap-1">
                        {(gameState.phase === 1 ? myHand.slice(0, 5) : sortedHand).map((card, i) => {
                            const key = cardToStr(card);
                            const canPlay = playableCards.has(key);
                            const isDiscardSelected = isDiscardPhase && selectedDiscards.has(i);
                            const canInteract = isDiscardPhase ? isMyDiscard : canPlay;

                            return (
                                <div key={`${key}-${i}`} className="relative">
                                    <CardSvg
                                        suit={card.suit}
                                        rank={card.rank}
                                        width={44}
                                        height={64}
                                        onClick={() => {
                                            if (isDiscardPhase && isMyDiscard) {
                                                toggleDiscardCard(i);
                                            } else if (canPlay) {
                                                handlePlayCard(card);
                                            }
                                        }}
                                        disabled={!canInteract}
                                        highlight={isDiscardPhase ? isDiscardSelected : (canPlay && isMyTurn)}
                                    />
                                    {isDiscardSelected && (
                                        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center">
                                            <span className="text-[8px] text-white font-bold">{"\u2717"}</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Round over */}
            {gameState.phase === 3 && myPlayerNum > 0 && (
                <div className="flex justify-center mt-3">
                    <button
                        onClick={handleNewRound}
                        className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:scale-105 active:scale-95 shadow-lg"
                        style={{ background: "linear-gradient(135deg, #4ea4f6, #2b7de9)" }}
                    >
                        Next Round {"\u2192"}
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
