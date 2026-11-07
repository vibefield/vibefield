/**
 * One visible swarm card, one GPU context.
 *
 * The iframe is born without `src`. `bindSwarmMounts` sets `src` from
 * `data-src` only while the card intersects the viewport (plus a small
 * margin) and points it at `about:blank` when the card leaves, so the pinned
 * document and its WebGPU device are destroyed. A future list of every swarm
 * card should keep this observer rather than mounting every fixture at once.
 */

export function applySwarmVisibility(frame, visible) {
  const planned = frame.dataset?.src || frame.getAttribute?.("data-src") || "";
  if (!planned) return "idle";
  if (visible) {
    if (frame.getAttribute("src") !== planned) {
      frame.setAttribute("src", planned);
      return "load";
    }
    return "kept";
  }
  if (frame.getAttribute("src")) {
    frame.setAttribute("src", "about:blank");
    return "release";
  }
  return "idle";
}

let observer = null;

export function bindSwarmMounts(root) {
  observer?.disconnect();
  observer = null;
  const cards = [...root.querySelectorAll("[data-swarm-mount]")];
  if (!cards.length) return;
  const apply = (card, visible) => {
    const frame = card.querySelector("[data-swarm-frame]");
    if (frame) applySwarmVisibility(frame, visible);
  };
  // The selector page renders one swarm card. Load that one context now.
  // A later scrollable list of every card passes many mounts; only the ones
  // near the viewport get a GPU context, and leaving the viewport releases it.
  if (cards.length === 1 || typeof IntersectionObserver !== "function") {
    for (const card of cards) apply(card, true);
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) apply(entry.target, entry.isIntersecting);
    },
    { rootMargin: "160px" },
  );
  for (const card of cards) observer.observe(card);
}
