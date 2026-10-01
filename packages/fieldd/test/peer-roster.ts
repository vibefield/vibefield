// D1 (2026-10-01, the DS wave 1 review) — what a tailnet door needs before it
// mints `peer-fieldd`: the sidecar's NODE id, correlated to a roster device
// whose row hosts documents (`capabilities.docHost` — a desktop, DS-D7). A
// test that hellos as a peer gives its fake door both facts; the rule is never
// weakened for a test. These are the two facts in the shapes a door and a mock
// floor take them: a bare ProductApi's `correlateNodeId` + `isDocHost`, and a
// mock floor's registry row (`meshPeers`) + device slice (`storeSlices`).
import { CONTRACTS_VERSION } from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";

/** A bare door's roster, node id → the device it correlates to and whether
 * that device's row says `docHost`. Spread into `ProductApiOptions`. */
export function peerRoster(rows: Record<string, { deviceId: string; docHost: boolean }>): {
  correlateNodeId: (nodeId: string) => string | undefined;
  isDocHost: (deviceId: string) => boolean;
} {
  return {
    correlateNodeId: (nodeId) => (Object.hasOwn(rows, nodeId) ? rows[nodeId]?.deviceId : undefined),
    isDocHost: (deviceId) =>
      Object.values(rows).some((row) => row.deviceId === deviceId && row.docHost),
  };
}

/** A device slice as a DESKTOP publishes itself into `field.devices.v1`: the
 * slice is what says `docHost`. For a mock floor's `storeSlices` (raw data). */
export function desktopSlice(deviceId: string, name: string = deviceId) {
  return {
    deviceId,
    name,
    platform: "darwin",
    headless: false,
    fielddVersion: "0.1.0",
    contractsVersion: CONTRACTS_VERSION,
    capabilities: { terminalHost: true, terminalMesh: true, docHost: true, push: false },
    productEndpoint: { serve: "product" },
    bootId: `slice-boot-${deviceId}`,
    publishedAt: Date.now(),
  };
}

/** The registry row (`native.mesh.peers.list`) that vouches for a device as
 * this account's and names the node id its sidecar is known by. */
export function registryPeer(opts: {
  nodeId: string;
  deviceId: string;
  name: string;
  login: string;
  online?: boolean;
}) {
  return {
    id: opts.nodeId,
    deviceId: opts.deviceId,
    name: opts.name,
    online: opts.online ?? true,
    whois: { login: opts.login, deviceName: `${opts.name}.tailnet.ts.net` },
  };
}

/** A logger that keeps what it is told, for rows that pin a log line. */
export function captureLog(): {
  logger: Logger;
  events: (name: string) => Array<LogFields | undefined>;
} {
  const records: Array<{ event: string; attrs: LogFields | undefined }> = [];
  const make = (): Logger => ({
    child: () => make(),
    trace: (event, _m, attrs) => void records.push({ event, attrs }),
    debug: (event, _m, attrs) => void records.push({ event, attrs }),
    info: (event, _m, attrs) => void records.push({ event, attrs }),
    warn: (event, _m, attrs) => void records.push({ event, attrs }),
    error: (event, _m, _e, attrs) => void records.push({ event, attrs }),
    fatal: (event, _m, _e, attrs) => void records.push({ event, attrs }),
    isLevelEnabled: () => true,
  });
  return {
    logger: make(),
    events: (name) => records.filter((r) => r.event === name).map((r) => r.attrs),
  };
}
