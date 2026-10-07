import { EmptyState, StatusDot, UnavailableState } from "@vibefield/design-kit";
import type { ReactElement, ReactNode } from "react";
import { DeskUnavailableView } from "../../field/desk/DeskUnavailableView";
import { BEFORE_THE_DESK, failedWords } from "../../field/desk/desk-words";
import { StatusLineView } from "../../frame/StatusLine";
import { Icon, Section, Specimen } from "../catalog-ui";

// ICE's own words, as its desk layer composes them (`${what}: ${error.message}`) — fixtures for the
// shipping card, which reads them verbatim (DESIGN.md §8 "When the desk can't draw", R18).
const DESK_LOST = "the device was lost: unknown: GPU process exited";
const DESK_NO_GPU =
  "no desk — the adapter, the device or the pipelines were refused: WebGPU is unavailable here (no navigator.gpu)";
const DESK_NO_ADAPTER =
  "no desk — the adapter, the device or the pipelines were refused: WebGPU: requestAdapter() returned null";
const DESK_REFUSED =
  "no desk — the adapter, the device or the pipelines were refused: GPUPipelineError: invalid shader module";
const DESK_DEGRADED = "an uncaptured GPU error — GPUOutOfMemoryError: out of memory";
const reloadFixture = (): void => undefined;

