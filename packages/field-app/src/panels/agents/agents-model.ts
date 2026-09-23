import type {
  AgentAvailableUpdate,
  AgentInstall,
  AgentOperation,
  AgentPersona,
  AgentProviderSummary,
  AgentRelease,
  AgentReleaseFailure,
  AgentsReleasesResult,
} from "@vibefield/contracts";

// The Agents settings section's one model (the design record's R1, pass 16):
// "Agents is the shelf" — one entry per installed agent, joined from the doors'
// answers and nothing else. Every fact below is puppeteer's (the install, the
// release line, the update plan) or fieldd's (the kept check, the operation);
// this file only joins and words them. AR-L1: no vendor is named here — a
// provider is an id and the label puppeteer gave it.

/** One installed agent on the shelf. */
export interface AgentShelfItem {
  provider: string;
  /** puppeteer's own label for the provider */
  label: string;
  /** the install new sessions use */
  install: AgentInstall;
  /** every other install of the same agent on this Mac */
  others: AgentInstall[];
  /** the one update the active install's own updater would take */
  available?: { channel: string; version: string };
  /** when this agent was last checked — the kept check's own time */
  checkedAt?: string;
  /** the vendor's page for the release on offer, or for its line */
  releaseNotesUrl?: string;
  /** the last check learned no release for this agent: why, in the
   * provider's words (a check that learned some releases is not a failure) */
  checkProblem?: string;
  /** the last check learned nothing and reported nothing — this agent
   * declares no release feed puppeteer can read */
  noFeed: boolean;
  /** the update running now, or the last one this daemon ran */
  operation?: AgentOperation;
  /** an update is running: the daemon's operation says so, or this window's
   * request is still in flight (the first frame is a tick away) */
  updating: boolean;
  /** the personas this agent is signed in under */
  personas: AgentPersona[];
}

export interface AgentsModelInput {
  providers: readonly AgentProviderSummary[];
  installs: readonly AgentInstall[];
  releases: AgentsReleasesResult;
  operations: readonly AgentOperation[];
  /** providers whose update this window has asked for and not heard back on */
  requested?: ReadonlySet<string>;
}

/** Join the doors' answers into the shelf, in puppeteer's provider order;
 * only providers with an install are on it. */
export function agentShelf(input: AgentsModelInput): AgentShelfItem[] {
  const labels = new Map(input.providers.map((provider) => [provider.id, provider]));
  const order = [
    ...input.providers.map((provider) => provider.id),
    ...input.installs.map((install) => install.provider),
  ].filter((id, index, all) => all.indexOf(id) === index);
  const available = new Map<string, AgentAvailableUpdate>(
    (input.releases.available ?? []).map((entry) => [entry.provider, entry]),
  );
  const checked = new Map(
    (input.releases.checked ?? []).map((entry) => [entry.provider, entry.at]),
  );
  const operations = new Map(input.operations.map((operation) => [operation.provider, operation]));

  const shelf: AgentShelfItem[] = [];
  for (const provider of order) {
    const installs = input.installs.filter((install) => install.provider === provider);
    const install = installs.find((candidate) => candidate.active) ?? installs[0];
    if (install === undefined) continue;
    const rows = input.releases.releases.filter((row) => row.provider === provider);
    const releases = rows.filter(isRelease);
    const failures = rows.filter(isReleaseFailure);
    const offer = available.get(provider);
    const summary = labels.get(provider);
    const at = checked.get(provider);
    const operation = operations.get(provider);
    const item: AgentShelfItem = {
      provider,
      label: summary?.label ?? provider,
      install,
      others: installs.filter((candidate) => candidate !== install),
      noFeed: at !== undefined && releases.length === 0 && failures.length === 0,
      updating:
        (operation?.kind === "update" && operation.state === "running") ||
        input.requested?.has(provider) === true,
      personas: summary?.personas ?? [],
    };
    if (offer !== undefined) item.available = { channel: offer.channel, version: offer.version };
    if (at !== undefined) item.checkedAt = at;
    const notes = releaseNotesUrl(releases, offer, install);
    if (notes !== undefined) item.releaseNotesUrl = notes;
    const problem = releases.length === 0 ? failures[0]?.message : undefined;
    if (problem !== undefined) item.checkProblem = problem;
    if (operation !== undefined) item.operation = operation;
    shelf.push(item);
  }
  return shelf;
}

function isRelease(row: AgentRelease | AgentReleaseFailure): row is AgentRelease {
  return "version" in row;
}

