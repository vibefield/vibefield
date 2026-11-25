// THE SIMULATOR'S SETTINGS, A SHEET ON ITS GLASS (track OM, OM-2, 2026-11-25; DESIGN.md §9 "The simulator's acts"): it
// rises only on the phone in hand — Simulator settings… picks the phone up first, as double-clicking a new simulator does
// — from just under the Dynamic Island to the screen's foot, at the display's width, and follows the phone as it travels;
// never the window's dialog. With several phones it sets up every one and says how many. Its states and words are the
// form's before it: before Xcode, its steps; ready, the iOS version and the iPhone model as pills over their lists
// (setup-choice.ts) and Create simulator; set up, Switch simulator; the repairs in their own words. The close glyph or Esc
// closes it and the phone stays in hand; an open list folds first.
import {
  type Entity,
  type ObjectDomHost,
  type SimulatorDevices,
  type SimulatorRuntimeOption,
  type SimulatorSetupStatus,
  writable,
} from "@vibefield/plugin-sdk/desk";
import { bindingOf } from "./binding";
import { DEFAULT_MODEL, PROP } from "./ids";
import { MM, modelOf, type PhoneShape, shapeOf } from "./law";
import { configurationPatch, iosLabel, simulatorChoice } from "./setup";
import { type SheetOption, sheetChoice } from "./setup-choice";
import { setupMarkup, setupStyles, showPrerequisite } from "./setup-view";

/** Below the sensor housing the sheet leaves this much of the display's height clear (DESIGN.md §9: "from under the
 * Dynamic Island"). */
const SHEET_GAP = 0.025;
/** Its top corners: 2.6 mm of the phone's display, as the page drew them (DESIGN.md §9, "Settled at the build
 * (2026-11-25, OM-2)") — about 16 of a 17 Pro's points. Every model's display is drawn at the desk's one scale (law.ts
 * `MM`, world units a millimetre), so every phone's sheet gets the same 2.6 mm. */
const SHEET_CORNER_MM = 2.6;

/** Where the sheet stands on the phone in hand, CSS px (DESIGN.md §9, "Settled at the build (2026-11-25, OM-2)"): from just
 * under its sensor housing (the Dynamic Island's foot, a notch's, or the display's top edge on a phone with a Home button)
 * plus 2.5% of the display's height, to the display's foot, at its full width; its top corners 2.6 mm of the display, its
 * foot the display's own corners. */
export function sheetOn(
  shape: PhoneShape,
  frame: { readonly cx: number; readonly cy: number; readonly s: number },
) {
  const [hx, hy] = shape.display;
  const { pill, notch } = shape.housing;
  const housing = pill !== null ? pill.top + 2 * pill.hh : notch !== null ? notch.depth : 0;
  const below = housing + SHEET_GAP * 2 * hy;
  return {
    left: frame.cx - hx * frame.s,
    top: frame.cy + (below - hy) * frame.s,
    width: 2 * hx * frame.s,
    height: (2 * hy - below) * frame.s,
    corner: SHEET_CORNER_MM * MM * frame.s,
    foot: shape.displayCorner.extent * frame.s,
  };
}

