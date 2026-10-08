// EVERY REACT ROOT'S COMMITS (MV-3c; build-mv M33) — the hook half, evaluated
// in the lab's page before any page script runs (`Page.addScriptToEvaluateOnNewDocument`,
// `godview-lab-window.ts`). It is a minimal React DevTools global hook: React's
// own injection point, so the app is unchanged. Every renderer that loads
// injects into it, and React calls `onCommitFiberRoot` on every commit of every
// root — the host's, and any root a view host mounts a view in. It keeps one
// cumulative record per root (its container named, its commits, the summed
// `actualDuration` of the committed root, present in profiling and development
// builds) and publishes them as `window.__vfReactCommits`; the probe reads
// differences (`field-app/.../perf/react-roots.ts`, which types the shape).
//
// It is the page's only DevTools hook: the lab runs with no extension, and a
// hook already standing is left alone (the reader then says `hooked: false`).

export const REACT_COMMIT_HOOK_SOURCE = `(() => {
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ !== undefined) return;
  const byRoot = new WeakMap();
  const records = [];
  let timed = null;
  const name = (root) => {
    const node = root && root.containerInfo;
    if (!node || node.nodeType !== 1) return node && node.nodeName ? String(node.nodeName) : "root";
    const first = typeof node.className === "string" ? node.className.trim().split(/\\s+/)[0] : "";
    return node.tagName.toLowerCase() + (node.id ? "#" + node.id : "") + (first ? "." + first : "");
  };
  const renderers = new Map();
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers,
    inject(renderer) {
      const id = renderers.size + 1;
      renderers.set(id, renderer);
      return id;
    },
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    setStrictMode() {},
    checkDCE() {},
    onCommitFiberRoot(_rendererId, root) {
      let record = byRoot.get(root);
      if (record === undefined) {
        record = { id: records.length + 1, label: name(root), commits: 0, renderMs: 0 };
        byRoot.set(root, record);
        records.push(record);
      }
      record.commits += 1;
      const spent = root && root.current ? root.current.actualDuration : undefined;
      if (typeof spent === "number") {
        record.renderMs += spent;
        timed = true;
      } else if (timed === null) {
        timed = false;
      }
    },
  };
  window.__vfReactCommits = {
    records,
    timed: () => timed,
    renderers: () => renderers.size,
  };
})();`;
