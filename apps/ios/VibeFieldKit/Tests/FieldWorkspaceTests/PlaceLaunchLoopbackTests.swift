import FieldHistory
import FieldProduct
import Foundation
import Testing

@testable import FieldWorkspace

/// PJ-7's witness (build-pj7.md, TP:353): "a launch from the phone lands in
/// the named place on the named desktop". Opt-in, like FS-2's loopback: start
/// lane pj7d's simulator fixture first (it writes `handshake`), which serves a
/// REAL fieldd's product door AS a self tailnet phone (`Tailscale-User-Login`),
/// with one git place that has a remote and a scripted agent
/// (`packages/fieldd/test/fixtures/ios-phone-place.ts`). The phone's own
/// readers then do what the phone does: History reads `project.list` and opens
/// the project (`project.get`), the launch sheet fills its folder row from the
/// project's places and launches BY PLACE with a profile, and History reads the
/// session back in `project.sessions` at that PlaceRef, on that desktop.
/// The fixture's handshake: its default path, or the one a run names
/// (`TEST_RUNNER_PJ7_PHONE_HANDSHAKE` on the xcodebuild line, matching the
/// fixture's own `$PJ7_PHONE_HANDSHAKE`), so two lanes never share one file.
private let handshake =
  ProcessInfo.processInfo.environment["PJ7_PHONE_HANDSHAKE"] ?? "/private/tmp/vibefield-pj7-phone.json"

@MainActor
@Suite struct PlaceLaunchLoopbackTests {
  @Test(.enabled(if: FileManager.default.fileExists(atPath: handshake), "Start lane pj7d's PJ-7 phone fixture"))
  func aLaunchFromThePhoneLandsInTheNamedPlaceOnTheNamedDesktop() async throws {
    // pj7d's handshake: {url, device, login, provider, profileSet, place {name, path, remote}, proof}
    let config = try JSONValue.parse(Data(contentsOf: URL(fileURLWithPath: handshake)))
    let door = try #require(config["url"]?.stringValue)
    let endpoint = try #require(URL(string: door))
    let device = try #require(config["device"]?.stringValue)
    let provider = try #require(config["provider"]?.stringValue)
    let wantedProfile = try #require(config["profileSet"]?.stringValue)
    let placeName = config["place"]?["name"]?.stringValue
    let client = FieldProductClient(
      url: endpoint, transport: URLSessionProductTransport(timeout: 10), options: .init(callTimeout: .seconds(30)))
    defer { client.close() }

    // History: the ledger over the door, then the project opened
    let ledger = HistoryProjects(
      source: device, door: client,
      roster: [.init(id: device, name: "loopback desktop", platform: nil, awake: true, isHome: true)])
    ledger.start()
    defer { ledger.close() }
    try await until("the ledger") { !ledger.summaries.isEmpty }
    let summary = try #require(
      ledger.summaries.values.first { project in
        project.places.contains { $0.ref.device == device && $0.canTakeLaunch && (placeName == nil || $0.name == placeName) }
      })
    ledger.open(summary.key)
    try await until("the project opened") { ledger.summaries[summary.key] != nil }
    let place = try #require(
      summary.places.first { $0.ref.device == device && $0.canTakeLaunch && (placeName == nil || $0.name == placeName) })

    // the launch sheet: filled from the project's places, a profile chosen, launched by place
    let now = Date()
    let places = summary.places.map { p in
      let drawn = FieldHistoryModel.place(p, now: now)
      return LaunchPlace(
        ref: p.ref, name: drawn.name, branch: drawn.branch, desktop: p.ref.device, reason: drawn.reason,
        lastAt: p.lastAt, last: drawn.last)
    }
    var asked: [(String, JSONValue?)] = []
    let launch = WorkspaceLaunch(
      desktops: [.init(id: device, name: "loopback desktop", platform: nil, online: true)], home: device
    ) { _, method, params in
      asked.append((method, params))
      return try await client.call(method, params: params)
    }
    await launch.begin(.init(projectName: summary.name, places: places, recipe: summary.recipe))
    try #require(launch.place?.ref == place.ref, "the folder row comes filled with the project's place")
    if launch.provider != provider {
      launch.provider = provider
      await launch.providerChanged()
    }
    await launch.chooseProfile(wantedProfile)
    let profile = try #require(launch.profileSet, "a profile is chosen")
    try #require(profile == wantedProfile)
    try #require(await launch.spawn())
    let spawn = try #require(asked.last { $0.0 == "agent.spawn" }?.1)
    try #require(spawn["place"] == place.ref.json)
    try #require(spawn["cwd"] == nil, "a launch from a project names its place, never a path")
    try #require(spawn["profileSet"] == .string(profile))

    // History reads it back: a session at that PlaceRef, on that desktop
    var landed: IndexSessionRow?
    try await until("the session at the place", timeout: .seconds(90)) {
      let page = try? ProjectSessionsResult(
        json: try await client.call(
          "project.sessions", params: ProjectSessionsParams(key: summary.key, places: [place.ref]).json))
      landed = page?.rows.first { $0.place == place.ref && $0.device == device }
      return landed != nil
    }
    try #require(landed?.provider == provider)
    if let proof = config["proof"]?.stringValue, let url = URL(string: proof) {
      let (proofData, _) = try await URLSession.shared.data(from: url)
      print("PJ7_PROOF \(String(decoding: proofData, as: UTF8.self))")
    }
    print("PJ7_PLACE_LAUNCH_WITNESS_OK device=\(device) place=\(place.ref.placeId) session=\(landed?.sessionId ?? "")")
  }

  private func until(
    _ what: String, timeout: Duration = .seconds(30), _ condition: @MainActor () async throws -> Bool
  ) async throws {
    let deadline = ContinuousClock.now.advanced(by: timeout)
    while ContinuousClock.now < deadline {
      if try await condition() { return }
      try await Task.sleep(for: .milliseconds(250))
    }
    Issue.record("timed out waiting for \(what)")
    throw CancellationError()
  }
}
