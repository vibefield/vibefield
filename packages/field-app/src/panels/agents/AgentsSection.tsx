import {
  type AgentInstall,
  type AgentProviderSummary,
  AgentProvidersResult,
  AgentsInstallsResult,
  AgentsOperationsResult,
  AgentsReleasesResult,
  AgentsRevealResult,
  AgentsUpdateResult,
  AgentsUpdateStopResult,
  type ShellPlatform,
} from "@vibefield/contracts";
import { FielddRpcError } from "@vibefield/fieldd-client";
import { useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { refusalSentence } from "../../account/use-account";
import type { SettingsSubpage } from "../SettingsDialog";
import { AgentPageView, type AgentsNotice, AgentsShelfView, agentSubpage } from "./AgentsView";
import { agentShelf, receiptNotice } from "./agents-model";

// The Agents settings section's controller (the design record's R1, pass 16).
//
// Reads: `agent.providers` (labels, personas), `agents.installs` (the
// inventory fieldd read at launch — each install with what Update would run),
// `agents.releases {cached}` (the check the machine record kept — this page
// NEVER checks on its own, AR-D22) and `agents.operations.subscribe` (an
// update's own output as it runs); all of it answers at once. Acts: Check for
// updates (the Mac read again — `agents.installs {refresh}`, every agent's
// version command — then `agents.releases {network}` about it), Update
// (`agents.update`) and Stop (`agents.update.stop`), Show in Finder
// (`agents.reveal`). No optimistic state (the P5 law, as PluginUpdates keeps
// it): after an act the section reads again, and an update ends when its
// version has been read back.

interface Answers {
  providers: AgentProviderSummary[];
  installs: AgentInstall[];
  machineScope: boolean;
  releases: AgentsReleasesResult;
}

type Unavailable = { title: string; description: string; retry: boolean };

function unavailableWords(cause: unknown): Unavailable {
  if (cause instanceof FielddRpcError && cause.kind === "FORBIDDEN_SCOPE") {
    return {
      title: "This window can't manage agents",
      description: "Agents are managed from the VibeField app on this Mac.",
      retry: false,
    };
  }
  return {
    title: "Agents aren't available",
    description: refusalSentence("The agents on this Mac couldn't be read", cause),
    retry: true,
  };
}

export function AgentsSection({
  platform = "other",
  rootRequest = 0,
  onSubpage,
}: {
  platform?: ShellPlatform;
  /** Bumps when the Agents item in the nav is pressed: back to the shelf. */
  rootRequest?: number;
  /** An agent's page names itself in the dialog's header, with the way back. */
  onSubpage: (subpage: SettingsSubpage | null) => void;
}): ReactElement {
  const client = useFielddClient();
  const feed = useSubscription<unknown>("agents.operations.subscribe", {});
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [unavailable, setUnavailable] = useState<Unavailable | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [checking, setChecking] = useState(false);
  const [requested, setRequested] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [notice, setNotice] = useState<AgentsNotice | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const root = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const answered = useRef(false);
  const openRef = useRef<string | null>(null);
  const requestedRef = useRef<ReadonlySet<string>>(requested);
  /** where focus goes after the next open/back: the page's title, or a row */
  const focusAfter = useRef<{ page: true } | { row: string } | null>(null);
  /** each load's turn; an answer from an older turn is dropped */
  const loads = useRef(0);
  /** bumps when a Check lands: a cached read begun before then must not undo it */
  const checks = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  /** Read the doors again — from fieldd's inventory, or with `refresh`, from
   * the Mac itself; answers what was applied (null: superseded or refused). */
  const load = useCallback(
    async (refresh = false): Promise<Answers | null> => {
      const turn = ++loads.current;
      const check = checks.current;
      try {
        const [providers, inventory, releases] = await Promise.all([
          client
            .request("agent.providers", {})
            .then((r) => AgentProvidersResult.parse(r).providers),
          client
            .request("agents.installs", refresh ? { refresh: true } : {})
            .then((r) => AgentsInstallsResult.parse(r)),
          client
            .request("agents.releases", { cached: true })
            .then((r) => AgentsReleasesResult.parse(r)),
        ]);
        if (!mounted.current || turn !== loads.current) return null;
        answered.current = true;
        const applied: Answers = {
          providers,
          installs: inventory.installs,
          // an older daemon does not say; its update door answers for itself
          machineScope: inventory.machineScope ?? true,
          releases,
        };
        setAnswers((current) =>
          check === checks.current || current === null
            ? applied
            : { ...applied, releases: current.releases },
        );
        setUnavailable(null);
        return applied;
      } catch (cause) {
        if (!mounted.current || turn !== loads.current) return null;
        // A read that fails after one answered keeps what is shown and says why.
        if (answered.current) {
          setNotice({
            tone: "error",
            text: refusalSentence("The agents couldn't be read again", cause),
          });
        } else {
          setUnavailable(unavailableWords(cause));
        }
        return null;
      }
    },
    [client],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const operations = useMemo(() => {
    const parsed = AgentsOperationsResult.safeParse(feed.data);
    return parsed.success ? parsed.data.operations : [];
  }, [feed.data]);

  // An update this window did not ask for (another window's, or one begun
  // before this page opened) ends when the feed says so: read again then.
  // This window's own requests read again themselves, before they settle.
  const finishes = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (feed.status !== "live") return;
    const seen = finishes.current;
    const current = new Map<string, string>();
    for (const operation of operations) {
      if (operation.finishedAt !== undefined) current.set(operation.provider, operation.finishedAt);
    }
    finishes.current = current;
    if (seen === null) return;
    const ended = [...current].some(
      ([provider, at]) => seen.get(provider) !== at && !requestedRef.current.has(provider),
    );
    if (ended) void load();
  }, [feed.status, operations, load]);

  const shelf = useMemo(
    () => (answers === null ? [] : agentShelf({ ...answers, operations, requested })),
    [answers, operations, requested],
  );

  // A running update says how long it has run: the clock ticks only then.
  const running = operations.some((operation) => operation.state === "running");
  useEffect(() => {
    if (!running) return;
    setNow(new Date());
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, [running]);

  // A stop holds until its updater has ended.
  useEffect(() => {
    if (stopping === null) return;
    const operation = operations.find((candidate) => candidate.provider === stopping);
    if (operation?.state !== "running") setStopping(null);
  }, [stopping, operations]);
  const openItem = open === null ? undefined : shelf.find((item) => item.provider === open);
  const labelOf = (provider: string): string =>
    shelf.find((item) => item.provider === provider)?.label ?? provider;
  const revealLabel = platform === "darwin" ? "Show in Finder" : "Show in folder";

  const markRequested = (provider: string, on: boolean): void => {
    const next = new Set(requestedRef.current);
    if (on) next.add(provider);
    else next.delete(provider);
    requestedRef.current = next;
    if (mounted.current) setRequested(next);
  };

  const openPage = (provider: string): void => {
    focusAfter.current = { page: true };
    setNotice(null);
    setOpen(provider);
  };

  const back = useCallback((): void => {
    const from = openRef.current;
    focusAfter.current = from === null ? null : { row: from };
    setNotice(null);
    setOpen(null);
  }, []);

  // The Agents item pressed while an agent's page is open: back to the shelf.
  const handledRootRequest = useRef(rootRequest);
  useEffect(() => {
    if (rootRequest === handledRootRequest.current) return;
    handledRootRequest.current = rootRequest;
    back();
  }, [rootRequest, back]);

  // An agent that left the shelf (uninstalled, read again) closes its page.
  useEffect(() => {
    if (open !== null && answers !== null && openItem === undefined) setOpen(null);
  }, [open, answers, openItem]);

  const openLabel = openItem?.label;
  useEffect(() => {
    onSubpage(openLabel === undefined ? null : agentSubpage(openLabel, back));
  }, [onSubpage, openLabel, back]);
  useEffect(() => () => onSubpage(null), [onSubpage]);

  // Focus follows the page: its title when it opens, the row it came from on
  // the way back (the dialog's own focus trap keeps it inside).
  useEffect(() => {
    const target = focusAfter.current;
    if (target === null) return;
    focusAfter.current = null;
    const scope = root.current;
    if (scope === null) return;
    if ("page" in target) {
      scope.querySelector<HTMLElement>("[data-agents-page-title]")?.focus();
      return;
    }
    const row = [...scope.querySelectorAll<HTMLElement>("[data-provider]")].find(
      (candidate) => candidate.dataset.provider === target.row,
    );
    row?.querySelector<HTMLElement>(".vf-agents-row-open")?.focus();
  }, [open]);

  // Look again reads the Mac itself: an agent installed since launch appears.
  const rescan = async (): Promise<void> => {
    setRescanning(true);
    setNotice(null);
    await load(true);
    if (mounted.current) setRescanning(false);
  };

  // Check for updates is the one act that reaches the network (AR-D22): the
  // Mac read again first — versions an agent's own updater moved since launch
  // — then the agents' own oracles and the release feeds each adapter
  // declares, judged against that inventory.
  const check = async (): Promise<void> => {
    setChecking(true);
    setNotice(null);
    try {
      const inventory = AgentsInstallsResult.parse(
        await client.request("agents.installs", { refresh: true }),
      );
      const releases = AgentsReleasesResult.parse(
        await client.request("agents.releases", { network: true }),
      );
      // Both land together; a read begun before them must not undo them.
      loads.current += 1;
      checks.current += 1;
      if (mounted.current) {
        setAnswers((current) =>
          current === null
            ? current
            : {
                ...current,
                installs: inventory.installs,
                machineScope: inventory.machineScope ?? current.machineScope,
                releases,
              },
        );
      }
    } catch (cause) {
      if (mounted.current) {
        setNotice({ tone: "error", text: refusalSentence("Couldn't check for updates", cause) });
      }
    } finally {
      if (mounted.current) setChecking(false);
    }
  };

  const update = async (provider: string): Promise<void> => {
    if (requestedRef.current.has(provider)) return;
    const label = labelOf(provider);
    markRequested(provider, true);
    setNotice(null);
    try {
      const { receipt } = AgentsUpdateResult.parse(
        await client.request("agents.update", { provider }),
      );
      // The update ends when its version has been read back.
      const read = await load();
      // On the shelf the outcome is said once in words, weighed against the
      // release still on offer as re-read; the agent's page carries the
      // receipt in its output card.
      if (mounted.current && openRef.current === null) {
        const reread = read === null ? [] : agentShelf({ ...read, operations: [] });
        const item = reread.find((candidate) => candidate.provider === provider);
        setNotice(receiptNotice(label, receipt, item ?? {}));
      }
    } catch (cause) {
      if (mounted.current) {
        setNotice({ tone: "error", text: refusalSentence(`Couldn't update ${label}`, cause) });
      }
    } finally {
      markRequested(provider, false);
    }
  };

  const stop = async (provider: string): Promise<void> => {
    setStopping(provider);
    try {
      const { stopped } = AgentsUpdateStopResult.parse(
        await client.request("agents.update.stop", { provider }),
      );
      // nothing was running: the feed already says it ended
      if (!stopped && mounted.current) setStopping(null);
    } catch (cause) {
      if (mounted.current) {
        setStopping(null);
        setNotice({ tone: "error", text: refusalSentence("Couldn't stop the update", cause) });
      }
    }
  };

  const reveal = async (provider: string, executable: string): Promise<void> => {
    setBusy(executable);
    setNotice(null);
    try {
      AgentsRevealResult.parse(await client.request("agents.reveal", { provider, executable }));
    } catch (cause) {
      if (mounted.current) {
        setNotice({ tone: "error", text: refusalSentence("Couldn't show the install", cause) });
      }
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const machineScope = answers?.machineScope ?? true;
  return (
    <div ref={root} className="vf-agents-section">
      {openItem !== undefined ? (
        <AgentPageView
          item={openItem}
          machineScope={machineScope}
          busy={busy}
          notice={notice}
          now={now}
          revealLabel={revealLabel}
          stopping={stopping === openItem.provider}
          onUpdate={() => void update(openItem.provider)}
          onStop={() => void stop(openItem.provider)}
          onReveal={(executable) => void reveal(openItem.provider, executable)}
        />
      ) : (
        <AgentsShelfView
          state={unavailable !== null ? "unavailable" : answers === null ? "loading" : "ready"}
          items={shelf}
          unavailable={unavailable}
          machineScope={machineScope}
          checking={checking}
          rescanning={rescanning}
          notice={notice}
          onCheck={() => void check()}
          onRescan={() => void rescan()}
          onUpdate={(provider) => void update(provider)}
          onOpen={openPage}
        />
      )}
    </div>
  );
}
