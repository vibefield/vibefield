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

  const setPalette = (key: keyof typeof palette, next: string): void => {
    onChange({ ...value, canvasPalette: { ...palette, [key]: next } });
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
