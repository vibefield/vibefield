import {
  type DeviceInfo,
  PluginErrorKind,
  type PluginRecord,
  type PluginRegistrySnapshot,
  type PluginsCatalogEntry,
  type PluginsCatalogState,
} from "@vibefield/contracts";
import { osOf } from "../../godview/monitor/devices";
import type { MonitorDeviceFacet } from "../../godview/monitor/types";
import { type PageLine, type PluginPage, powerWords } from "./plugins-model";
import { CARD_WORDS, INSTALL_WORDS, PAGE_WORDS, REMOVE_WORDS } from "./plugins-words";

// THE INSTALL CARD'S WINDOW HALF (O2-C; DESIGN.md §8 "Every install asks first", "Real progress",
// and the act drawn under it; MK-O2's A2, ruled by James 2026-11-11 22:33:48Z: "after the download,
// from the real files"). Install downloads first (`plugins.install.prepare`), then the card says
// what the plugin just downloaded adds, what it can do and where it installs, read from the row
// fieldd answers and this desktop's roster; the card's Install installs what it showed
// (`plugins.install.commit`), and its Cancel throws the download away (`plugins.install.discard`).
// MK-O3D (James's MK-O1 pick B; §8 "The community tile", "Once on each desktop"): a community set's
// first install at a desktop that hasn't shown the community statement shows it once the download
// is in, where the card would stand; its Continue brings the card. A community set's Install while
// community plugins are off says why. Pure: the controller holds the flow, and the tests read the
// same functions. MK-4d: an installed plugin's act also carries the set the pegboard is shown
// (`boardSet`, Show them on the pegboard).

/** Where one install stands, for the plugin whose page holds it. The card's step keeps the row
 * fieldd answered and the roster read with it (null: it couldn't be read); the card's words are
 * built from them as drawn. The statement's step (MK-O3D) keeps the same for its card. */
export type InstallStep =
  | { readonly step: "downloading" }
  | {
      readonly step: "statement";
      readonly candidate: string;
      readonly record: PluginRecord;
      readonly roster: readonly DeviceInfo[] | null;
    }
  | {
      readonly step: "card";
      readonly candidate: string;
      readonly record: PluginRecord;
      readonly roster: readonly DeviceInfo[] | null;
    }
  | { readonly step: "installing"; readonly objects: number }
  | { readonly step: "failed"; readonly refusal: InstallRefusal };

/** What ended an install, by its kind alone (§8 "A failure"): a plugin this VibeField can't run,
 * or any other refusal. */
export type InstallRefusal = "incompatible" | "failed";

/** The kind of a refusal fieldd answered (`details.pluginKind`, contracts' `PluginErrorKind`),
 * never its text: a refusal's text can name VibeField's insides (item 322's does), so the window
 * words a refusal by its kind. A plugin this VibeField can't run is the one kind with words of its
 * own, since Try again would fail the same way; every other kind, an unknown one, or none (fieldd
 * not answering) is §9's one line. */
export function installRefusal(error: unknown): InstallRefusal {
  const details =
    typeof error === "object" && error !== null ? (error as { details?: unknown }).details : null;
  const kind = PluginErrorKind.safeParse(
    typeof details === "object" && details !== null
      ? (details as { pluginKind?: unknown }).pluginKind
      : undefined,
  );
  return kind.success && kind.data === "PLUGIN_INCOMPATIBLE" ? "incompatible" : "failed";
}

/** One install under way, for one plugin, the only one: a second Install drops the first. */
export interface InstallFlow {
  readonly id: string;
  readonly at: InstallStep;
}

/** A power on the card, as the page says it: never by its id. */
export interface CardPower {
  readonly key: string;
  readonly words: string;
  /** a core power's Mac note, or a plugin's own power's description */
  readonly under: string | null;
  /** whose a plugin's own power is */
  readonly whose: string | null;
}

/** A desktop the card names: its roster id (never shown), its name and its OS mark. */
export interface CardDesktop {
  readonly key: string;
  readonly name: string;
  readonly os: MonitorDeviceFacet["os"];
}

