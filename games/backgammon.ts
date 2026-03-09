// ─── Backgammon game logic (server-side) ───
import crypto from "crypto";
// Format: GAME::BACKGAMMON::{p1}:{p2}:{points}:{turn}:{dice}:{bar}:{off}:{winner}:{movePhase}
// points: 24 colon-separated values like "w3" (3 white), "b2" (2 black), "0" (empty)
// turn: 1=white(p1), 2=black(p2)
// dice: e.g. "3,5" or "0,0" if not rolled
// bar: "w0b0" (pieces on bar)
// off: "w0b0" (pieces borne off)
// winner: 0=none, 1=p1 wins, 2=p2 wins
// movePhase: remaining dice moves e.g. "3,5" or "" if done

const NUM_POINTS = 24;

export interface BackgammonState {
    p1: string;
    p2: string;
    points: { color: string; count: number }[]; // 24 points, color='w'|'b'|'', count
    turn: number; // 1 or 2
    dice: number[]; // current dice roll
    barWhite: number;
    barBlack: number;
    offWhite: number;
    offBlack: number;
    winner: number;
    remainingMoves: number[]; // dice values remaining to be used
}

export function parseBackgammon(text: string): BackgammonState | null {
    if (!text.startsWith("GAME::BACKGAMMON::")) return null;
    const parts = text.slice("GAME::BACKGAMMON::".length).split(":");
    if (parts.length < 9) return null;

    const p1 = parts[0];
    const p2 = parts[1];

    // Parse points (24 values separated by commas)
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
    
    // Parse bar
    const barMatch = parts[5].match(/w(\d+)b(\d+)/);
    const barWhite = barMatch ? parseInt(barMatch[1]) : 0;
    const barBlack = barMatch ? parseInt(barMatch[2]) : 0;

    // Parse off
    const offMatch = parts[6].match(/w(\d+)b(\d+)/);
    const offWhite = offMatch ? parseInt(offMatch[1]) : 0;
    const offBlack = offMatch ? parseInt(offMatch[2]) : 0;

    const winner = parseInt(parts[7]) || 0;
    const remainingMoves = parts[8] ? parts[8].split(",").filter(s => s).map(Number) : [];

    return { p1, p2, points, turn, dice, barWhite, barBlack, offWhite, offBlack, winner, remainingMoves };
}

export function serializeBackgammon(s: BackgammonState): string {
    const pointsStr = s.points.map(p => p.count === 0 ? "0" : `${p.color}${p.count}`).join(",");
    const dice = s.dice.join(",");
    const bar = `w${s.barWhite}b${s.barBlack}`;
    const off = `w${s.offWhite}b${s.offBlack}`;
    const remaining = s.remainingMoves.join(",");
    return `GAME::BACKGAMMON::${s.p1}:${s.p2}:${pointsStr}:${s.turn}:${dice}:${bar}:${off}:${s.winner}:${remaining}`;
}

function playerColor(playerNum: number): string {
    return playerNum === 1 ? "w" : "b";
}

function opponentColor(playerNum: number): string {
    return playerNum === 1 ? "b" : "w";
}

// Check if a player can bear off (all pieces in home board or already off)
function canBearOff(state: BackgammonState, playerNum: number): boolean {
    const color = playerColor(playerNum);
    const bar = playerNum === 1 ? state.barWhite : state.barBlack;
    if (bar > 0) return false;

    // Home board for white is points 0-5 (indices 0-5), for black is points 18-23 (indices 18-23)
    if (playerNum === 1) {
        // White home = points 0..5
        for (let i = 6; i < 24; i++) {
            if (state.points[i].color === color && state.points[i].count > 0) return false;
        }
    } else {
        // Black home = points 18..23
        for (let i = 0; i < 18; i++) {
            if (state.points[i].color === color && state.points[i].count > 0) return false;
        }
    }
    return true;
}

