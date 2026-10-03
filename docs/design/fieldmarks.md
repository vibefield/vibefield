# AFTER HOURS — VibeField sticker club

**Edition 02 · 22 September 2026.** [Open the interactive sheet](fieldmarks.html) or
[download the complete SVG pack](vibefield-fieldmarks.zip).

The redesign replaces all 77 new drawings from the first edition. The existing VibeField loop
remains exact. The collection now behaves like a set of laptop stickers: heavier ink,
illustrated objects, little visual jokes, distinctive characters, and a white die-cut edge.

## Art direction

The local Stink Dings artwork was reviewed again at illustration scale—its hardware details,
weighted silhouettes, varied subjects, eyes, physical objects, and negative-space cuts. The
first edition had translated those lessons into a restrained interface family; this edition
brings the illustration and personality to the foreground.

The new collection imagines a VibeField night shift. A terminal rides a checkerboard deck.
An agent scout becomes a one-eyed submarine. A weaver becomes an unspooling cassette; a keeper,
a toothed floppy. Personal characters include a cable brain, a leaf-growing disk, a sunglasses
planet, a hammock creature, and a watchful lantern. They are newly drawn interpretations of
VibeField's product world, not copies of Stink Dings paths.

The visual language uses skewed perspective, fat shadow planes, small hatching cuts, off-center
eyes, broad contour lines, bitmap label lettering, checker details, and unexpected combinations
of otherwise familiar objects. Controls are compact stamps with simpler details. Large mascots
are meant to be seen at 48–96px and above, rather than squeezed into a 16px row.

## The pack

| Family | Drawings | Direction |
|---|---:|---|
| Field lore / Brand | 6 | Exact loop plus five illustrated brand stories |
| Alter egos / Identity | 12 | Personal characters and odd possessions |
| Night crew / Agents | 8 | Specific working characters, separate from provider and state |
| Desk objects / Workspace | 16 | Old hardware, physical paper, wires, and saved collections |
| Action stamps / Controls | 28 | Heavy, cut-paper shapes for familiar actions |
| Field signals / States | 8 | Illustrated state signs with explicit word labels |

All 78 existing API names are retained. Each drawing has a description of its purpose and its
individual design idea in the interactive inspector and metadata.

## Product grounding

This continues the onboarding against [DESIGN.md](../../DESIGN.md),
[UI_SYSTEM.md](../UI_SYSTEM.md), [product architecture](../../draft/design-00-architecture.md),
[AGENT_PLANE.md](../AGENT_PLANE.md), the account/agent views, and
[app-icon provenance](../../apps/desktop/packaging/icons/README.md).

The personal programmable field, living cards, private device mesh, attention, and saved
creations inform the images. The sheet's print palette and display typography are an editorial
art surface described in DESIGN §11. They do not redefine the application's quiet chrome.
Account faces remain the emoji sticker/coin system in §2.8. Vector alter egos and agent-role
assignment are design proposals; the preview stores neither. Known provider marks, live status,
Godview bodies, file-tree glyphs, and all packaged brand masters are preserved.

## Assets and API

The pack contains **156 SVGs**: 78 stickers and 78 plain-artwork versions, plus an artwork sprite,
metadata, and README. Root files have the white die-cut edge; `artwork/` omits it. Ink inherits
`currentColor`. The paper inside the illustrations is opaque by design, with transparent space
outside. Sticker paper remains white in either theme. Exported SVGs use explicit white fills,
so their paper layer does not depend on CSS-variable support in an external vector editor.

```tsx
import { FieldIcon, fieldIconSvg } from "@vibefield/design-kit/icons";

<FieldIcon name="agent-scout" size={96} finish="sticker" label="Deep diver" />

// Inside a labelled control, omit the independent image label.
<UiIconButton aria-label="Pan the field">
  <FieldIcon name="pan" size={24} finish="sticker" />
</UiIconButton>

const stickerSvg = fieldIconSvg("agent-scout", "sticker");
const artworkSvg = fieldIconSvg("agent-scout", "artwork");
```

Default React finish is `artwork`; the default standalone exporter finish is `sticker`.
Recommended floors: character/brand 48px (retained loop 32px), workspace 32px, controls 24px,
states 28px. The inspector shows 24/48/96px so limitations are visible. Print-ink previews are
catalogue treatments; downloads inherit the host ink instead of baking in a proof color.

The catalogue provides searchable family filters, a personal-character preview, black/cobalt/
vermilion ink proofs, a size slider, two export finishes, SVG source and copy, and real shared
40px button specimens. Studio and the offline HTML render the same `IconsSection`.

## Source and rebuild

Original drawing geometry: `tooling/fieldmarks/generate.py`.
Generated SVGs: `packages/design-kit/assets/fieldmarks`.
React leaf: `packages/design-kit/src/icons`.

```sh
node tooling/fieldmarks/build.mjs
python3 tooling/fieldmarks/generate.py --check
```

The generator checks name coverage and creates both finishes from one geometry source. The HTML
builder renders and hydrates the shared catalogue, embedding React, CSS, artwork, and the ZIP.

## Verification — edition 02

The design-kit typecheck and the scoped catalogue typecheck passed, as did the production
Studio build, all 13 existing UI boundary tests, Biome on the 10 touched implementation files,
and generated-asset consistency. The full field-app typecheck reported an unrelated missing
`children` prop in `test/settings-dialog-account.test.tsx:55` in the concurrently changing
account work; that test was not edited by this redesign.

Browser checks passed for all six family filters, search and empty-state reset, personal and
control previews, three ink proofs, keyboard sizing, both SVG finishes, source display, copy,
and the individual SVG and ZIP downloads. The offline sheet made no resource requests and
reported no hydration or browser errors. Layouts at 320, 390, 768, 1024, and 1440px had no
horizontal overflow. All 156 SVG files and the sprite parsed; the 159-entry ZIP validated.
The original app and tray master hashes are unchanged.

Visual review: [light](fieldmarks-review/light.png), [night wall](fieldmarks-review/dark.png),
[mobile identity picker](fieldmarks-review/mobile.png), [Studio](fieldmarks-review/studio.png),
and [large artwork sheet](fieldmarks-review/artwork-sheet.png).
