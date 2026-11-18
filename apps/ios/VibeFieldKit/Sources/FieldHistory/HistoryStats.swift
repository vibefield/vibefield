import CoreGraphics
import FieldProduct
import Foundation

// Item 353 (asked for 2026-11-12: the desktop's stats and treemap ported to the phone as well, the phone's History
// drawn more like the desktop's, and a toggle at the top right that shows the
// stats) — the ledger's FIGURES, as values: every listed project's lifetime, the four figures over them, and the
// treemap of the ten that cost most. The desktop draws these in rosetta's room (`clients/room/src`, `SummaryPanels`,
// `charts/treemap-layout.ts`, `lib/spend.ts`); the words, the rules and the layout here are the room's, read from
// the same door the phone already reads (`project.figures`), with nothing added to it.
//
// What the phone holds, and what it does not:
// - A project's days (`heatmap`) are not cut for a phone. Asked with no window they are every recorded day, so the
//   tokens and the estimated cost summed over them are the project's lifetime.
// - A project's session rows (`contribution`) ARE cut for a phone, at `INDEX_TAILNET_LIMITS.MAX_ROWS` (100), and the
//   answer says so (`clipped`). Messages are counted only there, so a cut project's messages are a lower bound and
//   are drawn as one (`+`). No door says how many rows were left out.
// - A desktop that did not answer, a project split across rosetta's ids, or a conversation two desktops both
//   recorded make the days inexact (`partial`); the panel says how many projects that is.

/// Estimated spend: the room's `Spend`, kept to what decides its drawing.
public struct HistorySpend: Equatable, Sendable, Codable {
  /// Estimated micro-USD at list prices; nil when nothing was priced.
  public var costMicroUsd: Double?
  /// Tokens the price list could not price.
  public var unpricedTokens: Double
  /// Replies whose output was never recorded.
  public var unrecordedOutput: Double

  public init(costMicroUsd: Double? = nil, unpricedTokens: Double = 0, unrecordedOutput: Double = 0) {
    self.costMicroUsd = costMicroUsd
    self.unpricedTokens = unpricedTokens
    self.unrecordedOutput = unrecordedOutput
  }

  public static let none = HistorySpend()

  /// `complete`: every token priced and every output recorded. `partial`: a lower bound. `unavailable`: usage, none
  /// of it priced. `none`: no usage.
  public enum Coverage: Equatable, Sendable {
    case complete
    case partial
    case unavailable
    case none
  }

  public var coverage: Coverage {
    guard costMicroUsd != nil else { return unpricedTokens > 0 ? .unavailable : .none }
    return unpricedTokens > 0 || unrecordedOutput > 0 ? .partial : .complete
  }

  public static func + (left: HistorySpend, right: HistorySpend) -> HistorySpend {
    let cost: Double? =
      switch (left.costMicroUsd, right.costMicroUsd) {
      case (nil, nil): nil
      case (let a?, nil): a
      case (nil, let b?): b
      case (let a?, let b?): a + b
      }
    return HistorySpend(
      costMicroUsd: cost, unpricedTokens: left.unpricedTokens + right.unpricedTokens,
      unrecordedOutput: left.unrecordedOutput + right.unrecordedOutput)
  }
}

/// A project's lifetime, as its door's figures give it.
public struct HistoryLifetime: Equatable, Sendable, Codable {
  /// Tokens over every recorded day.
  public let tokens: Double
  /// Estimated spend over every recorded day.
  public let spend: HistorySpend
  /// Messages over the session rows the door gave.
  public let messages: Double
  /// The door cut the session rows for a phone: `messages` is a lower bound.
  public let clipped: Bool
  /// The days are not exact (a desktop did not answer, a split project, a conversation recorded twice).
  public let partial: Bool

  public init(tokens: Double, spend: HistorySpend, messages: Double, clipped: Bool, partial: Bool) {
    self.tokens = tokens
    self.spend = spend
    self.messages = messages
    self.clipped = clipped
    self.partial = partial
  }
}

/// The ledger's figures: the four numbers over every listed project, and the treemap's tiles.
public struct HistoryPortfolio: Equatable, Sendable {
  public struct Tile: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    /// Lifetime estimated cost, micro-USD: the tile's area.
    public let value: Double
    /// The cost is a lower bound.
    public let lowerBound: Bool
  }

  /// The projects listed, and how many of them have their figures read.
  public let projects: Int
  public let read: Int
  public let sessions: Int
  public let messages: Double
  public let messagesLowerBound: Bool
  public let tokens: Double
  public let spend: HistorySpend
  /// The ten that cost most, the costliest first.
  public let tiles: [Tile]
  /// Projects with usage and no list price: the treemap cannot size them.
  public let unpriced: Int
  /// Projects whose days are not exact.
  public let partial: Int

  /// Every listed project's figures are read.
  public var isWhole: Bool { read >= projects }
}

