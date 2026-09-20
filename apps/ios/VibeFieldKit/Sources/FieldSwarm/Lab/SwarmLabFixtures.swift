import FieldAgents
import Foundation
import SwarmPhysics

// Fixture rows for the design lab — the reference's `lab/fixtures.ts` (the
// one-ink revision): every drawn state and every setting worth comparing, as
// the same `FieldBubble` the field receives, so the lab draws with the
// production model and renderer and never with a stand-in.

public struct LabStage: Identifiable, Sendable {
  public var id: String
  public var title: String
  public var note: String
  public var bubble: FieldBubble
  public var runningSince: Date?
  /// A working body's place among the working sessions by estimated USD, 0..1; the lab sets it by hand.
  public var workingShare: Double
  public var focus: Bool
  /// Draw the hold-to-create indicator at this cell instead of a body.
  public var hold: Bool
  /// This stage's light, for weighing settings side by side.
  public var glow: SwarmGlow?

  public init(
    id: String, title: String, note: String, bubble: FieldBubble, runningSince: Date? = nil,
    workingShare: Double = 0, focus: Bool = false, hold: Bool = false, glow: SwarmGlow? = nil
  ) {
    self.id = id
    self.title = title
    self.note = note
    self.bubble = bubble
    self.runningSince = runningSince
    self.workingShare = workingShare
    self.focus = focus
    self.hold = hold
    self.glow = glow
  }
}

/// The reference lab's burn shapes: tokens per minute as a function of the step.
public enum BurnShape: String, CaseIterable, Sendable {
  case ember, steady, ease, blaze

  public func rate(_ index: Double) -> Double {
    let wobble = { (amount: Double) in 1 + amount * sin(index * 1.7) * cos(index * 0.6) }
    switch self {
    case .ember: return 600 * wobble(0.2)
    case .steady: return 8_000 * wobble(0.12)
    case .ease: return (12_000 - 10_000 * min(1, index / 30)) * wobble(0.1)
    case .blaze: return (index < 28 ? 3_000 : 3_000 + ((index - 28) / 11) * 27_000) * wobble(0.08)
    }
  }
}

/// The ledger's history for a rate curve over the last ten minutes: one bucket
/// per step, the fixture's tokens priced at a dollar a million.
public func labUsageHistory(_ shape: BurnShape, total: Double?) -> UsageHistory {
  let steps = (0..<usageStepCount).map { index in
    shape.rate(Double(index * 2)) * usageStepMs / 60_000 / 1_000_000
  }
  return UsageHistory(total: total, coverage: .complete, steps: steps)
}

/// The fixtures' clock: every stage is dated against this instant, and the
/// lab reads its models at it too, so a running terminal's elapsed line says
/// 1:23 on any day rather than the days since the fixtures were written.
public let labNow = Date(timeIntervalSince1970: 1_789_300_800)  // 2026-09-13T12:00:00Z

struct LabAgentSpec {
  var id: String
  var project: String
  var status: AgentVisualStatus
  var provider: AgentProvider = .claude
  var model: String?
  var effort: String?
  var effortIntent: AgentEffortIntent = .observed
  var branch: String?
  var contextPercent: Double?
  var burn: BurnShape?
  var detail: String?
  var blocker: AgentBlockerKind?
  /// An adapter's human-readable line for the blocker: what the body says first.
  var blockerDetail: String?
  /// The question as asked, for a question blocker.
  var question: String?
  var stale = false
  var active = false
  var mounted = false
  /// The project's dealt sequence plus one, so the lab's eight projects read 1…8.
  var accent = 1
  var message: String?
  /// The session's total tokens; the bottom figure prices them at a dollar a million.
  var tokens: Double?
  /// Estimated USD per minute: what the burn ladder reads.
  var ratePerMin: Double?
  /// The provider has no pricing lane, so the ladder is drawn unread.
  var unpriced = false
}

/// The colours the lab deals: the same walk the field's assembly makes.
public struct LabPalette: Sendable {
  public var tint: ProjectTint
  public init(tint: ProjectTint) { self.tint = tint }
  public func project(_ seq: Int) -> SwarmColor { .project(seq, tint) }
  public func pane(_ seq: Int) -> SwarmColor { .pane(seq, tint) }
}

