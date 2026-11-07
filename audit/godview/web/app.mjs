import { chooseMounts, MAX_LIVE_MOUNTS, slotAction } from "./lazy-mount.mjs";

const app = document.querySelector("#app");
const live = document.querySelector("#live");
const near = new Map();

function slots() {
  return [...app.querySelectorAll("[data-live-slot]")];
}

function apply() {
  const entries = slots().map((element) => ({
    id: element.dataset.slot,
    near: near.get(element) === true,
    active: element.querySelector("iframe") != null,
    element,
  }));
  const chosen = chooseMounts(entries, MAX_LIVE_MOUNTS);
  for (const entry of entries) {
    const frame = entry.element.querySelector("iframe");
    const planned = entry.element.dataset.src || "";
    const action = slotAction(
      frame != null,
      frame?.getAttribute("src") || "",
      planned,
      chosen.has(entry.id),
    );
    if (action === "unmount" && frame) frame.remove();
    if (action === "mount") {
      frame?.remove();
      const iframe = document.createElement("iframe");
      iframe.className = "component";
      iframe.title = `Pinned synthetic fixture ${entry.element.dataset.fixture ?? ""}`;
      iframe.src = planned;
      entry.element.append(iframe);
    }
  }
  const swarm = entries.filter(
    (entry) => entry.element.dataset.kind === "swarm" && chosen.has(entry.id),
  ).length;
  live.textContent = `${chosen.size} of at most ${MAX_LIVE_MOUNTS} live mounts, ${swarm} swarm runtime attempts. Historical swarm gaps stay unpainted.`;
}

const observer = new IntersectionObserver(
  (records) => {
    for (const record of records) near.set(record.target, record.isIntersecting);
    apply();
  },
  { rootMargin: "480px 0px" },
);

function watch() {
  near.clear();
  for (const element of slots()) observer.observe(element);
  apply();
}

async function show() {
  if (!app.querySelector("[data-matrix-cell]")) {
    app.setAttribute("aria-busy", "true");
    app.innerHTML = await fetch("/api/page").then((response) => response.text());
    app.setAttribute("aria-busy", "false");
  }
  watch();
}

function fail(error) {
  app.innerHTML = `<p role="alert">${error instanceof Error ? error.message : "The audit page failed to load."}</p>`;
  app.setAttribute("aria-busy", "false");
}

show().catch(fail);