export interface InstallCard {
  /** "Install ‹plugin›?", its name to assistive tech too */
  readonly ask: string;
  /** "It adds 3 objects to your pegboard:", with each object; null with none */
  readonly adds: string | null;
  readonly objects: readonly PageLine[];
  /** "It gives your agents 2 tools."; null with none */
  readonly tools: string | null;
  /** "It can:", over its powers; or what it does when it asks for none. MK-UC: the update card's
   * "This version can also:", or null when it names no new power */
  readonly can: string | null;
  readonly powers: readonly CardPower[];
  /** where it installs: here alone, or your ‹n› desktops, each by name; null while the roster can't
   * be read */
  readonly reaches: string | null;
  /** the desktops it names, this one first: listed only when there is more than one */
  readonly desktops: readonly CardDesktop[];
  /** MK-UC: the update card's objects that will draw as missing; none on an install's card */
  readonly missing?: string | null;
  /** MK-UC: its act's word, "Update" on the update card; "Install" when not said */
  readonly confirm?: string;
}

/** The desktops a card names (§8 "What the card reads"): this desktop, then each the roster lists
 * whose VibeField has said itself to it (a published slice: its `fielddVersion`), by name. A roster
 * row with no slice may be any device on the tailnet, so it is never counted. null when the roster
 * couldn't be read. */
export function cardDesktops(roster: readonly DeviceInfo[] | null): CardDesktop[] | null {
  if (roster === null) return null;
  const others = roster
    .filter((device) => !device.self && device.fielddVersion !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...roster.filter((device) => device.self), ...others].map((device) => ({
    key: device.deviceId,
    name: device.name,
    os: osOf(device.platform),
  }));
}

/** What the card says it can do (§9 "The install card"): each power the downloaded plugin asks for,
 * in its plain words, as its page says them; one VibeField can't name, once, in James's word for
 * it, so none goes unsaid. MK-UC: the update card says only `ids`, the powers that are new. */
export function cardPowers(
  record: PluginRecord,
  snapshot: PluginRegistrySnapshot | null,
  onMac: boolean,
  ids: readonly string[] = record.requestedCapabilities,
): CardPower[] {
  const declared = new Map<string, { title: string; description: string; by: PluginRecord }>();
  for (const plugin of [...(snapshot?.plugins ?? []), record]) {
    for (const power of plugin.contributions.capabilities) {
      declared.set(power.id, { title: power.title, description: power.description, by: plugin });
    }
  }
  const powers: CardPower[] = [];
  let unnamed = false;
  for (const id of ids) {
    const said = powerWords(id, record, declared, onMac);
    // the page says each power VibeField can't describe as a line of its own, in James's word;
    // the card says that line once, where the page says the first, and keys it by no power's id.
    // A plugin's own power its maker titled so says whose it is: a line of its own here too.
    if (said.whose !== null || said.words !== PAGE_WORDS.unnamed) {
      powers.push(said);
    } else if (!unnamed) {
      powers.push({ key: "unnamed", words: CARD_WORDS.unnamed, under: null, whose: null });
      unnamed = true;
    }
  }
  return powers;
}

/** The card, from the row fieldd answered for the download and the roster read with it (§9 "The
 * install card"). */
export function installCard(
  record: PluginRecord,
  snapshot: PluginRegistrySnapshot | null,
  roster: readonly DeviceInfo[] | null,
  onMac: boolean,
): InstallCard {
  const objects = record.contributions.objects.map((object) => ({
    key: `object:${object.type}`,
    words: object.tray?.label ?? object.title,
  }));
  const tools = record.contributions.mcp?.tools.length ?? 0;
  const powers = cardPowers(record, snapshot, onMac);
  const desktops = cardDesktops(roster);
  return {
    ask: CARD_WORDS.ask(record.title),
    adds: objects.length > 0 ? CARD_WORDS.adds(objects.length) : null,
    objects,
    tools: tools > 0 ? CARD_WORDS.tools(tools) : null,
    can:
      powers.length > 0
        ? CARD_WORDS.can
        : objects.length > 0
          ? PAGE_WORDS.nothing
          : PAGE_WORDS.nothingNoObject,
    powers,
    reaches:
      desktops === null
        ? null
        : desktops.length > 1
          ? CARD_WORDS.reaches(desktops.length)
          : CARD_WORDS.here(onMac),
    desktops: desktops !== null && desktops.length > 1 ? desktops : [],
  };
}

/** What stands where a page's act stands (§8, the act drawn under "Real progress"): words, a
 * control, or the card. `live`: whether its control takes a press. Installed's `show` is the set
 * Show them on the pegboard hands the board (MK-4d; `boardSet`): empty, it offers no such act. */
