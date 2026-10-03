import { UserFaceView } from "@vibefield/design-kit/face";
import {
  FACE_STICKER_IDS,
  FACE_STICKERS,
  FaceSticker,
  type FaceStickerFinish,
  type FaceStickerGroup,
  type FaceStickerId,
  type FaceStickerOptical,
  faceStickerSvg,
} from "@vibefield/design-kit/face-stickers";
import { FieldIcon } from "@vibefield/design-kit/icons";
import { SegmentedControl, UiButton, uiFieldClass } from "@vibefield/design-kit/primitives";
import { type CSSProperties, type ReactElement, useMemo, useState } from "react";

const GROUPS: readonly (FaceStickerGroup | "All")[] = [
  "All",
  "Animals",
  "Garden",
  "Food",
  "Objects",
];
const COVER: readonly FaceStickerId[] = ["fox", "octopus", "frog", "snail", "trex", "planet"];
const SIZES = [16, 24, 40, 112] as const;
const SIZE_LABELS = ["Presence", "Account row", "Me menu", "Setup"];
function download(
  name: FaceStickerId,
  optical: FaceStickerOptical,
  finish: FaceStickerFinish,
): void {
  const url = URL.createObjectURL(
    new Blob([faceStickerSvg(name, optical, finish)], { type: "image/svg+xml" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `vf-face-${name}-${optical}-${finish}.svg`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FaceStickersSection({
  standalone = false,
  archiveUrl,
}: {
  standalone?: boolean;
  archiveUrl?: string;
}): ReactElement {
  const [group, setGroup] = useState<FaceStickerGroup | "All">("All");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<FaceStickerId>("fox");
  const [optical, setOptical] = useState<FaceStickerOptical>("large");
  const [finish, setFinish] = useState<FaceStickerFinish>("sticker");
  const [ground, setGround] = useState("Paper");
  const [showSource, setShowSource] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const face = FACE_STICKERS[selected];
  const Title = standalone ? "h1" : "h2";
  const ids = useMemo(() => {
    const terms = query
      .replace(/[\uFE0E\uFE0F]/g, "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return FACE_STICKER_IDS.filter((id) => {
      const item = FACE_STICKERS[id];
      const text = `${id} ${item.emoji} ${item.label} ${item.nickname} ${item.group}`
        .replace(/[\uFE0E\uFE0F]/g, "")
        .toLowerCase();
      return (
        (group === "All" || item.group === group) && terms.every((term) => text.includes(term))
      );
    });
  }, [group, query]);
  const choose = (name: FaceStickerId): void => {
    setSelected(name);
    setCopyStatus("");
    setShowSource(false);
    if (window.matchMedia("(max-width: 1050px)").matches)
      requestAnimationFrame(() => {
        const inspector = document.getElementById("fc-inspector");
        inspector?.scrollIntoView({ block: "start", behavior: "instant" });
        inspector?.focus({ preventScroll: true });
      });
  };
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(faceStickerSvg(selected, optical, finish));
      setCopyStatus(`${face.label} SVG copied.`);
    } catch {
      setShowSource(true);
      setCopyStatus("Select the SVG source below to copy, or use Download SVG.");
    }
  };
  return (
    <section className="ah fc" id="face-stickers" aria-labelledby="fc-title">
      <header className="fc-cover">
        <div className="fc-cover-copy">
          <p className="fc-kicker">VibeField supply / After Hours / No. 03</p>
          <Title id="fc-title">
            FACE
            <br />
            <span>CLUB.</span>
          </Title>
          <p className="fc-cover-deck">
            Familiar faces.
            <br />A little more character.
          </p>
          <p className="fc-cover-intro">
            Your 48 account emoji, reimagined as a cast of odd little ink-and-paper stickers.
          </p>
          <a className="fc-jump" href="#fc-atlas">
            Meet the whole club{" "}
            <span className="fc-jump-arrow" aria-hidden="true">
              ↘
            </span>
          </a>
        </div>
        <div className="fc-cover-art" aria-hidden="true">
          <span className="fc-ticket">
            48 FACES
            <br />
            <b>ONE FIELD.</b>
          </span>
          {COVER.map((name, index) => (
            <span key={name} className={`fc-pasted fc-pasted-${index}`}>
              <FaceSticker name={name} size={190} />
            </span>
          ))}
          <span className="fc-cover-stamp">
            PEEL HERE ↗<br />
            KEEP YOUR WEIRD
          </span>
        </div>
      </header>
      <div className="fc-strip">
        <span>48 selected emoji</span>
        <span>96 original drawings</span>
        <span>Ink + paper</span>
        <span>After Hours account edition</span>
      </div>

      <section className="fc-brief" aria-labelledby="fc-brief-title">
        <div>
          <p className="fc-kicker">The account-face brief</p>
          <h3 id="fc-brief-title">
            Known by shape.
            <br />
            <em>Drawn with personality.</em>
          </h3>
        </div>
        <p>
          The account design already has the right idea: a face you can pick out at a glance. This
          edition keeps every subject in the current deck and gives it the same heavy ink,
          off-centre eyes, paper cuts, and comic energy as After Hours.
        </p>
        <p>
          The fox gets a sly wedge of a muzzle. The snail gets a big, lazy spiral. The cactus
          becomes a ribbed desert oddball. Each is an original drawing, with a second, simpler
          master for the smallest places a face appears.
        </p>
      </section>

      <section className="fc-atlas" id="fc-atlas" aria-labelledby="fc-atlas-title">
        <header className="fc-section-head">
          <div>
            <p className="fc-kicker">01 / The full deck</p>
            <h3 id="fc-atlas-title">Same emoji. New faces.</h3>
          </div>
          <p>
            Original → sticker.
            <br />
            Pick any card to inspect it.
          </p>
        </header>
        <div className="fc-tools">
          <fieldset className="fc-filters" aria-label="Filter face collection">
            {GROUPS.map((value) => (
              <UiButton
                key={value}
                variant={group === value ? "primary" : "quiet"}
                onClick={() => setGroup(value)}
                aria-pressed={group === value}
              >
                {value}
                <span className="fc-count">
                  {value === "All"
                    ? 48
                    : FACE_STICKER_IDS.filter((id) => FACE_STICKERS[id].group === value).length}
                </span>
              </UiButton>
            ))}
          </fieldset>
          <label className="fc-search">
            <span className="fc-kicker">Find a face</span>
            <input
              className={uiFieldClass}
              type="search"
              placeholder="Fox, snail, 🪐…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        <div className="fc-result-bar">
          <span role="status">{ids.length} of 48 faces</span>
          <span>Deck order preserved / all subjects redrawn</span>
        </div>
        <div className="fc-atlas-layout">
          <div className="fc-gallery-area">
            <div className="fc-gallery">
              {ids.map((id) => {
                const item = FACE_STICKERS[id];
                return (
                  <button
                    type="button"
                    key={id}
                    className="fc-card"
                    aria-pressed={selected === id}
                    aria-label={`Inspect ${item.label}: ${item.nickname}`}
                    onClick={() => choose(id)}
                  >
                    <span className="fc-card-meta">
                      <span>
                        {String(FACE_STICKER_IDS.indexOf(id) + 1).padStart(2, "0")} / {item.label}
                      </span>
                      <span aria-hidden="true">↗</span>
                    </span>
                    <span className="fc-pair">
                      <span className="fc-original">
                        <UserFaceView emoji={item.emoji} size={32} seed={`face-club-${id}`} />
                        <span>EMOJI</span>
                      </span>
                      <span className="fc-arrow" aria-hidden="true">
                        →
                      </span>
                      <FaceSticker name={id} size={120} />
                    </span>
                    <span className="fc-card-name">{item.nickname}</span>
                  </button>
                );
              })}
            </div>
            {ids.length === 0 && (
              <div className="fc-empty">
                <h4>No faces match that search.</h4>
                <p>Try an animal, an object, or its emoji.</p>
                <UiButton
                  onClick={() => {
                    setGroup("All");
                    setQuery("");
                  }}
                >
                  Show all 48 faces
                </UiButton>
              </div>
            )}
          </div>
          <aside
            className="fc-inspector"
            id="fc-inspector"
            tabIndex={-1}
            aria-labelledby="fc-inspector-title"
          >
            <div className="fc-inspector-heading">
              <p className="fc-kicker">
                Under the loupe / {String(FACE_STICKER_IDS.indexOf(selected) + 1).padStart(2, "0")}
              </p>
              <h4 id="fc-inspector-title">{face.nickname}</h4>
              <p>
                {face.emoji} {face.label} <span>· {face.group}</span>
              </p>
            </div>
            <div className="fc-inspector-art" data-ground={ground.toLowerCase()}>
              <FaceSticker
                name={selected}
                size={250}
                optical={optical}
                finish={finish}
                label={`${face.label} — ${face.nickname}`}
              />
            </div>
            <div className="fc-proof-switch">
              <SegmentedControl
                options={["Paper", "Night"]}
                value={ground}
                onChange={setGround}
                label="Preview ground"
              />
            </div>
            <p className="fc-idea">{face.idea}</p>
            <div className="fc-option">
              <span className="fc-kicker">Drawing</span>
              <SegmentedControl
                options={["Detailed", "Small"]}
                value={optical === "large" ? "Detailed" : "Small"}
                onChange={(value) => {
                  setOptical(value === "Detailed" ? "large" : "small");
                  setCopyStatus("");
                }}
                label="Optical drawing"
              />
            </div>
            <div className="fc-option">
              <span className="fc-kicker">Edge</span>
              <SegmentedControl
                options={["Sticker", "Artwork"]}
                value={finish === "sticker" ? "Sticker" : "Artwork"}
                onChange={(value) => {
                  setFinish(value === "Sticker" ? "sticker" : "artwork");
                  setCopyStatus("");
                }}
                label="SVG finish"
              />
            </div>
            <div className="fc-downloads">
              <UiButton variant="primary" onClick={() => download(selected, optical, finish)}>
                Download SVG <span aria-hidden="true">↓</span>
              </UiButton>
              <UiButton
                onClick={() => {
                  void copy();
                }}
              >
                Copy SVG
              </UiButton>
            </div>
            <UiButton
              className="fc-source-toggle"
              onClick={() => setShowSource(!showSource)}
              aria-expanded={showSource}
              aria-controls="fc-source"
            >
              {showSource ? "Hide SVG source" : "View SVG source"}
            </UiButton>
            <a className="fc-back-link" href="#fc-atlas">
              Back to the deck ↑
            </a>
            <p className="fc-copy-status" role="status">
              {copyStatus}
            </p>
            {showSource && (
              <textarea
                id="fc-source"
                aria-label={`${face.label} SVG source`}
                readOnly
                value={faceStickerSvg(selected, optical, finish)}
                onFocus={(event) => event.currentTarget.select()}
              />
            )}
          </aside>
        </div>
      </section>

      <section className="fc-scale" id="fc-scale" aria-labelledby="fc-scale-title">
        <header className="fc-section-head">
          <div>
            <p className="fc-kicker">02 / Big character. Small spaces.</p>
            <h3 id="fc-scale-title">Made to get smaller.</h3>
          </div>
          <p>
            Select a face above.
            <br />
            This proof follows your selection.
          </p>
        </header>
        <div className="fc-scale-layout">
          <div className="fc-scale-copy">
            <FaceSticker name={selected} size={96} />
            <h4>{face.label}, twice drawn.</h4>
            <p>{face.smallNote}</p>
            <p>
              Below 40px, the small master opens up the features and removes fine marks. At 40px and
              above, the detailed sticker takes over.
            </p>
            <p className="fc-kicker">Shown at actual CSS sizes</p>
          </div>
          <div className="fc-scale-proofs">
            {["paper", "night"].map((wall) => (
              <div className="fc-scale-row" data-ground={wall} key={wall}>
                {SIZES.map((size, index) => (
                  <figure key={size}>
                    <span
                      className="fc-size-art"
                      style={{ "--fc-size": `${size}px` } as CSSProperties}
                    >
                      <FaceSticker name={selected} size={size} />
                    </span>
                    <figcaption>
                      <b>{size}px</b>
                      <span>{SIZE_LABELS[index]}</span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="fc-notes" aria-labelledby="fc-notes-title">
        <div>
          <p className="fc-kicker">03 / The drawing language</p>
          <h3 id="fc-notes-title">A family of misfits.</h3>
        </div>
        <div className="fc-principles">
          <article>
            <span>01</span>
            <h4>Recognize the subject.</h4>
            <p>
              The owl’s eye discs. The camel’s two humps. The panda’s patches. A clear anatomical or
              object cue comes before the joke.
            </p>
          </article>
          <article>
            <span>02</span>
            <h4>Let the ink do it.</h4>
            <p>
              Unequal contours, deep black planes, blunt hatching, and little paper highlights give
              the drawings their retro print character.
            </p>
          </article>
          <article>
            <span>03</span>
            <h4>Keep the paper white.</h4>
            <p>
              The cut edge stays white on both grounds. Color is unnecessary for telling these faces
              apart; their forms carry the identity.
            </p>
          </article>
        </div>
      </section>
      <footer className="fc-footer">
        <div>
          <FieldIcon name="brand-mark" size={48} />
          <div>
            <p className="fc-kicker">VibeField / After Hours / Face Club</p>
            <h3>Take the whole club home.</h3>
            <p>48 subjects · 96 drawings · 192 SVG exports + two sprites</p>
          </div>
        </div>
        {archiveUrl ? (
          <a className="fc-jump" href={archiveUrl} download="vibefield-face-club.zip">
            Download the full pack{" "}
            <span className="fc-jump-arrow" aria-hidden="true">
              ↓
            </span>
          </a>
        ) : (
          <p className="fc-kicker">Individual SVGs available in the inspector</p>
        )}
      </footer>
      <details className="fc-handoff">
        <summary>Design & implementation notes</summary>
        <div>
          <p>
            This is the proposed vector artwork for the current account-face deck, read from{" "}
            <code>packages/contracts/src/user-face.ts</code>. The comparison uses the shipping{" "}
            <code>UserFaceView</code> and the new shared <code>FaceSticker</code> leaf.
          </p>
          <p>
            The deck, stored emoji, assignment, collision policy, per-user tilt, custom emoji entry,
            and coin frame remain with the existing account system. This catalogue does not change
            an account. Unknown emoji have no drawing in this pack and should keep the native
            renderer.
          </p>
          <p>
            All 48 drawings are original vector interpretations. The emoji specimens use your
            system’s emoji font. The sticker artwork contains no emoji glyphs, Apple assets, traced
            Stink Dings paths, embedded fonts, or raster images.
          </p>
          <p>
            Master boards: 112 units detailed, 56 units small. The artwork finish removes the outer
            die-cut edge; white interiors remain opaque. Export scale tests are a visual proof, not
            a substitute for testing recognition with people in the actual account picker.
          </p>
          <p>
            The source is <code>tooling/face-stickers/art.py</code>. A deterministic generator
            checks exact deck coverage and builds SVGs, metadata, and the ZIP. Studio and this
            offline report use the same catalogue component.
          </p>
        </div>
      </details>
    </section>
  );
}