func labAgent(_ spec: LabAgentSpec, palette: LabPalette) -> FieldBubble {
  let blocker: AgentBlocker? = spec.blocker.map { kind in
    switch kind {
    case .permission: AgentBlocker(kind: .permission, detail: spec.blockerDetail, tool: "Bash")
    case .question: AgentBlocker(kind: .question, detail: spec.blockerDetail, question: spec.question)
    case .failure: AgentBlocker(kind: .failure, detail: spec.blockerDetail, code: "E_TOOL")
    }
  }
  // A provider with no pricing lane has no ledger either: no total, no rate.
  let usage: UsageHistory? =
    spec.unpriced
    ? nil
    : spec.burn.map { labUsageHistory($0, total: spec.tokens.map { $0 / 1_000_000 }) }
      ?? spec.tokens.map {
        UsageHistory(total: $0 / 1_000_000, coverage: .complete, steps: [Double](repeating: 0, count: usageStepCount))
      }
  let facet = AgentFacet(
    provider: spec.provider,
    modelName: spec.model,
    branch: spec.branch,
    contextUsedPercent: spec.contextPercent,
    permissions: spec.blocker == .permission ? [AgentPermission(tool: "Bash")] : [],
    blocker: blocker,
    effort: spec.effort.map { AgentEffort(value: $0, intent: spec.effortIntent) },
    lastMessage: spec.message,
    // What the burn ladder reads. An unpriced provider has the lane missing
    // altogether, which is not the same as a rate of zero.
    monitorUsage: AgentUsage(
      cumulativeTokens: spec.tokens,
      costCoverage: spec.unpriced ? .unavailable : .complete,
      costRatePerMin: spec.unpriced ? nil : (spec.ratePerMin ?? 0)),
    usage: usage,
    statusSince: labNow.addingTimeInterval(-20),
    lastEvidenceAt: labNow.addingTimeInterval(spec.stale ? -120 : 0))
  let paneColour = palette.pane(spec.accent - 1)
  return FieldBubble(
    id: spec.id,
    project: spec.project,
    detail: spec.detail ?? spec.status.rawValue,
    status: spec.status,
    identityKey: spec.id,
    createdAt: labNow.addingTimeInterval(-60),
    agent: facet,
    remote: nil,
    color: palette.project(spec.accent - 1),
    stale: spec.stale,
    active: spec.active,
    pane: spec.mounted || spec.active ? PaneLink(color: paneColour) : nil,
    unread: false)
}

func labTerminal(_ id: String, project: String, running: Bool) -> FieldBubble {
  FieldBubble(
    id: id,
    project: project,
    detail: "/Users/james/Projects/" + project,
    status: running ? .working : .idle,
    identityKey: id,
    createdAt: labNow.addingTimeInterval(-60),
    agent: nil,
    remote: nil)
}

