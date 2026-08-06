import { uiIconButtonClass } from "@vibefield/shell-ui";

// v1 theme constants + hex plumbing (widgetlab App.tsx verbatim), extracted
// from FieldView by 3b: BootRoot feeds the live token writes, CanvasStage
// derives the grid configuration, and the development tweak panel edits values.

export function hexToRgb01(hex: string): [number, number, number] {
  const s = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
  return [
    Number.parseInt(s.slice(0, 2), 16) / 255,
    Number.parseInt(s.slice(2, 4), 16) / 255,
    Number.parseInt(s.slice(4, 6), 16) / 255,
  ];
}

export function hexToRgb255(hex: string): string {
  const s = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
  return `${Number.parseInt(s.slice(0, 2), 16)}, ${Number.parseInt(s.slice(2, 4), 16)}, ${Number.parseInt(s.slice(4, 6), 16)}`;
}

export const roundButtonCls = (active: boolean) =>
  `${uiIconButtonClass} h-10 w-10${active ? " is-active" : ""}`;

export const fabCls = (active: boolean) => `absolute ${roundButtonCls(active)}`;
