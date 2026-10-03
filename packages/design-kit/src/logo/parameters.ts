export const LOGO_NUMBERS = {
  scale: { label: "Scale", min: 0.45, max: 1.4, step: 0.01, value: 1 },
  width: { label: "Loop width", min: 0.65, max: 1.35, step: 0.01, value: 1.08 },
  height: { label: "Loop height", min: 0.18, max: 0.65, step: 0.01, value: 0.38 },
  thickness: { label: "Ribbon width", min: 0.015, max: 0.11, step: 0.001, value: 0.043 },
  taper: { label: "Ribbon taper", min: 0, max: 0.65, step: 0.01, value: 0.28 },
  roundness: { label: "Pinch", min: 0, max: 0.8, step: 0.01, value: 0.16 },
  rotation: { label: "Rotation", min: -45, max: 45, step: 1, value: -5 },
  asymmetry: { label: "Asymmetry", min: -0.3, max: 0.3, step: 0.01, value: 0.06 },
  chromatic: { label: "Spectral edge", min: 0, max: 1, step: 0.01, value: 0.55 },
  iridescence: { label: "Pearlescence", min: 0, max: 1, step: 0.01, value: 0.12 },
  glow: { label: "Ribbon glow", min: 0, max: 1, step: 0.01, value: 0.12 },
  field: { label: "Field intensity", min: 0, max: 1, step: 0.01, value: 0.85 },
  saturation: { label: "Saturation", min: 0, max: 1.5, step: 0.01, value: 1.1 },
  exposure: { label: "Exposure", min: 0.4, max: 1.5, step: 0.01, value: 1.08 },
  rays: { label: "Light filaments", min: 0, max: 1, step: 0.01, value: 0.42 },
  density: { label: "Filament count", min: 30, max: 480, step: 1, value: 220 },
  spread: { label: "Light diffusion", min: 0.15, max: 1, step: 0.01, value: 0.6 },
  twist: { label: "Field twist", min: -1.5, max: 1.5, step: 0.01, value: 0.24 },
  grain: { label: "Film grain", min: 0, max: 0.12, step: 0.001, value: 0.028 },
  vignette: { label: "Vignette", min: 0, max: 1, step: 0.01, value: 0.2 },
  speed: { label: "Overall speed", min: 0, max: 2, step: 0.01, value: 2 },
  breathe: { label: "Breathing", min: 0, max: 1, step: 0.01, value: 0.26 },
  drift: { label: "Color drift", min: 0, max: 1, step: 0.01, value: 0.2 },
  parallax: { label: "Pointer response", min: 0, max: 1, step: 0.01, value: 0.3 },
  rollAngle: { label: "View tilt", min: -30, max: 30, step: 1, value: 5 },
  twistFocus: { label: "Twist focus", min: 0, max: 1, step: 0.01, value: 0 },
  rollSpeed: { label: "Circulation speed", min: -2, max: 2, step: 0.01, value: 1.32 },
  depth: { label: "Loop depth", min: 0, max: 0.6, step: 0.01, value: 0.27 },
  perspective: { label: "Perspective", min: 0, max: 1.2, step: 0.01, value: 0.63 },
  edgeFlow: { label: "Highlight strength", min: 0, max: 2, step: 0.01, value: 0.7 },
  edgeSpeed: { label: "Highlight speed", min: -3, max: 3, step: 0.01, value: 3 },
  edgeLength: { label: "Falloff length", min: 0.05, max: 1, step: 0.01, value: 0.83 },
  edgePulses: { label: "Highlight count", min: 1, max: 8, step: 1, value: 7 },
} as const;

export type LogoNumber = keyof typeof LOGO_NUMBERS;
export type LogoColor = "colorA" | "colorB" | "colorC" | "colorD" | "background" | "ink";
export type LogoParameters = Record<LogoNumber, number> & Record<LogoColor, string>;

export const DEFAULT_LOGO: LogoParameters = {
  ...Object.fromEntries(Object.entries(LOGO_NUMBERS).map(([key, spec]) => [key, spec.value])),
  colorA: "#ff3985",
  colorB: "#3159e8",
  colorC: "#ffab53",
  colorD: "#43dfbd",
  background: "#ede8ed",
  ink: "#ffffff",
} as LogoParameters;

export const LOGO_COLORS: { key: LogoColor; label: string }[] = [
  { key: "colorA", label: "Rose" },
  { key: "colorB", label: "Cobalt" },
  { key: "colorC", label: "Amber" },
  { key: "colorD", label: "Mint" },
  { key: "background", label: "Ground" },
  { key: "ink", label: "Ribbon" },
];

