import { SegmentedControl } from "@vibefield/design-kit";
import { type ChangeEvent, type ReactElement, useRef, useState } from "react";
import {
  defaultProductAppearance,
  type ProductAppearance,
} from "../../appearance/product-appearance";
import {
  deserializeVisualTweaks,
  serializeVisualTweaks,
  VISUAL_TWEAK_FILE_NAME,
} from "../../appearance/product-appearance-document";

export interface VisualTweakControlsProps {
  value: ProductAppearance;
  onChange: (value: ProductAppearance) => void;
}

/** Complete browser-compatible controls owned by the Design System workbench. */
export function VisualTweakControls({ value, onChange }: VisualTweakControlsProps): ReactElement {
  const [status, setStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const palette = value.canvasPalette;
  const grid = value.worldGrid;
  const magnet = value.magnetGrid;
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
  const setMagnet = <K extends keyof typeof magnet>(key: K, next: (typeof magnet)[K]): void => {
    onChange({ ...value, magnetGrid: { ...magnet, [key]: next } });
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
          <span>Appearance</span>
          <h3>Visual tuning</h3>
        </div>
        <p>Changes update the specimen immediately. Studio Live mode can mirror them to the app.</p>
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
            label="Classic dots · dark (alternate)"
            value={palette.dotDark}
            onChange={(v) => setPalette("dotDark", v)}
          />
          <ColorField
            label="Magnet glyph ink · dark (selected)"
            value={palette.magnetDotDark}
            onChange={(v) => setPalette("magnetDotDark", v)}
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

        <TweakSection title="Magnet grid">
          <ChoiceField label="Glyph">
            <SegmentedControl
              options={["Dot", "Needle"]}
              value={magnet.glyph === "dot" ? "Dot" : "Needle"}
              onChange={(next) => setMagnet("glyph", next === "Dot" ? "dot" : "needle")}
              label="Magnet grid glyph"
            />
          </ChoiceField>
          <SingleField
            label="Field reach"
            inputLabel="Reach"
            value={magnet.reach}
            min={0}
            max={1_000}
            step={5}
            onChange={(next) => setMagnet("reach", next)}
          />
          <ChoiceField label="Polarity">
            <SegmentedControl
              options={["Attract", "Repel"]}
              value={magnet.polarity === 1 ? "Attract" : "Repel"}
              onChange={(next) => setMagnet("polarity", next === "Attract" ? 1 : -1)}
              label="Magnet grid polarity"
            />
          </ChoiceField>
          <ChoiceField label="Widget silhouettes">
            <SegmentedControl
              options={["On", "Off"]}
              value={magnet.widgets ? "On" : "Off"}
              onChange={(next) => setMagnet("widgets", next === "On")}
              label="Widget silhouette sources"
            />
          </ChoiceField>
          <SingleField
            label="Widget strength"
            inputLabel="Strength"
            value={magnet.widgetStrength}
            min={0}
            max={100}
            step={0.05}
            onChange={(next) => setMagnet("widgetStrength", next)}
          />
          <SingleField
            label="Widget corner radius"
            inputLabel="Radius"
            value={magnet.widgetRadius}
            min={0}
            max={1_000}
            step={1}
            onChange={(next) => setMagnet("widgetRadius", next)}
          />
          <ChoiceField label="Needle alignment">
            <SegmentedControl
              options={["Responsive", "Always"]}
              value={magnet.alwaysAlign ? "Always" : "Responsive"}
              onChange={(next) => setMagnet("alwaysAlign", next === "Always")}
              label="Needle alignment"
            />
          </ChoiceField>
          <SingleField
            label="Needle half-length / dot swell"
            inputLabel="Half-length"
            value={magnet.needleLength}
            min={0}
            max={100}
            step={0.05}
            onChange={(next) => setMagnet("needleLength", next)}
          />
          <SingleField
            label="Needle half-width"
            inputLabel="Half-width"
            value={magnet.needleWidth}
            min={0}
            max={50}
            step={0.05}
            onChange={(next) => setMagnet("needleWidth", next)}
          />
          <SingleField
            label="Source buffer cap"
            inputLabel="Max sources"
            value={magnet.maxSources}
            min={0}
            max={256}
            step={1}
            onChange={(next) => setMagnet("maxSources", Math.round(next))}
          />
          <SingleField
            label="Field fade below zoom"
            inputLabel="Fade zoom"
            value={magnet.fadeZoom}
            min={0}
            max={1_000}
            step={0.05}
            onChange={(next) => setMagnet("fadeZoom", next)}
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
              onChange(defaultProductAppearance());
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

function ChoiceField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div className="vf-ds-tweak-choice">
      <span>{label}</span>
      {children}
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
        onChange={(event) => {
          const next = Number(event.target.value);
          if (!Number.isFinite(next)) return;
          onChange(Math.min(Math.max(next, min), max));
        }}
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
