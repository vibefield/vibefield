import AuthenticationServices
import Foundation
import Testing

@testable import FieldMesh

/// TS-7 (TS-D11 A) — the system's sign-in sheet is closed by the APP: it has
/// no callback to end it. What the sheet does on every page transition and
/// phase, and how an ended sheet's error is read.
@Suite("the sign-in sheet follows the node")
struct SignInSheetTests {
  let first = URL(string: "https://login.tailscale.com/a/1a2b3c4d5e6f")!
  let second = URL(string: "https://login.tailscale.com/a/6f5e4d3c2b1a")!

  @Test("while the node asks: a page with none up is presented, the same page is kept, a new one replaces it")
  func asking() {
    for state: MeshModel.State in [.starting, .needsLogin] {
      #expect(SignInSheet.step(page: first, presented: nil, state: state) == .present(first), "\(state)")
      #expect(SignInSheet.step(page: first, presented: first, state: state) == .keep, "\(state)")
      #expect(SignInSheet.step(page: second, presented: first, state: state) == .replace(second), "\(state)")
      #expect(SignInSheet.step(page: nil, presented: nil, state: state) == .keep, "\(state)")
    }
  }

  @Test("a page withdrawn while one is up closes it, in every phase")
  func withdrawn() {
    for state: MeshModel.State in [
      .off, .starting, .needsLogin, .needsMachineAuth, .up, .stopping, .failed("x"), .reconnecting("x"),
    ] {
      #expect(SignInSheet.step(page: nil, presented: first, state: state) == .close, "\(state)")
    }
  }

  @Test("approval and up close the sheet whatever the page says, and present nothing")
  func signedIn() {
    for state: MeshModel.State in [.needsMachineAuth, .up] {
      #expect(SignInSheet.step(page: first, presented: first, state: state) == .close, "\(state)")
      #expect(SignInSheet.step(page: second, presented: first, state: state) == .close, "\(state)")
      #expect(SignInSheet.step(page: first, presented: nil, state: state) == .keep, "\(state)")
    }
  }

  @Test("only canceledLogin is the person's Cancel; anything else is a failure, said as one")
  func endings() {
    #expect(TailscaleSignInSession.ending(for: ASWebAuthenticationSessionError(.canceledLogin)) == .personCancelled)
    let invalid = TailscaleSignInSession.ending(for: ASWebAuthenticationSessionError(.presentationContextInvalid))
    #expect(invalid != .personCancelled)
    if case .failed(let reason) = invalid { #expect(!reason.isEmpty) } else { Issue.record("not a failure") }
    #expect(TailscaleSignInSession.ending(for: nil) == .failed("the sign-in sheet ended on its own"))
  }
}
