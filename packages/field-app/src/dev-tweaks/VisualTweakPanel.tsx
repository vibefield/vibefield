import { type ChangeEvent, type ReactElement, useRef, useState } from "react";
import { defaultVisualTweakValues, type VisualTweakValues } from "../field/visual-tuning";
import { FloatingTweakPanel } from "./FloatingTweakPanel";
import {
  deserializeVisualTweaks,
  serializeVisualTweaks,
  VISUAL_TWEAK_FILE_NAME,
} from "./visual-tweak-document";

export interface VisualTweakPanelProps {
  value: VisualTweakValues;
  onChange: (value: VisualTweakValues) => void;
}

export function VisualTweakPanel({ value, onChange }: VisualTweakPanelProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Belt-and-suspenders with BootRoot's compile-time gate: direct consumers
  // cannot accidentally render this surface in a packaged renderer.
  if (!import.meta.env.DEV) return null;

  const palette = value.canvasPalette;
  const grid = value.worldGrid;
  const overlap = value.overlapFeedback;

  const setPalette = (key: keyof typeof palette, next: string): void => {
    onChange({ ...value, canvasPalette: { ...palette, [key]: next } });
  };
  const setOverlap = <K extends keyof typeof overlap>(key: K, next: (typeof overlap)[K]): void => {
    onChange({ ...value, overlapFeedback: { ...overlap, [key]: next } });
  };
  const setGrid = <K extends keyof typeof grid>(key: K, next: (typeof grid)[K]): void => {
    onChange({ ...value, worldGrid: { ...grid, [key]: next } });
  };
  const setPair = (
    key: "glowAlpha" | "glowSize" | "rimAlpha",
    index: 0 | 1,
    next: number,
  ): void => {
    const pair: [number, number] = [...overlap[key]];
    pair[index] = next;
    setOverlap(key, pair);
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (file === undefined) return;
    try {
      onChange(deserializeVisualTweaks(await file.text()));
      setStatus(`Imported ${file.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      input.value = "";
    }
  };

  const exportFile = (): void => {
    const url = URL.createObjectURL(
      new Blob([serializeVisualTweaks(value)], { type: "application/json;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = VISUAL_TWEAK_FILE_NAME;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${VISUAL_TWEAK_FILE_NAME}`);
  };

  return (
    <FloatingTweakPanel title="Visual tweaks" open={open} onOpenChange={setOpen}>
      <div className="space-y-3 text-[11px]">
        <TweakSection title="Canvas palette">
          <ColorField
            label="Background · light"
            value={palette.bgLight}
            onChange={(v) => setPalette("bgLight", v)}
          />
          <ColorField
            label="Background · dark"
            value={palette.bgDark}
            onChange={(v) => setPalette("bgDark", v)}
          />
          <ColorField
            label="Dots · light"
            value={palette.dotLight}
            onChange={(v) => setPalette("dotLight", v)}
          />
          <ColorField
            label="Dots · dark"
            value={palette.dotDark}
            onChange={(v) => setPalette("dotDark", v)}
          />
        </TweakSection>

        <TweakSection title="World grid">
          <TripleField
            label="Spacing"
            labels={["Fine", "Medium", "Coarse"]}
            value={grid.spacings}
            min={1}
            max={100_000}
            step={1}
            onChange={(index, next) => {
              const spacings: [number, number, number] = [...grid.spacings];
              spacings[index] = next;
              setGrid("spacings", spacings);
            }}
          />
          <PairField
            label="Dot radius"
            firstLabel="Min"
            secondLabel="Max"
            value={grid.dotRadius}
            min={0}
            max={50}
            step={0.05}
            onChange={(index, next) => {
              const dotRadius: [number, number] = [...grid.dotRadius];
              dotRadius[index] = next;
              setGrid("dotRadius", dotRadius);
            }}
          />
          <SingleField
            label="Dot opacity"
            inputLabel="Opacity"
            value={grid.dotAlpha}
            min={0}
            max={1}
            step={0.01}
            onChange={(next) => setGrid("dotAlpha", next)}
          />
          <PairField
            label="Fade in"
            firstLabel="Start"
            secondLabel="End"
            value={grid.fadeIn}
            min={0}
            max={100_000}
            step={1}
            onChange={(index, next) => {
              const fadeIn: [number, number] = [...grid.fadeIn];
              fadeIn[index] = next;
              setGrid("fadeIn", fadeIn);
            }}
          />
          <PairField
            label="Fade out"
            firstLabel="Start"
            secondLabel="End"
            value={grid.fadeOut}
            min={0}
            max={100_000}
            step={10}
            onChange={(index, next) => {
              const fadeOut: [number, number] = [...grid.fadeOut];
              fadeOut[index] = next;
              setGrid("fadeOut", fadeOut);
            }}
          />
          <PairField
            label="Level weight"
            firstLabel="Base"
            secondLabel="Step"
            value={grid.levelWeight}
            min={-10}
            max={10}
            step={0.1}
            onChange={(index, next) => {
              const levelWeight: [number, number] = [...grid.levelWeight];
              levelWeight[index] = next;
              setGrid("levelWeight", levelWeight);
            }}
          />
        </TweakSection>

        <TweakSection title="Overlap feedback">
          <ColorField
            label="Glow · light"
            value={overlap.colors.glowLight}
            onChange={(glowLight) => setOverlap("colors", { ...overlap.colors, glowLight })}
          />
          <ColorField
            label="Glow · dark"
            value={overlap.colors.glowDark}
            onChange={(glowDark) => setOverlap("colors", { ...overlap.colors, glowDark })}
          />
          <ColorField
            label="Rim · light"
            value={overlap.colors.rimLight}
            onChange={(rimLight) => setOverlap("colors", { ...overlap.colors, rimLight })}
          />
          <ColorField
            label="Rim · dark"
            value={overlap.colors.rimDark}
            onChange={(rimDark) => setOverlap("colors", { ...overlap.colors, rimDark })}
          />
          <PairField
            label="Glow opacity"
            value={overlap.glowAlpha}
            min={0}
            max={1}
            step={0.02}
            onChange={(index, next) => setPair("glowAlpha", index, next)}
          />
          <PairField
            label="Glow size"
            value={overlap.glowSize}
            min={0}
            max={200}
            step={2}
            onChange={(index, next) => setPair("glowSize", index, next)}
          />
          <PairField
            label="Rim opacity"
            value={overlap.rimAlpha}
            min={0}
            max={1}
            step={0.02}
            onChange={(index, next) => setPair("rimAlpha", index, next)}
          />
          <div className="grid grid-cols-[1fr_4.5rem_4.5rem] items-end gap-1.5 pt-1">
            <span className="pb-1 text-black/55 dark:text-white/55">Rim shape</span>
            <NumberField
              label="Width"
              value={overlap.rimWidth}
              min={0}
              max={6}
              step={0.1}
              onChange={(next) => setOverlap("rimWidth", next)}
            />
            <NumberField
              label="Radius"
              value={overlap.rimRadius}
              min={0}
              max={2_000}
              step={20}
              onChange={(next) => setOverlap("rimRadius", next)}
            />
          </div>
        </TweakSection>

        <div className="flex flex-wrap gap-1.5 border-t border-black/10 pt-3 dark:border-white/10">
          <TweakButton onClick={() => onChange(defaultVisualTweakValues())}>Reset</TweakButton>
          <TweakButton onClick={() => fileInputRef.current?.click()}>Import JSON…</TweakButton>
          <TweakButton onClick={exportFile}>Export JSON</TweakButton>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="Import visual tweaks"
            onChange={(event) => void importFile(event)}
          />
        </div>
        {status !== null && (
          <div className="break-words text-[10px] text-black/45 dark:text-white/45">{status}</div>
        )}
      </div>
    </FloatingTweakPanel>
  );
}

function TweakSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <section className="rounded-xl border border-black/10 bg-white/35 p-2 dark:border-white/10 dark:bg-white/[0.035]">
      <h2 className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.09em] text-black/40 dark:text-white/40">
        {title}
      </h2>
      <div className="divide-y divide-black/[0.06] dark:divide-white/[0.07]">{children}</div>
    </section>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <label className="flex h-8 items-center justify-between gap-2">
      <span className="text-black/55 dark:text-white/55">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-[9px] uppercase text-black/35 dark:text-white/35">
          {value}
        </span>
        <input
          type="color"
          aria-label={label}
          value={value}
          className="h-5 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
          onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
      </span>
    </label>
  );
}