/// Part I: the states, one body each.
public func stateStages(palette: LabPalette) -> [LabStage] {
  var stages: [LabStage] = [
    LabStage(
      id: "terminal-empty", title: "Terminal, empty",
      note: "Dashed rim; the folder in the ink, then the name; \"empty\".",
      bubble: labTerminal("t1", project: "voyager", running: false)),
    LabStage(
      id: "terminal-running", title: "Terminal, running",
      note: "Solid faint rim, the comet, the clock since the job began.",
      bubble: labTerminal("t2", project: "study", running: true), runningSince: labNow.addingTimeInterval(-83)),
    LabStage(
      id: "idle", title: "Agent, idle",
      note: "The folder in the project’s colour, the name at the title’s weight, model · effort stepped back from it. The gauge climbs from the track’s weight as the context fills.",
      bubble: labAgent(
        LabAgentSpec(id: "a1", project: "ref", status: .idle, model: "Sonnet 5", effort: "medium", contextPercent: 31, accent: 3),
        palette: palette)),
    LabStage(
      id: "idle-unread", title: "Idle, unread",
      note: "A reply arrived while another session had the card. The reply itself takes the name’s place behind the chat mark, the name moves above it, and the body glows blue in the same carried waves. Nothing follows the model line.",
      bubble: {
        var bubble = labAgent(
          LabAgentSpec(
            id: "a2", project: "jabali", status: .idle, model: "Fable 5.1", effort: "high", contextPercent: 44,
            accent: 2, message: "Done: the editor now saves on blur and the three failing tests pass."),
          palette: palette)
        bubble.unread = true
        return bubble
      }()),
    LabStage(
      id: "idle-unread-silent", title: "Idle, unread, no reply text",
      note: "Nothing was captured to quote, so the line falls back to the words “new message”.",
      bubble: {
        var bubble = labAgent(
          LabAgentSpec(id: "a2b", project: "ref", status: .idle, model: "Sonnet 5", effort: "medium", contextPercent: 18, accent: 3),
          palette: palette)
        bubble.unread = true
        return bubble
      }()),
    LabStage(
      id: "idle-context-low", title: "Idle, context barely touched",
      note: "Twelve per cent: the gauge is only just above its track, because it is not yet worth your attention.",
      bubble: labAgent(
        LabAgentSpec(id: "a1b", project: "voyager", status: .idle, model: "Sonnet 5", effort: "medium", contextPercent: 12, accent: 5),
        palette: palette)),
    LabStage(
      id: "idle-context-high", title: "Idle, context nearly spent",
      note: "Ninety-four per cent: the same gauge, at the top of its climb, now the strongest mark on the body.",
      bubble: labAgent(
        LabAgentSpec(id: "a1c", project: "voyager", status: .idle, model: "Sonnet 5", effort: "medium", contextPercent: 94, accent: 5),
        palette: palette)),
    LabStage(
      id: "idle-configured", title: "Idle, effort configured",
      note: "Launch intent, no provider evidence yet: the effort is set in italics.",
      bubble: labAgent(
        LabAgentSpec(
          id: "a3", project: "duke", status: .idle, model: "Haiku 4.5", effort: "low", effortIntent: .configured, accent: 6),
        palette: palette)),
    LabStage(
      id: "idle-stale", title: "Idle, stale evidence", note: "Dimmed and desaturated, never recoloured.",
      bubble: labAgent(
        LabAgentSpec(id: "a4", project: "ref", status: .idle, model: "Sonnet 5", effort: "medium", contextPercent: 31, stale: true, accent: 3),
        palette: palette)),
    LabStage(
      id: "idle-mounted", title: "Idle, mounted",
      note: "The pane’s colour as a band a thirtieth of the radius wide outside the rim, the gutter, and nothing beyond it; the project’s colour stays the folder before the name.",
      bubble: labAgent(
        LabAgentSpec(id: "a5", project: "voyager", status: .idle, model: "Sonnet 5", effort: "medium", contextPercent: 12, mounted: true, accent: 5),
        palette: palette)),
    LabStage(
      id: "idle-selected", title: "Idle, the open card",
      note: "The same band, and the outer light beyond it: the one body whose card is open.",
      bubble: labAgent(
        LabAgentSpec(id: "a5s", project: "voyager", status: .idle, model: "Sonnet 5", effort: "medium", contextPercent: 12, active: true, accent: 5),
        palette: palette)),
    LabStage(
      id: "working", title: "Agent, working",
      note: "Branch, the folder and name, model · effort; context at the top; the burn ladder in the ink, with the estimated total below; the centre light is the theme’s own ink. The least spend among the working sessions: 60.",
      bubble: labAgent(
        LabAgentSpec(
          id: "w1", project: "puppeteer", status: .working, model: "Fable 5.1", effort: "high", branch: "swarm",
          contextPercent: 62, burn: .steady, detail: "Editing tokens.css", accent: 1, tokens: 384_000, ratePerMin: 0.22),
        palette: palette)),
    LabStage(
      id: "working-hot", title: "Working, hot",
      note: "Burning $72/hr and the context past 80%: four flames, the last at full weight, and the gauge at the top of its climb. Nothing turns a colour — the count and the weight are the alarm.",
      bubble: labAgent(
        LabAgentSpec(
          id: "w2", project: "puppeteer", status: .working, model: "Fable 5.1", effort: "high", branch: "swarm",
          contextPercent: 88, burn: .blaze, detail: "Delegating to Explore", accent: 1, ratePerMin: 1.2),
        palette: palette)),
    LabStage(
      id: "working-ease", title: "Working, easing", note: "A quiet loop at $4.80/hr: one flame, and nothing beside it.",
      bubble: labAgent(
        LabAgentSpec(
          id: "w3", project: "duke", status: .working, model: "Haiku 4.5", effort: "low", branch: "hw3",
          contextPercent: 55, burn: .ease, detail: "Thinking", accent: 6, ratePerMin: 0.08),
        palette: palette)),
    LabStage(
      id: "working-quiet", title: "Working, no evidence yet",
      note: "No usage, no context, no price: one hollow flame — unread, which is not the same as calm — and both figures rest.",
      bubble: labAgent(
        LabAgentSpec(id: "w4", project: "study", status: .working, model: "Sonnet 5", accent: 8, unpriced: true),
        palette: palette)),
    LabStage(
      id: "working-active", title: "Working, the open card",
      note: "Mounted and in front: the pane light and the same body.",
      bubble: labAgent(
        LabAgentSpec(
          id: "w5", project: "jabali", status: .working, model: "Fable 5.1", effort: "max", branch: "editor",
          contextPercent: 27, burn: .steady, detail: "Writing the reply", active: true, accent: 2, ratePerMin: 0.3),
        palette: palette)),
    LabStage(
      id: "working-largest", title: "Working, the most spend",
      note: "The most estimated USD among the working sessions: 80, with the gauge and the gutter thicker in proportion. The rest fall between 60 and 80.",
      bubble: labAgent(
        LabAgentSpec(
          id: "w6", project: "puppeteer", status: .working, model: "Fable 5.1", effort: "high", branch: "swarm",
          contextPercent: 62, burn: .steady, detail: "Editing tokens.css", accent: 1, tokens: 2_400_000, ratePerMin: 0.62),
        palette: palette),
      workingShare: 1),
    LabStage(
      id: "working-middle", title: "Working, halfway", note: "Halfway between the least and the most: 70.",
      bubble: labAgent(
        LabAgentSpec(
          id: "w7", project: "duke", status: .working, model: "Haiku 4.5", effort: "low", branch: "hw3",
          contextPercent: 55, burn: .ease, detail: "Thinking", accent: 6, tokens: 1_200_000, ratePerMin: 0.08),
        palette: palette),
      workingShare: 0.5),
    LabStage(
      id: "blocked-permission", title: "Blocked, permission",
      note: "The state’s own light. Its ground is that orange carried to the theme’s calm end — down toward black on a dark theme, up toward white on a light one — so the words keep the middle; the light itself rides the annulus at full chroma, in waves carried outward without a pause. Reduce Motion holds them at mid-crest. What it waits on takes the name’s place behind the key: a permission says the tool it wants, its own evidence before any reply’s.",
      bubble: labAgent(
        LabAgentSpec(
          id: "b1", project: "duke", status: .blocked, model: "Haiku 4.5", effort: "low", contextPercent: 40,
          blocker: .permission, accent: 6, message: "May I run pnpm test to check the fix?"),
        palette: palette)),
    LabStage(
      id: "blocked-question", title: "Blocked, question",
      note: "A question says the question, as it was asked, ellipsised to the chord.",
      bubble: labAgent(
        LabAgentSpec(
          id: "b2", project: "voyager", status: .blocked, model: "Sonnet 5", effort: "medium", contextPercent: 70,
          blocker: .question, question: "Which key should the export use, the artist or the album?", accent: 5),
        palette: palette)),
    LabStage(
      id: "blocked-failure", title: "Blocked, failed",
      note: "A failure with nothing else to go on falls back to its code.",
      bubble: labAgent(
        LabAgentSpec(id: "b3", project: "ref", status: .blocked, model: "Sonnet 5", contextPercent: 91, blocker: .failure, accent: 3),
        palette: palette)),
    LabStage(
      id: "blocked-mounted", title: "Blocked, mounted",
      note: "An adapter’s own line for the blocker, which beats both the tool and the reply. The light inside is the state’s orange, the band outside is the pane’s colour, the folder is the project’s: three colours, three owners. The outer light joins only while its card is open.",
      bubble: labAgent(
        LabAgentSpec(
          id: "b4", project: "jabali", status: .blocked, model: "Fable 5.1", effort: "high", contextPercent: 52,
          blocker: .permission, blockerDetail: "Delete the stale build folder", mounted: true, accent: 2),
        palette: palette)),
    LabStage(
      id: "hold", title: "Hold to create", note: "The indicator at the end of a 520ms hold on empty field.",
      bubble: labTerminal("t3", project: "x", running: false), hold: true),
    LabStage(
      id: "focus", title: "VoiceOver focus", note: "A 2px ink ring, 4px off the rim, when the body's element has focus.",
      bubble: labAgent(
        LabAgentSpec(id: "a6", project: "study", status: .idle, model: "Sonnet 5", effort: "medium", contextPercent: 20, accent: 8),
        palette: palette),
      focus: true),
  ]
  // A peer's session, the phone's own row: the host on the body, both ways.
  stages.append(
    LabStage(
      id: "remote", title: "A peer’s terminal",
      note: "The host and its write policy on the body, so it cannot read as one of this phone’s terminals.",
      bubble: FieldBubble(
        id: "remote:mini:1", project: "mesh-console", detail: "studio-mini · /Projects/mesh-console", status: .idle,
        identityKey: "remote:mini:1", createdAt: labNow, agent: nil,
        remote: RemoteFacet(
          deviceID: "mini", deviceName: "studio-mini", sessionID: "1", attachable: true, readWrite: true,
          cwdLabel: "/Projects/mesh-console"))))
  return stages
}

