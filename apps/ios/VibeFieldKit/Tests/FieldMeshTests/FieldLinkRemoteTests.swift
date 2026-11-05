import FieldAgents
import FieldProduct
import Foundation
import Testing

@testable import FieldMesh

// PG-3e — THE SWITCH, through the harness: the phone asks its home for `{projection: "remote", scope: "mesh"}`, holds
// the home's board in 3d's `RemoteMeshCopy`, and draws the window's rows (`FieldLink.rows`) as the swarm's bubbles
// (`FieldLink.bubbles`). The home here is the rehearsal's studio, serving PG-3a's witness open (whose own first desktop,
// `dev-01HQ9S7UD1`, is the board's `here`), its frames as mesh frames, and its resync as a later open.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

/// The home's door, planned: hello, its roster, and each `agent.subscribe` answered in turn with the next open of
/// `opens` — nil withholds that answer (a test delivers it later with `answer`), and past the list the last one
/// repeats. Each answer names its own subscription id (`m1`, `m2`, …), as a resnapshot's fresh route does.
final class HomePlan: @unchecked Sendable {
  private let lock = NSLock()
  private var opens: [JSONValue?]
  private var asked = 0
  private(set) var askIds: [Int64] = []

  init(_ opens: [JSONValue?]) { self.opens = opens }

  /// How many subscribes the door has been asked.
  var subscribes: Int { lock.withLock { asked } }
  /// The subscription id the nth subscribe (1-based) is answered under.
  static func subId(_ n: Int) -> String { "m\(n)" }
  /// The current subscription's id: the last one asked.
  var current: String { Self.subId(subscribes) }

  var script: LinkDoor.Script {
    { [self] method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "device.list": return [frame(id: id, deviceListResult([deviceRow(name: "studio")]))]
      case "agent.subscribe":
        let (n, open): (Int, JSONValue?) = lock.withLock {
          asked += 1
          askIds.append(id)
          let index = min(asked - 1, opens.count - 1)
          return (asked, index >= 0 ? opens[index] : nil)
        }
        guard let open else { return [] }
        return [remoteSubscribed(id: id, subId: Self.subId(n), open)]
      default: return []
      }
    }
  }

  /// The withheld answer to the nth subscribe (1-based), as the door would have sent it.
  func answer(_ n: Int, _ open: JSONValue) -> String {
    let id = lock.withLock { askIds[n - 1] }
    return remoteSubscribed(id: id, subId: Self.subId(n), open)
  }
}

@MainActor
@Suite struct FieldLinkRemoteTests {
  typealias R = RemoteRows

  /// The fold golden's `drawn` at a step: the ids the window draws.
  static func goldenDrawn(_ at: String) throws -> [String] {
    let golden = try MeshFixture.json("phone-fold.golden")
    let step = (golden["steps"]?.arrayValue ?? []).first { $0["at"]?.stringValue == at }
    let drawn = step?["drawn"]?.arrayValue?.compactMap { $0.stringValue }
    return try #require(drawn)
  }

  /// The witness frames' JSON, in order.
  static func witnessFrames() throws -> [JSONValue] {
    try MeshFixture.json("agent-remote-mesh-frames.witness").arrayValue ?? []
  }

  /// A link whose only desktop (the studio) is the home and serves `plan`.
  static func link(_ plan: HomePlan, peers: [FieldStorePeer] = [studio], selfLogin: String? = nil)
    async throws -> (FieldLink, MeshRehearsal, LinkDoor)
  {
    let door = LinkDoor(script: plan.script)
    let (link, mesh, _, _) = try await standingLink(peers: peers, selfLogin: selfLogin, door: door)
    return (link, mesh, door)
  }

  static func deliver(_ door: LinkDoor, _ text: String) async {
    let connection = await door.latest(to: studioDoorHost)
    await connection?.deliver(text)
  }

  /// L1 — the ask is the remote cut over the whole mesh, with no interval written: the door floors a phone by kind.
  @Test func asksRemoteMeshWithNoInterval() async throws {
    let plan = HomePlan([try R.openJSON()])
    let (link, _, door) = try await Self.link(plan)
    defer { link.stop() }
    let ask = try await settledRequest(door, "agent.subscribe", host: studioDoorHost)
    let params = ask.params
    #expect(params == AgentSubscribeParams.phoneRemote.json)
    #expect(params["minIntervalMs"] == nil)
  }

