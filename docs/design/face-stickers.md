# FACE CLUB — VibeField / After Hours account faces

The complete 48-emoji account deck has been redrawn in the approved retro sticker direction.
Each subject has an original detailed drawing and a separate simplified drawing: **96 optical
masters**, with sticker and artwork exports for **192 individual SVGs** plus two sprites.

- [Open the interactive report](face-stickers.html)
- [Download all vectors and metadata](vibefield-face-club.zip)
- [See the complete contact sheet](face-stickers-review/all-faces.png)
- [Drawing source](../../tooling/face-stickers/art.py)
- [Shared React leaf](../../packages/design-kit/src/face-stickers/index.tsx)
- [Asset usage and rebuild instructions](../../packages/design-kit/assets/face-stickers/README.md)

## Product reading

The source of truth is the current `FACE_DECK` in `packages/contracts/src/user-face.ts`.
It contains 36 animals, 3 garden subjects, 4 foods, and 5 objects. All 48 are represented in
exact order. DESIGN §2.8 says users are known by form rather than hue; the deck is chosen to
read at 16px, with a sticker by default and a coin as a user choice. The new artwork uses
neutral ink and white paper, distinct silhouettes, and optical simplification for small sizes.

The current `UserFaceView` is used directly for the emoji comparison. The new shared
`FaceSticker` is used in both Studio and the offline report. These are artwork specimens,
not alternate copies of account UI. Account records, validation, deal order, per-user tilt,
custom-emoji entry, and the coin renderer are unchanged. The vector art has not been rolled
out to live account surfaces.

`findFaceSticker` ignores text/emoji variation selectors, matching `faceKey`; both chipmunk
forms map to the same drawing. Unsupported/custom emoji return `undefined`. A later account
integration should keep native rendering for those values and retain the existing frame choice.

## Drawing decisions

Heavy black side planes, paper highlights, uneven contours, comic pupils, and blunt hatching
extend the approved After Hours vocabulary. Stink Dings informed the retro graphic direction;
no reference paths or system emoji assets are traced or embedded. The SVGs contain only original
editable geometry. White interiors are intentional, including the doughnut's paper centre.

The detailed master uses a 112-unit board from 40px. The small master uses a 56-unit board
below 40px, with fewer marks and larger identifying features. The report shows 16, 24, 40,
and 112px on light and dark grounds. This visual proof does not establish recognition accuracy
with users; 16px recognition should be evaluated in the real picker before rollout.

## Every face

