import {
  DEFAULT_LOGO,
  LivingLogo,
  type LivingLogoHandle,
  LOGO_COLORS,
  LOGO_NUMBERS,
  LOGO_PRESETS,
  type LogoColor,
  type LogoNumber,
  type LogoParameters,
  type LogoStatus,
  logoSvg,
  normalizeLogo,
  parseLogo,
  serializeLogo,
} from "@vibefield/design-kit/logo";
import { UiButton, UiIconButton, UiSwitch } from "@vibefield/design-kit/primitives";
import { type CSSProperties, type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import "./logo-studio.css";

const STORAGE_KEY = "vf-logo-studio-v1";
const GROUPS = {
  Shape: [
    [
      "Silhouette",
      ["scale", "width", "height", "thickness", "taper", "roundness", "rotation", "asymmetry"],
    ],
    ["Ribbon finish", ["chromatic", "iridescence", "glow"]],
  ],
  Light: [
    ["Atmosphere", ["field", "saturation", "exposure", "spread"]],
    ["Filaments & texture", ["rays", "density", "twist", "grain", "vignette"]],
  ],
  Motion: [
    ["Möbius flow · 3D", ["rollAngle", "twistFocus", "rollSpeed", "depth", "perspective"]],
    ["Light along the edges", ["edgeFlow", "edgeSpeed", "edgeLength", "edgePulses"]],
    ["Overall movement", ["speed", "breathe", "drift", "parallax"]],
  ],
} as const;
type Tab = keyof typeof GROUPS;
type PresetId = (typeof LOGO_PRESETS)[number]["id"] | "custom";

function initialParameters(): LogoParameters {
  try {
    const shared = new URLSearchParams(window.location.hash.slice(1)).get("logo");
    if (shared) return parseLogo(shared);
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? parseLogo(stored) : { ...DEFAULT_LOGO };
  } catch {
    return { ...DEFAULT_LOGO };
  }
}

function presetId(parameters: LogoParameters): PresetId {
  return (
    LOGO_PRESETS.find((preset) =>
      Object.entries(preset.parameters).every(
        ([key, value]) => parameters[key as keyof LogoParameters] === value,
      ),
    )?.id ?? "custom"
  );
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Glyph({
  name,
}: {
  name: "pause" | "play" | "arrow" | "reset" | "sun" | "moon" | "expand" | "close" | "download";
}): ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "pause" && <path d="M9 5v14M15 5v14" />}
      {name === "play" && <path d="m8 5 11 7-11 7Z" />}
      {name === "arrow" && <path d="M5 12h14m-5-5 5 5-5 5" />}
      {name === "reset" && <path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" />}
      {name === "sun" && (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" />
        </>
      )}
      {name === "moon" && <path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z" />}
      {name === "expand" && <path d="M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5" />}
      {name === "close" && <path d="m6 6 12 12M6 18 18 6" />}
      {name === "download" && <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />}
    </svg>
  );
}

const thumbStyle = (p: LogoParameters): CSSProperties =>
  ({
    "--logo-thumb-a": p.colorA,
    "--logo-thumb-b": p.colorB,
    "--logo-thumb-c": p.colorC,
    "--logo-thumb-bg": p.background,
    "--logo-thumb-field": p.field,
  }) as CSSProperties;

function MarkImage({
  parameters,
  className = "",
}: {
  parameters: LogoParameters;
  className?: string;
}): ReactElement {
  return (
    <img
      className={className}
      alt=""
      src={`data:image/svg+xml,${encodeURIComponent(logoSvg(parameters))}`}
    />
  );
}

export function LogoStudio(): ReactElement {
  const [storedParameters, setParameters] = useState(initialParameters);
  // Fast Refresh can retain an older parameter object while new controls are added.
  const parameters = useMemo(() => normalizeLogo(storedParameters), [storedParameters]);
  const [tab, setTab] = useState<Tab>("Shape");
  const [playing, setPlaying] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [dark, setDark] = useState(false);
  const [focus, setFocus] = useState(false);
  const [status, setStatus] = useState<LogoStatus>({
    state: "loading",
    message: "Preparing the light field",
  });
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const [alpha, setAlpha] = useState(false);
  const [size, setSize] = useState(2048);
  const logo = useRef<LivingLogoHandle>(null);
  const importFile = useRef<HTMLInputElement>(null);
  const current = presetId(parameters);
  const preset = LOGO_PRESETS.find((p) => p.id === current);
  const groundRgb = Number.parseInt(parameters.background.slice(1), 16);
  const lightGround =
    (((groundRgb >> 16) & 255) + ((groundRgb >> 8) & 255) + (groundRgb & 255)) / 765 > 0.6;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, serializeLogo(parameters));
      } catch {
        setNotice("Your browser could not save this session. Export a preset to keep it.");
      }
    }, 250);
    return () => clearTimeout(timeout);
  }, [parameters]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFocus(false);
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(target.tagName))
      )
        return;
      if (event.code === "Space") {
        event.preventDefault();
        setPlaying((p) => !p);
      }
    };
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const motion = () => {
      if (media.matches) setPlaying(false);
    };
    window.addEventListener("keydown", keyboard);
    media.addEventListener("change", motion);
    return () => {
      window.removeEventListener("keydown", keyboard);
      media.removeEventListener("change", motion);
    };
  }, []);

  function update(key: LogoNumber | LogoColor, value: number | string): void {
    setParameters((p) => normalizeLogo({ ...p, [key]: value }));
  }

  async function exportPng(): Promise<void> {
    setExporting(true);
    try {
      if (!logo.current) throw new Error("The canvas is still preparing.");
      download(
        await logo.current.snapshot(size, alpha),
        `vibefield-${current}-${size}${alpha ? "-transparent" : ""}.png`,
      );
      setNotice(`${size} × ${size} PNG exported.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "PNG export failed. Try again.");
    } finally {
      setExporting(false);
    }
  }

  async function share(): Promise<void> {
    const url = new URL(window.location.href);
    url.hash = new URLSearchParams({ logo: serializeLogo(parameters) }).toString();
    try {
      await navigator.clipboard.writeText(url.toString());
      setNotice("Link copied with your current settings.");
    } catch {
      setNotice("Clipboard unavailable. Export a preset to share this look.");
    }
  }

  return (
    <div
      className={`vf-logo-studio ${dark ? "dark" : ""} ${focus ? "is-focused" : ""}`}
      data-theme={dark ? "dark" : "light"}
    >
      <header className="vf-logo-studio__header">
        <a className="vf-logo-studio__brand" href="./design-system.html#living-mark">
          <MarkImage parameters={{ ...DEFAULT_LOGO, ink: dark ? "#f5f5f7" : "#1c1c1e" }} />
          <strong>VibeField</strong>
          <span className="vf-logo-studio__divider" />
          <span>Logo studio</span>
        </a>
        <div className="vf-logo-studio__header-actions">
          <span className="vf-logo-studio__edition">Identity studies / 001</span>
          <UiIconButton
            aria-label={dark ? "Use light interface" : "Use dark interface"}
            onClick={() => setDark(!dark)}
          >
            <Glyph name={dark ? "sun" : "moon"} />
          </UiIconButton>
          <UiButton onClick={share}>
            Share look <Glyph name="arrow" />
          </UiButton>
        </div>
      </header>

      <main className="vf-logo-studio__main">
        <div className="vf-logo-studio__intro">
          <div>
            <p className="vf-logo-studio__eyebrow">THE LIVING MARK</p>
            <h1>One loop. Infinite possibility.</h1>
          </div>
          <p>
            A ribbon of light. A field of possibilities.
            <br />
            Find the frequency that feels like you.
          </p>
        </div>

        <div className="vf-logo-studio__workspace">
          <div className="vf-logo-studio__artwork">
            <div
              className="vf-logo-studio__stage"
              data-quiet={lightGround && parameters.field < 0.35}
            >
              <LivingLogo
                ref={logo}
                parameters={parameters}
                playing={playing}
                onStatus={setStatus}
              />
              <div className="vf-logo-studio__stage-top">
                <span className="vf-logo-studio__glass-label">
                  {preset?.name ?? "Your variation"}
                  <span> / Live canvas</span>
                </span>
                <UiIconButton
                  aria-label={focus ? "Exit focus view" : "Enter focus view"}
                  onClick={() => setFocus(!focus)}
                >
                  <Glyph name={focus ? "close" : "expand"} />
                </UiIconButton>
              </div>
              <div className="vf-logo-studio__stage-bottom">
                <span>
                  VibeField
                  <span className="vf-logo-studio__stage-caption">
                    A personal, programmable universe.
                  </span>
                </span>
                <div className="vf-logo-studio__playback">
                  <span>
                    {playing && parameters.speed > 0 && status.state === "ready"
                      ? "In motion"
                      : "Still frame"}
                  </span>
                  <UiIconButton
                    aria-label={playing ? "Pause animation" : "Play animation"}
                    onClick={() => setPlaying(!playing)}
                  >
                    <Glyph name={playing ? "pause" : "play"} />
                  </UiIconButton>
                </div>
              </div>
            </div>
            <div className="vf-logo-studio__canvas-meta">
              <span>
                <i data-state={status.state} />
                {status.state === "ready"
                  ? "Rendered with WebGPU"
                  : status.state === "loading"
                    ? "Preparing WebGPU…"
                    : "Static preview"}
              </span>
              <span>
                Move to feel the field <span className="vf-logo-studio__meta-separator">/</span>{" "}
                Space to pause
              </span>
            </div>
            {status.state === "unavailable" && (
              <p className="vf-logo-studio__error" role="status">
                {status.message} SVG and preset exports are available.
              </p>
            )}

            <div className="vf-logo-studio__preset-heading">
              <h2>Find a starting point</h2>
              <span>Five moods. One identity.</span>
            </div>
            <fieldset className="vf-logo-studio__presets" aria-label="Logo presets">
              {LOGO_PRESETS.map((item, index) => (
                <button
                  type="button"
                  key={item.id}
                  className="vf-logo-studio__preset"
                  aria-pressed={current === item.id}
                  onClick={() => setParameters({ ...item.parameters })}
                >
                  <span className="vf-logo-studio__thumbnail" style={thumbStyle(item.parameters)}>
                    <MarkImage parameters={item.parameters} />
                  </span>
                  <span className="vf-logo-studio__preset-name">
                    <span>{item.name}</span>
                    <span>0{index + 1}</span>
                  </span>
                </button>
              ))}
            </fieldset>
            <div className="vf-logo-studio__design-note">
              <span>THE IDEA</span>
              <p>
                The infinity you know, given a little life. A continuous ribbon carries the mark;
                color and light carry its energy. Keep it quiet, or let the whole field sing.
              </p>
            </div>
          </div>

          <aside className="vf-logo-studio__inspector" aria-label="Logo controls">
            <header>
              <div>
                <h2>Make it yours</h2>
                <span>
                  {preset ? `${preset.name} · ${preset.note}` : "Custom · Your own frequency."}
                </span>
              </div>
              <UiIconButton
                aria-label="Reset to Prism"
                title="Reset to Prism"
                onClick={() => setParameters({ ...DEFAULT_LOGO })}
              >
                <Glyph name="reset" />
              </UiIconButton>
            </header>
            <div className="vf-logo-studio__tabs" role="tablist" aria-label="Parameter groups">
              {(Object.keys(GROUPS) as Tab[]).map((name) => (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  id={`logo-tab-${name}`}
                  aria-selected={tab === name}
                  aria-controls="logo-parameter-panel"
                  tabIndex={tab === name ? 0 : -1}
                  onClick={() => setTab(name)}
                  onKeyDown={(event) => {
                    const names = Object.keys(GROUPS) as Tab[];
                    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
                    event.preventDefault();
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? 2
                          : (names.indexOf(name) + (event.key === "ArrowRight" ? 1 : 2)) % 3;
                    setTab(names[next]!);
                    document.getElementById(`logo-tab-${names[next]}`)?.focus();
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
            <div
              className="vf-logo-studio__parameters"
              id="logo-parameter-panel"
              role="tabpanel"
              aria-labelledby={`logo-tab-${tab}`}
            >
              {GROUPS[tab].map(([label, keys]) => (
                <fieldset key={label}>
                  <legend>{label}</legend>
                  {keys.map((key) => (
                    <Parameter
                      key={key}
                      name={key}
                      value={parameters[key]}
                      onChange={(value) => update(key, value)}
                    />
                  ))}
                </fieldset>
              ))}
              {tab === "Motion" && (
                <div className="vf-logo-studio__motion-note">
                  <UiSwitch label="Animate the logo" checked={playing} onChange={setPlaying} />
                  <p>
                    A half-twist travels continuously around the infinity. Twist focus gathers it
                    into a tighter fold; negative speeds reverse the flow. Pause freezes the ribbon
                    and light. Your system’s reduced-motion preference is respected.
                  </p>
                </div>
              )}
            </div>

            <section className="vf-logo-studio__palette" aria-labelledby="logo-palette-title">
              <div>
                <h3 id="logo-palette-title">The palette</h3>
                <span>Click to recolor</span>
              </div>
              <div className="vf-logo-studio__swatches">
                {LOGO_COLORS.map(({ key, label }) => (
                  <label key={key}>
                    <span style={{ "--logo-swatch": parameters[key] } as CSSProperties}>
                      <input
                        aria-label={`${label} color`}
                        type="color"
                        value={parameters[key]}
                        onChange={(event) => update(key, event.target.value)}
                      />
                    </span>
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </section>

            <section className="vf-logo-studio__export" aria-labelledby="logo-export-title">
              <h3 id="logo-export-title">Take it with you</h3>
              <div className="vf-logo-studio__export-options">
                <label>
                  Resolution
                  <select
                    aria-label="PNG resolution"
                    value={size}
                    onChange={(event) => setSize(Number(event.target.value))}
                  >
                    <option value={1024}>1024 × 1024</option>
                    <option value={2048}>2048 × 2048</option>
                    <option value={4096}>4096 × 4096</option>
                  </select>
                </label>
                <label className="vf-logo-studio__alpha">
                  <input
                    type="checkbox"
                    checked={alpha}
                    onChange={(event) => setAlpha(event.target.checked)}
                  />
                  Transparent mark
                </label>
              </div>
              <UiButton
                variant="primary"
                disabled={status.state !== "ready" || exporting}
                onClick={exportPng}
              >
                <Glyph name="download" />
                {exporting ? "Rendering…" : "Export PNG"}
              </UiButton>
              <div className="vf-logo-studio__export-secondary">
                <UiButton
                  onClick={() => {
                    download(
                      new Blob([logoSvg(parameters)], { type: "image/svg+xml" }),
                      `vibefield-${current}-mark.svg`,
                    );
                    setNotice("Flat vector mark exported. PNG includes the spectral finish.");
                  }}
                >
                  Vector SVG
                </UiButton>
                <UiButton
                  onClick={() => {
                    download(
                      new Blob([serializeLogo(parameters)], { type: "application/json" }),
                      `vibefield-${current}.json`,
                    );
                    setNotice(
                      `Preset exported with all ${Object.keys(DEFAULT_LOGO).length} parameters.`,
                    );
                  }}
                >
                  Save preset
                </UiButton>
              </div>
              <button
                type="button"
                className="vf-logo-studio__import"
                onClick={() => importFile.current?.click()}
              >
                Import a saved preset
              </button>
              <input
                ref={importFile}
                type="file"
                accept=".json,application/json"
                aria-label="Import logo preset"
                hidden
                onChange={async (event) => {
                  const input = event.currentTarget,
                    file = input.files?.[0];
                  if (!file) return;
                  try {
                    if (file.size > 32_768)
                      throw new Error("This file is too large for a logo preset.");
                    setParameters(parseLogo(await file.text()));
                    setNotice("Preset imported.");
                  } catch (error) {
                    setNotice(
                      error instanceof Error ? error.message : "Could not read this preset.",
                    );
                  } finally {
                    input.value = "";
                  }
                }}
              />
            </section>
          </aside>
        </div>
        <footer className="vf-logo-studio__footer">
          <span>
            VibeField <span>Always becoming.</span>
          </span>
          <a href="./design-system.html#living-mark">
            Back to the design system <Glyph name="arrow" />
          </a>
        </footer>
      </main>
      <div
        className="vf-logo-studio__notice"
        role="status"
        aria-live="polite"
        data-visible={Boolean(notice)}
      >
        {notice}
      </div>
    </div>
  );
}

function Parameter({
  name,
  value,
  onChange,
}: {
  name: LogoNumber;
  value: number;
  onChange: (value: number) => void;
}): ReactElement {
  const spec = LOGO_NUMBERS[name];
  return (
    <div className="vf-logo-studio__parameter">
      <label htmlFor={`logo-${name}`}>{spec.label}</label>
      <input
        className="vf-logo-studio__number"
        aria-label={`${spec.label} value`}
        type="number"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={Number(value.toFixed(3))}
        onChange={(event) => {
          if (event.target.value !== "" && Number.isFinite(event.target.valueAsNumber))
            onChange(event.target.valueAsNumber);
        }}
      />
      <input
        id={`logo-${name}`}
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        style={
          {
            "--logo-progress": `${((value - spec.min) / (spec.max - spec.min)) * 100}%`,
          } as CSSProperties
        }
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}