export function StatusSection(): ReactElement {
  return (
    <Section
      id="status"
      index="05"
      eyebrow="Status & feedback"
      title="Color always answers why"
      description="Green means healthy work, orange asks for attention, red marks failure or destruction, and muted facts stay deliberately colorless."
    >
      <div className="vf-ds-grid vf-ds-grid-2">
        <Specimen title="Agent states" source="DESIGN.md §2.5">
          <div className="vf-ds-status-list">
            <StatusLine state="working" detail="editing renderer · 18s" tone="green" />
            <StatusLine state="needs approval" detail="shell command · 4m" tone="orange" />
            <StatusLine state="waiting" detail="on teammate" tone="muted" />
            <StatusLine state="done" detail="finished 12:42:08" tone="green" glyph="✓" />
            <StatusLine state="failed" detail="process exited 1" tone="red" />
            <StatusLine state="unknown" detail="last seen 9m ago" tone="muted" italic />
          </div>
        </Specimen>
        <Specimen title="Badges & provenance" source="settings and plugin surfaces">
          <div className="vf-ds-badge-cloud">
            <StatusBadge tone="green">working</StatusBadge>
            <StatusBadge tone="orange">needs approval · 4m</StatusBadge>
            <StatusBadge tone="red">failed</StatusBadge>
            <StatusBadge tone="muted">peer offline</StatusBadge>
            <span className="vf-ds-change-badge is-positive">+4.8%</span>
            <span className="vf-ds-change-badge is-negative">−1.2%</span>
            <span className="vf-ds-source-pill">built-in</span>
            <span className="vf-ds-source-pill">dev</span>
            <span className="vf-ds-source-pill">sideload</span>
          </div>
        </Specimen>
      </div>
      <div className="vf-ds-grid vf-ds-grid-3">
        <Specimen title="Progress" source="LoadingVeil.tsx">
          <div className="vf-ds-progress-face">
            <div className="vf-ds-progress-track">
              <span style={{ width: "62%" }} />
            </div>
            <p>drawing the board · 62%</p>
          </div>
        </Specimen>
        <Specimen title="Empty" source="DESIGN.md §8">
          <EmptyState
            visual={<Icon name="plus" />}
            title="No documents yet"
            description="Create a field to begin."
          />
        </Specimen>
        <Specimen title="Unavailable" source="field/desk/DeskUnavailableView.tsx">
          <UnavailableState
            title="Plugin unavailable"
            description="The card is kept. Enable Notes to restore it."
          />
        </Specimen>
      </div>
      {/* When the desk can't draw (DESIGN.md §8, R18; DK-3): the shipping card in the Canvas stage on
          its plain ground — a Reload where one could help, ICE's message verbatim — and the status
          line's banner for a degraded desk that still draws. */}
      <div className="vf-ds-grid vf-ds-grid-2">
        <Specimen title="The desk lost its device" source="field/desk/DeskUnavailableView.tsx">
          <div className="vf-ds-desk-stage">
            <DeskUnavailableView words={failedWords(DESK_LOST)} onReload={reloadFixture} />
          </div>
        </Specimen>
        <Specimen title="No WebGPU here — no Reload" source="field/desk/DeskUnavailableView.tsx">
          <div className="vf-ds-desk-stage">
            <DeskUnavailableView words={failedWords(DESK_NO_GPU)} onReload={reloadFixture} />
          </div>
        </Specimen>
        <Specimen
          title="No adapter — hardware acceleration may be off; no Reload"
          source="field/desk/DeskUnavailableView.tsx"
        >
          <div className="vf-ds-desk-stage">
            <DeskUnavailableView words={failedWords(DESK_NO_ADAPTER)} onReload={reloadFixture} />
          </div>
        </Specimen>
        <Specimen
          title="Any other refusal — the desk couldn't start its graphics"
          source="field/desk/DeskUnavailableView.tsx"
        >
          <div className="vf-ds-desk-stage">
            <DeskUnavailableView words={failedWords(DESK_REFUSED)} onReload={reloadFixture} />
          </div>
        </Specimen>
        <Specimen title="A board from before the desk" source="field/desk/desk-words.ts">
          <div className="vf-ds-desk-stage">
            <DeskUnavailableView words={BEFORE_THE_DESK} />
          </div>
        </Specimen>
        <Specimen
          title="The status line — a missing face's word, said once"
          source="frame/StatusLine.tsx"
        >
          <div className="vf-ds-status-line-stage">
            <StatusLineView notice={{ id: "missing", text: "Clock · plugin off" }} />
          </div>
        </Specimen>
        <Specimen
          title="The status line — under the tools in hand while an object is held"
          source="frame/StatusLine.tsx"
        >
          <div className="vf-ds-status-line-stage vf-ds-status-line-stage--held">
            <StatusLineView notice={{ id: "remount", text: "Dial · remount to draw it" }} held />
          </div>
        </Specimen>
        <Specimen title="The status line — a degraded desk" source="frame/StatusLine.tsx">
          <div className="vf-ds-status-line-stage">
            <StatusLineView
              notice={{
                id: "desk-degraded",
                text: DESK_DEGRADED,
                act: { label: "Reload", run: reloadFixture },
              }}
            />
          </div>
        </Specimen>
      </div>
      <div className="vf-ds-feedback-strip">
        <div>
          <StatusDot tone="healthy" />
          <strong>Saved</strong>
          <small>Last exchange 12:42:08</small>
        </div>
        <div>
          <StatusDot tone="attention" />
          <strong>Waiting on 3</strong>
          <small>A peer is offline</small>
        </div>
        <div>
          <StatusDot tone="error" />
          <strong>Export failed</strong>
          <small>Choose a writable folder and retry.</small>
        </div>
      </div>
    </Section>
  );
}

function StatusLine({
  state,
  detail,
  tone,
  glyph,
  italic = false,
}: {
  state: string;
  detail: string;
  tone: "green" | "orange" | "red" | "muted";
  glyph?: string;
  italic?: boolean;
}): ReactElement {
  const primitiveTone =
    tone === "green"
      ? "healthy"
      : tone === "orange"
        ? "attention"
        : tone === "red"
          ? "error"
          : "muted";
  return (
    <div>
      {glyph === undefined ? (
        <StatusDot tone={primitiveTone} />
      ) : (
        <span className="vf-ds-status-glyph">{glyph}</span>
      )}
      <strong className={italic ? "italic" : ""}>{state}</strong>
      <small>{detail}</small>
    </div>
  );
}

function StatusBadge({ children, tone }: { children: ReactNode; tone: string }): ReactElement {
  return <span className={`vf-ds-status-badge is-${tone}`}>{children}</span>;
}