extension FieldHistoryModel {
  /// The treemap's tiles: the room's `MAX_TREEMAP_PROJECT_COUNT`.
  public static let treemapProjects = 10

  /// A project's lifetime from `project.figures` asked over every recorded day: the days summed for tokens and
  /// spend, the session rows for messages.
  public static func lifetime(_ result: ProjectFiguresResult) -> HistoryLifetime {
    var spend = HistorySpend.none
    var tokens = 0.0
    for day in result.heatmap {
      tokens += day.tokens
      spend = spend + HistorySpend(
        costMicroUsd: day.costMicroUsd, unpricedTokens: day.unpricedTokens, unrecordedOutput: day.unrecordedOutput)
    }
    return HistoryLifetime(
      tokens: tokens, spend: spend, messages: result.contribution.reduce(0) { $0 + $1.messages },
      clipped: result.clipped, partial: result.partial)
  }

  /// The ledger's figures over the projects it lists. `sessions` is the ledger's own count (`project.list`), whole
  /// before any figure is read.
  public static func portfolio(_ projects: [HistoryProject], sessions: Int) -> HistoryPortfolio {
    let read = projects.compactMap { project in project.lifetime.map { (project, $0) } }
    let ranked =
      read
      .filter { ($0.1.spend.costMicroUsd ?? 0) > 0 }
      .sorted { left, right in
        let a = left.1.spend.costMicroUsd ?? 0
        let b = right.1.spend.costMicroUsd ?? 0
        if a != b { return a > b }
        if left.1.tokens != right.1.tokens { return left.1.tokens > right.1.tokens }
        return left.0.id < right.0.id
      }
    return HistoryPortfolio(
      projects: projects.count, read: read.count, sessions: sessions,
      messages: read.reduce(0) { $0 + $1.1.messages },
      messagesLowerBound: read.contains { $0.1.clipped },
      tokens: read.reduce(0) { $0 + $1.1.tokens },
      spend: read.reduce(.none) { $0 + $1.1.spend },
      tiles: ranked.prefix(treemapProjects).map { project, lifetime in
        HistoryPortfolio.Tile(
          id: project.id, name: project.name, value: lifetime.spend.costMicroUsd ?? 0,
          lowerBound: lifetime.spend.coverage == .partial)
      },
      unpriced: read.filter { $0.1.spend.coverage == .unavailable }.count,
      partial: read.filter { $0.1.partial }.count)
  }

  /// `$1.24` `K` · `$412` · `$0.37` · `<$0.01` — estimated cost as a figure and its unit, the room's `fmtUsd`.
  public static func usdWord(_ microUsd: Double) -> (figure: String, unit: String) {
    let usd = microUsd / 1e6
    if usd >= 999.5 {
      let word = tokensWord(usd)
      return ("$" + word.figure, word.unit)
    }
    if usd >= 100 { return (String(format: "$%.0f", usd), "") }
    if usd >= 0.01 || usd == 0 { return (String(format: "$%.2f", usd), "") }
    return ("<$0.01", "")
  }

  /// A row's "how much": the estimated cost with its coverage, the room's `SpendFigure`. A lower bound says `+`;
  /// usage with no list price reads `n/p`, never a claimed $0; no usage, or figures not read, a dash.
  public static func spendWord(_ spend: HistorySpend?) -> (figure: String, unit: String) {
    guard let spend else { return ("—", "") }
    switch spend.coverage {
    case .none: return ("—", "")
    case .unavailable: return ("n/p", "")
    case .partial:
      let word = usdWord(spend.costMicroUsd ?? 0)
      return (word.figure, word.unit + "+")
    case .complete: return usdWord(spend.costMicroUsd ?? 0)
    }
  }

  /// The wash behind a row and the Spend rank's measure: lifetime estimated cost, micro-USD (0 while unread).
  public static func lifetimeCost(_ project: HistoryProject) -> Double {
    project.lifetime?.spend.costMicroUsd ?? 0
  }