export function backgammonGetValidMoves(state: BackgammonState, playerNum: number, dieValue: number): { from: number; to: number }[] {
    const color = playerColor(playerNum);
    const opp = opponentColor(playerNum);
    const moves: { from: number; to: number }[] = [];
    const bar = playerNum === 1 ? state.barWhite : state.barBlack;

    if (bar > 0) {
        // Must enter from bar first
        // White enters at point 23-dieValue+1 (index 24-dieValue), black enters at dieValue-1
        const target = playerNum === 1 ? 24 - dieValue : dieValue - 1;
        if (target >= 0 && target < 24) {
            const pt = state.points[target];
            if (pt.color !== opp || pt.count <= 1) {
                moves.push({ from: -1, to: target }); // -1 = from bar
            }
        }
        return moves; // Must enter from bar first, no other moves allowed
    }

    // Normal moves
    for (let i = 0; i < 24; i++) {
        if (state.points[i].color !== color || state.points[i].count === 0) continue;

        // White moves from high to low index, black from low to high
        const target = playerNum === 1 ? i - dieValue : i + dieValue;

        if (target >= 0 && target < 24) {
            const pt = state.points[target];
            if (pt.color !== opp || pt.count <= 1) {
                moves.push({ from: i, to: target });
            }
        }
    }

    // Bearing off
    if (canBearOff(state, playerNum)) {
        if (playerNum === 1) {
            // White bears off from points 0..5
            // Exact: piece on point dieValue-1
            if (state.points[dieValue - 1]?.color === color && state.points[dieValue - 1]?.count > 0) {
                moves.push({ from: dieValue - 1, to: -2 }); // -2 = bear off
            }
            // If no exact, can bear off highest piece if die > highest occupied point+1
            let highestOccupied = -1;
            for (let i = 5; i >= 0; i--) {
                if (state.points[i].color === color && state.points[i].count > 0) {
                    highestOccupied = i;
                    break;
                }
            }
            if (highestOccupied >= 0 && dieValue > highestOccupied + 1) {
                if (state.points[highestOccupied].color === color && state.points[highestOccupied].count > 0) {
                    // Only if no exact bearing off move was found
                    if (!moves.some(m => m.to === -2)) {
                        moves.push({ from: highestOccupied, to: -2 });
                    }
                }
            }
        } else {
            // Black bears off from points 18..23
            const bearOffPoint = 24 - dieValue;
            if (bearOffPoint >= 18 && bearOffPoint < 24 && state.points[bearOffPoint]?.color === color && state.points[bearOffPoint]?.count > 0) {
                moves.push({ from: bearOffPoint, to: -2 });
            }
            let highestOccupied = -1;
            for (let i = 18; i < 24; i++) {
                if (state.points[i].color === color && state.points[i].count > 0) {
                    highestOccupied = i;
                    break;
                }
            }
            if (highestOccupied >= 0 && dieValue > 24 - highestOccupied) {
                if (!moves.some(m => m.to === -2)) {
                    moves.push({ from: highestOccupied, to: -2 });
                }
            }
        }
    }

    return moves;
}

export function backgammonRollDice(state: BackgammonState, playerNum: number): BackgammonState | null {
    if (state.winner !== 0) return null;
    if (state.turn !== playerNum) return null;
    if (state.remainingMoves.length > 0) return null; // Already rolled

    const d1 = crypto.randomInt(1, 7);
    const d2 = crypto.randomInt(1, 7);
    const dice = [d1, d2];

    // Doubles = 4 moves
    const remaining = d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];

    // Check if any moves are possible
    let hasMoves = false;
    for (const die of remaining) {
        if (backgammonGetValidMoves(state, playerNum, die).length > 0) {
            hasMoves = true;
            break;
        }
    }

    if (!hasMoves) {
        // No moves possible, skip turn
        return {
            ...state,
            dice,
            remainingMoves: [],
            turn: playerNum === 1 ? 2 : 1,
        };
    }

    return { ...state, dice, remainingMoves: remaining };
}

