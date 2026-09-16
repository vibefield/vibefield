import Testing

@testable import FieldMesh

/// UA-P-1c — the account line (D3 interim).
///
/// James's chain is *tailscale login → the account bound to it → that account's
/// mesh → the services on top*, and the phone drew no part of it: "signed in"
/// was a truffle PHASE and never a WHO. The one account-adjacent fact this
/// phone holds — its own tailnet domain — was computed to pin a peer's door to
/// that peer and shown nowhere.
@Suite struct AccountLineTests {
  @Test func theLineNamesTheTailnetTheNodeIsOn() {
    #expect(MeshDisplay.accountLine(domain: "tail1234.ts.net") == "signed in to tail1234.ts.net")
  }

  /// THE INTERIM'S OWN LIMIT, written as a row. A tailnet is not a person: the
  /// real line is "<login> · <domain>" and needs the login name on truffle's
  /// Apple plane, which is not there (petition T4, UA-P-D3). So the sentence
  /// names the network and claims nothing about who.
  @Test func theLineClaimsNothingAboutWho() {
    let line = try! #require(MeshDisplay.accountLine(domain: "tail1234.ts.net"))
    #expect(!line.contains("@"))
    #expect(line.hasSuffix("tail1234.ts.net"))
  }

  /// An absent domain is a fact not yet known — before the node is up, or on a
  /// dns name with no labels to drop. A line reading "signed in to —" would be
  /// the blank design-00 forbids, so there is no line at all.
  @Test func noDomainIsNoLineRatherThanABlankOne() {
    #expect(MeshDisplay.accountLine(domain: nil) == nil)
    #expect(MeshDisplay.accountLine(domain: "") == nil)
  }
}