export function mountSimulatorSetup(dom: ObjectDomHost, devices: SimulatorDevices | undefined) {
  const doc = dom.container.ownerDocument;
  const style = doc.createElement("style");
  style.textContent = setupStyles;
  const dialog = doc.createElement("dialog");
  dialog.className = "vf-sim-setup";
  dialog.setAttribute("aria-label", "Simulator settings");
  dialog.innerHTML = setupMarkup;
  dom.container.append(style, dialog);
  const runtime = sheetChoice(dialog, "runtime", () =>
    fillModels(model.value || String(firstProps()?.[PROP.model] ?? DEFAULT_MODEL)),
  );
  const model = sheetChoice(dialog, "model", () => update());
  const choices = [
    ["runtime", runtime],
    ["model", model],
  ] as const;
  const status = dialog.querySelector<HTMLElement>("[role=status]")!;
  const submit = dialog.querySelector<HTMLButtonElement>("[type=submit]")!;
  const refresh = dialog.querySelector<HTMLButtonElement>("[data-refresh]")!;
  const guide = dialog.querySelector<HTMLElement>("[data-guide]")!;
  const picker = dialog.querySelector<HTMLElement>("[data-picker]")!;
  const primary = dialog.querySelector<HTMLButtonElement>("[data-primary]")!;
  const manage = dialog.querySelector<HTMLButtonElement>("[data-manage]")!;
  const components = dialog.querySelector<HTMLElement>("[data-components]")!;
  const version = dialog.querySelector<HTMLElement>("[data-xcode]")!;
  const heading = dialog.querySelector<HTMLElement>("h2")!;
  const view = doc.defaultView!;
  const cell = dom.object.groups.find(
    (group) => group.name === dom.object.propToGroup[PROP.binding],
  )!.component;
  const props = (entity: Entity) =>
    dom.world.get(entity, cell) as Readonly<Record<string, unknown>> | undefined;
  const currentStore = () => dom.docs.current()?.store;
  let target:
    | {
        store: ReturnType<typeof currentStore>;
        phones: { entity: Entity; key: string | undefined }[];
      }
    | undefined;
  let rows: readonly SimulatorRuntimeOption[] = [];
  let revision = 0;
  let stage: SimulatorSetupStatus["stage"] | undefined;
  let loading = false;
  let openedDestination = false;
  let checks = 0;
  let timer: number | undefined;
  let held: Entity | undefined;
  /** What had the focus when the sheet opened: a sheet shown beside the page (never modal) gives none back on its own. */
  let opener: HTMLElement | undefined;
  let placement = "";
  let disposed = false;
  const clearTimer = () => {
    view.clearTimeout(timer);
    timer = undefined;
  };
  /** Any open list folded (the focus back on its pill); true when one was open. */
  const foldLists = (): boolean => choices.map(([, c]) => c.fold(true)).some(Boolean);
  const place = () => {
    if (held === undefined) return;
    const hand = dom.hand();
    if (!hand || hand.entity !== held || hand.landing) return;
    const r = sheetOn(
      shapeOf(modelOf(String(props(held)?.[PROP.model] ?? DEFAULT_MODEL))),
      hand.frame,
    );
    const next = [r.left, r.top, r.width, r.height, r.corner, r.foot].join(",");
    if (placement === next) return;
    placement = next;
    Object.assign(dialog.style, {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      borderRadius: `${r.corner}px ${r.corner}px ${r.foot}px ${r.foot}px`,
    });
  };
  const firstProps = () => target?.phones[0] && props(target.phones[0].entity);
  const update = () => {
    const choice = simulatorChoice(rows, runtime.value, model.value);
    const phones = target?.phones ?? [];
    const several = phones.length > 1;
    const fresh = phones.every(({ entity }) => !bindingOf(props(entity) ?? {})?.dedicated);
    const changed =
      choice && phones.some(({ entity }) => configurationPatch(props(entity) ?? {}, choice));
    submit.disabled = !choice;
    submit.textContent = fresh
      ? several
        ? "Create simulators"
        : "Create simulator"
      : changed
        ? several
          ? "Switch simulators"
          : "Switch simulator"
        : "Done";
    status.textContent =
      choice && changed && !fresh ? "Each configuration keeps its own apps and data." : "";
  };
  const fillModels = (prefer: string, preserve = false) => {
    const models = rows.find((row) => row.runtime === runtime.value)?.models ?? [];
    const options: SheetOption[] = models.map((m) => ({ value: m.deviceType, label: m.name }));
    let taken = models[0]?.deviceType ?? "";
    if (models.some((m) => m.deviceType === prefer)) taken = prefer;
    else if (preserve && models.length) {
      options.unshift({ value: "", label: "Choose an available iPhone", disabled: true });
      taken = "";
    }
    model.fill(options, taken);
    model.disabled = !models.length;
    update();
  };
  const fillCatalog = (installed: readonly SimulatorRuntimeOption[], xcodeVersion?: string) => {
    const saved = firstProps() ?? {};
    const prior = bindingOf(saved);
    const preferredRuntime = runtime.value || prior?.runtime;
    const preferredModel =
      model.value || prior?.deviceType || String(saved[PROP.model] ?? DEFAULT_MODEL);
    if (
      openedDestination &&
      installed.some((row) => !rows.some((previous) => previous.runtime === row.runtime))
    )
      openedDestination = false;
    rows = installed;
    guide.hidden = primary.hidden = true;
    picker.hidden = submit.hidden = false;
    version.hidden = !xcodeVersion;
    version.textContent = xcodeVersion ? `Xcode ${xcodeVersion}` : "";
    manage.hidden = !devices?.setup;
    components.hidden = !!devices?.setup && !openedDestination;
    const options: SheetOption[] = rows.map((row) => ({
      value: row.runtime,
      label: iosLabel(row.runtime),
    }));
    let taken = rows[0]?.runtime ?? "";
    if (preferredRuntime && rows.some((row) => row.runtime === preferredRuntime))
      taken = preferredRuntime;
    else if (preferredRuntime && rows.length) {
      options.unshift({
        value: "",
        label: `${iosLabel(preferredRuntime)} (unavailable)`,
        disabled: true,
      });
      taken = "";
    }
    runtime.fill(options, taken);
    runtime.disabled = !rows.length;
    fillModels(preferredModel, prior?.runtime === runtime.value);
    if (!rows.length) status.textContent = "No compatible iOS simulator runtime is installed.";
    else if (runtime.value && !model.value)
      status.textContent = "The saved model is unavailable for this iOS version.";
    else if (!runtime.value)
      status.textContent = "Choose an installed iOS version or reinstall the saved version.";
  };
  const show = (result: SimulatorSetupStatus) => {
    const previous = stage;
    stage = result.stage;
    if (stage !== previous) {
      checks = 0;
      openedDestination = false;
      status.textContent = "";
    }
    if (result.stage === "ready") {
      fillCatalog(result.configurations, result.xcodeVersion);
      return;
    }
    rows = [];
    picker.hidden = submit.hidden = version.hidden = true;
    runtime.disabled = true;
    model.disabled = true;
    submit.disabled = true;
    const hasSteps = stage !== "unavailable" && stage !== "unsupported";
    guide.hidden = primary.hidden = !hasSteps;
    if (hasSteps && previous !== stage) {
      showPrerequisite(guide, primary, result);
      status.textContent =
        stage === "install-runtime"
          ? "Checking for installed iOS runtimes…"
          : "Checking Xcode setup automatically…";
    }
    if (stage === "unsupported")
      status.textContent = "Open this board in VibeField on a Mac to run an iOS simulator.";
    if (stage === "unavailable")
      status.textContent =
        "Couldn’t contact the simulator tools. Try again when the desktop is ready.";
  };
  const load = async (initial?: SimulatorSetupStatus) => {
    if (loading || !dialog.open) return;
    clearTimer();
    const token = revision;
    loading = true;
    refresh.disabled = true;
    if (!stage) status.textContent = "Checking this Mac…";
    try {
      if (devices?.setup) showIfCurrent(initial ?? (await devices.setup.check()));
      else {
        if (!devices?.configurations) throw new Error("missing catalog");
        const installed = await devices.configurations();
        if (token === revision && dialog.open) {
          stage = "ready";
          fillCatalog(installed);
        }
      }
    } catch {
      if (devices?.setup) showIfCurrent({ stage: "unavailable" });
      else if (token === revision && dialog.open) {
        rows = [];
        runtime.disabled = true;
        model.disabled = true;
        submit.disabled = true;
        status.textContent =
          "Couldn't read the simulator runtimes. Check the desktop connection and refresh.";
      }
    } finally {
      if (token === revision && dialog.open) {
        loading = refresh.disabled = false;
        refresh.hidden = stage === "unsupported";
        refresh.textContent = stage === "ready" ? "Refresh" : "Check again";
        if (
          devices?.setup &&
          !doc.hidden &&
          stage !== "unsupported" &&
          (stage !== "ready" || openedDestination)
        ) {
          timer = view.setTimeout(
            () => void load(),
            Math.min(30_000, 2000 * 2 ** Math.min(checks++, 4)),
          );
        }
      }
    }
    function showIfCurrent(result: SimulatorSetupStatus) {
      if (token === revision && dialog.open) show(result);
    }
  };
  const onReturn = () => {
    if (!dialog.open || !devices?.setup || stage === "unsupported") return;
    if (doc.hidden) clearTimer();
    else if (stage !== "ready" || openedDestination) {
      checks = 0;
      void load();
    }
  };
  const openDestination = async (button: HTMLButtonElement, destination: "app-store" | "xcode") => {
    if (!devices?.setup || button.disabled) return;
    const token = revision;
    button.disabled = true;
    openedDestination = true;
    if (button === manage) components.hidden = false;
    try {
      await devices.setup.open(destination);
      if (token === revision && dialog.open) onReturn();
    } catch {
      if (token === revision && dialog.open)
        status.textContent =
          destination === "app-store"
            ? "Couldn’t open the App Store. Search for Xcode in the Mac App Store."
            : "Couldn’t open Xcode. Open it from Applications.";
    } finally {
      if (token === revision) button.disabled = false;
    }
  };
  primary.addEventListener(
    "click",
    () => void openDestination(primary, stage === "install-xcode" ? "app-store" : "xcode"),
  );
  manage.addEventListener("click", () => void openDestination(manage, "xcode"));
  view.addEventListener("focus", onReturn);
  view.addEventListener("resize", place);
  doc.addEventListener("visibilitychange", onReturn);
  refresh.addEventListener("click", () => void load());
  dialog.querySelector("[data-cancel]")!.addEventListener("click", () => dialog.close());
  dialog.addEventListener("keydown", (event) => {
    event.stopPropagation();
    // Esc folds an open list first, then closes the sheet: the phone stays in hand
    if (event.key === "Escape") {
      event.preventDefault();
      if (!foldLists()) dialog.close();
    }
  });
  dialog.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
  dialog.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    // a press elsewhere in the sheet folds a list it is not in
    const at = e.target as Element | null;
    for (const [name, c] of choices) if (!at?.closest(`[data-choice="${name}"]`)) c.fold();
  });
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    ++revision;
    clearTimer();
    for (const [, c] of choices) c.fold();
    held = undefined;
    target = undefined;
    // every close (Esc, the close glyph, Create, Switch or Done, the phone let go): the focus goes back where it was when the
    // sheet opened, if that is still in the page — unless the person has since put it somewhere else
    const back = opener;
    opener = undefined;
    const now = doc.activeElement;
    if (back?.isConnected && (now === null || now === doc.body || dialog.contains(now)))
      back.focus({ preventScroll: true });
    dom.wake();
  });
  dialog.querySelector("form")!.addEventListener("submit", (event) => {
    event.preventDefault();
    const choice = simulatorChoice(rows, runtime.value, model.value);
    if (!choice || !target || submit.disabled) return;
    const session = writable(dom.docs);
    if (
      !session ||
      session.store !== target.store ||
      !target.phones.every(
        ({ entity, key }) =>
          key !== undefined && key === session.store.keyOf(entity) && props(entity),
      )
    ) {
      status.textContent = "This selection is no longer editable.";
      return;
    }
    const writes = target.phones.flatMap(({ entity }) => {
      const existing = props(entity)!;
      const patch = configurationPatch(existing, choice);
      return patch
        ? [
            {
              entity,
              values: { ...existing, model: patch.model, binding: JSON.stringify(patch.binding) },
            },
          ]
        : [];
    });
    if (writes.length)
      session.store.transaction((tx) => {
        for (const { entity, values } of writes) tx.edit(entity).set(cell, values);
      });
    dialog.close();
  });
  /** The sheet opened on the phone in hand for `entities`, the first of them that phone (never over the window: no modal). */
  const configure = (entities: readonly Entity[], initial?: SimulatorSetupStatus): boolean => {
    const first = entities[0];
    const hand = dom.hand();
    if (first === undefined || dialog.open || disposed) return false;
    if (!hand || hand.landing || hand.entity !== first) return false;
    ++revision;
    const store = currentStore();
    target = { store, phones: entities.map((entity) => ({ entity, key: store?.keyOf(entity) })) };
    const configured = target.phones.some(
      ({ entity }) => bindingOf(props(entity) ?? {})?.dedicated,
    );
    const n = entities.length;
    heading.textContent = configured
      ? n > 1
        ? `Settings for ${n} simulators`
        : "Simulator settings"
      : n > 1
        ? `Set up ${n} simulators`
        : "Set up simulator";
    runtime.fill([], "");
    model.fill([], "");
    rows = [];
    checks = 0;
    stage = undefined;
    loading = openedDestination = false;
    runtime.disabled = true;
    model.disabled = true;
    submit.disabled = true;
    guide.hidden = primary.hidden = picker.hidden = submit.hidden = refresh.hidden = true;
    version.hidden = true;
    manage.disabled = primary.disabled = false;
    submit.textContent = configured ? "Done" : n > 1 ? "Create simulators" : "Create simulator";
    held = first;
    placement = "";
    dialog.removeAttribute("style");
    dialog.setAttribute("data-held", "");
    place();
    const active = doc.activeElement as HTMLElement | null;
    opener =
      active !== null && active !== doc.body && !dialog.contains(active) ? active : undefined;
    dialog.show();
    heading.focus({ preventScroll: true });
    void load(initial);
    dom.wake();
    return true;
  };
  return {
    configure,
    follow(entity: Entity | undefined) {
      if (held === undefined || !dialog.open) return;
      if (held !== entity) dialog.close();
      else place();
    },
    async recover(entity: Entity) {
      if (!devices?.setup || dialog.open) return;
      const token = revision;
      const result = await devices.setup.check().catch(() => undefined);
      if (result && result.stage !== "ready" && token === revision && dom.hand()?.entity === entity)
        configure([entity], result);
    },
    configured(entity: Entity) {
      return bindingOf(props(entity) ?? {}) !== undefined;
    },
    /** Whether the sheet stands open: while it does, its driver keeps following the phone's frame (`follow` places it). */
    showing() {
      return dialog.open;
    },
    dispose() {
      disposed = true;
      clearTimer();
      view.removeEventListener("focus", onReturn);
      view.removeEventListener("resize", place);
      doc.removeEventListener("visibilitychange", onReturn);
      ++revision;
      target = undefined;
      opener = undefined;
      dialog.remove();
      style.remove();
    },
  };
}
