import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Item 213's committed probe: a CHILD vitest run over this config, rooted at packages/field-app, under the late-ack
// runner. late-ack-runner.test.ts runs it three ways:
// - LATE_ACK_INJECT set: under inject-runner.ts, whose every update also rejects with that message;
// - LATE_ACK_FIXTURE=reject: a real unhandled rejection.
// `stall` is for a hand run (65 s, the red's own shape). LATE_ACK_RUNNER=off runs any mode without a runner, where
// `stall` reproduces item 213's red:
//   LATE_ACK_FIXTURE=stall [LATE_ACK_RUNNER=off] \
//     packages/field-app/node_modules/.bin/vitest run --config packages/field-app/test/fixtures/late-ack/vitest.config.ts
const RUNNER =
  process.env.LATE_ACK_RUNNER === "off"
    ? undefined
    : process.env.LATE_ACK_INJECT === undefined
      ? "./test/late-ack-runner.ts"
      : "./test/fixtures/late-ack/inject-runner.ts";

export default defineConfig({
  // packages/field-app, so the include and the runner resolve as the suite's own config resolves them
  root: fileURLToPath(new URL("../../..", import.meta.url)),
  test: {
    cache: false,
    include: ["test/fixtures/late-ack/*.fixture.ts"],
    environment: "node",
    ...(RUNNER === undefined ? {} : { runner: RUNNER }),
  },
});
