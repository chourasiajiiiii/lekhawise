/** A piece of recognised text and where it is on the photo (any unit, top-left origin), if known. */
export type TextPiece = {
  text: string;
  box: { left: number; top: number; right: number; bottom: number } | null;
};

/**
 * Turns recognised pieces into one line per printed row, top to bottom. Text recognition often splits a row
 * into several pieces (widely spaced letters, or an item name and its price far apart); pieces whose heights
 * overlap by at least half are the same row and are joined left to right, so labels stay next to their amounts.
 * Pieces without a position are kept at the end rather than dropped.
 */
export function joinRows(pieces: TextPiece[]): string[] {
  type Placed = TextPiece & { box: NonNullable<TextPiece['box']> };
  const placed = pieces
    .filter((piece): piece is Placed => piece.box !== null)
    .sort((a, b) => a.box.top + a.box.bottom - (b.box.top + b.box.bottom));

  const rows: { top: number; bottom: number; pieces: Placed[] }[] = [];
  for (const piece of placed) {
    const { top, bottom } = piece.box;
    const row = rows[rows.length - 1];
    if (row) {
      const overlap = Math.min(bottom, row.bottom) - Math.max(top, row.top);
      const smaller = Math.min(bottom - top, row.bottom - row.top);
      if (smaller > 0 && overlap * 2 >= smaller) {
        row.pieces.push(piece);
        row.top = Math.min(row.top, top);
        row.bottom = Math.max(row.bottom, bottom);
        continue;
      }
    }
    rows.push({ top, bottom, pieces: [piece] });
  }

  const lines = rows.map((row) =>
    row.pieces
      .sort((a, b) => a.box.left - b.box.left)
      .map((piece) => piece.text)
      .join(' '),
  );
  return [...lines, ...pieces.filter((piece) => piece.box === null).map((piece) => piece.text)];
}
