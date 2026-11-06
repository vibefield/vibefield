import { PORTS } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import type { ServeSpec, ServeState } from "../src/mesh-client";
import {
  TRANSCRIPT_SERVE_ID,
  TranscriptServeDriver,
  transcriptEndpointFrom,
  transcriptServeSpec,
} from "../src/transcripts/serve";
import { TEST_LOGIN } from "./link-fixture";

// SP-7a (D1 (B), D4; `transcripts/serve.ts`) — the transcript worker's routed serve: its own tailnet listener
// (PORTS.SPARK_TRANSCRIPT_SERVE) onto the ready generation's ephemeral loopback port, gated by the linked login,
// withdrawn while no generation is ready, and re-aimed at each new one (the index serve's precedent,
// index-serve.test.ts). A phone's ticket names the endpoint read off the LIVE serve aimed at the generation answering
// now, never a URL the contract would refuse.

const PORT = 53817;
const URL_LIVE = "http://desk.tail1234.ts.net:9426";

describe("SP-7a — the transcript worker's routed serve, from the readings", () => {
  const ready = { port: PORT, linkedLogin: TEST_LOGIN };

  it("publishes the worker's listener on its own tailnet port, gated by the login", () => {
    expect(transcriptServeSpec(ready)).toEqual({
      serveId: TRANSCRIPT_SERVE_ID,
      name: TRANSCRIPT_SERVE_ID,
      listenPort: PORTS.SPARK_TRANSCRIPT_SERVE,
      target: { kind: "port", port: PORT },
      tls: false,
      allow: [TEST_LOGIN],
    } satisfies ServeSpec);
  });

  it("publishes nothing with no linked login, or with no ready generation to aim at", () => {
    expect(transcriptServeSpec({ ...ready, linkedLogin: null })).toBeNull();
    expect(transcriptServeSpec({ ...ready, port: undefined })).toBeNull();
  });

  it("names the phone's endpoint only off the LIVE serve aimed at the generation answering now", () => {
    const live = (over: Partial<ServeState> = {}): ServeState => ({
      ...(transcriptServeSpec(ready) as ServeSpec),
      status: "active",
      url: URL_LIVE,
      ...over,
    });
    expect(transcriptEndpointFrom([live()], PORT)).toBe(
      "ws://desk.tail1234.ts.net:9426/transcripts",
    );
    expect(transcriptEndpointFrom([live({ url: "https://desk.tail1234.ts.net:9426" })], PORT)).toBe(
      "wss://desk.tail1234.ts.net:9426/transcripts",
    );
    // the node has not taken it yet, or reported it failed
    expect(transcriptEndpointFrom([live({ status: "pending" })], PORT)).toBeUndefined();
    expect(transcriptEndpointFrom([live({ status: "error" })], PORT)).toBeUndefined();
    // a new generation listens on another port and the re-aim has not landed: the serve forwards to a dead port
    expect(transcriptEndpointFrom([live()], 53900)).toBeUndefined();
    // no generation is ready, or there is no serve at all
    expect(transcriptEndpointFrom([live()], undefined)).toBeUndefined();
    expect(transcriptEndpointFrom([], PORT)).toBeUndefined();
    // a URL the contract would refuse is never handed out: another tailnet port, a loopback host
    expect(
      transcriptEndpointFrom([live({ url: "http://desk.tail1234.ts.net:9999" })], PORT),
    ).toBeUndefined();
    expect(transcriptEndpointFrom([live({ url: "http://127.0.0.1:9426" })], PORT)).toBeUndefined();
  });

  it("re-aims across a worker restart: withdraws while no generation is ready, declares the new port", async () => {
    let port: number | undefined;
    const declared: Array<ServeSpec | null> = [];
    const driver = new TranscriptServeDriver({
      port: () => port,
      linkedLogin: () => TEST_LOGIN,
      declare: async (spec) => {
        declared.push(spec);
        return true;
      },
    });
    await driver.refresh(); // F-H1: the first reading is declared, even "nothing"
    port = PORT;
    await driver.refresh();
    port = undefined; // restarting
    await driver.refresh();
    port = 53900;
    await driver.refresh();
    await driver.refresh(); // replayed: not news
    expect(declared.map((s) => (s?.target.kind === "port" ? s.target.port : null))).toEqual([
      null,
      PORT,
      null,
      53900,
    ]);
  });
});
