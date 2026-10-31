// The phone's catalog types (PHONE.md §2) — what one iPhone model IS, as data: its framebuffer, its display's shape, the
// sensor housing the display is cut round, its body, its buttons. Every length is millimetres — the desk is physical at the
// note's scale (law.ts `MM`) — except the framebuffer's own pixels and the points iOS lays out in. The numbers are Apple's:
// the screens, masks, sensor bars and chrome come from the Simulator's own device types (scripts/make-catalog.ts reads
// /Library/Developer/CoreSimulator and DeviceKit and writes catalog.gen.ts); the bodies are Apple's published dimensions.
// No colour lives here — a model names its finishes, and theme.ts says what they are (from DESIGN.md §5.1).

/** A rounded corner as Apple draws it: a continuous curve, fitted as a superellipse. */
export interface Corner {
  /** The radius a circle through the curve's 45° point would have — the number people quote. */
  readonly r45: number;
  /** How far from the corner the curve starts, along each edge (the superellipse's semi-axis). */
  readonly extent: number;
  /** The superellipse's exponent: 2 is a circle, higher is squarer. */
  readonly n: number;
}

/** What the display is cut round at its top edge. */
export type Cutout =
  | { readonly kind: "none" }
  /** A notch: the sensor housing hangs into the display — its half width, its depth, its bottom corners, the ears where it meets the top edge. */
  | {
      readonly kind: "notch";
      readonly half: number;
      readonly depth: number;
      readonly corner: Corner;
      readonly ear: number;
    }
  /** The Dynamic Island: a pill of black glass below the top edge. iOS draws it into the framebuffer itself (the Simulator's sensor bar is empty), so the stream carries it; the desk draws the glass and its lens. */
  | {
      readonly kind: "island";
      readonly width: number;
      readonly height: number;
      readonly top: number;
    };

/** The side of the body, seen from above: how the band and the glass meet. */
export type Edge = "round" | "flat" | "contour" | "chamfer";
export type BandMetal = "aluminium" | "steel" | "titanium";

export interface PhoneButton {
  readonly name: string;
  readonly side: "left" | "right";
  /** From the body's top edge to the button's top, and its length along the side. */
  readonly top: number;
  readonly length: number;
}

export interface PhoneModel {
  /** The CoreSimulator device type — what a booted Simulator says it is, and the phone's `model` prop. */
  readonly id: string;
  readonly name: string;
  /** The hardware model, e.g. iPhone18,1. */
  readonly product: string;
  readonly year: number;
  /** The DeviceKit chrome the Simulator draws round it. */
  readonly chrome: string;
  /** The iOS runtimes the Simulator will boot it on: [min, max] (max null = current). */
  readonly runtimes: readonly [string, string | null];
  readonly screen: {
    /** The framebuffer, portrait: what a frame of the stream is. */
    readonly px: readonly [number, number];
    /** Pixels per point, and the panel's pixels per inch. */
    readonly scale: number;
    readonly dpi: number;
    /** The active area. */
    readonly mm: readonly [number, number];
    /** The display's corner; null = a rectangular LCD (the home-button phones). */
    readonly corner: Corner | null;
  };
  readonly cutout: Cutout;
  readonly body: {
    /** Width, height, depth — Apple's published dimensions. */
    readonly mm: readonly [number, number, number];
    readonly corner: Corner;
    /** The glass's black (or white) border round the display: sides, then top and bottom (the home-button phones' are tall). */
    readonly bezel: readonly [number, number];
    readonly edge: Edge;
    readonly band: BandMetal;
    /** The rounded rim where the band turns into the glass, seen from above: its width and how far it falls. */
    readonly rim: readonly [number, number];
    /** How much of the rim is metal before the glass begins. */
    readonly metal: number;
    /** The camera on the back lifts the top of a phone lying face up: its height, and how far from the top edge it bears. */
    readonly bump: readonly [number, number];
  };
  /** The home button (the Touch ID ring), or null. */
  readonly home: { readonly diameter: number; readonly fromBottom: number } | null;
  readonly buttons: readonly PhoneButton[];
  /** The launch finishes, by name (theme.ts `SIMULATOR_FINISHES`); the first is the default. */
  readonly finishes: readonly string[];
  /** True where a number is ours, not Apple's (a model newer than the published dimensions we hold). */
  readonly assumed?: true;
}
