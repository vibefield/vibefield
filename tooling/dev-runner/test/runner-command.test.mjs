import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  parseRunnerCommand,
  sendRunnerCommand,
  startRunnerCommandServer,
} from "../src/runner-command.mjs";

const BOOT_ID = "a".repeat(32);

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "vf-runner-command-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const devRoot = join(root, "dev");
  const lockDir = join(devRoot, "runner.lock");
  const endpoint = join(devRoot, "runner.sock");
  await mkdir(lockDir, { recursive: true });
  await writeFile(
    join(lockDir, "owner.json"),
    `${JSON.stringify({
      version: 2,
      repoRoot: root,
      runnerPid: process.pid,
      bootId: BOOT_ID,
      electronPid: null,
      buildId: null,
      startedAt: Date.now(),
    })}\n`,
  );
  return { root, devRoot, lockDir, endpoint };
}

test("accepts one bounded command for the current runner boot", async (t) => {
  const paths = await fixture(t);
  const received = [];
  const server = await startRunnerCommandServer({
    endpoint: paths.endpoint,
    bootId: BOOT_ID,
    async handle(command) {
      received.push(command);
      return { state: "delivered" };
    },
  });

  const response = await sendRunnerCommand({
    endpoint: paths.endpoint,
    lockDir: paths.lockDir,
    repoRoot: paths.root,
    command: { type: "studio.open", section: "design" },
  });
  assert.deepEqual(response, { status: "handled", result: { state: "delivered" } });
  assert.deepEqual(received, [{ type: "studio.open", section: "design" }]);
  assert.equal((await stat(paths.devRoot)).mode & 0o777, 0o700);
  assert.equal((await stat(paths.endpoint)).mode & 0o777, 0o600);

  await server.close();
  await assert.rejects(access(paths.endpoint), { code: "ENOENT" });
});

test("rejects stale boot identities and oversized requests without invoking the handler", async (t) => {
  const paths = await fixture(t);
  let calls = 0;
  const server = await startRunnerCommandServer({
    endpoint: paths.endpoint,
    bootId: BOOT_ID,
    async handle() {
      calls += 1;
      return {};
    },
  });
  t.after(() => server.close());

  const stale = await rawExchange(paths.endpoint, {
    version: 1,
    bootId: "b".repeat(32),
    command: { type: "studio.status" },
  });
  assert.equal(stale.code, "stale-boot");

  const oversized = await rawLine(paths.endpoint, `${"x".repeat(9_000)}\n`);
  assert.equal(oversized.code, "oversized");
  const trailing = await rawLine(
    paths.endpoint,
    `${JSON.stringify({
      version: 1,
      bootId: BOOT_ID,
      command: { type: "studio.status" },
    })}\nsecond request\n`,
  );
  assert.equal(trailing.code, "malformed");
  assert.equal(calls, 0);
});

test("reports an inactive checkout without opening a socket", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "vf-runner-command-inactive-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(
    await sendRunnerCommand({
      endpoint: join(root, "runner.sock"),
      lockDir: join(root, "runner.lock"),
      repoRoot: root,
      command: { type: "studio.open" },
    }),
    { status: "inactive" },
  );
});

test("the lifecycle command grammar is closed", () => {
  assert.deepEqual(parseRunnerCommand({ type: "studio.focus" }), { type: "studio.focus" });
  assert.throws(() => parseRunnerCommand({ type: "studio.focus", script: "arbitrary" }));
  assert.throws(() => parseRunnerCommand({ type: "renderer.evaluate" }));
  assert.throws(() => parseRunnerCommand({ type: "studio.open", section: "secrets" }));
});

function rawExchange(endpoint, value) {
  return rawLine(endpoint, `${JSON.stringify(value)}\n`);
}

function rawLine(endpoint, line) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint);
    socket.setEncoding("utf8");
    let output = "";
    socket.once("connect", () => socket.write(line));
    socket.on("data", (chunk) => {
      output += chunk;
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
