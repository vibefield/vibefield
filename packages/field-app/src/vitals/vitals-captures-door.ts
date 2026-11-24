import {
  type VitalsCaptureKind,
  type VitalsCaptureSeconds,
  VitalsCaptureState,
} from "@vibefield/contracts/vitals";
import { useCallback, useEffect, useState } from "react";
import type { VitalsCaptureProps } from "./VitalsCapture";

// VT-5 (track VT, 2026-11-24) — the capture control's controller. The window's host hands it the captures' door (its
// preload's three asks and one stream); it hears the state, parses every frame against the contracts and drops what
// does not parse, and keeps one clock only while a capture runs, to count its seconds down. At rest it holds no timer.

/** The door the Vitals window's preload hands it (`electron-shell/src/vitals/vitals-capture-preload.ts`). */
export interface VitalsCapturesDoor {
  current(): Promise<unknown>;
  arm(kind: string, seconds: number): Promise<unknown>;
  reveal(name: string): Promise<unknown>;
  onState(handler: (state: unknown) => void): () => void;
}

const IDLE: VitalsCaptureState = { state: "idle" };

export function useVitalsCaptures(
  door: VitalsCapturesDoor | undefined,
  now: () => number = Date.now,
): Omit<VitalsCaptureProps, "initialKind"> | null {
  const [state, setState] = useState<VitalsCaptureState>(IDLE);
  const [clock, setClock] = useState<number>(() => now());

  useEffect(() => {
    if (door === undefined) return;
    let live = true;
    const take = (raw: unknown): void => {
      const parsed = VitalsCaptureState.safeParse(raw);
      if (live && parsed.success) setState(parsed.data);
    };
    const stop = door.onState(take);
    door.current().then(take, () => undefined);
    return () => {
      live = false;
      stop();
    };
  }, [door]);

  // the one clock, and only while a capture runs: it ends by itself, and so does this
  const running = state.state === "running";
  useEffect(() => {
    if (!running) return;
    setClock(now());
    const timer = setInterval(() => setClock(now()), 1_000);
    return () => clearInterval(timer);
  }, [running, now]);

  const onArm = useCallback(
    (kind: VitalsCaptureKind, seconds: VitalsCaptureSeconds) => {
      // the state arrives on the stream; a refusal while one runs changes nothing shown
      void door?.arm(kind, seconds).catch(() => undefined);
    },
    [door],
  );
  const onReveal = useCallback(
    (name: string) => {
      void door?.reveal(name).catch(() => undefined);
    },
    [door],
  );

  if (door === undefined) return null;
  return {
    state,
    ...(state.state === "running"
      ? { secondsLeft: Math.max(0, Math.ceil((state.endsAt - clock) / 1_000)) }
      : {}),
    onArm,
    onReveal,
  };
}
