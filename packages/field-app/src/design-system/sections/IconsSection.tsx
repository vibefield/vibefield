import {
  FIELD_ICON_NAMES,
  FIELD_MARKS,
  FieldIcon,
  type FieldIconFamily,
  type FieldIconFinish,
  type FieldIconName,
  fieldIconSvg,
} from "@vibefield/design-kit/icons";
import { UiIconButton } from "@vibefield/design-kit/primitives";
import { type CSSProperties, type ReactElement, useMemo, useState } from "react";

const FAMILIES: readonly FieldIconFamily[] = [
  "Brand",
  "Identity",
  "Agents",
  "Workspace",
  "Controls",
  "States",
];
const TITLES: Record<FieldIconFamily, string> = {
  Brand: "Field lore",
  Identity: "Alter egos",
  Agents: "Night crew",
  Workspace: "Desk objects",
  Controls: "Action stamps",
  States: "Field signals",
};
const CREW: readonly [FieldIconName, string, string][] = [
  ["agent-scout", "Research / reconnaissance", "DEEP DIVER"],
  ["agent-maker", "Build / make / repair", "HOT HANDS"],
  ["agent-weaver", "Connect / assemble", "PATCH WORKER"],
  ["agent-keeper", "Save / remember", "MEMORY KEEPER"],
];
const COLLAGE: readonly [FieldIconName, string][] = [
  ["brand-field", "field"],
  ["identity-orbit", "orbit"],
  ["agent-maker", "hand"],
  ["identity-canopy", "cap"],
  ["agent-keeper", "disk"],
  ["identity-knot", "brain"],
  ["brand-mesh", "phone"],
];
function download(name: FieldIconName, finish: FieldIconFinish): void {
  const url = URL.createObjectURL(
    new Blob([fieldIconSvg(name, finish)], { type: "image/svg+xml" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `vf-${name}-${finish}.svg`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function IconsSection({
  standalone = false,
  archiveUrl,
}: {
  standalone?: boolean;
  archiveUrl?: string;
}): ReactElement {
  const [family, setFamily] = useState<FieldIconFamily | "All">("All");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<FieldIconName>("brand-field");
  const [persona, setPersona] = useState<FieldIconName>("identity-knot");
  const [finish, setFinish] = useState<FieldIconFinish>("sticker");
  const [ink, setInk] = useState("black");
  const [size, setSize] = useState(96);
  const [showSource, setShowSource] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [tool, setTool] = useState<FieldIconName>("select");
  const Title = standalone ? "h1" : "h2";
  const mark = FIELD_MARKS[selected];
  const marks = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return FIELD_ICON_NAMES.filter((name) => {
      const m = FIELD_MARKS[name];
      const haystack = `${name} ${m.label} ${m.family} ${m.purpose} ${m.idea}`.toLowerCase();
      return (
        (family === "All" || m.family === family) && terms.every((term) => haystack.includes(term))
      );
    });
  }, [family, query]);
  const choose = (name: FieldIconName, reveal = false): void => {
    setSelected(name);
    setCopyStatus("");
    setShowSource(false);
    if (reveal || window.matchMedia("(max-width: 760px)").matches)
      requestAnimationFrame(() => {
        const target = document.getElementById("vf-marks-inspector");
        target?.scrollIntoView({ block: "start", behavior: "instant" });
        target?.focus({ preventScroll: true });
      });
  };
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(fieldIconSvg(selected, finish));
      setCopyStatus(`${mark.label} ${finish} copied.`);
    } catch {
      setShowSource(true);
      setCopyStatus("Select the source below to copy, or download the SVG.");
    }
  };
  return (
    <section
      id="fieldmarks"
      className="vf-marks ah"
      data-ink={ink}
      aria-labelledby="vf-marks-title"
    >
      <header className="ah-hero">
        <div className="ah-hero-copy">
          <p className="ah-kicker">VibeField supply / Sticker club / Vol. 02</p>
          <Title id="vf-marks-title">
            AFTER
            <br />
            <span className="ah-outline">HOURS.</span>
          </Title>
          <p className="ah-deck">
            Strange little machines.
            <br />A field full of characters.
          </p>
          <p className="ah-intro">
            For the people who make things, the agents who never clock out, and the computers with a
            life of their own.
          </p>
          <div className="ah-actions">
            <a className="ah-button" href="#vf-marks-atlas">
              Peel & inspect{" "}
              <span className="ah-button-arrow" aria-hidden="true">
                ↘
              </span>
            </a>
            {archiveUrl && (
              <a className="ah-text-link" href={archiveUrl} download="vibefield-after-hours.zip">
                Take the whole pack ↓
              </a>
            )}
          </div>
          <div className="ah-edition">
            <span className="ah-edition-number">78</span>
            <span>
              VECTOR STICKERS
              <br />
              ORIGINAL ART / TWO INKS
              <br />
              MADE FOR VIBEFIELD
            </span>
          </div>
        </div>
        <figure className="ah-collage" aria-label="After Hours sticker wall">
          <div className="ah-collage-grid" />
          <span className="ah-collage-label">KEEP YOUR FIELD WEIRD.</span>
          {COLLAGE.map(([name, placement]) => (
            <button
              className={`ah-cutout ah-cutout--${placement}`}
              key={name}
              type="button"
              aria-label={`Inspect ${FIELD_MARKS[name].label}`}
              onClick={() => choose(name, true)}
            >
              <FieldIcon name={name} size={220} finish="sticker" />
            </button>
          ))}
          <span className="ah-round-stamp">
            100%
            <br />
            <b>LOCAL</b>
            <br />
            ODDITIES
          </span>
          <figcaption>
            PEEL HERE ↗<br />
            VF–002 / LATE SHIFT EDITION
          </figcaption>
        </figure>
      </header>
      <div className="ah-ticker">
        <span>THICK INK</span>
        <i aria-hidden="true">✳</i>
        <span>OLD HARDWARE</span>
        <i aria-hidden="true">✳</i>
        <span>ODD COMPANY</span>
        <i aria-hidden="true">✳</i>
        <span>YOUR OWN FIELD</span>
      </div>

      <section className="ah-section" aria-labelledby="ah-crew-title">
        <div className="ah-section-heading">
          <p className="ah-kicker">01 / Meet the night shift</p>
          <h3 id="ah-crew-title">
            Little weirdos.
            <br />
            <em>Real jobs.</em>
          </h3>
          <p>
            Each role gets a character with a story: a submarine that looks deeper, hands that make,
            tape that connects, and a disk that remembers.
          </p>
        </div>
        <div className="ah-crew-grid">
          {CREW.map(([name, job, title], i) => (
            <button
              className="ah-crew-card"
              type="button"
              key={name}
              onClick={() => choose(name, true)}
              aria-label={`Inspect ${FIELD_MARKS[name].label}`}
            >
              <span className="ah-card-index">NO. 0{i + 1} / AGENT ROLE</span>
              <FieldIcon name={name} size={210} finish="sticker" />
              <strong>{title}</strong>
              <span className="ah-card-job">{job}</span>
              <span className="ah-card-link">MEET THE CHARACTER ↗</span>
            </button>
          ))}
        </div>
        <p className="ah-footnote">
          Role characters are design proposals. Provider identity and observed session state keep
          their own names and marks.
        </p>
      </section>

      <section className="ah-section ah-identities" aria-labelledby="vf-marks-persona-title">
        <div className="ah-section-heading">
          <p className="ah-kicker">02 / Personal editions</p>
          <h3 id="vf-marks-persona-title">
            Pick your
            <br />
            <em>alter ego.</em>
          </h3>
          <p>
            A brain with a jack. A floppy growing leaves. A planet wearing shades. The field belongs
            to someone—let it look like it.
          </p>
        </div>
        <div className="ah-persona-layout">
          <div className="ah-persona-pass">
            <div className="ah-pass-top">
              <span>VIBEFIELD</span>
              <span>PERSONAL EDITION</span>
            </div>
            <FieldIcon name={persona} size={205} finish="sticker" />
            <span className="ah-pass-title">YOUR FIELD / YOUR NAME</span>
            <strong>{FIELD_MARKS[persona].label}</strong>
            <div className="ah-barcode" aria-hidden="true" />
            <span className="ah-pass-serial">VF / YOU / 0001</span>
          </div>
          <fieldset className="ah-persona-picker" aria-label="Personal sticker preview">
            {FIELD_ICON_NAMES.filter((name) => FIELD_MARKS[name].family === "Identity").map(
              (name, i) => (
                <button
                  type="button"
                  key={name}
                  aria-label={`Try ${FIELD_MARKS[name].label}`}
                  aria-pressed={persona === name}
                  onClick={() => setPersona(name)}
                  style={{ "--lean": `${i % 2 ? 3 : -3}deg` } as CSSProperties}
                >
                  <FieldIcon name={name} size={92} finish="sticker" />
                  <span>{FIELD_MARKS[name].label}</span>
                </button>
              ),
            )}
          </fieldset>
        </div>
        <p className="ah-footnote">
          An identity-art preview. VibeField’s existing emoji sticker/coin account faces remain in
          place; this picker only changes this sheet.
        </p>
      </section>

      <section
        id="vf-marks-atlas"
        className="ah-section ah-atlas"
        aria-labelledby="vf-marks-atlas-title"
      >
        <div className="ah-atlas-heading">
          <div>
            <p className="ah-kicker">03 / The complete sticker sheet</p>
            <h3 id="vf-marks-atlas-title">
              PEEL &<br />
              <em>INSPECT.</em>
            </h3>
          </div>
          <p>
            Click any drawing for the idea behind it.
            <br />
            Take the die-cut sticker or the plain artwork.
          </p>
        </div>
        <div className="ah-toolbar">
          <label className="ah-search">
            <span>FIND YOUR WEIRD</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ghost, floppy, cable, terminal…"
            />
          </label>
          <fieldset className="ah-inks" aria-label="Print ink preview">
            <legend>INK PROOF</legend>
            {["black", "cobalt", "vermilion"].map((color) => (
              <button
                type="button"
                key={color}
                data-ink={color}
                aria-label={`${color} print ink`}
                aria-pressed={ink === color}
                onClick={() => setInk(color)}
              >
                <span />
              </button>
            ))}
          </fieldset>
          <label className="ah-size">
            <span>STICKER SIZE</span>
            <input
              type="range"
              min="64"
              max="128"
              step="8"
              value={size}
              onChange={(event) => setSize(Number(event.target.value))}
            />
            <output>{size}px</output>
          </label>
        </div>
        <fieldset className="ah-filters" aria-label="Sticker family filters">
          {(["All", ...FAMILIES] as const).map((item) => (
            <button
              type="button"
              key={item}
              aria-pressed={family === item}
              onClick={() => setFamily(item)}
            >
              {item === "All" ? "The whole pack" : TITLES[item]}
              <span>
                {item === "All"
                  ? 78
                  : FIELD_ICON_NAMES.filter((name) => FIELD_MARKS[name].family === item).length}
              </span>
            </button>
          ))}
        </fieldset>
        <div className="ah-atlas-meta">
          <span>77 NEW DRAWINGS + THE ORIGINAL VIBEFIELD LOOP</span>
          <span role="status" aria-live="polite">
            {marks.length} / 78 ON THE SHEET
          </span>
        </div>
        <div className="ah-atlas-layout">
          <div className="ah-grid">
            {marks.map((name, i) => (
              <button
                className="ah-tile"
                key={name}
                type="button"
                aria-label={`Inspect ${FIELD_MARKS[name].label}`}
                aria-pressed={selected === name}
                onClick={() => choose(name)}
                style={{ "--lean": `${[-5, 3, -2, 5, 0][i % 5]}deg` } as CSSProperties}
              >
                <span className="ah-tile-number">
                  {String(FIELD_ICON_NAMES.indexOf(name) + 1).padStart(2, "0")}
                </span>
                <span className="ah-tile-drawing">
                  <FieldIcon name={name} size={size} finish="sticker" />
                </span>
                <strong>{FIELD_MARKS[name].label}</strong>
                <code>{name}</code>
              </button>
            ))}
            {marks.length === 0 && (
              <div className="ah-empty">
                <h4>No stickers here.</h4>
                <p>Try a different word or open the whole pack.</p>
                <button
                  type="button"
                  className="ah-button"
                  onClick={() => {
                    setFamily("All");
                    setQuery("");
                  }}
                >
                  Reset the sheet
                </button>
              </div>
            )}
          </div>
          <aside
            className="ah-inspector"
            id="vf-marks-inspector"
            tabIndex={-1}
            aria-label="Selected sticker details"
          >
            <div className="ah-inspector-art">
              <span className="ah-inspector-number">
                VF / {String(FIELD_ICON_NAMES.indexOf(selected) + 1).padStart(2, "0")}
              </span>
              <FieldIcon name={selected} size={218} finish={finish} />
              <span className="ah-inspector-finish">
                {finish === "sticker" ? "WHITE DIE-CUT EDGE" : "PLAIN TWO-INK ARTWORK"}
              </span>
            </div>
            <div className="ah-inspector-copy">
              <p className="ah-kicker">
                {TITLES[mark.family]} / {mark.grid}-unit original
              </p>
              <h4>{mark.label}</h4>
              <code>{selected}.svg</code>
              <p className="ah-rationale">{mark.idea}</p>
              <p className="ah-purpose">{mark.purpose}</p>
              <fieldset className="ah-finish" aria-label="Export finish">
                {(["sticker", "artwork"] as const).map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={finish === value}
                    onClick={() => {
                      setFinish(value);
                      setCopyStatus("");
                    }}
                  >
                    {value === "sticker" ? "Die-cut sticker" : "Plain artwork"}
                  </button>
                ))}
              </fieldset>
              <div className="ah-scale">
                {[24, 48, 96].map((n) => (
                  <figure key={n}>
                    <FieldIcon name={selected} size={n} finish={finish} />
                    <figcaption>{n}px</figcaption>
                  </figure>
                ))}
              </div>
              <p className="ah-optical">
                Recommended {mark.minimum}px+. Tiny samples show where the detail breaks down.
                Downloads use black ink by default; ink proofs change the preview.
              </p>
              <div className="ah-export">
                <button
                  className="ah-button"
                  type="button"
                  onClick={() => download(selected, finish)}
                >
                  Save SVG ↓
                </button>
                <button
                  className="ah-text-button"
                  type="button"
                  onClick={() => {
                    void copy();
                  }}
                >
                  Copy SVG
                </button>
              </div>
              <p className="ah-copy-status" role="status">
                {copyStatus}
              </p>
              <button
                className="ah-source-toggle"
                type="button"
                aria-expanded={showSource}
                onClick={() => setShowSource((v) => !v)}
              >
                {showSource ? "Hide vector source" : "Show vector source"}
              </button>
              {showSource && (
                <textarea
                  className="ah-source"
                  aria-label="Selected sticker SVG source"
                  value={fieldIconSvg(selected, finish)}
                  readOnly
                  onFocus={(event) => event.target.select()}
                />
              )}
            </div>
          </aside>
        </div>
      </section>

      <section className="ah-section ah-small-stuff" aria-labelledby="ah-small-title">
        <div className="ah-section-heading">
          <p className="ah-kicker">04 / Button-sized attitude</p>
          <h3 id="ah-small-title">
            Small tools.
            <br />
            <em>Heavy ink.</em>
          </h3>
          <p>
            Compact action stamps have fewer details. The large character drawings get enough space
            to keep their expressions.
          </p>
        </div>
        <div className="ah-control-specimen">
          <p className="ah-kicker">Actual UiIconButton / 40px hit area / 24px artwork</p>
          <div className="ah-control-row">
            {(
              [
                "select",
                "pan",
                "add",
                "fit",
                "focus",
                "copy",
                "edit",
                "settings",
                "run",
                "pause",
                "stop",
                "download",
              ] as const
            ).map((name) => (
              <UiIconButton
                key={name}
                aria-label={FIELD_MARKS[name].label}
                aria-pressed={tool === name}
                active={tool === name}
                onClick={() => setTool(name)}
              >
                <FieldIcon name={name} size={24} finish="sticker" />
              </UiIconButton>
            ))}
          </div>
          <p className="ah-footnote">
            Selected preview: {FIELD_MARKS[tool].label}. These controls operate the specimen, not a
            live session.
          </p>
        </div>
        <div className="ah-signal-row">
          {FIELD_ICON_NAMES.filter((name) => FIELD_MARKS[name].family === "States").map((name) => (
            <figure key={name}>
              <FieldIcon name={name} size={48} finish="sticker" />
              <figcaption>{FIELD_MARKS[name].label}</figcaption>
            </figure>
          ))}
        </div>
        <p className="ah-footnote">
          Signals are drawn here in one print ink. Product states keep their explicit words and
          existing semantic colors; sticker color never indicates a user’s status.
        </p>
      </section>

      <section className="ah-section ah-notes" aria-labelledby="ah-notes-title">
        <p className="ah-kicker">05 / Notes from the print shop</p>
        <h3 id="ah-notes-title">
          MADE OF
          <br />
          <em>FIELD LORE.</em>
        </h3>
        <div className="ah-notes-grid">
          <article>
            <b>01 / OBJECTS WITH A PAST</b>
            <p>
              CRTs, coiled leads, tapes, floppy labels, record crates, and carpenter’s pencils. Old
              technology gives the invisible agent world objects you can almost hold.
            </p>
          </article>
          <article>
            <b>02 / A LITTLE BAD MANNERS</b>
            <p>
              Offset eyes. Skewed perspective. Overweight black shadows. A brain with a plug. The
              drawings use visual jokes and mismatched silhouettes to earn a place on a laptop lid.
            </p>
          </article>
          <article>
            <b>03 / A PRINTED FAMILY</b>
            <p>
              The lesson from Stink Dings is a collection with a point of view. These are new paths,
              made for VibeField: bold ink, open paper, small scratches, and a white die-cut edge.
            </p>
          </article>
        </div>
        <div className="ah-handoff">
          <p>
            78 editable SVGs in two finishes, a sprite, shared React components, and the complete
            drawing source. The primary logo stays exact. Account-face and agent-role assignment
            remain proposals.
          </p>
          <pre>
            <code>
              {
                'import { FieldIcon } from "@vibefield/design-kit/icons";\n\n<FieldIcon name="agent-scout" size={96} finish="sticker" />'
              }
            </code>
          </pre>
        </div>
        {archiveUrl && (
          <a
            className="ah-button ah-download-bottom"
            href={archiveUrl}
            download="vibefield-after-hours.zip"
          >
            TAKE THE WHOLE PACK ↓
          </a>
        )}
      </section>
      <footer className="ah-footer">
        <FieldIcon name="brand-mark" size={64} />
        <span>
          VIBEFIELD / AFTER HOURS
          <br />
          STICKER CLUB • VOLUME 02 • 22 SEPTEMBER 2026
        </span>
        <span>
          MAKE THINGS.
          <br />
          KEEP THE WEIRD ONES.
        </span>
      </footer>
    </section>
  );
}