  /// L2 — the open draws the window's rows: the fold golden's `drawn` at its open, and one bubble per row.
  @Test func theOpenDrawsTheWindowsRows() async throws {
    let plan = HomePlan([try R.openJSON()])
    let (link, _, _) = try await Self.link(plan)
    defer { link.stop() }
    let expected = try Self.goldenDrawn("open")
    try await waitUntil("the witness drawn") { link.rows.map { $0.id } == expected }
    let ids = link.rows.map { $0.id }
    #expect(ids == expected)
    let bubbles = link.bubbles.map { $0.modelId ?? "?" }
    #expect(bubbles == expected)
    #expect(link.fieldIsLive)
  }

  /// L3 — a gap asks the home once for a fresh open, and the rows stand as drawn until it arrives.
  @Test func aGapAsksOnceAndTheRowsStand() async throws {
    let plan = HomePlan([try R.openJSON(), nil])
    let (link, _, door) = try await Self.link(plan)
    defer { link.stop() }
    let drawn = try Self.goldenDrawn("open")
    try await waitUntil("the witness drawn") { link.rows.map { $0.id } == drawn }
    // a delta that does not continue the home's chain
    let gap = R.deltaJSON(R.home, epoch: R.homeEpoch, since: 999, revision: 1000)
    await Self.deliver(door, meshFrame(subId: plan.current, gap))
    try await waitUntil("one fresh ask") { plan.subscribes == 2 }
    try await Task.sleep(for: .milliseconds(60))
    #expect(plan.subscribes == 2)
    let standing = link.rows.map { $0.id }
    #expect(standing == drawn)
  }

  /// L4 — after a gap, the frames before the fresh open are ignored; the open replaces everything. Baseline first:
  /// the rows draw, and a frame on the chain moves one (the v2 check's S5).
  @Test func framesAfterAGapAreIgnoredUntilTheOpen() async throws {
    let plan = HomePlan([try R.openJSON(), nil])
    let (link, _, door) = try await Self.link(plan)
    defer { link.stop() }
    let drawn = try Self.goldenDrawn("open")
    try await waitUntil("the witness drawn") { link.rows.map { $0.id } == drawn }
    let frames = try Self.witnessFrames()
    // frame 0 moves a row: the drawn rows differ from the open's
    let before = link.rows
    await Self.deliver(door, meshFrame(subId: plan.current, frames[0]))
    try await waitUntil("frame 0 drawn") { link.rows != before }
    let moved = link.rows
    // the gap, then frame 1 (on the chain the gap broke): ignored
    let gap = R.deltaJSON(R.home, epoch: R.homeEpoch, since: 999, revision: 1000)
    await Self.deliver(door, meshFrame(subId: plan.current, gap))
    try await waitUntil("the fresh ask") { plan.subscribes == 2 }
    await Self.deliver(door, meshFrame(subId: HomePlan.subId(1), frames[1]))
    await Self.deliver(door, meshFrame(subId: HomePlan.subId(2), frames[1]))
    try await Task.sleep(for: .milliseconds(60))
    let held = link.rows
    #expect(held == moved)
    // the fresh open: the resync's rows
    await Self.deliver(door, plan.answer(2, try MeshFixture.json("agent-remote-mesh-open.resync")))
    let resynced = try Self.goldenDrawn("resync")
    try await waitUntil("the fresh open drawn") { link.rows.map { $0.id } == resynced }
    let after = link.rows.map { $0.id }
    #expect(after == resynced)
  }

  /// L5 — a frame that does not read is a gap: one fresh ask (no longer "dropped and named").
  @Test func aFrameThatDoesNotReadIsAGap() async throws {
    let plan = HomePlan([try R.openJSON(), nil])
    let (link, _, door) = try await Self.link(plan)
    defer { link.stop() }
    try await waitUntil("the witness drawn") { !link.rows.isEmpty }
    await Self.deliver(door, meshFrame(subId: plan.current, .object(["device": .string(R.home)])))
    try await waitUntil("one fresh ask") { plan.subscribes == 2 }
    try await Task.sleep(for: .milliseconds(60))
    #expect(plan.subscribes == 2)
    #expect(!link.rows.isEmpty)
  }

