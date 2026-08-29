import type { ReactElement } from "react";
import { BrandMark, Section } from "../catalog-ui";

const INVENTORY = [
  {
    group: "Foundations",
    items: [
      "Chrome material",
      "Surface colors",
      "State colors",
      "Organizational accents",
      "Text opacity ramp",
      "Monospace data",
      "Radii",
      "Ambient shadows",
      "Motion curves",
    ],
  },
  {
    group: "Canvas ground",
    items: [
      "Adaptive three-level dot grid",
      "WebGPU / WebGL2 ground layer",
      "Pan and zoom response",
      "Light and dark canvas palette",
      "Grid spacing and fades",
      "Dot radius and opacity",
      "Overlap feedback projection",
      "Visual preset import / export",
    ],
  },
  {
    group: "Controls",
    items: [
      "Primary action",
      "Quiet action",
      "Settings chip",
      "Destructive action",
      "Round icon button",
      "Text input",
      "Number input",
      "Select",
      "Textarea",
      "Range",
      "Checkbox",
      "Switch",
      "Segmented control",
      "Category pill",
      "Accent picker",
      "Inline link",
    ],
  },
  {
    group: "Field chrome",
    items: [
      "Navigation breadcrumbs",
      "Zoom pill",
      "Theme toggle",
      "Artifact toggle",
      "File pill",
      "Document explorer",
      "Document tile",
      "Sync indicator",
      "Morphing widget tray",
      "Tool switcher",
      "Widget tile",
      "Put-back affordance",
    ],
  },
  {
    group: "Cards & state",
    items: [
      "Default card",
      "Content gradient",
      "Sticky note",
      "Terminal card",
      "Sole-selection ring",
      "Drag lift",
      "Accept overlap",
      "Reject overlap",
      "Status dot",
      "Status badge",
      "Source badge",
      "Change badge",
      "Progress bar",
      "Empty state",
      "Unavailable state",
      "Inline error",
    ],
  },
  {
    group: "Surfaces",
    items: [
      "Settings dialog",
      "Settings sidebar",
      "Settings section",
      "Settings row",
      "Side panel",
      "Command palette",
      "Loading veil",
      "Boot splash",
      "Setup Assistant",
      "Confirmation step",
      "Visual tweak workbench",
      "Frame stats overlay",
    ],
  },
  {
    group: "Control room",
    items: [
      "Instrument header",
      "Source counts",
      "View selector",
      "Theme switch",
      "Agent circle anatomy",
      "Agent circle state matrix",
      "Agent status mapping",
      "Terminal deck",
      "Pane badge",
      "Kill confirmation",
      "Tuning panel",
      "Scanlines",
      "Vignette",
    ],
  },
] as const;

export function InventorySection(): ReactElement {
  return (
    <Section
      id="inventory"
      index="12"
      eyebrow="Coverage index"
      title="The interface, accounted for"
      description="A compact audit list for the current renderer. It makes omissions visible while the rendered specimens keep the visual decisions comparable."
    >
      <div className="vf-ds-inventory-grid">
        {INVENTORY.map((group) => (
          <article key={group.group} className="vf-ds-inventory-card">
            <header>
              <span>{group.group}</span>
              <small>{group.items.length}</small>
            </header>
            <ul>
              {group.items.map((item) => (
                <li key={item}>
                  <span aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <div className="vf-ds-footer-note">
        <BrandMark />
        <div>
          <strong>Keep the page current.</strong>
          <span>
            When a visual pattern enters the renderer, add its normal, interactive, disabled, and
            failure states here in the same change.
          </span>
        </div>
      </div>
    </Section>
  );
}
