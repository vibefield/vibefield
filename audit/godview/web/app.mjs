import { bindSwarmMounts } from "./swarm-frame.mjs";

const app = document.querySelector("#app");
const live = document.querySelector("#live");

function params() {
  return new URLSearchParams(window.location.search);
}

async function show() {
  const query = params().toString();
  const suffix = query ? `?${query}` : "";
  app.setAttribute("aria-busy", "true");
  const html = await fetch(`/api/page${suffix}`).then((response) => response.text());
  app.innerHTML = html;
  const flow = app.querySelector("#flow");
  if (flow) {
    flow.innerHTML = await fetch(`/api/flow.svg${suffix}`).then((response) => response.text());
  }
  bindSwarmMounts(app);
  app.setAttribute("aria-busy", "false");
  const state = app.querySelector("#state")?.value ?? "";
  const view = app.querySelector("#view")?.value ?? "";
  const adapter = app.querySelector("#adapter")?.value ?? "";
  const field = app.querySelector("#field")?.value ?? "";
  live.textContent = `State ${state}, view ${view}, adapter ${adapter}, field ${field}.`;
  for (const id of ["state", "view", "adapter", "field"]) {
    app.querySelector(`#${id}`)?.addEventListener("change", (event) => {
      const next = params();
      next.set(id, event.target.value);
      history.replaceState(null, "", `?${next}`);
      show().catch(fail);
    });
  }
  for (const button of app.querySelectorAll("[data-state]")) {
    button.addEventListener("click", () => {
      const next = params();
      next.set("state", button.dataset.state);
      history.replaceState(null, "", `?${next}`);
      show().catch(fail);
    });
  }
}

function fail(error) {
  app.innerHTML = `<p role="alert">${error instanceof Error ? error.message : "The audit page failed to load."}</p>`;
  app.setAttribute("aria-busy", "false");
}

show().catch(fail);