function PairField({
  label,
  firstLabel = "Candidate",
  secondLabel = "Target",
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  firstLabel?: string;
  secondLabel?: string;
  value: [number, number];
  min: number;
  max: number;
  step: number;
  onChange: (index: 0 | 1, value: number) => void;
}): ReactElement {
  return (
    <div className="grid grid-cols-[1fr_4.5rem_4.5rem] items-end gap-1.5 py-1.5">
      <span className="pb-1 text-black/55 dark:text-white/55">{label}</span>
      <NumberField
        label={firstLabel}
        value={value[0]}
        min={min}
        max={max}
        step={step}
        onChange={(next) => onChange(0, next)}
      />
      <NumberField
        label={secondLabel}
        value={value[1]}
        min={min}
        max={max}
        step={step}
        onChange={(next) => onChange(1, next)}
      />
    </div>
  );
}

function TripleField({
  label,
  labels,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  labels: [string, string, string];
  value: [number, number, number];
  min: number;
  max: number;
  step: number;
  onChange: (index: 0 | 1 | 2, value: number) => void;
}): ReactElement {
  return (
    <div className="grid grid-cols-[1fr_4rem_4rem_4rem] items-end gap-1.5 py-1.5">
      <span className="pb-1 text-black/55 dark:text-white/55">{label}</span>
      {labels.map((inputLabel, index) => (
        <NumberField
          key={inputLabel}
          label={inputLabel}
          value={value[index] ?? 0}
          min={min}
          max={max}
          step={step}
          onChange={(next) => onChange(index as 0 | 1 | 2, next)}
        />
      ))}
    </div>
  );
}

function SingleField({
  label,
  inputLabel,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  inputLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}): ReactElement {
  return (
    <div className="grid grid-cols-[1fr_4.5rem] items-end gap-1.5 py-1.5">
      <span className="pb-1 text-black/55 dark:text-white/55">{label}</span>
      <NumberField
        label={inputLabel}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={onChange}
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}): ReactElement {
  return (
    <label className="min-w-0">
      <span className="block truncate text-[8px] uppercase tracking-wide text-black/30 dark:text-white/30">
        {label}
      </span>
      <input
        type="number"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        className="mt-0.5 h-6 w-full rounded-md border border-black/10 bg-white/65 px-1.5 font-mono text-[10px] outline-none focus:border-black/30 dark:border-white/10 dark:bg-black/25 dark:focus:border-white/30"
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function TweakButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      className="h-7 rounded-lg border border-black/10 bg-white/50 px-2 text-[10px] font-medium text-black/60 transition hover:bg-white hover:text-black dark:border-white/10 dark:bg-white/[0.06] dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
