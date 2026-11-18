import CoreGraphics
import FieldProduct
import Foundation
import Testing

@testable import FieldHistory

/// Item 353 (asked for 2026-11-12: the desktop's stats and treemap ported to the phone as well) — the
/// ledger's figures as values: a project's lifetime from `project.figures` asked over every recorded day, the four
/// figures over the projects listed, the treemap's tiles and their layout, and the row's estimated cost with its
/// coverage. The rules are rosetta's room's (`lib/spend.ts`, `SummaryPanels`, `charts/treemap-layout.ts`).
///
/// How it reads on a phone, and whether the phone's sums equal the desktop's on real history, are to be seen on
/// a device.
@Suite("item 353 — the ledger's figures and its treemap")
struct HistoryStatsTests {
  private static func day(_ year: Int, _ month: Int, _ day: Int) -> Date {
    var parts = DateComponents()
    parts.year = year
    parts.month = month
    parts.day = day
    parts.hour = 12
    return Calendar.autoupdatingCurrent.date(from: parts)!
  }

  private static func project(
    _ id: String, tokens: Double = 0, cost: Double? = nil, unpriced: Double = 0, messages: Double = 0,
    clipped: Bool = false, partial: Bool = false, thirtyDays: Double = 0, read: Bool = true
  ) -> HistoryProject {
    HistoryProject(
      id: id, name: id, seq: 0, path: "", figure: "0", unit: "", spend: thirtyDays, last: "2h", recencyMinutes: 120,
      agents: [], spark: [],
      lifetime: read
        ? HistoryLifetime(
          tokens: tokens, spend: HistorySpend(costMicroUsd: cost, unpricedTokens: unpriced), messages: messages,
          clipped: clipped, partial: partial)
        : nil)
  }

  @Test("spend says its coverage: nothing, unpriced, a lower bound, whole; and sums as SQL sums it")
  func coverage() {
    #expect(HistorySpend.none.coverage == .none)
    #expect(HistorySpend(costMicroUsd: nil, unpricedTokens: 40).coverage == .unavailable)
    #expect(HistorySpend(costMicroUsd: 10, unpricedTokens: 40).coverage == .partial)
    #expect(HistorySpend(costMicroUsd: 10, unrecordedOutput: 1).coverage == .partial)
    #expect(HistorySpend(costMicroUsd: 10).coverage == .complete)
    #expect((HistorySpend.none + HistorySpend.none).costMicroUsd == nil, "null only when every part was unpriced")
    let sum = HistorySpend(costMicroUsd: 10, unpricedTokens: 1) + HistorySpend(costMicroUsd: nil, unpricedTokens: 2)
    #expect(sum == HistorySpend(costMicroUsd: 10, unpricedTokens: 3))
  }

  @Test("a project's lifetime: its days summed for tokens and spend, its session rows for messages, the door's own flags")
  func lifetime() throws {
    let figures = try ProjectFiguresResult(json: try Fixture.json("project-figures.valid"))
    let lifetime = FieldHistoryModel.lifetime(figures)
    #expect(lifetime.tokens == 278_000)
    #expect(lifetime.spend == HistorySpend(costMicroUsd: 1_850_000, unpricedTokens: 1_200, unrecordedOutput: 1))
    #expect(lifetime.spend.coverage == .partial)
    #expect(lifetime.messages == 109)
    #expect(lifetime.clipped == false && lifetime.partial == true)
  }

  @Test("one answer over every day: the row's thirty days are cut from it, and the lifetime is all of it")
  func oneAnswer() throws {
    let figures = try ProjectFiguresResult(json: try Fixture.json("project-figures.valid"))
    let bare = Self.project("p", read: false)
    // the fixture's days are 29 and 30 September 2026
    let inside = FieldHistoryModel.withFigures(bare, figures, sessions: [], now: Self.day(2026, 10, 10))
    #expect(inside.figure == "278" && inside.unit == "K")
    #expect(inside.lifetime?.tokens == 278_000)
    let after = FieldHistoryModel.withFigures(bare, figures, sessions: [], now: Self.day(2026, 11, 12))
    #expect(after.figure == "0" && after.unit == "", "no day of the last thirty")
    #expect(after.spark.allSatisfy { $0 == 0 })
    #expect(after.lifetime?.tokens == 278_000, "the lifetime is every recorded day")
    #expect(after.lifetime?.spend.costMicroUsd == 1_850_000)
  }

