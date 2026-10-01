/// THE SWITCH (UA-P-1b, 2026-09-15; **flipped by UA-P-5, 2026-09-16**). The
/// synced-store bus, and what it is now keyed to.
///
/// James ruled on 2026-09-15 (UA-P-D2, `draft/thinking-ua-phone-account.md` §6):
/// *"the VibeField ecosystem linked with this account interacts only with the
/// nodes under this user's tailscale account. The store should be scoped to the
/// login user identity."* truffle could not gate by login then — its inbound
/// admission was a self-declared app id in the hello, and `truffle-vibefield-`
/// is a NAMESPACE rather than an account boundary — so nothing content-bearing
/// rode the bus and this flag was `false` outright.
///
/// **truffle can gate by login now** (RFC 025, the petition window this kit
/// consumes): a node started with a non-empty `loginAllow` reports only peers
/// whose Layer 3 login matches and refuses every other hello with 4004. Every
/// store on such a node is scoped by construction — which is RFC 025 §3.1's
/// own corollary and exactly the law James ruled.
///
/// So the flag is `true` and the SCOPE moved to where it belongs: `FieldLink`
/// reads the bus only while its node is GATED (`storeBus:`, fed from
/// `FieldTruffleRuntime.isGatedOnAccount`). The pre-login window — a node that
/// has not yet learned its own login and is therefore on the whole tailnet —
/// publishes nothing and reads nothing, because that window is precisely the
/// audience the ruling forbids. The flag is the DEFAULT; the gate is the
/// condition; a caller that names neither gets the ungated answer, which is
/// off.
///
/// *DS-D14 (2026-10-01): the bus carries PRESENCE only — `field.devices.v1`.
/// The board's store (`field.agents.v1`) is retired; the field is the home's
/// mesh board over the door (DS-8).*
public enum FieldStoreBus {
  /// On since UA-P-5. It is a default and not a verdict: the bus is live only
  /// where the node is gated on this account's login, and `FieldLink`'s
  /// `storeBus` parameter is where that is decided per link.
  public static let enabledByDefault = true
}
