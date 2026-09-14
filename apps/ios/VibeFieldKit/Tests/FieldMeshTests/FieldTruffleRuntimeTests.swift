import Foundation
import Testing
import Truffle

@testable import FieldMesh

/// The namespace the phone joins, held to the registry and to the rule that
/// made it matter.
///
/// A tailnet is the one thing these tests cannot have, so they hold the two
/// things that decide the outcome before any packet moves: the app id the node
/// is CONFIGURED with, and truffle's own admission function applied to a
/// desktop's hostname. Between them they are the whole of James's finding 1 —
/// a phone and a desktop that were online, signed in, and invisible.
@Suite struct FieldTruffleRuntimeNamespaceTests {
  @Test func theNodeIsConfiguredWithTheContractsAppID() {
    let configuration = FieldTruffleRuntime.configuration(deviceName: "James's iPhone")
    #expect(configuration.appId == FieldMeshContract.appID)
    // The literal too: a constant that agrees with itself proves nothing, and
    // `scripts/check-ios-fixtures.mjs` holds this same string against
    // `packages/contracts/src/registries.ts`.
    #expect(configuration.appId == "vibefield")
    #expect(configuration.appId != FieldTruffleRuntime.legacyGhostteaAppID)
  }

  @Test func theAppIDIsAValidTruffleNamespace() throws {
    // RFC 017 §5.1: `^[a-z][a-z0-9-]{1,32}$`, no trailing hyphen. A pin that
    // failed this would throw at `MeshNode.init`, on a phone, at launch.
    let appID = try AppId(parsing: FieldMeshContract.appID)
    #expect(appID.value == FieldMeshContract.appID)
  }

  @Test func theNodeKeepsTheRestOfItsStartContract() {
    let configuration = FieldTruffleRuntime.configuration(deviceName: "James's iPhone")
    #expect(configuration.deviceName == "James's iPhone")
    // Never ephemeral: the device ULID and the Tailscale node both outlive a
    // launch, which is what makes the phone the same client each time.
    #expect(configuration.ephemeral == false)
    #expect(configuration.stateDirectory == nil)
    #expect(configuration.controlURL == nil)
    if case .interactive = configuration.auth {} else {
      Issue.record("auth must stay interactive — the phone signs in by hand, never by key")
    }
  }

  @Test func thisNodesHostnameCarriesTheVibeFieldPrefix() throws {
    let configuration = FieldTruffleRuntime.configuration(deviceName: "James's iPhone")
    let hostname = Hostname.tailscaleHostname(
      appId: try AppId(parsing: configuration.appId),
      deviceName: DeviceName(configuration.deviceName))
    #expect(hostname.hasPrefix("truffle-vibefield-"))
  }

  /// The defect itself, as truffle's own function answers it.
  ///
  /// `MeshNode.upsertFromLayer3` admits a Layer 3 peer only when
  /// `Hostname.isAppPeer` says yes. A desktop floor publishes itself as
  /// `truffle-vibefield-…` (`field-native/src/services/mesh.rs` starts its node
  /// with the same registry `APP_ID`), so under ghosttea's namespace the
  /// answer was no — for every desktop, forever, however healthy the mesh.
  @Test func aDesktopIsAdmittedHereAndWasRefusedUnderGhostteas() {
    let desktop = "truffle-vibefield-studio"
    #expect(Hostname.isAppPeer(hostname: desktop, appId: FieldMeshContract.appID))
    #expect(!Hostname.isAppPeer(hostname: desktop, appId: FieldTruffleRuntime.legacyGhostteaAppID))
  }