  @Test("the four figures sum the projects read; the ledger's own session count is whole before any figure")
  func portfolio() {
    let projects = [
      Self.project("a", tokens: 1_000, cost: 300, messages: 10),
      Self.project("b", tokens: 4_000, cost: 900, unpriced: 5, messages: 20, clipped: true),
      Self.project("c", tokens: 500, cost: nil, unpriced: 500, messages: 1, partial: true),
      Self.project("d", read: false),
    ]
    let portfolio = FieldHistoryModel.portfolio(projects, sessions: 412)
    #expect(portfolio.projects == 4 && portfolio.read == 3 && portfolio.isWhole == false)
    #expect(portfolio.sessions == 412)
    #expect(portfolio.tokens == 5_500)
    #expect(portfolio.messages == 31 && portfolio.messagesLowerBound)
    #expect(portfolio.spend == HistorySpend(costMicroUsd: 1_200, unpricedTokens: 505))
    #expect(portfolio.tiles.map(\.id) == ["b", "a"], "the costliest first; a project with no priced usage has no tile")
    #expect(portfolio.tiles.map(\.lowerBound) == [true, false])
    #expect(portfolio.unpriced == 1 && portfolio.partial == 1)
    let none = FieldHistoryModel.portfolio([Self.project("d", read: false)], sessions: 7)
    #expect(none.read == 0 && none.sessions == 7 && none.tiles.isEmpty && none.spend.coverage == .none)
  }

  @Test("the treemap holds the ten that cost most, tokens breaking a tie")
  func tenTiles() {
    var projects = (1...12).map { Self.project("p\($0)", tokens: Double($0), cost: Double($0) * 100) }
    projects.append(Self.project("tie-small", tokens: 1, cost: 1_200))
    projects.append(Self.project("tie-big", tokens: 9_999, cost: 1_200))
    let tiles = FieldHistoryModel.portfolio(projects, sessions: 0).tiles
    #expect(tiles.count == FieldHistoryModel.treemapProjects)
    #expect(tiles.prefix(3).map(\.id) == ["tie-big", "p12", "tie-small"])
    #expect(tiles.last?.id == "p5")
  }

  @Test("estimated cost in the room's words: three figures above a thousand, whole dollars, cents, less than a cent")
  func usd() {
    #expect(FieldHistoryModel.usdWord(1_240_000_000) == ("$1.24", "K"))
    #expect(FieldHistoryModel.usdWord(53_500_000_000) == ("$53.5", "K"))
    #expect(FieldHistoryModel.usdWord(412_300_000) == ("$412", ""))
    #expect(FieldHistoryModel.usdWord(37_420_000) == ("$37.42", ""))
    #expect(FieldHistoryModel.usdWord(370_000) == ("$0.37", ""))
    #expect(FieldHistoryModel.usdWord(5_000) == ("<$0.01", ""))
    #expect(FieldHistoryModel.usdWord(0) == ("$0.00", ""))
  }

  @Test("a row's how-much: a dash unread, n/p unpriced, a plus on a lower bound, never a claimed zero")
  func spendWord() {
    #expect(FieldHistoryModel.spendWord(nil) == ("—", ""))
    #expect(FieldHistoryModel.spendWord(HistorySpend.none) == ("—", ""))
    #expect(FieldHistoryModel.spendWord(HistorySpend(costMicroUsd: nil, unpricedTokens: 9)) == ("n/p", ""))
    #expect(FieldHistoryModel.spendWord(HistorySpend(costMicroUsd: 412_000_000, unpricedTokens: 9)) == ("$412", "+"))
    #expect(FieldHistoryModel.spendWord(HistorySpend(costMicroUsd: 1_240_000_000, unrecordedOutput: 2)) == ("$1.24", "K+"))
    #expect(FieldHistoryModel.spendWord(HistorySpend(costMicroUsd: 412_000_000)) == ("$412", ""))
  }