  /// L6 — an open that does not read ends the subscription, the FIRST one included (it arrives inside `subscribe`,
  /// before the link holds the handle): the subscription is cancelled, a frame after it moves nothing, the field is not
  /// live, and the home's row says why. A resync open that does not read does the same to a drawn field, which stays,
  /// greyed.
  @Test func anOpenThatDoesNotReadEndsTheSubscription() async throws {
    let unreadable = JSONValue.object(["devices": .string("not a list")])
    do {
      let plan = HomePlan([unreadable])
      let (link, _, door) = try await Self.link(plan)
      defer { link.stop() }
      try await waitUntil("the refusal said") {
        link.desktops.first { $0.deviceId == "dev-studio" }?.fieldRefusal != nil
      }
      try await waitUntil("the subscription cancelled") {
        let methods = await door.latest(to: studioDoorHost)?.methods ?? []
        return methods.contains("system.unsubscribe")
      }
      await Self.deliver(door, meshFrame(subId: HomePlan.subId(1), try Self.witnessFrames()[0]))
      try await Task.sleep(for: .milliseconds(80))
      #expect(plan.subscribes == 1)
      #expect(link.rows.isEmpty)
      #expect(!link.fieldIsLive)
    }
    do {
      let plan = HomePlan([try R.openJSON()])
      let (link, _, door) = try await Self.link(plan)
      defer { link.stop() }
      let drawn = try Self.goldenDrawn("open")
      try await waitUntil("the witness drawn") { link.rows.map { $0.id } == drawn }
      await Self.deliver(door, meshResync(subId: plan.current, unreadable))
      try await waitUntil("the refusal said") {
        link.desktops.first { $0.deviceId == "dev-studio" }?.fieldRefusal != nil
      }
      try await waitUntil("the subscription cancelled") {
        let methods = await door.latest(to: studioDoorHost)?.methods ?? []
        return methods.contains("system.unsubscribe")
      }
      await Self.deliver(door, meshFrame(subId: plan.current, try Self.witnessFrames()[0]))
      try await Task.sleep(for: .milliseconds(80))
      let kept = link.rows.map { $0.id }
      #expect(kept == drawn)
      #expect(!link.fieldIsLive)
      let greyed = link.bubbles.map { $0.stale }
      #expect(!greyed.isEmpty && greyed.allSatisfy { $0 })
      #expect(plan.subscribes == 1)
    }
  }

  /// L7 — an equal re-present redraws nothing: a real delta reassigns the bubbles once (red on the skeleton, where the
  /// count never moves), and a state frame that greys nothing leaves them alone (Observation invalidates on any
  /// assignment).
  @Test func anEqualRePresentRedrawsNothing() async throws {
    let plan = HomePlan([try R.openJSON()])
    let (link, _, door) = try await Self.link(plan)
    defer { link.stop() }
    try await waitUntil("the witness drawn") { !link.rows.isEmpty }
    try await Task.sleep(for: .milliseconds(40))
    let base = link.redraws
    await Self.deliver(door, meshFrame(subId: plan.current, try Self.witnessFrames()[0]))
    try await waitUntil("frame 0 redrawn") { link.redraws == base + 1 }
    try await Task.sleep(for: .milliseconds(40))
    let once = link.redraws
    #expect(once == base + 1)
    // Loft is live already: said again, it greys nothing
    await Self.deliver(door, meshFrame(subId: plan.current, meshState(R.loft, "live")))
    try await Task.sleep(for: .milliseconds(80))
    let still = link.redraws
    #expect(still == once)
  }

  /// L8 (PG-L5) — `stop()` drops the copy: baseline rows drawn, then nothing — rows, bubbles, the grey's flag. And the
  /// COPY itself (the review's [4]): a link started again, homed and asked, its open withheld, draws nothing of the
  /// last run's board (stop() clears the three fields by hand, so they alone could not fail).
  @Test func stopDropsTheCopy() async throws {
    let plan = HomePlan([try R.openJSON(), nil])
    let (link, _, _) = try await Self.link(plan)
    defer { link.stop() }
    try await waitUntil("the witness drawn") { !link.rows.isEmpty }
    #expect(!link.bubbles.isEmpty)
    #expect(link.fieldIsLive)
    link.stop()
    #expect(link.rows.isEmpty)
    #expect(link.bubbles.isEmpty)
    #expect(!link.fieldIsLive)

    link.start()
    try await waitUntil("homed and asked again, the open withheld") {
      plan.subscribes == 2 && link.home == "dev-studio"
    }
    try await Task.sleep(for: .milliseconds(80))
    #expect(link.rows.isEmpty, "nothing of the last run's board")
    #expect(link.bubbles.isEmpty)
  }

