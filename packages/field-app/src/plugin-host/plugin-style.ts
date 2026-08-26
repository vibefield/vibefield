/** A stylesheet is renderer publication just like a command or surface. The candidate keeps its
 * link detached until the exact plugin/window target commits and removes only its own node at the
 * synchronous close edge.
 *
 * Stylesheet order is deliberately NOT part of the isolation contract. `plugin-build` scopes
 * every selector beneath the plugin's `data-vf-plugin` boundary and the host mounts that boundary
 * around each DOM widget and contributed surface (spec §11.5). Reordering links would only choose
 * which global rule wins and would regress as soon as another plugin or HMR node arrived. */
export interface PluginStyleCandidate {
  commit(): void;
  dispose(): void;
}

function styleLinks(doc: Document, pluginId: string): HTMLLinkElement[] {
  return [...doc.querySelectorAll<HTMLLinkElement>("link[data-vf-plugin-style]")].filter(
    (link) => link.dataset["vfPluginStyle"] === pluginId,
  );
}

export function stagePluginStyleLink(
  doc: Document,
  pluginId: string,
  installRevision: string,
  href: string,
): PluginStyleCandidate {
  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset["vfPluginStyle"] = pluginId;
  link.dataset["vfInstallRevision"] = installRevision;
  // A link in the document proves publication, not that Chromium obtained and
  // parsed its bytes. Keep the browser's terminal event on the owned node so
  // smoke/doctor evidence can distinguish loading, loaded, and refused CSS
  // without probing cross-origin CSSOM rules.
  link.dataset["vfPluginStyleState"] = "loading";
  const settleLoad = (result: "loaded" | "error"): void => {
    if (link.dataset["vfPluginStyleState"] === "loading") {
      link.dataset["vfPluginStyleState"] = result;
    }
  };
  link.addEventListener("load", () => settleLoad("loaded"), { once: true });
  link.addEventListener("error", () => settleLoad("error"), { once: true });

  let state: "staged" | "active" | "disposed" = "staged";
  return Object.freeze({
    commit(): void {
      if (state === "active") return;
      if (state === "disposed")
        throw new Error(`stylesheet candidate for ${pluginId} is no longer current`);
      // Replacement is identity-safe: a late disposer retains its old node and therefore cannot
      // remove a newer candidate that has already taken the plugin's stylesheet slot.
      for (const existing of styleLinks(doc, pluginId)) existing.remove();
      doc.head.appendChild(link);
      state = "active";
    },
    dispose(): void {
      if (state === "disposed") return;
      state = "disposed";
      link.remove();
    },
  });
}

/** Legacy/direct helper retained for loader tests and dev callers. Runtime-controlled staged
 * plugins use `stagePluginStyleLink` so the link has an exact inverse. */
export function ensureStyleLink(
  doc: Document,
  pluginId: string,
  installRevision: string,
  href: string,
): void {
  const existing = styleLinks(doc, pluginId);
  const current = existing.find((link) => link.dataset["vfInstallRevision"] === installRevision);
  if (current !== undefined) {
    for (const duplicate of existing) {
      if (duplicate !== current) duplicate.remove();
    }
    return;
  }
  const candidate = stagePluginStyleLink(doc, pluginId, installRevision, href);
  candidate.commit();
}
