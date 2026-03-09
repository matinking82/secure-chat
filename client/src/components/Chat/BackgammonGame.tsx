import { useState } from "react";
import { getBrowserId } from "../../lib/storage";
import { useChat } from "../../contexts/ChatContext";

// ─── Game state helpers ───

export interface BackgammonState {
    p1: string;
    p2: string;
    points: { color: string; count: number }[];
    turn: number;
    dice: number[];
    barWhite: number;
    barBlack: number;
    offWhite: number;
    offBlack: number;
    winner: number;
    remainingMoves: number[];
}

/** Create a fresh Backgammon game state string */
export function createBackgammon(initiatorBrowserId: string): string {
    // Standard starting position
    // Points indexed 0-23. White(p1) moves from 23→0, Black(p2) moves from 0→23
    const points = Array(24).fill("0");
    // White pieces: 2 on point 23, 5 on point 12, 3 on point 7, 5 on point 5
    points[23] = "w2"; points[12] = "w5"; points[7] = "w3"; points[5] = "w5";
    // Black pieces: 2 on point 0, 5 on point 11, 3 on point 16, 5 on point 18
    points[0] = "b2"; points[11] = "b5"; points[16] = "b3"; points[18] = "b5";
    const pointsStr = points.join(",");
    return `GAME::BACKGAMMON::${initiatorBrowserId}:?:${pointsStr}:1:0,0:w0b0:w0b0:0:`;
}

/** Check if a decrypted message text is a Backgammon game */
export function isBackgammonMessage(text: string): boolean {
    return text.startsWith("GAME::BACKGAMMON::");
}

/** Parse game state from message text */
export function parseBackgammon(text: string): BackgammonState | null {
    if (!isBackgammonMessage(text)) return null;
    const parts = text.slice("GAME::BACKGAMMON::".length).split(":");
    if (parts.length < 9) return null;

    const p1 = parts[0];
    const p2 = parts[1];

    const pointsStr = parts[2].split(",");
    if (pointsStr.length !== 24) return null;
    const points = pointsStr.map(s => {
        if (s === "0") return { color: "", count: 0 };
        const color = s[0];
        const count = parseInt(s.slice(1)) || 0;
        return { color, count };
    });

    const turn = parseInt(parts[3]) || 1;
    const dice = parts[4] ? parts[4].split(",").map(Number) : [0, 0];

    const barMatch = parts[5].match(/w(\d+)b(\d+)/);
    const barWhite = barMatch ? parseInt(barMatch[1]) : 0;
    const barBlack = barMatch ? parseInt(barMatch[2]) : 0;

    const offMatch = parts[6].match(/w(\d+)b(\d+)/);
    const offWhite = offMatch ? parseInt(offMatch[1]) : 0;
    const offBlack = offMatch ? parseInt(offMatch[2]) : 0;

    const winner = parseInt(parts[7]) || 0;
    const remainingMoves = parts[8] ? parts[8].split(",").filter(s => s).map(Number) : [];

    return { p1, p2, points, turn, dice, barWhite, barBlack, offWhite, offBlack, winner, remainingMoves };
}

// ─── Client-side valid move calculation ───

function playerColor(playerNum: number): string {
    return playerNum === 1 ? "w" : "b";
}

function canBearOff(state: BackgammonState, playerNum: number): boolean {
    const color = playerColor(playerNum);
    const bar = playerNum === 1 ? state.barWhite : state.barBlack;
    if (bar > 0) return false;

    if (playerNum === 1) {
        for (let i = 6; i < 24; i++) {
            if (state.points[i].color === color && state.points[i].count > 0) return false;
        }
    } else {
        for (let i = 0; i < 18; i++) {
            if (state.points[i].color === color && state.points[i].count > 0) return false;
        }
    }
    return true;
}

