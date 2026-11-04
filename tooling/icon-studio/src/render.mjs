import { animate, createEngine, markSVG, smallK, smallParams, smallPost, smallPxScale } from '../vendor/wormhole.mjs';
import { artParams } from './model.mjs';
import { encodePng } from './formats.mjs';

const svgBody = svg => svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const xml = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

// Fit the actual outline and lights to the maskable safe circle, even after extreme edits.
export function fitMarkParams(input, size, time = 0) {
  let p = { ...input, panX: 0, panY: 0, markX: 0, markY: 0 };
  for (let pass = 0; pass < 4; pass++) {
    const source = markSVG(p, animate(p, p.livPose === 'at rest' ? 0 : time), { size, background: false });
    let radius = 0;
    for (const match of source.matchAll(/<path\b[^>]*d="([^"]+)"[^>]*>/g)) {
      const coords = (match[1].match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      const width = Number(match[0].match(/stroke-width="([^"]+)"/)?.[1] ?? 0) / 2;
      for (let i = 0; i + 1 < coords.length; i += 2) radius = Math.max(radius, Math.hypot(coords[i] - size/2, coords[i+1] - size/2) + width);
    }
    if (radius <= size * .395) return p;
    p.zoom *= size * .39 / radius;
  }
  return p;
}

function tilePath(size, inset = 1, exponent = 5) {
  const radius = size * inset / 2;
  return Array.from({ length: 257 }, (_, i) => {
    const a = i / 256 * Math.PI * 2;
    const x = size / 2 + radius * Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** (2 / exponent);
    const y = size / 2 + radius * Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** (2 / exponent);
    return `${i ? 'L' : 'M'}${x.toFixed(3)} ${y.toFixed(3)}`;
  }).join('') + 'Z';
}

