import FieldAgents
import Foundation
import SwarmPhysics
import Testing

@testable import FieldMesh
@testable import FieldProduct

// PG-3e — THE BODY GOLDEN, STEP BY STEP (Q-J1 (a): the phone equals its home's window body for body).
// `phone-body.golden.json` is the home's window's bodies over PG-3a's witness (`field-app/perf/lib/phone-goldens.ts`
// `bodiesOf`), copied here byte for byte (the named set "remote", `pnpm check:ios-fixtures`). The phone's copy is driven
// exactly as 3d's PhoneFoldParityTests drives it — the open, frames 0…7, PG-1c's resync delivered as an open, then the
// old chain's delta that ends the run — and at every step each drawn row is mapped to its bubble
// (`fieldBubble(from:fieldIsLive:catalog:suppressUnread:)`), the working shares are taken over those bubbles, and each
// body (`bodyModel`) is compared field by field with the golden's: the swarm's own inputs, at scale 1, with no
// `runningSince` (the window's first-sight clock, left out of the golden). The FieldAssembly dress is not applied: the
// golden carries no accent, and F1/F2 pin that the dress keeps every field the golden reads.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite struct PhoneBodyParityTests {
  /// `PHONE_BODY_NOW_MS`: the body model's clock, which no golden field depends on.
  static let now = Date(timeIntervalSince1970: 1_790_803_300)

  /// One copy line as the golden prints it: its key and text, `italic` only when set, and the state line's icon.
  struct Line: Equatable, CustomStringConvertible {
    let key: String
    let text: String
    let italic: Bool
    let icon: String?

    init(_ line: CopyLine) {
      key = line.key
      text = line.text
      italic = line.style.italic
      if line.key == "state", case .icon(let name) = line.lead?.kind { icon = name } else { icon = nil }
    }

    init?(_ json: JSONValue) {
      guard let key = json["key"]?.stringValue, let text = json["text"]?.stringValue else { return nil }
      self.key = key
      self.text = text
      italic = json["italic"]?.boolValue ?? false
      icon = json["icon"]?.stringValue
    }

    var description: String { "\(key)=\(text)\(italic ? " (italic)" : "")\(icon.map { " [\($0)]" } ?? "")" }
  }

  /// The golden's body, field by field; every optional the golden prints as `null` is nil here.
  struct Body: Equatable, CustomStringConvertible {
    let id: String
    let state: String
    let appearance: String
    let radius: Double
    let copy: [Line]
    let top: String?
    let bottom: String?
    let burn: String?
    let light: String?
    let ring: String?
    let unread: Bool
    let stale: Bool
    let hollow: Bool
    let running: Bool
    let blockerKind: String?

    init(_ body: SwarmBodyModel) {
      id = body.id
      state = body.state.rawValue
      appearance = body.appearance.rawValue
      radius = body.radius
      copy = body.copy.map(Line.init)
      top = body.figures?.top.map { "\($0.text) hot \($0.hot) none \($0.none)" }
      bottom = body.figures?.bottom.map { "\($0.text) none \($0.none)" }
      burn = body.burn.map { "lit \($0.lit) priced \($0.priced)" }
      light = body.light?.rawValue
      ring = body.ring.map { "\($0.percent) hot \($0.hot)" }
      unread = body.unread
      stale = body.stale
      hollow = body.hollow
      running = body.running
      blockerKind = body.blockerKind?.rawValue
    }

    init?(_ json: JSONValue) {
      guard let id = json["id"]?.stringValue, let state = json["state"]?.stringValue,
        let appearance = json["appearance"]?.stringValue, let radius = json["radius"]?.doubleValue,
        let unread = json["unread"]?.boolValue, let stale = json["stale"]?.boolValue,
        let hollow = json["hollow"]?.boolValue, let running = json["running"]?.boolValue
      else { return nil }
      self.id = id
      self.state = state
      self.appearance = appearance
      self.radius = radius
      let lines = json["copy"]?.arrayValue ?? []
      copy = lines.compactMap(Line.init)
      if copy.count != lines.count { return nil }
      func object(_ key: String) -> JSONValue? {
        guard let value = json[key], !value.isNull else { return nil }
        return value
      }
      top = object("top").map {
        "\($0["text"]?.stringValue ?? "?") hot \($0["hot"]?.boolValue ?? false) none \($0["none"]?.boolValue ?? false)"
      }
      bottom = object("bottom").map { "\($0["text"]?.stringValue ?? "?") none \($0["none"]?.boolValue ?? false)" }
      burn = object("burn").map {
        "lit \($0["lit"]?.intValue ?? -1) priced \($0["priced"]?.boolValue ?? false)"
      }
      light = object("light")?.stringValue
      ring = object("ring").map { "\($0["percent"]?.intValue ?? -1) hot \($0["hot"]?.boolValue ?? false)" }
      self.unread = unread
      self.stale = stale
      self.hollow = hollow
      self.running = running
      blockerKind = object("blockerKind")?.stringValue
    }

    var description: String { "\(id) \(state)/\(appearance) r\(radius) \(copy)" }
  }

  /// The bodies a step draws: the copy's rows, their bubbles, the shares over them, each body at the golden's clock.
  static func bodies(_ copy: RemoteMeshCopy) -> [SwarmBodyModel] {
    let rows = copy.drawn()
    let bubbles = rows.map { fieldBubble(from: $0, fieldIsLive: true, catalog: .empty, suppressUnread: false) }
    let shares = workingShares(bubbles)
    return bubbles.map {
      bodyModel(BodyModelInput(bubble: $0, parameters: .default, now: now, workingShare: shares[$0.id] ?? 0))
    }
  }

  static func compare(_ step: JSONValue, _ copy: RemoteMeshCopy) {
    let at = step["at"].map { $0.stringValue ?? "\($0.intValue ?? -1)" } ?? "?"
    let golden = (step["bodies"]?.arrayValue ?? []).map(Body.init)
    let mine = bodies(copy).map(Body.init)
    let goldenCount = golden.count
    let mineCount = mine.count
    #expect(goldenCount == mineCount, "step \(at): bodies")
    for (index, (expected, actual)) in zip(golden, mine).enumerated() {
      guard let expected else {
        Issue.record("step \(at): the golden's body \(index) does not read")
        continue
      }
      let id = expected.id
      #expect(expected.id == actual.id, "step \(at) body \(index): id")
      #expect(expected.state == actual.state, "step \(at) body \(id): state")
      #expect(expected.appearance == actual.appearance, "step \(at) body \(id): appearance")
      #expect(expected.radius == actual.radius, "step \(at) body \(id): radius")
      #expect(expected.copy == actual.copy, "step \(at) body \(id): copy")
      #expect(expected.top == actual.top, "step \(at) body \(id): top")
      #expect(expected.bottom == actual.bottom, "step \(at) body \(id): bottom")
      #expect(expected.burn == actual.burn, "step \(at) body \(id): burn")
      #expect(expected.light == actual.light, "step \(at) body \(id): light")
      #expect(expected.ring == actual.ring, "step \(at) body \(id): ring")
      #expect(expected.unread == actual.unread, "step \(at) body \(id): unread")
      #expect(expected.stale == actual.stale, "step \(at) body \(id): stale")
      #expect(expected.hollow == actual.hollow, "step \(at) body \(id): hollow")
      #expect(expected.running == actual.running, "step \(at) body \(id): running")
      #expect(expected.blockerKind == actual.blockerKind, "step \(at) body \(id): blockerKind")
    }
  }

  /// B0 — the whole body golden, every step and every field, through the copy and the mapping.
  @Test func theBodyGoldenStepByStep() throws {
    let golden = try MeshFixture.json("phone-body.golden")
    // the parameters first, so a drift in them reads as itself and not as a radius red
    let parameters = golden["parameters"]
    let defaults = SwarmParameters.default
    let radii = [defaults.radiusIdle, defaults.radiusWorking, defaults.radiusWorkingMax, defaults.radiusBlocked]
    let goldenRadii = ["radiusIdle", "radiusWorking", "radiusWorkingMax", "radiusBlocked"].map {
      parameters?[$0]?.doubleValue ?? -1
    }
    #expect(radii == goldenRadii)
    let nowMs = golden["nowMs"]?.intValue
    #expect(nowMs == 1_790_803_300_000)
    let selfWord = golden["self"]?.stringValue
    #expect(selfWord == "home")

    let open = try RemoteRows.open()
    let frames = try RemoteRows.frames()
    let resync = try RemoteRows.resync()
    let steps = golden["steps"]?.arrayValue ?? []
    #expect(steps.count == 11)

    var copy = RemoteMeshCopy()
    let opened = copy.open(open, now: RemoteRows.now)
    #expect(opened == .applied)
    _ = copy.publish()
    let first = steps.first ?? .null
    #expect(first["at"]?.stringValue == "open")
    Self.compare(first, copy)

    enum Delivery {
      case frame(Int, AgentRemoteMeshFrame)
      case resync(AgentRemoteMeshOpen)
    }
    var deliveries: [Delivery] = []
    for (index, frame) in frames.enumerated() {
      deliveries.append(.frame(index, frame))
      if index == PhoneFoldResync.after { deliveries.append(.resync(resync)) }
    }
    var stepIndex = 1
    var gapped = false
    for delivery in deliveries {
      let step = stepIndex < steps.count ? steps[stepIndex] : .null
      stepIndex += 1
      let at = step["at"].map { $0.stringValue ?? "\($0.intValue ?? -1)" }
      let outcome: RemoteMeshCopy.Outcome
      let label: String
      switch delivery {
      case .frame(let index, let frame):
        label = "\(index)"
        outcome = copy.frame(frame, now: RemoteRows.now)
      case .resync(let open):
        label = "resync"
        outcome = copy.open(open, now: RemoteRows.now)
      }
      #expect(at == label, "the golden's step \(stepIndex - 1)")
      if case .gap = outcome {
        let isGap = step["gap"]?.boolValue
        #expect(isGap == true, "step \(label): a gap")
        let bodies = step["bodies"]
        #expect(bodies == nil, "step \(label): a gap draws no bodies")
        gapped = true
        break
      }
      #expect(outcome == .applied, "step \(label)")
      _ = copy.publish()
      Self.compare(step, copy)
    }
    #expect(gapped, "the old chain's delta ends the run")
    #expect(stepIndex == steps.count)
  }
}

/// PG-1c — the whole-mesh resync is delivered after this frame (`PHONE_RESYNC_AFTER`).
enum PhoneFoldResync {
  static let after = 7
}
