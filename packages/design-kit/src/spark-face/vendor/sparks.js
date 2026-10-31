/* Sparklings v2: glow-spark avatars for agents.
   Every avatar is one row of 32 RGBA32F texels; one instanced draw renders body, face, accessory, props, ring and badge.
   The CPU side runs the status state machine (springs, blinks, gaze, motion) and rewrites the rows each frame. */
(() => {
  'use strict';
  const TAU = Math.PI * 2;
  const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const angDist = (a, b) => Math.abs(((((a - b) % TAU) + TAU + Math.PI) % TAU) - Math.PI);
  const nearestPoint = (pts, target) => { let best = 0, bd = 9; pts.forEach((p, i) => { const d = angDist(p[0], target); if (d < bd) { bd = d; best = i; } }); return best; };

  // c: [flat body, glow centre, glow mid, glow rim, aura, frost tint, prop ink, blush]
  // sky: frosted backdrop (top, bottom). deep: glow backdrop (top, bottom).
  const PALETTES = [
    { name: 'Periwinkle', src: 'Ref 1', c: ['#5468ff', '#3f6ff7', '#7fb4fc', '#eef4ff', '#a9a4ff', '#c9d3ff', '#6c7bff', '#ff8fc8'], sky: ['#4a52e0', '#9aa6ff'], deep: ['#2433b8', '#3f6ff7'] },
    { name: 'Eclipse', src: 'Ref 3', c: ['#1b1636', '#170f3a', '#fd307f', '#ffe1ee', '#16e9de', '#ffd3e6', '#ff4f9a', '#ff5c9a'], sky: ['#2a1859', '#8a3aa8'], deep: ['#0c0928', '#24124f'] },
    { name: 'Mint Kiss', src: 'Ref 2', c: ['#2fd28a', '#1fc47d', '#8ef0bd', '#f3fff8', '#f68ce1', '#c9f6df', '#16b874', '#ff8cc6'], sky: ['#12a56a', '#7be9b5'], deep: ['#0b9a60', '#1fc47d'] },
    { name: 'Lagoon', src: 'Refs 8, 9', c: ['#1688ff', '#00a8f8', '#49cdfe', '#e7f8ff', '#6fd6ff', '#a8daf8', '#1a9bff', '#ff9ec4'], sky: ['#2073e9', '#4bc8f6'], deep: ['#0090ec', '#01b2fe'] },
    { name: 'Ember', src: 'Ref 2', c: ['#e0157e', '#b302ad', '#fc495c', '#ffe6dc', '#ff7a9a', '#ffc9dd', '#ff3f78', '#ffb0a0'], sky: ['#8502bf', '#fc5a6a'], deep: ['#68019a', '#b302ad'] },
    { name: 'Sorbet', src: 'Ref 2', c: ['#ff6f7d', '#f84a9e', '#ffa384', '#fff1ea', '#ff9a7a', '#ffd6dc', '#ff5a86', '#ff6f91'], sky: ['#ef4d98', '#ffad8c'], deep: ['#de3584', '#f84a9e'] },
    { name: 'Lilac Cream', src: 'Ref 2', c: ['#a07be6', '#8e62dc', '#d6b6ea', '#fffbef', '#c7a2f7', '#ece3ff', '#9a6be6', '#ff9fd0'], sky: ['#8a5fd8', '#e4c8ea'], deep: ['#6f46c2', '#8e62dc'] },
    { name: 'Citrine', src: 'Ref 2', c: ['#ff7a1f', '#f0602a', '#f9c46b', '#fff6d8', '#ffab4a', '#ffe3bf', '#ff7a1f', '#ff8f8f'], sky: ['#ec5a2a', '#f8c56e'], deep: ['#d44a1a', '#f0602a'] },
    { name: 'Aurora', src: 'Ref 2', c: ['#1fc49b', '#16b88d', '#9df5a0', '#f8ffdc', '#b4f26e', '#d2f9e5', '#13b088', '#ff9fb8'], sky: ['#0f9c7c', '#7fe8b3'], deep: ['#0a8c6d', '#16b88d'] },
    { name: 'Orchid', src: 'Ref 2', c: ['#b65ad6', '#a24ccc', '#df9ff2', '#fbefff', '#9ae8a9', '#f1dcff', '#b552e0', '#ff9fd8'], sky: ['#8936b4', '#d690f0'], deep: ['#7a2fa3', '#a24ccc'] },
    { name: 'Nebula', src: 'Ref 2', c: ['#6c78ec', '#5f55e2', '#a48ff0', '#f2eeff', '#f2a6ff', '#dedcff', '#7470f0', '#ff9fe0'], sky: ['#4a44d4', '#aaa4f6'], deep: ['#3d36c4', '#5f55e2'] },
    { name: 'Rose Noir', src: 'Ref 2', c: ['#d4245c', '#2a0718', '#e8174f', '#ffd9e3', '#ff4f7a', '#ffd3df', '#ff3f6f', '#ff7aa0'], sky: ['#3d0a26', '#b8174c'], deep: ['#1a0612', '#4a0d2c'] },
    { name: 'Cocoa', src: 'Ref 7', c: ['#93643a', '#8a5530', '#d9a06a', '#fff1df', '#f0b47c', '#f3ddc6', '#b9733f', '#ff9a8a'], sky: ['#76482a', '#c98f5c'], deep: ['#5f3a1f', '#8a5530'] },
    { name: 'Pebble', src: 'Ref 7', c: ['#7c7f8e', '#5d6075', '#b7bccd', '#f6f8ff', '#c9d1ff', '#e4e8f2', '#8a8fa6', '#ffa6c1'], sky: ['#565a70', '#b3b8cb'], deep: ['#40435a', '#5d6075'] },
  ];
  const STYLES = ['Flat', 'Frosted', 'Glow'];
  const GLYPH = { pill: 0, star: 1, heart: 2, x: 3, spiral: 4, chevron: 5, ring: 6 };
  const MOUTH = { none: 0, smile: 1, open: 2, o: 3, flat: 4, frown: 5, wavy: 6, cat: 7, smirk: 8, tongue: 9 };
  const PROP = { none: 0, hearts: 1, zzz: 2, sparkles: 3, anger: 4, question: 5, exclaim: 6, dizzy: 7, thought: 8, check: 9, cross: 10, code: 11, progress: 12, bug: 13, lock: 14, hourglass: 15, notes: 16, confetti: 17 };
  const ACC = { none: 0, sunglasses: 1, laptop: 2, magnifier: 3, glasses: 4, headphones: 5, coffee: 6, clipboard: 7, nightcap: 8 };
  const BADGE = { none: 0, check: 1, cross: 2, question: 3, lock: 4, up: 5, heart: 6, moon: 7, hourglass: 8, exclaim: 9 };
  const RING = { none: 0, spin: 1, pulse: 2 };

  // Emotion recipes. Values are targets the springs chase; anything left out falls back to the character.
  const EMOTIONS = [
    { id: 'calm', name: 'Calm', eyes: 'Resting eyes', body: 'Slow float', r: { motion: 'float' } },
    { id: 'happy', name: 'Happy', eyes: 'Smiling crescents', body: 'Points perk, little hops', r: { lowLid: .82, eyeWm: 1.12, mouth: 'smile', blush: .35, perk: .45, wiggleAmp: .05, wiggleFreq: 4.5, stretch: 1.04, soft: .3, glow: 1.12, motion: 'hop', prop: 'sparkles', propAmt: .45 } },
    { id: 'starstruck', name: 'Starstruck', eyes: 'Star eyes', body: 'Points stretch and wag', r: { glyph: 'star', eyeScale: 1.22, mouth: 'open', mouthSize: 1.05, mouthOpen: .8, blush: .3, perk: .8, stretch: 1.16, wiggleAmp: .1, wiggleFreq: 9, glow: 1.35, motion: 'bounce', prop: 'sparkles', propAmt: 1, blink: [4, 7] } },
    { id: 'love', name: 'Love', eyes: 'Heart eyes, blush', body: 'Heartbeat pulse', r: { glyph: 'heart', eyeScale: 1.18, mouth: 'smile', mouthSize: .8, blush: .9, soft: .6, perk: .15, motion: 'pulse', prop: 'hearts', propAmt: 1, tint: [1, .42, .68, .35], glow: 1.15, blink: [4, 7] } },
    { id: 'laugh', name: 'Laugh', eyes: 'Squeezed > <', body: 'Giggle shake', r: { glyph: 'chevron', mouth: 'open', mouthSize: 1.2, mouthOpen: 1, blush: .45, perk: .55, wiggleAmp: .09, wiggleFreq: 14, motion: 'giggle', glow: 1.15, blink: [99, 99] } },
    { id: 'shy', name: 'Shy', eyes: 'Lowered, looks away', body: 'Points curl in', r: { eyeScale: .9, lookX: -.55, lookY: -.6, lidY: .74, mouth: 'wavy', mouthSize: .65, blush: 1, curl: .35, stretch: .9, scale: .95, motion: 'sway', avoid: 1, blink: [1.2, 2.6] } },
    { id: 'sleepy', name: 'Sleepy', eyes: 'Heavy lids that nod', body: 'Points droop', r: { lidY: 0, lidAng: 0, mouth: 'o', mouthSize: .5, mouthOpen: .15, droop: .55, soft: .5, stretch: .92, glow: .72, motion: 'doze', prop: 'zzz', propAmt: 1, blink: [99, 99] } },
    { id: 'sad', name: 'Sad', eyes: 'Worried, looks down', body: 'Droops and sinks', r: { lidAng: -.5, lidY: .55, lookY: -.5, mouth: 'frown', mouthSize: .8, droop: .5, stretch: .94, glow: .8, tint: [.45, .62, 1, .3], motion: 'sink', tears: .35 } },
    { id: 'cry', name: 'Cry', eyes: 'Squeezed, streaming', body: 'Sobbing hiccups', r: { lidAng: -.55, lidY: .3, lowLid: .35, mouth: 'o', mouthSize: 1.15, mouthOpen: 1, tears: 1, droop: .6, glow: .8, tint: [.45, .62, 1, .35], motion: 'sob', blink: [99, 99] } },
    { id: 'angry', name: 'Angry', eyes: 'Lids slant inward', body: 'Sharp points, hot rim', r: { lidAng: .62, lidY: .42, eyeWm: 1.12, mouth: 'frown', mouthSize: .7, sharp: .85, stretch: 1.06, tint: [1, .23, .3, .55], glow: 1.2, motion: 'fume', prop: 'anger', propAmt: 1 } },
    { id: 'surprised', name: 'Surprised', eyes: 'Wide round eyes', body: 'Points shoot out, jump', r: { eyeScale: 1.12, eyeWm: 1.4, eyeHm: .95, lidY: 1, lidAng: 0, mouth: 'o', mouthSize: .8, mouthOpen: .6, stretch: 1.24, perk: .3, motion: 'jump', prop: 'exclaim', propAmt: 1, blink: [3, 5] } },
    { id: 'scared', name: 'Scared', eyes: 'Tiny pupils, darting', body: 'Shrinks and shivers', r: { eyeScale: .62, eyeWm: 1.5, lidAng: -.3, lidY: 1, mouth: 'wavy', mouthSize: .75, sweat: 1, curl: .45, stretch: .82, scale: .9, glow: .85, motion: 'shiver', fastEyes: 1, blink: [.5, 1.2] } },
    { id: 'confused', name: 'Confused', eyes: 'One big, one squint', body: 'Head tilts', r: { scaleL: 1.15, scaleR: .82, offYL: .03, offYR: -.02, lidYR: .35, lookX: .35, lookY: .45, mouth: 'flat', mouthSize: .6, motion: 'tilt', prop: 'question', propAmt: 1 } },
    { id: 'dizzy', name: 'Dizzy', eyes: 'Spinning spirals', body: 'Floppy wobble', r: { glyph: 'spiral', eyeScale: 1.15, mouth: 'wavy', mouthSize: .8, droop: .35, wiggleAmp: .14, wiggleFreq: 3, motion: 'wobble', prop: 'dizzy', propAmt: 1, spin: -4.5, blink: [99, 99] } },
    { id: 'smug', name: 'Smug', eyes: 'Half-lidded side glance', body: 'Leans back', r: { lidY: .12, lidAng: 0, lookX: .6, lookY: .05, mouth: 'cat', mouthSize: .85, perk: .2, motion: 'lean' } },
    { id: 'wink', name: 'Wink', eyes: 'One closed crescent', body: 'Quick hop', r: { lowLidL: .95, lidYL: .9, eyeWm: 1.05, mouth: 'smile', blush: .4, motion: 'hopOnce', prop: 'sparkles', propAmt: .35 } },
  ];
  // Agent statuses. r is shared by both sets; m adds the mouth set's mouths, b tunes the mouthless set.
  // gaze: scan | read | orbit | bug | composer | fixed | user | none (default: idle saccades, follows the pointer)
  const STATUSES = [
    { id: 'ready', group: 'Presence', name: 'Ready', fires: 'Idle, waiting for a task', look: 'Calm float, looks around',
      r: { motion: 'float' }, m: { mouth: 'smile', mouthSize: .55 }, b: {} },
    { id: 'listening', group: 'Presence', name: 'Listening', fires: 'You start typing', look: 'Wide eyes, leans in',
      r: { eyeScale: 1.1, eyeHm: 1.04, perk: .3, stretch: 1.03, glow: 1.08, motion: 'nod', gaze: 'composer', blink: [3, 6] }, m: { mouth: 'smile', mouthSize: .62 }, b: { eyeScale: 1.16 } },
    { id: 'sleeping', group: 'Presence', name: 'Sleeping', fires: 'Paused or off-hours', look: 'Nightcap, eyes shut, Zzz',
      r: { lidY: -.5, droop: .5, soft: .5, stretch: .93, glow: .62, motion: 'doze', prop: 'zzz', acc: 'nightcap', gaze: 'none', blink: [99, 99], badge: 'moon' }, m: { mouth: 'o', mouthSize: .42, mouthOpen: .1 }, b: {} },
    { id: 'offline', group: 'Presence', name: 'Offline', fires: 'Connection lost', look: 'Grey and dim, flat lids',
      r: { lidY: .14, droop: .25, stretch: .95, glow: .2, desat: .9, lookY: -.3, motion: 'still', gaze: 'none', blink: [6, 10] }, m: { mouth: 'flat', mouthSize: .45 }, b: { lidY: .08 } },
    { id: 'thinking', group: 'Thinking', name: 'Thinking', fires: 'Reasoning between steps', look: 'Eyes drift up, thought dots',
      r: { lookX: -.5, lookY: .7, lidY: .92, lidYR: .72, curl: .12, motion: 'ponder', prop: 'thought', gaze: 'fixed', blink: [3, 6], ring: 'spin' }, m: { mouth: 'smirk', mouthSize: .55 }, b: { scaleR: .9 } },
    { id: 'planning', group: 'Thinking', name: 'Planning', fires: 'Writing a plan or to-do list', look: 'Clipboard, ticks items off',
      r: { acc: 'clipboard', lookX: .5, lookY: -.55, lidY: .85, motion: 'bob', gaze: 'fixed', ring: 'spin' }, m: { mouth: 'smile', mouthSize: .45 }, b: {} },
    { id: 'searching', group: 'Thinking', name: 'Searching', fires: 'Grep, file reads, web search', look: 'Magnifier, scanning',
      r: { acc: 'magnifier', eyeScale: 1.04, motion: 'scan', gaze: 'scan', ring: 'spin' }, m: { mouth: 'o', mouthSize: .45, mouthOpen: .2 }, b: {} },
    { id: 'reviewing', group: 'Thinking', name: 'Reviewing', fires: 'Reading a diff or PR', look: 'Reading glasses, line by line',
      r: { acc: 'glasses', lidY: .82, motion: 'still', gaze: 'read', ring: 'spin' }, m: { mouth: 'flat', mouthSize: .42 }, b: { lidAng: .12 } },
    { id: 'coding', group: 'Working', name: 'Coding', fires: 'Editing files', look: 'Laptop, focused, code pops up',
      r: { acc: 'laptop', lookY: -.75, lidY: .68, faceY: .07, wiggleAmp: .025, wiggleFreq: 12, glow: 1.1, motion: 'type', prop: 'code', gaze: 'fixed', blink: [3, 6], ring: 'spin' }, m: { mouth: 'tongue', mouthSize: .6 }, b: { lidY: .6 } },
    { id: 'running', group: 'Working', name: 'Running', fires: 'Tests, builds, commands', look: 'Eyes follow the progress ring',
      r: { eyeScale: 1.08, perk: .2, motion: 'antic', prop: 'progress', gaze: 'orbit', blink: [3, 6], ring: 'spin' }, m: { mouth: 'o', mouthSize: .45, mouthOpen: .4 }, b: { eyeScale: 1.14 } },
    { id: 'debugging', group: 'Working', name: 'Debugging', fires: 'Fixing a failure', look: 'Narrowed eyes chase a bug',
      r: { lidAng: .32, lidY: .62, eyeWm: 1.05, sharp: .25, sweat: .8, motion: 'tense', prop: 'bug', gaze: 'bug', ring: 'spin' }, m: { mouth: 'flat', mouthSize: .5 }, b: { lidAng: .42 } },
    { id: 'focus', group: 'Working', name: 'Deep focus', fires: 'A long run on its own', look: 'Headphones, eyes closed, grooving',
      r: { acc: 'headphones', lowLid: .9, lidY: .9, glow: 1.05, motion: 'groove', prop: 'notes', gaze: 'none', blink: [99, 99], ring: 'spin' }, m: { mouth: 'smile', mouthSize: .55 }, b: {} },
    { id: 'asking', group: 'Needs you', name: 'Asking', fires: 'Has a question for you', look: 'Waves, tilts, a question mark',
      r: { eyeScale: 1.14, eyeHm: 1.06, perk: .35, wave: 1, motion: 'tilt', prop: 'question', gaze: 'user', badge: 'question', ring: 'pulse' }, m: { mouth: 'o', mouthSize: .5, mouthOpen: .3 }, b: { eyeScale: 1.2, offYL: .025 } },
    { id: 'approval', group: 'Needs you', name: 'Approval', fires: 'Needs permission to run or push', look: 'Pleading eyes, padlock',
      r: { eyeScale: 1.2, eyeWm: 1.12, lidAng: -.22, wave: .7, blush: .25, motion: 'sway', prop: 'lock', gaze: 'user', badge: 'lock', ring: 'pulse' }, m: { mouth: 'smile', mouthSize: .5 }, b: { eyeScale: 1.28 } },
    { id: 'stuck', group: 'Needs you', name: 'Stuck', fires: 'Looping or out of context', look: 'Spiral eyes, wobbles',
      r: { glyph: 'spiral', eyeScale: 1.12, droop: .3, wiggleAmp: .12, wiggleFreq: 3, spin: -4.5, motion: 'wobble', prop: 'dizzy', blink: [99, 99], badge: 'exclaim', ring: 'pulse' }, m: { mouth: 'wavy', mouthSize: .75 }, b: {} },
    { id: 'limited', group: 'Needs you', name: 'Rate limited', fires: 'Hit a limit, queued', look: 'Coffee break, hourglass',
      r: { acc: 'coffee', lidY: .42, lookX: .5, lookY: -.35, droop: .15, glow: .9, motion: 'sip', prop: 'hourglass', gaze: 'fixed', badge: 'hourglass' }, m: { mouth: 'flat', mouthSize: .45 }, b: { lidY: .36 } },
    { id: 'success', group: 'Outcomes', name: 'Success', fires: 'Task done, tests pass', look: 'Crescent eyes, a check, a hop',
      r: { lowLid: .85, eyeWm: 1.12, perk: .5, stretch: 1.06, wiggleAmp: .05, wiggleFreq: 5, glow: 1.2, blush: .3, motion: 'hop', prop: 'check', badge: 'check' }, m: { mouth: 'open', mouthSize: .95, mouthOpen: .8 }, b: { lowLid: .92 } },
    { id: 'shipped', group: 'Outcomes', name: 'Shipped', fires: 'Pushed, merged or deployed', look: 'Sunglasses, confetti',
      r: { acc: 'sunglasses', perk: .45, stretch: 1.05, glow: 1.3, motion: 'cool', prop: 'confetti', badge: 'up' }, m: { mouth: 'cat', mouthSize: .85 }, b: {} },
    { id: 'failed', group: 'Outcomes', name: 'Failed', fires: 'Error or failing tests', look: 'Worried, red, a tear',
      r: { lidAng: -.5, lidY: .55, lookY: -.4, droop: .45, stretch: .94, glow: .85, tint: [1, .3, .38, .4], tears: .35, motion: 'sink', prop: 'cross', badge: 'cross' }, m: { mouth: 'frown', mouthSize: .8 }, b: { tears: .55, lidAng: -.56 } },
    { id: 'thanked', group: 'Outcomes', name: 'Thanked', fires: 'You say thanks', look: 'Heart eyes, blush',
      r: { glyph: 'heart', eyeScale: 1.18, blush: .9, soft: .6, perk: .15, tint: [1, .42, .68, .3], glow: 1.15, motion: 'pulse', prop: 'hearts', blink: [4, 7], badge: 'heart' }, m: { mouth: 'smile', mouthSize: .8 }, b: {} },
    { id: 'hello', group: 'Hatch', name: 'Hello', fires: 'Just hatched', look: 'Waves hello',
      r: { lowLid: .7, eyeWm: 1.08, perk: .45, wave: 1, blush: .35, glow: 1.2, motion: 'hop', prop: 'sparkles', propAmt: .7 }, m: { mouth: 'open', mouthSize: .85, mouthOpen: .7 }, b: { lowLid: .85 } },
  ];
  const ALL = Object.fromEntries([...EMOTIONS, ...STATUSES].map((e) => [e.id, e]));
  const EMO = ALL;
  function recipe(e, mouthSet) {
    if (mouthSet) return e._m || (e._m = Object.assign({}, e.r, e.m));
    return e._b || (e._b = Object.assign({}, e.r, e.b, { mouth: 'none' }));
  }

  // The cast: hand-tuned seeds and traits so each character reads at a glance.
  const CAST = [
    { id: 'pip', name: 'Pip', trait: 'Curious', blurb: 'Upbeat and curious. The classic five-point star.', palette: 0, rest: 'calm',
      body: { seed: 11, n: 5, core: .64, reach: .93, hw: .5, tip: .44, k: .15, jitter: .12, rot: Math.PI / 2, hero: -1, stub: -1 }, eyes: { gap: .38, y: -.02, w: .1, h: .21, shape: 0 } },
    { id: 'mochi', name: 'Mochi', trait: 'Sleepy', blurb: 'Soft and drowsy. Seven round nubs, tiny eyes set low.', palette: 6, rest: 'sleepy',
      body: { seed: 27, n: 7, core: .68, reach: .88, hw: .44, tip: .62, k: .2, jitter: .25, hero: -1, stub: -1 }, eyes: { gap: .44, y: -.1, w: .085, h: .1, shape: 1 } },
    { id: 'zippy', name: 'Zippy', trait: 'Hyper', blurb: 'Bouncy and loud. Six long points, big oval eyes.', palette: 7, rest: 'happy',
      body: { seed: 41, n: 6, core: .56, reach: 1.08, hw: .42, tip: .38, k: .12, jitter: .3, hero: 0, heroLen: 1.12, stub: -1 }, eyes: { gap: .36, y: .06, w: .12, h: .21, shape: 1 } },
    { id: 'nova', name: 'Nova', trait: 'Cool', blurb: 'Cool, a bit smug. One tall cowlick point.', palette: 1, rest: 'smug',
      body: { seed: 58, n: 5, core: .6, reach: .98, hw: .46, tip: .42, k: .15, jitter: .15, rot: Math.PI / 2, hero: 0, heroLen: 1.32, heroBend: .3, stub: -1 }, eyes: { gap: .4, y: -.02, w: .105, h: .19 } },
    { id: 'puff', name: 'Puff', trait: 'Gentle', blurb: 'A cloud of a star. Eight short puffs, frosted like Ref 8.', palette: 3, rest: 'calm', style: 1,
      body: { seed: 73, n: 8, core: .7, reach: .86, hw: .46, tip: .78, k: .22, jitter: .2, hero: -1, stub: -1 }, eyes: { gap: .36, y: -.02, w: .095, h: .19, shape: 0 } },
    { id: 'bean', name: 'Bean', trait: 'Baby', blurb: 'The baby. A four-point sparkle, big eyes set low.', palette: 5, rest: 'calm',
      body: { seed: 88, n: 4, core: .6, reach: 1, hw: .52, tip: .4, k: .16, jitter: .04, rot: Math.PI / 2, hero: -1, stub: -1 }, eyes: { gap: .34, y: -.1, w: .125, h: .22, shape: 1 } },
    { id: 'fizz', name: 'Fizz', trait: 'Cheeky', blurb: 'Lopsided and cheeky. Winks at everyone.', palette: 8, rest: 'wink',
      body: { seed: 102, n: 6, core: .6, reach: 1, hw: .45, tip: .42, k: .14, jitter: .45, hero: -1, stub: 2 }, eyes: { gap: .38, y: -.01, w: .1, h: .2 } },
    { id: 'luma', name: 'Luma', trait: 'Dreamy', blurb: 'Dreamy and slow. Slender points, eyes half closed.', palette: 10, rest: 'calm',
      body: { seed: 120, n: 7, core: .58, reach: 1.06, hw: .38, tip: .36, k: .12, jitter: .15, hero: -1, stub: -1 }, eyes: { gap: .4, y: -.01, w: .1, h: .18, lidY: .3, shape: 1 } },
    { id: 'blaze', name: 'Blaze', trait: 'Fiery', blurb: 'Fiery and determined. Sharper tips, narrowed eyes at rest.', palette: 4, rest: 'calm',
      body: { seed: 137, n: 5, core: .6, reach: 1.04, hw: .46, tip: .3, k: .11, jitter: .2, hero: -1, stub: -1 }, eyes: { gap: .4, y: 0, w: .11, h: .19, lidY: .5, lidAng: .32 } },
    { id: 'dew', name: 'Dew', trait: 'Shy', blurb: 'Shy and sweet. Blushes and looks away when watched.', palette: 2, rest: 'shy',
      body: { seed: 151, n: 6, core: .62, reach: .96, hw: .46, tip: .5, k: .17, jitter: .2, hero: -1, stub: -1 }, eyes: { gap: .36, y: -.05, w: .095, h: .18 } },
    { id: 'cocoa', name: 'Cocoa', trait: 'Easygoing', blurb: 'Chunky and easygoing. Small tilted eyes glance sideways.', palette: 12, rest: 'calm',
      body: { seed: 166, n: 5, core: .62, reach: .98, hw: .52, tip: .52, k: .18, jitter: .55, rot: 1.2, hero: -1, stub: -1 }, eyes: { gap: .32, y: 0, w: .075, h: .16, tilt: -.45, look: [.45, -.05] } },
    { id: 'pebble', name: 'Pebble', trait: 'Quiet', blurb: 'Quiet and moon-grey. Tilted eyes that gaze upward.', palette: 13, rest: 'calm',
      body: { seed: 181, n: 6, core: .64, reach: .95, hw: .46, tip: .5, k: .17, jitter: .25, hero: -1, stub: -1 }, eyes: { gap: .34, y: .04, w: .085, h: .19, tilt: -.38, look: [-.35, .3] } },
  ];
  const CAST_BY_ID = Object.fromEntries(CAST.map((c) => [c.id, c]));

  function makeBody(seed, tr = {}) {
    const r = mulberry32(seed * 13 + 5);
    const n = tr.n ?? [4, 5, 5, 6, 6, 7, 8][Math.floor(r() * 7)];
    const core = tr.core ?? .58 + r() * .08;
    const reach = tr.reach ?? .9 + r() * .1;
    const hw = (tr.hw ?? .42 + r() * .1) * Math.sqrt(5 / n);
    const tip = tr.tip ?? .38 + r() * .14;
    const k = tr.k ?? .12 + r() * .06;
    const jit = tr.jitter ?? .2 + r() * .3;
    const base = tr.rot ?? Math.PI / 2 + (r() - .5) * .7;
    const hero = tr.hero ?? (r() < .35 ? Math.floor(r() * n) : -1);
    const stub = tr.stub ?? (r() < .3 ? Math.floor(r() * n) : -1);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const ang = base + (i + (r() - .5) * jit) * TAU / n;
      let L = reach * (.92 + r() * .16), w = hw * (.9 + r() * .2), bend = (r() - .5) * .18;
      if (i === hero) { L *= tr.heroLen ?? 1.2; w *= 1.04; bend += (tr.heroBend ?? .22) * (r() < .5 ? -1 : 1); }
      if (i === stub && i !== hero) { L *= .8; w *= .86; }
      pts.push([ang, L, w, bend]);
    }
    return { n, core, k, tip, pts };
  }

  function makeEyes(seed, tr = {}) {
    const r = mulberry32(seed * 7 + 3);
    const big = r();
    const e = { gap: .34 + r() * .1, y: -.07 + r() * .1, w: .085 + big * .035, h: .17 + big * .06, shape: r() < .6 ? 0 : r() < .75 ? 1 : 2,
      tilt: r() < .3 ? (r() - .5) * .8 : 0, lidY: 1, lidAng: 0, look: [0, 0] };
    Object.assign(e, tr);
    e.mouthY = tr.mouthY ?? -(e.h * .85 + .07);
    return e;
  }
  // Agent sparks: a curated slice of the DNA space (5-7 even points, low jitter, rare short hero), so every hatch is cute.
  function agentDNA(seed) {
    const r = mulberry32(seed * 31 + 17);
    const n = [5, 5, 5, 6, 6, 7][Math.floor(r() * 6)];
    const body = { n, core: .6 + r() * .06, reach: .9 + r() * .1, hw: .44 + r() * .08, tip: .4 + r() * .16, k: .12 + r() * .06,
      jitter: .04 + r() * .18, rot: Math.PI / 2 + (r() - .5) * .3, hero: r() < .22 ? Math.floor(r() * n) : -1, heroLen: 1.08 + r() * .08, heroBend: .14, stub: -1 };
    const big = r();
    const eyes = { gap: .34 + r() * .08, y: -.06 + r() * .08, w: .088 + big * .03, h: .17 + big * .05, shape: r() < .7 ? 0 : 1, tilt: r() < .12 ? (r() - .5) * .5 : 0 };
    return { seed, palette: Math.floor(r() * 12), body, eyes };
  }
  const hashId = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 999983 + 1; };

  // ---------------------------------------------------------------- shaders
  const VS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uData; uniform vec2 uView;
