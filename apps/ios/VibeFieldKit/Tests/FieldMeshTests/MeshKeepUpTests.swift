import FieldProduct
import Foundation
import Network
import Testing

@testable import FieldMesh

/// 2026-10-18 — asked for: the phone connects to the desktop by itself for as
/// long as the account is signed in, with nothing to tap to connect or
/// disconnect, and keeps that connection up all the
/// time. What `keepUp()` does in every state, the re-dial's ladder, and
/// that a signed-out phone starts nothing.
@Suite("the mesh keeps itself up while signed in")
struct MeshKeepUpTests {
  /// WI-L2 as amended 2026-11-13 — the home gates on the phone's network, as iOS's path says it.
  @Test("the phone is offline only while its path is unsatisfied; a path that needs a connection is a network")
  func pathIsOnline() {
    #expect(MeshModel.pathIsOnline(.satisfied))
    #expect(MeshModel.pathIsOnline(.requiresConnection))
    #expect(!MeshModel.pathIsOnline(.unsatisfied))
  }

  @Test("signed in: no node starts one, a dead node is replaced, a living one is asked again, a moving one is left")
  func steps() {
    let cases: [(MeshModel.State, Bool, MeshModel.KeepUpStep)] = [
      (.off, false, .start), (.off, true, .restart),
      (.failed("x"), false, .start), (.failed("x"), true, .restart),
      (.reconnecting("x"), false, .start), (.reconnecting("x"), true, .restart),
      (.up, true, .refresh), (.needsLogin, true, .refresh), (.needsMachineAuth, true, .refresh),
      (.up, false, .start),
      (.starting, false, .nothing), (.starting, true, .nothing), (.stopping, true, .nothing),
    ]
    for (state, hasRuntime, want) in cases {
      #expect(
        MeshModel.keepUpStep(signedIn: true, state: state, hasRuntime: hasRuntime, regating: false) == want,
        "\(state), runtime \(hasRuntime)")
    }
  }

  @Test("TS-7: a sign-in while a sign-out is still stopping its node waits for the sweep, whatever else stands")
  func signInWaitsForASignOut() {
    for starting in [false, true] {
      for hasRuntime in [false, true] {
        for regating in [false, true] {
          #expect(
            MeshModel.signInStep(signingOut: true, starting: starting, hasRuntime: hasRuntime, regating: regating)
              == .afterSignOut,
            "starting \(starting), runtime \(hasRuntime), regating \(regating)")
        }
      }
    }
  }

  @Test("TS-7: only a phone with no node, no start under way and no re-gate starts one; any of those asks for its page")
  func signInStartsOneNode() {
    #expect(MeshModel.signInStep(signingOut: false, starting: false, hasRuntime: false, regating: false) == .start)
    // the welcome's Continue tapped again while the first node is still coming up
    #expect(MeshModel.signInStep(signingOut: false, starting: true, hasRuntime: false, regating: false) == .requestLogin)
    #expect(MeshModel.signInStep(signingOut: false, starting: false, hasRuntime: true, regating: false) == .requestLogin)
    #expect(MeshModel.signInStep(signingOut: false, starting: false, hasRuntime: false, regating: true) == .requestLogin)
  }

  @Test("signed out, or in the middle of a re-gate, nothing moves: the first sign-in is the person's")
  func nothingSignedOutOrRegating() {
    for state: MeshModel.State in [.off, .failed("x"), .reconnecting("x"), .up, .needsLogin] {
      #expect(MeshModel.keepUpStep(signedIn: false, state: state, hasRuntime: false, regating: false) == .nothing)
      #expect(MeshModel.keepUpStep(signedIn: true, state: state, hasRuntime: true, regating: true) == .nothing)
    }
  }

  @MainActor
  @Test("a drop re-dials on the product client's ladder, held at a minute")
  func ladder() {
    let rungs = (0..<9).map { FieldProductClient.backoff(attempt: $0, ceiling: MeshModel.retryCeiling) }
    #expect(
      rungs == [
        .milliseconds(500), .seconds(1), .seconds(2), .seconds(4), .seconds(8), .seconds(16), .seconds(32),
        .seconds(60), .seconds(60),
      ])
  }

  @MainActor
  @Test("a signed-out phone's keepUp starts no node")
  func signedOutStartsNothing() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("vf-keepup-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let mesh = MeshModel(stateDirectory: directory)
    #expect(mesh.rememberedLogin == nil)
    mesh.keepUp()
    #expect(mesh.state == .off)
    #expect(!mesh.isRunning)
  }

  // MARK: - WI-W2e A (asked for on the page The Way In, 2026-11-14): Try again, under "Couldn’t connect."

  @Test("Try again starts the network again from a failed start, for a kept login or one the node reported")
  func tryAgainStarts() {
    // The corner's and the card's Couldn’t connect.: the node reported its login, the phone could not keep it, and
    // the start failed. `keepUp()` starts nothing for it, since nothing is kept; Try again starts it.
    let keepUp = MeshModel.keepUpStep(signedIn: false, state: .failed("x"), hasRuntime: false, regating: false)
    #expect(keepUp == .nothing)
    let reported = MeshModel.tryAgainStep(
      rememberedLogin: nil, loginName: "me@example.com", state: .failed("x"), hasRuntime: false, regating: false)
    #expect(reported == .start)
    let kept = MeshModel.tryAgainStep(
      rememberedLogin: "me@example.com", loginName: nil, state: .failed("x"), hasRuntime: false, regating: false)
    #expect(kept == .start)
    // a node that stopped and still holds its runtime is stopped for good, then started again, as keepUp does
    let stopped = MeshModel.tryAgainStep(
      rememberedLogin: nil, loginName: "me@example.com", state: .off, hasRuntime: true, regating: false)
    #expect(stopped == .restart)
  }

  @Test("Try again leaves a moving node and a re-gate alone, and with no account starts nothing")
  func tryAgainLeaves() {
    for state: MeshModel.State in [.starting, .stopping] {
      let step = MeshModel.tryAgainStep(
        rememberedLogin: nil, loginName: "me@example.com", state: state, hasRuntime: true, regating: false)
      #expect(step == .nothing, "\(state)")
    }
    let regating = MeshModel.tryAgainStep(
      rememberedLogin: "me@example.com", loginName: "me@example.com", state: .failed("x"), hasRuntime: false,
      regating: true)
    #expect(regating == .nothing)
    // no account: the welcome's own act is Continue with Tailscale
    for login: String? in [nil, ""] {
      let step = MeshModel.tryAgainStep(
        rememberedLogin: login, loginName: login, state: .failed("x"), hasRuntime: false, regating: false)
      #expect(step == .nothing)
    }
  }

  @MainActor
  @Test("Try again on a phone with no account starts no node and forgets nothing")
  func tryAgainNoAccount() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("vf-tryagain-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let mesh = MeshModel(stateDirectory: directory)
    mesh.tryAgain()
    #expect(mesh.state == .off)
    #expect(!mesh.isRunning)
    #expect(mesh.rememberedLogin == nil)
    // the state directory is still there: Try again sweeps nothing
    let kept = FileManager.default.fileExists(atPath: directory.path)
    #expect(kept)
  }
}
