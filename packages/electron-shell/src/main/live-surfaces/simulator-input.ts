import type { LiveSurfaceInputEventV1, LiveSurfaceLogicalSizeV1 } from "@vibefield/contracts";

export type SimulatorInput =
  | { kind: "touch"; phase: "down" | "move" | "up"; x: number; y: number }
  | { kind: "wheel"; x: number; y: number; dx: number; dy: number }
  | { kind: "key"; usage: number; down: boolean }
  | { kind: "home" | "release" };

const usages: Readonly<Record<string, number>> = {
  Enter: 40,
  Escape: 41,
  Backspace: 42,
  Tab: 43,
  Space: 44,
  Minus: 45,
  Equal: 46,
  BracketLeft: 47,
  BracketRight: 48,
  Backslash: 49,
  Semicolon: 51,
  Quote: 52,
  Backquote: 53,
  Comma: 54,
  Period: 55,
  Slash: 56,
  CapsLock: 57,
  Delete: 76,
  ArrowRight: 79,
  ArrowLeft: 80,
  ArrowDown: 81,
  ArrowUp: 82,
  ControlLeft: 224,
  ShiftLeft: 225,
  AltLeft: 226,
  MetaLeft: 227,
  ControlRight: 228,
  ShiftRight: 229,
  AltRight: 230,
  MetaRight: 231,
};

export function simulatorInput(
  e: LiveSurfaceInputEventV1,
  size: LiveSurfaceLogicalSizeV1,
): SimulatorInput | undefined {
  if (e.kind === "pointer" || e.kind === "wheel") {
    const x = Math.min(1, e.x / size.width),
      y = Math.min(1, e.y / size.height);
    if (e.kind === "wheel")
      return { kind: "wheel", x, y, dx: e.deltaX / size.width, dy: e.deltaY / size.height };
    if (e.button !== undefined && e.button !== "left") return;
    if (e.action === "move" && !(Number(e.buttons) & 1)) return;
    return { kind: "touch", phase: e.action, x, y };
  }
  if (e.kind !== "key") return;
  if (e.code === "Home") return e.action === "down" && !e.autoRepeat ? { kind: "home" } : undefined;
  const usage = /^Key[A-Z]$/u.test(e.code)
    ? e.code.charCodeAt(3) - 65 + 4
    : /^Digit[0-9]$/u.test(e.code)
      ? ((Number(e.code[5]) + 9) % 10) + 30
      : usages[e.code];
  if (typeof usage === "number") return { kind: "key", usage, down: e.action === "down" };
}