/// Part II: the burn ladder, one body per reading, so the steps can be compared.
public func burnStages(palette: LabPalette) -> [LabStage] {
  func step(_ id: String, _ title: String, _ note: String, _ ratePerMin: Double?, _ project: String, _ accent: Int) -> LabStage {
    LabStage(
      id: id, title: title, note: note,
      bubble: labAgent(
        LabAgentSpec(
          id: id, project: project, status: .working, model: "Fable 5.1", effort: "high", branch: "main",
          contextPercent: 44, burn: .steady, detail: "Working", accent: accent, tokens: 620_000,
          ratePerMin: ratePerMin, unpriced: ratePerMin == nil),
        palette: palette))
  }
  return [
    step("burn-calm", "Calm", "Under five cents a minute: no flames at all. A body with nothing to say says nothing.", 0.02, "ref", 3),
    step("burn-one", "One flame", "Five cents a minute, $3/hr: one flame, low on its own climb. A working loop on a mid-tier model.", 0.07, "duke", 6),
    step("burn-two", "Two flames", "Fifteen cents a minute, $9/hr. Steady work.", 0.24, "voyager", 5),
    step("burn-three", "Three flames", "Forty cents a minute, $24/hr. Long context or high effort.", 0.52, "jabali", 2),
    step("burn-four", "Four flames", "A dollar a minute, $60/hr. A fan-out worth knowing about.", 1.6, "puppeteer", 1),
    step(
      "burn-unpriced", "No price to read",
      "A provider with no pricing lane: ONE hollow flame. Not four, and not nothing — an absent reading must never look like a calm one.",
      nil, "study", 8),
  ]
}

