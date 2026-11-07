import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderFlowSvg } from "../flows/render.mjs";
import { buildCell } from "../validation/cell.mjs";
import { loadAudit, safe } from "../validation/load.mjs";
import { renderShell } from "./markup.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

export function createAuditServer(root = repoRoot) {
  const audit = loadAudit(root);
  const selectionFrom = (url) => ({
    stateId: url.searchParams.get("state") || audit.index.states[0]?.id || "",
    viewId: url.searchParams.get("view") || audit.index.views[0]?.id || "",
    adapterId: url.searchParams.get("adapter") || audit.index.adapters[0]?.id || "",
    fieldId: url.searchParams.get("field") || audit.index.fields[0]?.id || "",
  });
  const cellFor = (url) =>
    buildCell({
      model: audit.model,
      traces: audit.traces,
      renders: audit.renders,
      fallback: audit.overlay,
      renderIndex: audit.renderIndex,
      selection: selectionFrom(url),
    });
  return createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/" || url.pathname === "/index.html")
        return send(res, 200, "text/html; charset=utf-8", readFileSync(join(here, "index.html")));
      if (url.pathname === "/app.css")
        return send(res, 200, "text/css; charset=utf-8", readFileSync(join(here, "app.css")));
      if (url.pathname === "/app.mjs")
        return send(
          res,
          200,
          "text/javascript; charset=utf-8",
          readFileSync(join(here, "app.mjs")),
        );
      if (url.pathname === "/tokens.css") {
        return send(
          res,
          200,
          "text/css; charset=utf-8",
          readFileSync(safe(root, "packages/design-kit/src/tokens.css")),
        );
      }
      if (url.pathname === "/api/index.json")
        return send(res, 200, "application/json; charset=utf-8", JSON.stringify(audit.index));
      if (url.pathname === "/api/page")
        return send(res, 200, "text/html; charset=utf-8", renderShell(audit.index, cellFor(url)));
      if (url.pathname === "/api/flow.svg")
        return send(res, 200, "image/svg+xml; charset=utf-8", renderFlowSvg(cellFor(url)));
      if (url.pathname.startsWith("/shots/")) {
        const name = url.pathname.slice("/shots/".length);
        if (!/^[A-Za-z0-9.-]+$/u.test(name))
          return send(res, 404, "text/plain; charset=utf-8", "Not found");
        const shot = safe(root, `audit/godview/rendering/screenshots/${name}`);
        if (!existsSync(shot)) return send(res, 404, "text/plain; charset=utf-8", "Not found");
        return send(res, 200, "image/png", readFileSync(shot));
      }
      send(res, 404, "text/plain; charset=utf-8", "Not found");
    } catch {
      send(res, 400, "text/plain; charset=utf-8", "path refused");
    }
  });
}

function send(res, status, type, body) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const port = Number(process.env.GV_AUDIT_PORT || 8736);
  const server = createAuditServer();
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`Godview QA: http://127.0.0.1:${port}\n`);
  });
}
