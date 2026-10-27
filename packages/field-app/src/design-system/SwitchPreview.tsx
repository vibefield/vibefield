import { SegmentedControl } from "@vibefield/design-kit/primitives";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { MeMenuView } from "../account/MeMenu";
import type { AccountMe, AccountPerson } from "../account/use-account";
import { FIRST_STAGE } from "../boot/machine";
import { LEAVING_STATUS, type SwitchBox, SwitchSceneView } from "../boot/SwitchScene";
import type { SplashStatusView } from "../boot/splash-parts";
import type { SwitchOrigin, SwitchPersona } from "../boot/switch";
import { FIXTURE_ME, FIXTURE_OTHERS } from "./account-fixtures";

// The switch (DESIGN.md §8), staged: the shipping `SwitchSceneView` and the
// shipping `MeMenuView` over a small field, with the parts no catalog has — a
// daemon to wake, a window to reload — played on a clock. Choosing a user in
// the menu runs the whole thing: the leaving, the held frame, the "reload"
// (the scene remounts, exactly as the next window paints it), the real boot's
// stage words, and the reveal that sends the face home to the corner.

const OUTCOMES = ["Switches", "Refused"] as const;
type Outcome = (typeof OUTCOMES)[number];

/** The boot's real stage words, in its order (machine.ts, the DocManager). */
const ARRIVAL_STAGES: readonly SplashStatusView[] = [
  { stage: FIRST_STAGE, progress: null, unavailable: null },
  { stage: "loading the field", progress: null, unavailable: null },
  { stage: "opening doc", progress: 0.25, unavailable: null },
  { stage: "drawing the board", progress: 0.75, unavailable: null },
  { stage: "settling", progress: 1, unavailable: null },
];

/** How long main takes to wake the other pair, and each boot stage, here. */
const WAKE_MS = 900;
const STAGE_MS = 380;

type Demo =
  | { readonly kind: "idle" }
  | {
      readonly kind: "leaving";
      readonly persona: SwitchPersona;
      readonly origin: SwitchOrigin | null;
      readonly phase: "leaving" | "held" | "returning";
    }
  | {
      readonly kind: "arriving";
      readonly persona: SwitchPersona;
      readonly phase: "held" | "revealing";
      readonly stage: number;
    };

const EVERYONE: readonly AccountPerson[] = [FIXTURE_ME, ...FIXTURE_OTHERS];

function meFor(person: AccountPerson): AccountMe {
  return person.userId === FIXTURE_ME.userId
    ? FIXTURE_ME
    : {
        ...person,
        detail: "This Mac only",
        detailIsLogin: false,
        detailTone: "plain",
        canLink: false,
      };
}

export function SwitchPreview(): ReactElement {
  const stageRef = useRef<HTMLDivElement>(null);
  const [outcome, setOutcome] = useState<Outcome>("Switches");
  const [meId, setMeId] = useState(FIXTURE_ME.userId);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [demo, setDemo] = useState<Demo>({ kind: "idle" });
  const [generation, setGeneration] = useState(0);

  const me = meFor(EVERYONE.find((person) => person.userId === meId) ?? FIXTURE_ME);
  const others = EVERYONE.filter((person) => person.userId !== meId);

  // Main's part, on a clock: wake the pair, then refuse or reload.
  useEffect(() => {
    if (demo.kind !== "leaving" || demo.phase !== "held") return;
    const t = setTimeout(() => {
      if (outcome === "Refused") {
        // As MeMenu does: the refusal reopens the menu with main's words at
        // once, so the row is back where the face is returning to.
        setDemo({ ...demo, phase: "returning" });
        setNotice(`Couldn't switch to ${demo.persona.name} — a user switch is already in flight.`);
        setOpen(true);
        return;
      }
      // The reload: the next window's scene mounts fresh on the held frame.
      setMeId(demo.persona.userId);
      setGeneration((n) => n + 1);
      setDemo({ kind: "arriving", persona: demo.persona, phase: "held", stage: 0 });
    }, WAKE_MS);
    return () => clearTimeout(t);
  }, [demo, outcome]);

  // The next window's boot, stage by stage, then its reveal.
  useEffect(() => {
    if (demo.kind !== "arriving" || demo.phase !== "held") return;
    const t = setTimeout(() => {
      setDemo(
        demo.stage < ARRIVAL_STAGES.length - 1
          ? { ...demo, stage: demo.stage + 1 }
          : { ...demo, phase: "revealing" },
      );
    }, STAGE_MS);
    return () => clearTimeout(t);
  }, [demo]);

  const home = (): SwitchBox | null =>
    stageRef.current?.querySelector("[data-vf-switch-home] .vf-face")?.getBoundingClientRect() ??
    null;

  return (
    <div ref={stageRef} className="vf-ds-switch-stage">
      <div className="vf-ds-me-controls">
        <SegmentedControl
          options={OUTCOMES}
          value={outcome}
          onChange={setOutcome}
          label="What main answers"
        />
      </div>

      <div className="vf-ds-demo-me">
        <MeMenuView
          me={me}
          others={others}
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setNotice(null);
          }}
          onOpenSettings={() => undefined}
          onOpenAccount={() => undefined}
          onLink={() => undefined}
          onSwitch={(userId, from) => {
            const person = others.find((other) => other.userId === userId);
            if (person === undefined || demo.kind !== "idle") return;
            const face = from?.querySelector(".vf-face") ?? null;
            setNotice(null);
            setDemo({
              kind: "leaving",
              persona: { userId, name: person.name, face: person.face },
              origin: face === null ? null : { element: face, rect: face.getBoundingClientRect() },
              phase: "leaving",
            });
          }}
          // Main's refusal un-busies the corner at once, as MeMenu's does.
          busy={demo.kind !== "idle" && !(demo.kind === "leaving" && demo.phase === "returning")}
          notice={notice}
        />
      </div>

      {demo.kind === "leaving" && (
        <SwitchSceneView
          contained
          persona={demo.persona}
          phase={demo.phase}
          status={LEAVING_STATUS}
          origin={demo.origin}
          onSettled={(phase) => {
            if (phase === "leaving") setDemo({ ...demo, phase: "held" });
            if (phase === "returning") setDemo({ kind: "idle" });
          }}
        />
      )}
      {demo.kind === "arriving" && (
        <SwitchSceneView
          key={generation}
          contained
          persona={demo.persona}
          phase={demo.phase}
          status={ARRIVAL_STAGES[demo.stage] ?? LEAVING_STATUS}
          findHome={home}
          landing
          onSettled={() => setDemo({ kind: "idle" })}
        />
      )}
    </div>
  );
}