function isReleaseFailure(row: AgentRelease | AgentReleaseFailure): row is AgentReleaseFailure {
  return "status" in row && !("version" in row);
}

/** The page for the release on offer when the vendor gave one, else for the
 * line the install follows, else any the check learned. Only https (the
 * window-open policy would refuse anything else anyway). */
function releaseNotesUrl(
  releases: readonly AgentRelease[],
  offer: AgentAvailableUpdate | undefined,
  install: AgentInstall,
): string | undefined {
  const linked = releases.filter((release) => release.url?.startsWith("https://") === true);
  const line = install.releaseChannel ?? "stable";
  return (
    (offer === undefined
      ? undefined
      : linked.find(
          (release) => release.channel === offer.channel && release.version === offer.version,
        )
    )?.url ??
    linked.find((release) => release.channel === line)?.url ??
    linked[0]?.url
  );
}

/** The shelf's head: when it was last checked (the newest check), how many
 * agents have an update on offer, and how many the check learned nothing for. */
export function shelfSummary(items: readonly AgentShelfItem[]): {
  checkedAt?: string;
  updates: number;
  problems: number;
} {
  const times = items.flatMap((item) => (item.checkedAt === undefined ? [] : [item.checkedAt]));
  const newest = times.sort().at(-1);
  const updates = items.filter((item) => item.available !== undefined).length;
  const problems = items.filter((item) => item.checkProblem !== undefined).length;
  return newest === undefined ? { updates, problems } : { checkedAt: newest, updates, problems };
}

// ── words ──

/** puppeteer's install-method taxonomy, in words (generic, not a vendor). */
const METHOD_WORDS: Record<string, string> = {
  "native-installer": "Native installer",
  "vendor-downloader": "Vendor downloader",
  "npm-global": "npm, global",
  brew: "Homebrew",
  "standalone-binary": "Standalone binary",
  "source-checkout": "Source checkout",
  unknown: "Unknown installer",
};

export function methodWords(method: string): string {
  return METHOD_WORDS[method] ?? method;
}

export function autoUpdateWords(state: AgentInstall["autoUpdate"]): string {
  if (state === "enabled") return "On — the agent updates itself";
  if (state === "disabled") return "Off";
  return "Not reported";
}

/** Who runs an update, by puppeteer's recipe kind (open: an unknown kind is said as itself). */
const UPDATER_WORDS: Record<string, string> = {
  "native-self-update": "Its own updater",
  "npm-global": "npm",
  brew: "Homebrew",
  "installer-script": "Its install script",
  manual: "By hand",
};

export function updaterWords(kind: string): string {
  return UPDATER_WORDS[kind] ?? kind;
}

/** What an update runs, the way its vendor tells a person to run it: the
 * command, or an install script piped to bash (the runner adds only pipefail
 * and an https-only fetch around it). Undefined for a manual recipe. */
export function planCommandWords(plan: NonNullable<AgentInstall["update"]>): string | undefined {
  if (plan.command !== undefined) return commandWords(plan.command);
  if (plan.url !== undefined) return `curl -fsSL ${plan.url} | bash`;
  return undefined;
}

