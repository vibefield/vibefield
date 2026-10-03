import { app, type BrowserWindow, session } from "electron";

const PRODUCT_READY_TIMEOUT_MS = 45_000;
const PREVIEW_TIMEOUT_MS = 20_000;

interface ProductProbe {
  appearanceRevision: string | null;
  /** The product's theme, so the canvas ground probed is the one it projects. */
  theme: "light" | "dark";
  /** `.field-wrap`'s `--vf-canvas-bg` — the appearance a DESK build still consumes (DK-3): the
   * body's ground, the unavailable card's. The magnet reach and the `--ic-rim-radius` these probes
   * read until DK-3 drove the 0.11 magnet grid and the DOM card rim, neither of which exists. */
  canvasBg: string;
  /** The product's own disclosure of the preview it shows (studio-product-indicator.ts). */
  indicatorRevision: string | null;
  fielddPort: number;
  hasFielddToken: boolean;
  bridgeState: unknown;
}

interface StudioProbe {
  live: string | null;
  connection: string | null;
  action: string | null;
  status: string | null;
  context: string | null;
}

/** Opt-in physical gate for the real development composition. Never imported by production. */
export async function runStudioPhysicalAcceptance(opts: {
  productWindow: BrowserWindow;
  studioWindow: BrowserWindow;
  studioPartition: string;
}): Promise<void> {
  let ok = false;
  try {
    await assertWindowIsolation(opts);
    await waitForProduct(opts.productWindow);
    await waitForStudio(opts.studioWindow);
    await waitFor(
      "Studio to connect to the mounted product renderer",
      PRODUCT_READY_TIMEOUT_MS,
      async () => {
        const probe = await studioProbe(opts.studioWindow);
        return (
          probe.connection === "connected" &&
          probe.context !== null &&
          !probe.context.includes("unavailable")
        );
      },
    );
    const before = await productProbe(opts.productWindow);
    assertFieldd(before, "before preview");

    await editStudioAppearance(opts.studioWindow, PREVIEW_GROUND);
    await waitFor("the Studio specimen to commit its canvas ground", PREVIEW_TIMEOUT_MS, async () =>
      opts.studioWindow.webContents.executeJavaScript(
        `(() => {
            const workbench = document.querySelector("[data-ground-workbench]");
            if (!(workbench instanceof HTMLElement)) return false;
            const ground = workbench.style.getPropertyValue("--vf-canvas-bg").toUpperCase();
            return ground === ${JSON.stringify(PREVIEW_GROUND.light)} || ground === ${JSON.stringify(PREVIEW_GROUND.dark)};
          })()`,
        true,
      ),
    );
    await enableStudioLive(opts.studioWindow);
    await waitFor(
      "Studio to enter Live mode",
      PREVIEW_TIMEOUT_MS,
      async () => (await studioProbe(opts.studioWindow)).live === "true",
    );
    let lastProduct = await productProbe(opts.productWindow);
    await waitFor("the product to apply Studio's canvas ground", PREVIEW_TIMEOUT_MS, async () => {
      lastProduct = await productProbe(opts.productWindow);
      return lastProduct.canvasBg === PREVIEW_GROUND[lastProduct.theme];
    }).catch(async (error) => {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; Studio=${JSON.stringify(
          await studioProbe(opts.studioWindow),
        )}; product=${JSON.stringify(lastProduct)}`,
      );
    });
    const applied = await productProbe(opts.productWindow);
    assertFieldd(applied, "during preview");
    if (applied.appearanceRevision === null) {
      throw new Error("the real product renderer exposed no applied Studio revision");
    }
    if (applied.indicatorRevision !== applied.appearanceRevision) {
      throw new Error(
        `the product's preview indicator says revision ${applied.indicatorRevision}, the field ${applied.appearanceRevision}`,
      );
    }

    opts.productWindow.webContents.reload();
    await waitForProduct(opts.productWindow);
    await waitFor(
      "the replacement product renderer to replay the Studio snapshot",
      PRODUCT_READY_TIMEOUT_MS,
      async () => {
        const probe = await productProbe(opts.productWindow);
        return (
          probe.appearanceRevision === applied.appearanceRevision &&
          probe.canvasBg === PREVIEW_GROUND[probe.theme]
        );
      },
    );
    assertFieldd(await productProbe(opts.productWindow), "after product reload");

    opts.studioWindow.close();
    await waitFor(
      "closing Studio to restore the reviewed appearance",
      PREVIEW_TIMEOUT_MS,
      async () => {
        const probe = await productProbe(opts.productWindow);
        return probe.appearanceRevision === null && probe.canvasBg === REVIEWED_GROUND[probe.theme];
      },
    );
    const restored = await productProbe(opts.productWindow);
    assertFieldd(restored, "after Studio close");

    process.stdout.write(
      `STUDIO_PHYSICAL ${JSON.stringify({
        ok: true,
        distinctSessions: true,
        distinctPreloads: true,
        appliedRevision: Number(applied.appearanceRevision),
        replayed: true,
        restored: true,
        fielddPort: restored.fielddPort,
      })}\n`,
    );
    ok = true;
  } catch (error) {
    process.stderr.write(
      `STUDIO_PHYSICAL failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  } finally {
    app.exit(ok ? 0 : 2);
  }
}

async function studioProbe(window: BrowserWindow): Promise<StudioProbe> {
  return (await window.webContents.executeJavaScript(
    `(() => {
      const toolbar = document.querySelector(".vf-ds-studio-toolbar");
      const action = [...document.querySelectorAll("button")].find((button) =>
        ["Go live", "Live on"].includes(button.textContent?.trim() ?? ""),
      );
      return {
        live: toolbar?.getAttribute("data-live") ?? null,
        connection: toolbar?.getAttribute("data-connection") ?? null,
        action: action?.textContent?.trim() ?? null,
        status: toolbar?.querySelector('[role="status"]')?.textContent?.trim() ?? null,
        context: toolbar?.querySelector(".vf-ds-studio-toolbar__context")?.textContent?.trim() ?? null,
      };
    })()`,
    true,
  )) as StudioProbe;
}

async function assertWindowIsolation(opts: {
  productWindow: BrowserWindow;
  studioWindow: BrowserWindow;
  studioPartition: string;
}): Promise<void> {
  if (opts.productWindow.webContents.session === opts.studioWindow.webContents.session) {
    throw new Error("product and Studio unexpectedly share one Electron session");
  }
  if (opts.studioWindow.webContents.session !== session.fromPartition(opts.studioPartition)) {
    throw new Error("Studio is not using its dedicated ephemeral session partition");
  }
  const [productCapabilities, studioCapabilities] = await Promise.all([
    opts.productWindow.webContents.executeJavaScript(
      `({
        product: typeof globalThis.vibefield === "object",
        appearance: typeof globalThis.vibefieldStudioAppearance === "object",
        studio: typeof globalThis.vibefieldStudio === "object",
      })`,
      true,
    ),
    opts.studioWindow.webContents.executeJavaScript(
      `({
        product: typeof globalThis.vibefield === "object",
        appearance: typeof globalThis.vibefieldStudioAppearance === "object",
        studio: typeof globalThis.vibefieldStudio === "object",
      })`,
      true,
    ),
  ]);
  if (
    productCapabilities.product !== true ||
    productCapabilities.appearance !== true ||
    productCapabilities.studio !== false ||
    studioCapabilities.product !== false ||
    studioCapabilities.appearance !== false ||
    studioCapabilities.studio !== true
  ) {
    throw new Error("product and Studio did not expose their distinct fixed preload capabilities");
  }
}

async function waitForProduct(window: BrowserWindow): Promise<void> {
  await waitFor("the real product field to become ready", PRODUCT_READY_TIMEOUT_MS, async () =>
    window.webContents.executeJavaScript(
      `Boolean(document.querySelector(".field-wrap") && globalThis.vibefield?.getConnection)`,
      true,
    ),
  );
}

async function waitForStudio(window: BrowserWindow): Promise<void> {
  await waitFor("the Studio workbench to become ready", PRODUCT_READY_TIMEOUT_MS, async () =>
    window.webContents.executeJavaScript(
      `Boolean(document.querySelector("[data-visual-tweak-controls]") && [...document.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Go live"))`,
      true,
    ),
  );
}

/** The canvas ground Studio previews (both themes, so either product theme shows it), and the
 * reviewed ground a closed Studio restores (`canvas-appearance.ts`'s defaults; DESIGN.md §2.1). */
const PREVIEW_GROUND = { light: "#F2EAD3", dark: "#1E2A22" } as const;
const REVIEWED_GROUND = { light: "#FAFAFA", dark: "#171717" } as const;

async function editStudioAppearance(
  window: BrowserWindow,
  ground: { light: string; dark: string },
): Promise<void> {
  const changed = (await window.webContents.executeJavaScript(
    `(() => {
      const setColor = (groupTitle, label, value) => {
        const group = [...document.querySelectorAll(".vf-ds-tweak-group")].find(
          (candidate) => candidate.querySelector("h4")?.textContent?.trim() === groupTitle,
        );
        const input = [...(group?.querySelectorAll("input[type=color]") ?? [])].find(
          (candidate) => candidate.getAttribute("aria-label") === label,
        );
        if (!(input instanceof HTMLInputElement)) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, value.toLowerCase());
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      };
      const light = setColor("Canvas palette", "Background · light", ${JSON.stringify(ground.light)});
      const dark = setColor("Canvas palette", "Background · dark", ${JSON.stringify(ground.dark)});
      return light && dark;
    })()`,
    true,
  )) as boolean;
  if (!changed) throw new Error("the physical gate could not operate the Studio appearance UI");
}

async function enableStudioLive(window: BrowserWindow): Promise<void> {
  const enabled = (await window.webContents.executeJavaScript(
    `(() => {
      const live = [...document.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Go live",
      );
      live?.click();
      return live instanceof HTMLButtonElement;
    })()`,
    true,
  )) as boolean;
  if (!enabled) throw new Error("the physical gate could not enable Studio Live mode");
}

async function productProbe(window: BrowserWindow): Promise<ProductProbe> {
  return (await window.webContents.executeJavaScript(
    `(async () => {
      const field = document.querySelector(".field-wrap");
      const indicator = document.querySelector(".vf-studio-product-indicator");
      const connection = await globalThis.vibefield.getConnection();
      return {
        appearanceRevision: field?.getAttribute("data-appearance-override-revision") ?? null,
        theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
        canvasBg: field instanceof HTMLElement
          ? field.style.getPropertyValue("--vf-canvas-bg").trim().toUpperCase()
          : "",
        indicatorRevision: indicator?.getAttribute("data-revision") ?? null,
        fielddPort: connection.port,
        hasFielddToken: typeof connection.token === "string" && connection.token.length > 0,
        bridgeState: globalThis.vibefieldStudioAppearance.physicalState?.() ?? null,
      };
    })()`,
    true,
  )) as ProductProbe;
}

function assertFieldd(probe: ProductProbe, phase: string): void {
  if (!Number.isInteger(probe.fielddPort) || probe.fielddPort <= 0 || !probe.hasFielddToken) {
    throw new Error(`the product fieldd door was unavailable ${phase}`);
  }
}

async function waitFor(
  label: string,
  timeoutMs: number,
  predicate: () => Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch {
      // Reloads transiently destroy the execution context; retry the new document.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms`);
}
