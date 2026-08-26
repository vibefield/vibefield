import { chmod, mkdir, unlink } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { dirname } from "node:path";
import { readDevLockOwner } from "./dev-lock.mjs";
import { isPidAlive } from "./processes.mjs";

const PROTOCOL_VERSION = 1;
const MAX_MESSAGE_BYTES = 8 * 1024;
const BOOT_ID = /^[a-f0-9]{32}$/;
const SECTIONS = new Set(["design", "appearance"]);

export function parseRunnerCommand(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("malformed runner command");
  }
  const keys = Object.keys(value).sort();
  switch (value.type) {
    case "studio.open": {
      if (value.section === undefined) {
        requireKeys(keys, ["type"]);
        return { type: "studio.open" };
      }
      requireKeys(keys, ["section", "type"]);
      if (!SECTIONS.has(value.section)) throw new Error("invalid Studio section");
      return { type: "studio.open", section: value.section };
    }
    case "studio.focus":
    case "studio.close":
    case "studio.status":
      requireKeys(keys, ["type"]);
      return { type: value.type };
    default:
      throw new Error("unknown runner command");
  }
}

export async function startRunnerCommandServer({
  endpoint,
  bootId,
  handle,
  platform = process.platform,
}) {
  if (!BOOT_ID.test(bootId)) throw new Error("invalid runner boot identity");
  if (platform !== "win32") {
    await mkdir(dirname(endpoint), { recursive: true, mode: 0o700 });
    await chmod(dirname(endpoint), 0o700);
    await unlinkIfPresent(endpoint);
  }

  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding("utf8");
    socket.setTimeout(2_000, () => socket.destroy());
    let input = "";
    let handled = false;
    socket.on("data", (chunk) => {
      if (handled) return;
      input += chunk;
      if (Buffer.byteLength(input, "utf8") > MAX_MESSAGE_BYTES) {
        handled = true;
        respond(socket, { ok: false, code: "oversized" });
        return;
      }
      const newline = input.indexOf("\n");
      if (newline === -1) return;
      handled = true;
      if (input.slice(newline + 1).trim() !== "") {
        respond(socket, { ok: false, code: "malformed" });
        return;
      }
      void receiveRequest(input.slice(0, newline), bootId, handle)
        .then((response) => respond(socket, response))
        .catch(() => respond(socket, { ok: false, code: "internal-error" }));
    });
    socket.once("close", () => sockets.delete(socket));
    socket.once("error", () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  if (platform !== "win32") await chmod(endpoint, 0o600);

  let closed = false;
  return {
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
      if (platform !== "win32") await unlinkIfPresent(endpoint);
    },
  };
}

export async function sendRunnerCommand({
  endpoint,
  lockDir,
  repoRoot,
  command,
  pidAlive = isPidAlive,
  attempts = 20,
}) {
  const owner = await readDevLockOwner(lockDir);
  if (owner === null || owner.repoRoot !== repoRoot || !pidAlive(owner.runnerPid)) {
    return { status: "inactive" };
  }
  if (owner.version !== 2 || !BOOT_ID.test(owner.bootId ?? "")) {
    throw new Error(
      "the active development runner predates the Studio command channel; restart it",
    );
  }
  const parsed = parseRunnerCommand(command);
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await exchange(endpoint, {
        version: PROTOCOL_VERSION,
        bootId: owner.bootId,
        command: parsed,
      });
      if (
        response?.version !== PROTOCOL_VERSION ||
        response.ok !== true ||
        typeof response.result !== "object" ||
        response.result === null
      ) {
        throw new Error(
          `development runner rejected the command (${response?.code ?? "malformed"})`,
        );
      }
      return { status: "handled", result: response.result };
    } catch (error) {
      lastError = error;
      if (!retryable(error) || attempt === attempts - 1) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("the development runner is active but its command endpoint is unavailable", {
    cause: lastError,
  });
}

async function receiveRequest(serialized, bootId, handle) {
  let request;
  try {
    request = JSON.parse(serialized);
  } catch {
    return { ok: false, code: "malformed" };
  }
  if (
    request?.version !== PROTOCOL_VERSION ||
    request.bootId !== bootId ||
    typeof request.command !== "object"
  ) {
    return { ok: false, code: request?.bootId === bootId ? "malformed" : "stale-boot" };
  }
  try {
    return { ok: true, result: await handle(parseRunnerCommand(request.command)) };
  } catch {
    return { ok: false, code: "command-failed" };
  }
}

function exchange(endpoint, request) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint);
    socket.setEncoding("utf8");
    socket.setTimeout(2_000, () => socket.destroy(new Error("runner command timed out")));
    let output = "";
    socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => {
      output += chunk;
      if (Buffer.byteLength(output, "utf8") > MAX_MESSAGE_BYTES) {
        socket.destroy(new Error("runner response was oversized"));
      }
    });
    socket.once("end", () => {
      try {
        resolve(JSON.parse(output));
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", reject);
  });
}

function respond(socket, response) {
  let serialized = `${JSON.stringify({ version: PROTOCOL_VERSION, ...response })}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_MESSAGE_BYTES) {
    serialized = `${JSON.stringify({
      version: PROTOCOL_VERSION,
      ok: false,
      code: "oversized",
    })}\n`;
  }
  socket.end(serialized);
}

function requireKeys(actual, expected) {
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error("runner command has unexpected fields");
  }
}

function retryable(error) {
  return error?.code === "ENOENT" || error?.code === "ECONNREFUSED" || error?.code === "EPIPE";
}

async function unlinkIfPresent(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