| # | Selected emoji | Subject | Sticker title | Drawing idea |
|---|---|---|---|---|
| 01 | 🦊 | [Fox](../../packages/design-kit/assets/face-stickers/large/sticker/fox.svg) | Sly cut | A wedge-shaped fox with a sideways glance, black ear tips, torn cheek fur, and a smile cut out of its muzzle. |
| 02 | 🐙 | [Octopus](../../packages/design-kit/assets/face-stickers/large/sticker/octopus.svg) | Eight track | A bulbous, unimpressed octopus unwinds eight chunky arms. Tiny suckers and a curled lower arm give it the feel of a rubber-hose cartoon. |
| 03 | 🐼 | [Panda](../../packages/design-kit/assets/face-stickers/large/sticker/panda.svg) | Patch work | A panda with oversized vinyl-black ears and mismatched eye patches. One raised brow, one low lid, and a crooked grin break the symmetry. |
| 04 | 🐧 | [Penguin](../../packages/design-kit/assets/face-stickers/large/sticker/penguin.svg) | Tux deluxe | A leaning penguin in an ink-black tuxedo, with flared flippers, big boots, and an off-centre white shirt-front. |
| 05 | 🦉 | [Owl](../../packages/design-kit/assets/face-stickers/large/sticker/owl.svg) | Graveyard shift | A compact owl built from two enormous, unequal eye discs, horn-like feather tufts, and a dense black wing. Its claws curl around a little branch. |
| 06 | 🐢 | [Turtle](../../packages/design-kit/assets/face-stickers/large/sticker/turtle.svg) | Shell service | A low, domed turtle with an architectural shell, a stretchy curious neck, and blunt little feet. The shell is built from bold, irregular panels. |
| 07 | 🦁 | [Lion](../../packages/design-kit/assets/face-stickers/large/sticker/lion.svg) | Mane event | A cut-paper sunburst mane surrounds a long-nosed lion. Muzzle lobes, a theatrical chin, and cut-back eyes give the face a vintage mascot rhythm. |
| 08 | 🐯 | [Tiger](../../packages/design-kit/assets/face-stickers/large/sticker/tiger.svg) | Stripe type | A broad-cheeked tiger with fierce graphic stripes and a cheerful toothy muzzle. The forehead stripes are chunky ink wedges, not fine fur texture. |
| 09 | 🐨 | [Koala](../../packages/design-kit/assets/face-stickers/large/sticker/koala.svg) | Soft static | Huge ragged ears, a drooping pill-shaped nose, and a sleepy side glance. The soft exterior meets hard patches of black fur. |
| 10 | 🐸 | [Frog](../../packages/design-kit/assets/face-stickers/large/sticker/frog.svg) | Pond punk | A gloriously wide frog with pop-up eye towers and an almost ridiculous crescent grin. Warty dots sit against one deep black mouth. |
| 11 | 🦄 | [Unicorn](../../packages/design-kit/assets/face-stickers/large/sticker/unicorn.svg) | Myth fit | A proud side-profile unicorn with a striped horn, swept ink mane, high collar-like jaw, and one half-lidded eye. |
| 12 | 🐝 | [Bee](../../packages/design-kit/assets/face-stickers/large/sticker/bee.svg) | Buzz cut | A striped bean of a bee, buzzing on mismatched wings with a sharp sting and little hooked feet. Oversized eyes lean into its flying direction. |
| 13 | 🐳 | [Spouting whale](../../packages/design-kit/assets/face-stickers/large/sticker/whale.svg) | Big splash | A smiling whale throws a three-way fountain while its raised flukes curl over the body. Long belly grooves and a little fin give the big shape movement. |
| 14 | 🦋 | [Butterfly](../../packages/design-kit/assets/face-stickers/large/sticker/butterfly.svg) | Wing thing | An uneven pair of wings mixes big black tips, paper teardrops, and eyespot-like ovals. The tiny body sports high antennae and a cocked head. |
| 15 | 🐻 | [Bear](../../packages/design-kit/assets/face-stickers/large/sticker/bear.svg) | Bear witness | A broad, inky bear with small round ears, a protruding paper muzzle, and one eyebrow raised. Short fur incisions keep the black mass lively. |
| 16 | 🐰 | [Rabbit](../../packages/design-kit/assets/face-stickers/large/sticker/rabbit.svg) | Long wave | A rabbit whose mismatched ears act like bent aerials. An oversized tooth, diagonal whiskers, and a cheeky side-eye make it feel drawn in ink. |
| 17 | 🦔 | [Hedgehog](../../packages/design-kit/assets/face-stickers/large/sticker/hedgehog.svg) | Prickly print | A scruffy wedge of spines gives way to a long pointed nose and tiny planted feet. Three ranks of cut-paper quills make the back feel wonderfully overbuilt. |
| 18 | 🦜 | [Parrot](../../packages/design-kit/assets/face-stickers/large/sticker/parrot.svg) | Talk shop | A crested parrot perches in profile, with a giant hooked beak, a graphic cheek patch, and an extravagant striped tail. |
| 19 | 🐞 | [Lady beetle](../../packages/design-kit/assets/face-stickers/large/sticker/ladybird.svg) | Spot check | A tilted lady beetle becomes a glossy little print-shop stamp: broad black spots, one divided shell, six bent legs, and a tiny inquisitive head. |
| 20 | 🦩 | [Flamingo](../../packages/design-kit/assets/face-stickers/large/sticker/flamingo.svg) | Leg room | A long S-neck flamingo balances on one leg, with a drooping two-tone beak and a folded wing shaped like a brushstroke. |
| 21 | 🐬 | [Dolphin](../../packages/design-kit/assets/face-stickers/large/sticker/dolphin.svg) | Wave rider | A dolphin curls into a leaping comma. Its long beak, swept dorsal fin, underbelly, and split flukes remain clear inside a bold black silhouette. |
| 22 | 🦖 | [T. rex](../../packages/design-kit/assets/face-stickers/large/sticker/trex.svg) | Tiny arms club | A heavy-jawed dinosaur with a checkerboard grin, tiny reaching arms, a big belly, and an impatient tail. It is all attitude and mismatched proportions. |
| 23 | 🐺 | [Wolf](../../packages/design-kit/assets/face-stickers/large/sticker/wolf.svg) | Moon caller | A narrow, upward-tilted wolf head with tall black ears, a long muzzle, and stepped neck fur. The profile separates it from the front-facing fox. |
| 24 | 🦝 | [Raccoon](../../packages/design-kit/assets/face-stickers/large/sticker/raccoon.svg) | Night bandit | A ragged, wide raccoon face peers through one sweeping black mask. Little pointed ears, white brows, and a dark chin make a very different character from the panda. |
| 25 | 🦦 | [Otter](../../packages/design-kit/assets/face-stickers/large/sticker/otter.svg) | Pocket pebble | A floating otter holds a little stone on its chest, with its feet tilted toward the viewer and its heavy tail curled underneath. A soft muzzle and whiskers keep it otter-like. |
| 26 | 🐌 | [Snail](../../packages/design-kit/assets/face-stickers/large/sticker/snail.svg) | Slow roll | A low-slung snail drags a huge spiral shell, with two stalked eyes, a folded underside, and a smiling shovel-shaped face. |
| 27 | 🦀 | [Crab](../../packages/design-kit/assets/face-stickers/large/sticker/crab.svg) | Claw machine | A squat crab wears its giant claws like boxing gloves. Eight angular leg endings, stalked eyes, and a toothed grin give it a dense, comic silhouette. |
| 28 | 🐡 | [Blowfish](../../packages/design-kit/assets/face-stickers/large/sticker/pufferfish.svg) | Puff piece | A puffed-up spiky globe with a tiny tail, enormous suspicious eyes, and a puckered mouth. Solid fins interrupt the sunburst outline. |
| 29 | 🦭 | [Seal](../../packages/design-kit/assets/face-stickers/large/sticker/seal.svg) | Seal of approval | A whiskered seal props itself up on one paddle while its body flows into a split rear flipper. Long whiskers and a plump white belly keep the form gentle. |
| 30 | 🐿️ | [Chipmunk](../../packages/design-kit/assets/face-stickers/large/sticker/chipmunk.svg) | Cache money | A striped chipmunk curls a huge comma tail around an acorn. Small ears, puffed cheeks, a white racing stripe, and a bent hind foot keep the subject specific. |
| 31 | 🐑 | [Ewe](../../packages/design-kit/assets/face-stickers/large/sticker/sheep.svg) | Wool power | A cloud of uneven wool sits on four ink-black sticks, with a dark drooping face and tiny pointed ears. Spiral curls add a little 1970s print texture. |
| 32 | 🐘 | [Elephant](../../packages/design-kit/assets/face-stickers/large/sticker/elephant.svg) | Heavy thinker | A broad-eared elephant in three-quarter view with a curled trunk, two tiny tusks, and comic forehead wrinkles. The trunk doubles back like a loose cable. |
| 33 | 🦒 | [Giraffe](../../packages/design-kit/assets/face-stickers/large/sticker/giraffe.svg) | Tall tale | A tall giraffe bust with little knobbed horns, wide leaf ears, a long slanted neck, and irregular ink patches. Its muzzle is intentionally oversized. |
| 34 | 🦓 | [Zebra](../../packages/design-kit/assets/face-stickers/large/sticker/zebra.svg) | Off the stripes | A zebra with a stepped punk mane and a long, blunt muzzle. Broad wedges of black stripe bend around the face and long neck. |
| 35 | 🐫 | [Two-hump camel](../../packages/design-kit/assets/face-stickers/large/sticker/camel.svg) | Double hump | A two-humped camel ambles on long bent legs. Its bored face, lumpy humps, and heavy underside make it feel like a character on an old travel decal. |
| 36 | 🦥 | [Sloth](../../packages/design-kit/assets/face-stickers/large/sticker/sloth.svg) | Hang time | A sloth hangs sideways from a crooked branch, with very long hook arms and two dark eye crescents. Its smile is a small interruption in an otherwise lazy pose. |
| 37 | 🌵 | [Cactus](../../packages/design-kit/assets/face-stickers/large/sticker/cactus.svg) | Desert radio | A three-armed cactus in a striped nursery pot, with tiny ink thorns and low-lidded eyes. Its ribs feel like grooves in a vintage plastic toy. |
| 38 | 🍄 | [Mushroom](../../packages/design-kit/assets/face-stickers/large/sticker/mushroom.svg) | Cap culture | A low mushroom cap becomes a checker-spotted umbrella over a stout, eye-bearing stem. A dark gill band gives the cap a strong underside. |
| 39 | 🌻 | [Sunflower](../../packages/design-kit/assets/face-stickers/large/sticker/sunflower.svg) | Sun dial | A heavy, seed-speckled face sits inside a ring of slightly wonky petals. The stalk bends under two bold leaves, like a mascot from a 1970s seed packet. |
| 40 | 🍋 | [Lemon](../../packages/design-kit/assets/face-stickers/large/sticker/lemon.svg) | Sour note | A bumpy, sharply pointed lemon with a leafy quiff and a deeply unimpressed expression. Pith-like hatching gives the rind a printed texture. |
| 41 | 🍉 | [Watermelon](../../packages/design-kit/assets/face-stickers/large/sticker/watermelon.svg) | Seed side | A slanted watermelon wedge wears heavy-rimmed sunglasses. Fat seed teardrops, a generous rind, and a chipped point make it a sticker with a strong triangular read. |
| 42 | 🥑 | [Avocado](../../packages/design-kit/assets/face-stickers/large/sticker/avocado.svg) | Pit stop | A pear-shaped avocado carries a giant pit with a little face inside. A thick rind, one leaf, and subtle off-centre contours make the image feel carved. |
| 43 | 🍩 | [Doughnut](../../packages/design-kit/assets/face-stickers/large/sticker/doughnut.svg) | Hole lotta love | A hefty doughnut with loose dripping icing, crooked sprinkles, and a big central hole. An eye pair above the hole turns the whole ring into a startled face. |
| 44 | 🚀 | [Rocket](../../packages/design-kit/assets/face-stickers/large/sticker/rocket.svg) | Local launch | A riveted, checker-finned rocket tilts into flight. Its porthole becomes an eye, its exhaust a stack of ink-and-paper flames, and its panels feel like old toy metal. |
| 45 | 🎈 | [Balloon](../../packages/design-kit/assets/face-stickers/large/sticker/balloon.svg) | Air head | A single pear-shaped balloon with a defiant face, thick highlight, tied neck, and a long unruly string. The line has the spring of old cartoon motion. |
| 46 | 🪐 | [Ringed planet](../../packages/design-kit/assets/face-stickers/large/sticker/planet.svg) | Ring leader | A tilted ringed planet with a heavy orbit band, zonal ink stripes, sleepy eyes, and a few four-point stars. It feels like a decal from a fictional record shop. |
| 47 | 🌙 | [Crescent moon](../../packages/design-kit/assets/face-stickers/large/sticker/moon.svg) | Late face | A long-nosed crescent moon nods off in profile, with a protruding nose, small grin, crater dots, and stars cut like printer ornaments. |
| 48 | 🧪 | [Test tube](../../packages/design-kit/assets/face-stickers/large/sticker/test-tube.svg) | Strange brew | A tilted laboratory tube bubbles over with an eye-bearing potion. Measurement cuts, a thick glass lip, and blunt liquid bubbles make it a playful bit of bench equipment. |

