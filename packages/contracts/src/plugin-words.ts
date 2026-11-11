// MK-1 — the powers' plain words (MK-D7, MK-E12; DESIGN.md §9 "The plugins' words", "The powers' plain words").
//
// A power is said as what it lets the plugin do, in one sentence, the same on the install card and on the plugin's
// page, and never by its id. DESIGN.md §9 is the source and governs: a word changes there first, then here. Fifteen
// of these (the four changed from the page and the eleven it did not draw) are drafts James accepted
// (2026-11-11 06:48:31Z), judged on screen at MK-4. Zero imports: contracts stays dependency-free.

/** The five groups the words are laid out in, in order. */
export const PLUGIN_POWER_GROUPS = ["desk", "agents", "devices", "own", "window"] as const;
export type PluginPowerGroup = (typeof PLUGIN_POWER_GROUPS)[number];

export interface PluginPowerWords {
  readonly group: PluginPowerGroup;
  /** the sentence, as on a Mac */
  readonly words: string;
  /** off the Mac, where the sentence names the machine ("this PC") */
  readonly offMac?: string;
  /** a second line under it, on a Mac */
  readonly macNote?: string;
}

/** One entry per core power a plugin may hold: the keys are exactly `PLUGIN_CAPABILITY_ELIGIBILITY`'s (a test holds
 * them equal). */
export const PLUGIN_POWER_WORDS = {
  "canvas.read": { group: "desk", words: "Read what's on the desk" },
  "canvas.write": { group: "desk", words: "Change what's on the desk" },
  "doc.read": { group: "desk", words: "See your desks" },
  "doc.write": { group: "desk", words: "Make, open, rename and delete desks" },
  "surface.attach": { group: "desk", words: "Show live windows on the desk" },
  "surface.browser": { group: "desk", words: "Open web pages in a pane" },
  "surface.capture": {
    group: "desk",
    words: "See other apps' windows",
    macNote: "macOS asks you once, for Screen Recording",
  },
  "agent.observe": { group: "agents", words: "See what your agents are doing" },
  "agent.spawn": { group: "agents", words: "Start your agents and manage their sign-ins" },
  "agent.control": { group: "agents", words: "Pause or stop what your agents are doing" },
  "approval.respond": { group: "agents", words: "Answer what your agents ask you to allow" },
  "mcp.consume": { group: "agents", words: "Use the tools other plugins offer" },
  "mcp.contribute": { group: "agents", words: "Give your agents tools" },
  "index.read": { group: "agents", words: "See what your History holds" },
  "terminal.attach": { group: "agents", words: "Open, use and end your terminal sessions" },
  "workspace.read": {
    group: "devices",
    words: "See who you are, your devices, and the apps and services on them",
  },
  "artifact.publish": { group: "devices", words: "Publish apps to your devices" },
  "storage.self": { group: "own", words: "Keep its own data" },
  background: { group: "own", words: "Keep running in the background" },
  "services.provide": { group: "own", words: "Offer a service to other plugins" },
  "process.spawn": {
    group: "own",
    words: "Run programs on this Mac",
    offMac: "Run programs on this PC",
  },
  "net.outbound": { group: "own", words: "Reach the internet" },
  "shell.windows": { group: "window", words: "Open windows of its own" },
  "shell.dialog": { group: "window", words: "Ask you to pick a folder" },
  "shell.clipboard": { group: "window", words: "Use your clipboard" },
  "shell.open": { group: "window", words: "Open web links in your browser" },
  "shell.webcontents": { group: "window", words: "Show web pages in its own views" },
} as const satisfies Readonly<Record<string, PluginPowerWords>>;
export type PluginPowerId = keyof typeof PLUGIN_POWER_WORDS;

/** The sentence for a core power, on this machine; undefined for an id that is not a core power (a plugin's own
 * `x.*` power is said by the title its declaring plugin wrote, `pluginOwnPowerLine`). A caller on a Mac also reads
 * the entry's `macNote`, the second line under it. */
export function pluginPowerWords(
  id: string,
  opts: { readonly onMac: boolean },
): string | undefined {
  if (!Object.hasOwn(PLUGIN_POWER_WORDS, id)) return undefined;
  const entry: PluginPowerWords = PLUGIN_POWER_WORDS[id as PluginPowerId];
  return !opts.onMac && entry.offMac !== undefined ? entry.offMac : entry.words;
}

/** The line under a plugin's own power, so its words are never taken for VibeField's: "A power of its own, named by
 * ‹plugin›", or, when the plugin asking is not the one that declares it, "A power ‹plugin› names". Both are drafts,
 * judged on screen at MK-4 with the rest (DESIGN.md §9). */
export function pluginOwnPowerLine(
  declaringPluginTitle: string,
  askingIsDeclaring: boolean,
): string {
  return askingIsDeclaring
    ? `A power of its own, named by ${declaringPluginTitle}`
    : `A power ${declaringPluginTitle} names`;
}
