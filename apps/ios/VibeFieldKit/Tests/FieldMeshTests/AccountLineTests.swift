import Testing

@testable import FieldMesh

/// UA-P-1c and UA-P-5 — the account line.
///
/// James's chain is *tailscale login → the account bound to it → that account's
/// mesh → the services on top*, and the phone drew no part of it: "signed in"
/// was a truffle PHASE and never a WHO. UA-P-1c drew the tailnet domain and
/// said in its own row that it claimed nothing about who. **UA-P-5 is where
/// that row turns over**: petition T4 landed as RFC 025 §3.6 (D7), the login is
/// on `MeshNode.loginName`, and the line asserts WHO.
@Suite struct AccountLineTests {
  /// THE LINE, as the design of record spells it: "<login> · <domain>".
  @Test func theLineNamesTheAccountAndTheTailnetItIsOn() {
    #expect(
      MeshDisplay.accountLine(login: "alice@corp.com", domain: "tail1234.ts.net")
        == "alice@corp.com · tail1234.ts.net")
  }

  /// **The row UA-P-1c pinned, TURNED OVER.** It used to assert the line
  /// contained no `@` — the interim's own limit, written as a test so the
  /// interim could not quietly be mistaken for the real thing. The real thing
  /// is here, so the assertion inverts: the line names a person now.
  @Test func theLineAssertsWho() {
    let line = try! #require(
      MeshDisplay.accountLine(login: "alice@corp.com", domain: "tail1234.ts.net"))
    #expect(line.hasPrefix("alice@corp.com"))
    #expect(line.contains("@"))
    #expect(line.hasSuffix("tail1234.ts.net"))
  }

  /// The window before Layer 3 has named a login keeps the UA-P-1c sentence
  /// word for word. It claims nothing about who, which is the honest report of
  /// not yet knowing (RFC 022: absent, never fabricated) — and it is not a
  /// blank and not a guess.
  @Test func anUnknownLoginKeepsTheDomainLine() {
    #expect(
      MeshDisplay.accountLine(login: nil, domain: "tail1234.ts.net")
        == "signed in to tail1234.ts.net")
    #expect(
      MeshDisplay.accountLine(login: "", domain: "tail1234.ts.net")
        == "signed in to tail1234.ts.net")
    #expect(MeshDisplay.accountLine(domain: "tail1234.ts.net") == "signed in to tail1234.ts.net")
  }

  /// A person with no network named is still a true thing to say.
  @Test func aKnownLoginWithNoDomainIsStillDrawn() {
    #expect(MeshDisplay.accountLine(login: "alice@corp.com", domain: nil) == "alice@corp.com")
    #expect(MeshDisplay.accountLine(login: "alice@corp.com", domain: "") == "alice@corp.com")
  }

  /// Neither known is no line at all — before the node is up, or on a dns name
  /// with no labels to drop. A line reading "signed in to —" would be the blank
  /// design-00 forbids.
  @Test func knowingNeitherIsNoLineRatherThanABlankOne() {
    #expect(MeshDisplay.accountLine(login: nil, domain: nil) == nil)
    #expect(MeshDisplay.accountLine(login: "", domain: "") == nil)
    #expect(MeshDisplay.accountLine(domain: nil) == nil)
  }

  /// The separator is the mesh's own — the one `chipLabel` joins two instrument
  /// readings with. One corner, one vocabulary.
  @Test func theSeparatorIsTheOneTheMeshAlreadyUses() {
    let line = try! #require(
      MeshDisplay.accountLine(login: "alice@corp.com", domain: "tail1234.ts.net"))
    #expect(line.contains(" · "))
    #expect(MeshDisplay.chipLabel(state: .up, peerCount: 2, linkToken: "DOOR").contains(" · "))
  }
}
