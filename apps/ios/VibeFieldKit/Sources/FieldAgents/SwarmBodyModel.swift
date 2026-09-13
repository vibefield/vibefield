import Foundation
import SwarmPhysics

// The complete, controller-free reading of one swarm body — the reference's
// `bubble-model.ts`, transcribed: which of the five drawn states it is in, how
// big it is, what it says, and which marks it carries. Physics, the GPU, the
// accessibility copy, and any fixture all read this one projection, so they
// cannot develop four interpretations of the same row.
//
// The numbers are the decided swarm design (proposals record, pass 9; RFC 005
// locked 2026-09-09): sizes by status, the unread dot before the name, model
// and effort always shown, the burn bars and the context ring on a working
// body, the flood on a blocked one, and a hollow for a terminal no agent has
// claimed.

public enum SwarmBodyState: String, Sendable {
  case terminalEmpty = "terminal-empty"
  case terminalRunning = "terminal-running"
  case idle
  case working
  case blocked
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
  /// The three-way reading that picks the body's colours and size.
  public var appearance: AgentVisualStatus
  public var radius: Double
  /// The project's colour (record §02): the tag before the name, the flood,
  /// the centre light. nil is the ramp — a bare terminal belongs to no project.
  public var accent: SwarmColor?
  public var copy: [CopyLine]
  public var copyMaxWidthRatio: Double
  /// The context figure on the top chord and the session's total tokens on
  /// the bottom one, working bodies only.
  public var figures: SwarmFigures?
  /// The context ring on the rim in the ink, every agent body.
  public var ring: SwarmRing?
  /// The burn bars' two sides, twenty columns each, oldest first.
  public var graph: BurnBars?
  /// Blocked: the accent floods the body from the centre.
  public var flood: Bool
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
  /// This working session's place among the working sessions by total tokens,
  /// 0 (the least) to 1 (the most).
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
  /// The latest reply, one line.
  public static let message = TextStyle(size: 8, weight: 500)
  public static let kind = TextStyle(size: 7, weight: 800, letterSpacing: 0.08, transform: .uppercase)
}

/// The project's tag before the name: a rounded bar in the project's colour,
/// the name's height, a quarter as wide.
private func projectTag(_ style: TextStyle) -> CopyLead {
  let size = (style.size * 0.8).rounded()
  return CopyLead(kind: .bar, size: size, width: max(2, (size / 4).rounded()), gap: 4, tone: .accent)
}

private func blockerLine(_ kind: AgentBlockerKind) -> String {
  switch kind {
  case .permission: "permission"
  case .question: "question"
  case .failure: "failed"
  }
}

/// Compact token counts: 820, 8.1k, 24k, 384k, 1.2M, 24M.
public func formatTokens(_ count: Double) -> String {
  if count < 1000 { return "\(Int(count.rounded()))" }
  if count < 10_000 { return String(format: "%.1fk", count / 1000) }
  if count < 1_000_000 { return "\(Int((count / 1000).rounded()))k" }
  if count < 10_000_000 { return String(format: "%.1fM", count / 1_000_000) }
  return "\(Int((count / 1_000_000).rounded()))M"
}

