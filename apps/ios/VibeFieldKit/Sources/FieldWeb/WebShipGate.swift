// Item 373 (James, 2026-11-13 01:44:27Z: "Build the relay before any build leaves my own phone; ship to me without
// it"). A made app's page can open TCP connections, not requests, to a tailnet address it names through a public DNS
// name, until SP-4d's relay stands at the dial. The IOS lane's ruling (PLAN-373, VF-PM 01:50Z): the web host compiles
// only under `#if DEBUG || VF_WEB_RELAY`, a compilation condition FieldWeb's target gets
// (`swiftSettings: [.define("VF_WEB_RELAY")]`) only at SP-4d's land. A Release archive without it never compiles the
// host, so the archive check (`apps/ios/scripts/testflight.sh`, the web markers) finds none. `relayBuilt` is DERIVED
// from that condition, never set by hand; `apps/ios/ship-gates.txt` carries the gate's line.

public enum WebShipGate {
  #if VF_WEB_RELAY
    /// SP-4d's relay is built: FieldWeb was compiled with `VF_WEB_RELAY`.
    public static let relayBuilt = true
  #else
    /// SP-4d's relay is not built: FieldWeb was compiled without `VF_WEB_RELAY`.
    public static let relayBuilt = false
  #endif

  /// Whether this build compiled the app web host at all: a Debug build (James's own phone), or the relay's define.
  public static var opensApps: Bool {
    #if DEBUG || VF_WEB_RELAY
      return true
    #else
      return false
    #endif
  }
}
