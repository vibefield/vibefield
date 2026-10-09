# AFTER HOURS — VibeField sticker club, edition 02

78 original vector designs: 77 redrawn stickers and the exact existing VibeField loop.
No Stink Dings geometry is reused. The collection studies its attitude: expressive objects,
bold positive/negative ink, retro hardware, mixed silhouettes, and culture-specific visual jokes.

- Root SVGs: complete stickers with opaque white backing and a die-cut keyline.
- `artwork/`: the same drawings without the outer keyline.
- `sprite.svg`: plain artwork symbols, named `vf-{icon-name}`.
- `catalogue.json`: original shapes, labels, intended use, and individual design rationale.

The outside is transparent. Interior paper is intentionally opaque. Ink inherits `currentColor`;
Exports use explicit white paper for editor compatibility. In React, `--vf-sticker-paper`
controls interior paper in the artwork edition; the sticker edition pins it to white. Recommended sizes: characters/brand 48px+, desk objects 32px+, actions 24px+, signals
28px+. The existing logo can be used at 32px.

React:

```tsx
import { FieldIcon } from "@vibefield/design-kit/icons";
<FieldIcon name="agent-scout" size={96} finish="sticker" label="Deep diver" />
```

Default React finish is `artwork`; default semantics are decorative. Label the enclosing
button or supply `label` for an independent image. Role characters and personal alter egos
are proposals; they do not change account faces, provider identities, or observed state.

Source: `tooling/fieldmarks/generate.py`. Handoff: `draft/design/fieldmarks.md`.
Interactive offline sheet: `draft/design/fieldmarks.html`.