function getValidMoves(state: BackgammonState, playerNum: number, dieValue: number): { from: number; to: number }[] {
    const color = playerColor(playerNum);
    const opp = playerNum === 1 ? "b" : "w";
    const moves: { from: number; to: number }[] = [];
    const bar = playerNum === 1 ? state.barWhite : state.barBlack;

    if (bar > 0) {
        const target = playerNum === 1 ? 24 - dieValue : dieValue - 1;
        if (target >= 0 && target < 24) {
            const pt = state.points[target];
            if (pt.color !== opp || pt.count <= 1) {
                moves.push({ from: -1, to: target });
            }
        }
        return moves;
    }

    for (let i = 0; i < 24; i++) {
        if (state.points[i].color !== color || state.points[i].count === 0) continue;
        const target = playerNum === 1 ? i - dieValue : i + dieValue;
        if (target >= 0 && target < 24) {
            const pt = state.points[target];
            if (pt.color !== opp || pt.count <= 1) {
                moves.push({ from: i, to: target });
            }
        }
    }

    if (canBearOff(state, playerNum)) {
        if (playerNum === 1) {
            if (state.points[dieValue - 1]?.color === color && state.points[dieValue - 1]?.count > 0) {
                moves.push({ from: dieValue - 1, to: -2 });
            }
            let highestOccupied = -1;
            for (let i = 5; i >= 0; i--) {
                if (state.points[i].color === color && state.points[i].count > 0) {
                    highestOccupied = i; break;
                }
            }
            if (highestOccupied >= 0 && dieValue > highestOccupied + 1 && !moves.some(m => m.to === -2)) {
                moves.push({ from: highestOccupied, to: -2 });
            }
        } else {
            const bearOffPoint = 24 - dieValue;
            if (bearOffPoint >= 18 && bearOffPoint < 24 && state.points[bearOffPoint]?.color === color && state.points[bearOffPoint]?.count > 0) {
                moves.push({ from: bearOffPoint, to: -2 });
            }
            let highestOccupied = -1;
            for (let i = 18; i < 24; i++) {
                if (state.points[i].color === color && state.points[i].count > 0) {
                    highestOccupied = i; break;
                }
            }
            if (highestOccupied >= 0 && dieValue > 24 - highestOccupied && !moves.some(m => m.to === -2)) {
                moves.push({ from: highestOccupied, to: -2 });
            }
        }
    }

    return moves;
}

// ─── SVG Board Components ───

const BOARD_W = 380;
const BOARD_H = 300;
const FRAME = 10;
const BAR_W = 20;
const POINT_W = (BOARD_W - 2 * FRAME - BAR_W) / 12;
const HALF_H = (BOARD_H - 2 * FRAME) / 2;
const CHECKER_R = Math.min(POINT_W * 0.42, 12);

const COLOR_FRAME = "#2a2016";
const COLOR_FRAME_INNER = "#3d2e1e";
const COLOR_BOARD = "#e8d5a8";
const COLOR_BAR = "#c4a66a";
const COLOR_TRI_DARK = "#8b5e3c";
const COLOR_TRI_LIGHT = "#d4b68c";
const COLOR_WHITE_PIECE = "#f5f5f5";
const COLOR_WHITE_STROKE = "#bbb";
const COLOR_BLACK_PIECE = "#1a1a1a";
const COLOR_BLACK_STROKE = "#444";

function TriangleSvg({ x, isTop, colorIdx }: { x: number; isTop: boolean; colorIdx: number }) {
    const fill = colorIdx % 2 === 0 ? COLOR_TRI_DARK : COLOR_TRI_LIGHT;
    const triH = HALF_H - 8;
    if (isTop) {
        const points = `${x},${FRAME} ${x + POINT_W},${FRAME} ${x + POINT_W / 2},${FRAME + triH}`;
        return <polygon points={points} fill={fill} />;
    } else {
        const y0 = BOARD_H - FRAME;
        const points = `${x},${y0} ${x + POINT_W},${y0} ${x + POINT_W / 2},${y0 - triH}`;
        return <polygon points={points} fill={fill} />;
    }
}

function CheckerSvg({ cx, cy, color, isSelected, isTarget, onClick }: {
    cx: number; cy: number; color: string;
    isSelected?: boolean; isTarget?: boolean; onClick?: () => void;
}) {
    const fill = color === "w" ? COLOR_WHITE_PIECE : COLOR_BLACK_PIECE;
    const stroke = color === "w" ? COLOR_WHITE_STROKE : COLOR_BLACK_STROKE;
    return (
        <g onClick={onClick} style={onClick ? { cursor: "pointer" } : undefined}>
            <circle cx={cx} cy={cy} r={CHECKER_R} fill={fill} stroke={stroke} strokeWidth={1.5} />
            {isSelected && <circle cx={cx} cy={cy} r={CHECKER_R + 2} fill="none" stroke="#facc15" strokeWidth={2} />}
            {isTarget && <circle cx={cx} cy={cy} r={CHECKER_R + 2} fill="none" stroke="#4ade80" strokeWidth={2} strokeDasharray="3 2" />}
        </g>
    );
}

