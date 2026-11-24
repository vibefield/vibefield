// VT-2 (track VT, 2026-11-24) — the Vitals window's words (DESIGN.md §9 "Vitals' words"). The window is for whoever
// is fixing VibeField, so it names VibeField's insides; a terminal's row says no title, folder or command (VT-D4).

const GROUPS: Readonly<Record<string, string>> = {
  shell: "VibeField",
  fieldd: "fieldd",
  floor: "The floor",
  agents: "Your terminals",
  observer: "Vitals",
};

const ROLES: Readonly<Record<string, string>> = {
  main: "Main",
  window: "Desk window",
  gpu: "GPU",
  utility: "Helper",
  "browser-pane": "Browser pane",
  "studio-window": "Studio",
  "vitals-window": "Vitals window",
  fieldd: "fieldd",
  "files-host": "Files host",
  "transcripts-host": "Transcripts host",
  "flows-host": "Flows host",
  rosettad: "rosettad",
  "plugin-process": "Plugin process",
  "field-native": "field-native",
  "terminal-cell": "Terminal cell",
  "mesh-sidecar": "Mesh sidecar",
  "freeway-host": "Freeway host",
  terminal: "Terminal",
  other: "Other",
};

/** A group's eyebrow. A group this build does not know is said by its own word. */
export function groupWord(group: string): string {
  return GROUPS[group] ?? group;
}

/** A row's name: the label fieldd composed where it gave one, else the role's word; a row that covers a tree says
 * how many processes it counts. */
export function rowName(
  process: { role: string; label?: string | undefined },
  processes?: number,
): string {
  const name = process.label ?? ROLES[process.role] ?? process.role;
  return processes !== undefined && processes > 1 ? `${name} · ${processes} processes` : name;
}

export const VITALS_WORDS = {
  title: "Vitals",
  now: "Now",
  at: (clock: string): string => `At ${clock}`,
  cpu: "CPU",
  memory: "Memory",
  window: "5 min",
  total: "All of VibeField",
  totalNote: "Your terminals aren't counted in it.",
  cpuLane: "CPU · share of one core",
  memoryLane: "Memory",
  logs: "Logs",
  nothingYet: "Nothing has been measured yet.",
  noLines: "No lines in this span.",
  notMeasured: "–",
  legend: { shell: "VibeField", fieldd: "fieldd", floor: "the floor", agents: "your terminals" },
} as const;

/** The state's one line, and whether it is the recording state (the only one whose dot is green). An unknown state
 * is said as waiting: nothing is drawn as running that did not say so. */
export function stateWords(state: string): { words: string; recording: boolean } {
  switch (state) {
    case "recording":
      return { words: "Recording · every second", recording: true };
    case "connecting":
      return { words: "Connecting to fieldd…", recording: false };
    case "unavailable":
      return { words: "Not measured on this computer", recording: false };
    case "unreachable":
      return { words: "fieldd isn't answering", recording: false };
    default:
      return { words: "Waiting for the floor's meter", recording: false };
  }
}

/** A share of one core: whole percent, one decimal under one percent, and cores from one core up. */
export function cpuWords(share: number | null, asCores = false): string {
  if (share === null) return VITALS_WORDS.notMeasured;
  if (asCores && share >= 1) return `${share.toFixed(1)} cores`;
  const percent = share * 100;
  if (percent > 0 && percent < 0.95) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}

/** Bytes as Activity Monitor says them: binary units, said MB and GB; whole MB, one decimal from 1 GB. */
export function memoryWords(bytes: number | null): string {
  if (bytes === null) return VITALS_WORDS.notMeasured;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 1) return `${Math.round(mb)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
}

/** A scale's top, said: a CPU share, or bytes. */
export function cpuScaleWords(max: number): string {
  return max >= 1 ? `${trim(max)} ${max === 1 ? "core" : "cores"}` : `${trim(max * 100)}%`;
}

export function memoryScaleWords(max: number): string {
  const mb = max / (1024 * 1024);
  return mb >= 1024 ? `${trim(mb / 1024)} GB` : `${trim(mb)} MB`;
}

function trim(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

const two = (value: number): string => value.toString().padStart(2, "0");

/** A wall-clock time in the person's own zone: `14:02:10`, with milliseconds for a log line, or `14:02` for the axis. */
export function clockWords(
  time: number,
  precision: "minute" | "second" | "milli" = "second",
): string {
  const date = new Date(time);
  const base = `${two(date.getHours())}:${two(date.getMinutes())}`;
  if (precision === "minute") return base;
  const seconds = `${base}:${two(date.getSeconds())}`;
  return precision === "second"
    ? seconds
    : `${seconds}.${date.getMilliseconds().toString().padStart(3, "0")}`;
}

export function lineCountWords(count: number): string {
  return count === 1 ? "1 line" : `${count} lines`;
}