export type PageAct =
  | { readonly kind: "none" }
  | { readonly kind: "installed"; readonly show: readonly string[] }
  | { readonly kind: "install"; readonly live: boolean; readonly note: string | null }
  | { readonly kind: "needs-newer" }
  | { readonly kind: "downloading" }
  | { readonly kind: "statement"; readonly heading: string; readonly live: boolean }
  | { readonly kind: "card"; readonly card: InstallCard; readonly live: boolean }
  | { readonly kind: "installing"; readonly words: string }
  | { readonly kind: "failed"; readonly words: string; readonly live: boolean }
  /** MK-UC's UC-C: an installed plugin's page whose update waits; `asks` when the list says it
   * removes an object (Update…) */
  | { readonly kind: "update"; readonly live: boolean; readonly asks: boolean };

/** SHOW THEM ON THE PEGBOARD (MK-4d; MK-D8, ruled A by James 2026-11-11, its fallback B; DESIGN.md
 * §8 "The pegboard", "After an install"): the object types an installed plugin's act hands the
 * board, in the set's own order — those with a pegboard entry, for an object with none hangs
 * nowhere (contracts `TrayEntryContribution`). None while the plugin is off, turned off or held
 * off while community plugins are off (`state`, the one truth every reader decides by): the desk
 * is mounted without its kinds (P3c), so a board shown them would wait for nothing. */
export function boardSet(record: PluginRecord | undefined): string[] {
  if (record === undefined || record.state !== "enabled") return [];
  return record.contributions.objects
    .filter((object) => object.tray !== undefined)
    .map((object) => object.type);
}

/** Whether an Install may be pressed now: fieldd answers, and the list held is neither offline nor
 * past its date (§8 "The read on open": offline an Install waits, saying why; a list past its date
 * makes installs wait). */
export function installLive(state: PluginsCatalogState | null, away: boolean): boolean {
  return !away && state !== "unreachable" && state !== "stale";
}

/** A page's act, from the page, the list held, the install under way and whether fieldd answers. An
 * installed plugin's act is Installed, whatever an install said last: the snapshot is the one truth
 * (the P5 law). */
export function pageAct(input: {
  readonly page: PluginPage;
  readonly entry: PluginsCatalogEntry | undefined;
  readonly state: PluginsCatalogState | null;
  readonly flow: InstallFlow | null;
  readonly away: boolean;
  /** whether community plugins are on (null: not read); a community set installs only while on */
  readonly community: boolean | null;
  readonly snapshot: PluginRegistrySnapshot | null;
  readonly onMac: boolean;
}): PageAct {
  const { page, entry, state, flow, away, community, snapshot, onMac } = input;
  if (page.installed) {
    const record = snapshot?.plugins.find((plugin) => plugin.id === page.id);
    return { kind: "installed", show: boardSet(record) };
  }
  // a page of a set this desktop doesn't have is read from the list's entry, so it always has one
  if (entry === undefined) return { kind: "none" };
  // a community set installs only while community plugins are on (fieldd refuses it otherwise,
  // MK-2c); while they are off its Install says why (MK-O3D), and while they are unread it says
  // nothing, since they may be on
  const closed = entry.listedAs === "community" && community !== true;
  if (flow !== null && flow.id === page.id) {
    switch (flow.at.step) {
      case "downloading":
        return { kind: "downloading" };
      case "statement":
        // MK-O3D: this desktop by the name the roster gives it, as the card names it; with no
        // roster read, as the card says this desktop
        return {
          kind: "statement",
          heading: INSTALL_WORDS.firstCommunity(
            flow.at.roster?.find((device) => device.self)?.name ?? REMOVE_WORDS.here(onMac),
          ),
          live: !away,
        };
      case "card":
        return {
          kind: "card",
          card: installCard(flow.at.record, snapshot, flow.at.roster, onMac),
          live: !away,
        };
      case "installing":
        return { kind: "installing", words: INSTALL_WORDS.installing(flow.at.objects) };
      case "failed":
        // worded by its kind: a plugin this VibeField can't run says so, with no Try again; Try
        // again takes a press when Install would
        return flow.at.refusal === "incompatible"
          ? { kind: "needs-newer" }
          : {
              kind: "failed",
              words: INSTALL_WORDS.failed(page.title),
              live: installLive(state, away) && !closed,
            };
    }
  }
  if (!entry.compatible) return { kind: "needs-newer" };
  // one install at a time: another plugin's, once its card's Install was pressed, holds every other
  // Install
  const busy = flow !== null && flow.at.step === "installing";
  return {
    kind: "install",
    live: installLive(state, away) && !busy && !closed,
    note:
      state === "unreachable"
        ? INSTALL_WORDS.offline
        : closed && community === false
          ? INSTALL_WORDS.communityOff
          : null,
  };
}