function DiceIcon({ value, size = 32 }: { value: number; size?: number }) {
    const dots: [number, number][] = [];
    const positions: Record<number, [number, number][]> = {
        1: [[16, 16]],
        2: [[8, 8], [24, 24]],
        3: [[8, 8], [16, 16], [24, 24]],
        4: [[8, 8], [24, 8], [8, 24], [24, 24]],
        5: [[8, 8], [24, 8], [16, 16], [8, 24], [24, 24]],
        6: [[8, 8], [24, 8], [8, 16], [24, 16], [8, 24], [24, 24]],
    };
    if (value >= 1 && value <= 6) dots.push(...positions[value]);

    return (
        <svg width={size} height={size} viewBox="0 0 32 32">
            <rect x="1" y="1" width="30" height="30" rx="4" fill="#f5f0e6" stroke="#8b7355" strokeWidth="1.5" />
            {dots.map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r="3" fill="#1a1a1a" />
            ))}
        </svg>
    );
}

// ─── Component ───

interface BackgammonGameProps {
    gameState: BackgammonState;
    messageId: number;
    chatId: string;
}

export default function BackgammonGame({ gameState, messageId, chatId }: BackgammonGameProps) {
    const myBrowserId = getBrowserId();
    const { socket } = useChat();
    const [selectedPoint, setSelectedPoint] = useState<number | null>(null);

    const myPlayerNum = (() => {
        if (myBrowserId === gameState.p1) return 1;
        if (myBrowserId === gameState.p2) return 2;
        if (gameState.p2 === "?" && myBrowserId !== gameState.p1) return 2;
        return 0;
    })();

    const isMyTurn = gameState.winner === 0 && gameState.turn === myPlayerNum;
    const needsRoll = isMyTurn && gameState.remainingMoves.length === 0;
    const canMove = isMyTurn && gameState.remainingMoves.length > 0;

    // Get all valid moves for current remaining dice
    const allValidMoves = canMove
        ? gameState.remainingMoves.flatMap(d => getValidMoves(gameState, myPlayerNum, d))
        : [];

    // Valid targets for selected point
    const validTargets = selectedPoint !== null
        ? allValidMoves.filter(m => m.from === selectedPoint).map(m => m.to)
        : [];

    // Points that have valid moves from them

    const handleRoll = () => {
        if (!needsRoll) return;
        socket?.emit("backgammon_roll", {
            chatId,
            messageId,
            browserId: myBrowserId,
        });
    };

    const handlePointClick = (pointIndex: number) => {
        if (!canMove) return;

        if (selectedPoint === null) {
            const hasMovesFrom = allValidMoves.some(m => m.from === pointIndex);
            if (hasMovesFrom) setSelectedPoint(pointIndex);
        } else if (selectedPoint === pointIndex) {
            setSelectedPoint(null);
        } else {
            if (validTargets.includes(pointIndex)) {
                socket?.emit("backgammon_move", {
                    chatId,
                    messageId,
                    from: selectedPoint,
                    to: pointIndex,
                    browserId: myBrowserId,
                });
                setSelectedPoint(null);
            } else {
                const hasMovesFrom = allValidMoves.some(m => m.from === pointIndex);
                if (hasMovesFrom) setSelectedPoint(pointIndex);
                else setSelectedPoint(null);
            }
        }
    };

    const handleBarClick = () => {
        if (!canMove) return;
        const bar = myPlayerNum === 1 ? gameState.barWhite : gameState.barBlack;
        if (bar > 0) {
            if (selectedPoint === -1) {
                setSelectedPoint(null);
            } else {
                const hasMovesFromBar = allValidMoves.some(m => m.from === -1);
                if (hasMovesFromBar) setSelectedPoint(-1);
            }
        }
    };

    const handleBearOff = () => {
        if (!canMove || selectedPoint === null) return;
        if (validTargets.includes(-2)) {
            socket?.emit("backgammon_move", {
                chatId,
                messageId,
                from: selectedPoint,
                to: -2,
                browserId: myBrowserId,
            });
            setSelectedPoint(null);
        }
    };

    // Board layout depends on player perspective
    // P1 (white): top row 12-23, bottom row 11-0  (white home = bottom right)
    // P2 (black): 180° rotation — top row 0-11, bottom row 23-12  (black home = bottom left)
    const isRotated = myPlayerNum === 2;
    const topLeft = isRotated ? [0, 1, 2, 3, 4, 5] : [12, 13, 14, 15, 16, 17];
    const topRight = isRotated ? [6, 7, 8, 9, 10, 11] : [18, 19, 20, 21, 22, 23];
    const bottomLeft = isRotated ? [23, 22, 21, 20, 19, 18] : [11, 10, 9, 8, 7, 6];
    const bottomRight = isRotated ? [17, 16, 15, 14, 13, 12] : [5, 4, 3, 2, 1, 0];

    // Calculate point X positions
    const getPointX = (col: number, isRight: boolean): number => {
        const baseX = FRAME + (isRight ? 6 * POINT_W + BAR_W : 0) + col * POINT_W;
        return baseX;
    };

    // Calculate checker positions on a point
    const getCheckerPositions = (pointIdx: number, isTop: boolean, count: number) => {
        const positions: { cx: number; cy: number }[] = [];
        const maxStack = 5;
        const display = Math.min(count, maxStack);

        // Find which column this point is in
        let col = -1;
        let isRight = false;
        if (topLeft.includes(pointIdx)) {
            col = topLeft.indexOf(pointIdx);
            isRight = false;
        } else if (topRight.includes(pointIdx)) {
            col = topRight.indexOf(pointIdx);
            isRight = true;
        } else if (bottomLeft.includes(pointIdx)) {
            col = bottomLeft.indexOf(pointIdx);
            isRight = false;
        } else if (bottomRight.includes(pointIdx)) {
            col = bottomRight.indexOf(pointIdx);
            isRight = true;
        }

        const cx = getPointX(col, isRight) + POINT_W / 2;
        const spacing = Math.min(CHECKER_R * 2, (HALF_H - 16) / Math.max(display, 1));

        for (let i = 0; i < display; i++) {
            const cy = isTop
                ? FRAME + CHECKER_R + 4 + i * spacing
                : BOARD_H - FRAME - CHECKER_R - 4 - i * spacing;
            positions.push({ cx, cy });
        }
        return positions;
    };

    // Determine if a point is in top or bottom half
    const isTopPoint = (idx: number) => topLeft.includes(idx) || topRight.includes(idx);

    let statusText: string;
    let statusColor = "text-gray-400";
    if (gameState.winner === 1) {
        statusText = gameState.p1 === myBrowserId ? "🏆 You won!" : "⚪ White wins!";
        statusColor = gameState.p1 === myBrowserId ? "text-yellow-400" : "text-gray-300";
    } else if (gameState.winner === 2) {
        statusText = gameState.p2 === myBrowserId ? "🏆 You won!" : "⚫ Black wins!";
        statusColor = gameState.p2 === myBrowserId ? "text-yellow-400" : "text-gray-300";
    } else if (gameState.p2 === "?") {
        statusText = gameState.p1 === myBrowserId
            ? "⏳ Waiting for opponent..."
            : "🎮 Roll dice to join!";
    } else if (needsRoll) {
        statusText = "🎲 Tap to roll dice!";
        statusColor = "text-white";
    } else if (canMove) {
        statusText = `Your turn • Moves left: ${gameState.remainingMoves.join(", ")}`;
        statusColor = "text-white";
    } else {
        statusText = `Opponent's turn`;
    }

    return (
        <div className="select-none">
            <div className="text-center mb-2">
                <div className="text-xs font-semibold tracking-wider uppercase text-gray-500 mb-0.5">
                    🎲 Backgammon
                </div>
                <div className="flex items-center justify-center gap-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                        ⚪ {gameState.p1 === myBrowserId ? "You" : "P1"} ({gameState.offWhite}/15)
                    </span>
                    <span className="text-gray-600">vs</span>
                    <span className="flex items-center gap-1">
                        ⚫ {gameState.p2 === "?" ? "???" : gameState.p2 === myBrowserId ? "You" : "P2"} ({gameState.offBlack}/15)
                    </span>
                </div>
            </div>

            {/* Dice display */}
            {gameState.dice[0] > 0 && (
                <div className="flex items-center justify-center gap-2 mb-2">
                    <DiceIcon value={gameState.dice[0]} size={28} />
                    <DiceIcon value={gameState.dice[1]} size={28} />
                    {gameState.remainingMoves.length > 0 && (
                        <span className="text-xs text-gray-400 ml-2">
                            Left: {gameState.remainingMoves.join(",")}
                        </span>
                    )}
                </div>
            )}

            {/* SVG Board */}
            <div className="flex justify-center">
                <svg
                    width={BOARD_W}
                    height={BOARD_H}
                    viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
                    className="rounded-lg"
                    style={{ maxWidth: "100%" }}
                >
                    {/* Outer frame */}
                    <rect x={0} y={0} width={BOARD_W} height={BOARD_H} rx={8} fill={COLOR_FRAME} />
                    {/* Inner frame */}
                    <rect x={FRAME / 2} y={FRAME / 2} width={BOARD_W - FRAME} height={BOARD_H - FRAME} rx={4} fill={COLOR_FRAME_INNER} />
                    {/* Board surface */}
                    <rect x={FRAME} y={FRAME} width={BOARD_W - 2 * FRAME} height={BOARD_H - 2 * FRAME} fill={COLOR_BOARD} />

                    {/* Center bar */}
                    <rect
                        x={FRAME + 6 * POINT_W}
                        y={FRAME}
                        width={BAR_W}
                        height={BOARD_H - 2 * FRAME}
                        fill={COLOR_BAR}
                        stroke={COLOR_FRAME_INNER}
                        strokeWidth={1}
                    />

                    {/* Triangles - top row */}
                    {topLeft.map((idx, col) => (
                        <g key={`tt-${idx}`} onClick={() => handlePointClick(idx)} style={{ cursor: canMove ? "pointer" : "default" }}>
                            <TriangleSvg x={getPointX(col, false)} isTop={true} colorIdx={col} />
                            {/* Clickable overlay */}
                            <rect x={getPointX(col, false)} y={FRAME} width={POINT_W} height={HALF_H} fill="transparent" />
                        </g>
                    ))}
                    {topRight.map((idx, col) => (
                        <g key={`tt-${idx}`} onClick={() => handlePointClick(idx)} style={{ cursor: canMove ? "pointer" : "default" }}>
                            <TriangleSvg x={getPointX(col, true)} isTop={true} colorIdx={col + 1} />
                            <rect x={getPointX(col, true)} y={FRAME} width={POINT_W} height={HALF_H} fill="transparent" />
                        </g>
                    ))}

                    {/* Triangles - bottom row */}
                    {bottomLeft.map((idx, col) => (
                        <g key={`tb-${idx}`} onClick={() => handlePointClick(idx)} style={{ cursor: canMove ? "pointer" : "default" }}>
                            <TriangleSvg x={getPointX(col, false)} isTop={false} colorIdx={col} />
                            <rect x={getPointX(col, false)} y={FRAME + HALF_H} width={POINT_W} height={HALF_H} fill="transparent" />
                        </g>
                    ))}
                    {bottomRight.map((idx, col) => (
                        <g key={`tb-${idx}`} onClick={() => handlePointClick(idx)} style={{ cursor: canMove ? "pointer" : "default" }}>
                            <TriangleSvg x={getPointX(col, true)} isTop={false} colorIdx={col + 1} />
                            <rect x={getPointX(col, true)} y={FRAME + HALF_H} width={POINT_W} height={HALF_H} fill="transparent" />
                        </g>
                    ))}

                    {/* Valid target indicators */}
                    {validTargets.filter(t => t >= 0).map(t => {
                        const isTop = isTopPoint(t);
                        const pt = gameState.points[t];
                        const positions = getCheckerPositions(t, isTop, Math.max(pt.count, 0));
                        // Show indicator at the next stack position
                        const lastPos = positions.length > 0 ? positions[positions.length - 1] : null;
                        let cx: number, cy: number;
                        if (lastPos && pt.count > 0) {
                            const spacing = Math.min(CHECKER_R * 2, (HALF_H - 16) / Math.max(Math.min(pt.count + 1, 5), 1));
                            cx = lastPos.cx;
                            cy = isTop ? lastPos.cy + spacing : lastPos.cy - spacing;
                        } else {
                            // Empty point
                            const posArr = getCheckerPositions(t, isTop, 1);
                            cx = posArr[0]?.cx ?? 0;
                            cy = posArr[0]?.cy ?? 0;
                        }
                        return (
                            <circle
                                key={`target-${t}`}
                                cx={cx}
                                cy={cy}
                                r={CHECKER_R}
                                fill="rgba(74, 222, 128, 0.3)"
                                stroke="#4ade80"
                                strokeWidth={1.5}
                                strokeDasharray="3 2"
                                onClick={() => handlePointClick(t)}
                                style={{ cursor: "pointer" }}
                            />
                        );
                    })}

                    {/* Checkers on points */}
                    {[...topLeft, ...topRight, ...bottomLeft, ...bottomRight].map(idx => {
                        const pt = gameState.points[idx];
                        if (pt.count === 0) return null;
                        const isTop = isTopPoint(idx);
                        const positions = getCheckerPositions(idx, isTop, pt.count);
                        return (
                            <g key={`checkers-${idx}`}>
                                {positions.map((pos, i) => (
                                    <CheckerSvg
                                        key={i}
                                        cx={pos.cx}
                                        cy={pos.cy}
                                        color={pt.color}
                                        isSelected={selectedPoint === idx && i === positions.length - 1}
                                        onClick={() => handlePointClick(idx)}
                                    />
                                ))}
                                {pt.count > 5 && (
                                    <text
                                        x={positions[positions.length - 1].cx}
                                        y={positions[positions.length - 1].cy + 4}
                                        textAnchor="middle"
                                        fontSize="9"
                                        fontWeight="bold"
                                        fill={pt.color === "w" ? "#333" : "#fff"}
                                    >
                                        {pt.count}
                                    </text>
                                )}
                            </g>
                        );
                    })}

                    {/* Bar pieces */}
                    {gameState.barWhite > 0 && (
                        <g onClick={handleBarClick} style={{ cursor: canMove ? "pointer" : "default" }}>
                            <CheckerSvg
                                cx={FRAME + 6 * POINT_W + BAR_W / 2}
                                cy={isRotated ? BOARD_H / 2 + 14 : BOARD_H / 2 - 14}
                                color="w"
                                isSelected={selectedPoint === -1 && myPlayerNum === 1}
                            />
                            {gameState.barWhite > 1 && (
                                <text
                                    x={FRAME + 6 * POINT_W + BAR_W / 2}
                                    y={isRotated ? BOARD_H / 2 + 18 : BOARD_H / 2 - 10}
                                    textAnchor="middle"
                                    fontSize="8"
                                    fontWeight="bold"
                                    fill="#333"
                                >{gameState.barWhite}</text>
                            )}
                        </g>
                    )}
                    {gameState.barBlack > 0 && (
                        <g onClick={handleBarClick} style={{ cursor: canMove ? "pointer" : "default" }}>
                            <CheckerSvg
                                cx={FRAME + 6 * POINT_W + BAR_W / 2}
                                cy={isRotated ? BOARD_H / 2 - 14 : BOARD_H / 2 + 14}
                                color="b"
                                isSelected={selectedPoint === -1 && myPlayerNum === 2}
                            />
                            {gameState.barBlack > 1 && (
                                <text
                                    x={FRAME + 6 * POINT_W + BAR_W / 2}
                                    y={isRotated ? BOARD_H / 2 - 10 : BOARD_H / 2 + 18}
                                    textAnchor="middle"
                                    fontSize="8"
                                    fontWeight="bold"
                                    fill="#fff"
                                >{gameState.barBlack}</text>
                            )}
                        </g>
                    )}

                    {/* Borne off indicators */}
                    {gameState.offWhite > 0 && (
                        <g>
                            {Array.from({ length: Math.min(gameState.offWhite, 15) }, (_, i) => (
                                <rect
                                    key={`off-w-${i}`}
                                    x={isRotated ? FRAME + 5 - POINT_W : FRAME + 12 * POINT_W + BAR_W + 3}
                                    y={isRotated ? FRAME + 4 + i * 8 : BOARD_H - FRAME - 4 - i * 8}
                                    width={POINT_W - 8}
                                    height={6}
                                    rx={2}
                                    fill={COLOR_WHITE_PIECE}
                                    stroke={COLOR_WHITE_STROKE}
                                    strokeWidth={0.5}
                                />
                            ))}
                        </g>
                    )}
                    {gameState.offBlack > 0 && (
                        <g>
                            {Array.from({ length: Math.min(gameState.offBlack, 15) }, (_, i) => (
                                <rect
                                    key={`off-b-${i}`}
                                    x={isRotated ? FRAME + 5 - POINT_W : FRAME + 12 * POINT_W + BAR_W + 3}
                                    y={isRotated ? BOARD_H - FRAME - 4 - i * 8 : FRAME + 4 + i * 8}
                                    width={POINT_W - 8}
                                    height={6}
                                    rx={2}
                                    fill={COLOR_BLACK_PIECE}
                                    stroke={COLOR_BLACK_STROKE}
                                    strokeWidth={0.5}
                                />
                            ))}
                        </g>
                    )}

                    {/* Point number labels */}
                    {topLeft.map((idx, col) => (
                        <text key={`lbl-t-${idx}`} x={getPointX(col, false) + POINT_W / 2} y={FRAME - 1} textAnchor="middle" fontSize="6" fill="#999">{idx}</text>
                    ))}
                    {topRight.map((idx, col) => (
                        <text key={`lbl-t-${idx}`} x={getPointX(col, true) + POINT_W / 2} y={FRAME - 1} textAnchor="middle" fontSize="6" fill="#999">{idx}</text>
                    ))}
                    {bottomLeft.map((idx, col) => (
                        <text key={`lbl-b-${idx}`} x={getPointX(col, false) + POINT_W / 2} y={BOARD_H - FRAME + 8} textAnchor="middle" fontSize="6" fill="#999">{idx}</text>
                    ))}
                    {bottomRight.map((idx, col) => (
                        <text key={`lbl-b-${idx}`} x={getPointX(col, true) + POINT_W / 2} y={BOARD_H - FRAME + 8} textAnchor="middle" fontSize="6" fill="#999">{idx}</text>
                    ))}
                </svg>
            </div>

            {/* Bear off button */}
            {canMove && validTargets.includes(-2) && (
                <div className="text-center mt-1.5">
                    <button
                        onClick={handleBearOff}
                        className="px-4 py-1.5 text-xs font-semibold text-white rounded-lg transition-all hover:scale-105 active:scale-95 shadow-md"
                        style={{ background: "linear-gradient(135deg, #22c55e, #16a34a)" }}
                    >
                        ✓ Bear Off
                    </button>
                </div>
            )}

            {/* Roll button */}
            {needsRoll && (
                <div className="text-center mt-2">
                    <button
                        onClick={handleRoll}
                        className="px-5 py-2 text-sm font-semibold text-white rounded-xl transition-all hover:scale-105 active:scale-95 shadow-lg"
                        style={{ background: "linear-gradient(135deg, #8b5e3c, #6b4226)" }}
                    >
                        🎲 Roll Dice
                    </button>
                </div>
            )}

            {/* Join button */}
            {gameState.p2 === "?" && myPlayerNum !== 1 && (
                <div className="text-center mt-2">
                    <button
                        onClick={handleRoll}
                        className="px-5 py-2 text-sm font-semibold text-white rounded-xl transition-all hover:scale-105 active:scale-95 shadow-lg"
                        style={{ background: "linear-gradient(135deg, #22c55e, #16a34a)" }}
                    >
                        🎮 Join Game
                    </button>
                </div>
            )}

            <div className={`text-center text-xs mt-2 font-medium ${statusColor}`}>
                {statusText}
            </div>
        </div>
    );
}
