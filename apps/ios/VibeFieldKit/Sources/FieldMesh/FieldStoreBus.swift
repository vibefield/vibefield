/// THE SWITCH (UA-P-1b, 2026-09-15). The synced-store bus, off.
///
/// James ruled on 2026-09-15 (UA-P-D2, `draft/thinking-ua-phone-account.md` §6):
/// *"the VibeField ecosystem linked with this account interacts only with the
/// nodes under this user's tailscale account. The store should be scoped to the
/// login user identity."* truffle cannot gate a store by login yet — its
/// inbound admission is a self-declared app id in the hello, and
/// `truffle-vibefield-` is a NAMESPACE rather than an account boundary — so
/// until it can, **nothing content-bearing rides the bus**: the desktop
/// publishes no `field.devices.v1`, `field.agents.v1` or `field.artifacts.v1`
/// slice, and this phone consumes none.
///
/// So the reader is dormant rather than deleted. `FieldStore`,
/// `FieldStoreDoors+Mesh` and every rule they carry — request on start, version
/// monotonicity, the attribution refusal, clear, a peer leaving — are the
/// reader UA-P-4 turns back on the day truffle's per-store login gate lands
/// (`draft/thinking-ua-phone-account.md` §7, UA-P-4). Their tests stay and run,
/// against this switch: deleting a reader that is coming back would mean
/// writing it again from a design doc instead of from the thing that already
/// passed its own kill matrix.
///
/// It is ONE flag and one meaning. `FieldLink` reads it to decide whether to
/// subscribe the two stores at all; everything else about the reader is
/// unchanged, so turning it on is a one-word event rather than an archaeology.
public enum FieldStoreBus {
  /// Off since UA-P-1b. Turned on by UA-P-4, or by a test that is exercising
  /// the dormant reader deliberately.
  public static let enabledByDefault = false
}
