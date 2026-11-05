import Foundation
import Testing

@testable import FieldProduct

// PG-9 (PG-L4.4's cursor half, 2026-11-05) — THE PHONE RESUMES ITS HOME'S BOARD. It names, per desktop, the last
// `{epoch, revision}` its copy applied (`since`), and the home answers each desktop ONE way: `resumed`, a `delta` from
// the cursor, or a `snapshot` (`rows.ts` `meshDeviceEntry`, fieldd's `answerFor`). The copy keeps the WIRE's own image
// of each desktop's board — the refused rows included, before the screen — and expands an answer into the whole open
// it stands for. So the screen, the fold and the replica see an ordinary open, and the window's transcription
// (PhoneFoldParityTests) is untouched.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite struct MeshResumeShapeTests {
  typealias W = Witness

  /// K1 — the answer by cursor reads: the home `resumed`, the loft's delta on its chain, the asleep desktop whole.
  @Test func theResumeOpenReadsEachDesktopOneWay() throws {
    let json = try Fixture.json("agent-remote-mesh-open.resume")
    let open = try AgentRemoteMeshOpen(json: json)
    let devices = open.devices.map { $0.device }
    #expect(devices == [Remote.home, Remote.loft, Remote.air])
    try #require(open.devices.count == 3)
    let home = open.devices[0]
    #expect(home.resumed == SubscriptionCursor(epoch: W.homeEpoch, revision: 84))
    #expect(home.snapshot == nil)
    #expect(home.delta == nil)
    let loft = open.devices[1]
    let delta = loft.delta
    #expect(delta?.epoch == W.loftReattached)
    #expect(delta?.since == 2)
    #expect(delta?.revision == 4)
    #expect(delta?.removed == ["run-p-done"])
    #expect(loft.resumed == nil)
    #expect(loft.snapshot == nil)
    let air = open.devices[2]
    #expect(air.snapshot?.revision == 9)
    #expect(air.resumed == nil)
    #expect(air.delta == nil)
  }

  /// K2 — a desktop is answered ONE way: an entry carrying two answers does not read, and nor does its open (a reader
  /// must never guess which answer to apply; the contracts refuse it the same way).
  @Test func anEntryWithTwoAnswersDoesNotRead() throws {
    let json = try Fixture.json("agent-remote-mesh-open.resume")
    let snapshot = try #require(at(json, [.key("devices"), .index(2), .key("snapshot")]))
    let resumed = try #require(at(json, [.key("devices"), .index(0), .key("resumed")]))
    let twice = [
      edited(json, [.key("devices"), .index(0), .key("snapshot")], snapshot),
      edited(json, [.key("devices"), .index(2), .key("resumed")], resumed),
      edited(json, [.key("devices"), .index(1), .key("resumed")], resumed),
    ]
    for open in twice {
      #expect(throws: (any Error).self) { try AgentRemoteMeshOpen(json: open) }
    }
  }

  /// K3 — the subscribe names its cursors as the contracts' golden spells them; with none it is `phoneRemote`,
  /// unchanged byte for byte (an older home ignores `since` and answers today's open).
  @Test func theSubscribeNamesItsCursors() throws {
    let golden = try Fixture.json("agent-subscribe-params.mesh-since")
    let params = AgentSubscribeParams.phoneRemote.resuming([
      Remote.home: SubscriptionCursor(epoch: W.homeEpoch, revision: 84),
      Remote.loft: SubscriptionCursor(epoch: W.loftReattached, revision: 2),
      Remote.air: SubscriptionCursor(epoch: "fieldd-0c1d7e9a4b2f6385.1", revision: 7),
    ])
    #expect(params.json == golden)
    let none = AgentSubscribeParams.phoneRemote.resuming([:])
    #expect(none == AgentSubscribeParams.phoneRemote)
    #expect(none.json == AgentSubscribeParams.phoneRemote.json)
    // a cursor with no chain names nothing a mesh can answer
    let chainless = AgentSubscribeParams.phoneRemote.resuming([
      Remote.home: SubscriptionCursor(epoch: nil, revision: 84)
    ])
    #expect(chainless == AgentSubscribeParams.phoneRemote)
  }
}

@Suite struct MeshResumeCopyTests {
  typealias W = Witness

