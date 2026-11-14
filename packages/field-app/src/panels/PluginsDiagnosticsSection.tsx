import {
  PluginRuntimeDiagnosticsSnapshot,
  type PluginRuntimePluginDiagnostic,
} from "@vibefield/contracts";
import { useSubscription } from "@vibefield/fieldd-client/react";
import type { ReactElement, ReactNode } from "react";
import { usePluginRegistrySnapshot } from "../plugin-host/plugin-registry-store";
import { labelCls, SettingsSection } from "./settings-ui";

// SETTINGS → DIAGNOSTICS' PLUGINS SECTION (MK-5; MK-D10, and item 282-6's plugin half by
// MK-E12; DESIGN.md §8 "Settings → Diagnostics' Plugins section"): each plugin's runtime, one
// block per plugin under its title, drawn as `SystemSection` draws its rows. What it shows is
// for whoever is fixing VibeField — a plugin's id and state, its controllers and their install
// revisions, its behaviors, a breaker's strikes, the Doctor's issues and fieldd's own sentences
// — so it lives here alone (§9, VibeField's insides), and Plugins… says a plugin that isn't
// working in one plain line.
//
// It moved here from Settings → Plugins' "Runtime +" disclosure, which left that page. Its rows
// say the disclosure's words; an issue now wears its ink (§2.5) where the disclosure wore raw
// red and amber; a folder that is not a plugin, which that page said, is said here, and so is
// each plugin's last error. It only reads: the one subscription the disclosure held
// (`plugins.runtime.subscribe`, whose snapshot lists every plugin fieldd has, by
// `fieldd/src/plugin-runtime-diagnostics.ts`), and the registry snapshot the window already
// holds, for each plugin's title and the folders. No act and no request of its own.

/** The section's words (DESIGN.md §8 "Settings → Diagnostics' Plugins section"). Its line is
 * MK-D10's ruled drawing's; "No plugins are installed." is Settings → Plugins' own, moved; the
 * rest are MK's, ‹draft›. The rows say the Runtime disclosure's words, each row's name in lower
 * case as `SystemSection`'s rows say theirs ("Service" is "service"). */
export const PLUGINS_DIAGNOSTICS_WORDS = {
  title: "Plugins",
  line:
    "Each plugin's runtime: its controllers, behaviors and the Doctor's issues. " +
    "Moved here from Settings → Plugins.",
  reading: "Reading each plugin's runtime…",
  unavailable: "Plugin runtime unavailable",
  none: "No plugins are installed.",
  omittedPlugins: (count: number): string =>
    `${count} more plugin${count === 1 ? "" : "s"} omitted by the bounded diagnostics budget.`,
} as const;

/** §2.5: an error in the danger ink, a warning in the attention ink (as Settings → Updates' state
 * words take theirs). */
const INK = {
  error: "text-[12px] text-[var(--vf-ink-danger)]",
  warning: "text-[12px] text-[var(--vf-ink-attention)]",
} as const;

type Controller = PluginRuntimePluginDiagnostic["serviceController"];
type Renderer = PluginRuntimePluginDiagnostic["renderers"][number];
type Behavior = NonNullable<Renderer["behaviorGeneration"]>;
type Declaration = Behavior["declarations"][number];

function shortRevision(value: string | undefined): string {
  if (value === undefined) return "none";
  return value.length <= 12 ? value : `${value.slice(0, 12)}…`;
}

/** A controller in one line: its state ("disconnected · " first for a renderer that left), then
 * what it committed and wants, its scope and its last close. */
function controllerWords(controller: Controller, connected?: boolean): string {
  const said = controller?.state ?? "not started";
  const state = connected === false ? `disconnected · ${said}` : said;
  if (controller === null) return state;
  const words = [
    state,
    `committed ${shortRevision(controller.committed?.artifact.installRevision)}`,
    `desired ${shortRevision(controller.desired?.artifact.installRevision)}`,
  ];
  const scope = controller.scope;
  if (scope !== null) {
    words.push(
      `${scope.liveCount} live`,
      `${scope.pendingSetups} pending`,
      `${scope.lateCleanups} late`,
    );
  }
  if (controller.lastClose !== null) {
    const quiescent = controller.lastClose.quiescent ? "quiescent" : "not quiescent";
    words.push(`last close ${controller.lastClose.reason?.kind ?? "unknown"} (${quiescent})`);
  }
  return words.join(" · ");
}

function behaviorWords(behavior: Behavior): string {
  const words = [
    behavior.state,
    `generation ${behavior.target.runtimeGeneration}`,
    `${behavior.installedCount}/${behavior.desiredCount} installed`,
    `${behavior.blockedCount} blocked`,
    `${behavior.suspendedCount} suspended`,
    `${behavior.failedCount} failed`,
  ];
  if (behavior.closeReason !== undefined) words.push(`close ${behavior.closeReason}`);
  return words.join(" · ");
}

function declarationWords(behavior: Behavior, declaration: Declaration): string {
  const target =
    behavior.rendererTargets[declaration.rendererTarget]?.artifact.installRevision ?? "unknown";
  const words: string[] = [declaration.status, `target ${target}`];
  if (declaration.blockedReason !== undefined) words.push(declaration.blockedReason);
  const breaker = declaration.breaker;
  if (breaker !== null) {
    words.push(`${breaker.strikes} strike${breaker.strikes === 1 ? "" : "s"}`);
    if (breaker.suspended) words.push("breaker suspended");
  }
  if (declaration.error !== undefined) words.push(declaration.error.message);
  return words.join(" · ");
}

