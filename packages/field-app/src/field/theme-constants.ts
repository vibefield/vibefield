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
  `z-50 flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vf-select)] ${
    active
      ? "bg-neutral-800 text-white dark:bg-white dark:text-neutral-800"
      : "bg-white text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
  }`;

export const fabCls = (active: boolean) => `absolute ${roundButtonCls(active)}`;
