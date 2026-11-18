/** Benchmark-only adapter for stock agent-browser. No product listener or remote-debugging port. */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";
import type { WebContents } from "electron";

type PageSocket = EventEmitter & {
  readyState: number;
  send(data: string): void;
  close(code?: number): void;
  terminate(): void;
};
interface CdpCommand {
  id: number;
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

const run = promisify(execFile);
export async function checkBrowserPerfAgent(
  source: WebContents,
  repo: string,
  binary: string,
  node: string,
  captureScale = 1,
) {
  // ws is already a locked dependency of fieldd. This testing bundle does not
  // add a production dependency or expose any other WebContents to the client.
  const { WebSocketServer } = createRequire(join(repo, "packages/fieldd/package.json"))("ws");
  const root = mkdtempSync("/private/tmp/vf-bpa-");
  const route = `/page/${randomBytes(32).toString("hex")}`;
  const sockets = new Set<PageSocket>();
  const methods: Record<string, number> = {};
  const server = createServer((_q, r) => {
    r.writeHead(404);
    r.end();
  });
  const ws = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  const identity = randomBytes(12).toString("hex");
  const sourceId = source.id;
  const beforeTarget = await source.debugger.sendCommand("Target.getTargetInfo");
  const send = (socket: PageSocket, value: unknown) => {
    if (socket.readyState === 1) socket.send(JSON.stringify(value));
  };
  const allowed = new Set([
    "Accessibility",
    "DOM",
    "DOMSnapshot",
    "Debugger",
    "Input",
    "Log",
    "Network",
    "Page",
    "Performance",
    "Runtime",
  ]);
  const denied = new Set([
    "Page.startScreencast",
    "Page.stopScreencast",
    "Page.captureScreenshot",
    "Page.printToPDF",
    "Page.setDownloadBehavior",
    "Runtime.addBinding",
    "Page.close",
  ]);
  server.on("upgrade", (request, socket, head) => {
    if (request.url !== route) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    ws.handleUpgrade(request, socket, head, (client: PageSocket) => {
      sockets.add(client);
      client.on("close", () => sockets.delete(client));
      client.on("error", () => {});
      client.on("message", async (data: Buffer) => {
        let q: CdpCommand;
        try {
          const parsed: unknown = JSON.parse(data.toString());
          if (parsed === null || typeof parsed !== "object") throw Error("Invalid command");
          q = parsed as CdpCommand;
        } catch {
          client.close(1003);
          return;
        }
        if (!Number.isSafeInteger(q.id) || typeof q.method !== "string") {
          client.close(1008);
          return;
        }
        methods[q.method] = (methods[q.method] ?? 0) + 1;
        // This smoke cannot enumerate, create, close or attach another target.
        if (
          q.sessionId ||
          denied.has(q.method) ||
          (q.method !== "Browser.getVersion" && !allowed.has(q.method.split(".")[0] ?? ""))
        ) {
          send(client, {
            id: q.id,
            error: { code: -32000, message: "Outside the benchmark page" },
          });
          return;
        }
        try {
          // This page-scoped adapter presents logical CSS coordinates to
          // agent-browser, even when the preview's view image is reduced.
          // CDP root mouse points are scaled; wheel distances are not.
          const params = q.params ?? {};
          const mapped =
            q.method === "Input.dispatchMouseEvent" &&
            typeof params.x === "number" &&
            typeof params.y === "number"
              ? { ...params, x: params.x * captureScale, y: params.y * captureScale }
              : params;
          const result = await source.debugger.sendCommand(q.method, mapped);
          send(client, { id: q.id, result: result ?? {} });
        } catch {
          send(client, {
            id: q.id,
            error: { code: -32001, message: "Benchmark page command failed" },
          });
        }
      });
    });
  });
  const events = (_e: unknown, method: string, params: unknown, session?: string) => {
    if (!session) for (const socket of sockets) send(socket, { method, params });
  };
  source.debugger.on("message", events);
  let endpoint = "";
  const config = join(root, "config.json"),
    provider = join(root, "provider.cjs");
  const session = `p-${identity.slice(0, 6)}`;
  mkdirSync(join(root, "sockets"));
  writeFileSync(
    provider,
    `let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{
    const q=JSON.parse(s);const protocol='agent-browser.plugin.v1';
    if(q.protocol!==protocol||q.capability!=='browser.provider')throw Error('unsupported');
    process.stdout.write(JSON.stringify(q.type==='browser.close'?{protocol,success:true,data:{}}:
      {protocol,success:true,browser:{cdpUrl:process.env.VF_BROWSER_PERF_ENDPOINT,directPage:true,cleanup:{}}}));
  });`,
    { mode: 0o600 },
  );
  writeFileSync(
    config,
    JSON.stringify({
      plugins: [
        {
          name: "vf-perf-page",
          command: node,
          args: [provider],
          capabilities: ["browser.provider"],
        },
      ],
      maxOutput: 20000,
    }),
    { mode: 0o600 },
  );
  const cli = async (args: string[]) => {
    const answer = await run(
      binary,
      [
        "--config",
        config,
        "--namespace",
        session,
        "--session",
        session,
        "--provider",
        "vf-perf-page",
        "--json",
        ...args,
      ],
      {
        timeout: 30000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          AGENT_BROWSER_SOCKET_DIR: join(root, "sockets"),
          AGENT_BROWSER_NAMESPACE: session,
          AGENT_BROWSER_CONFIG: config,
          VF_BROWSER_PERF_ENDPOINT: endpoint,
          AGENT_BROWSER_IDLE_TIMEOUT_MS: "10000",
        },
      },
    ).catch((error) => {
      throw new Error(
        `agent-browser ${args[0]}: ${String(error.stdout ?? "")} ${String(error.stderr ?? "")}; methods ${JSON.stringify(methods)}`.replace(
          /ws:\/\/127\.0\.0\.1:[^\s"]+/g,
          "[private endpoint]",
        ),
      );
    });
    return JSON.parse(answer.stdout);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw Error("No local agent endpoint");
    endpoint = `ws://127.0.0.1:${address.port}${route}`;
    await source.executeJavaScript(
      `globalThis.__vfBrowserPerfIdentity=${JSON.stringify(identity)}`,
    );
    const version = (await run(binary, ["--version"])).stdout.trim();
    const evaluation = await cli([
      "eval",
      "JSON.stringify({identity:globalThis.__vfBrowserPerfIdentity,url:location.href,title:document.title,width:innerWidth,height:innerHeight,dpr:devicePixelRatio})",
    ]);
    if (!evaluation.success || !JSON.stringify(evaluation).includes(identity))
      throw Error("agent-browser did not read the same live page");
    await source.executeJavaScript(
      `globalThis.__vfBrowserPerfPoint=null;addEventListener('pointermove',e=>globalThis.__vfBrowserPerfPoint=[e.clientX,e.clientY],{once:true})`,
    );
    const mouse = await cli(["mouse", "move", "320", "200"]);
    const point = await source.executeJavaScript("globalThis.__vfBrowserPerfPoint");
    if (!mouse.success || point?.[0] !== 320 || point?.[1] !== 200)
      throw Error(`agent-browser pointer mapping failed: ${JSON.stringify(point)}`);
    const snapshot = await cli(["snapshot", "-i"]);
    if (!snapshot.success) throw Error("agent-browser snapshot failed");
    const scroll = await cli(["scroll", "up", "120"]);
    if (!scroll.success) throw Error("agent-browser scroll failed");
    const afterTarget = await source.debugger.sendCommand("Target.getTargetInfo");
    const sameTarget =
      beforeTarget.targetInfo.targetId === afterTarget.targetInfo.targetId &&
      sourceId === source.id;
    if (!sameTarget) throw Error("Agent control replaced the pane target");
    return {
      version,
      captureScale,
      pointer: point,
      sameTarget,
      webContentsId: source.id,
      evaluation,
      snapshotSucceeded: snapshot.success,
      scrollSucceeded: scroll.success,
      methods,
    };
  } finally {
    try {
      await cli(["close"]);
    } catch {
      /* The dedicated daemon also has a short idle timeout. */
    }
    if (!source.isDestroyed()) {
      source.debugger.removeListener("message", events);
      await source.executeJavaScript("delete globalThis.__vfBrowserPerfIdentity").catch(() => {});
    }
    for (const socket of sockets) socket.terminate();
    await new Promise<void>((resolve) => ws.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
}
