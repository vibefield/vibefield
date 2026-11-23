import { useRef } from "react";

/** `value`, or the one held while `key` says nothing in it changed: a stable
 * identity for a value the window rebuilds on every publish (M19, M195). The
 * monitor's Live now rows and filters hold theirs by it, and since WL-1
 * (2026-11-23) the work column's groups and sessions. */
export function useHeldWhileSame<T>(value: T, key: string): T {
  const held = useRef({ key, value });
  if (held.current.key !== key) held.current = { key, value };
  return held.current.value;
}
