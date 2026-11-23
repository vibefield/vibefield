import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { AgentIcon } from "@vibefield/puppeteer-view-sdk/react";
import { projectHue } from "@vibefield/puppeteer-view-sdk/toolkit";
import type { CSSProperties, ReactElement } from "react";
import "./work-marks.css";

// WL-1 (DESIGN.md §8 "Godview's work column", §2.9 "How it is drawn", 2026-11-23) — THE WORK COLUMN'S TWO MARKS, which
// search's Live now draws too: a project as the folder mark filled with its ink at a quarter and stroked in it (never
// a round dot, which reads as state), and an agent as its own mark, a bare terminal as `terminal`.

/** A project's mark: the folder, in `ink` filled at a quarter; with no ink, the plain folder in the ink it sits in. */
export function ProjectMark({
  ink,
  size,
}: {
  /** a CSS colour: the colour its bodies wear in Godview, or `projectInkOf` outside it */
  ink: string | undefined;
  size: number;
}): ReactElement {
  return ink === undefined ? (
    <FieldGlyph name="folder" size={size} />
  ) : (
    <FieldGlyph
      name="folder"
      size={size}
      className="vf-project-mark"
      style={{ color: ink } as CSSProperties}
    />
  );
}

/** A project's ink outside Godview's mode (the Peek): its bodies' hue, puppeteer's deal while the swarm keeps it
 * (§2.9's exception), on the surface's own lightness and chroma (`--vf-project-ink-l`, `-c`), as §2.9 lays every ink.
 * None without a sequence: the neutral. */
export function projectInkOf(seq: number | undefined): string | undefined {
  if (seq === undefined) return undefined;
  return `oklch(var(--vf-project-ink-l) var(--vf-project-ink-c) ${projectHue(seq).toFixed(1)})`;
}

/** An agent's mark at `size`: its own (`AgentIcon`, which draws at its text's size), or `terminal` for a bare one. */
export function AgentMark({
  id,
  shell,
  size,
}: {
  id: string;
  shell: boolean;
  size: number;
}): ReactElement {
  if (shell) return <FieldGlyph name="terminal" size={size} />;
  return (
    <span className="vf-agent-mark" style={{ fontSize: `${size}px` }} aria-hidden="true">
      <AgentIcon providerId={id} />
    </span>
  );
}
