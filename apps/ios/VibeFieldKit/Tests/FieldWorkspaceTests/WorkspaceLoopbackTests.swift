import FieldProduct
import Foundation
import Testing
@testable import FieldWorkspace

private let liveConfig = "/private/tmp/vibefield-fs2-loopback.json"

/// Start packages/fieldd/test/fixtures/ios-workspace.ts before this opt-in
/// simulator row. A loopback bridge supplies a minted renderer-participant
/// credential (no real tailnet claim), and the adapter runs /bin/cat. The
/// product client, doors, worker, audit, runtime and native PTY are real.
@MainActor
@Suite struct WorkspaceLoopbackTests {
  @Test(.enabled(if: FileManager.default.fileExists(atPath: liveConfig),
    "Start the real fieldd workspace fixture for the simulator witness"))
  func aPhoneBrowsesThenSpawnsOnThatDesktop() async throws {
    let config = try JSONValue.parse(Data(contentsOf: URL(fileURLWithPath: liveConfig)))
    let endpoint = try #require(URL(string: config["url"]!.stringValue!))
    let (data, _) = try await URLSession.shared.data(from: URL(string: config["config"]!.stringValue!)!)
    let facts = try JSONValue.parse(data)
    let device = try #require(facts["device"]?.stringValue)
    let client = FieldProductClient(url: endpoint, transport: URLSessionProductTransport(timeout: 10),
      options: .init(callTimeout: .seconds(30)))
    defer { client.close() }
    let reader = WorkspaceReads(device: device, name: "loopback desktop") { method, params in
      try await client.call(method, params: params)
    }
    await reader.refreshRoots()
    try #require(reader.state == .ready)
    let root = try #require(reader.roots.first { $0.browse == "home" })
    await reader.open(root, path: "Projects")
    let folder = try #require(reader.entries.first { $0.name == "LaunchHere" })
    try #require(folder.kind == "dir")
    try #require(folder.childCount == 0)
    await reader.search("LaunchHere")
    try #require(reader.complete)
    let hit = try #require(reader.hits.first)
    // These are desktop paths: the phone cannot resolve the desktop’s /tmp
    // alias in its own filesystem. Check the known fixture location and keep
    // each answer verbatim; entering the hit uses its relative path.
    try #require(hit.relativePath == "Projects/LaunchHere")
    try #require(hit.path == root.path + "/Projects/LaunchHere")
    var copiedHit = ""
    reader.copyPath(hit.path) { copiedHit = $0 }
    try #require(copiedHit == hit.path)
    await reader.enter(try #require(reader.hits.first))
    let choice = try #require(reader.choice)
    var copied = ""
    reader.copyPath(choice.path) { copied = $0 }
    try #require(copied == folder.path)
    let result = try await client.call("agent.spawn", params: AgentSpawnParams(provider: facts["provider"]!.stringValue!, cwd: copied).json)
    let runID = try #require(result["session"]?["runtimeRunId"]?.stringValue)
    let runs = try await client.call("agent.list")
    try #require(runs["sessions"]?.arrayValue?.contains { $0["runtimeRunId"]?.stringValue == runID } == true)
    let (proofData, _) = try await URLSession.shared.data(from: URL(string: config["proof"]!.stringValue!)!)
    let proof = try JSONValue.parse(proofData)
    try #require(proof["spawnedCwd"]?.stringValue == copied)
    try #require(proof["worker"] == .string("real"))
    print("FS2_REAL_FIELDD_LOOPBACK_OK")
  }
}
