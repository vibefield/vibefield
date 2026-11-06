import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LAYOUT, SPARK_TRANSCRIPT, SparkTranscriptOpenTicketResult } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { SparkTranscripts } from "../src/spark-transcripts";
import { TranscriptHostSupervisor } from "../src/transcripts/supervisor";
import { transcriptHostLaunch } from "./transcript-host-bundle";

// SP-7a W1 (SP-7a's plan, §W1) — the phone's reader against the REAL transcript worker. Opt-in: off unless
// `SP7A_W1_DIR` names a folder. The gate host (vf-m1) runs it beside the kit's live row `SparkTranscriptLiveTests`,
// whose simulator shares this host's loopback. This row is the half fieldd keeps:
// - it starts fieldd's own worker under its supervisor, over a spark folder in that dir;
// - it writes a run, your words and a reply;
// - every 15 s (a ticket is single-use) it mints a ticket as the door does (`SparkTranscriptTickets.open`'s
//   registerTicket, a fresh 32-byte ticket) and writes the door's answer, parsed by the contract, to `ticket.json`;
// - it appends a reply each second (the tail), until the kit writes `kit-done` or SP7A_W1_HOLD_MS passes.
// What the kit saw is the kit's own (`kit-saw.json`); this row asserts only that the kit finished. A dial with no
// Origin is this machine's client (listener.ts's Origin rule), and W1 proves it in the real handshake.

const DIR = process.env.SP7A_W1_DIR;
const HOLD_MS = Number(process.env.SP7A_W1_HOLD_MS ?? 600_000);
const SPARK = "sp-w1phone01";
const RUN = "run-w1-phone-1";

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) {
    try {
      await fn();
    } catch {
      // gone already
    }
  }
});

/** Whether `test` came true within `ms`. */
async function came(test: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!test()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
}

describe.skipIf(DIR === undefined)("SP-7a W1 — the real worker, for the phone's reader", () => {
  it(
    "serves a kept transcript and its tail to the kit's live row until it is done",
    async () => {
      const dir = DIR as string;
      mkdirSync(dir, { recursive: true });
      const root = join(dir, "field");
      const store = new SparkTranscripts({
        dir: join(root, ...LAYOUT.SPARK_FILES_DIR),
        keyPath: join(root, ...LAYOUT.SPARK_FILES_KEY_FILE),
      });
      store.append(SPARK, RUN, { kind: "run", runtimeRunId: RUN, fresh: true });
      store.append(SPARK, RUN, { kind: "you", via: "chat", text: "read me on the phone" });
      store.append(SPARK, RUN, { kind: "reply", messageId: "m-0", text: "Kept, and served." });
      const supervisor = new TranscriptHostSupervisor({
        launch: { kind: "launch", launch: await transcriptHostLaunch() },
        dir: join(root, ...LAYOUT.SPARK_FILES_DIR),
        key: () => store.secret(),
        allowedOrigins: [],
      });
      cleanup.push(() => supervisor.stop());
      store.onAppend((spark, run) => supervisor.appended(spark, run));
      supervisor.start();
      expect(
        await came(() => supervisor.health().phase === "ready", 30_000),
        "the worker said ready",
      ).toBe(true);

      let minted = 0;
      const mint = async () => {
        const ticket = randomBytes(32).toString("base64url");
        const expiresAt = Date.now() + SPARK_TRANSCRIPT.TICKET_TTL_MS;
        const { port } = await supervisor.request("registerTicket", {
          ticket,
          spark: SPARK,
          clientId: "tok-sp7a-w1",
          expiresAt,
        });
        const answer = SparkTranscriptOpenTicketResult.parse({
          spark: SPARK,
          endpoint: `ws://127.0.0.1:${port}/transcripts`,
          ticket,
          expiresAt,
          generation: supervisor.health().generation,
          runs: [...store.runs(SPARK).runs],
        });
        writeFileSync(join(dir, "ticket.json.part"), `${JSON.stringify(answer, null, 2)}\n`);
        renameSync(join(dir, "ticket.json.part"), join(dir, "ticket.json"));
        minted += 1;
      };
      await mint();
      const refresh = setInterval(() => void mint(), 15_000);
      cleanup.push(() => clearInterval(refresh));
      let n = 0;
      const tail = setInterval(() => {
        n += 1;
        store.append(SPARK, RUN, {
          kind: "reply",
          messageId: `m-${n}`,
          text: `The tail, line ${n}.`,
        });
      }, 1_000);
      cleanup.push(() => clearInterval(tail));
      process.stdout.write(`SP7A_W1 ready: ${dir}/ticket.json (spark ${SPARK}, run ${RUN})\n`);

      const done = await came(() => existsSync(join(dir, "kit-done")), HOLD_MS);
      const saw = existsSync(join(dir, "kit-saw.json"))
        ? readFileSync(join(dir, "kit-saw.json"), "utf8")
        : "(no kit-saw.json)";
      process.stdout.write(`SP7A_W1 kit-saw: ${saw}\n`);
      process.stdout.write(`SP7A_W1 tickets minted ${minted}, tail lines ${n}\n`);
      expect(done, `waited ${HOLD_MS} ms for the kit's kit-done; none came`).toBe(true);
    },
    HOLD_MS + 120_000,
  );
});
