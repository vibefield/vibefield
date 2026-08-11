import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import test from "node:test";
import { watchCriticalRoots } from "../src/critical-watcher.mjs";
import { repoRoot } from "../src/paths.mjs";

const CONTRACTS_SRC = join(repoRoot, "packages", "contracts", "src");

function fakeWatch(behaviour = () => "ok") {
  const created = [];
  return {
    created,
    watchPath(root, options, listener) {
      const outcome = behaviour(created.length);
      if (outcome instanceof Error) throw outcome;
      const watcher = new EventEmitter();
      Object.assign(watcher, {
        closed: false,
        close() {
          watcher.closed = true;
        },
      });
      created.push({ root, recursive: options.recursive, listener, watcher });
      return watcher;
    },
  };
}

async function waitUntil(condition, label) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${label}`);
}

test("a change is reported once, repo-relative, after the debounce", async () => {
  const fake = fakeWatch();
  const changes = [];
  const stop = watchCriticalRoots([CONTRACTS_SRC], (file) => changes.push(file), {
    log: { warn() {} },
    watchPath: fake.watchPath,
  });
  const { listener } = fake.created[0];
  listener("change", "registries.ts");
  listener("change", "registries.ts");
  listener("change", "node_modules/ignored.ts");

  await waitUntil(() => changes.length > 0, "the debounced change");
  assert.deepEqual(changes, ["packages/contracts/src/registries.ts"]);
  stop();
});

test("a watcher error re-arms the same root instead of killing the dev loop", async () => {
  // Windows raises EPERM when a watched directory is renamed or deleted. With
  // no error handler that is an uncaughtException, and cli.mjs turns any
  // uncaughtException into a full dev-loop shutdown.
  const fake = fakeWatch();
  const warnings = [];
  const stop = watchCriticalRoots([CONTRACTS_SRC], () => {}, {
    log: { warn: (message) => warnings.push(message) },
    watchPath: fake.watchPath,
    rearmMs: 1,
  });
  const first = fake.created[0].watcher;
  first.emit("error", Object.assign(new Error("watch EPERM"), { code: "EPERM" }));

  await waitUntil(() => fake.created.length === 2, "the re-armed watcher");
  assert.equal(first.closed, true);
  assert.equal(fake.created[1].root, CONTRACTS_SRC);
  assert.match(warnings[0], /re-arming/);

  stop();
  assert.equal(fake.created[1].watcher.closed, true);
});

test("a root that keeps failing is declared degraded and stops retrying", async () => {
  // The re-arm itself throws once the directory is gone, so the cap has to
  // cover synchronous failures too or the retry timer becomes the crash.
  const fake = fakeWatch((attempt) =>
    attempt === 0 ? "ok" : Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
  );
  const warnings = [];
  const stop = watchCriticalRoots([CONTRACTS_SRC], () => {}, {
    log: { warn: (message) => warnings.push(message) },
    watchPath: fake.watchPath,
    rearmMs: 1,
  });
  fake.created[0].watcher.emit("error", new Error("watch EPERM"));

  await waitUntil(
    () => warnings.some((message) => message.startsWith("watch degraded")),
    "the degraded verdict",
  );
  const attempts = warnings.filter((message) => message.includes("re-arming")).length;
  assert.equal(attempts, 4);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(warnings.filter((message) => message.startsWith("watch degraded")).length, 1);
  stop();
});
