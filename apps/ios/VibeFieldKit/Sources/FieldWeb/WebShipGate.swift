// Item 373 (2026-11-13: the relay is built before any build leaves the developer's own phone; ship without
// it). A made app's page can open TCP connections, not requests, to a tailnet address it names through a public DNS
// name, until SP-4d's relay stands at the dial. So the web host compiles
// only under `#if DEBUG || VF_WEB_RELAY`, a compilation condition FieldWeb's target gets
// (`swiftSettings: [.define("VF_WEB_RELAY")]`) only at SP-4d's land. A Release archive without it never compiles the
// host, so the archive check (`apps/ios/scripts/testflight.sh`, the web markers) finds none. `relayBuilt` is DERIVED
// from that condition, never set by hand; `apps/ios/ship-gates.txt` carries the gate's line.
// Item 522 (2026-11-17): three targets hold code under that condition, so SP-4d's land gives the define to all three
// together: FieldWeb (the host and its filtering front), FieldMesh (`MeshModel.peerStream`, the front's origin dial)
// and FieldHome (the dials, and the view that mounts the host). Given to fewer, a build either fails to compile
// (FieldHome's gated code names what FieldWeb or FieldMesh then did not compile) or compiles a host that no view
// mounts (FieldWeb without FieldHome); none builds a mounted host without its front's dials.

public enum WebShipGate {
  #if VF_WEB_RELAY
    /// SP-4d's relay is built: FieldWeb was compiled with `VF_WEB_RELAY`.
    public static let relayBuilt = true
  #else
    /// SP-4d's relay is not built: FieldWeb was compiled without `VF_WEB_RELAY`.
    public static let relayBuilt = false
  #endif

  /// Whether this build compiled the app web host at all: a Debug build (a dev phone), or the relay's define.
  public static var opensApps: Bool {
    #if DEBUG || VF_WEB_RELAY
      return true
    #else
      return false
    #endif
  }
}
