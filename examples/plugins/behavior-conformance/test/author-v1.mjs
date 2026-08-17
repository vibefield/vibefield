import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const iceModule = process.env.PRC4_ICE_MODULE;
if (iceModule === undefined) throw new Error("PRC4_ICE_MODULE is required");
const { createCanvasEngine, defineBehavior, p } = await import(pathToFileURL(iceModule).href);

// A separate process is load-bearing. Behavior names are process-global and ICE correctly refuses
// a different v2 shape in the same realm; authoring here proves genuine old plugin bytes rather
// than a v2 handle with a hand-forged marker.
const DurableV1 = defineBehavior("vibefield.behavior-conformance:durable", {
  store: "durable",
  version: 1,
  schema: { count: p.number({ default: 5, min: 0 }) },
});

const engine = createCanvasEngine({ onBehaviorLog() {} });
engine.behaviors.register(DurableV1);
const session = await engine.docs.create();
let entity;
session.store.transaction(
  (tx) => {
    entity = tx.spawn({ components: [[DurableV1.component, { count: 41 }]] });
  },
  { undoable: false },
);
engine.world.sync();
engine.step(16);
assert.notEqual(entity, undefined);
assert.deepEqual(engine.behaviors.read(entity, DurableV1), { count: 41 });
const key = session.store.keyOf(entity);
assert.equal(typeof key, "string");
const envelope = Buffer.from(session.exportEnvelope()).toString("base64");
engine.dispose();
process.stdout.write(JSON.stringify({ envelope, key }));