  @Test("spend ranks by lifetime cost once one is read, and the wash is scaled to the costliest")
  func rankAndWash() {
    let projects = [
      Self.project("old-and-dear", cost: 9_000, thirtyDays: 1),
      Self.project("busy-and-cheap", cost: 100, thirtyDays: 500),
      Self.project("unread", thirtyDays: 900, read: false),
    ]
    #expect(
      FieldHistoryModel.projects(projects, rankedBy: .spend).map(\.id) == ["old-and-dear", "busy-and-cheap", "unread"])
    #expect(FieldHistoryModel.share(of: projects[0], among: projects) == 1)
    #expect(abs(FieldHistoryModel.share(of: projects[1], among: projects) - 100.0 / 9_000.0) < 0.0001)
    #expect(FieldHistoryModel.share(of: projects[2], among: projects) == 0)
    #expect(FieldHistoryModel.costliest(projects)?.id == "old-and-dear")
    // before any lifetime is read the thirty days' tokens rank and scale, as they did
    let unread = [Self.project("x", thirtyDays: 2, read: false), Self.project("y", thirtyDays: 8, read: false)]
    #expect(FieldHistoryModel.projects(unread, rankedBy: .spend).map(\.id) == ["y", "x"])
    #expect(FieldHistoryModel.share(of: unread[0], among: unread) == 0.25)
    #expect(FieldHistoryModel.costliest(unread) == nil)
  }

  @Test("the line under the figures says what is not whole, and says nothing when all is")
  func notes() {
    let whole = FieldHistoryModel.portfolio([Self.project("a", cost: 1)], sessions: 1)
    #expect(FieldHistoryModel.portfolioNote(whole, failed: 0, awake: true) == nil)
    let reading = FieldHistoryModel.portfolio(
      [Self.project("a", cost: 1), Self.project("b", read: false), Self.project("c", read: false)], sessions: 1)
    #expect(FieldHistoryModel.portfolioNote(reading, failed: 0, awake: true) == "reading figures · 1 of 3 projects")
    #expect(
      FieldHistoryModel.portfolioNote(reading, failed: 2, awake: true) == "figures for 2 projects failed · retrying")
    #expect(
      FieldHistoryModel.portfolioNote(reading, failed: 0, awake: false) == "figures for 1 of 3 projects were read")
    // Item 390 (asked for 2026-11-13: the second marked text removed) — RE-CUT: this row
    // held `messages are a lower bound · 1 project's days are not exact`. The line no longer says a cut project's
    // messages are a lower bound; the figure's own `+` does (`portfolio`, above), and the days' sentence stays.
    let bounded = FieldHistoryModel.portfolio(
      [Self.project("a", cost: 1, clipped: true), Self.project("b", cost: 1, partial: true)], sessions: 1)
    #expect(bounded.messagesLowerBound, "the figure still wears its +")
    #expect(FieldHistoryModel.portfolioNote(bounded, failed: 0, awake: true) == "1 project's days are not exact")
    let cut = FieldHistoryModel.portfolio([Self.project("a", cost: 1, clipped: true)], sessions: 1)
    #expect(cut.messagesLowerBound)
    #expect(FieldHistoryModel.portfolioNote(cut, failed: 0, awake: true) == nil, "a lower bound alone is no line")
    #expect(FieldHistoryModel.unpricedNote(0) == nil)
    #expect(FieldHistoryModel.unpricedNote(1) == "1 project has usage with no list price and is not shown")
    #expect(FieldHistoryModel.unpricedNote(3) == "3 projects have usage with no list price and are not shown")
  }

  @Test("the last word is the desktop's: hours up to a day whatever the calendar says, yesterday for the day after")
  func lastWord() {
    let now = Self.day(2026, 11, 12)  // noon
    func ago(_ seconds: Double) -> Int64 { Int64((now.timeIntervalSince1970 - seconds) * 1000) }
    #expect(FieldHistoryModel.lastWord(ago(89), now: now) == "now")
    #expect(FieldHistoryModel.lastWord(ago(90), now: now) == "1m")
    #expect(FieldHistoryModel.lastWord(ago(59 * 60), now: now) == "59m")
    #expect(
      FieldHistoryModel.lastWord(ago(13 * 3_600), now: now) == "13h",
      "eleven last night is thirteen hours ago, as the desktop says; the calendar's yesterday is not asked")
    #expect(FieldHistoryModel.lastWord(ago(23.9 * 3_600), now: now) == "23h")
    #expect(FieldHistoryModel.lastWord(ago(24 * 3_600), now: now) == "yesterday")
    #expect(FieldHistoryModel.lastWord(ago(47.9 * 3_600), now: now) == "yesterday")
    #expect(FieldHistoryModel.lastWord(ago(48 * 3_600), now: now) == "2d")
    #expect(FieldHistoryModel.lastWord(nil, now: now) == "—")
  }

  @Test("the row's activity is the desktop's shape: fifteen bars of two days, the last thirty days")
  func activityShape() throws {
    let now = Self.day(2026, 11, 12)
    // thirty-one days, the oldest first: [30] is today, [0] is thirty days ago
    let days = FieldHistoryModel.lastDays(31, now: now)
    func day(_ back: Int, _ tokens: Double) -> JSONValue {
      .object(["day": .string(days[30 - back]), "tokens": .double(tokens)])
    }
    let figures = try ProjectFiguresResult(
      json: .object([
        "key": .string("p"),
        "heatmap": .array([day(30, 999), day(29, 30), day(2, 15), day(1, 20), day(0, 10)]),
        "usage": .object(["models": .array([]), "hours": .array([])]),
        "contribution": .array([]), "sources": .array([]),
        "partial": .bool(false), "lifetimePartial": .bool(false), "clipped": .bool(false),
      ]))
    let project = FieldHistoryModel.withFigures(Self.project("p", read: false), figures, sessions: [], now: now)
    var expected = Array(repeating: 0, count: 15)
    expected[0] = 12  // twenty-nine and twenty-eight days back: 30 (thirty days back is outside the thirty days)
    expected[13] = 6  // three and two days back: 15
    expected[14] = 12  // yesterday and today: 30
    #expect(project.spark == expected)
    #expect(project.lifetime?.tokens == 1_074, "the lifetime is every day given")
  }

  @Test("a row's agents are counted over its top-level sessions: by share, the lead first, three, then how many more")
  func agents() {
    let counted = FieldHistoryModel.agentShares(counts: ["claude": 6, "codex": 3, "gemini": 1, "cursor": 1, "opencode": 1])
    #expect(counted.shares == [HistoryAgentShare("claude", 50), HistoryAgentShare("codex", 25), HistoryAgentShare("cursor", 8)])
    #expect(counted.more == 2)
    let none = FieldHistoryModel.agentShares(counts: [:])
    #expect(none.shares.isEmpty && none.more == 0)
  }

  @Test("the treemap is squarified: the paper's own example, the largest first, every area its share")
  func squarified() throws {
    // Bruls, Huizing and van Wijk's figure: 6, 6, 4, 3, 2, 2, 1 in a 6 by 4 rectangle
    let values: [Double] = [6, 6, 4, 3, 2, 2, 1]
    let tiles = HistoryTreemap.layout(values, in: CGSize(width: 6, height: 4))
    try #require(tiles.count == 7)
    #expect(tiles.map(\.index) == [0, 1, 2, 3, 4, 5, 6])
    #expect(tiles[0].rect == CGRect(x: 0, y: 0, width: 3, height: 2))
    #expect(tiles[1].rect == CGRect(x: 0, y: 2, width: 3, height: 2))
    for tile in tiles {
      #expect(abs(Double(tile.rect.width * tile.rect.height) - values[tile.index]) < 0.0001)
      #expect(abs(tile.share - values[tile.index] / 24) < 0.0001)
      #expect(tile.rect.minX >= -0.0001 && tile.rect.maxX <= 6.0001 && tile.rect.minY >= -0.0001 && tile.rect.maxY <= 4.0001)
    }
  }

  @Test("a value with no area has no tile; the order given does not matter; a small tile carries no words")
  func tiles() {
    let size = CGSize(width: 340, height: 148)
    let tiles = HistoryTreemap.layout([1, 0, 900, -4, .nan, 99], in: size)
    #expect(tiles.map(\.index) == [2, 5, 0])
    #expect(tiles.first?.labelled == true && tiles.last?.labelled == false)
    #expect(abs(tiles.reduce(0) { $0 + Double($1.rect.width * $1.rect.height) } - 340 * 148) < 0.01)
    #expect(HistoryTreemap.layout([3, 2], in: .zero).isEmpty)
    #expect(HistoryTreemap.layout([], in: size).isEmpty)
    #expect(HistoryTreemap.layout([0, 0], in: size).isEmpty)
  }
}