/// Each working session's place among the working sessions by total tokens:
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
      CopyLine(
        key: "folder", text: "", style: SwarmCopyStyle.terminalName, opacity: 0.6, tone: .ink,
        lead: CopyLead(kind: .icon("folder"), size: 14, gap: 0)),
      CopyLine(key: "name", text: bubble.project, style: SwarmCopyStyle.terminalName, opacity: 1, tone: .ink, gapBefore: 3),
      running
        ? CopyLine(key: "command", text: "running", style: SwarmCopyStyle.command, opacity: 0.85, tone: .ink, gapBefore: 3)
        : CopyLine(key: "sub", text: "empty", style: SwarmCopyStyle.labelStacked, opacity: 0.55, tone: .ink, gapBefore: 3),
    ]
    if let elapsed {
      copy.append(CopyLine(key: "elapsed", text: elapsed, style: SwarmCopyStyle.labelStacked, opacity: 0.55, tone: .ink, gapBefore: 3))
    }
    // A peer's session wears its host on the body — the name and the host's
    // write policy, in both directions — so it cannot be read as one of this
    // machine's terminals.
    if let remote {
      copy.append(
        CopyLine(
          key: "host", text: "\(remote.deviceName) · \(remoteWriteLabel(hostWritable: remote.readWrite))",
          style: SwarmCopyStyle.labelStacked, opacity: 0.7, tone: .ink, gapBefore: 3))
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
      graph: nil,
      flood: false,
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
    opacity: 0.58,
    tone: .ink,
    gapBefore: 3)
  let message = latestMessage(facet)
  let watermarkSprite = facet.provider.rawValue

  if appearance == .working {
    // The UI's ledger, never Core's estimate: the held total and the stepped burn.
    let total = facet.usage?.total
    var copy: [CopyLine] = []
    if let branch = facet.branch {
      copy.append(
        CopyLine(
          key: "branch", text: branch, style: SwarmCopyStyle.branch, opacity: 0.67, tone: .ink,
          lead: CopyLead(kind: .dot, size: 5, gap: 4, tone: .green)))
    }
    copy.append(
      CopyLine(
        key: "name", text: bubble.project, style: SwarmCopyStyle.workingName, opacity: 1, tone: .ink,
        gapBefore: facet.branch == nil ? 0 : 1, tag: projectTag(SwarmCopyStyle.workingName)))
    copy.append(modelLine)
    return SwarmBodyModel(
      id: bubble.id,
      state: .working,
      appearance: appearance,
      radius: radius,
      accent: bubble.color,
      copy: copy,
      copyMaxWidthRatio: 0.8,
      figures: SwarmFigures(
        top: SwarmFigure(text: percent.map { "\($0)%" } ?? "--", hot: (percent ?? 0) >= 80 && percent != nil, none: percent == nil),
        bottom: SwarmFigure(text: total.map(formatTokens) ?? "--", hot: false, none: total == nil)),
      ring: ring,
      graph: facet.usage.map(burnBars),
      flood: false,
      hollow: false,
      running: false,
      unread: bubble.unread,
      stale: bubble.stale,
      active: bubble.active,
      linked: bubble.pane?.color,
      watermark: SwarmWatermark(sprite: watermarkSprite, opacity: 0.16),
      blockerKind: nil,
      accessibilityLabel: accessibilityLabel,
      title: title)
  }

  let kind = appearance == .blocked ? facet.blockerKind : nil
  // The latest reply, one line, led by a dot: orange for a body that waits on
  // the user, blue for a reply the user has not looked at. Without a reply the
  // blocked body names its blocker instead.
  func reply(_ tone: CopyTone, _ text: String) -> CopyLine {
    CopyLine(
      key: "message", text: text, style: SwarmCopyStyle.message, opacity: 0.85, tone: .ink,
      gapBefore: 3, lineHeight: 1.2, lead: CopyLead(kind: .dot, size: 5, gap: 4, tone: tone))
  }
  var messageLine: [CopyLine] = []
  if appearance == .blocked {
    if let message {
      messageLine = [reply(.orange, message)]
    } else {
      messageLine = [
        CopyLine(
          key: "kind", text: kind.map(blockerLine) ?? "blocked", style: SwarmCopyStyle.kind,
          opacity: 1, tone: .orange, gapBefore: 3)
      ]
    }
  } else if bubble.unread, let message {
    messageLine = [reply(.blue, message)]
  }
  var copy: [CopyLine] = [
    CopyLine(
      key: "name", text: bubble.project, style: SwarmCopyStyle.smallName, opacity: 1, tone: .ink,
      tag: projectTag(SwarmCopyStyle.smallName),
      lead: bubble.unread && message == nil ? CopyLead(kind: .dot, size: 5, gap: 4, tone: .blue) : nil),
    modelLine,
  ]
  copy.append(contentsOf: messageLine)
  return SwarmBodyModel(
    id: bubble.id,
    state: appearance == .blocked ? .blocked : .idle,
    appearance: appearance,
    radius: radius,
    accent: bubble.color,
    copy: copy,
    copyMaxWidthRatio: 0.84,
    figures: nil,
    ring: ring,
    graph: nil,
    flood: appearance == .blocked,
    hollow: false,
    running: false,
    unread: bubble.unread,
    stale: bubble.stale,
    active: bubble.active,
    linked: bubble.pane?.color,
    watermark: SwarmWatermark(sprite: watermarkSprite, opacity: appearance == .blocked ? 0.12 : 0.055),
    blockerKind: kind,
    accessibilityLabel: accessibilityLabel,
    title: title)
}
