import { type ChangeEvent, type ReactElement, useRef, useState } from "react";
import {
  deserializeVisualTweaks,
  serializeVisualTweaks,
  VISUAL_TWEAK_FILE_NAME,
} from "./visual-tweak-document";
import { defaultVisualTweakValues, type VisualTweakValues } from "./visual-tweaks";

export interface VisualTweakControlsProps {
  value: VisualTweakValues;
  onChange: (value: VisualTweakValues) => void;
}

/** The complete former in-app tweak surface, now owned by the UI Bench. */
export function VisualTweakControls({ value, onChange }: VisualTweakControlsProps): ReactElement {
  const [status, setStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    <div className="vf-ds-tweak-controls" data-visual-tweak-controls>
      <header className="vf-ds-tweak-controls__header">
        <div>
          <span>Design bench</span>
          <h3>Visual tweaks</h3>
        </div>
        <p>Changes are scoped to this specimen. Export a reviewed preset before editing source.</p>
      </header>
      <div className="vf-ds-tweak-controls__body">
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
          <div className="vf-ds-tweak-row vf-ds-tweak-row--pair">
            <span>Rim shape</span>
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

        <div className="vf-ds-tweak-actions">
          <TweakButton
            onClick={() => {
              onChange(defaultVisualTweakValues());
              setStatus("Restored production defaults");
            }}
          >
            Reset
          </TweakButton>
          <TweakButton onClick={() => fileInputRef.current?.click()}>Import JSON…</TweakButton>
          <TweakButton onClick={exportFile}>Export JSON</TweakButton>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="vf-ds-tweak-file"
            aria-label="Import visual tweaks"
            onChange={(event) => void importFile(event)}
          />
        </div>
        {status !== null && (
          <div className="vf-ds-tweak-status" role="status">
            {status}
          </div>
        )}
      </div>
    </div>
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
    <section className="vf-ds-tweak-group">
      <h4>{title}</h4>
      <div>{children}</div>
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
    <label className="vf-ds-tweak-color">
      <span>{label}</span>
      <span>
        <output>{value}</output>
        <input
          type="color"
          aria-label={label}
          value={value}
          className="vf-ds-tweak-color__input"
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
    <div className="vf-ds-tweak-row vf-ds-tweak-row--pair">
      <span>{label}</span>
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
    <div className="vf-ds-tweak-row vf-ds-tweak-row--triple">
      <span>{label}</span>
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
    <div className="vf-ds-tweak-row vf-ds-tweak-row--single">
      <span>{label}</span>
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
    <label className="vf-ds-tweak-number">
      <span>{label}</span>
      <input
        type="number"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        className="vf-ds-tweak-number__input"
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
    <button type="button" className="vf-ds-tweak-button" onClick={onClick}>
      {children}
    </button>
  );
}
