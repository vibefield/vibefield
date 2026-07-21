// B1 spike (renderer side): prove the canvas substrate loads in THIS exact
// runtime — Electron sandboxed renderer, prod build served over file://.
//   1. loro-crdt (aliased → base64 variant): synchronous wasm compile at
//      import; measure the boot stall it costs.
//   2. CRDT roundtrip: text edit → export snapshot → import into a second doc.
//   3. @vibecook/ice imports and exposes its engine API (pulls strata-ecs,
//      which exercises the SAME single loro resolution).
// Result is one JSON line on the console — main captures it and exits.

interface SpikeResult {
  ok: boolean;
  loroImportMs: number;
  iceImportMs: number;
  roundtripOk: boolean;
  iceApiOk: boolean;
  error?: string;
}

async function run(): Promise<SpikeResult> {
  const r: SpikeResult = { ok: false, loroImportMs: -1, iceImportMs: -1, roundtripOk: false, iceApiOk: false };
  try {
    const t0 = performance.now();
    const loro = await import("loro-crdt"); // aliased to loro-crdt/base64 at build time
    r.loroImportMs = Math.round((performance.now() - t0) * 10) / 10;

    const a = new loro.LoroDoc();
    a.getText("t").insert(0, "field alive");
    const snapshot = a.export({ mode: "snapshot" });
    const b = new loro.LoroDoc();
    b.import(snapshot);
    r.roundtripOk = b.getText("t").toString() === "field alive";

    const t1 = performance.now();
    const ice = await import("@vibecook/ice");
    r.iceImportMs = Math.round((performance.now() - t1) * 10) / 10;
    r.iceApiOk = typeof ice.createCanvasEngine === "function" && typeof ice.defineWidget === "function";

    r.ok = r.roundtripOk && r.iceApiOk;
  } catch (e) {
    r.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  return r;
}

void run().then((r) => {
  document.getElementById("out")!.textContent = JSON.stringify(r, null, 2);
  console.log(`SPIKE_LORO ${JSON.stringify(r)}`);
});
