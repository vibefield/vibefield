import { SegmentedControl as UiSegmentedControl } from "@vibefield/design-kit";
import { UserFaceView } from "@vibefield/design-kit/face";
import { type ReactElement, type ReactNode, useState } from "react";
import { FacePicker } from "../../account/FacePicker";
import { faceKey } from "../../account/faces";
import { primaryCls, quietCls } from "../../boot/onboarding/wizard-ui";
import { roundButtonCls } from "../../field/theme-constants";
import type { FieldUserFace } from "../../host";
import {
  buttonCls,
  fieldCls,
  labelCls,
  SettingsPill,
  SettingsSwitch,
} from "../../panels/settings-ui";
import { FIXTURE_ME, FIXTURE_OTHERS } from "../account-fixtures";
import { Icon, Section, Specimen } from "../catalog-ui";

/** Faces the fixture's other users wear — greyed and named in the picker. */
const HELD_FIXTURE: ReadonlyMap<string, string> = new Map(
  FIXTURE_OTHERS.map((person) => [faceKey(person.face.emoji), person.name]),
);

export function ControlsSection(): ReactElement {
  const [enabled, setEnabled] = useState(true);
  const [segment, setSegment] = useState("Select");
  const [face, setFace] = useState<FieldUserFace>(FIXTURE_ME.face);
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

      <Specimen title="Pills & links" source="settings-ui.tsx">
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
        </div>
      </Specimen>

      <Specimen title="Face picker" source="account/FacePicker.tsx · DESIGN.md §2.8">
        {/* The picker draws no face of its own — its hosts already show the
            face it edits — so the specimen stages one beside it, as they do. */}
        <div className="vf-ds-face-picker-demo">
          <UserFaceView
            emoji={face.emoji}
            frame={face.frame}
            size={56}
            seed={FIXTURE_ME.userId}
            label={`${FIXTURE_ME.name}, ${face.emoji}`}
          />
          <FacePicker value={face} held={HELD_FIXTURE} onChange={setFace} name="vf-design-face" />
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
