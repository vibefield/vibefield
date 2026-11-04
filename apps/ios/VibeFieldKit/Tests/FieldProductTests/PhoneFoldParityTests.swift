import Foundation
import Testing

@testable import FieldProduct

// PG-3d — THE FOLD GOLDEN, STEP BY STEP (Q-J1 (a), James 2026-11-01: the phone equals its home's window row for row).
// `phone-fold.golden.json` is the home's window over PG-3a's witness (`field-app/perf/lib/phone-goldens.ts`), copied
// here byte for byte (the named set "remote", `pnpm check:ios-fixtures`). The phone's copy is driven exactly as the
// computation drives the window — the open, frames 0…7, PG-1c's resync delivered as an open, then the old chain's
// delta that ends the run — and EVERY field of every step is compared: the fold's chain and the replica's, each
// desktop's standing, what the fold handed up, what the replica published and the re-join's, the contract's order,
// the window's order and each drawn row.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite struct PhoneFoldParityTests {
  static let now = "2026-11-01T00:00:00.000Z"
  /// PG-1c — the whole-mesh resync is delivered after this frame (`PHONE_RESYNC_AFTER`).
  static let resyncAfter = 7

  enum Delivery {
    case frame(Int, AgentRemoteMeshFrame)
    case resync(AgentRemoteMeshOpen)

    var at: String {
      switch self {
      case .frame(let index, _): "\(index)"
      case .resync: "resync"
      }
    }
  }

  static func strings(_ json: JSONValue?) -> [String]? {
    guard let items = json?.arrayValue else { return nil }
    let strings = items.compactMap { $0.stringValue }
    return strings.count == items.count ? strings : nil
  }

  static func publication(_ json: JSONValue?) -> RemotePublication? {
    guard let json, !json.isNull else { return nil }
    return RemotePublication(
      added: strings(json["added"]) ?? ["?"], updated: strings(json["updated"]) ?? ["?"],
      removed: strings(json["removed"]) ?? ["?"])
  }

  /// The golden's `fold`: a snapshot's row ids with nothing removed, or a change's upserts and removals; nil: null.
  static func handed(_ update: RemoteModelUpdate?) -> [String: [String]]? {
    switch update {
    case nil: nil
    case .snapshot(_, let rows): ["upserts": rows.map { $0.id }, "removed": []]
    case .change(let change): ["upserts": change.upserts.map { $0.id }, "removed": change.removed]
    }
  }

  static func handed(_ json: JSONValue?) -> [String: [String]]? {
    guard let json, !json.isNull else { return nil }
    return ["upserts": strings(json["upserts"]) ?? ["?"], "removed": strings(json["removed"]) ?? ["?"]]
  }

  /// One drawn row as the golden prints it, the cost's numbers read as numbers (`0` is an integer in the JSON).
  struct Row: Equatable, CustomStringConvertible {
    let id: String
    let key: String
    let device: String
    let isSelf: Bool
    let unread: Bool
    let stale: Bool
    let usd: Double?
    let coverage: String?
    let burnPerHour: Double?

    init(_ row: RemoteFieldRow) {
      id = row.id
      key = row.key
      device = row.device
      isSelf = row.isSelf
      unread = row.unread
      stale = row.stale
      usd = row.cost?.usd
      coverage = row.cost?.coverage.wire
      burnPerHour = row.cost?.burnPerHour
    }

    init?(_ json: JSONValue) {
      guard let id = json["id"]?.stringValue, let key = json["key"]?.stringValue,
        let device = json["device"]?.stringValue, let isSelf = json["self"]?.boolValue,
        let unread = json["unread"]?.boolValue, let stale = json["stale"]?.boolValue, let cost = json["cost"]
      else { return nil }
      self.id = id
      self.key = key
      self.device = device
      self.isSelf = isSelf
      self.unread = unread
      self.stale = stale
      usd = cost["usd"]?.doubleValue
      coverage = cost["coverage"]?.stringValue
      burnPerHour = cost["burnPerHour"]?.doubleValue
    }

    var description: String {
      "\(id) key \(key) on \(device) self \(isSelf) unread \(unread) stale \(stale) cost \(usd.map { "\($0)" } ?? "-")/"
        + "\(coverage ?? "-")/\(burnPerHour.map { "\($0)" } ?? "-")"
    }
  }

  static func compare(_ step: JSONValue, _ copy: RemoteMeshCopy, _ heard: RemoteMeshCopy.Published) {
    let at = step["at"].map { $0.stringValue ?? "\($0.intValue ?? -1)" } ?? "?"

    let foldRevision = step["foldRevision"]?.intValue
    let copyFold = copy.foldRevision
    #expect(foldRevision == copyFold, "step \(at): foldRevision")
    let modelRevision = step["modelRevision"]?.intValue
    let copyModel = copy.model.revision
    #expect(modelRevision == copyModel, "step \(at): modelRevision")

    let devices = (step["devices"]?.arrayValue ?? []).map { "\($0["device"]?.stringValue ?? "?")=\($0["state"]?.stringValue ?? "?")" }
    let copyDevices = copy.devices.map { "\($0.device)=\($0.state.wire)" }
    #expect(devices == copyDevices, "step \(at): devices")

    let fold = handed(step["fold"])
    let copyHanded = handed(copy.handed)
    #expect(fold == copyHanded, "step \(at): fold")

    let changes = publication(step["changes"])
    let copyChanges = heard.changes
    #expect(changes == copyChanges, "step \(at): changes")
    let rejoined = publication(step["rejoined"])
    let copyRejoined = heard.rejoined
    #expect(rejoined == copyRejoined, "step \(at): rejoined")

    let ids = strings(step["ids"])
    let copyIds = copy.model.agents.map { $0.id }
    #expect(ids == copyIds, "step \(at): ids")
    let drawn = strings(step["drawn"])
    let copyDrawn = copy.drawn().map { $0.id }
    #expect(drawn == copyDrawn, "step \(at): drawn")

    let rows = (step["rows"]?.arrayValue ?? []).map(Row.init)
    let copyRows: [Row?] = copy.drawn().map(Row.init)
    #expect(rows.count == copyRows.count, "step \(at): rows")
    for (index, (golden, mine)) in zip(rows, copyRows).enumerated() {
      #expect(golden != nil, "step \(at): rows[\(index)] reads")
      #expect(golden == mine, "step \(at): rows[\(index)]")
    }
    // a cost the golden omits a field of is absent here too (`run-h-quiet` has no burn)
    for (json, mine) in zip(step["rows"]?.arrayValue ?? [], copy.drawn()) {
      let goldenCost = json["cost"]
      let isNull = goldenCost?.isNull ?? true
      let mineCost = mine.cost
      #expect(isNull == (mineCost == nil), "step \(at): \(mine.id) cost")
    }
  }

  /// P1 — the whole golden, every step and every field, through the phone's copy.
  @Test func theFoldGoldenStepByStep() throws {
    let golden = try Fixture.json("phone-fold.golden")
    let listed = Self.strings(golden["inputs"]) ?? []
    let inputs = listed.map { $0.hasSuffix(".json") ? String($0.dropLast(".json".count)) : $0 }
    #expect(inputs.count == 3)
    let selfWord = golden["self"]?.stringValue
    #expect(selfWord == "home")
    let alive = golden["visible"]?["alive"]?.boolValue
    #expect(alive == true)
    let keeps = golden["visible"]?["keepsFailure"]?.stringValue
    #expect(keeps == "boardJoins(held, here).sessionByRow")

    let open = try AgentRemoteMeshOpen(json: try Fixture.json(inputs[0]))
    let framesJSON = try Fixture.json(inputs[1]).arrayValue ?? []
    let frames = try framesJSON.map(AgentRemoteMeshFrame.init(json:))
    let resync = try AgentRemoteMeshOpen(json: try Fixture.json(inputs[2]))
    var deliveries: [Delivery] = []
    for (index, frame) in frames.enumerated() {
      deliveries.append(.frame(index, frame))
      if index == Self.resyncAfter { deliveries.append(.resync(resync)) }
    }

    let steps = golden["steps"]?.arrayValue ?? []
    #expect(steps.count == 11)
    var copy = RemoteMeshCopy()
    let opened = copy.open(open, now: Self.now)
    #expect(opened == .applied)
    let heard = copy.publish()
    #expect(heard.moved)
    let first = steps.first ?? .null
    #expect(first["at"]?.stringValue == "open")
    Self.compare(first, copy, heard)

    var stepIndex = 1
    var lastDrawn = copy.drawn()
    var lastModel = copy.model
    var gapped = false
    for delivery in deliveries {
      let step = stepIndex < steps.count ? steps[stepIndex] : .null
      stepIndex += 1
      let at = step["at"].map { $0.stringValue ?? "\($0.intValue ?? -1)" }
      #expect(at == delivery.at, "the golden's step \(stepIndex - 1)")
      let outcome: RemoteMeshCopy.Outcome
      switch delivery {
      case .frame(_, let frame): outcome = copy.frame(frame, now: Self.now)
      case .resync(let open): outcome = copy.open(open, now: Self.now)
      }
      if case .gap = outcome {
        // the run ends at the first gap: the window asks again, and the fresh open is another run
        let isGap = step["gap"]?.boolValue
        #expect(isGap == true, "step \(delivery.at): a gap")
        let frameKind = step["frame"]?.stringValue
        #expect(frameKind == "delta", "step \(delivery.at): a delta")
        // the copy stands as it was last drawn until the fresh open: a frame drawn after the gap moves nothing
        let quiet = copy.publish()
        #expect(!quiet.moved, "step \(delivery.at): nothing moves after the gap")
        let standing = copy.drawn()
        #expect(standing == lastDrawn, "step \(delivery.at): the copy stands")
        let model = copy.model
        #expect(model == lastModel, "step \(delivery.at): the model stands")
        let after = copy.frame(frames[Self.resyncAfter], now: Self.now)
        #expect(after == .ignored, "step \(delivery.at): what follows a gap is ignored")
        gapped = true
        break
      }
      #expect(outcome == .applied, "step \(delivery.at)")
      let isGap = step["gap"]?.boolValue
      #expect(isGap == nil, "step \(delivery.at): the golden's gap")
      let published = copy.publish()
      Self.compare(step, copy, published)
      lastDrawn = copy.drawn()
      lastModel = copy.model
    }
    #expect(gapped, "the old chain's delta ends the run")
    #expect(stepIndex == steps.count)
  }
}
