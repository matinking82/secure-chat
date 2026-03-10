import { useMemo, useRef, useState, useEffect } from "react";
import { getBrowserId } from "../../lib/storage";
import { useChat } from "../../contexts/ChatContext";
import CardSvg, { useCardPreloader } from "./CardSvg";

// ─── Types ───

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

const SUITS = ["", "S", "H", "D", "C"];
const SUIT_SYMBOLS: Record<number, string> = { 1: "♠", 2: "♥", 3: "♦", 4: "♣" };
const SUIT_COLORS: Record<number, string> = { 1: "#e2e8f0", 2: "#ef4444", 3: "#ef4444", 4: "#e2e8f0" };
const SUIT_NAMES: Record<number, string> = { 1: "Spades", 2: "Hearts", 3: "Diamonds", 4: "Clubs" };
const RANK_DISPLAY: Record<number, string> = {
    2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10",
    11: "J", 12: "Q", 13: "K", 14: "A"
};

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

function getTeam(playerNum: number): number {
    return playerNum % 2 === 1 ? 1 : 2;
}

/** Create a fresh Hokm4 game */
export function createHokm4(initiatorBrowserId: string): string {
    return `GAME::HOKM4::${initiatorBrowserId}:?:?:?:1:0:1:0:0:0:0:;;;\::0:0`;
}

export function isHokm4Message(text: string): boolean {
    return text.startsWith("GAME::HOKM4::");
}