  /// The home's answer to `copy`'s cursors when its head is the whole open `head`: each desktop `resumed` where the
  /// copy's cursor is the head, a delta (every row of the head, and the keys the copy holds that the head does not)
  /// where it is behind on the same chain, and the head's board otherwise — what fieldd's `answerFor` sends, up to the
  /// delta's extent (a delta that repeats an unchanged row is still a delta to the same head).
  static func answer(_ copy: RemoteMeshCopy, to head: JSONValue) throws -> JSONValue {
    let devices = try #require(head["devices"]?.arrayValue)
    var answered: [JSONValue] = []
    for entry in devices {
      let device = try #require(entry["device"]?.stringValue)
      guard let snapshot = entry["snapshot"], let epoch = snapshot["epoch"]?.stringValue,
        let revision = snapshot["revision"]?.intValue, let cursor = copy.cursors[device], cursor.epoch == epoch,
        cursor.revision <= revision
      else {
        answered.append(entry)
        continue
      }
      var out = edited(entry, [.key("snapshot")], nil)
      if cursor.revision == revision {
        out = edited(out, [.key("resumed")], .object(["epoch": .string(epoch), "revision": .int(revision)]))
      } else {
        let rows = snapshot["rows"]?.arrayValue ?? []
        let keys = Set(rows.compactMap { $0["runtimeRunId"]?.stringValue })
        let gone = copy.wireKeys(device).filter { !keys.contains($0) }
        out = edited(
          out, [.key("delta")],
          .object([
            "epoch": .string(epoch), "since": .int(cursor.revision), "revision": .int(revision),
            "upserts": .array(rows), "removed": .array(gone.map(JSONValue.string)),
          ]))
      }
      answered.append(out)
    }
    return edited(head, [.key("devices")], .array(answered))
  }

  /// How each desktop is answered in `open`, in order.
  static func kinds(_ open: JSONValue) -> [String] {
    (open["devices"]?.arrayValue ?? []).map { entry in
      if entry["resumed"] != nil { return "resumed" }
      if entry["delta"] != nil { return "delta" }
      return entry["snapshot"] != nil ? "snapshot" : "none"
    }
  }

  /// The fold's own chain per desktop, as a cursor.
  static func folded(_ copy: RemoteMeshCopy) -> [String: SubscriptionCursor] {
    var cursors: [String: SubscriptionCursor] = [:]
    for device in copy.devices {
      guard let epoch = device.epoch, let revision = device.revision else { continue }
      cursors[device.device] = SubscriptionCursor(epoch: epoch, revision: revision)
    }
    return cursors
  }

  /// C1 — the copy's cursors are the chains it applied: none for a fresh copy; after the witness open and its frames,
  /// each desktop at its fold's own epoch and revision.
  @Test func theCursorsAreTheChainsApplied() throws {
    let fresh = RemoteMeshCopy()
    #expect(fresh.cursors.isEmpty)
    let copy = try RemoteMeshCopy.witness(through: 7)
    let cursors = copy.cursors
    let folded = Self.folded(copy)
    #expect(!cursors.isEmpty)
    #expect(cursors == folded)
  }

  /// C2 — an open answered by cursor lands the copy exactly where the whole open does: the same drawn rows, the same
  /// model, the same chains. Both arms ride it: the loft and the asleep desktop `resumed`, the home one delta behind.
  @Test func aResumedOpenLandsWhereTheWholeOpenDoes() throws {
    var resumed = try RemoteMeshCopy.witness(through: 7)
    var whole = try RemoteMeshCopy.witness(through: 7)
    let answer = try Self.answer(resumed, to: try W.resyncJSON())
    let kinds = Self.kinds(answer)
    #expect(kinds.contains("resumed"))
    #expect(kinds.contains("delta"))
    let open = try AgentRemoteMeshOpen(json: answer)
    let outcome = resumed.open(open, now: W.now)
    #expect(outcome == .applied)
    _ = resumed.publish()
    whole.open(try W.resync(), now: W.now)
    _ = whole.publish()
    let drawn = resumed.drawnIds()
    let expected = whole.drawnIds()
    #expect(!drawn.isEmpty)
    #expect(drawn == expected)
    #expect(resumed.model == whole.model)
    let chains = Self.folded(resumed)
    let wholeChains = Self.folded(whole)
    #expect(chains == wholeChains)
    let cursors = resumed.cursors
    #expect(cursors == wholeChains)
    let standings = resumed.devices.map { [$0.device, $0.state.wire, $0.asOf] }
    let wholeStandings = whole.devices.map { [$0.device, $0.state.wire, $0.asOf] }
    #expect(standings == wholeStandings)
  }