## Verification

- All 48 emoji match the live deck in exact order; no extras, missing entries, or duplicate keys.
- All 96 drawings pass SVG path-command validation and browser bounds checks including the white cut edge.
- All 192 runtime SVG exports match the packaged SVG geometry; ZIP integrity and all 196 entries checked.
- Known emoji, variation selectors, unknown fallback, the 39/40px optical boundary, and accessible/decorative SVG semantics checked.
- Design-kit TypeScript and a scoped TypeScript check of all new catalogue components passed.
- The 13 UI ownership tests passed. The full Studio build passed, with its existing large-chunk warning. The refreshed local Studio was also checked in Chrome: all 48 shared specimens render.
- Eight owned TypeScript/CSS/build files pass Biome.
- Browser: all category counts, name/emoji search, empty state and reset, selection, both optical masters and both finishes, source, copy success/denial fallback, and individual/ZIP downloads passed.
- Light/dark, keyboard activation, reduced motion, and 320/390/768/1024/1440px layouts checked; no horizontal or component overflow.
- Offline HTML: all 48 comparisons are pre-rendered, with no external requests or runtime/hydration errors during the interaction checks.

Review evidence lives in `face-stickers-review/`. The account policy and original face component
and stylesheet were verified byte-for-byte against the pre-task snapshot.
