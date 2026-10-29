import FieldProduct
import Foundation
import Testing

@testable import FieldMesh

/// 2026-10-18 — James: "the phone should automatically connect to desktop as
/// long as the account is logged in, user should not need to manually tap
/// connect or disconnect, it is auto connected and maintained connection all
/// the time". What `keepUp()` does in every state, the re-dial's ladder, and
/// that a signed-out phone starts nothing.
@Suite("the mesh keeps itself up while signed in")
struct MeshKeepUpTests {
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
    for hasRuntime in [false, true] {
      for regating in [false, true] {
        #expect(
          MeshModel.signInStep(signingOut: true, hasRuntime: hasRuntime, regating: regating) == .afterSignOut,
          "runtime \(hasRuntime), regating \(regating)")
      }
    }
    // no sign-out in flight: no node starts one; a node, or a re-gate's beat, re-surfaces the page
    #expect(MeshModel.signInStep(signingOut: false, hasRuntime: false, regating: false) == .start)
    #expect(MeshModel.signInStep(signingOut: false, hasRuntime: true, regating: false) == .requestLogin)
    #expect(MeshModel.signInStep(signingOut: false, hasRuntime: false, regating: true) == .requestLogin)
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
}
