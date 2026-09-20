import Foundation
import SwarmPhysics

// The complete, controller-free reading of one swarm body — the reference's
// `bubble-model.ts`, transcribed: which of the five drawn states it is in, how
// big it is, what it says, and which marks it carries. Physics, the GPU, the
// accessibility copy, and any fixture all read this one projection, so they
// cannot develop four interpretations of the same row.
//
// The numbers are the decided swarm design (proposals record, pass 9; RFC 005
// locked 2026-09-09; the one-ink revision of 2026-09-16…18): sizes by status,
// the folder in the project's colour before the name, model and effort always
// shown, the burn ladder and the context ring on a working body, the state's
// own light on a blocked or unread one, and a hollow for a terminal no agent
// has claimed.

public enum SwarmBodyState: String, Sendable {
  case terminalEmpty = "terminal-empty"
  case terminalRunning = "terminal-running"
  case idle
  case working
  case blocked
}

/// The colour of the light inside a body, which is the STATE's and never the
/// project's (2026-09-16): the theme's own ink while working, orange while
/// blocked, blue for a reply that arrived unseen. One light, three colours — a
/// flood in the state's colour would leave the state's own words nowhere to sit.
public enum SwarmLightTone: String, Equatable, Sendable {
  case ink
  case orange
  case blue
}

/// The burn ladder (2026-09-17): estimated USD per minute, about three times
/// the spend per step, so the four flames are even steps on a log scale.
/// Absolute, not relative to the swarm, so one body's reading means the same as
/// another's — the chart it replaces was scaled to its own tallest column and
/// could only say "busier than it was", never "hot".
public let burnLadder: [Double] = [0.05, 0.15, 0.4, 1]

/// How many of the four flames a rate lights.
public func burnFlames(costPerMin: Double) -> Int {
  var lit = 0
  for step in burnLadder where costPerMin >= step { lit += 1 }
  return lit
}

public struct SwarmBurn: Equatable, Sendable {
  /// 0–4 against the ladder. Zero with a price is a calm session.
  public var lit: Int
  /// False where the provider has no pricing lane: the ladder is drawn unread,
  /// never as calm (RFC 008 — a missing lane is unavailable, not zero dollars).
  public var priced: Bool
  public init(lit: Int, priced: Bool) {
    self.lit = lit
    self.priced = priced
  }
}

/// The burn rate as people price work: by the hour.
public func formatRatePerHour(_ costPerMin: Double?) -> String {
  guard let costPerMin else { return "—/hr" }
  let perHour = costPerMin * 60
  if perHour >= 10 { return "$\(Int(perHour.rounded()))/hr" }
  if perHour >= 1 { return String(format: "$%.1f/hr", perHour) }
  return "\(formatUsd(perHour))/hr"
}

public struct SwarmFigure: Equatable, Sendable {
  public var text: String
  public var hot: Bool
  public var none: Bool
  public init(text: String, hot: Bool, none: Bool) {
    self.text = text
    self.hot = hot
    self.none = none
  }
}

public struct SwarmFigures: Equatable, Sendable {
  public var top: SwarmFigure?
  public var bottom: SwarmFigure?
  public init(top: SwarmFigure? = nil, bottom: SwarmFigure? = nil) {
    self.top = top
    self.bottom = bottom
  }
}

public struct SwarmRing: Equatable, Sendable {
  public var percent: Int
  public var hot: Bool
  public init(percent: Int, hot: Bool) {
    self.percent = percent
    self.hot = hot
  }
}

public struct SwarmWatermark: Equatable, Sendable {
  /// The provider mark's id in the atlas.
  public var sprite: String
  public var opacity: Double
  public init(sprite: String, opacity: Double) {
    self.sprite = sprite
    self.opacity = opacity
  }
}