  /// L9 — pause keeps the field ("THE FIELD STANDS"), and resume re-subscribes for a fresh open that replaces it.
  /// *2026-11-05 (PG-9):* the resume now names the copy's cursors (L13); this home answers a whole open whatever the
  /// phone names, as a home from before PG-9 does (it ignores `since`), and the whole open still replaces the field.
  @Test func pauseKeepsTheFieldAndResumesFresh() async throws {
    let plan = HomePlan([try R.openJSON(), try MeshFixture.json("agent-remote-mesh-open.resync")])
    let (link, _, _) = try await Self.link(plan)
    defer { link.stop() }
    let drawn = try Self.goldenDrawn("open")
    try await waitUntil("the witness drawn") { link.rows.map { $0.id } == drawn }
    link.pause()
    let paused = link.rows.map { $0.id }
    #expect(paused == drawn)
    #expect(!link.bubbles.isEmpty)
    link.resume()
    let resynced = try Self.goldenDrawn("resync")
    try await waitUntil("the fresh open drawn") { link.rows.map { $0.id } == resynced }
    #expect(plan.subscribes == 2)
  }

  /// The cursors a subscribe named (`since`), by desktop: `{epoch, revision}` as the wire spells them.
  static func since(_ params: JSONValue) -> [String: [String]] {
    var named: [String: [String]] = [:]
    for (device, cursor) in params["since"]?.objectValue ?? [:] {
      named[device] = [cursor["epoch"]?.stringValue ?? "?", String(cursor["revision"]?.intValue ?? -1)]
    }
    return named
  }

  /// L13 (PG-9, PG-L4.4) — back from an app switch, the phone names the chain it holds for each desktop, and a home
  /// that answers every desktop `resumed` costs no row: the field drawn before the pause is the field after it, live.
  @Test func resumeNamesTheCopysCursorsAndAResumedOpenKeepsTheField() async throws {
    let plan = HomePlan([try R.openJSON(), nil])
    let (link, _, door) = try await Self.link(plan)
    defer { link.stop() }
    let drawn = try Self.goldenDrawn("open")
    try await waitUntil("the witness drawn") { link.rows.map { $0.id } == drawn }
    // the first ask names nothing: the copy held nothing
    let first = await door.requests("agent.subscribe")
    #expect(first.count == 1)
    #expect(first.first?["since"] == nil)

    link.pause()
    link.resume()
    try await waitUntil("asked again") { plan.subscribes == 2 }
    let asks = await door.requests("agent.subscribe")
    let named = asks.count == 2 ? Self.since(asks[1]) : [:]
    #expect(
      named == [
        R.home: [R.homeEpoch, "80"], R.loft: [R.loftEpoch, "30"], R.attic: ["fieldd-0c1d7e9a4b2f6385.2", "9"],
      ])
    let projection = asks.last?["projection"]?.stringValue
    #expect(projection == "remote")

