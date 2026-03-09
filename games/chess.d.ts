export interface ChessState {
    p1: string;
    p2: string;
    board: string[][];
    turn: string;
    winner: string;
    lastMove: string;
    castling: string;
    enPassant: string;
}
export declare function parseChess(text: string): ChessState | null;
export declare function serializeChess(s: ChessState): string;
export declare function chessGetLegalMoves(state: ChessState, row: number, col: number): [number, number][];
export declare function chessApplyMove(state: ChessState, fromRow: number, fromCol: number, toRow: number, toCol: number, promotion?: string): ChessState | null;
//# sourceMappingURL=chess.d.ts.map