public struct SwarmBodyModel: Equatable, Sendable {
  public var id: String
  public var state: SwarmBodyState
  /// The three-way reading that picks the body's size and its draw order.
  public var appearance: AgentVisualStatus
  public var radius: Double
  /// The project's colour (record §02). It shows in ONE place: the folder
  /// before the project's name. Nothing else on the body wears it
  /// (2026-09-16). nil is the ramp — a bare terminal belongs to no project.
  public var accent: SwarmColor?
  public var copy: [CopyLine]
  public var copyMaxWidthRatio: Double
  /// Context on the top chord and observed estimated USD on the bottom,
  /// working bodies only.
  public var figures: SwarmFigures?
  /// The context ring on the rim in the ink, every agent body.
  public var ring: SwarmRing?
  /// How hard this session is burning, as a count on the fixed ladder.
  /// Working bodies only.
  public var burn: SwarmBurn?
  /// The light inside the body, in the state's colour.
  public var light: SwarmLightTone?
  /// Transparent body with a rim: the unclaimed terminal.
  public var hollow: Bool
  /// The comet sweeping a hollow's rim: a foreground job.
  public var running: Bool
  public var unread: Bool
  public var stale: Bool
  public var active: Bool
  /// A mounted body's band, in the colour of the pane it is worked in; the
  /// outer light joins it only while `active`.
  public var linked: SwarmColor?
  /// The provider mark, watermarked behind the copy.
  public var watermark: SwarmWatermark?
  public var blockerKind: AgentBlockerKind?
  public var accessibilityLabel: String
  public var title: String
}

public struct BodyModelInput: Sendable {
  public var bubble: FieldBubble
  public var parameters: SwarmParameters
  public var now: Date
  /// When this terminal's foreground job was first seen, for the elapsed line.
  public var runningSince: Date?
  /// This session's place among working sessions by estimated USD, 0 (the
  /// least) to 1 (the most).
  public var workingShare: Double

  public init(
    bubble: FieldBubble, parameters: SwarmParameters = .default, now: Date = .now,
    runningSince: Date? = nil, workingShare: Double = 0
  ) {
    self.bubble = bubble
    self.parameters = parameters
    self.now = now
    self.runningSince = runningSince
    self.workingShare = workingShare
  }
}

// The type styles, the reference's numbers.
public enum SwarmCopyStyle {
  public static let terminalName = TextStyle(size: 11, weight: 800, letterSpacing: -0.035)
  public static let smallName = TextStyle(size: 12, weight: 800, letterSpacing: -0.035)
  public static let workingName = TextStyle(size: 14, weight: 800, letterSpacing: -0.035)
  /// The small labels: 7px 800. The terminal's lines are uppercase; the model ·
  /// effort line is lowercase, and italic while the effort is only launch intent.
  public static let labelStacked = TextStyle(size: 7, weight: 800, letterSpacing: 0.1, transform: .uppercase)
  public static let labelInline = TextStyle(size: 7, weight: 800, letterSpacing: 0.07, transform: .lowercase)
  public static let labelInlineItalic = labelInline.italicised()
  public static let command = TextStyle(size: 8, weight: 600)
  public static let branch = TextStyle(size: 7, weight: 500)
  /// The project's name once the state has taken its place above it.
  public static let projectAbove = TextStyle(size: 7.5, weight: 800, letterSpacing: 0.02)
  /// What the body waits on, in the name's place: a sentence, not a label, so
  /// it is set lighter than a name and a size under it to hold as many of its
  /// words as the chord allows.
  public static let stateLine = TextStyle(size: 9, weight: 600, letterSpacing: -0.02)
}

/// The project's folder before its name, in the project's colour: the one
/// place that colour is used. Drawn a little larger than the type so its
/// 24-box ink stands at about the name's cap height, with its advance narrowed
/// to the ink it actually covers.
///
/// Where a state line has displaced the name, the folder turns SOLID and keeps
/// its full strength while the name steps back to a supporting rung: the
/// project is still which agent this is, but its name is no longer what the
/// body is telling you (2026-09-18).
func projectFolder(_ style: TextStyle, solid: Bool = false, tone: CopyTone? = nil) -> CopyLead {
  let size = (style.size * (solid ? 1.3 : 1.15)).rounded()
  return CopyLead(
    kind: .icon(solid ? "folder-solid" : "folder"),
    size: size,
    width: (size * 0.75).rounded(),
    gap: 4,
    opacity: solid ? SwarmWeight.title : nil,
    tone: tone ?? .accent)
}

/// The mark a blocker asks with, and the word it falls back to unnamed.
func blockerMark(_ kind: AgentBlockerKind) -> (icon: String, word: String) {
  switch kind {
  case .permission: ("permission", "permission")
  case .question: ("question", "question")
  case .failure: ("failure", "failed")
  }
}