  /// The line under the figures while they are not whole, or when some are not exact; nil when there is nothing to
  /// say.
  ///
  /// Item 390 (asked for 2026-11-13) — it no longer says `messages are a lower bound`: that sentence was removed. A cut
  /// project's messages still wear their `+` on the figure (`messagesLowerBound`).
  public static func portfolioNote(_ portfolio: HistoryPortfolio, failed: Int, awake: Bool) -> String? {
    var parts: [String] = []
    if !portfolio.isWhole {
      let missing = portfolio.projects - portfolio.read
      if !awake {
        parts.append("figures for \(portfolio.read) of \(portfolio.projects) projects were read")
      } else if failed > 0, failed >= missing {
        parts.append("figures for \(failed) \(failed == 1 ? "project" : "projects") failed · retrying")
      } else {
        parts.append("reading figures · \(portfolio.read) of \(portfolio.projects) projects")
      }
    }
    if portfolio.partial > 0 {
      parts.append("\(portfolio.partial) \(portfolio.partial == 1 ? "project's days are" : "projects' days are") not exact")
    }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }

  /// The line under the treemap for projects it cannot size, the room's own words.
  public static func unpricedNote(_ count: Int) -> String? {
    switch count {
    case ..<1: nil
    case 1: "1 project has usage with no list price and is not shown"
    default: "\(count) projects have usage with no list price and are not shown"
    }
  }
}

/// The treemap's layout: the room's (`charts/treemap-layout.ts`), the squarified treemap of Bruls, Huizing and van
/// Wijk. Area is quantity; the costliest tile first.
public enum HistoryTreemap {
  public struct Tile: Equatable, Sendable {
    /// The value's place in the list given.
    public let index: Int
    public let rect: CGRect
    /// Its exact share of the total.
    public let share: Double
    /// The tile is large enough to carry its name and its figure.
    public let labelled: Bool
  }

  /// A tile carries its two lines from this size up: a name of a few letters and a figure, at the phone's type.
  public static let labelWidth: CGFloat = 52
  public static let labelHeight: CGFloat = 36

  /// The tiles for `values` in a plot of `size`, the largest first. A value that is not positive and finite has no
  /// area and no tile.
  public static func layout(_ values: [Double], in size: CGSize) -> [Tile] {
    guard size.width.isFinite, size.height.isFinite, size.width > 0, size.height > 0 else { return [] }
    let sorted =
      values.enumerated()
      .filter { $0.element.isFinite && $0.element > 0 }
      .sorted { $0.element != $1.element ? $0.element > $1.element : $0.offset < $1.offset }
    let total = sorted.reduce(0) { $0 + $1.element }
    guard total > 0 else { return [] }
    let scale = Double(size.width * size.height) / total
    let rects = squarify(sorted.map { $0.element * scale }, width: Double(size.width), height: Double(size.height))
    return zip(sorted, rects).map { entry, rect in
      Tile(
        index: entry.offset, rect: rect, share: entry.element / total,
        labelled: rect.width >= labelWidth && rect.height >= labelHeight)
    }
  }

  /// The worst aspect ratio a row of `areas` has along a side of `length`.
  static func worst(_ areas: [Double], along length: Double) -> Double {
    guard !areas.isEmpty, length > 0 else { return .infinity }
    let area = areas.reduce(0, +)
    guard let largest = areas.max(), let smallest = areas.min(), area > 0, smallest > 0 else { return .infinity }
    return max(length * length * largest / (area * area), area * area / (length * length * smallest))
  }

  static func squarify(_ areas: [Double], width: Double, height: Double) -> [CGRect] {
    var rects: [CGRect] = []
    var x = 0.0
    var y = 0.0
    var remainingWidth = width
    var remainingHeight = height
    var row: [Double] = []
    var horizontal = false
    var length = 0.0

    func place() {
      let rowArea = row.reduce(0, +)
      let thickness = length > 0 ? rowArea / length : 0
      var offset = 0.0
      for area in row {
        let along = thickness > 0 ? area / thickness : 0
        rects.append(
          horizontal
            ? CGRect(x: x + offset, y: y, width: along, height: thickness)
            : CGRect(x: x, y: y + offset, width: thickness, height: along))
        offset += along
      }
      if horizontal {
        y += thickness
        remainingHeight = max(0, remainingHeight - thickness)
      } else {
        x += thickness
        remainingWidth = max(0, remainingWidth - thickness)
      }
      row = []
    }

    var next = 0
    while next < areas.count {
      if row.isEmpty {
        horizontal = remainingHeight > remainingWidth
        length = horizontal ? remainingWidth : remainingHeight
      }
      let candidate = areas[next]
      if row.isEmpty || worst(row + [candidate], along: length) <= worst(row, along: length) {
        row.append(candidate)
        next += 1
      } else {
        place()
      }
    }
    if !row.isEmpty { place() }
    return rects
  }
}