export const LOGO_PRESETS = [
  { id: "prism", name: "Prism", note: "Light, unfolded.", parameters: { ...DEFAULT_LOGO } },
  {
    id: "afterglow",
    name: "Afterglow",
    note: "A little after dark.",
    parameters: {
      ...DEFAULT_LOGO,
      background: "#100e1b",
      exposure: 0.78,
      field: 0.65,
      rays: 0.24,
      glow: 0.24,
      vignette: 0.6,
      colorA: "#e62e79",
      colorB: "#4849d8",
      colorC: "#e87540",
      colorD: "#468d9c",
      iridescence: 0.22,
      speed: 0.22,
      rollSpeed: 0.45,
      edgeFlow: 0.55,
      edgeSpeed: 0.5,
    },
  },
  {
    id: "daylight",
    name: "Daylight",
    note: "Room to breathe.",
    parameters: {
      ...DEFAULT_LOGO,
      background: "#f0f0ed",
      field: 0.24,
      rays: 0.12,
      saturation: 0.65,
      vignette: 0.04,
      chromatic: 0.32,
      grain: 0.018,
      speed: 0.18,
      ink: "#24242c",
      iridescence: 0,
      glow: 0.015,
      thickness: 0.03,
      rollSpeed: 0.4,
      edgeFlow: 0.18,
      edgeSpeed: 0.45,
    },
  },
  {
    id: "signal",
    name: "Signal",
    note: "Turn up the frequency.",
    parameters: {
      ...DEFAULT_LOGO,
      background: "#121719",
      colorA: "#ff3e57",
      colorB: "#1246ff",
      colorC: "#ab61ff",
      colorD: "#00ff98",
      field: 0.23,
      rays: 0.7,
      density: 320,
      chromatic: 1,
      glow: 0.22,
      iridescence: 0.35,
      thickness: 0.026,
      speed: 0.6,
      twist: -0.35,
      exposure: 0.9,
      rollSpeed: 0.8,
      edgeFlow: 0.8,
      edgeSpeed: 0.9,
    },
  },
  {
    id: "ink",
    name: "Ink",
    note: "One unbroken thought.",
    parameters: {
      ...DEFAULT_LOGO,
      background: "#f4f3f0",
      ink: "#202022",
      field: 0,
      rays: 0,
      chromatic: 0,
      glow: 0,
      iridescence: 0,
      grain: 0.012,
      vignette: 0,
      breathe: 0.07,
      thickness: 0.033,
      exposure: 1,
      edgeFlow: 0,
    },
  },
] as const;

/** Untrusted URLs, local storage, and imported files all pass through this boundary. */
export function normalizeLogo(input: unknown): LogoParameters {
  const result = { ...DEFAULT_LOGO };
  if (typeof input !== "object" || input === null || Array.isArray(input)) return result;
  const values = input as Record<string, unknown>;
  // Keep earlier studio looks useful when their rocking range becomes a local twist.
  if (
    values.twistFocus === undefined &&
    typeof values.rollRange === "number" &&
    Number.isFinite(values.rollRange)
  )
    result.twistFocus = Math.min(1, Math.max(0, values.rollRange / 40));
  for (const key of Object.keys(LOGO_NUMBERS) as LogoNumber[]) {
    const value = values[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const spec = LOGO_NUMBERS[key];
    result[key] = Math.min(spec.max, Math.max(spec.min, value));
    if (key === "edgePulses") result[key] = Math.round(result[key]);
  }
  for (const { key } of LOGO_COLORS) {
    const value = values[key];
    if (typeof value === "string" && /^#[\da-f]{6}$/i.test(value)) result[key] = value;
  }
  return result;
}

export function serializeLogo(parameters: LogoParameters): string {
  return JSON.stringify({ version: 1, parameters: normalizeLogo(parameters) }, null, 2);
}

export function parseLogo(source: string): LogoParameters {
  const data: unknown = JSON.parse(source);
  if (
    !data ||
    typeof data !== "object" ||
    !("version" in data) ||
    data.version !== 1 ||
    !("parameters" in data) ||
    !data.parameters ||
    typeof data.parameters !== "object" ||
    Array.isArray(data.parameters)
  )
    throw new Error("Choose a VibeField logo preset (version 1).");
  return normalizeLogo(data.parameters);
}
