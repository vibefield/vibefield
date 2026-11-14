import type { DeviceInfo, PluginRecord } from "@vibefield/contracts";
import { cardDesktops } from "./plugins-install";
import { listNames, REMOVE_WORDS } from "./plugins-words";

// REMOVE… ON A PLUGIN'S PAGE (MK-4f; DESIGN.md §8 "The destructive uninstall affordance", the acts,
// and Remove… drawn under "Real progress"; §9 "Installed, off and Remove…"): §8's two-step
// destructive confirm, in place. Remove… takes the set off every desktop, its settings and data
// kept (MK-E10); Remove it and its data… deletes them on this desktop alone, and your other
// desktops remove the plugin and keep their copy (James's MK-O4 pick: "This desktop alone"). Both
// are one request fieldd already answers (`plugins.uninstall`, `removeData`). Pure: the controller
// holds the question, and the tests read the same functions.

export type RemoveStep = "ask" | "ask-data";

/** The question standing on a plugin's page. */
export interface RemoveAsk {
  readonly id: string;
  readonly step: RemoveStep;
  /** the roster read as Remove… was pressed; null until it answers, or when it can't be read */
  readonly roster: readonly DeviceInfo[] | null;
  /** its request is out: nothing takes a press, and it stands until the plugin is gone */
  readonly sending: boolean;
}

/** What a question says. */
export interface RemoveQuestion {
  readonly ask: string;
  readonly lines: readonly string[];
  readonly confirm: string;
  /** the second question's confirm, in the danger ink (§2.5) */
  readonly danger: boolean;
  /** "Remove it and its data…", under the first question's acts; null on the second */
  readonly further: string | null;
}

/** Whether Remove… stands on a plugin's page: fieldd removes a plugin from the plugin list and
 * refuses every other (`plugin-install.ts`, `uninstall`). A Built in plugin is never removed; a
 * Development one's folder is its developer's, so its page carries none (DESIGN.md §8, the call
 * closed 2026-11-14 at MK's lean); and a Sideloaded one carries none while fieldd removes no
 * sideload. */
export function removable(record: PluginRecord): boolean {
  return record.source === "registry";
}

/** The question for a plugin, in its step. The first names the objects that will draw as missing;
 * the second says where its settings and data are deleted — this desktop alone — and which of your
 * other desktops remove it too, by the roster's names (none while the roster can't be read). */
export function removeQuestion(
  record: PluginRecord,
  step: RemoveStep,
  roster: readonly DeviceInfo[] | null,
  onMac: boolean,
): RemoveQuestion {
  if (step === "ask") {
    const { objects: adds } = record.contributions;
    const objects = adds.map((object) => object.tray?.label ?? object.title);
    return {
      ask: REMOVE_WORDS.ask(record.title),
      lines:
        objects.length > 0
          ? [REMOVE_WORDS.kept, REMOVE_WORDS.missing(listNames(objects))]
          : [REMOVE_WORDS.kept],
      confirm: REMOVE_WORDS.confirm,
      danger: false,
      further: REMOVE_WORDS.further,
    };
  }
  const here = roster?.find((device) => device.self)?.deviceId;
  const others = (cardDesktops(roster) ?? [])
    .filter((desktop) => desktop.key !== here)
    .map((desktop) => desktop.name);
  return {
    ask: REMOVE_WORDS.askData(record.title),
    lines: [
      REMOVE_WORDS.deletes(REMOVE_WORDS.here(onMac)),
      ...(others.length > 0 ? [REMOVE_WORDS.others(others, record.title)] : []),
    ],
    confirm: REMOVE_WORDS.confirmData,
    danger: true,
    further: null,
  };
}
