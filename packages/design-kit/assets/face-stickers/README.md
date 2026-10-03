# FACE CLUB — VibeField / After Hours

48 original illustrations for the exact 48 emoji in `packages/contracts/src/user-face.ts`.
This is the account-face artwork proposal, extending the approved After Hours sticker family.
The production account renderer, emoji values, deal order, collision rules, coin frame, and
custom-emoji input are unchanged.

## Files

- `large/sticker`: detailed 112-unit drawings with white die-cut edges. Use from 40px.
- `small/sticker`: separately drawn 56-unit optical masters for 16–39px.
- `large/artwork`, `small/artwork`: the same ink and opaque paper interiors without the outer white edge.
- `large/sprite.svg`, `small/sprite.svg`: artwork symbols named `vf-face-{large|small}-{id}`.
- `catalogue.json`: exact emoji mapping, deck order, descriptions, and editable shape geometry.

192 individual SVG files represent 48 subjects × 2 optical drawings × 2 finishes.
The SVGs have transparent outer backgrounds, explicit white paper, and ink `#171815`.
Interior paper knockouts, including the doughnut centre, remain opaque white.
There are no embedded emoji glyphs, fonts, raster images, remote resources, or filters.
All animals and objects are newly drawn; no Apple or Stink Dings artwork is traced or embedded.

## Code

`@vibefield/design-kit/face-stickers` exports `FaceSticker`, `findFaceSticker`,
`faceStickerSvg`, `FACE_STICKER_IDS`, and `FACE_STICKERS`.

```tsx
import { FaceSticker, findFaceSticker } from '@vibefield/design-kit/face-stickers';
const id = findFaceSticker('🐿️'); // 'chipmunk'; text/emoji variation selectors are ignored
// For a known id, render <FaceSticker name={id} size={24} />.
// In a control already named by text, omit label; standalone images need label.
// Unknown/custom emoji return undefined: keep UserFaceView as the native fallback.
```

`FaceSticker` chooses the small drawing below 40px. `optical="large"` or `"small"`
can force a master for inspection. `finish="artwork"` omits the white cut edge.
Framing, tilt, user uniqueness, and the coin choice belong to the existing account layer;
this leaf supplies artwork and does not write or migrate accounts.

## Rebuild

From the repository root:

```
python3 tooling/face-stickers/generate.py
python3 tooling/face-stickers/generate.py --check
node tooling/face-stickers/build.mjs
```

The generator refuses deck drift: every selected emoji must be represented in exact order.
Original geometry lives in `tooling/face-stickers/art.py`. ZIP entries have deterministic timestamps.
The self-contained HTML and Studio mount the same React catalogue and the same drawings.