/// Part III: the pane light, three weights, on the same idle body with its card open.
public func lightStages(palette: LabPalette) -> [LabStage] {
  func mounted(_ id: String) -> FieldBubble {
    labAgent(
      LabAgentSpec(id: id, project: "voyager", status: .idle, model: "Sonnet 5", effort: "medium", contextPercent: 31, active: true, accent: 5),
      palette: palette)
  }
  return [
    LabStage(id: "lamp", title: "The lamp", note: "Steady. Reach 34, strength 0.8, no breath — the default.", bubble: mounted("g1"), glow: SwarmGlow(reach: 34, strength: 0.8, breath: 0)),
    LabStage(id: "beacon", title: "The beacon", note: "Reach 48, strength 0.9, breathing to 38% every 1.2s.", bubble: mounted("g2"), glow: SwarmGlow(reach: 48, strength: 0.9, breath: 1)),
    LabStage(id: "wide", title: "The wide lamp", note: "Reach 70, strength 0.6: softer and further.", bubble: mounted("g3"), glow: SwarmGlow(reach: 70, strength: 0.6, breath: 0)),
  ]
}

/// Part IV: a settled cluster, the field as it actually looks.
public func clusterStages(palette: LabPalette) -> [LabStage] {
  [
    LabStage(id: "c1", title: "", note: "", bubble: labTerminal("c-t1", project: "voyager", running: false)),
    LabStage(id: "c2", title: "", note: "", bubble: labTerminal("c-t2", project: "study", running: true), runningSince: labNow.addingTimeInterval(-341)),
    LabStage(
      id: "c3", title: "", note: "",
      bubble: {
        var bubble = labAgent(
          LabAgentSpec(id: "c-a1", project: "jabali", status: .idle, model: "Fable 5.1", effort: "high", contextPercent: 44, accent: 2, message: "Done: the editor now saves on blur."),
          palette: palette)
        bubble.unread = true
        return bubble
      }()),
    LabStage(
      id: "c4", title: "", note: "",
      bubble: labAgent(
        LabAgentSpec(id: "c-w1", project: "puppeteer", status: .working, model: "Fable 5.1", effort: "high", branch: "swarm", contextPercent: 62, burn: .steady, detail: "Editing tokens.css", active: true, accent: 1, tokens: 2_400_000, ratePerMin: 0.62),
        palette: palette),
      workingShare: 1),
    LabStage(
      id: "c5", title: "", note: "",
      bubble: labAgent(
        LabAgentSpec(id: "c-b1", project: "duke", status: .blocked, model: "Haiku 4.5", effort: "low", contextPercent: 40, blocker: .permission, accent: 6, message: "May I run pnpm test?"),
        palette: palette)),
    LabStage(
      id: "c6", title: "", note: "",
      bubble: labAgent(
        LabAgentSpec(id: "c-w2", project: "puppeteer", status: .working, model: "Fable 5.1", effort: "high", branch: "swarm", contextPercent: 27, burn: .blaze, detail: "Delegating", accent: 1, tokens: 384_000, ratePerMin: 1.4),
        palette: palette),
      workingShare: 0.15),
    LabStage(
      id: "c7", title: "", note: "",
      bubble: labAgent(LabAgentSpec(id: "c-a2", project: "ref", status: .idle, model: "Sonnet 5", effort: "medium", contextPercent: 31, accent: 3), palette: palette)),
    LabStage(
      id: "c8", title: "", note: "",
      bubble: labAgent(
        LabAgentSpec(id: "c-w3", project: "duke", status: .working, model: "Haiku 4.5", effort: "low", branch: "hw3", contextPercent: 55, burn: .ease, detail: "Writing the reply", accent: 6, tokens: 1_200_000, ratePerMin: 0.09),
        palette: palette),
      workingShare: 0.5),
  ]
}

