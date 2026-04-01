/** Single source of truth for brain node type colours.
 *  Imported by both the API route (server) and UI components (client).
 *  Add new node types here — they will automatically apply everywhere.
 */
export const NODE_COLORS: Record<string, string> = {
  artist:          "#ff1464",
  song:            "#ff6ba8",
  term_surface:    "#ff8c42",
  term_sense:      "#ffb347",
  rendering:       "#c084fc",
  motif:           "#38bdf8",
  symbol:          "#34d399",
  entity_instance: "#f472b6",
  entity_type:     "#fb7185",
  persona_style:   "#a78bfa",
};
