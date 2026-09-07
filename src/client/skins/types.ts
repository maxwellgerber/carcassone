export interface Skin {
  id: string;
  name: string;
  blurb: string;
  /** CSS custom properties applied to :root while this skin is active. */
  ui: Record<string, string>;
  /** Board background gradient, top to bottom. */
  board: [string, string];
  /** Paints one canonical (unrotated) tile into a 200×200 coordinate space. Absent
   *  for the hand-drawn SVG skin, whose art is loaded rather than painted. */
  paint?: (ctx: CanvasRenderingContext2D, tileKey: string) => void;
  /** Paints one seamless 400×400 tile of the table surface (two board cells across),
   *  anchored to the world grid so it pans and zooms with the tiles. */
  table?: (ctx: CanvasRenderingContext2D) => void;
  /** Edge length of the table repeat in canonical units (200 per board cell). Default 400. */
  tableSize?: number;
}