  /// TM-5 moved this mapping to `MeshModel` and took truffle's `MeshPhase`
  /// straight: the runtime's own copy existed only to translate ghosttea's
  /// re-publication of the same seven cases, and there is no ghosttea runtime
  /// here any more. The face is still exhaustive, and still pinned.
  @Test func everyTrufflePhaseKeepsAnHonestFace() {
    #expect(MeshModel.state(for: .starting) == .starting)
    #expect(MeshModel.state(for: .needsLogin) == .needsLogin)
    #expect(MeshModel.state(for: .needsMachineAuth) == .needsMachineAuth)
    #expect(MeshModel.state(for: .running) == .up)
    #expect(MeshModel.state(for: .stopping) == .stopping)
    #expect(MeshModel.state(for: .stopped) == .off)
    #expect(MeshModel.state(for: .failed) == .failed("mesh runtime failed"))
  }
}

/// The rename's one side effect: the signed-in identity has to travel with it.
///
/// Every case runs on its own temporary directory. Nothing here reads or
/// writes a real Application Support container — a test that moved the
/// device's actual node state would be signing a phone out to prove a point.
@Suite struct FieldTruffleRuntimeStateDirectoryTests {
  private func scratch() throws -> URL {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("vf-ns-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  private func seed(_ directory: URL, ulid: String) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try Data(ulid.utf8).write(to: directory.appendingPathComponent("device-id.txt"))
  }

  private func ulid(at directory: URL) -> String? {
    try? String(
      decoding: Data(contentsOf: directory.appendingPathComponent("device-id.txt")), as: UTF8.self)
  }

  @Test func thePreviousNamespacesStateMovesUnderTheNewName() throws {
    let root = try scratch()
    let previous = root.appendingPathComponent("ghosttea-terminal", isDirectory: true)
    let current = root.appendingPathComponent("vibefield", isDirectory: true)
    try seed(previous, ulid: "01J0000000000000000000000A")

    #expect(FieldTruffleRuntime.migrateStateDirectory(from: previous, to: current) == .moved)
    #expect(ulid(at: current) == "01J0000000000000000000000A")
    #expect(!FileManager.default.fileExists(atPath: previous.path))
  }

  @Test func aSecondLaunchDoesNothing() throws {
    let root = try scratch()
    let previous = root.appendingPathComponent("ghosttea-terminal", isDirectory: true)
    let current = root.appendingPathComponent("vibefield", isDirectory: true)
    try seed(previous, ulid: "01J0000000000000000000000A")

    #expect(FieldTruffleRuntime.migrateStateDirectory(from: previous, to: current) == .moved)
    #expect(FieldTruffleRuntime.migrateStateDirectory(from: previous, to: current) == .notNeeded)
  }

  /// The destination decides. A phone that has already run this build has
  /// state under the new name, and the old directory — if a downgrade left
  /// one — must never be allowed to overwrite it.
  @Test func existingStateUnderTheNewNameIsNeverOverwritten() throws {
    let root = try scratch()
    let previous = root.appendingPathComponent("ghosttea-terminal", isDirectory: true)
    let current = root.appendingPathComponent("vibefield", isDirectory: true)
    try seed(previous, ulid: "01J0000000000000000000000A")
    try seed(current, ulid: "01J0000000000000000000000B")

    #expect(FieldTruffleRuntime.migrateStateDirectory(from: previous, to: current) == .notNeeded)
    #expect(ulid(at: current) == "01J0000000000000000000000B")
  }

  @Test func aFreshInstallHasNothingToCarry() throws {
    let root = try scratch()
    let previous = root.appendingPathComponent("ghosttea-terminal", isDirectory: true)
    let current = root.appendingPathComponent("vibefield", isDirectory: true)

    #expect(FieldTruffleRuntime.migrateStateDirectory(from: previous, to: current) == .notNeeded)
    #expect(!FileManager.default.fileExists(atPath: current.path))
  }

  @Test func theDerivedDirectoryIsTruffleSOwn() throws {
    let directory = try #require(
      FieldTruffleRuntime.defaultStateDirectory(appID: FieldMeshContract.appID))
    // `Application Support/truffle/{appId}` — the path `MeshNode.init` and
    // `TailscaleKitBackend.start` each derive when a caller names none.
    #expect(directory.lastPathComponent == "vibefield")
    #expect(directory.deletingLastPathComponent().lastPathComponent == "truffle")
  }
}
