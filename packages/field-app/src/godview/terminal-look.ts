// THE TERMINAL'S OWN COLOURS (DESIGN.md §2.7 "The terminal's own colours"; TL-4c, 2026-11-19): the ground the deck
// draws its panes on when no catalog theme is picked for Godview's mode, and the sixteen the device is to tell every
// session it runs (item 590's second part tells them; until then they are data). The tokens are the authority
// (`--vf-godview-{light,dark}-terminal-bg` and `-terminal-ansi-0…15`); this is their twin in code, held to tokens.css
// by a row, because the deck's theme leaves the renderer as data and is never read back from a stylesheet. The ink,
// the cursor and the selection are the reference's (ghosttea's own Daylight and Midnight), as DESIGN.md says.

export type TerminalLookMode = "light" | "dark";

export interface TerminalLook {
  /** the ground, opaque: a pane's alpha is the viewer's */
  readonly ground: string;
  /** the sixteen, by index, each `#rrggbb` */
  readonly palette: readonly string[];
}

export const GODVIEW_TERMINAL_LOOK: Readonly<Record<TerminalLookMode, TerminalLook>> = {
  light: {
    ground: "#f1f0ee",
    palette: [
      "#1e2227",
      "#a9524d",
      "#38793c",
      "#976004",
      "#306fac",
      "#8d589a",
      "#007879",
      "#676c73",
      "#51565c",
      "#ad3232",
      "#006f1a",
      "#865400",
      "#0061aa",
      "#8b3f9c",
      "#006a6b",
      "#81868d",
    ],
  },
  dark: {
    ground: "#282c34",
    palette: [
      "#1d1f21",
      "#db7473",
      "#b5bd68",
      "#f0c674",
      "#81a2be",
      "#b294bb",
      "#8abeb7",
      "#c5c8c6",
      "#939292",
      "#ef6668",
      "#b9ca4a",
      "#e7c547",
      "#7aa6da",
      "#c397d8",
      "#70c0b1",
      "#eaeaea",
    ],
  },
};
