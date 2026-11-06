import { FIELDD_LINK, type FielddLinkUnavailable } from "@vibefield/contracts";
import type { FielddHandleCoordinator, FielddRecoveryState } from "./fieldd-handle-coordinator";
import type { TrayLinkState } from "./tray-model";

// THE FIELD SERVICE'S LINK, AS MAIN HOLDS IT (item 212, RV #29; the RV plan's one link model). One projection of the
// ATTACHED pair's facts — its client's status, as the attachment's observers report it, and its coordinator's bounded
// recovery — to the status item's service row (`TrayLinkState`) and the window's `desktopState.fieldd`, which the
// status line says (field-app frame/field-service-notice.ts). The worse and truer story wins: a crash loop, then a
// recovery, then the client's own word. Background pairs keep their own coordinator and intensity and move none of it;
// a user switch re-binds it. It is the ONE detector: a window, Godview's doors (rv/monitor-doors) and the status item
// read it, and none builds a second. RV #67 adds the handle's liveness to the same projection.

/** What the link is made of. */
export interface FielddLinkInputs {
  /** The attached handle's client status as its observers report it (`ready`, `reconnecting`, `closed`, `failed`,
   * …); null before the attached pair's first word. */
  readonly client: string | null;
  readonly recovery: FielddRecoveryState;
}

export interface FielddLinkView {
  /** the status item's service row */
  readonly link: TrayLinkState;
  /** with `link` at `crash-loop`: the automatic tries that ran, as the row says them */
  readonly serviceTries: number | undefined;
  /** `DesktopShellState.fieldd`: null while the field service is up or coming up */
  readonly fieldd: FielddLinkUnavailable | null;
}

/** The projection, pure. */
export function projectFielddLink(inputs: FielddLinkInputs): FielddLinkView {
  const { recovery } = inputs;
  switch (recovery.kind) {
    case "crash-loop":
      return {
        link: "crash-loop",
        serviceTries: recovery.failures,
        fieldd: {
          service: FIELDD_LINK.SERVICE,
          state: FIELDD_LINK.STATE_CRASH_LOOP,
          failures: recovery.failures,
        },
      };
    case "recovering":
      return {
        link: "recovering",
        serviceTries: undefined,
        fieldd: {
          service: FIELDD_LINK.SERVICE,
          state: FIELDD_LINK.STATE_RECOVERING,
          attempt: recovery.attempt,
          of: recovery.of,
        },
      };
    case "ready":
      return { link: clientLink(inputs.client), serviceTries: undefined, fieldd: null };
  }
}

/** The client's own word, as the status item said it before item 212. */
function clientLink(status: string | null): TrayLinkState {
  if (status === "ready") return "ready";
  if (status === "reconnecting") return "reconnecting";
  if (status === "closed" || status === "failed") return "unavailable";
  return "starting";
}

/** A pair's coordinator, as the link reads it. */
export type FielddRecoverySource = Pick<FielddHandleCoordinator, "recovery">;

/** The projection bound to the attached pair: it tells `onChange` each new view, and only a change. */
export class FielddLink {
  private source: FielddRecoverySource | null = null;
  private inputs: FielddLinkInputs = { client: null, recovery: { kind: "ready" } };
  private current: FielddLinkView;
  private readonly onChange: (view: FielddLinkView) => void;

  constructor(onChange: (view: FielddLinkView) => void) {
    this.onChange = onChange;
    this.current = projectFielddLink(this.inputs);
  }

  view(): FielddLinkView {
    return this.current;
  }

  /** Bind to the attached pair (the boot, and every user switch): its recovery now, and no client word until its
   * observers say one. */
  attach(source: FielddRecoverySource): void {
    this.source = source;
    this.set({ client: null, recovery: source.recovery });
  }

  /** A pair's coordinator moved; only the attached pair's moves the link. */
  recoveryChanged(source: FielddRecoverySource, recovery: FielddRecoveryState): void {
    if (source !== this.source) return;
    this.set({ ...this.inputs, recovery });
  }

  /** The attached pair's client status, from the attachment's observers (which only the attached pair has). */
  clientStatus(status: string): void {
    this.set({ ...this.inputs, client: status });
  }

  /** A pair's attempt failed with no handle to report a status (a boot's failure): for the attached pair, its
   * client's word is `failed`. */
  ensureFailed(source: FielddRecoverySource): void {
    if (source !== this.source) return;
    this.set({ ...this.inputs, client: "failed" });
  }

  private set(inputs: FielddLinkInputs): void {
    this.inputs = inputs;
    const next = projectFielddLink(inputs);
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    this.current = next;
    this.onChange(next);
  }
}