    // every desktop answered `resumed` at what the phone named
    let open = try R.openJSON()
    var entries: [JSONValue] = []
    for entry in open["devices"]?.arrayValue ?? [] {
      let device = entry["device"]?.stringValue ?? "?"
      var resumed = R.edited(entry, ["snapshot"], nil)
      let cursor = asks.last?["since"]?[device] ?? .null
      resumed = R.edited(resumed, ["resumed"], cursor)
      entries.append(resumed)
    }
    await Self.deliver(door, plan.answer(2, .object(["devices": .array(entries)])))
    try await Task.sleep(for: .milliseconds(60))
    let after = link.rows.map { $0.id }
    #expect(after == drawn)
    #expect(link.fieldIsLive)
    // the resumed open set each chain where the phone held it: the home's next frame (80 → 81) follows it on the new
    // subscription, and moves a row, with no gap and no third ask
    let frames = try Self.witnessFrames()
    let held = link.rows
    await Self.deliver(door, meshFrame(subId: plan.current, frames[0]))
    try await waitUntil("frame 0 drawn after the resume") { link.rows != held }
    try await Task.sleep(for: .milliseconds(60))
    #expect(plan.subscribes == 2)
  }

  /// L14 (PG-9) — the cursors are the copy's at the moment of each ask, never the subscribe's: a frame moves the home's
  /// chain after the first ask, and a gap on the loft's then asks again naming the home where the frame left it, the
  /// asleep desktop where it was, and the loft not at all (its image can no longer vouch for it).
  @Test func aGapsAskNamesTheCursorsHeldThen() async throws {
    let plan = HomePlan([try R.openJSON(), nil])
    let (link, _, door) = try await Self.link(plan)
    defer { link.stop() }
    let drawn = try Self.goldenDrawn("open")
    try await waitUntil("the witness drawn") { link.rows.map { $0.id } == drawn }
    let frames = try Self.witnessFrames()
    let before = link.rows
    await Self.deliver(door, meshFrame(subId: plan.current, frames[0]))
    try await waitUntil("frame 0 drawn") { link.rows != before }
    let gap = R.deltaJSON(R.loft, epoch: R.loftEpoch, since: 999, revision: 1000)
    await Self.deliver(door, meshFrame(subId: plan.current, gap))
    try await waitUntil("asked again") { plan.subscribes == 2 }
    let asks = await door.requests("agent.subscribe")
    let named = asks.count == 2 ? Self.since(asks[1]) : [:]
    #expect(named == [R.home: [R.homeEpoch, "81"], R.attic: ["fieldd-0c1d7e9a4b2f6385.2", "9"]])
  }

  /// L10 — UA-P-5: a desktop this phone established is somebody else's is held off AFTER the fold, even when the home
  /// lists it. Baseline: Loft's rows drawn.
  @Test func aForeignDoorStaysOffAfterTheFold() async throws {
    let alice = "alice@corp.com"
    let plan = HomePlan([try R.openJSON()])
    let mine = peer(studio, login: alice)
    let (link, mesh, _) = try await Self.link(plan, peers: [mine], selfLogin: alice)
    defer { link.stop() }
    try await waitUntil("Loft drawn") { link.rows.contains { $0.device == R.loft } }
    let loft = FieldStorePeer(
      id: "node-loft", deviceId: R.loft, online: true, hostname: "loft", tailnetIPs: ["100.64.0.9"],
      loginName: "bob@corp.com")
    await mesh.set(peers: [mine, loft])
    await mesh.emit(.upsert(loft))
    try await waitUntil("Loft held off") { link.foreignDoors[R.loft] != nil }
    try await waitUntil("Loft's rows gone") { !link.rows.contains { $0.device == R.loft } }
    let devices = Set(link.rows.map { $0.device })
    #expect(!devices.contains(R.loft))
    #expect(devices.contains(R.home))
    let hosts = link.bubbles.compactMap { $0.host }
    #expect(!hosts.contains("Loft"))
  }

  /// L11 — a dropped home greys the field and keeps it: the rows stand, every bubble stale, the grey's flag down.
  @Test func aDroppedHomeGreysAndKeeps() async throws {
    let plan = HomePlan([try R.openJSON()])
    let (link, _, door) = try await Self.link(plan)
    defer { link.stop() }
    let drawn = try Self.goldenDrawn("open")
    try await waitUntil("the witness drawn") { link.rows.map { $0.id } == drawn }
    let mixed = link.bubbles.map { $0.stale }
    #expect(mixed.contains(false))
    await door.refuse(studioDoorHost)
    await door.latest(to: studioDoorHost)?.drop()
    try await waitUntil("greyed") { !link.fieldIsLive }
    let kept = link.rows.map { $0.id }
    #expect(kept == drawn)
    try await waitUntil("every bubble stale") { link.bubbles.allSatisfy { $0.stale } }
    let joins = link.bubbles.compactMap { $0.agent?.join?.deviceLive }
    #expect(joins.allSatisfy { !$0 })
  }

  /// L12 — a re-home replaces the copy: the next home's open is the field, nothing of the last home's drawn twice.
  @Test func aReHomeReplacesTheCopy() async throws {
    let alice = "alice@corp.com"
    let memory = scratchHomeMemory()
    memory.record("dev-studio", login: alice)
    let studioPlan = HomePlan([try R.openJSON()])
    let laptopPlan = HomePlan([try MeshFixture.json("agent-remote-mesh-open.resync")])
    let door = LinkDoor(script: selfDoor)
    await door.route(studioDoorHost, studioPlan.script)
    await door.route(laptopDoorHost, laptopPlan.script)
    let (link, _, _, _) = try await standingLink(
      peers: [peer(laptop, login: alice), peer(studio, login: alice)], selfLogin: alice, door: door,
      homeMemory: memory)
    defer { link.stop() }
    let drawn = try Self.goldenDrawn("open")
    try await waitUntil("the studio's field") { link.rows.map { $0.id } == drawn }
    #expect(link.home == "dev-studio")
    await door.refuse(studioDoorHost)
    await door.latest(to: studioDoorHost)?.drop()
    let resynced = try Self.goldenDrawn("resync")
    try await waitUntil("re-homed", timeout: .seconds(10)) {
      link.home == "dev-laptop" && link.rows.map { $0.id } == resynced
    }
    let ids = link.rows.map { $0.id }
    #expect(ids == resynced)
    #expect(Set(ids).count == ids.count)
    #expect(link.fieldIsLive)
  }
}