/// A settled field: centre pull and pairwise separation, the way the swarm
/// rests (the reference lab's own routine).
public func settleCluster(radii: [Double], width: Double, height: Double, seed: Double = 3) -> [SIMD2<Double>] {
  let golden = Double.pi * (3 - 5.0.squareRoot())
  let gap = SwarmConstants.physicalGap
  var points = radii.indices.map { index -> SIMD2<Double> in
    let spread = 18 * (Double(index) + 1).squareRoot()
    return SIMD2(
      width / 2 + cos(Double(index) * golden + seed) * spread,
      height / 2 + sin(Double(index) * golden + seed) * spread)
  }
  for _ in 0..<600 {
    for index in points.indices {
      points[index].x += (width / 2 - points[index].x) * 0.02
      points[index].y += (height / 2 - points[index].y) * 0.02
      let r = radii[index] + gap
      points[index].x = min(max(points[index].x, r), width - r)
      points[index].y = min(max(points[index].y, r), height - r)
    }
    for a in points.indices {
      for b in points.indices where b > a {
        let dx = points[b].x - points[a].x
        let dy = points[b].y - points[a].y
        var distance = (dx * dx + dy * dy).squareRoot()
        if distance == 0 { distance = 0.01 }
        let minimum = radii[a] + radii[b] + gap * 2
        if distance >= minimum { continue }
        let push = (minimum - distance) / 2
        let ux = dx / distance
        let uy = dy / distance
        points[a].x -= ux * push
        points[a].y -= uy * push
        points[b].x += ux * push
        points[b].y += uy * push
      }
    }
  }
  return points
}
