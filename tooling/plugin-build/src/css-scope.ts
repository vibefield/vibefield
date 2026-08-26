import postcss, { type AtRule, type Rule } from "postcss";

/**
 * The renderer and every plugin intentionally share one document and one React
 * realm. CSS therefore needs a real ownership boundary of its own: every rule
 * emitted for a plugin is rooted below the host-owned wrapper from plugin spec
 * §11.5. Source order is not an ownership mechanism.
 */

const PLUGIN_ID = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const KEYFRAME_NAME = /^-?[_a-zA-Z][-_a-zA-Z0-9]*$/;
const DOCUMENT_GLOBAL_AT_RULES = new Set([
  "charset",
  "counter-style",
  "custom-media",
  "custom-selector",
  "font-face",
  "font-feature-values",
  "font-palette-values",
  "import",
  "namespace",
  "page",
  "view-transition",
]);

export function pluginStyleRoot(pluginId: string): string {
  if (!PLUGIN_ID.test(pluginId)) {
    throw new Error(`cannot create a CSS scope for invalid plugin id ${JSON.stringify(pluginId)}`);
  }
  return `[data-vf-plugin="${pluginId}"]`;
}

function isInsideKeyframes(rule: Rule): boolean {
  const parent = rule.parent;
  return parent?.type === "atrule" && /(?:^|-)keyframes$/i.test(parent.name);
}

function globalDocumentSelector(selector: string): string | null {
  const match = selector.match(/(^|[\s>+~,(])(?:html|body)(?=$|[\s>+~.#:[,)])/i);
  if (match !== null) return match[0].trim();
  if (selector !== ":root" && /(^|[\s>+~,(]):root(?=$|[\s>+~.#:[,)])/i.test(selector)) {
    return ":root";
  }
  return null;
}

function scopeSelector(selector: string, root: string): string {
  const value = selector.trim();
  if (value === ":root" || value === ":host") return root;
  if (value === root || value.startsWith(`${root} `) || value.startsWith(`${root}:`)) return value;

  const global = globalDocumentSelector(value);
  if (global !== null) {
    throw new Error(
      `plugin CSS selector ${JSON.stringify(value)} targets ${global}; use a wrapper-local selector`,
    );
  }

  // `.dark` and data-theme are public host contexts, not plugin-owned nodes.
  // Keep them outside the inserted wrapper so authored token fallbacks and
  // non-Tailwind rules continue to follow the app's explicit theme.
  for (const context of [".dark", '[data-theme="dark"]']) {
    if (value.startsWith(`${context} `)) {
      return `${context} ${root}${value.slice(context.length)}`;
    }
  }
  return `${root} ${value}`;
}

function keyframePrefix(pluginId: string): string {
  return `vf-${pluginId.replaceAll(".", "-")}-`;
}

function renameKeyframes(root: postcss.Root, pluginId: string): void {
  const names = new Map<string, string>();
  const prefix = keyframePrefix(pluginId);
  root.walkAtRules((rule: AtRule) => {
    if (!/(?:^|-)keyframes$/i.test(rule.name)) return;
    const name = rule.params.trim();
    if (!KEYFRAME_NAME.test(name)) {
      throw new Error(
        `plugin CSS keyframe ${JSON.stringify(name)} is not a portable identifier; use an ASCII CSS identifier`,
      );
    }
    const scoped = `${prefix}${name}`;
    names.set(name, scoped);
    rule.params = scoped;
  });
  if (names.size === 0) return;

  // Direct animation declarations cover authored CSS. Tailwind stores its
  // shorthands in --animate-* theme variables, so those participate too.
  root.walkDecls((declaration) => {
    const property = declaration.prop.toLowerCase();
    if (
      property !== "animation" &&
      property !== "animation-name" &&
      property !== "-webkit-animation" &&
      property !== "-webkit-animation-name" &&
      !property.startsWith("--animate-") &&
      !property.startsWith("--animation-")
    ) {
      return;
    }
    let value = declaration.value;
    for (const [name, scoped] of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      value = value.replace(
        new RegExp(`(^|[^-_a-zA-Z0-9\\\\])${escaped}(?=$|[^-_a-zA-Z0-9])`, "g"),
        `$1${scoped}`,
      );
    }
    declaration.value = value;
  });
}

function flattenCascadeLayers(root: postcss.Root): void {
  // The production app sheet is minified into unlayered rules. Leaving a
  // plugin utility in a named layer would make it lose to every matching host
  // utility before specificity is considered. Once selectors carry the exact
  // plugin root, preserving source order while removing layer wrappers gives
  // the boundary the same cascade semantics in dev and production.
  root.walkAtRules("layer", (layer) => {
    if (layer.nodes === undefined) {
      layer.remove();
      return;
    }
    layer.replaceWith(...layer.nodes);
  });
}

function removeOrRefuseDocumentGlobalAtRules(root: postcss.Root): void {
  root.walkAtRules((rule) => {
    const name = rule.name.toLowerCase();
    if (name === "property") {
      // Tailwind emits @property registrations for its --tw-* implementation
      // variables. Registration is document-global and cannot be namespaced
      // by a selector; the scoped compatibility initializer already supplies
      // those values on every plugin node, so discard registrations instead
      // of letting one plugin mutate the host's property registry.
      rule.remove();
      return;
    }
    if (DOCUMENT_GLOBAL_AT_RULES.has(name)) {
      throw new Error(
        `plugin CSS @${rule.name} is document-global and cannot live inside a plugin style boundary`,
      );
    }
  });
}

export function assertPluginCssIsScoped(css: string, pluginId: string): void {
  const rootSelector = pluginStyleRoot(pluginId);
  const root = postcss.parse(css, { from: undefined });
  root.walkAtRules((rule) => {
    if (
      rule.name.toLowerCase() === "property" ||
      DOCUMENT_GLOBAL_AT_RULES.has(rule.name.toLowerCase())
    ) {
      throw new Error(`plugin CSS emitted a document-global @${rule.name} rule`);
    }
  });
  root.walkAtRules("layer", () => {
    throw new Error("plugin CSS still contains a cascade layer after scope projection");
  });
  root.walkRules((rule) => {
    if (isInsideKeyframes(rule)) return;
    for (const selector of rule.selectors) {
      if (!selector.includes(rootSelector)) {
        throw new Error(`plugin CSS emitted an unscoped selector: ${selector}`);
      }
    }
  });
}

/** Compile one plugin stylesheet into a document-order-independent artifact. */
export function scopePluginCss(css: string, pluginId: string): string {
  const rootSelector = pluginStyleRoot(pluginId);
  const root = postcss.parse(css, { from: undefined });
  renameKeyframes(root, pluginId);
  removeOrRefuseDocumentGlobalAtRules(root);
  root.walkRules((rule) => {
    if (isInsideKeyframes(rule)) return;
    rule.selectors = [
      ...new Set(rule.selectors.map((selector) => scopeSelector(selector, rootSelector))),
    ];
  });
  flattenCascadeLayers(root);
  const output = root.toString();
  assertPluginCssIsScoped(output, pluginId);
  return output;
}
