import { PARAMS, normalize, paletteValues, presetValues } from '../vendor/wormhole.mjs';

export const PLATFORMS = [
  { id: 'macos', name: 'macOS', detail: 'Icon Composer · ICNS · iconset', count: 'Light + dark' },
  { id: 'windows', name: 'Windows', detail: 'Multi-resolution ICO + PNG', count: '16–256 px' },
  { id: 'linux', name: 'Linux', detail: 'hicolor PNGs + scalable SVG', count: '16–1024 px' },
  { id: 'ios', name: 'iOS & iPadOS', detail: 'Xcode app icon asset catalog', count: 'Light · dark · tinted' },
  { id: 'visionos', name: 'visionOS', detail: 'Layered Xcode image stack', count: '2 × 1024 px' },
  { id: 'tray', name: 'Menu bar & tray', detail: 'Template PNGs · SVG · ICO', count: '4 status states' },
  { id: 'web', name: 'Website & PWA', detail: 'Favicons · touch · maskable', count: 'SVG · ICO · PNG' },
  { id: 'logo', name: 'Logo masters', detail: 'Static SVG + original living SVG', count: 'Light + dark' },
];
export const STARTERS = [
  { id: 'plain-light', name: 'Plain light', style: 'plain', appearance: 'light', palette: 'own', color: '#fff' },
  { id: 'plain-dark', name: 'Plain dark', style: 'plain', appearance: 'dark', palette: 'own', color: '#181819' },
  { id: 'wormhole', name: 'Wormhole', style: 'dust', appearance: 'dark', palette: 'own', color: '#5365aa' },
  { id: 'obsidian', name: 'Obsidian', style: 'dust', appearance: 'dark', palette: 'obsidian', color: '#4f514b' },
  { id: 'prism', name: 'Prism', style: 'dust', appearance: 'dark', palette: 'prism', color: '#bc80cf' },
  { id: 'deep', name: 'Deep field', style: 'dust', appearance: 'dark', palette: 'own', base: 'deep', color: '#193b53' },
];

export function defaultRecipe() {
  return { version: 1, name: 'VibeField', starter: 'plain-light', style: 'plain', appearance: 'light', palette: 'own', time: 2,
    params: presetValues('wormhole'), lightGround: '#FFFFFF', darkGround: '#000000',
    trayWeight: 1.6, faviconWeight: 1.4, faviconStyle: 'tile', iconAtRest: true,
    targets: PLATFORMS.map(p => p.id) };
}

export function starterRecipe(id, previous = defaultRecipe()) {
  const s = STARTERS.find(x => x.id === id) ?? STARTERS[0];
  const params = { ...presetValues(s.base ?? 'wormhole'), ...(s.palette === 'own' ? {} : paletteValues(s.palette, 'rings')) };
  return { ...defaultRecipe(), name: previous.name, targets: [...previous.targets], starter: s.id, style: s.style, appearance: s.appearance, palette: s.palette, params };
}

export function readRecipe(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Choose an icon-studio recipe or a Wormhole Dust look JSON.');
  if ('version' in input && input.version !== 1) throw new Error(`Unsupported recipe version: ${input.version}`);
  const base = defaultRecipe();
  const isStudio = input.version === 1 && 'targets' in input;
  const raw = input.params ?? input;
  if (!raw || typeof raw !== 'object' || !Object.keys(raw).some(k => Object.hasOwn(PARAMS, k))) throw new Error('This file does not contain any Wormhole Dust parameters.');
  const valid = {};
  const rejected = [];
  for (const [k, v] of Object.entries(raw)) {
    const meta = Object.hasOwn(PARAMS, k) ? PARAMS[k] : null;
    if (!meta || (meta.type === 'number' && (typeof v !== 'number' || !Number.isFinite(v))) || (meta.type === 'bool' && typeof v !== 'boolean') || (meta.type === 'color' && (typeof v !== 'string' || !/^#?[a-f0-9]{6}$/i.test(v))) || (meta.type === 'select' && !meta.options.includes(v))) { rejected.push(k); continue; }
    valid[k] = v;
  }
  const { params } = normalize(valid);
  const dropped = [...rejected];
  for (const [k, value] of Object.entries({ mark: 'living', livProfile: 'flat', livShading: 'flat', livEdge: 'line' })) {
    if (params[k] !== value) dropped.push(`${k} (using the flat ribbon identity)`);
    params[k] = value;
  }
  const clamp = (value, lo, hi, fallback) => Number.isFinite(Number(value)) ? Math.max(lo, Math.min(hi, Number(value))) : fallback;
  const color = (v, fallback) => /^#[0-9a-f]{6}$/i.test(v ?? '') ? v.toUpperCase() : fallback;
  return { recipe: { ...base, params,
    name: typeof input.name === 'string' ? input.name.slice(0, 64) : base.name,
    starter: isStudio && STARTERS.some(s => s.id === input.starter) ? input.starter : 'wormhole',
    style: isStudio && input.style === 'plain' ? 'plain' : 'dust',
    appearance: ['light', 'dark', 'tinted'].includes(input.appearance) ? input.appearance : (params.invert ? 'light' : 'dark'),
    palette: typeof input.palette === 'string' ? input.palette : 'own',
    time: clamp(input.time, 0, 3600, 2),
    trayWeight: clamp(input.trayWeight, 1, 3, 1.6), faviconWeight: clamp(input.faviconWeight, 1, 3, 1.4),
    lightGround: color(input.lightGround, base.lightGround), darkGround: color(input.darkGround, base.darkGround),
    faviconStyle: input.faviconStyle === 'mark' ? 'mark' : 'tile',
    iconAtRest: input.iconAtRest !== false,
    targets: isStudio && Array.isArray(input.targets) ? base.targets.filter(k => input.targets.includes(k)) : base.targets,
  }, dropped };
}

export function slug(name) { return (name || 'vibefield').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vibefield'; }
export const cloneRecipe = recipe => JSON.parse(JSON.stringify(recipe));

// Platform masks override the lab's preview mask. iOS, layers and maskable art remain square.
export function artParams(recipe, appearance = recipe.appearance, { mask = 'square', monochrome = false, weight = 1, size = 1024, markOnly = false } = {}) {
  const light = appearance === 'light';
  let p = { ...recipe.params, mark: 'living', livProfile: 'flat', mask, ink: light ? '#000000' : '#FFFFFF',
    livPose: recipe.iconAtRest ? 'at rest' : recipe.params.livPose, invert: light,
    livThickness: recipe.params.livThickness * weight,
  };
  if (recipe.style === 'plain') Object.assign(p, { ground: 'solid', groundInk: light ? recipe.lightGround : recipe.darkGround, invert: false, vignette: 0, grain: 0 });
  if (markOnly) Object.assign(p, { ground: 'none', invert: false, vignette: 0, grain: 0 });
  if (monochrome) Object.assign(p, { livEdgeFlow: 0, livLineGlow: 0, livGlow: 0 });
  // The subpixel crossing needs a visible hairline, in output pixels, at small sizes.
  const t = Math.min(1, Math.max(0, Math.log2(128 / Math.max(16, size)) / 3));
  p.livHairline = Math.max(p.livHairline, 0.85 * t);
  p.livMinWidth = Math.max(p.livMinWidth, 1.25 * t);
  return p;
}
