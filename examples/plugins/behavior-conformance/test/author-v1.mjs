import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const iceModule = process.env.PRC4_ICE_MODULE;
const objectsModule = process.env.PRC4_ICE_OBJECTS_MODULE;
if (iceModule === undefined) throw new Error("PRC4_ICE_MODULE is required");
if (objectsModule === undefined) throw new Error("PRC4_ICE_OBJECTS_MODULE is required");
const { createCanvasEngine, defineBehavior, p } = await import(pathToFileURL(iceModule).href);
const { DESK_ENGINE } = await import(pathToFileURL(objectsModule).href);

// A separate process is load-bearing. Behavior names are process-global and ICE correctly refuses
// a different v2 shape in the same realm; authoring here proves genuine old plugin bytes rather
// than a v2 handle with a hand-forged marker.
//
// DK-4: the bytes are a DESK board — authored by the desk build's own engine (ICE's desk preset,
// rooted at `desk.desk`), never an untyped engine's `ice.default` board, which the desk refuses at
// open as from before the desk. The v1 behavior is the only old thing in them.
const DurableV1 = defineBehavior("vibefield.behavior-conformance:durable", {
  store: "durable",
  version: 1,
  schema: { count: p.number({ default: 5, min: 0 }) },
});

const engine = createCanvasEngine({ ...DESK_ENGINE, onBehaviorLog() {} });
engine.behaviors.register(DurableV1);
const session = await engine.docs.create();
assert.equal(session.rootCanvas?.id, "desk.desk");
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