/// What a blocked body says in the name's place: what it is actually waiting
/// on, in the blocker's OWN evidence before the reply's — the question as
/// asked, the detail an adapter gave, the tool a permission names, the
/// failure's code — and only then the latest reply, and only then the bare word.
func blockerText(_ blocker: AgentBlocker, message: String?) -> String {
  func trimmed(_ value: String?) -> String? {
    guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
    return value
  }
  if blocker.kind == .question, let asked = trimmed(blocker.question) { return asked }
  if let detail = trimmed(blocker.detail) { return detail }
  if blocker.kind == .permission, let tool = blocker.tool, !tool.isEmpty { return tool }
  if blocker.kind == .failure, let code = blocker.code, !code.isEmpty { return code }
  return message ?? blockerMark(blocker.kind).word
}

/// Compact token counts: 820, 8.1k, 24k, 384k, 1.2M, 24M.
public func formatTokens(_ count: Double) -> String {
  if count < 1000 { return "\(Int(count.rounded()))" }
  if count < 10_000 { return String(format: "%.1fk", count / 1000) }
  if count < 1_000_000 { return "\(Int((count / 1000).rounded()))k" }
  if count < 10_000_000 { return String(format: "%.1fM", count / 1_000_000) }
  return "\(Int((count / 1_000_000).rounded()))M"
}

/// Each working session's place among the working sessions by estimated USD:
/// 0 for the least, 1 for the most, everything else in between; all 0 when
/// they tie or there is only one. Terminals without an agent do not count.
public func workingShares(_ bubbles: [FieldBubble]) -> [String: Double] {
  var totals: [(String, Double)] = []
  for bubble in bubbles {
    guard bubble.status == .working, let agent = bubble.agent else { continue }
    totals.append((bubble.id, agent.usage?.total ?? 0))
  }
  var shares: [String: Double] = [:]
  guard let least = totals.map(\.1).min(), let most = totals.map(\.1).max() else { return shares }
  for (id, total) in totals {
    shares[id] = most > least ? (total - least) / (most - least) : 0
  }
  return shares
}

/// The first line of the root agent's latest reply, whitespace collapsed.
private func latestMessage(_ agent: AgentFacet) -> String? {
  guard let text = agent.lastMessage else { return nil }
  for part in text.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "\n" || $0 == "\r\n" }) {
    let collapsed = part.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    if !collapsed.isEmpty { return collapsed }
  }
  return nil
}

public func formatElapsed(since: Date?, now: Date) -> String? {
  guard let since else { return nil }
  let seconds = max(0, Int(now.timeIntervalSince(since).rounded(.down)))
  let minutes = seconds / 60
  let hours = minutes / 60
  if hours > 0 { return String(format: "%dh %02dm", hours, minutes % 60) }
  return String(format: "%d:%02d", minutes, seconds % 60)
}

/// How a row may say who can type on a peer's session (the reference's
/// `remote-write.ts`). What a mesh advertises is one boolean PER HOST, and the
/// per-viewer answer is decided at ATTACH; so the only honest pre-attach
/// sentence is a sentence about the host, said in BOTH directions on purpose:
/// marking only a refusing host made silence mean "you can type".
public func remoteWriteLabel(hostWritable: Bool) -> String {
  hostWritable ? "writable host" : "read-only host"
}

public func remoteWriteTitle(hostWritable: Bool) -> String {
  hostWritable
    ? "this host allows writes — whether yours arrive is decided when you attach"
    : "this host shares read-only — no viewer may type here"
}

/// What a body needs from the user, in the name's place: its words, the mark
/// before them, and how a screen reader says it.
private struct StateLine {
  var text: String
  var icon: String
  var spoken: String
}

