import type { DeviceForwarder } from "../product-api";

// SP-7a (red) — the home's half of a phone's transcript ticket: a skeleton the rows load. It carries every ask as it
// is, and checks nothing yet.

export function sparkTranscriptForwardVia(inner: DeviceForwarder): DeviceForwarder {
  return inner;
}