  /// C3 — an answer the copy cannot honour (`resumed` at a revision it never applied) is a gap: nothing is applied, the
  /// rows stand as drawn, and that desktop's cursor goes, so the next ask is answered its board whole; the others'
  /// cursors stand.
  @Test func anAnswerTheCopyCannotHonourIsAGapAndItsCursorGoes() throws {
    var copy = try RemoteMeshCopy.witness(through: 7)
    let cursors = copy.cursors
    let home = try #require(cursors[Remote.home])
    var answer = try Self.answer(copy, to: try W.resyncJSON())
    answer = edited(
      answer, [.key("devices"), .index(0)],
      .object([
        "device": .string(Remote.home), "state": .string("live"), "asOf": .string(W.now),
        "resumed": .object(["epoch": .string(W.homeEpoch), "revision": .int(home.revision + 5)]),
      ]))
    let before = copy.drawnIds()
    let open = try AgentRemoteMeshOpen(json: answer)
    let outcome = copy.open(open, now: W.now)
    guard case .gap = outcome else {
      Issue.record("expected a gap, got \(outcome)")
      return
    }
    let after = copy.drawnIds()
    #expect(after == before)
    let left = copy.cursors
    #expect(left[Remote.home] == nil)
    #expect(left[Remote.loft] == cursors[Remote.loft])
    #expect(!left.isEmpty)
  }

  /// C4 — a desktop holding a row this build cannot read still reads `incompatible` after a resume: the wire's image
  /// keeps the refused row, so the screen sees what a whole open would have shown it.
  @Test func anUnreadableRowStillGreysItsDesktopAfterAResume() throws {
    var copy = try RemoteMeshCopy.witness(through: 5)
    let done = try W.row(W.loftRows, "run-p-done")
    let sleeping = edited(done, [.key("monitorRow"), .key("status")], .string("sleeping"))
    var six = try W.frameJSON()[6]
    six = edited(six, [.key("delta"), .key("removed")], .array([]))
    six = edited(six, [.key("delta"), .key("upserts")], .array([sleeping]))
    let refused = copy.frame(try AgentRemoteMeshFrame(json: six), now: W.now)
    #expect(refused == .applied)
    _ = copy.publish()
    #expect(copy.device(Remote.loft)?.state == .incompatible)

    // every desktop answered `resumed` at the cursor the copy holds
    var entries: [JSONValue] = []
    let cursors = copy.cursors
    for device in copy.devices {
      guard let cursor = cursors[device.device], let epoch = cursor.epoch else { continue }
      entries.append(
        .object([
          "device": .string(device.device), "state": .string("live"), "asOf": .string(W.now),
          "resumed": .object(["epoch": .string(epoch), "revision": .int(cursor.revision)]),
        ]))
    }
    #expect(entries.count == copy.devices.count)
    let open = try AgentRemoteMeshOpen(json: .object(["devices": .array(entries)]))
    let outcome = copy.open(open, now: W.now)
    #expect(outcome == .applied)
    _ = copy.publish()
    #expect(copy.screen.holds(Remote.loft))
    #expect(copy.device(Remote.loft)?.state == .incompatible)
    #expect(copy.held("run-p-done") == nil)
    #expect(copy.held("pty-p3") != nil)
  }

  /// C5 — a frame off a desktop's chain takes that desktop's cursor away (its image can no longer vouch for it); every
  /// other desktop's cursor stands.
  @Test func aFrameOffTheChainTakesThatCursorAway() throws {
    var copy = try RemoteMeshCopy.witness(through: 7)
    let before = copy.cursors
    let gap = try W.delta(Remote.home, epoch: W.homeEpoch, since: 999, revision: 1000)
    let outcome = copy.frame(gap, now: W.now)
    guard case .gap = outcome else {
      Issue.record("expected a gap, got \(outcome)")
      return
    }
    let after = copy.cursors
    #expect(after[Remote.home] == nil)
    #expect(after[Remote.loft] == before[Remote.loft])
    #expect(after[Remote.loft] != nil)
  }
}