/** "0:42", "4:12", "1:02:05" — how long an update has been running. */
export function elapsedWords(startedAt: string, now: Date): string {
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return "";
  const seconds = Math.max(0, Math.floor((now.getTime() - started) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** A command as a person would type it: arguments with spaces or quotes are quoted. */
export function commandWords(argv: readonly string[]): string {
  return argv.map((arg) => (/[\s'"\\$`]/.test(arg) ? JSON.stringify(arg) : arg)).join(" ");
}

/** "09:41:20" when checked today, else "Sep 22, 09:41" — the time is always
 * said, never implied fresh (§8, the updates flow). */
export function checkedWords(at: string, now: Date = new Date()): string {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return at;
  const sameDay =
    when.getFullYear() === now.getFullYear() &&
    when.getMonth() === now.getMonth() &&
    when.getDate() === now.getDate();
  const time = when.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    ...(sameDay ? { second: "2-digit" } : {}),
    hour12: false,
  });
  if (sameDay) return time;
  const day = when.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${day}, ${time}`;
}

/** The shelf's head line: "Checked 09:41:20 · 2 updates", "Checked 09:41:20 ·
 * everything current", "… · 1 couldn't be checked", or "Not checked yet". */
export function shelfCheckedLine(items: readonly AgentShelfItem[], now?: Date): string {
  const { checkedAt, updates, problems } = shelfSummary(items);
  if (checkedAt === undefined) return "Not checked yet";
  const parts = [`Checked ${checkedWords(checkedAt, now)}`];
  if (updates > 0) parts.push(updates === 1 ? "1 update" : `${updates} updates`);
  if (problems > 0) parts.push(`${problems} couldn't be checked`);
  if (updates === 0 && problems === 0) parts.push("everything current");
  return parts.join(" · ");
}

type Receipt = NonNullable<AgentOperation["receipt"]>;
type Tone = "neutral" | "attention" | "error";

/** What the page knows beside a receipt: the release still on offer for the
 * install as it is now, and whether any check ever said so. */
export interface ReceiptContext {
  available?: { version: string } | undefined;
  checkedAt?: string | undefined;
}

/** The runtime's failure reason as a clause ("update command timed out after
 * 45 min" → "timed out after 45 min"): puppeteer's own words, not the vendor's. */
function reason(receipt: Receipt): string | undefined {
  return receipt.message?.replace(/^update command /u, "").replace(/\.$/u, "");
}

/** A receipt in words — the outcome from its status and the versions
 * re-inspection read, weighed against what the page knows: an updater that
 * exited cleanly without moving the version is "up to date" only when no
 * newer release is known for it. */
export function receiptWords(
  receipt: Receipt,
  context: ReceiptContext = {},
): {
  text: string;
  tone: Tone;
} {
  if (receipt.stopped === true) {
    return {
      text:
        receipt.status === "updated" && receipt.toVersion !== undefined
          ? `Stopped — after it had installed ${receipt.toVersion}.`
          : "Stopped before it finished.",
      tone: "neutral",
    };
  }
  if (receipt.status === "updated") {
    return {
      text: receipt.toVersion === undefined ? "Updated." : `Updated to ${receipt.toVersion}.`,
      tone: "neutral",
    };
  }
  if (receipt.status === "unchanged" || receipt.status === "already-current") {
    if (context.available !== undefined) {
      return {
        text: `The updater finished without updating — ${context.available.version} is still available. Its output says why.`,
        tone: "attention",
      };
    }
    if (context.checkedAt !== undefined) return { text: "Already up to date.", tone: "neutral" };
    return {
      text: `The updater finished; ${receipt.toVersion ?? receipt.fromVersion ?? "the same version"} is still installed.`,
      tone: "neutral",
    };
  }
  if (receipt.status === "unsupported") {
    return {
      text: receipt.message ?? "This install cannot be updated from here.",
      tone: "neutral",
    };
  }
  const why = reason(receipt);
  return {
    text: why === undefined ? "The update didn't finish." : `The update didn't finish: ${why}.`,
    tone: "error",
  };
}

/** An update's outcome said on the shelf, where the output card is not: the
 * row's own change says a success too, so only a failure is loud. */
export function receiptNotice(
  label: string,
  receipt: Receipt,
  context: ReceiptContext = {},
): { text: string; tone: Tone } {
  if (receipt.stopped === true) return { text: `${label}'s update was stopped.`, tone: "neutral" };
  if (receipt.status === "updated") {
    return {
      text:
        receipt.toVersion === undefined
          ? `${label} updated.`
          : `${label} updated to ${receipt.toVersion}.`,
      tone: "neutral",
    };
  }
  if (receipt.status === "unchanged" || receipt.status === "already-current") {
    if (context.available !== undefined) {
      return {
        text: `${label}'s updater finished without updating — ${context.available.version} is still available. Its page has the output.`,
        tone: "attention",
      };
    }
    return {
      text:
        context.checkedAt !== undefined
          ? `${label} was already up to date.`
          : `${label}'s updater finished; nothing changed.`,
      tone: "neutral",
    };
  }
  if (receipt.status === "unsupported") {
    return {
      text: receipt.message ?? `${label} can't be updated from here.`,
      tone: "neutral",
    };
  }
  const why = reason(receipt);
  return {
    text: `${label}'s update didn't finish${why === undefined ? "" : `: ${why}`}. Its page has the updater's output.`,
    tone: "error",
  };
}

/** A persona's name on this page: the native-default one is This Mac. */
export function personaWords(persona: AgentPersona): { name: string; detail: string } {
  const name = persona.kind === "native-default" ? "This Mac" : persona.label;
  const identity = persona.identity;
  if (identity === undefined) return { name, detail: "Not checked yet" };
  if (!identity.loggedIn) return { name, detail: "Signed out" };
  const parts = [identity.plan, identity.email ?? identity.organization].filter(
    (part): part is string => part !== undefined && part.length > 0,
  );
  return { name, detail: parts.length > 0 ? parts.join(" · ") : "Signed in" };
}
