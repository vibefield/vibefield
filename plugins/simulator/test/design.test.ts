// DESIGN.md FIRST (James's Q-6; the PT-S1 brief): the phone's plugin holds no colour or material number DESIGN.md §5.1 lacks,
// and says no face's words §9 does not. This unit reads DESIGN.md itself — the phone's materials section and the simulator's
// faces table — and holds theme.ts (every finish, every ink, the sky the glass mirrors, the words' ink), the law's material
// knobs (the cover glass, the three metals, the screen's light and its dims, the night's glow, the marks), the one scale and
// face.ts's lines and acts to it, value for value. A number changed in the code alone, or in the book alone, is red here.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FACE_ACTS,
  FACE_LINES,
  MM,
  PHONE,
  SIMULATOR_FINISHES,
  SIMULATOR_PALETTE,
  type SimulatorTokens,
  VIEW_ONLY,
} from "../src";

const DESIGN = readFileSync(resolve(import.meta.dirname, "../../../DESIGN.md"), "utf8");

/** The text from a heading to the next heading of its level or above (or a rule). */
function section(heading: string): string {
  const at = DESIGN.indexOf(heading);
  if (at < 0) throw new Error(`DESIGN.md has no "${heading}"`);
  const rest = DESIGN.slice(at + heading.length);
  const end = rest.search(/\n(?:#{1,4} |---\n)/);
  return end < 0 ? rest : rest.slice(0, end);
}

const MATERIALS = section("#### The phone's materials");
const VOICE = section("**The simulator's honest faces**");
/** A row of a table in `text` whose first cell starts with `first`. */
const row = (text: string, first: string): string => {
  const line = text.split("\n").find((l) => l.startsWith(`| ${first}`));
  if (line === undefined) throw new Error(`no row "${first}"`);
  return line;
};

describe("DESIGN.md §5.1 holds every number the phone's look and law carry", () => {
  it("names the desk's one scale the phone draws at", () => {
    expect(MATERIALS).toContain(MM.toFixed(4));
  });

  it("holds every finish row for row: its band, its front, its polish — and no finish the code lacks", () => {
    const rows = MATERIALS.split("\n").filter((l) => /^\| `[a-z0-9-]+` \|/.test(l));
    expect(rows).toHaveLength(Object.keys(SIMULATOR_FINISHES).length);
    for (const [name, f] of Object.entries(SIMULATOR_FINISHES)) {
      const cells = row(MATERIALS, `\`${name}\``)
        .split("|")
        .map((c) => c.trim());
      // | `name` | launched on | `#band` | front | polish |
      expect(cells[3], name).toBe(`\`${f.css}\``);
      expect(cells[4], name).toBe(f.front);
      expect(cells[5], name).toBe(f.polish > 0 ? "mirror" : "—");
      expect(f.token, name).toContain(cells[2] ?? "");
    }
  });

  it("holds every ink of the phone's own dress in its recipes table", () => {
    const rows: Readonly<Record<keyof SimulatorTokens, string>> = {
      inkBlack: "border ink",
      inkWhite: "border ink",
      oledOff: "panel, off",
      lcdOff: "panel, off",
      housing: "sensor housing",
      lens: "sensor housing",
      lensRing: "sensor housing",
      mesh: "sensor housing",
      sky: "the sky the glass mirrors",
      leaves: "the sky the glass mirrors",
      room: "the sky the glass mirrors",
      nightSky: "the sky the glass mirrors",
      nightLeaves: "the sky the glass mirrors",
      words: "the words on a face",
    };
    for (const [key, first] of Object.entries(rows) as [keyof SimulatorTokens, string][])
      expect(row(MATERIALS, first), key).toContain(`\`${SIMULATOR_PALETTE[key].css}\``);
  });

  it("holds the law's material knobs: the cover glass, the three metals, the screen's light and dims, the night's glow, the marks", () => {
    const g = PHONE.glass;
    const glass = row(MATERIALS, "cover glass");
    for (const said of [
      `Fresnel ${g.f0}`,
      `glint ${g.glint}`,
      `shininess ${g.shininess}`,
      `canopy ${g.canopy}`,
      `veil ${g.veil}`,
      `window ${g.window}`,
      `${g.windowNight} of it`,
    ])
      expect(glass, said).toContain(said);
    for (const [metal, first] of [
      ["aluminium", "aluminium"],
      ["steel", "steel"],
      ["titanium", "titanium"],
    ] as const) {
      const m = PHONE.metal[metal];
      expect(row(MATERIALS, first)).toContain(
        `diffuse ${m.diffuse} · roughness ${m.rough} · glint ${m.glint}`,
      );
    }
    const d = PHONE.display;
    const light = row(MATERIALS, "the screen's light");
    for (const said of [
      `by day ${d.day}`,
      `by night ${d.night}`,
      `scatter ${d.scatter}`,
      `a still ${d.still}`,
      `under words ${d.stillUnder}`,
    ])
      expect(light, said).toContain(said);
    const gl = PHONE.glow;
    const glow = row(MATERIALS, "the night's glow");
    expect(glow).toContain(
      `glare ${gl.sigma[0]} mm and ${gl.sigma[1]} mm at ${gl.bloom[0]} and ${gl.bloom[1]}`,
    );
    expect(glow).toContain(`spill ${gl.spillSigma} mm at ${gl.spill}`);
    expect(glow).toContain(`edge ${gl.edge}`);
    const mk = PHONE.marks;
    const marks = row(MATERIALS, "the marks on a still");
    expect(marks).toContain(
      `two bars ${mk.bar[0]} mm wide and ${mk.bar[1]} mm tall, ${mk.bar[2]} mm apart`,
    );
    expect(marks).toContain(
      `a ring ${mk.ring[0]} mm across and ${mk.ring[1]} mm thick, open ${mk.ring[2]}°`,
    );
    expect(marks).toContain(`at ${mk.alpha}`);
  });
});

describe("DESIGN.md §9 says the faces' words, and the code quotes them exactly", () => {
  const NAME = "iPhone 17 Pro";

  it("quotes every line and every act from the faces table, row by row", () => {
    for (const [state, line] of Object.entries(FACE_LINES)) {
      const act = FACE_ACTS[state as keyof typeof FACE_ACTS];
      const first = state
        .replace("-", " ")
        .replace("no simulator", "no Simulator")
        .replace("at rest", "at rest");
      const r = row(VOICE, first);
      if (line !== null) expect(r, state).toContain(`"${line(NAME)}"`);
      if (act !== null) expect(r, state).toContain(`"${act}"`);
      else expect(r, state).toMatch(/\| — \|$/);
    }
  });

  it("says View only in hand", () => {
    expect(VOICE).toContain(`**${VIEW_ONLY}**`);
  });
});
