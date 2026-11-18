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
import { modelOf, shapeOf } from "./law";
import { configurationPatch, iosLabel, simulatorChoice } from "./setup";
import { setupMarkup, setupStyles, showPrerequisite } from "./setup-view";

export function mountSimulatorSetup(dom: ObjectDomHost, devices: SimulatorDevices | undefined) {
  const doc = dom.container.ownerDocument;
  const style = doc.createElement("style");
  style.textContent = setupStyles;
  const dialog = doc.createElement("dialog");
  dialog.className = "vf-sim-setup";
  dialog.setAttribute("aria-label", "Simulator settings");
  dialog.innerHTML = setupMarkup;
  dom.container.append(style, dialog);
  const runtime = dialog.querySelector<HTMLSelectElement>('[name="runtime"]')!;
  const model = dialog.querySelector<HTMLSelectElement>('[name="model"]')!;
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
  let placement = "";
  let disposed = false;
  const clearTimer = () => {
    view.clearTimeout(timer);
    timer = undefined;
  };
  const place = () => {
    if (held === undefined) return;
    const hand = dom.hand();
    if (!hand || hand.entity !== held || hand.landing) return;
    const shape = shapeOf(modelOf(String(props(held)?.[PROP.model] ?? DEFAULT_MODEL)));
    const { cx, cy, s } = hand.frame;
    const width = 2 * shape.display[0] * s;
    const height = 2 * shape.display[1] * s;
    const rect = [cx - width / 2, cy - height / 2, width, height, shape.displayCorner.extent * s];
    const next = rect.join(",");
    if (placement === next) return;
    placement = next;
    const [left, top, w, h, radius] = rect.map((n) => `${n}px`);
    Object.assign(dialog.style, { left, top, width: w, height: h, borderRadius: radius });
  };
  const option = (value: string, text: string) => {
    const item = doc.createElement("option");
    item.value = value;
    item.textContent = text;
    return item;
  };
  const firstProps = () => target?.phones[0] && props(target.phones[0].entity);
  const update = () => {
    const choice = simulatorChoice(rows, runtime.value, model.value);
    const phones = target?.phones ?? [];
    const fresh = phones.every(({ entity }) => !bindingOf(props(entity) ?? {})?.dedicated);
    const changed =
      choice && phones.some(({ entity }) => configurationPatch(props(entity) ?? {}, choice));
    submit.disabled = !choice;
    submit.textContent = fresh
      ? phones.length > 1
        ? "Create simulators"
        : "Create simulator"
      : changed
        ? "Switch simulator"
        : "Done";
    status.textContent =
      choice && changed && !fresh ? "Each configuration keeps its own apps and data." : "";
  };
  const fillModels = (prefer: string, preserve = false) => {
    const models = rows.find((row) => row.runtime === runtime.value)?.models ?? [];
    model.replaceChildren(...models.map((m) => option(m.deviceType, m.name)));
    model.disabled = !models.length;
    if (models[0]) model.value = models[0].deviceType;
    if (models.some((m) => m.deviceType === prefer)) model.value = prefer;
    else if (preserve && models.length) {
      const unavailable = option("", "Choose an available iPhone");
      unavailable.disabled = true;
      model.prepend(unavailable);
      model.value = "";
    }
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
    runtime.replaceChildren(...rows.map((row) => option(row.runtime, iosLabel(row.runtime))));
    runtime.disabled = !rows.length;
    if (rows[0]) runtime.value = rows[0].runtime;
    if (preferredRuntime && rows.some((row) => row.runtime === preferredRuntime))
      runtime.value = preferredRuntime;
    else if (preferredRuntime && rows.length) {
      const unavailable = option("", `${iosLabel(preferredRuntime)} (unavailable)`);
      unavailable.disabled = true;
      runtime.prepend(unavailable);
      runtime.value = "";
    }
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
    picker.hidden = submit.hidden = true;
    runtime.disabled = model.disabled = submit.disabled = true;
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
        runtime.disabled = model.disabled = submit.disabled = true;
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
  runtime.addEventListener("change", () =>
    fillModels(model.value || String(firstProps()?.[PROP.model] ?? DEFAULT_MODEL)),
  );
  model.addEventListener("change", update);
  refresh.addEventListener("click", () => void load());
  dialog.querySelector("[data-cancel]")!.addEventListener("click", () => dialog.close());
  dialog.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      dialog.close();
    }
  });
  dialog.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
  dialog.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    if (e.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    )
      dialog.close();
  });
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    ++revision;
    clearTimer();
    held = undefined;
    target = undefined;
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
  const configure = (entities: readonly Entity[], initial?: SimulatorSetupStatus) => {
    if (!entities.length || dialog.open || disposed) return;
    ++revision;
    const store = currentStore();
    target = { store, phones: entities.map((entity) => ({ entity, key: store?.keyOf(entity) })) };
    const configured = target.phones.some(
      ({ entity }) => bindingOf(props(entity) ?? {})?.dedicated,
    );
    heading.textContent = configured ? "Simulator settings" : "Set up simulator";
    runtime.replaceChildren();
    model.replaceChildren();
    rows = [];
    checks = 0;
    stage = undefined;
    loading = openedDestination = false;
    runtime.disabled = model.disabled = submit.disabled = true;
    guide.hidden = primary.hidden = picker.hidden = submit.hidden = refresh.hidden = true;
    manage.disabled = primary.disabled = false;
    submit.textContent = configured ? "Done" : "Create simulator";
    const hand = dom.hand();
    held =
      entities.length === 1 && hand && !hand.landing && hand.entity === entities[0]
        ? hand.entity
        : undefined;
    placement = "";
    dialog.removeAttribute("style");
    dialog.toggleAttribute("data-held", held !== undefined);
    if (held !== undefined) {
      place();
      dialog.show();
    } else dialog.showModal();
    heading.focus({ preventScroll: true });
    void load(initial);
    dom.wake();
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
    dispose() {
      disposed = true;
      clearTimer();
      view.removeEventListener("focus", onReturn);
      view.removeEventListener("resize", place);
      doc.removeEventListener("visibilitychange", onReturn);
      ++revision;
      target = undefined;
      dialog.remove();
      style.remove();
    },
  };
}
