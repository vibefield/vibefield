import { SegmentedControl as UiSegmentedControl } from "@vibefield/design-kit";
import { type ReactElement, type ReactNode, useState } from "react";
import { AccentChip, AccentPicker, type AccentSlot } from "../../account/AccentPicker";
import { primaryCls, quietCls } from "../../boot/onboarding/wizard-ui";
import { roundButtonCls } from "../../field/theme-constants";
import {
  buttonCls,
  fieldCls,
  labelCls,
  SettingsPill,
  SettingsSwitch,
} from "../../panels/settings-ui";
import { Icon, Section, Specimen } from "../catalog-ui";

export function ControlsSection(): ReactElement {
  const [enabled, setEnabled] = useState(true);
  const [segment, setSegment] = useState("Select");
  const [accent, setAccent] = useState<AccentSlot>("accent-1");
  const [range, setRange] = useState(42);

  return (
    <Section
      id="controls"
      index="04"
      eyebrow="Controls"
      title="Actions with a consistent pulse"
      description="Round where an action is compact, softly inset where it belongs to settings, and solid only when hierarchy or selection earns it."
    >
      <div className="vf-ds-grid vf-ds-grid-2">
        <Specimen title="Buttons" source="wizard-ui.tsx · settings-ui.tsx">
          <div className="vf-ds-control-stack">
            <ControlRow label="Primary">
              <button type="button" className={primaryCls}>
                Continue
              </button>
              <button type="button" className={primaryCls} disabled>
                Continue
              </button>
            </ControlRow>
            <ControlRow label="Quiet">
              <button type="button" className={quietCls}>
                Back
              </button>
              <button type="button" className={quietCls} disabled>
                Back
              </button>
            </ControlRow>
            <ControlRow label="Settings">
              <button type="button" className={buttonCls}>
                Zoom to fit
              </button>
              <button type="button" className={`${buttonCls} text-[var(--vf-red)]`}>
                Uninstall
              </button>
            </ControlRow>
          </div>
        </Specimen>

        <Specimen title="Floating controls" source="field/theme-constants.ts">
          <div className="vf-ds-floating-controls">
            <button type="button" className={roundButtonCls(false)} aria-label="Back">
              <Icon name="arrow-left" />
            </button>
            <button type="button" className={roundButtonCls(false)} aria-label="Settings">
              <Icon name="settings" />
            </button>
            <button
              type="button"
              className={roundButtonCls(true)}
              aria-label="Artifacts open"
              aria-pressed="true"
            >
              <Icon name="layers" />
            </button>
            <button type="button" className={roundButtonCls(false)} disabled aria-label="Disabled">
              <Icon name="plus" />
            </button>
          </div>
          <p className="vf-ds-specimen-note">
            40px · solid surface · persistent active is inverted
          </p>
        </Specimen>
      </div>

      <div className="vf-ds-grid vf-ds-grid-2">
        <Specimen title="Fields" source="panels/settings-ui.tsx">
          <div className="vf-ds-fields-grid">
            <label>
              <span className={labelCls}>Text input</span>
              <input className={fieldCls} defaultValue="James’s field" />
            </label>
            <label>
              <span className={labelCls}>Select</span>
              <select className={fieldCls} defaultValue="automatic">
                <option value="automatic">Automatic</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label>
              <span className={labelCls}>Number</span>
              <input className={`${fieldCls} tabular-nums`} type="number" defaultValue="64" />
            </label>
            <label>
              <span className={labelCls}>Disabled</span>
              <input className={fieldCls} value="Unavailable" disabled readOnly />
            </label>
            <label className="vf-ds-field-wide">
              <span className={labelCls}>Textarea</span>
              <textarea
                className={`${fieldCls} h-20 resize-none py-2`}
                defaultValue="Keep a durable note beside the work."
              />
            </label>
          </div>
        </Specimen>

        <Specimen title="Selection controls" source="settings-ui.tsx · WidgetTray.tsx">
          <div className="vf-ds-selection-stack">
            <div className="vf-ds-demo-setting">
              <div>
                <strong>Snap cards</strong>
                <span>Settle nearby edges into place.</span>
              </div>
              <SettingsSwitch checked={enabled} onChange={setEnabled} label="Snap cards" />
            </div>
            <UiSegmentedControl
              options={["Select", "Pan", "Wire"]}
              value={segment}
              onChange={setSegment}
              label="Canvas tool"
            />
            <label className="vf-ds-range-row">
              <span className={labelCls}>Range</span>
              <input
                type="range"
                min="0"
                max="100"
                value={range}
                onChange={(event) => setRange(Number(event.target.value))}
              />
              <output>{range}%</output>
            </label>
            <label className="vf-ds-check-row">
              <input type="checkbox" defaultChecked />
              <span>Show agent labels</span>
            </label>
          </div>
        </Specimen>
      </div>

      <Specimen title="Pills, accents & links" source="AccentPicker.tsx · settings-ui.tsx">
        <div className="vf-ds-pill-layout">
          <div className="vf-ds-pill-group">
            <SettingsPill>Loro-backed</SettingsPill>
            <span className="vf-ds-category-pill is-active">All</span>
            <span className="vf-ds-category-pill">Productivity</span>
            <span className="vf-ds-source-pill">registry · reviewed</span>
            <a href="#controls" className="vf-ds-inline-link">
              Open logs
            </a>
          </div>
          <div className="vf-ds-accent-control">
            <AccentPicker
              value={accent}
              name="vf-design-accent"
              onSelect={setAccent}
              className="flex flex-wrap gap-2"
            />
            <AccentChip accent={accent} label="James’s field" />
          </div>
        </div>
      </Specimen>
    </Section>
  );
}

function ControlRow({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="vf-ds-control-row">
      <span>{label}</span>
      <div>{children}</div>
    </div>
  );
}