export function parseHokm4(text: string): Hokm4State | null {
    if (!isHokm4Message(text)) return null;
    const parts = text.slice("GAME::HOKM4::".length).split(":");
    if (parts.length < 15) return null;

    const handsParts = parts[11].split(";");
    const hands: [Card[], Card[], Card[], Card[]] = [
        decodeCards(handsParts[0] || ""),
        decodeCards(handsParts[1] || ""),
        decodeCards(handsParts[2] || ""),
        decodeCards(handsParts[3] || ""),
    ];
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

// ─── Component ───

const TRICK_DISPLAY_DURATION_MS = 1500;

interface Hokm4GameProps {
    gameState: Hokm4State;
    messageId: number;
    chatId: string;
}

export default function Hokm4Game({ gameState, messageId, chatId }: Hokm4GameProps) {
    const myBrowserId = getBrowserId();
    const { socket } = useChat();
    useCardPreloader();

    // ─── Trick completion delay: show completed trick for 2.5s ───
    const prevTrickRef = useRef<{ trick: Card[]; trickPlayers: number[]; hands: [Card[], Card[], Card[], Card[]] }>({ trick: [], trickPlayers: [], hands: [[], [], [], []] });
    const [completedTrick, setCompletedTrick] = useState<{ trick: Card[]; trickPlayers: number[] } | null>(null);

    useEffect(() => {
        const prevTrick = prevTrickRef.current;
        // Detect trick completion: previous trick had 2 cards (full), current trick is empty or has fewer
        if (prevTrick.trick.length === 3 && gameState.trick.length < 3) {
            //add the last played card
            for (let i = 0; i < prevTrick.hands.length; i++) {
                const prevHand = prevTrick.hands[i];
                const curentHand = gameState.hands[i];

                for (let card of prevHand) {
                    if (!curentHand.find(c => c.rank === card.rank && c.suit === card.suit)) {
                        prevTrick.trick.push(card);
                    }
                }
            }

            if (!prevTrick.trickPlayers.find(p => p == 1)) {
                prevTrick.trickPlayers.push(1);
            } else if (!prevTrick.trickPlayers.find(p => p == 2)) {
                prevTrick.trickPlayers.push(2);
            } else if (!prevTrick.trickPlayers.find(p => p == 3)) {
                prevTrick.trickPlayers.push(3);
            } else if (!prevTrick.trickPlayers.find(p => p == 4)) {
                prevTrick.trickPlayers.push(4);
            }

            setCompletedTrick({ trick: prevTrick.trick, trickPlayers: prevTrick.trickPlayers });
            setTimeout(() => setCompletedTrick(null), TRICK_DISPLAY_DURATION_MS);
            prevTrickRef.current = { trick: gameState.trick, trickPlayers: gameState.trickPlayers, hands: gameState.hands };
        }
        prevTrickRef.current = { trick: gameState.trick, trickPlayers: gameState.trickPlayers, hands: gameState.hands };
    }, [gameState.trick, gameState.trickPlayers]);

    // Use completed trick for display if we're in the delay period
    const displayTrick = completedTrick ?? { trick: gameState.trick, trickPlayers: gameState.trickPlayers };
    const isTrickCompleteDisplay = completedTrick !== null;

    const players = [gameState.p1, gameState.p2, gameState.p3, gameState.p4];

    // Determine if the current user is already a player or can join
    const myPlayerNum = (() => {
        const idx = players.indexOf(myBrowserId);
        if (idx >= 0) return idx + 1;
        return 0; // not a player yet
    })();

    const isMyTurn = gameState.turn === myPlayerNum && gameState.phase === 2;
    const isHakem = myPlayerNum === gameState.hakem;
    const myTeam = myPlayerNum > 0 ? getTeam(myPlayerNum) : 0;
    const myHand = myPlayerNum > 0 ? gameState.hands[myPlayerNum - 1] : [];

    const sortedHand = useMemo(() => {
        return [...myHand].sort((a, b) => a.suit === b.suit ? b.rank - a.rank : a.suit - b.suit);
    }, [myHand]);

    const playableCards = useMemo(() => {
        if (!isMyTurn) return new Set<string>();
        const set = new Set<string>();
        if (gameState.trick.length > 0) {
            const hasSuit = sortedHand.some(c => c.suit === gameState.leadSuit);
            for (const c of sortedHand) {
                if (!hasSuit || c.suit === gameState.leadSuit) set.add(cardToStr(c));
            }
        } else {
            for (const c of sortedHand) set.add(cardToStr(c));
        }
        return set;
    }, [isMyTurn, sortedHand, gameState.trick, gameState.leadSuit]);

    const handleSelectTrump = (suit: number) => {
        socket?.emit("hokm4_trump", { chatId, messageId, suit, browserId: myBrowserId });
    };

    const handlePlayCard = (card: Card) => {
        if (!isMyTurn) return;
        const handIdx = myHand.findIndex(c => c.suit === card.suit && c.rank === card.rank);
        if (handIdx === -1) return;
        socket?.emit("hokm4_play", { chatId, messageId, cardIndex: handIdx, browserId: myBrowserId });
    };

    const handleNewRound = () => {
        socket?.emit("hokm4_newround", { chatId, messageId, browserId: myBrowserId });
    };

    const handleJoin = () => {
        socket?.emit("hokm4_join", { chatId, messageId, browserId: myBrowserId });
    };

    const playersJoined = players.filter(p => p !== "?").length;
    const allJoined = playersJoined === 4;
    const hasEmptySlot = players.some(p => p === "?");

    const getPlayerLabel = (pNum: number) => {
        const pid = players[pNum - 1];
        if (pid === "?") return "???";
        if (pid === myBrowserId) return "You";
        return `P${pNum}`;
    };

    // Status
    let statusText = "";
    let statusColor = "text-gray-400";

    if (gameState.phase === 0) {
        if (!allJoined) {
            statusText = myPlayerNum === 0
                ? `🎮 Join the game! (${playersJoined}/4)`
                : `⏳ Waiting for players (${playersJoined}/4)...`;
        } else {
            statusText = "Starting...";
        }
    } else if (gameState.phase === 1) {
        statusText = isHakem ? "👑 You are Hakem! Select trump suit" : "👑 Hakem is selecting trump...";
        statusColor = isHakem ? "text-yellow-400" : "text-gray-400";
    } else if (gameState.phase === 2) {
        if (isMyTurn) {
            statusText = "🃏 Your turn — play a card";
            statusColor = "text-green-400";
        } else {
            statusText = `⏳ ${getPlayerLabel(gameState.turn)}'s turn...`;
        }
    } else if (gameState.phase === 3) {
        const winTeam = gameState.t1Tricks >= 7 ? 1 : 2;
        statusText = winTeam === myTeam ? "🏆 Your team won this round!" : "😔 Your team lost this round";
        statusColor = winTeam === myTeam ? "text-yellow-400" : "text-red-400";
    } else if (gameState.phase === 4) {
        const winTeam = gameState.t1Score >= 7 ? 1 : 2;
        statusText = winTeam === myTeam ? "🏆🏆 Your team won the match!" : "Match over — opponents win";
        statusColor = winTeam === myTeam ? "text-yellow-400" : "text-red-400";
    }

    return (
        <div className="select-none max-w-sm">
            {/* Header */}
            <div className="text-center mb-3">
                <div className="text-sm font-bold tracking-wide text-gray-300 mb-1">
                    🃏 حکم چهار نفره — Hokm 4P
                </div>
                <div className="flex items-center justify-center gap-1 text-[10px] text-gray-400 flex-wrap">
                    <span className="text-blue-400 font-semibold">Team1:</span>
                    <span>{getPlayerLabel(1)}</span>
                    <span>+</span>
                    <span>{getPlayerLabel(3)}</span>
                    <span className="text-gray-600 mx-1">vs</span>
                    <span className="text-red-400 font-semibold">Team2:</span>
                    <span>{getPlayerLabel(2)}</span>
                    <span>+</span>
                    <span>{getPlayerLabel(4)}</span>
                </div>
                {gameState.hakem > 0 && gameState.phase >= 1 && (
                    <div className="text-[10px] text-yellow-400 mt-0.5">
                        👑 Hakem: {getPlayerLabel(gameState.hakem)}
                    </div>
                )}
            </div>

            {/* Scores */}
            <div className="flex justify-center gap-3 mb-3 text-xs">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl" style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.2)" }}>
                    <span className="text-blue-400 font-semibold">T1</span>
                    <span className="text-white font-bold text-sm">{gameState.t1Score}</span>
                    <span className="text-gray-500">pts</span>
                    <span className="text-gray-600 mx-0.5">·</span>
                    <span className="text-blue-300 font-bold">{gameState.t1Tricks}</span>
                    <span className="text-gray-500">tr</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl" style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <span className="text-red-400 font-semibold">T2</span>
                    <span className="text-white font-bold text-sm">{gameState.t2Score}</span>
                    <span className="text-gray-500">pts</span>
                    <span className="text-gray-600 mx-0.5">·</span>
                    <span className="text-red-300 font-bold">{gameState.t2Tricks}</span>
                    <span className="text-gray-500">tr</span>
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

            {/* Join button — show for any non-player when slots are available */}
            {gameState.phase === 0 && hasEmptySlot && myPlayerNum === 0 && (
                <div className="flex justify-center mb-3">
                    <button
                        onClick={handleJoin}
                        className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:scale-105 active:scale-95 shadow-lg"
                        style={{ background: "linear-gradient(135deg, #22c55e, #16a34a)" }}
                    >
                        🎮 Join Game ({playersJoined}/4)
                    </button>
                </div>
            )}

            {/* Trump selection */}
            {gameState.phase === 1 && isHakem && (
                <div className="flex flex-col items-center gap-2.5 mb-3">
                    <div className="text-xs text-yellow-400 font-semibold">👑 Select Trump Suit</div>
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

            {/* Trick area */}
            {(gameState.phase === 2 || isTrickCompleteDisplay) && (
                <div className={`flex justify-center gap-2 mb-3 min-h-[90px] items-center flex-wrap py-2 px-3 rounded-xl mx-auto transition-all ${isTrickCompleteDisplay ? "ring-2 ring-yellow-400/40" : ""}`}
                    style={{ background: "rgba(0,60,30,0.25)", border: "1px solid rgba(74,222,128,0.1)" }}>
                    {displayTrick.trick.length === 0 ? (
                        <div className="text-xs text-gray-600 italic">Trick area</div>
                    ) : (
                        displayTrick.trick.map((card, i) => (
                            <div key={i} className="flex flex-col items-center gap-0.5">
                                <span className="text-[8px] text-gray-500 font-medium">
                                    {getPlayerLabel(displayTrick.trickPlayers[i])}
                                </span>
                                <CardSvg suit={card.suit} rank={card.rank} width={44} height={64} disabled />
                            </div>
                        ))
                    )}
                </div>
            )}

            {/* My hand */}
            {myPlayerNum > 0 && gameState.phase >= 1 && gameState.phase <= 2 && (
                <div className="mt-2">
                    <div className="text-[10px] text-gray-500 text-center mb-1 font-medium">Your hand ({sortedHand.length})</div>
                    <div className="flex flex-wrap justify-center gap-0.5">
                        {(gameState.phase === 1 ? myHand.slice(0, 5) : sortedHand).map((card, i) => {
                            const key = cardToStr(card);
                            const canPlay = playableCards.has(key);
                            return (
                                <CardSvg
                                    key={`${key}-${i}`}
                                    suit={card.suit}
                                    rank={card.rank}
                                    width={40}
                                    height={58}
                                    onClick={() => canPlay && handlePlayCard(card)}
                                    disabled={!canPlay}
                                    highlight={canPlay && isMyTurn}
                                />
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