export function backgammonApplyMove(state: BackgammonState, from: number, to: number, playerNum: number): BackgammonState | null {
    if (state.winner !== 0) return null;
    if (state.turn !== playerNum) return null;
    if (state.remainingMoves.length === 0) return null;

    const color = playerColor(playerNum);
    const opp = opponentColor(playerNum);

    // Calculate die value needed for this move
    let dieValue: number;
    if (from === -1) {
        // From bar
        dieValue = playerNum === 1 ? 24 - to : to + 1;
    } else if (to === -2) {
        // Bearing off
        dieValue = playerNum === 1 ? from + 1 : 24 - from;
    } else {
        dieValue = playerNum === 1 ? from - to : to - from;
    }

    // Find and consume the die
    const dieIdx = state.remainingMoves.indexOf(dieValue);
    if (dieIdx === -1) {
        // For bearing off with higher die, check if any higher die works
        if (to === -2 && canBearOff(state, playerNum)) {
            const higherDie = state.remainingMoves.find(d => d > dieValue);
            if (higherDie !== undefined) {
                dieValue = higherDie;
                const idx = state.remainingMoves.indexOf(higherDie);
                if (idx === -1) return null;
                // Will use idx below
            } else {
                return null;
            }
        } else {
            return null;
        }
    }

    // Validate move
    const validMoves = backgammonGetValidMoves(state, playerNum, dieValue);
    if (!validMoves.some(m => m.from === from && m.to === to)) return null;

    // Apply move
    const newPoints = state.points.map(p => ({ ...p }));
    let newBarWhite = state.barWhite;
    let newBarBlack = state.barBlack;
    let newOffWhite = state.offWhite;
    let newOffBlack = state.offBlack;

    // Remove from source
    if (from === -1) {
        if (playerNum === 1) newBarWhite--;
        else newBarBlack--;
    } else {
        newPoints[from].count--;
        if (newPoints[from].count === 0) newPoints[from].color = "";
    }

    // Place at destination
    if (to === -2) {
        // Bearing off
        if (playerNum === 1) newOffWhite++;
        else newOffBlack++;
    } else {
        // Check for hitting opponent
        if (newPoints[to].color === opp && newPoints[to].count === 1) {
            newPoints[to].count = 0;
            newPoints[to].color = "";
            if (opp === "w") newBarWhite++;
            else newBarBlack++;
        }
        newPoints[to].count++;
        newPoints[to].color = color;
    }

    // Remove used die
    const newRemaining = [...state.remainingMoves];
    const usedIdx = newRemaining.indexOf(dieValue);
    if (usedIdx !== -1) newRemaining.splice(usedIdx, 1);

    // Check win
    let winner = 0;
    if (newOffWhite === 15) winner = 1;
    else if (newOffBlack === 15) winner = 2;

    // Check if remaining moves are possible
    let nextTurn = state.turn;
    if (newRemaining.length === 0 || winner !== 0) {
        nextTurn = playerNum === 1 ? 2 : 1;
        if (winner !== 0) nextTurn = state.turn;
    } else {
        // Check if any remaining die has valid moves
        const tempState: BackgammonState = {
            ...state,
            points: newPoints,
            barWhite: newBarWhite,
            barBlack: newBarBlack,
            offWhite: newOffWhite,
            offBlack: newOffBlack,
            remainingMoves: newRemaining,
        };
        let hasRemainingMoves = false;
        for (const die of newRemaining) {
            if (backgammonGetValidMoves(tempState, playerNum, die).length > 0) {
                hasRemainingMoves = true;
                break;
            }
        }
        if (!hasRemainingMoves) {
            nextTurn = playerNum === 1 ? 2 : 1;
        }
    }

    return {
        ...state,
        points: newPoints,
        barWhite: newBarWhite,
        barBlack: newBarBlack,
        offWhite: newOffWhite,
        offBlack: newOffBlack,
        remainingMoves: nextTurn !== state.turn ? [] : newRemaining,
        turn: nextTurn,
        dice: state.dice,
        winner,
    };
}
