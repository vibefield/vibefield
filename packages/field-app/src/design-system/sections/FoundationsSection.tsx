import { faceLiftHostClass, UserFaceView } from "@vibefield/design-kit/face";
import type { CSSProperties, ReactElement } from "react";
import { FACE_LADDER, FIXTURE_ME, FIXTURE_OTHERS } from "../account-fixtures";
import { Section, Specimen } from "../catalog-ui";

const SURFACE_COLORS = [
  { label: "Canvas", token: "--vf-canvas-bg", value: "var(--vf-canvas-bg)" },
  { label: "Card", token: "--vf-card", value: "var(--vf-card)" },
  { label: "Deep card", token: "--vf-card-deep", value: "var(--vf-card-deep)" },
  { label: "Inset fill", token: "--vf-fill", value: "var(--vf-fill)" },
] as const;

const STATE_COLORS = [
  { label: "Healthy", token: "--vf-green", value: "var(--vf-green)" },
  { label: "Attention", token: "--vf-orange", value: "var(--vf-orange)" },
  { label: "Destructive", token: "--vf-red", value: "var(--vf-red)" },
  { label: "Content", token: "--vf-yellow", value: "var(--vf-yellow)" },
  { label: "Information", token: "--vf-cyan", value: "var(--vf-cyan)" },
  { label: "Selection", token: "--vf-select", value: "var(--vf-select)" },
] as const;

const ACCENT_COLORS = Array.from({ length: 8 }, (_, index) => ({
  label: `Accent ${index + 1}`,
  token: `--vf-accent-${index + 1}`,
  value: `var(--vf-accent-${index + 1})`,
}));

export function FoundationsSection(): ReactElement {
  return (
    <Section
      id="foundations"
      index="02"
      eyebrow="Foundations"
      title="One quiet foundation"
      description="Neutral chrome gives content and honest state the room to speak. Every sample below switches through the same light and dark tokens as the desktop renderer."
    >
      <div className="vf-ds-grid vf-ds-grid-2">
        <Specimen title="Surface palette" source="design-kit/tokens.css">
          <div className="vf-ds-swatches vf-ds-swatches-4">
            {SURFACE_COLORS.map((color) => (
              <ColorSwatch key={color.token} {...color} />
            ))}
          </div>
        </Specimen>
        <Specimen title="System color" source="DESIGN.md §2.5">
          <div className="vf-ds-swatches vf-ds-swatches-3">
            {STATE_COLORS.map((color) => (
              <ColorSwatch key={color.token} {...color} />
            ))}
          </div>
        </Specimen>
      </div>

      <Specimen title="Organizational accents" source="design-kit/tokens.css · DESIGN.md §2.6">
        <div className="vf-ds-accent-line">
          {ACCENT_COLORS.map((color) => (
            <ColorSwatch key={color.token} {...color} compact />
          ))}
        </div>
      </Specimen>

      <Specimen title="Faces" source="design-kit/face.tsx · DESIGN.md §2.8">
        <div className="vf-ds-face-ladders">
          {(
            [
              { frame: "sticker", label: "Sticker · the default", person: FIXTURE_ME },
              { frame: "coin", label: "Coin · by choice", person: FIXTURE_OTHERS[0] ?? FIXTURE_ME },
            ] as const
          ).map(({ frame, label, person }) => (
            <div key={frame} className="vf-ds-face-ladder">
              <span className="vf-ds-face-ladder-label">{label}</span>
              <div className="vf-ds-face-rungs">
                {FACE_LADDER.map((size) => (
                  <figure key={size} className={`vf-ds-face-rung ${faceLiftHostClass}`}>
                    <UserFaceView
                      emoji={person.face.emoji}
                      frame={frame}
                      size={size}
                      seed={person.userId}
                      legend={frame === "coin" ? `${person.name} · example-org` : undefined}
                      label={`${person.name}, ${person.face.emoji}, ${size}px`}
                    />
                    <figcaption>{size}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Specimen>

      <div className="vf-ds-grid vf-ds-grid-2">
        <Specimen title="Type ramp" source="DESIGN.md §3">
          <div className="vf-ds-type-ramp">
            <div>
              <span>Eyebrow · 10</span>
              <p className="vf-ds-type-eyebrow">Field activity</p>
            </div>
            <div>
              <span>Label · 12</span>
              <p className="vf-ds-type-label">Needs approval · 4m</p>
            </div>
            <div>
              <span>Body · 14</span>
              <p className="vf-ds-type-body">Everything on the field stays within reach.</p>
            </div>
            <div>
              <span>Hero numeral · 34</span>
              <p className="vf-ds-type-data">64°</p>
            </div>
            <div>
              <span>Mono fact · 12</span>
              <p className="vf-ds-type-mono">agent_02 · 00:04:18</p>
            </div>
          </div>
        </Specimen>
        <Specimen title="Geometry & elevation" source="DESIGN.md §4–5">
          <div className="vf-ds-geometry-row">
            <GeometrySample radius="22px" label="Card" />
            <GeometrySample radius="32px" label="Island" />
            <GeometrySample radius="40px" label="Sheet" />
          </div>
          <div className="vf-ds-shadow-row">
            <div className="vf-ds-shadow-card" data-level="resting">
              resting
            </div>
            <div className="vf-ds-shadow-card" data-level="island">
              island
            </div>
            <div className="vf-ds-shadow-card" data-level="lifted">
              lifted
            </div>
          </div>
        </Specimen>
      </div>

      <Specimen title="Motion vocabulary" source="design-kit/tokens.css">
        <div className="vf-ds-motion-grid">
          <MotionSample name="Island" token="--vf-ease-island" duration="600ms" />
          <MotionSample name="Lift" token="--vf-ease-lift" duration="180ms" />
          <MotionSample name="Pop" token="--vf-ease-pop" duration="280ms" />
        </div>
      </Specimen>
    </Section>
  );
}

function ColorSwatch({
  label,
  token,
  value,
  compact = false,
}: {
  label: string;
  token: string;
  value: string;
  compact?: boolean;
}): ReactElement {
  return (
    <div className={`vf-ds-swatch ${compact ? "is-compact" : ""}`}>
      <span style={{ background: value }} />
      <div>
        <strong>{label}</strong>
        <code>{token}</code>
      </div>
    </div>
  );
}

function GeometrySample({ radius, label }: { radius: string; label: string }): ReactElement {
  return (
    <div>
      <span style={{ borderRadius: radius }} />
      <strong>{radius}</strong>
      <small>{label}</small>
    </div>
  );
}

function MotionSample({
  name,
  token,
  duration,
}: {
  name: string;
  token: string;
  duration: string;
}): ReactElement {
  return (
    <div
      className="vf-ds-motion-sample"
      style={{ "--motion-ease": `var(${token})` } as CSSProperties}
    >
      <div>
        <span />
      </div>
      <strong>{name}</strong>
      <code>
        {duration} · {token}
      </code>
    </div>
  );
}