export function createRenderer() {
  let engine = null;
  let initialization = null;
  let lost = false;
  const errors = [];
  async function init() {
    if (!initialization) initialization = createEngine({ source: globalThis.__MARK_WGSL__, smallSource: globalThis.__SHRINK_WGSL__, onError: message => errors.push(message) }).then(e => {
      engine = e;
      e.device.lost.then(info => { lost = true; errors.push(info.message || 'The graphics device was lost. Reload to restore dust rendering.'); });
      return e;
    });
    return initialization;
  }

  function svg(recipe, options = {}) {
    const { size = 1024, appearance = recipe.appearance, layer = 'composite', purpose = 'app', state = 'ready', adaptive = false, shape = 'square', maskable = false } = options;
    const tray = purpose === 'tray';
    const favicon = purpose === 'favicon';
    const light = appearance === 'light';
    const points = options.pointSize ?? size;
    const pixelScale = size / points;
    const mono = tray || (favicon && points <= 16);
    let p = artParams(recipe, appearance, { mask: 'square', markOnly: true, monochrome: mono, weight: tray ? recipe.trayWeight : favicon ? recipe.faviconWeight : 1, size: points });
    if (!tray && p.smallMode === 'tuned') p = smallParams(p, points);
    p.livHairline *= pixelScale;
    p.livMinWidth *= pixelScale;
    if (tray) {
      Object.assign(p, { ink: light ? '#000000' : '#FFFFFF', livHeight: Math.max(p.livHeight, 0.43), zoom: 1, panX: 0, panY: 0, spin: 0, markX: 0, markY: 0, livScale: 1.02, livHairline: Math.max(1, points / 22) * pixelScale, livMinWidth: Math.max(1.3, points / 18) * pixelScale, livPose: 'at rest' });
    }
    if (favicon) Object.assign(p, { livLineGlow: 0, livScale: Math.min(p.livScale, 1.05), livHairline: Math.max(p.livHairline, (points <= 32 ? 1 : 0.65) * pixelScale) });
    if (maskable) p = fitMarkParams(p, size, recipe.time);
    // Exportable master logos are static snapshots of the exact lab geometry.
    const ph = animate(p, p.livPose === 'at rest' ? 0 : recipe.time);
    let body = svgBody(markSVG(p, ph, { size, background: false }));
    if (tray) {
      // A real alpha knockout keeps each state legible on every menu-bar tint.
      const cx = size * 0.79, cy = size * 0.68, r = size * 0.145;
      if (state !== 'ready') {
        const circle = `<circle cx="${cx}" cy="${cy}" r="${r + size * 0.045}" fill="black"/>`;
        body = `<defs><mask id="tray-cut"><rect width="${size}" height="${size}" fill="white"/>${circle}</mask></defs><g mask="url(#tray-cut)">${body}</g>`;
        if (state === 'update') body += `<circle cx="${cx}" cy="${cy}" r="${r * .7}" fill="${p.ink}"/>`;
        else {
          const cut = state === 'offline'
            ? `<rect x="${cx-r*.58}" y="${cy-size*.025}" width="${r*1.16}" height="${size*.05}" fill="black"/>`
            : `<rect x="${cx-size*.026}" y="${cy-r*.65}" width="${size*.052}" height="${r*.86}" rx="${size*.02}" fill="black"/><circle cx="${cx}" cy="${cy+r*.5}" r="${size*.028}" fill="black"/>`;
          body += `<defs><mask id="badge-cut"><rect width="${size}" height="${size}" fill="white"/>${cut}</mask></defs><circle cx="${cx}" cy="${cy}" r="${r}" fill="${p.ink}" mask="url(#badge-cut)"/>`;
        }
      }
      if (options.keyline) body = `<defs><filter id="keyline" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feMorphology in="SourceAlpha" operator="dilate" radius="${size*.045}" result="spread"/><feFlood flood-color="${light ? 'white' : '#171719'}" result="edge"/><feComposite in="edge" in2="spread" operator="in" result="outline"/><feMerge><feMergeNode in="outline"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><g filter="url(#keyline)">${body}</g>`;
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
    }
    const ink = light ? '#000000' : '#FFFFFF';
    if (adaptive) body = body.replaceAll(`"${ink}"`, '"var(--mark)"');
    const background = light ? recipe.lightGround : recipe.darkGround;
    const noGround = layer === 'mark' || (favicon && recipe.faviconStyle === 'mark');
    let backgroundShape = '';
    if (!noGround) {
      const fill = adaptive ? 'var(--ground)' : background;
      backgroundShape = shape === 'tile' || favicon ? `<path d="${tilePath(size, 1, recipe.params.squircle)}" fill="${fill}"/>` : `<rect width="${size}" height="${size}" fill="${fill}"/>`;
    }
    if (shape === 'macos') {
      body = `<g transform="translate(${size*.09765625} ${size*.09765625}) scale(.8046875)">${body}</g>`;
      backgroundShape = noGround ? '' : `<path d="${tilePath(size, .8046875, recipe.params.squircle)}" fill="${background}"/>`;
    }
    if (layer === 'background') body = '';
    if (!noGround && (shape === 'macos' || shape === 'tile' || favicon)) body = `<defs><clipPath id="tile-clip"><path d="${tilePath(size, shape === 'macos' ? .8046875 : 1, recipe.params.squircle)}"/></clipPath></defs><g clip-path="url(#tile-clip)">${body}</g>`;
    if (shape === 'circle') { body = `<g clip-path="url(#circle)">${body}</g>`; backgroundShape = noGround ? '' : `<circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="${background}"/>`; }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><title>${xml(recipe.name)} icon</title>${adaptive ? `<style>:root{--mark:#000;--ground:${recipe.lightGround}}@media(prefers-color-scheme:dark){:root{--mark:#fff;--ground:${recipe.darkGround}}}</style>` : ''}${shape === 'circle' ? `<defs><clipPath id="circle"><circle cx="${size/2}" cy="${size/2}" r="${size/2}"/></clipPath></defs>` : ''}${backgroundShape}${body}</svg>`;
  }

  async function rasterSvg(source, size) {
    const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, size, size);
      return ctx.getImageData(0, 0, size, size).data;
    } finally { URL.revokeObjectURL(url); }
  }

  async function pixels(recipe, size, options = {}) {
    if (!Number.isInteger(size) || size < 1 || size > 2048) throw new Error('Export sizes must be between 1 and 2048 pixels.');
    const { appearance = recipe.appearance, shape = 'square', layer = 'composite', maskable = false, purpose = 'app', opaque = false, pointSize = size } = options;
    let rgba;
    if (recipe.style === 'plain' || layer === 'mark' || purpose === 'tray' || purpose === 'favicon') {
      rgba = await rasterSvg(svg(recipe, { ...options, size }), size);
    } else {
      const e = await init();
      if (lost) throw new Error('The graphics device was lost. Reload the studio to export dust artwork.');
      let p = artParams(recipe, appearance, { mask: shape === 'macos' ? 'macOS' : shape === 'tile' ? 'iOS' : shape, size: pointSize });
      if (maskable) p = fitMarkParams(p, size, recipe.time);
      const t = recipe.time;
      if (p.smallMode === 'at size') rgba = await e.pixels(p, animate(p, t), size, size, { mark: layer !== 'background' });
      else {
        const tuned = p.smallMode === 'tuned';
        let draw = tuned ? smallParams(p, pointSize) : p;
        if (maskable) draw = fitMarkParams(draw, size, recipe.time);
        const k = smallK(size);
        rgba = (await e.pixelsSmall(draw, animate(draw, t), size, size, { k, post: tuned ? smallPost(p, pointSize) : {}, pxScale: tuned ? smallPxScale(p, pointSize, k) : 1, mark: layer !== 'background' })).px;
      }
      if (errors.length) throw new Error(errors[errors.length - 1]);
    }
    rgba = new Uint8ClampedArray(rgba);
    if (opaque || appearance === 'tinted' || options.grayscale) {
      const ground = appearance === 'light' ? recipe.lightGround : recipe.darkGround;
      const rgb = [1, 3, 5].map(i => parseInt(ground.slice(i, i + 2), 16));
      for (let i = 0; i < rgba.length; i += 4) {
        if (opaque) {
          const a = rgba[i + 3] / 255;
          for (let c = 0; c < 3; c++) rgba[i + c] = rgba[i + c] * a + rgb[c] * (1 - a);
          rgba[i + 3] = 255;
        }
        if (appearance === 'tinted' || options.grayscale) {
          const gray = Math.round(.2126 * rgba[i] + .7152 * rgba[i + 1] + .0722 * rgba[i + 2]);
          rgba[i] = rgba[i + 1] = rgba[i + 2] = gray;
        }
      }
    }
    return rgba;
  }

  return { init, svg, pixels,
    get gpu() { return Boolean(engine) && !lost; },
    get errors() { return [...errors]; },
    async png(recipe, size, options = {}) { return encodePng({ width: size, height: size, rgba: await pixels(recipe, size, options), opaque: options.opaque === true }); },
    dispose() { engine?.device.destroy(); },
  };
}
