// Opt-in simulator witness: real fieldd, files worker and native floor over a
// temporary tree. The agent adapter is /bin/cat. A test-only loopback bridge
// authenticates the simulator as a minted renderer participant; no real tailnet
// or WhoIs is claimed. Self-phone admission is covered by workspace-doors.test.ts.
// Run from this repo: node --import ./packages/contracts/node_modules/tsx/dist/loader.mjs
//   packages/fieldd/test/fixtures/ios-workspace.ts
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import type { AgentProvider } from "@vibecook/puppeteer-runtime";
import { SOCKETS } from "@vibefield/contracts";
import { FielddClient } from "@vibefield/fieldd-client";
import WebSocket, { WebSocketServer } from "ws";
import { bootstrap } from "../../src/index";
import { SCRIPTED_ROW } from "../agent-catalog-fixture";
import { filesHostLaunch } from "../files-host-bundle";
import { killDaemonTree, nativeBinPath, nativeEndpoint, waitForEndpoint } from "../native-harness";

const configFile = "/private/tmp/vibefield-fs2-loopback.json";
const root = realpathSync(mkdtempSync("/private/tmp/vf-fs2-live-"));
const home = join(root, "home");
mkdirSync(join(home, "Projects", "LaunchHere"), { recursive: true });
writeFileSync(join(home, "Projects", "notes.txt"), "not a launch folder\n");
let spawnedCwd: string | undefined;
const provider: AgentProvider = {
  descriptor: { id: SCRIPTED_ROW.id, label: SCRIPTED_ROW.label },
  async createSession(options) {
    spawnedCwd = options.cwd;
    const { runtimeSessionId } = await options.host.spawnTerminal({
      command: "/bin/sh",
      args: ["-c", "exec /bin/cat"],
      cwd: options.cwd,
      env: options.environment ?? {},
    });
    return {
      sessionId: `fs2-${Date.now()}`,
      runtimeSessionId,
      observationLevel: () => "terminal-only",
      events: { onCandidate: () => () => undefined },
      services: {
        prompt: {
          async submit() {
            return { status: "rejected" as const, reason: "fixture is read-only" };
          },
        },
      },
      async dispose() {},
    };
  },
};
const repo = resolve(import.meta.dirname, "../../../..");
const native = spawn(process.env["FS2_NATIVE_BIN"] ?? nativeBinPath(repo), [], {
  env: {
    ...process.env,
    FIELD_NATIVE_DATA_DIR: root,
    FIELD_LOG_DIR: join(root, "logs"),
    FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE: "1",
  },
  stdio: "ignore",
});
process.on("exit", () => {
  native.kill("SIGTERM");
  rmSync(configFile, { force: true });
});
native.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
await waitForEndpoint(nativeEndpoint(root, SOCKETS.MGMT), 30_000);
const daemon = await bootstrap({
  dataDir: root,
  controlPort: 0,
  dataPort: 0,
  rosettadHome: home,
  agentSearchPath: join(root, "no-vendor-binaries"),
  vibefieldRoot: root,
  agentCatalog: [SCRIPTED_ROW],
  agentProviders: () => [provider],
  filesHost: await filesHostLaunch(),
  workspace: {
    browse: () => ({
      platform: process.platform,
      home: home.replace(/^\/private\//, "/"),
      user: "",
      fs: {
        readdir: () => [],
        realpath: (path) => path,
        isDirectory: existsSync,
        exists: existsSync,
      },
    }),
  },
});
const deadline = Date.now() + 30_000;
while (daemon.workspace.supervisor.health().phase !== "ready") {
  if (Date.now() > deadline) throw new Error("witness services did not become ready");
  await new Promise((r) => setTimeout(r, 50));
}
const shell = new FielddClient({
  url: `ws://127.0.0.1:${daemon.controlPort}`,
  token: daemon.shellToken,
  clientKind: "shell-main",
});
shell.connect();
const grant = (await shell.request("system.mintWindowToken", {
  scopes: ["workspace.read", "agent.spawn", "agent.observe"],
  label: "FS-2 simulator fixture",
  rendererParticipant: {
    participantId: "renderer:fs2-fixture",
    incarnation: "renderer:fs2-fixture:1",
  },
})) as { token: string };
const methods: string[] = [];
const sockets = new WebSocketServer({ noServer: true });
const server = createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.url === "/proof") {
    response.end(
      JSON.stringify({
        methods,
        spawnedCwd,
        worker: "real",
        native: "real",
        agent: "/bin/cat",
        authentication: "test renderer participant bridge; no tailnet",
      }),
    );
  } else {
    response.end(
      JSON.stringify({ device: daemon.devices.currentDeviceId(), home, provider: SCRIPTED_ROW.id }),
    );
  }
});
server.on("upgrade", (request, socket, head) =>
  sockets.handleUpgrade(request, socket, head, (downstream) => {
    const upstream = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
    const queue: string[] = [];
    downstream.on("message", (data) => {
      let text = data.toString();
      try {
        const message = JSON.parse(text);
        const method = message.method;
        if (method) methods.push(method);
        if (method === "system.hello") {
          message.params = { ...message.params, clientKind: "renderer", credential: grant.token };
          text = JSON.stringify(message);
        }
      } catch {
        /* fieldd validates */
      }
      if (upstream.readyState === WebSocket.OPEN) upstream.send(text);
      else if (queue.length < 16) queue.push(text);
      else downstream.close();
    });
    upstream.on("open", () => {
      for (const text of queue) upstream.send(text);
      queue.length = 0;
    });
    upstream.on("message", (data) => {
      if (downstream.readyState === WebSocket.OPEN) downstream.send(data.toString());
    });
    upstream.on("error", () => downstream.close());
    downstream.on("error", () => upstream.close());
    upstream.on("close", () => downstream.close());
    downstream.on("close", () => upstream.close());
  }),
);
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
if (!address || typeof address === "string") throw new Error("no witness listener");
writeFileSync(
  configFile,
  JSON.stringify({
    url: `ws://127.0.0.1:${address.port}/door`,
    config: `http://127.0.0.1:${address.port}/config`,
    proof: `http://127.0.0.1:${address.port}/proof`,
  }),
  { mode: 0o600 },
);
console.log("FS2_LOOPBACK_READY");
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  rmSync(configFile, { force: true });
  for (const socket of sockets.clients) socket.terminate();
  sockets.close();
  server.close();
  shell.close();
  await daemon.stop();
  await killDaemonTree(native);
  rmSync(root, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
