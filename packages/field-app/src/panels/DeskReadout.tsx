import { type ReactElement, useEffect, useState } from "react";
import { currentDesk, type MountedDesk, subscribeDesk } from "../field/desk/desk-door";
import { SettingsRow } from "./settings-ui";

// THE DESK'S READOUT in Settings → Advanced → Developer (DK-3, the orchestrator's ruling 2; FR-4's
// section, development builds only): the desk mounted in the Canvas stage as NUMBERS — its status
// (`status()`, with `faults` when a kind went missing), the mount's boot (`perf().boot`, ICE I25:
// the device in hand, the passes compiled, the first frame presented, ms since the mount), the
// frames it drew (`perf().frames`), the queue's submits (`submits()`) and the live GPU memory
// (`gpuLedger`, dev builds). No panel of ICE's: ICE's devtools dock stays its own switch beside it.

export interface DeskFacts {
  readonly state: string;
  readonly message?: string;
  readonly faults: number;
  readonly boot: {
    readonly device?: number;
    readonly compiled?: number;
    readonly presented?: number;
  };
  readonly frames: number;
  readonly submits: number | null;
  /** Live GPU bytes the memory ledger holds, or null without one. */
  readonly memory: number | null;
}

/** The numbers, read once off the mounted desk. */
export function deskFacts(desk: MountedDesk): DeskFacts {
  const status = desk.handle.status();
  const perf = desk.handle.perf();
  return {
    state: status.state,
    ...(status.message === undefined ? {} : { message: status.message }),
    faults: status.faults?.length ?? 0,
    boot: perf.boot,
    frames: perf.frames,
    submits: desk.handle.submits()?.total() ?? null,
    memory: desk.handle.gpuMemory()?.read().total ?? null,
  };
}

const ms = (value: number | undefined): string =>
  value === undefined ? "—" : `${Math.round(value)} ms`;
const mb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** The readout's lines, as they are printed. */
export function deskReadoutLines(facts: DeskFacts | null): readonly string[] {
  if (facts === null) return ["No desk is mounted"];
  const lines = [
    `${facts.state}${facts.faults > 0 ? ` · ${facts.faults} kind${facts.faults === 1 ? "" : "s"} missing` : ""}`,
    `boot · device ${ms(facts.boot.device)} · compiled ${ms(facts.boot.compiled)} · presented ${ms(facts.boot.presented)}`,
    `${facts.frames} frames · ${facts.submits === null ? "—" : facts.submits} submits${facts.memory === null ? "" : ` · ${mb(facts.memory)} GPU`}`,
  ];
  return facts.message === undefined ? lines : [...lines, facts.message];
}

/** Controller-free: the readout as a Settings row. */
export function DeskReadoutView({ facts }: { facts: DeskFacts | null }): ReactElement {
  return (
    <SettingsRow
      title="The desk"
      description="Its status, the mount's boot, the frames it drew, the queue's submits and the live GPU memory — read once a second."
      align="start"
    >
      <div className="vf-desk-readout" data-desk-readout="">
        {deskReadoutLines(facts).map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
    </SettingsRow>
  );
}

/** The live readout: the mounted desk's numbers, once a second while it shows. */
export function DeskReadout(): ReactElement {
  const [facts, setFacts] = useState<DeskFacts | null>(() => {
    const desk = currentDesk();
    return desk === null ? null : deskFacts(desk);
  });
  useEffect(() => {
    const read = (): void => {
      const desk = currentDesk();
      setFacts(desk === null ? null : deskFacts(desk));
    };
    const timer = setInterval(read, 1000);
    const unsubscribe = subscribeDesk(read);
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, []);
  return <DeskReadoutView facts={facts} />;
}