out vec2 vP; flat out int vId;
void main(){
  int id = gl_InstanceID;
  vec4 d0 = texelFetch(uData, ivec2(0, id), 0), d1 = texelFetch(uData, ivec2(1, id), 0);
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2. - 1.;
  vP = c * d1.w; vId = id;
  vec2 pos = d0.xy + vec2(c.x, -c.y) * d1.w * d0.z;
  gl_Position = d0.z > 0. ? vec4(pos.x / uView.x * 2. - 1., 1. - pos.y / uView.y * 2., 0., 1.) : vec4(2., 2., 2., 1.);
}`;

  const FS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uData; uniform float uTime, uDpr, uShadow; uniform vec2 uView; uniform vec3 uCut; uniform vec3 uPal[${PALETTES.length * 8}]; uniform vec3 uDeep[${PALETTES.length * 2}];
in vec2 vP; flat in int vId; out vec4 frag;
#define D(i) texelFetch(uData, ivec2(i, vId), 0)
const float PI = 3.14159265, TAU = 6.2831853;
float px; int pb;
float h11(float n){ return fract(sin(n * 91.345 + 47.853) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h11(i.x + i.y * 57.), h11(i.x + 1. + i.y * 57.), f.x), mix(h11(i.x + (i.y + 1.) * 57.), h11(i.x + 1. + (i.y + 1.) * 57.), f.x), f.y); }
float fbm(vec2 p){ return .55 * vn(p) + .3 * vn(p * 2.03 + 3.7) + .15 * vn(p * 4.1 + 9.2); }
vec2 rot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
float smin(float a, float b, float k){ float h = max(k - abs(a - b), 0.) / k; return min(a, b) - h * h * k * .25; }
float cov(float d){ return clamp(.5 - d / px, 0., 1.); }
vec4 over(vec4 a, vec4 b){ return a + b * (1. - a.a); }
vec3 PAL(int k){ return uPal[pb + k]; }
float dot2(vec2 v){ return dot(v, v); }
float sdUC(vec2 p, float r1, float r2, float h){
  p.x = abs(p.x); float b = (r1 - r2) / h, a = sqrt(max(1. - b * b, 0.)), k = dot(p, vec2(-b, a));
  if (k < 0.) return length(p) - r1;
  if (k > a * h) return length(p - vec2(0., h)) - r2;
  return dot(p, vec2(a, b)) - r1; }
float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0., 1.)); }
float sdRBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
float sdEll(vec2 p, vec2 ab){ return (length(p / ab) - 1.) * min(ab.x, ab.y); }
float sdStar(vec2 p, float r, float n, float m){
  float an = PI / n, en = PI / m; vec2 acs = vec2(cos(an), sin(an)), ecs = vec2(cos(en), sin(en));
  float bn = mod(atan(p.x, p.y), 2. * an) - an; p = length(p) * vec2(cos(bn), abs(sin(bn)));
  p -= r * acs; p += ecs * clamp(-dot(p, ecs), 0., r * acs.y / ecs.y); return length(p) * sign(p.x); }
float sdHeart(vec2 p){ p.x = abs(p.x);
  if (p.y + p.x > 1.) return sqrt(dot2(p - vec2(.25, .75))) - sqrt(2.) / 4.;
  return sqrt(min(dot2(p - vec2(0., 1.)), dot2(p - .5 * max(p.x + p.y, 0.)))) * sign(p.x - p.y); }
float sdArc(vec2 p, float ap, float ra, float rb){ vec2 sc = vec2(sin(ap), cos(ap)); p.x = abs(p.x);
  return ((sc.y * p.x > sc.x * p.y) ? length(p - sc * ra) : abs(length(p) - ra)) - rb; }
float sdDrop(vec2 p, float r){ return sdUC(p, r, r * .1, r * 1.65); }
float sdSquircle(vec2 p, float r){ vec2 q = abs(p) / r; return (pow(pow(q.x, 4.) + pow(q.y, 4.), .25) - 1.) * r * .92; }
float lum(vec3 c){ return dot(c, vec3(.3, .59, .11)); }
float sdTri(vec2 p, vec2 p0, vec2 p1, vec2 p2){
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2, v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0., 1.), pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0., 1.), pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0., 1.);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))), vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
float sdTC(vec2 p, vec2 a, vec2 b, float ra, float rb){
  vec2 ba = b - a; float l = max(length(ba), 1e-4); vec2 d = ba / l, q = p - a;
  return sdUC(vec2(dot(q, vec2(d.y, -d.x)), dot(q, d)), ra, rb, max(l, ra - rb + .002));
}
// icon marks in unit space, about [-.6, .6]
float qMark(vec2 a){ return min(min(sdArc(rot(a - vec2(0., .42), .55), 2.05, .4, .13), sdSeg(a, vec2(.02, .04), vec2(0., -.26)) - .13), length(a - vec2(0., -.66)) - .15); }
float xMark(vec2 a){ return min(sdSeg(a, vec2(-.42), vec2(.42)), sdSeg(a, vec2(-.42, .42), vec2(.42, -.42))) - .14; }
float vMark(vec2 a){ return min(sdSeg(a, vec2(-.46, .02), vec2(-.14, -.32)), sdSeg(a, vec2(-.14, -.32), vec2(.48, .34))) - .14; }
float exMark(vec2 a){ return min(sdSeg(a, vec2(0., -.08), vec2(0., .55)) - .15, length(a - vec2(0., -.5)) - .16); }
float upMark(vec2 a){ return min(sdSeg(a, vec2(0., -.48), vec2(0., .44)), min(sdSeg(a, vec2(-.34, .12), vec2(0., .46)), sdSeg(a, vec2(.34, .12), vec2(0., .46)))) - .14; }
float moonMark(vec2 a){ return max(length(a) - .55, -(length(a - vec2(.26, .2)) - .44)); }
float hgMark(vec2 a){ return min(sdTri(a, vec2(-.4, .5), vec2(.4, .5), vec2(0., .02)), sdTri(a, vec2(-.4, -.5), vec2(.4, -.5), vec2(0., -.02))) - .03; }
float lockMark(vec2 a){
  float body = max(sdRBox(a - vec2(0., -.2), vec2(.44, .34), .1), -(length(a - vec2(0., -.17)) - .09));
  float sh = max(abs(length(a - vec2(0., .14)) - .26) - .08, -(a.y - .14));
  sh = min(sh, min(sdSeg(a, vec2(-.26, .14), vec2(-.26, -.05)), sdSeg(a, vec2(.26, .14), vec2(.26, -.05))) - .08);
  return min(body, sh);
}

// Body: core circle smooth-unioned with one tapered capsule per point; feelings bend, stretch and wave the points.
float bodyD(vec2 p, vec4 t5, vec4 t6, vec4 t7, vec4 t28, float grow, float seed, int tipIdx, out vec2 tipPos){
  int n = int(t5.x + .5), wi = int(t28.y + .5);
  float d = length(p) - t5.y * mix(.5, 1., grow);
  float k = t5.z * (1. - .55 * t6.z) * (1. + .5 * t7.w);
  tipPos = vec2(0.);
  for (int i = 0; i < 8; i++){
    if (i >= n) break;
    vec4 pt = D(20 + i);
    float ph = h11(float(i) * 7.31 + seed) * TAU;
    float a = pt.x + t7.x * sin(t7.y + ph);
    a += (t6.x - t7.z * .5) * .3 * sin(1.5708 - a);
    float wb = 0.;
    if (i == wi){ a += t28.z * (.1 + .26 * sin(uTime * 9.)); wb = t28.z * .55 * cos(uTime * 9.); }
    vec2 dir = vec2(cos(a), sin(a));
    vec2 sp = vec2(dot(p, vec2(-dir.y, dir.x)), dot(p, dir));
    float L = pt.y * t6.y * grow;
    float hw = pt.z * mix(1., .74, t6.z) * mix(1., 1.1, t7.w) * mix(.55, 1., grow);
    float tip = hw * mix(t5.w, .22, t6.z);
    sp.x -= (pt.w + wb - t7.z * dir.x * .45 + t6.w * .7) * sp.y * sp.y;
    d = smin(d, sdUC(sp, hw, tip, max(L, hw - tip + .002)), k);
    if (i == tipIdx) tipPos = dir * (L + tip * .6);
  }
  return d;
}

// One eye. Coordinates are mirrored so +x points toward the nose on both sides.
float eyeD(vec2 q, float side, vec4 t8, vec4 t9, vec4 t10, vec4 t11, vec4 t12, float spin){
  bool L = side < 0.;
  float w = t8.z, h = t8.w, sc = L ? t11.x : t11.y, gap = max(t8.x, w * 2.35);
  vec2 e = (q - vec2(side * gap * .5, L ? t11.z : t11.w)) / sc;
  e = rot(e, -t9.x); e.x *= -side;
  float g = t12.z, d, ext = h * 1.08;
  if (g < .5){
    float sh = t12.w;
    d = sh < .5 ? sdRBox(e, vec2(w, h), min(w, h)) : sh < 1.5 ? sdEll(e, vec2(w, h)) : sdRBox(e, vec2(w, h), min(w, h) * .55);
  } else {
    float gh = min(h, gap * .44);
    ext = gh * 1.45;
    float st = clamp(w * .45, .024, gh * .2);
    if (g < 1.5) d = sdStar(e, gh * 1.05, 5., 2.4) - gh * .1;
    else if (g < 2.5){ float s = gh * 1.55; d = sdHeart(e / s + vec2(0., .55)) * s; }
    else if (g < 3.5){ float s = gh * .6; d = min(sdSeg(e, vec2(-s), vec2(s)), sdSeg(e, vec2(-s, s), vec2(s, -s))) - st; }
    else if (g < 4.5){
      float r = length(e), th = mod(atan(e.y, e.x) + spin, TAU), b = gh * .13;
      float kk = max(floor((r / b - th) / TAU + .5), 0.);
      d = max(abs(r - b * (th + TAU * kk)) - clamp(w * .3, .016, gh * .16), r - gh * 1.02);
    }
    else if (g < 5.5){ float s = gh * .62; d = min(sdSeg(e, vec2(-s * .6, s), vec2(s * .5, 0.)), sdSeg(e, vec2(-s * .6, -s), vec2(s * .5, 0.))) - st; }
    else d = abs(length(e) - gh * .68) - st * .9;
  }
  float la = t9.y, lid = mix(L ? t10.x : t10.y, -1.1, t9.z);
  d = max(d, (e.y - (lid * ext - e.x * tan(la))) * cos(la));
  float low = L ? t10.z : t10.w;
  if (low > .002){ float rr = w * 2.4 + h * .5; d = max(d, -(length(e - vec2(0., -h - rr + low * h * 1.6)) - rr)); }
  return d * sc;
}
float mouthD(vec2 m, float type, float sz, float open){
  m /= sz; float d = 1e3;
  if (type < .5) d = 1e3;
  else if (type < 1.5) d = sdArc(vec2(m.x, .055 - m.y), .95, .075, .017);
  else if (type < 2.5){ vec2 mm = m - vec2(0., .015); d = max(length(mm * vec2(1., 1. / (.5 + .5 * open))) - .082, mm.y); }
  else if (type < 3.5) d = sdEll(m, vec2(.04 + .012 * open, .042 + .036 * open));
  else if (type < 4.5) d = sdSeg(m, vec2(-.055, 0.), vec2(.055, 0.)) - .017;
  else if (type < 5.5) d = sdArc(m + vec2(0., .07), .85, .075, .017);
  else if (type < 6.5){ float x = clamp(m.x, -.075, .075); d = length(vec2(m.x - x, m.y - .013 * sin(x * 60.))) - .016; }
  else if (type < 7.5) d = sdArc(vec2(abs(m.x) - .034, .028 - m.y), 1.2, .034, .015);
  else if (type < 8.5){ vec2 mm = rot(m - vec2(.015, 0.), .3); d = sdArc(vec2(mm.x, .05 - mm.y), .75, .065, .016); }
  else d = sdSeg(rot(m, .1), vec2(-.05, 0.), vec2(.045, 0.)) - .016;
  return d * sz;
}
float tongueD(vec2 m, float sz, float open){ m /= sz; return (length(m - vec2(0., -.07 * (.5 + .5 * open))) - .045) * sz; }
float tongue9D(vec2 m, float sz){ m /= sz; return sdEll(rot(m - vec2(.026, -.028), .25), vec2(.026, .033)) * sz; }

vec4 sparkles(vec2 pp, float seed, float amt, bool glowy){
  vec4 c = vec4(0.);
  for (int i = 0; i < 5; i++){
    float fi = float(i);
    if (fi > 1.5 + 3. * amt) break;
    float ang = h11(fi * 3.1 + seed * 7.) * TAU, rad = 1.02 + .38 * h11(fi * 5.3 + seed * 3.);
    vec2 ctr = vec2(cos(ang) * rad, sin(ang) * rad * .85 + .15);
    float tw = pow(max(0., sin(uTime * (2.2 + 1.6 * h11(fi + seed)) + fi * 2.3)), 3.), s = .14 * tw * mix(.7, 1., amt);
    if (s < .006) continue;
    float ds = sdStar(pp - ctr, s, 4., 2.3);
    c = over(vec4(mix(vec3(1., .72, .18), vec3(1., .97, .85), smoothstep(s * .55, 0., length(pp - ctr))), 1.) * cov(ds), c);
    if (glowy) c = over(vec4(vec3(1., .85, .5), 1.) * exp(-length(pp - ctr) / (s * .5)) * .5 * tw, c);
  }
  return c;
}

vec4 props(int type, vec2 pp, float seed, float age, vec3 INK, bool glowy, float amt){
  vec4 c = vec4(0.);
  if (type == 1){
    for (int i = 0; i < 3; i++){
      float fi = float(i), ph = fract(uTime / 2.3 + fi / 3. + seed);
      vec2 ctr = vec2((fi - 1.) * .5 + .08 * sin(uTime * 2.3 + fi * 2.), .62 + ph * 1.05);
      float s = .13 + .06 * ph, dh = sdHeart((pp - ctr) / s + vec2(0., .55)) * s;
      float a = smoothstep(0., .14, ph) * (1. - smoothstep(.6, 1., ph));
      c = over(vec4(vec3(1., .34, .52), 1.) * a * cov(dh), c);
      if (glowy) c = over(vec4(vec3(1., .5, .65), 1.) * a * exp(-max(dh, 0.) / .04) * .35, c);
    }
  } else if (type == 2){
    for (int i = 0; i < 3; i++){
      float fi = float(i), ph = fract(uTime / 3.2 + fi / 3.);
      vec2 ctr = vec2(.52 + ph * .55, .6 + ph * .8);
      float s = .055 + .07 * ph; vec2 z = (pp - ctr) / s;
      float dz = min(min(sdSeg(z, vec2(-1., 1.), vec2(1., 1.)), sdSeg(z, vec2(1., 1.), vec2(-1., -1.))), sdSeg(z, vec2(-1., -1.), vec2(1., -1.))) * s - .024;
      c = over(vec4(INK, 1.) * cov(dz) * smoothstep(0., .15, ph) * (1. - smoothstep(.65, 1., ph)), c);
    }
  } else if (type == 3){
    for (int i = 0; i < 5; i++){
      float fi = float(i);
      if (fi > 1.5 + 3. * amt) break;
      float ang = h11(fi * 3.1 + seed * 7.) * TAU, rad = 1.02 + .38 * h11(fi * 5.3 + seed * 3.);
      vec2 ctr = vec2(cos(ang) * rad, sin(ang) * rad * .85 + .15);
      float tw = pow(max(0., sin(uTime * (2.2 + 1.6 * h11(fi + seed)) + fi * 2.3)), 3.), s = .14 * tw * mix(.7, 1., amt);
      if (s < .006) continue;
      float ds = sdStar(pp - ctr, s, 4., 2.3);
      c = over(vec4(mix(vec3(1., .72, .18), vec3(1., .97, .85), smoothstep(s * .55, 0., length(pp - ctr))), 1.) * cov(ds), c);
      if (glowy) c = over(vec4(vec3(1., .85, .5), 1.) * exp(-length(pp - ctr) / (s * .5)) * .5 * tw, c);
    }
  } else if (type == 4){
    float s = .17 * (1. + .12 * sin(uTime * 9.));
    vec2 a = abs((pp - vec2(.66, .76)) / s);
    c = vec4(vec3(1., .24, .32), 1.) * cov(sdArc(rot(a - vec2(.95), 3.927), .55, .72, .13) * s);
  } else if (type == 5){
    float s = .23; vec2 a = rot((pp - vec2(.78, .92 + .04 * sin(uTime * 2.))) / s, .15 * sin(uTime * 1.3));
    float hook = sdArc(rot(a - vec2(0., .42), .55), 2.05, .4, .13);
    float stem = sdSeg(a, vec2(.02, .04), vec2(0., -.26)) - .13;
    float dt = length(a - vec2(0., -.66)) - .15;
    c = vec4(INK, 1.) * cov(min(min(hook, stem), dt) * s);
  } else if (type == 6){
    float pop = 1. + .35 * exp(-age * 6.) * sin(age * 18.), s = max(.17 * pop * smoothstep(0., .08, age), .001);
    vec2 a = (pp - vec2(.74, .9)) / s;
    float bar = sdSeg(a, vec2(0., .15), vec2(0., .95)) - mix(.11, .17, smoothstep(.15, .95, a.y));
    c = vec4(vec3(1., .7, .14), 1.) * cov(min(bar, length(a - vec2(0., -.22)) - .15) * s);
  } else if (type == 7){
    for (int i = 0; i < 3; i++){
      float fi = float(i), ang = uTime * 2.6 + fi * 2.094, dep = sin(ang);
      vec2 ctr = vec2(cos(ang) * .6, 1.1 + dep * .14);
      float s = .085 * (1. - .22 * dep);
      float ds = sdStar(rot(pp - ctr, uTime * 3.), s, 5., 2.5) - s * .1;
      c = over(vec4(vec3(1., .76, .2), 1.) * cov(ds) * (1. - .4 * max(dep, 0.)), c);
    }
  }
  else if (type == 8){
    for (int i = 0; i < 3; i++){
      float fi = float(i), ph = sin(uTime * 4. - fi * 1.1) * .5 + .5;
      vec2 cn = vec2(-.62 - fi * .17, .9 + fi * .21);
      float r = (.045 + fi * .019) * (.82 + .3 * ph), dd = length(pp - cn) - r;
      c = over(vec4(INK, 1.) * cov(dd) * (.55 + .45 * ph), c);
      if (glowy) c = over(vec4(INK, 1.) * exp(-max(dd, 0.) / .045) * .3 * ph, c);
    }
  }
  else if (type == 9 || type == 10){
    float pop = 1. + .45 * exp(-age * 7.) * sin(age * 17.), s = max(.2 * pop * smoothstep(0., .1, age), .001);
    float shake = type == 10 ? .035 * exp(-age * 2.5) * sin(age * 34.) : 0.;
    vec2 a = (pp - vec2(.8 + shake, .9)) / s;
    vec3 fill = type == 9 ? vec3(.2, .8, .48) : vec3(.95, .28, .34);
    float ic = type == 9 ? vMark(a * 1.75) / 1.75 : xMark(a * 1.9) / 1.9;
    if (type == 9) c = sparkles(pp, seed, .5, glowy);
    if (glowy) c = over(vec4(fill, 1.) * exp(-max(length(a) - 1., 0.) * s / .06) * .45, c);
    c = over(vec4(fill, 1.) * cov((length(a) - 1.) * s), c);
    c = over(vec4(1.) * cov(ic * s), c);
  }
  else if (type == 11){
    for (int i = 0; i < 2; i++){
      float fi = float(i), cyc = uTime / 1.9 + fi * .5 + seed * .13, k = floor(cyc), ph = fract(cyc);
      float side = mod(k + fi, 2.) < 1. ? -1. : 1.;
      vec2 cn = vec2(side * (.8 + .12 * h11(k + seed)), -.12 + ph * 1.05);
      float s = .16; vec2 a = (pp - cn) / s;
      float lt = min(sdSeg(a, vec2(-.85, 0.), vec2(-.52, .32)), sdSeg(a, vec2(-.85, 0.), vec2(-.52, -.32)));
      float sl = sdSeg(a, vec2(-.14, -.36), vec2(.14, .36));
      float gt = min(sdSeg(a, vec2(.85, 0.), vec2(.52, .32)), sdSeg(a, vec2(.85, 0.), vec2(.52, -.32)));
      float al = smoothstep(0., .15, ph) * (1. - smoothstep(.6, 1., ph));
      vec3 cc = glowy ? vec3(.72, 1., .86) : INK;
      c = over(vec4(cc, 1.) * cov((min(min(lt, sl), gt) - .11) * s) * al, c);
    }
  }
  else if (type == 12){
    float ra = 1.32, head = uTime * 2.4 + seed, an = atan(pp.y, pp.x);
    float da = mod(head - an, TAU), tail = 1. - smoothstep(0., 2.4, da);
    c = over(vec4(INK, 1.) * cov(abs(length(pp) - ra) - .012) * .22, c);
    c = over(vec4(INK, 1.) * cov(abs(length(pp) - ra) - .036 * (.35 + .65 * tail)) * tail, c);
    vec2 hp = vec2(cos(head), sin(head)) * ra;
    if (glowy) c = over(vec4(INK, 1.) * exp(-length(pp - hp) / .09) * .55, c);
    c = over(vec4(1.) * cov(length(pp - hp) - .062), c);
  }
  else if (type == 13){
    float ang = -uTime * .8 + seed * .7;
    vec2 bp = vec2(cos(ang) * 1.22, sin(ang) * 1.08 + .05);
    vec2 tg = normalize(vec2(sin(ang) * 1.22, -cos(ang) * 1.08));
    vec2 b = pp - bp; b = vec2(dot(b, vec2(tg.y, -tg.x)), dot(b, tg)) / 1.7;
    vec2 m = vec2(abs(b.x), b.y);
    float legs = 1e3;
    for (int k = 0; k < 3; k++){
      float fk = float(k) - 1., w = sin(uTime * 22. + fk * 2.1) * .016;
      legs = min(legs, sdSeg(m, vec2(.04, fk * .035), vec2(.098, fk * .06 + w)));
    }
    float ant = sdSeg(m, vec2(.01, .1), vec2(.04, .15));
    float body = sdEll(b, vec2(.058, .072)), head = length(b - vec2(0., .082)) - .034;
    float marks = max(min(abs(b.x) - .005, min(length(m - vec2(.028, .012)) - .015, length(m - vec2(.026, -.034)) - .012)), body);
    vec3 dark = vec3(.14, .11, .2);
    c = over(vec4(dark, 1.) * cov((min(legs - .009, ant - .007)) * 1.7), c);
    c = over(vec4(vec3(.96, .27, .33), 1.) * cov(body * 1.7), c);
    c = over(vec4(dark, 1.) * cov(min(marks, head) * 1.7), c);
  }
  else if (type == 14){
    vec2 lc = vec2(.8, .9 + .03 * sin(uTime * 3.));
    float s = .2; vec2 a = (pp - lc) / s;
    float rp = fract(uTime * .9);
    c = over(vec4(vec3(1., .74, .24), 1.) * cov(abs(length(pp - lc) - (.2 + rp * .24)) - .012) * (1. - rp) * .75, c);
    float sh = max(abs(length(a - vec2(0., .14)) - .26) - .08, -(a.y - .14));
    sh = min(sh, min(sdSeg(a, vec2(-.26, .14), vec2(-.26, -.05)), sdSeg(a, vec2(.26, .14), vec2(.26, -.05))) - .08);
    float body = sdRBox(a - vec2(0., -.2), vec2(.44, .34), .1);
    float kh = min(length(a - vec2(0., -.15)) - .085, sdSeg(a, vec2(0., -.18), vec2(0., -.36)) - .04);
    c = over(vec4(vec3(.84, .86, .92), 1.) * cov(sh * s), c);
    c = over(vec4(vec3(1., .76, .26), 1.) * cov(body * s), c);
    c = over(vec4(vec3(.5, .32, .08), 1.) * cov(max(kh, body) * s), c);
  }
  else if (type == 15){
    float ph = fract(uTime / 3.), flip = smoothstep(.86, 1., ph) * PI, k = clamp(ph / .86, 0., 1.), s = .2;
    vec2 a = rot(pp - vec2(.8, .9), flip) / s;
    float top = sdTri(a, vec2(-.42, .55), vec2(.42, .55), vec2(0., 0.)), bot = sdTri(a, vec2(-.42, -.55), vec2(.42, -.55), vec2(0., 0.));
    float glass = min(top, bot);
    float sand = min(max(top + .06, a.y - (.04 + .42 * (1. - k))), max(bot + .06, a.y - (-.55 + .46 * k)));
    sand = min(sand, max(sdSeg(a, vec2(0.), vec2(0., -.5)) - .025, -(k - .98)));
    float bars = min(sdRBox(a - vec2(0., .62), vec2(.56, .07), .04), sdRBox(a - vec2(0., -.62), vec2(.56, .07), .04));
    c = over(vec4(vec3(.9, .95, 1.), 1.) * cov(glass * s) * .3, c);
    c = over(vec4(vec3(1., .78, .35), 1.) * cov(sand * s), c);
    c = over(vec4(vec3(.92, .96, 1.), 1.) * cov((abs(glass) - .035) * s) * .9, c);
    c = over(vec4(vec3(.66, .46, .3), 1.) * cov(bars * s), c);
  }
  else if (type == 16){
    for (int i = 0; i < 2; i++){
      float fi = float(i), ph = fract(uTime / 2.4 + fi * .5), side = fi < .5 ? -1. : 1.;
      vec2 cn = vec2(side * (.8 + ph * .22) + .05 * sin(ph * 8. + fi), .05 + ph * 1.05);
      vec2 a = rot(pp - cn, -.2 * side) / .2;
      float head = sdEll(rot(a - vec2(-.12, -.32), .45), vec2(.3, .21));
      float stem = sdSeg(a, vec2(.14, -.28), vec2(.14, .56)) - .06;
      float flag = sdSeg(a, vec2(.14, .56), vec2(.44, .3)) - .07;
      float al = smoothstep(0., .15, ph) * (1. - smoothstep(.65, 1., ph));
      c = over(vec4(INK, 1.) * cov(min(min(head, stem), flag) * .2) * al, c);
    }
  }
  else if (type == 17){
    for (int i = 0; i < 14; i++){
      float fi = float(i), h1 = h11(fi * 1.31 + 3.), h2 = h11(fi * 2.17 + 5.), h3 = h11(fi * 3.7 + 1.);
      float ph = fract(uTime * (.16 + .1 * h2) + h1);
      vec2 cn = vec2((h1 - .5) * 2.7 + .12 * sin(uTime * 2. + fi), 1.6 - ph * 3.);
      vec2 a = rot(pp - cn, uTime * (2. + 2. * h3) + fi);
      a.x /= max(abs(cos(uTime * 4. + fi * 1.7)), .2);
      float m = mod(fi, 5.);
      vec3 cc = m < 1. ? vec3(1., .42, .62) : m < 2. ? vec3(1., .82, .3) : m < 3. ? vec3(.45, .92, .66) : m < 4. ? vec3(.45, .76, 1.) : vec3(.76, .6, 1.);
      float al = smoothstep(0., .08, ph) * (1. - smoothstep(.8, 1., ph)) * smoothstep(.5, .9, length(pp - vec2(0., .05)));
      c = over(vec4(cc, 1.) * cov(sdRBox(a, vec2(.05, .024), .006)) * al, c);
    }
    c = over(sparkles(pp, seed, .6, glowy), c);
  }
  return c;
}

// Accessories sit in front of the face. Face-anchored ones use q, body-anchored ones p, table-anchored ones P (no body motion).
vec4 accessory(int acc, float a, vec2 p, vec2 q, vec2 P, vec2 look, vec2 lensC, float lensR, vec4 t5, vec4 t8, vec4 t30, float seed, vec3 GC, vec3 GM, vec3 GR, vec3 INK, bool gl, float dsc){
  vec4 c = vec4(0.);
  float al = smoothstep(0., .3, a);
  if (acc == 1){
    vec2 s = q - look * vec2(.04, .03) - vec2(0., .02 + (1. - a) * .55);
    float gap = max(t8.x, .3), lw = .155, lh = .112, dl = 1e3; vec2 el = vec2(0.);
    for (int i = 0; i < 2; i++){
      float side = i == 0 ? -1. : 1.;
      vec2 e = s - vec2(side * gap * .5, 0.);
      e.x *= side;
      e.x /= 1. + .28 * clamp(e.y / lh, -1., 1.);
      float dd = sdRBox(e - vec2(-.012, 0.), vec2(lw, lh), .07);
      if (dd < dl){ dl = dd; el = e; }
    }
    float bridge = sdSeg(s, vec2(-gap * .5 + lw * .75, .075), vec2(gap * .5 - lw * .75, .075)) - .02;
    vec3 lens = mix(vec3(.05, .04, .1), mix(vec3(.1, .07, .18), GC, .45), smoothstep(lh, -lh, el.y));
    float sweep = fract(uTime / 3.4 + seed * .1) * 3.2 - 1.;
    lens += vec3(1.) * (smoothstep(.04, 0., abs(el.x * .9 + el.y - sweep * .4)) * .5 + smoothstep(.055, 0., length(el - vec2(-.06, .055))) * .45);
    c = over(vec4(lens, 1.) * cov(dl * dsc), c);
    vec3 fcol = gl ? mix(vec3(.1, .08, .16), GR, .35) : vec3(.08, .07, .12);
    c = over(vec4(fcol, 1.) * cov(min(abs(dl) - .016, bridge) * dsc), c);
  } else if (acc == 2){
    vec2 l = P + vec2(0., (1. - a) * .9);
    float lid = sdRBox(l - vec2(0., -.6), vec2(.68, .36), .07), base = sdRBox(l - vec2(0., -1.0), vec2(.8, .045), .045);
    vec3 alu = mix(vec3(.64, .67, .76), vec3(.9, .92, .96), smoothstep(-.96, -.26, l.y));
    if (gl) alu = mix(alu, GM, .12);
    alu += vec3(1.) * smoothstep(.03, 0., abs(lid + .018)) * .3;
    c = over(vec4(vec3(.7, .73, .8), 1.) * cov(base), c);
    c = over(vec4(vec3(.74, .86, 1.), 1.) * exp(-max(l.y + .24, 0.) / .05) * step(abs(l.x), .64) * step(-.26, l.y) * .3, c);
    c = over(vec4(alu, 1.) * cov(lid), c);
    float lg = sdStar(l - vec2(0., -.6), .1, 4., 2.3);
    if (gl) c = over(vec4(GR, 1.) * exp(-max(lg, 0.) / .05) * .4 * (1. - cov(lg)) * cov(lid), c);
    c = over(vec4(gl ? mix(GR, vec3(1.), .5) : vec3(1.), 1.) * cov(lg) * .95, c);
  } else if (acc == 3){
    float rr = length(p - lensC);
    vec2 hd = normalize(vec2(.7, -.72));
    float handle = sdSeg(p, lensC + hd * (lensR + .02), lensC + hd * (lensR + .3)) - .045;
    float rim = abs(rr - lensR) - .03;
    float hl = max(abs(rr - lensR * .72) - .018, .55 - dot(normalize(p - lensC + 1e-5), vec2(-.7, .7)));
    c = over(vec4(vec3(.78, .92, 1.), 1.) * (1. - smoothstep(lensR - .01, lensR, rr)) * .12, c);
    c = over(vec4(1.) * cov(hl * dsc) * .6, c);
    c = over(vec4(vec3(.48, .31, .2), 1.) * cov(handle * dsc), c);
    c = over(vec4(gl ? mix(vec3(.24, .2, .34), GR, .35) : vec3(.22, .2, .3), 1.) * cov(rim * dsc), c);
  } else if (acc == 4){
    vec2 s = q - look * vec2(.04, .03) - vec2(0., (1. - a) * .4);
    float gap = max(t8.x, .3), h = t8.w, bw = min(gap * .5 - .025, .17), bh = .085, y0 = -h * .42, dl = 1e3; vec2 el = vec2(0.);
    for (int i = 0; i < 2; i++){
      float side = i == 0 ? -1. : 1.;
      vec2 e = s - vec2(side * gap * .5, y0);
      float dd = sdRBox(e, vec2(bw, bh), .06);
      if (dd < dl){ dl = dd; el = e; }
    }
    float bridge = sdArc(vec2(s.x, y0 + bh * .55 - s.y), .9, max(gap * .5 - bw, .02), .016);
    c = over(vec4(vec3(.85, .95, 1.), 1.) * cov(dl * dsc) * .2, c);
    c = over(vec4(1.) * cov((abs(el.x + el.y * .9 + .04) - .012) * dsc) * cov(dl * dsc) * .55, c);
    vec3 fcol = gl ? mix(vec3(.3, .18, .12), GR, .2) : vec3(.3, .18, .12);
    c = over(vec4(fcol, 1.) * cov(min(abs(dl) - .016, bridge) * dsc), c);
  } else if (acc == 5){
    vec2 s = p - vec2(0., (1. - a) * .5);
    float cr = t5.y;
    float band = max(abs(length(s - vec2(0., -.02)) - (cr + .03)) - .05, -(s.y - .06));
    vec2 sc = vec2(abs(s.x), s.y);
    float cup = sdRBox(sc - vec2(cr + .04, -.08), vec2(.1, .17), .08), cush = sdRBox(sc - vec2(cr - .03, -.08), vec2(.05, .14), .05);
    vec3 shell = gl ? mix(vec3(.97), GR, .25) : vec3(.97);
    vec3 accent = gl ? mix(GM, GC, .5) : INK;
    c = over(vec4(shell * .92, 1.) * cov(band * dsc), c);
    c = over(vec4(vec3(.3, .28, .4), 1.) * cov(cush * dsc), c);
    c = over(vec4(shell, 1.) * cov(cup * dsc), c);
    c = over(vec4(accent, 1.) * cov((length(sc - vec2(cr + .06, -.08)) - .045) * dsc), c);
  } else if (acc == 6){
    float cyc = fract(uTime / 5. + seed * .37), sip = smoothstep(0., .14, cyc) * (1. - smoothstep(.34, .48, cyc));
    vec2 mc = mix(vec2(.68, -.58), vec2(.32, -.32), sip * .8) - vec2(0., (1. - a) * .8);
    vec2 m = rot(P - mc, -sip * .55);
    float body = sdRBox(m, vec2(.13 + m.y * .05, .15), .045);
    float handle = max(abs(length(m - vec2(.15, .01)) - .065) - .024, -(m.x - .13));
    float band = max(sdRBox(m - vec2(0., .02), vec2(.2, .035), .01), body);
    vec3 mug = vec3(.97, .96, .98) * mix(.82, 1., smoothstep(-.15, .15, m.x + m.y * .3));
    c = over(vec4(mug * .9, 1.) * cov(handle), c);
    c = over(vec4(mug, 1.) * cov(body), c);
    c = over(vec4(gl ? mix(GM, GC, .4) : INK, 1.) * cov(band), c);
    for (int i = 0; i < 2; i++){
      float fi = float(i);
      vec2 sp = P - (mc + vec2(-.04 + fi * .08, .19));
      float wx = sp.x - .025 * sin(sp.y * 18. - uTime * 3. + fi * 2.);
      float dS = max(abs(wx) - .012, max(-sp.y, sp.y - .26));
      c = over(vec4(1.) * cov(dS) * .45 * (1. - sip) * (1. - smoothstep(.08, .26, sp.y)), c);
    }
  } else if (acc == 7){
    vec2 m = rot(P - vec2(.6, -.5) + vec2(0., (1. - a) * .8), .14);
    float board = sdRBox(m, vec2(.24, .31), .04), paper = sdRBox(m - vec2(0., -.02), vec2(.2, .26), .015), clip = sdRBox(m - vec2(0., .3), vec2(.08, .045), .02);
    c = over(vec4(gl ? mix(vec3(.55, .36, .22), GC, .25) : vec3(.6, .4, .24), 1.) * cov(board), c);
    c = over(vec4(vec3(.98), 1.) * cov(paper), c);
    float cyc = fract(uTime / 4.8 + seed * .2);
    for (int i = 0; i < 3; i++){
      float fi = float(i), y = .12 - fi * .13;
      float box = abs(sdRBox(m - vec2(-.12, y), vec2(.035), .008)) - .009, line = sdSeg(m, vec2(-.05, y), vec2(.14 - fi * .03, y)) - .012;
      c = over(vec4(vec3(.62, .64, .72), 1.) * cov(min(box, line)), c);
      float tick = min(sdSeg(m, vec2(-.145, y + .005), vec2(-.125, y - .02)), sdSeg(m, vec2(-.125, y - .02), vec2(-.09, y + .03))) - .012;
      c = over(vec4(vec3(.15, .75, .45), 1.) * cov(tick) * step((fi + 1.) * .24, cyc), c);
    }
    c = over(vec4(vec3(.78, .8, .86), 1.) * cov(clip), c);
  } else if (acc == 8){
    vec2 dir = vec2(cos(t30.z), sin(t30.z)), perp = vec2(-dir.y, dir.x);
    vec2 s = p - (t30.xy + dir * ((1. - a) * .55 - .04));
    vec2 u = vec2(dot(s, perp), dot(s, dir));
    float r0 = max(t30.w * 1.08, .15), sw = .04 * sin(uTime * 1.3 + seed);
    vec2 c1 = vec2(.04, .24), c2 = vec2(.2 + sw * .5, .42), c3 = vec2(.44 + sw, .36 - sw * .5);
    float cone = smin(smin(sdTC(u, vec2(0.), c1, r0, r0 * .7), sdTC(u, c1, c2, r0 * .7, r0 * .38), .06), sdTC(u, c2, c3, r0 * .38, .03), .05);
    float pom = length(u - c3 - vec2(.05, -.06)) - .075;
    float band = sdRBox(u - vec2(0., .01), vec2(r0 * 1.16, .05), .05);
    band += .006 * sin(atan(u.y - .01, u.x) * 9.);
    vec3 capc = mix(vec3(.2, .2, .48), GR, .22);
    vec3 strp = mix(vec3(.5, .52, .95), GC, .3);
    capc = mix(capc, strp, step(.55, fract((u.y - u.x * .35) * 6.5)) * .8);
    capc *= .9 + .1 * smoothstep(-.1, .2, u.x);
    c = over(vec4(capc, 1.) * cov(cone * dsc), c);
    c = over(vec4(vec3(.98, .97, 1.), 1.) * cov(band * dsc), c);
    c = over(vec4(vec3(.98, .97, 1.), 1.) * cov(pom * dsc), c);
    c = over(vec4(vec3(.8, .82, .92), 1.) * cov((length(u - c3 - vec2(.07, -.09)) - .035) * dsc) * cov(pom * dsc) * .35, c);
  }
  return c * al;
}

void main(){
  vec4 d0 = D(0), d1 = D(1), d2 = D(2), d3 = D(3), d4 = D(4), t29 = D(29), t31 = D(31);
  vec2 fc = vec2(gl_FragCoord.x / uDpr, uView.y - gl_FragCoord.y / uDpr);
  if (fc.x < t29.x || fc.y < t29.y || fc.x > t29.z || fc.y > t29.w) discard;
  px = 1. / (d0.z * uDpr);
  float seed = d0.w;
  int style = int(d1.x + .5), frameT = int(d1.z + .5);
  pb = int(d1.y + .5) * 8;
  vec2 P = vP, off = d3.xy, sxy = d4.xy * d3.w;
  vec2 p = rot(P - off, -d3.z) / sxy;
  float dsc = min(sxy.x, sxy.y), grow = d4.w;
  vec4 t5 = D(5), t6 = D(6), t7 = D(7), t8 = D(8), t9 = D(9), t10 = D(10), t11 = D(11), t12 = D(12);
  vec4 t13 = D(13), t14 = D(14), t15 = D(15), t16 = D(16), t17 = D(17), t18 = D(18), t19 = D(19), t28 = D(28), t30 = D(30);
  vec2 look = t12.xy;
  int acc = int(t18.z + .5); float accA = t18.y, faceY = t18.w;
  // the magnifier enlarges whatever sits under the glass, so remap before the body is evaluated
  vec2 p0 = p, lensC = vec2(t8.x * .5 + .01, t8.y + faceY) + look * vec2(.14, .1);
  float lensR = .27 * smoothstep(0., .6, accA);
  if (acc == 3 && lensR > .005){ float lr = length(p - lensC); if (lr < lensR) p = lensC + (p - lensC) / mix(1., 1.5, accA); }
  float gcyc = uTime / 3.7 + seed * 1.37, gp = fract(gcyc);
  int tipIdx = int(h11(floor(gcyc) * 1.7 + seed) * t5.x);
  vec2 tipPos;
  float d = bodyD(p, t5, t6, t7, t28, grow, seed, tipIdx, tipPos) * dsc;

  vec3 FLAT = PAL(0), GC = PAL(1), GM = PAL(2), GR = PAL(3), AU = PAL(4), FT = PAL(5), INK = PAL(6), BL = PAL(7);
  GR = mix(GR, t16.rgb, t16.a * .55); AU = mix(AU, t16.rgb, t16.a); GM = mix(GM, t16.rgb, t16.a * .25); FLAT = mix(FLAT, t16.rgb, t16.a * .2);
  float desat = t28.x;
  if (desat > .002){
    FLAT = mix(FLAT, vec3(lum(FLAT)), desat); GC = mix(GC, vec3(lum(GC)), desat); GM = mix(GM, vec3(lum(GM)), desat); GR = mix(GR, vec3(lum(GR)), desat);
    AU = mix(AU, vec3(lum(AU)), desat); FT = mix(FT, vec3(lum(FT)), desat); INK = mix(INK, vec3(lum(INK)), desat); BL = mix(BL, vec3(lum(BL)), desat);
  }
  float glow = t17.x;

  vec2 q = p - vec2(look.x * .1, t8.y + faceY + look.y * .07);
  float eD = 1e3, mA = 1e3, mB = 1e3, tD = 1e3, bD = 1e3, tw = 0., t9D = 1e3, tw9 = 0.;
  if (d < .04){
    vec2 qe = q - look * vec2(.04, .03);
    eD = min(eyeD(qe, -1., t8, t9, t10, t11, t12, t17.z), eyeD(qe, 1., t8, t9, t10, t11, t12, t17.z)) * dsc;
    vec2 mq = q - vec2(look.x * .03, t14.y);
    mA = mouthD(mq, t13.x, t13.w, t14.x) * dsc; mB = mouthD(mq, t13.y, t13.w, t14.x) * dsc;
    tw = (abs(t13.x - 2.) < .1 ? 1. - t13.z : 0.) + (abs(t13.y - 2.) < .1 ? t13.z : 0.);
    tD = max(tongueD(mq, t13.w, t14.x) * dsc, min(mA, mB));
    tw9 = (abs(t13.x - 9.) < .1 ? 1. - t13.z : 0.) + (abs(t13.y - 9.) < .1 ? t13.z : 0.);
    t9D = tongue9D(mq, t13.w) * dsc;
    vec2 bq = vec2(abs(q.x) - (max(t8.x, t8.z * 2.35) * .5 + t8.z * 1.05 + .07), q.y + t8.w * .8 + .03);
    bD = sdEll(bq, vec2(.115, .062)) * dsc;
  }

  float inside = cov(d);
  vec4 col = vec4(0.);
  if (uShadow > .5 && frameT == 0 && style == 0){
    vec2 sq = (P - vec2(off.x * .6, -1.16)) / vec2(.72 * (1. - .28 * d4.z), .1 * (1. - .2 * d4.z));
    col = vec4(0., 0., 0., 1.) * exp(-dot(sq, sq)) * .15 * (1. - .55 * d4.z) * grow;
  }
  float ext = max(d, 0.), win = 1. - smoothstep(.6, .97, length(P) / d1.w);
  if (style == 2){
    col = over(vec4(AU, 1.) * exp(-ext / .34) * .3 * glow * (1. - inside) * win, col);
    col = over(vec4(GR, 1.) * exp(-ext / .075) * .55 * min(glow, 1.4) * (1. - inside), col);
  } else if (style == 1){
    col = over(vec4(1.) * exp(-ext / .055) * .42 * (1. - inside), col);
  }

  bool solidGlyph = t12.z > .5 && t12.z < 2.5;
  vec3 GLY = t12.z < 1.5 ? vec3(1., .86, .36) : vec3(1., .33, .52);
  vec3 bc; float ba = inside;
  float eCov, mCov;
  if (style == 0){
    bc = FLAT;
    eCov = cov(eD); mCov = mix(cov(mA), cov(mB), t13.z);
  } else if (style == 1){
    float h = smoothstep(0., .3, -d);
    vec2 g = vec2(dFdx(h), dFdy(h)) / px;
    vec3 nrm = normalize(vec3(-g * .14, 1.));
    float diff = clamp(dot(nrm, normalize(vec3(-.5, .6, .62))), 0., 1.);
    float fres = 1. - smoothstep(0., .2, -d);
    bc = mix(FT * mix(.8, 1.07, diff), vec3(1.), fres * .82);
    bc = mix(bc, vec3(1.), smoothstep(.36, 0., length((p - vec2(-.26, .34)) * vec2(1., 1.45))) * .4);
    ba = inside * mix(.97, .88, h);
    eCov = smoothstep(.012, -.012, eD); mCov = mix(smoothstep(.01, -.01, mA), smoothstep(.01, -.01, mB), t13.z);
  } else {
    float tt = clamp(-d / .42 + (fbm(p * 1.5 + vec2(seed * 3.1, uTime * .07)) - .5) * .2, 0., 1.);
    bc = mix(GR, GM, smoothstep(0., .24, tt));
    bc = mix(bc, GC, smoothstep(.2, .72, tt));
    bc = mix(bc, vec3(1.), exp(min(d, 0.) / .022) * .5);
    bc = mix(bc, vec3(1.), smoothstep(.34, 0., length((p - vec2(-.28, .36)) * vec2(1., 1.5))) * .2);
    eCov = smoothstep(px + .007, -.005, eD); mCov = mix(smoothstep(px + .006, -.004, mA), smoothstep(px + .006, -.004, mB), t13.z);
  }
  if (acc == 2) bc += vec3(.6, .8, 1.) * .22 * accA * smoothstep(.15, -.3, p.y);
  float face = t9.w; eCov *= face; mCov *= face;
  if (acc == 1) eCov *= 1. - smoothstep(.15, .55, accA);
  bc = mix(bc, BL, (style == 0 ? cov(bD) : smoothstep(.035, -.035, bD)) * t14.z * .62 * face);
  float tCov = cov(tD) * tw * face;
  if (style == 1){
    float hole = (solidGlyph ? 0. : eCov) + mCov * (1. - tCov);
    float rim = (1. - smoothstep(0., .03, -min(eD, min(mA, mB)))) * step(min(eD, min(mA, mB)), 0.);
    bc = mix(bc, FT * .72, rim * .5);
    if (solidGlyph) bc = mix(bc, GLY, eCov);
    bc = mix(bc, vec3(1., .5, .6), tCov);
    ba *= 1. - clamp(hole, 0., 1.) * .9;
  } else {
    vec3 EYE = style == 2 ? mix(vec3(1.), GR, .3) : vec3(1.);
    bc = mix(bc, solidGlyph ? GLY : EYE, eCov);
    bc = mix(bc, EYE, mCov);
    bc = mix(bc, vec3(1., .45, .55), tCov);
    if (style == 2) bc = mix(bc, vec3(1.), exp(-max(eD, 0.) / .03) * .22 * (1. - eCov));
  }
  bc = mix(bc, vec3(1., .45, .55), cov(t9D) * tw9 * face);
  col = over(vec4(bc, 1.) * ba, col);

  float tears = t14.w;
  if (tears > .01){
    for (int i = 0; i < 2; i++){
      float side = i == 0 ? -1. : 1., sc = i == 0 ? t11.x : t11.y;
      vec2 eb = vec2(side * (t8.x * .5 + t8.z * .25), (i == 0 ? t11.z : t11.w) - t8.w * sc * .8);
      if (tears > .5){
        float wob = .01 * sin(q.y * 26. + uTime * 7. + side * 2.);
        float sd = sdSeg(q - vec2(wob, 0.), eb, vec2(eb.x + side * .05, -.92)) - (.03 + .008 * sin(q.y * 18. - uTime * 11.));
        col = over(vec4(vec3(.66, .88, 1.), 1.) * cov(sd * dsc) * smoothstep(.5, .8, tears) * .85, col);
      }
      float ph = fract(uTime / (tears > .5 ? 1.1 : 2.4) + (i == 0 ? 0. : .5) + seed);
      vec2 dp = eb + vec2(side * .02 * ph, -ph * ph * (tears > .5 ? 1.3 : .75));
      float dd = sdDrop(q - dp, .038 * smoothstep(0., .12, ph) + .001) * dsc;
      col = over(vec4(vec3(.72, .9, 1.), 1.) * cov(dd) * (1. - smoothstep(.75, 1., ph)) * min(tears * 2., 1.), col);
    }
  }
  if (t15.x > .01){
    float ph = fract(uTime / 1.9);
    float sd = sdDrop(rot(p - vec2(.62, .56 - .12 * ph), -.3), .075) * dsc;
    float sa = t15.x * smoothstep(0., .1, ph) * (1. - smoothstep(.7, 1., ph));
    col = over(vec4(vec3(.38, .72, 1.), 1.) * cov(sd) * sa, col);
    col = over(vec4(1.) * cov((length(p - vec2(.6, .53 - .12 * ph)) - .022) * dsc) * sa * .9, col);
  }
  if (acc > 0 && accA > .005) col = over(accessory(acc, accA, p0, q, P, look, lensC, lensR, t5, t8, t30, seed, GC, GM, GR, INK, style == 2, dsc), col);
  vec2 pp = P - off;
  float age = uTime - t18.x;
  if (style != 0) INK = mix(GR, vec3(1.), .5);
  if (t28.w > .5){
    float pa = smoothstep(0., .25, t17.w);
    if (t15.w < .999) col = over(props(int(t15.y + .5), pp, seed, age, INK, style == 2, t17.w) * (1. - t15.w) * pa, col);
    if (t15.w > .001) col = over(props(int(t15.z + .5), pp, seed, age, INK, style == 2, t17.w) * t15.w * pa, col);
  }
  if (style == 2){
    float gam = smoothstep(0., .1, gp) * (1. - smoothstep(.1, .38, gp)) * grow;
    vec2 gq = p - tipPos;
    float cr = exp(-abs(gq.x) / .012) * exp(-abs(gq.y) / .15) + exp(-abs(gq.y) / .012) * exp(-abs(gq.x) / .15);
    col = over(vec4(1.) * clamp((cr * .75 + exp(-length(gq) / .035)) * gam * glow * (1. - desat), 0., 1.), col);
  }

  if (frameT > 0){
    vec2 F = P - d2.xy; float fh = d2.z;
    float fd = frameT == 1 ? length(F) - fh : sdSquircle(F, fh);
    float fm = cov(fd);
    vec3 top = style == 0 ? mix(FT, vec3(1.), .5) : GC * .78;
    vec3 bot = style == 0 ? mix(FT, vec3(1.), .15) : mix(GC, GM, .6);
    if (style == 2){
      // glow avatars sit on a night-sky disc in the palette's hue so the light reads at any size
      int di = int(d1.y + .5) * 2; vec3 k0 = uDeep[di], k1 = uDeep[di + 1];
      if (desat > .002){ k0 = mix(k0, vec3(lum(k0)), desat); k1 = mix(k1, vec3(lum(k1)), desat); }
      top = mix(k0, vec3(.035, .03, .09), .62); bot = mix(k0, k1, .4) * .82;
    }
    vec3 bgc = mix(bot, top, smoothstep(-fh, fh, F.y));
    bgc += (style == 2 ? AU : vec3(1.)) * exp(-dot2(F - vec2(0., style == 2 ? 0. : fh * .55)) / (fh * fh * .45)) * (style == 2 ? .12 : .07);
    vec4 content = over(col, vec4(bgc, 1.)) * fm;
    float sd = frameT == 1 ? length(F + vec2(0., .07 * fh)) - fh : sdSquircle(F + vec2(0., .07 * fh), fh);
    col = over(content, vec4(0., 0., 0., 1.) * exp(-max(sd, 0.) / (.07 * fh)) * .16 * (1. - fm));
    int ring = int(t19.z + .5); float ringA = t19.w;
    if (ring > 0 && ringA > .01){
      float rd = abs(length(F) - fh * 1.15) - fh * .05;
      if (ring == 1){
        float an = atan(F.y, F.x), head = -uTime * 4. + seed, da = mod(an - head, TAU), tail = 1. - smoothstep(0., 3.8, da);
        vec3 rc = mix(GC, GM, .55);
        col = over(vec4(rc, 1.) * cov(rd) * (.2 + .8 * tail) * ringA, col);
        col = over(vec4(1.) * cov(rd + fh * .02) * smoothstep(.5, 0., da) * ringA * .8, col);
      } else {
        float pu = .5 + .5 * sin(uTime * 4.2);
        col = over(vec4(vec3(1., .7, .2), 1.) * cov(rd - pu * fh * .016) * (.55 + .45 * pu) * ringA, col);
      }
    }
    int bdg = int(t19.x + .5); float bA = t19.y;
    if (bdg > 0 && bA > .01){
      float br = fh * .36 * bA;
      vec2 a = (P - d2.xy - vec2(.7, -.7) * fh) / br;
      vec3 bf = bdg == 1 ? vec3(.18, .78, .45) : bdg == 2 ? vec3(.95, .27, .33) : bdg <= 4 ? vec3(1., .66, .14) : bdg == 5 ? vec3(.42, .45, 1.) : bdg == 6 ? vec3(1., .36, .56) : bdg == 7 ? vec3(.36, .4, .8) : bdg == 8 ? vec3(.5, .55, .68) : vec3(1., .48, .16);
      float ic = bdg == 1 ? vMark(a * 1.6) / 1.6 : bdg == 2 ? xMark(a * 1.75) / 1.75 : bdg == 3 ? qMark(a * 1.9) / 1.9 : bdg == 4 ? lockMark(a * 1.45) / 1.45
        : bdg == 5 ? upMark(a * 1.6) / 1.6 : bdg == 6 ? sdHeart(a * 1.35 + vec2(0., .55)) / 1.35 : bdg == 7 ? moonMark(a * 1.4) / 1.4 : bdg == 8 ? hgMark(a * 1.45) / 1.45 : exMark(a * 1.7) / 1.7;
      col = over(vec4(t31.a > .5 ? t31.rgb : uCut, 1.) * cov((length(a) - 1.26) * br), col);
      col = over(vec4(bf, 1.) * cov((length(a) - 1.) * br), col);
      col = over(vec4(1.) * cov(ic * br), col);
    }
  }
  frag = col * d2.w;
}`;

  // ---------------------------------------------------------------- motion programs (body offsets, R units)
  const hopCurve = (u, H, air) => {
    if (u < air) { const v = u / air, s = Math.abs(2 * v - 1); return { y: H * 4 * v * (1 - v), lift: 4 * v * (1 - v), sy: 1 + .07 * s, sx: 1 - .05 * s }; }
    const g = (u - air) / (1 - air), sq = .13 * Math.exp(-g * 6) * Math.cos(g * 9) - (g > .85 ? .05 * (g - .85) / .15 : 0);
    return { y: 0, lift: 0, sy: 1 - sq, sx: 1 + sq * .8 };
  };
  const MOTION = {
    float: (t, te, ph) => ({ y: .035 * Math.sin(t * 1.7 + ph), rot: .035 * Math.sin(t * .9 + ph * 1.3) }),
    hop: (t, te, ph) => hopCurve(((t + ph) % 1.1) / 1.1, .2, .55),
    bounce: (t, te, ph) => Object.assign(hopCurve(((t + ph) % .62) / .62, .17, .6), { rot: .06 * Math.sin(t * 5 + ph) }),
    giggle: (t, te, ph) => ({ y: .025 * Math.abs(Math.sin(t * 16)), rot: .07 * Math.sin(t * 8) + .05, sx: 1 + .025 * Math.sin(t * 32), sy: 1 - .025 * Math.sin(t * 32) }),
    sway: (t, te, ph) => ({ x: -.03, y: .02 * Math.sin(t * 1.7 + ph), rot: .12 + .05 * Math.sin(t * 1.3 + ph) }),
    doze: (t, te, ph) => {
      const c = ((t + ph) % 4.4) / 4.4, nod = c < .78 ? Math.pow(c / .78, 2) : 1 - (c - .78) / .22;
      return { y: -.04 - .06 * nod + .015 * Math.sin(t * 1.1), rot: .06 * Math.sin(t * .6 + ph) + .1 * nod, scale: 1 + .025 * Math.sin(t * 1.1), lid: -.75 * nod + (c > .78 && c < .86 ? .5 : 0) };
    },
    sink: (t, te, ph) => { const s = ((t + ph) % 4.2) / 4.2, sigh = Math.exp(-Math.pow((s - .2) / .08, 2)); return { y: -.07 + .012 * Math.sin(t * 1.3) + .03 * sigh, sx: 1.05 - .03 * sigh, sy: .94 + .04 * sigh }; },
    sob: (t, te, ph) => { const u = ((t + ph) % .85) / .85, k = Math.exp(-u * 9); return { x: .008 * Math.sin(t * 40), y: -.04 + .055 * k, sy: .95 + .07 * k, sx: 1.04 - .05 * k }; },
    fume: (t) => ({ x: .012 * Math.sin(t * 47) + .008 * Math.sin(t * 31), y: .005 * Math.sin(t * 37), scale: 1.04 + .015 * Math.sin(t * 6), sy: 1.03 }),
    jump: (t, te) => {
      if (te < .5) { const v = te / .5, s = Math.abs(2 * v - 1); return { y: .32 * 4 * v * (1 - v), lift: 4 * v * (1 - v), sy: 1 + .12 * s, sx: 1 - .08 * s }; }
      const g = te - .5, sq = .16 * Math.exp(-g * 7) * Math.cos(g * 14);
      return { y: 0, sy: 1 - sq, sx: 1 + sq * .8, x: .005 * Math.sin(t * 33) };
    },
    shiver: (t) => ({ x: .018 * Math.sin(t * 58), y: -.03 + .006 * Math.sin(t * 43), rot: .02 * Math.sin(t * 41) }),
    tilt: (t, te, ph) => { const s = Math.sin(t * .9 + ph); return { y: .025 * Math.sin(t * 1.6 + ph), rot: .24 * Math.sign(s) * Math.pow(Math.abs(s), .35) }; },
    wobble: (t, te, ph) => ({ x: .06 * Math.sin(t * 1.15 + ph), y: .03 * Math.sin(t * 2.3 + ph), rot: .22 * Math.sin(t * 2.3 + ph) }),
    pulse: (t, te, ph) => { const u = (t + ph) % 1, b = Math.exp(-Math.pow(u / .07, 2)) + .6 * Math.exp(-Math.pow((u - .22) / .07, 2)); return { y: .03 * Math.sin(t * 1.4 + ph), rot: .05 * Math.sin(t * 1.2 + ph), scale: 1 + .065 * b }; },
    lean: (t, te, ph) => ({ y: .02 * Math.sin(t * 1.6 + ph), rot: -.11 + .02 * Math.sin(t * 1.3 + ph) }),
    hopOnce: (t, te, ph) => (te < .5 ? Object.assign(hopCurve(te / .7, .16, .7), { rot: .08 }) : { y: .035 * Math.sin(t * 1.7 + ph), rot: .08 + .03 * Math.sin(t * .9 + ph) }),
  };
  Object.assign(MOTION, {
    nod: (t, te, ph) => ({ x: .03, y: -.01 + .015 * Math.sin(t * 1.6 + ph) - .035 * Math.pow(Math.max(0, Math.sin(t * 4.4)), 6), rot: -.08 }),
    still: (t, te, ph) => ({ y: .015 * Math.sin(t * 1.3 + ph) }),
    ponder: (t, te, ph) => ({ y: .025 * Math.sin(t * 1.1 + ph), rot: .1 + .05 * Math.sin(t * .8 + ph) }),
    bob: (t, te, ph) => ({ y: .03 * Math.sin(t * 2.2 + ph), rot: -.04 + .02 * Math.sin(t * 1.1 + ph) }),
    scan: (t) => ({ x: .05 * Math.sin(t * 1.2), y: .015 * Math.sin(t * 2.4), rot: -.06 * Math.sin(t * 1.2) }),
    type: (t) => ({ x: .004 * Math.sin(t * 23), y: .012 * Math.abs(Math.sin(t * 14)), rot: .015 * Math.sin(t * 7) }),
    antic: (t, te, ph) => Object.assign(hopCurve(((t + ph) % .9) / .9, .06, .35), { rot: .03 * Math.sin(t * 2 + ph) }),
    tense: (t) => ({ x: .006 * Math.sin(t * 31), y: -.01, rot: -.04 + .01 * Math.sin(t * 17), sy: 1.02 }),
    groove: (t) => ({ y: .035 * Math.abs(Math.sin(t * Math.PI * 2)), rot: .08 * Math.sin(t * Math.PI), sy: 1 - .02 * Math.abs(Math.sin(t * Math.PI * 2)) }),
    sip: (t, te, ph) => ({ y: .02 * Math.sin(t * .9 + ph), rot: .04 * Math.sin(t * .6 + ph) }),
    cool: (t, te, ph) => ({ x: -.02, y: .012 * Math.sin(t * 2.8 + ph), rot: .1 + .03 * Math.sin(t * 1.4 + ph) }),
  });

  // spring constants per animated key: [rest, omega, zeta]
  const KEYS = {
    eyeScale: [1, 18, .5], eyeWm: [1, 18, .6], eyeHm: [1, 18, .6], lidAng: [0, 16, .75], lidYL: [1, 16, .75], lidYR: [1, 16, .75], lowLidL: [0, 16, .65], lowLidR: [0, 16, .65],
    scaleL: [1, 16, .55], scaleR: [1, 16, .55], offYL: [0, 16, .7], offYR: [0, 16, .7], mouthSize: [1, 16, .55], mouthOpen: [0, 16, .6],
    blush: [0, 8, .9], tears: [0, 6, 1], sweat: [0, 8, .9], propAmt: [0, 7, 1],
    perk: [0, 9, .45], stretch: [1, 10, .38], sharp: [0, 9, .6], curl: [0, 9, .55], droop: [0, 7, .6], wiggleAmp: [0, 8, .8], wiggleFreq: [0, 6, 1], soft: [0, 8, .7],
    glow: [1, 6, .9], tintR: [1, 6, 1], tintG: [1, 6, 1], tintB: [1, 6, 1], tintA: [0, 6, .9], scale: [1, 10, .45], grow: [1, 11, .62], spin: [0, 5, 1],
    accAmt: [0, 14, .55], badgeAmt: [0, 16, .42], ringAmt: [0, 8, 1], desat: [0, 5, 1], waveAmp: [0, 9, .6], faceY: [0, 10, .7],
  };
  const DIRECT = ['eyeScale', 'eyeWm', 'eyeHm', 'scaleL', 'scaleR', 'offYL', 'offYR', 'mouthSize', 'mouthOpen', 'blush', 'tears', 'sweat', 'perk', 'stretch', 'sharp', 'curl', 'droop', 'wiggleAmp', 'wiggleFreq', 'soft', 'glow', 'scale', 'spin', 'desat', 'faceY'];

  class Buddy {
    constructor(o = {}) {
      const c = o.cast ? CAST_BY_ID[o.cast] : null;
      this.cast = c;
      this.seed = o.seed ?? c?.body.seed ?? 1 + Math.floor(Math.random() * 999998);
      this.body = makeBody(this.seed, Object.assign({}, c?.body, o.body));
      this.eyes = makeEyes(this.seed, Object.assign({}, c?.eyes, o.eyes));
      this.palette = o.palette ?? c?.palette ?? Math.floor(Math.random() * PALETTES.length);
      this.style = o.style ?? c?.style ?? 2;
      this.rest = o.rest ?? c?.rest ?? 'calm';
      this.x = o.x ?? 0; this.y = o.y ?? 0; this.R = o.R ?? 40;
      this.frame = o.frame ?? 0; this.frameC = o.frameC ?? [0, .5]; this.frameH = o.frameH ?? 1.5;
      this.watch = o.watch ?? true;
      this.face = o.face ?? true;
      this.mouthSet = o.mouth ?? true;
      this.propsOn = o.props ?? !this.frame;
      this.signals = o.signals ?? true;
      this.motionScale = o.motionScale ?? 1;
      this.faceScale = o.faceScale ?? 1;
      this.clip = o.clip || null;
      this.cut = o.cut || null;
      this.seedF = 1 + ((this.seed * .618034) % 1) * 97;
      this.ph = Math.random() * 10;
      this.waveIdx = nearestPoint(this.body.pts, .35);
      this.topIdx = nearestPoint(this.body.pts, Math.PI / 2);
      this.t = 0; this.alpha = 1; this.fade = null; this.dead = false;
      this.st = {}; this.vel = {};
      for (const k in KEYS) { this.st[k] = KEYS[k][0]; this.vel[k] = 0; }
      this.look = [0, 0]; this.lookV = [0, 0]; this.sac = [0, 0]; this.nextSac = 0; this.attend = null;
      this.glyph = 0; this.pendingGlyph = null;
      this.mouthA = 0; this.mouthB = 0; this.mouthMix = 1;
      this.propA = 0; this.propB = 0; this.propMix = 1; this.propStart = 0;
      this.acc = 0; this.accWant = 0; this.badge = 0; this.badgeWant = 0; this.ring = 0; this.ringWant = 0;
      this.blinkT0 = -9; this.blinkDur = .16; this.nextBlink = rnd(1, 4);
      this.wigPhase = Math.random() * 6; this.spinPhase = 0;
      this.motion = 'float'; this.motionPrev = 'float'; this.motionFade = 1; this.emoStart = 0;
      this.emotion = null; this.rec = ALL.calm.r; this.queue = []; this.until = Infinity;
      this.bornAt = null; this.wakeAt = null;
      this.feel(o.emotion ?? this.rest);
      this.settle();
    }
    feel(name, hold) {
      const e = ALL[name]; if (!e) return this;
      this.until = hold != null ? this.t + hold : Infinity;
      if (name === this.emotion) return this;
      this.emotion = name; this.emoStart = this.t;
      this.rec = recipe(e, this.mouthSet);
      this.motionPrev = this.motion; this.motion = this.rec.motion || 'float'; this.motionFade = 0;
      this.applyDiscrete();
      this.nextBlink = Math.min(this.nextBlink, this.t + this.blinkGap());
      return this;
    }
    setMouth(on) {
      if (this.mouthSet === on) return this;
      this.mouthSet = on;
      if (this.emotion) { this.rec = recipe(ALL[this.emotion], on); this.applyDiscrete(); }
      return this;
    }
    applyDiscrete() {
      const r = this.rec;
      const g = GLYPH[r.glyph || 'pill'];
      if (g !== (this.pendingGlyph ?? this.glyph)) { this.pendingGlyph = g; this.blinkNow(.2); }
      const m = MOUTH[r.mouth || 'none'];
      if (m !== this.mouthB) { this.mouthA = this.mouthMix > .5 ? this.mouthB : this.mouthA; this.mouthB = m; this.mouthMix = 0; }
      const pr = PROP[r.prop || 'none'];
      if (pr !== this.propB) { this.propA = this.propMix > .5 ? this.propB : this.propA; this.propB = pr; this.propMix = 0; this.propStart = this.t; }
      this.accWant = ACC[r.acc || 'none'];
      this.badgeWant = this.signals ? BADGE[r.badge || 'none'] : 0; this.ringWant = this.signals ? RING[r.ring || 'none'] : 0;
    }
    // agents: make a status the resting state, dropping anything queued
    status(id) { this.rest = id; this.queue = []; return this.feel(id); }
    play(list) { this.queue = list.slice(1); this.feel(list[0][0], list[0][1]); return this; }
    poke() {
      this.vel.scale -= 2.8;
      const pick = ['laugh', 'happy', 'love', 'starstruck'][Math.floor(Math.random() * 4)];
      return this.play([['surprised', .4], [pick, 1.9]]);
    }
    birth(at, seq = [['surprised', .9], ['happy', 1.7]]) {
      this.t = at; this.bornAt = at; this.wakeAt = at + .55;
      this.st.grow = 0; this.vel.grow = 0; this.st.scale = .55; this.vel.scale = 0;
      this.queue = seq.slice(1); this.emotion = null; this.feel(seq[0][0], seq[0][1]);
      return this;
    }
    leave(at) { this.fade = at; return this; }
    blinkGap() { const b = this.rec.blink || [2.2, 5.2]; return rnd(b[0], b[1]); }
    blinkNow(dur = .16) { if (this.t - this.blinkT0 > this.blinkDur) { this.blinkT0 = this.t; this.blinkDur = dur; } }
    blinkValue() {
      const u = (this.t - this.blinkT0) / this.blinkDur;
      if (u < 0 || u > 1) return 0;
      return u < .4 ? u / .4 : u < .55 ? 1 : 1 - (u - .55) / .45;
    }
    targets() {
      const r = this.rec, ey = this.eyes, T = this._T || (this._T = {});
      for (const k in KEYS) T[k] = KEYS[k][0];
      T.lidYL = T.lidYR = r.lidY ?? ey.lidY ?? 1;
      T.lidAng = r.lidAng ?? ey.lidAng ?? 0;
      T.lowLidL = T.lowLidR = r.lowLid ?? 0;
      if (r.lidYL != null) T.lidYL = r.lidYL;
      if (r.lidYR != null) T.lidYR = r.lidYR;
      if (r.lowLidL != null) T.lowLidL = r.lowLidL;
      if (r.lowLidR != null) T.lowLidR = r.lowLidR;
      for (const k of DIRECT) if (r[k] != null) T[k] = r[k];
      if (r.wave != null) T.waveAmp = r.wave;
      if (r.tint) { T.tintR = r.tint[0]; T.tintG = r.tint[1]; T.tintB = r.tint[2]; T.tintA = r.tint[3]; } else { T.tintR = this.st.tintR; T.tintG = this.st.tintG; T.tintB = this.st.tintB; }
      T.propAmt = r.prop ? (r.propAmt ?? 1) : 0;
      T.accAmt = this.acc && this.acc === this.accWant ? 1 : 0;
      T.badgeAmt = this.badge && this.badge === this.badgeWant ? 1 : 0;
      T.ringAmt = this.ring && this.ring === this.ringWant ? 1 : 0;
      return T;
    }
    settle() {
      this.acc = this.accWant; this.badge = this.badgeWant; this.ring = this.ringWant;
      const T = this.targets();
      for (const k in KEYS) { this.st[k] = T[k]; this.vel[k] = 0; }
      if (this.pendingGlyph != null) { this.glyph = this.pendingGlyph; this.pendingGlyph = null; }
      this.mouthMix = 1; this.propMix = 1; this.motionFade = 1; this.blinkT0 = -9;
      this.look = this.lookTarget(); this.lookV = [0, 0];
      return this;
    }
    lookTarget() {
      const r = this.rec, base = this.eyes.look || [0, 0], t = this.t, g = r.gaze;
      let tx = base[0] + (r.lookX ?? 0), ty = base[1] + (r.lookY ?? 0);
      if (g === 'scan') { tx = .62 * Math.sin(t * 1.2); ty = -.05; }
      else if (g === 'read') { const u = (t * .65) % 1, line = Math.floor(t * .65) % 3; tx = -.6 + 1.2 * Math.min(1, u * 1.3); ty = -.25 - line * .14; }
      else if (g === 'orbit') { const a = t * 2.4 + this.seedF; tx = Math.cos(a) * .9; ty = Math.sin(a) * .9; }
      else if (g === 'bug') { const a = -t * .8 + this.seedF * .7; tx = Math.cos(a) * .9; ty = Math.sin(a) * .85; }
      else if (g === 'composer') { tx = .55; ty = -.45; }
      else if (g === 'fixed') {
        if (t > this.nextSac) { this.sac = [rnd(-.07, .07), rnd(-.05, .05)]; this.nextSac = t + rnd(.6, 1.8); }
        tx += this.sac[0]; ty += this.sac[1];
      } else if (g !== 'none') {
        const focus = this.attend && t < this.attend.until ? this.attend : (this.watch && this.engine && this.engine.pointer) || null;
        if (focus) {
          const dx = focus.x - this.x, dy = this.y - focus.y, dist = Math.hypot(dx, dy) || 1, k = Math.min(1, dist / (this.R * 3));
          let lx = dx / dist * k, ly = dy / dist * k;
          if (r.avoid) { lx = -lx * .7; ly = -.55; }
          tx = tx * .3 + lx * .9; ty = ty * .3 + ly * .9;
        } else if (g === 'user') { tx = 0; ty = 0; }
        else {
          if (t > this.nextSac) { this.sac = [rnd(-.35, .35), rnd(-.22, .22)]; this.nextSac = t + rnd(.8, 2.8) * (r.fastEyes ? .25 : 1); }
          tx += this.sac[0]; ty += this.sac[1];
        }
      }
      const m = Math.hypot(tx, ty);
      return m > 1 ? [tx / m, ty / m] : [tx, ty];
    }
    update(t, dt) {
      this.t = t;
      if (this.bornAt != null && t < this.bornAt) { this.alpha = 0; if (this.fade != null && t > this.fade) this.dead = true; return; }
      this.alpha = 1;
      if (this.fade != null) { const f = clamp((t - this.fade) / .45, 0, 1); this.alpha = 1 - f; this.st.scale = 1 - .6 * f; if (f >= 1) this.dead = true; }
      if (t > this.until) { const nx = this.queue.shift(); if (nx) this.feel(nx[0], nx[1]); else this.feel(this.rest); }
      dt = Math.min(dt, 1 / 30);
      const T = this.targets();
      for (const k in KEYS) {
        if (this.fade != null && k === 'scale') continue;
        const [, w, z] = KEYS[k];
        const a = w * w * (T[k] - this.st[k]) - 2 * z * w * this.vel[k];
        this.vel[k] += a * dt; this.st[k] += this.vel[k] * dt;
      }
      // accessories, badges and rings swap only once the old one has gone
      if (this.acc !== this.accWant && this.st.accAmt < .04) { this.acc = this.accWant; this.st.accAmt = 0; this.vel.accAmt = 0; }
      if (this.badge !== this.badgeWant && this.st.badgeAmt < .04) { this.badge = this.badgeWant; this.st.badgeAmt = 0; this.vel.badgeAmt = 0; }
      if (this.ring !== this.ringWant && this.st.ringAmt < .04) { this.ring = this.ringWant; this.st.ringAmt = 0; this.vel.ringAmt = 0; }
      if (this.wakeAt != null && t < this.wakeAt) { this.blinkT0 = t - this.blinkDur * .45; this.blinkDur = .3; }
      else if (t > this.nextBlink) { this.blinkNow(this.emotion === 'sleepy' ? .5 : .16); this.nextBlink = t + this.blinkGap() * (Math.random() < .2 ? .12 : 1); }
      if (this.pendingGlyph != null && (this.blinkValue() > .85 || this.t - this.blinkT0 > this.blinkDur)) {
        this.glyph = this.pendingGlyph; this.pendingGlyph = null;
        if (this.glyph === 1 || this.glyph === 2) this.vel.eyeScale += 6;
      }
      this.mouthMix = Math.min(1, this.mouthMix + dt / .18);
      this.propMix = Math.min(1, this.propMix + dt / .3);
      this.motionFade = Math.min(1, this.motionFade + dt / .4);
      const lk = this.lookTarget();
      for (let i = 0; i < 2; i++) { const a = 24 * 24 * (lk[i] - this.look[i]) - 2 * .78 * 24 * this.lookV[i]; this.lookV[i] += a * dt; this.look[i] += this.lookV[i] * dt; }
      this.wigPhase += this.st.wiggleFreq * dt;
      this.spinPhase += this.st.spin * dt;
    }
    motionAt(name) {
      const f = MOTION[name] || MOTION.float;
      return Object.assign({ x: 0, y: 0, rot: 0, sx: 1, sy: 1, scale: 1, lift: 0, lid: 0 }, f(this.t, this.t - this.emoStart, this.ph));
    }
    // where the top point's tip is right now, so a nightcap can sit on it (body space, R units)
    capAnchor(grow) {
      const b = this.body, s = this.st, pt = b.pts[this.topIdx];
      const a = pt[0] + (s.perk - s.droop * .5) * .3 * Math.sin(Math.PI / 2 - pt[0]);
      const dx = Math.cos(a), dy = Math.sin(a), qx = -dy, qy = dx;
      const hw = pt[2] * lerp(1, .74, s.sharp) * lerp(1, 1.1, s.soft) * lerp(.55, 1, grow);
      const tip = hw * lerp(b.tip, .22, s.sharp);
      const L = Math.max(pt[1] * s.stretch * grow, hw - tip + .002);
      const bend = pt[3] - s.droop * dx * .45 + s.curl * .7;
      return [dx * L + qx * bend * L * L, dy * L + qy * bend * L * L, Math.atan2(dy + qy * 2 * bend * L, dx + qx * 2 * bend * L), tip];
    }
    write(f, o) {
      const s = this.st, e = this.eyes, b = this.body, ms = this.motionScale, fs = this.faceScale;
      const a = this.motionAt(this.motionPrev), m = this.motionAt(this.motion), w = this.motionFade;
      const mv = {}; for (const k in m) mv[k] = lerp(a[k], m[k], w);
      if (ms !== 1) { mv.x *= ms; mv.y *= ms; mv.rot *= ms; mv.lift *= ms; mv.sx = 1 + (mv.sx - 1) * ms; mv.sy = 1 + (mv.sy - 1) * ms; mv.scale = 1 + (mv.scale - 1) * ms; }
      const sy = mv.sy, sx = mv.sx, grow = clamp(s.grow, 0, 1.1);
      const set = (i, x, y, z, ww) => { const k = o + i * 4; f[k] = x; f[k + 1] = y; f[k + 2] = z; f[k + 3] = ww; };
      const S = this.frame ? Math.max(2.25, Math.abs(this.frameC[0]) + this.frameH * 1.32, Math.abs(this.frameC[1]) + this.frameH * 1.32) : 2.25;
      set(0, this.x, this.y, this.alpha > 0 ? this.R : 0, this.seedF);
      set(1, this.style, this.palette, this.frame, S);
      set(2, this.frameC[0], this.frameC[1], this.frameH, this.alpha);
      set(3, mv.x, mv.y - (1 - sy) * .85, mv.rot, Math.max(.01, s.scale * mv.scale));
      set(4, sx, sy, mv.lift, grow);
      set(5, b.n, b.core, b.k, b.tip);
      set(6, s.perk, s.stretch, s.sharp, s.curl);
      set(7, s.wiggleAmp * Math.min(1, ms), this.wigPhase, s.droop, s.soft);
      set(8, e.gap * (1 + (fs - 1) * .6), e.y, e.w * s.eyeWm * s.eyeScale * fs, e.h * s.eyeHm * s.eyeScale * fs);
      set(9, e.tilt || 0, s.lidAng, this.blinkValue(), this.face ? 1 : 0);
      set(10, s.lidYL + mv.lid, s.lidYR + mv.lid, s.lowLidL, s.lowLidR);
      set(11, s.scaleL, s.scaleR, s.offYL, s.offYR);
      set(12, this.look[0], this.look[1], this.glyph, e.shape);
      set(13, this.mouthA, this.mouthB, this.mouthMix, s.mouthSize * (e.mouthScale ?? 1.4) * fs);
      set(14, s.mouthOpen, e.mouthY * fs, s.blush, s.tears);
      set(15, s.sweat, this.propA, this.propB, this.propMix);
      set(16, s.tintR, s.tintG, s.tintB, s.tintA);
      set(17, s.glow, 0, this.spinPhase, s.propAmt);
      set(18, this.propStart, clamp(s.accAmt, 0, 1.2), this.acc, s.faceY);
      set(19, this.badge, Math.max(0, s.badgeAmt), this.ring, clamp(s.ringAmt, 0, 1));
      for (let i = 0; i < 8; i++) { const pt = b.pts[i]; if (pt) set(20 + i, pt[0], pt[1], pt[2], pt[3]); }
      set(28, clamp(s.desat, 0, 1), this.waveIdx, s.waveAmp, this.propsOn ? 1 : 0);
      const c = this.clip;
      set(29, c ? c[0] : -1e5, c ? c[1] : -1e5, c ? c[2] : 1e5, c ? c[3] : 1e5);
      const cap = this.acc === 8 ? this.capAnchor(grow) : null;
      set(30, cap ? cap[0] : 0, cap ? cap[1] : 0, cap ? cap[2] : 0, cap ? cap[3] : 0);
      const k = this.cut;
      set(31, k ? k[0] : 0, k ? k[1] : 0, k ? k[2] : 0, k ? 1 : 0);
    }
  }

  // ---------------------------------------------------------------- renderer
  function compile(gl, vs, fs) {
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i), name = info.name.replace('[0]', ''); u[name] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }

  class Engine {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.opts = Object.assign({ max: 32, dprCap: 2, shadow: false }, opts);
      const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: !!this.opts.preserve });
      if (!gl) throw new Error('WebGL2 is not available');
      this.gl = gl;
      this.prog = compile(gl, VS, FS);
      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 32, this.opts.max);
      this.data = new Float32Array(32 * 4 * this.opts.max);
      this.pal = new Float32Array(PALETTES.flatMap((p) => p.c.flatMap(hex)));
      this.deep = new Float32Array(PALETTES.flatMap((p) => p.deep.flatMap(hex)));
      this.vao = gl.createVertexArray();
      this.buddies = []; this.pointer = null; this.lastT = null; this.cut = [1, 1, 1];
      this.resize();
    }
    add(b) { if (this.buddies.length >= this.opts.max) this.buddies.shift(); b.engine = this; this.buddies.push(b); return b; }
    remove(b) { this.buddies = this.buddies.filter((x) => x !== b); }
    clear() { this.buddies = []; }
    resize() {
      const r = this.canvas.getBoundingClientRect();
      this.dpr = Math.min(window.devicePixelRatio || 1, this.opts.dprCap);
      this.cssW = Math.max(1, r.width); this.cssH = Math.max(1, r.height);
      const w = Math.round(this.cssW * this.dpr), h = Math.round(this.cssH * this.dpr);
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    }
    settle() { for (const b of this.buddies) b.settle(); }
    render(t, opts = {}) {
      const gl = this.gl;
      const dt = this.lastT == null ? 0 : clamp(t - this.lastT, 0, .05);
      this.lastT = t;
      if (!opts.frozen) for (const b of this.buddies) b.update(t, dt);
      this.buddies = this.buddies.filter((b) => !b.dead);
      const list = this.buddies.filter((b) => !b.hidden).sort((a, b) => a.y - b.y);
      list.forEach((b, i) => b.write(this.data, i * 128));
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      if (!list.length) return;
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 32, list.length, gl.RGBA, gl.FLOAT, this.data);
      const P = this.prog;
      gl.useProgram(P.p); gl.bindVertexArray(this.vao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(P.u.uData, 0);
      gl.uniform2f(P.u.uView, this.cssW, this.cssH);
      gl.uniform1f(P.u.uTime, t); gl.uniform1f(P.u.uDpr, this.dpr); gl.uniform1f(P.u.uShadow, this.opts.shadow ? 1 : 0);
      gl.uniform3fv(P.u.uCut, this.cut);
      gl.uniform3fv(P.u.uPal, this.pal); gl.uniform3fv(P.u.uDeep, this.deep);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, list.length);
    }
  }

  window.Sparklings = { Engine, Buddy, PALETTES, STYLES, EMOTIONS, STATUSES, CAST, makeBody, makeEyes, MOTION, agentDNA, hashId };
})();