/** One row as `SystemSection` draws it: its name in the label ramp, its value at the row's end. */
function Row({
  name,
  inset = false,
  children,
}: {
  name: string;
  inset?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <div className={`flex items-start justify-between gap-2${inset ? " pl-2" : ""}`}>
      <span className={`shrink-0 ${labelCls}`}>{name}</span>
      <span className="min-w-0 break-words text-right">{children}</span>
    </div>
  );
}

function Behaviors({ behavior }: { behavior: Behavior }): ReactElement {
  const omitted = behavior.omittedDeclarations;
  return (
    <>
      <Row name={`behaviors · ${behavior.target.documentId}`}>{behaviorWords(behavior)}</Row>
      {behavior.declarations.map((declaration) => (
        <Row
          key={`${declaration.declarationId}:${declaration.rendererTarget}`}
          name={declaration.declarationId}
          inset
        >
          {declarationWords(behavior, declaration)}
        </Row>
      ))}
      {omitted > 0 && (
        <p className={`pl-2 ${labelCls}`}>
          {omitted} behavior declaration row{omitted === 1 ? "" : "s"} omitted.
        </p>
      )}
    </>
  );
}

const BLOCK =
  "space-y-1 border-t border-black/5 pt-3 first:border-t-0 first:pt-0 dark:border-white/10";
const HEAD = "truncate text-[12px] font-medium text-black/75 dark:text-white/75";

function PluginRuntimeBlock({
  runtime,
  title,
}: {
  runtime: PluginRuntimePluginDiagnostic;
  title: string;
}): ReactElement {
  const connected = runtime.renderers.filter((renderer) => renderer.connected).length;
  const reports = runtime.renderers.length;
  return (
    <div className={BLOCK} data-plugin-runtime={runtime.pluginId}>
      <div className="flex items-center justify-between gap-2">
        <span className={HEAD}>{title}</span>
        <span className={`truncate ${labelCls}`}>{runtime.pluginId}</span>
      </div>
      <Row name="state">{runtime.registry.state}</Row>
      {runtime.registry.lastError !== undefined && (
        <p className={INK.error}>{runtime.registry.lastError.message}</p>
      )}
      <Row name="commit epoch">{runtime.commitEpoch ?? "unavailable"}</Row>
      <Row name="update">{runtime.update?.state ?? "idle"}</Row>
      <Row name="renderers">
        {connected} connected · {reports} renderer report{reports === 1 ? "" : "s"}
      </Row>
      <Row name="service">{controllerWords(runtime.serviceController)}</Row>
      {runtime.renderers.map((renderer) => (
        <div key={`${renderer.participantId}:${renderer.incarnation}`} className="space-y-1">
          <Row name={`renderer · ${renderer.participantId}`}>
            {controllerWords(renderer.controller, renderer.connected)}
          </Row>
          {renderer.behaviorGeneration !== null && (
            <Behaviors behavior={renderer.behaviorGeneration} />
          )}
        </div>
      ))}
      {(runtime.serviceControllerOmitted || runtime.omittedRenderers > 0) && (
        <p className={labelCls}>
          Some controller detail was omitted by the bounded diagnostics budget
          {runtime.omittedRenderers > 0 ? ` (${runtime.omittedRenderers} renderers)` : ""}.
        </p>
      )}
      {runtime.issues.map((issue, index) => (
        <p
          key={`${issue.code}:${issue.participantId ?? issue.face}:${index}`}
          className={INK[issue.severity]}
        >
          {issue.message}
        </p>
      ))}
      {runtime.omittedIssues > 0 && (
        <p className={labelCls}>{runtime.omittedIssues} additional Doctor issues omitted.</p>
      )}
    </div>
  );
}

export function PluginsDiagnosticsSection(): ReactElement {
  const registry = usePluginRegistrySnapshot();
  const subscription = useSubscription<unknown>("plugins.runtime.subscribe", {});
  const parsed = PluginRuntimeDiagnosticsSnapshot.safeParse(subscription.data);
  const titles = new Map(
    (registry?.plugins ?? []).map((record) => [record.id, record.title] as const),
  );
  let body: ReactNode;
  if (parsed.success) {
    const { plugins, omittedPlugins } = parsed.data;
    body = (
      <>
        {plugins.length === 0 && <p className={labelCls}>{PLUGINS_DIAGNOSTICS_WORDS.none}</p>}
        {plugins.map((runtime) => (
          <PluginRuntimeBlock
            key={runtime.pluginId}
            runtime={runtime}
            title={titles.get(runtime.pluginId) ?? runtime.pluginId}
          />
        ))}
        {omittedPlugins > 0 && (
          <p className={labelCls}>{PLUGINS_DIAGNOSTICS_WORDS.omittedPlugins(omittedPlugins)}</p>
        )}
      </>
    );
  } else {
    // a read not answered yet, or one that failed or this window can't read: never a blank (EL5)
    body = (
      <p className={labelCls}>
        {subscription.status === "loading"
          ? PLUGINS_DIAGNOSTICS_WORDS.reading
          : PLUGINS_DIAGNOSTICS_WORDS.unavailable}
      </p>
    );
  }
  return (
    <SettingsSection
      title={PLUGINS_DIAGNOSTICS_WORDS.title}
      description={PLUGINS_DIAGNOSTICS_WORDS.line}
    >
      <div className="space-y-3" data-diagnostics="plugin-runtime">
        {body}
        {(registry?.problems ?? []).map((problem) => (
          <div key={problem.root} className={BLOCK} data-plugin-problem={problem.root}>
            <div className={HEAD}>{problem.root}</div>
            <p className={INK.error}>{problem.error.message}</p>
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}
