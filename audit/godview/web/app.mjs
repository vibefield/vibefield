import { chooseMounts, MAX_LIVE_MOUNTS } from "./lazy-mount.mjs";

const app = document.querySelector("#app");
const live = document.querySelector("#live");
const near = new Map();

function slots() {
  return [...app.querySelectorAll("[data-mount]")];
}

function apply() {
  const entries = slots().map((element) => ({
    id: element.dataset.mount,
    near: near.get(element) === true,
    active: element.querySelector("iframe") != null,
    element,
  }));
  const chosen = chooseMounts(entries, MAX_LIVE_MOUNTS);
  for (const entry of entries) {
    const frame = entry.element.querySelector("iframe");
    if (chosen.has(entry.id)) {
      if (!frame) {
        const iframe = document.createElement("iframe");
        iframe.className = "component";
        iframe.title = `Pinned synthetic fixture ${entry.element.dataset.fixture ?? ""}`;
        iframe.src = entry.id;
        entry.element.append(iframe);
      }
    } else if (frame) {
      frame.remove();
    }
  }
  live.textContent = `${chosen.size} of at most ${MAX_LIVE_MOUNTS} live synthetic fixtures are mounted.`;
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
