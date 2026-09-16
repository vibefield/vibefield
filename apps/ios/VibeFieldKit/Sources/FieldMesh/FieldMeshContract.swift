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
  /// **UNPINNED, and deliberately so — read this before moving it.** Every
  /// other registry value this app speaks is compared against
  /// `packages/contracts/src/registries.ts` by `scripts/check-ios-fixtures.mjs`
  /// and a drift reds the gate. This one has no row to compare against yet:
  /// `PORTS` carries no product-serve entry, and the serve fieldd declares
  /// names no `listenPort` at all (`packages/fieldd/src/daemon.ts` —
  /// `productServeSpec`), so the floor falls its listener back to the TARGET
  /// port (`packages/field-native/src/mgmt/mesh.rs`, `parse_listen_port`),
  /// which since UA-5 is fieldd's EPHEMERAL control port. A per-boot random
  /// high port is not a number a phone can dial, which is the whole reason
  /// discovery has needed `productEndpoint.url` from the store until now.
  ///
  /// So UA-P-1a rests on the desktop lane declaring an explicit `listenPort`
  /// on a registry row, the way the terminal-cell listener already does
  /// (`PORTS.TERMINAL_CELLS_SERVE`, `packages/fieldd/src/terminal-serve.ts`).
  /// It cannot BE that listener: those routes are remove-then-add on every
  /// cell birth and exit, and the registry's own note says the product door
  /// must not share that churn because it is the channel a dropped client
  /// re-dials. 9423 is the next free number after it.
  ///
  /// The moment the row lands, arm the pin: add a `PRODUCT_SERVE` entry to
  /// `pins` in `scripts/check-ios-fixtures.mjs` (the commented row is there,
  /// with the pattern already written) and this constant is gated like every
  /// other.
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
