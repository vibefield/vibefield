import Foundation

/// The mesh facts this app speaks, pinned in ONE place.
///
/// `appID` mirrors `APP_ID` in `packages/contracts/src/registries.ts` — one
/// tailnet application namespace per product, which the desktop floor reads at
/// `packages/field-native/src/services/mesh.rs`. Like `FieldProductContract`'s
/// `contractsVersion` it is hand-pinned rather than generated, because this app
/// is deliberately outside `pnpm verify` and has no generator pointed at it —
/// so `scripts/check-ios-fixtures.mjs` compares this string against the
/// registry's and a drift fails the gate rather than a QA run.
///
/// It is load-bearing and not a label. A truffle node admits a peer into its
/// registry only when the peer's Tailscale hostname starts with
/// `truffle-{appId}-` (`MeshNode.upsertFromLayer3`, RFC 017 §4), so two nodes
/// with different app ids are invisible to each other however healthy both
/// are. That is exactly what James's QA of 2026-09-13 found: a signed-in phone
/// reading `online · 0 peers in reach` beside a desktop whose mesh was up.
public enum FieldMeshContract {
  /// = `APP_ID` in `packages/contracts/src/registries.ts`.
  public static let appID = "vibefield"

  // MARK: - The product door's dial target (UA-P-1a)

  /// The tailnet port a desktop's product serve listens on.
  ///
  /// = `PORTS.FIELDD_PRODUCT_SERVE` in `packages/contracts/src/registries.ts`,
  /// and pinned against it by `scripts/check-ios-fixtures.mjs` like every other
  /// registry value this app speaks. The name differs on purpose: the registry
  /// lists ports for several daemons and the `FIELDD_` prefix is what separates
  /// them there, while inside `FieldMeshContract` there is only one product
  /// door. The checker names both sides in its failure, so the pair is never
  /// ambiguous — the same licence `appID` takes against `APP_ID`.
  ///
  /// **ERRATUM (2026-09-15).** This declaration first shipped UNPINNED with a
  /// long note saying no such registry row could exist, because
  /// `productServeSpec` declared no `listenPort` and the floor therefore fell
  /// its tailnet listener back to fieldd's EPHEMERAL control port — a per-boot
  /// random number no phone can dial, which is why discovery needed a published
  /// URL. That was true when written and is FALSE NOW: UA-P-0e split the two
  /// planes, so the tailnet listener is this fixed registry port while the
  /// loopback control plane stays ephemeral (UA-D12). 9423 was a placeholder
  /// here and is the contract's number now.
  ///
  /// It is load-bearing, not a label: it is half of the only address this phone
  /// dials. The other half is the peer's own MagicDNS name, and the pair is
  /// built in one place below so the whole app follows a single edit.
  public static let productServePort = 9423

  /// The door's path, as the phone dials it.
  ///
  /// The BARE ROOT, and that is the UA-P-1a bargain: the C3 capability secret
  /// (`/t/<secret>`) is what a store used to carry to every node on the
  /// tailnet, and under the 2026-09-15 ruling nothing content-bearing rides
  /// the bus at all — so the phone cannot learn a secret path, and the sidecar
  /// adds it on forward instead. The phone therefore dials a locator with no
  /// credential in it, which is the point: what admits this phone is the
  /// sidecar's WhoIs-checked allow-list, never a string it was handed.
  public static let productDoorPath = "/"

  /// The ONE place a product door's dial target is built.
  ///
  /// It is one function so the desktop lane's outcome can move it: if the
  /// sidecar turns out to need a path rather than the root, or a different
  /// port, every dial in this app follows from here and nothing else spells a
  /// door.
  ///
  /// `ws` and not `wss`, and it is the desktop's choice rather than a
  /// slackening: the product serve is declared `tls: false`
  /// (`packages/fieldd/src/daemon.ts`, `productServeSpec`) because the tailnet
  /// is WireGuard already and a MagicDNS certificate would be a dependency
  /// bought for nothing. The contracts' own golden says the same in its
  /// published spelling (`device-slice.valid.json` carries `http://…`).
  public static func productDoorURL(host: String) -> URL? {
    url(scheme: "ws", host: host)
  }

  /// The same door, addressed for a plain request rather than an upgrade.
  ///
  /// Discovery asks the door a question before it spends a socket on one, and
  /// the question is answered in an HTTP STATUS: the sidecar's allow-list
  /// refuses a login it does not name with a 403 before fieldd ever sees the
  /// connection, and that is a different fact from a desktop that is asleep.
  /// A WebSocket upgrade cannot tell the phone which of the two happened —
  /// `URLSessionWebSocketTask` surfaces a non-101 answer as a task failure,
  /// after the transport has already handed back a connection — so the probe
  /// is its own plain request, and `ws`/`http` are the same listener.
  public static func productDoorProbeURL(host: String) -> URL? {
    url(scheme: "http", host: host)
  }

  private static func url(scheme: String, host: String) -> URL? {
    var components = URLComponents()
    components.scheme = scheme
    components.host = host
    components.port = productServePort
    components.path = productDoorPath
    return components.url
  }
}
