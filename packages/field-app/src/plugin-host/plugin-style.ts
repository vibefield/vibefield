/** A stylesheet is renderer publication just like a command or surface. The candidate keeps its
 * link detached until the exact plugin/window target commits and removes only its own node at the
 * synchronous close edge. */
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