public func bodyModel(_ input: BodyModelInput) -> SwarmBodyModel {
  let bubble = input.bubble
  let parameters = input.parameters
  let percent: Int? = bubble.agent?.contextUsedPercent.flatMap { $0.isFinite ? Int($0.rounded(.down)) : nil }
  let contextLabel = percent.map { String(format: "CTX:%02d%%", $0) } ?? "CTX:--%"

  guard let facet = bubble.agent else {
    let remote = bubble.remote
    let running = bubble.status == .working
    let elapsed = running ? formatElapsed(since: input.runningSince, now: input.now) : nil
    var copy: [CopyLine] = [
      // One line, the folder then the name, as every other body reads. A
      // terminal belongs to no project, so its folder wears the ink rather
      // than a colour.
      CopyLine(
        key: "name", text: bubble.project, style: SwarmCopyStyle.terminalName, opacity: SwarmWeight.title,
        tone: .ink, lead: projectFolder(SwarmCopyStyle.terminalName, tone: .ink)),
      running
        ? CopyLine(
          key: "command", text: "running", style: SwarmCopyStyle.command, opacity: SwarmWeight.supporting,
          tone: .ink, gapBefore: 3)
        : CopyLine(
          key: "sub", text: "empty", style: SwarmCopyStyle.labelStacked, opacity: SwarmWeight.supporting,
          tone: .ink, gapBefore: 3),
    ]
    if let elapsed {
      copy.append(
        CopyLine(
          key: "elapsed", text: elapsed, style: SwarmCopyStyle.labelStacked, opacity: SwarmWeight.supporting,
          tone: .ink, gapBefore: 3))
    }
    // A peer's session wears its host on the body — the name and the host's
    // write policy, in both directions — so it cannot be read as one of this
    // machine's terminals.
    if let remote {
      copy.append(
        CopyLine(
          key: "host", text: "\(remote.deviceName) · \(remoteWriteLabel(hostWritable: remote.readWrite))",
          style: SwarmCopyStyle.labelStacked, opacity: SwarmWeight.supporting, tone: .ink, gapBefore: 3))
    }
    let status = bubble.status.rawValue
    return SwarmBodyModel(
      id: bubble.id,
      state: running ? .terminalRunning : .terminalEmpty,
      appearance: .idle,
      radius: parameters.radiusIdle,
      accent: bubble.color,
      copy: copy,
      copyMaxWidthRatio: 0.9,
      figures: nil,
      ring: nil,
      burn: nil,
      light: nil,
      hollow: true,
      running: running,
      unread: false,
      stale: bubble.stale,
      active: bubble.active,
      linked: bubble.pane?.color,
      watermark: nil,
      blockerKind: nil,
      accessibilityLabel: remote.map {
        "on \($0.deviceName), \(bubble.project), remote session, \(status), \(remoteWriteLabel(hostWritable: $0.readWrite))"
      } ?? "\(bubble.project), unassigned terminal, \(status)",
      title: remote.map { "\($0.deviceName) · \(remoteWriteTitle(hostWritable: $0.readWrite)) · \(bubble.detail)" }
        ?? bubble.detail)
  }

  let appearance = bubble.status
  // A working body grows with its share of the working sessions' estimated
  // USD, from the working size for the least to the largest size for the most.
  let radius = bodyRadius(status: appearance, share: input.workingShare, parameters: parameters)
  let model = facet.modelName ?? facet.provider.displayName
  let effort = facet.effort
  let ring = percent.map { SwarmRing(percent: max(0, min(100, $0)), hot: $0 >= 80) }
  let accessibilityLabel = "\(bubble.project), \(model), \(appearance.rawValue): \(bubble.detail), \(contextLabel)"
  let title = "\(bubble.project) · \(model) · \(bubble.detail)"
  let modelLine = CopyLine(
    key: "model",
    text: effort.map { "\(model) · \($0.value)" } ?? model,
    style: effort?.intent == .configured ? SwarmCopyStyle.labelInlineItalic : SwarmCopyStyle.labelInline,
    opacity: SwarmWeight.supporting,
    tone: .ink,
    gapBefore: 3)
  let message = latestMessage(facet)
  let watermark = SwarmWatermark(sprite: facet.provider.rawValue, opacity: SwarmWeight.watermark)

  if appearance == .working {
    // The held total is the UI's ledger: corrected USD across a bubble's runs,
    // cached ones included. The RATE is Core's own live projection over its
    // rate-eligible window — never a difference of UI snapshots, which a
    // correction could otherwise turn into new spend.
    let total = facet.usage?.total
    let liveUsage = facet.monitorUsage
    let coverage = liveUsage?.costCoverage
    let priced = coverage == .complete || coverage == .partial
    let ratePerMin: Double? = priced ? (liveUsage?.costRatePerMin ?? 0) : nil
    var copy: [CopyLine] = []
    if let branch = facet.branch {
      copy.append(
        CopyLine(
          key: "branch", text: branch, style: SwarmCopyStyle.branch, opacity: SwarmWeight.supporting, tone: .ink,
          lead: CopyLead(kind: .dot, size: 5, gap: 4, tone: .green)))
    }
    copy.append(
      CopyLine(
        key: "name", text: bubble.project, style: SwarmCopyStyle.workingName, opacity: SwarmWeight.title,
        tone: .ink, gapBefore: facet.branch == nil ? 0 : 1, lead: projectFolder(SwarmCopyStyle.workingName)))
    copy.append(modelLine)
    let rate = formatRatePerHour(ratePerMin)
    let partial = facet.usage?.coverage == .partial
    return SwarmBodyModel(
      id: bubble.id,
      state: .working,
      appearance: appearance,
      radius: radius,
      accent: bubble.color,
      copy: copy,
      copyMaxWidthRatio: 0.8,
      figures: SwarmFigures(
        top: SwarmFigure(text: percent.map { "\($0)%" } ?? "--", hot: percent.map { $0 >= 80 } ?? false, none: percent == nil),
        bottom: SwarmFigure(
          text: total.map { "~\(formatUsd($0))\(partial ? "+" : "")" } ?? "—", hot: false, none: total == nil)),
      ring: ring,
      burn: SwarmBurn(lit: ratePerMin.map { burnFlames(costPerMin: $0) } ?? 0, priced: priced),
      light: .ink,
      hollow: false,
      running: false,
      unread: bubble.unread,
      stale: bubble.stale,
      active: bubble.active,
      linked: bubble.pane?.color,
      watermark: watermark,
      blockerKind: nil,
      // The flames are the glance; the exact rate is a word away, for a screen
      // reader and for the card.
      accessibilityLabel: "\(accessibilityLabel), burning \(rate)",
      title: "\(title) · \(rate)")
  }

  let blocker = appearance == .blocked ? facet.blocker : nil
  // What the body needs from the user takes the name's place, in its own words
  // behind its own mark: what a blocker is waiting on, or the reply that
  // arrived unseen. The project's name moves above it, and nothing follows the
  // model line (2026-09-16). The state's COLOUR is the body's ground rather
  // than its words, so those words stay the theme's ink like every other
  // body's (2026-09-18).
  let state: StateLine?
  if let blocker {
    let text = blockerText(blocker, message: message)
    let mark = blockerMark(blocker.kind)
    state = StateLine(text: text, icon: mark.icon, spoken: "\(mark.word): \(text)")
  } else if appearance == .blocked {
    state = StateLine(text: message ?? "blocked", icon: "failure", spoken: message ?? "blocked")
  } else if bubble.unread {
    state = StateLine(
      text: message ?? "new message", icon: "message",
      spoken: message.map { "new message: \($0)" } ?? "new message")
  } else {
    state = nil
  }
  let nameStyle = state == nil ? SwarmCopyStyle.smallName : SwarmCopyStyle.projectAbove
  var copy: [CopyLine] = [
    CopyLine(
      key: "name", text: bubble.project, style: nameStyle,
      opacity: state == nil ? SwarmWeight.title : SwarmWeight.supporting, tone: .ink,
      lead: projectFolder(nameStyle, solid: state != nil))
  ]
  if let state {
    copy.append(
      CopyLine(
        key: "state", text: state.text, style: SwarmCopyStyle.stateLine, opacity: SwarmWeight.title, tone: .ink,
        gapBefore: 2, lineHeight: 1.15, lead: CopyLead(kind: .icon(state.icon), size: 11, width: 8, gap: 3)))
  }
  copy.append(modelLine)
  let light: SwarmLightTone? = appearance == .blocked ? .orange : bubble.unread ? .blue : nil
  return SwarmBodyModel(
    id: bubble.id,
    state: appearance == .blocked ? .blocked : .idle,
    appearance: appearance,
    radius: radius,
    accent: bubble.color,
    copy: copy,
    // The state line is the widest thing a small body carries; it gets a
    // little more of the chord than a name would.
    copyMaxWidthRatio: state == nil ? 0.84 : 0.86,
    figures: nil,
    ring: ring,
    burn: nil,
    light: light,
    hollow: false,
    running: false,
    unread: bubble.unread,
    stale: bubble.stale,
    active: bubble.active,
    linked: bubble.pane?.color,
    watermark: watermark,
    blockerKind: blocker?.kind,
    accessibilityLabel: state.map { "\(accessibilityLabel), \($0.spoken)" } ?? accessibilityLabel,
    title: title)
}
