import Foundation
import Testing

@testable import FieldDesign

/// Item 242 (DESIGN.md §7, "The phone kit's faint words, sorted"; asked for 2026-11-08: §2.4's law binds; re-cut
/// 2026-11-17 on train 8's main): the kit's `inkFaint`, at 30% by day and 32% by night, retires, and
/// each of its 61 uses takes the tier §2.4's test gives it. A word that must be read takes t3,
/// `ChromePalette.inkTertiary` (42). A mark takes t4, `ChromePalette.inkT4` (19). Read on the kit's sources, from this
/// file's own path: the palette may not offer `inkFaint`, no view may name it, and each file that held it reads its
/// inks in the order the table gives.
@Suite("the phone kit's faint words, sorted")
struct KitFaintWordsTests {
  /// `Sources/`, three steps up from this file (`Tests/FieldDesignTests/KitFaintWordsTests.swift`).
  static let sources = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("Sources")

  /// Each file that held `inkFaint` at the base: its t3 and t4 inks on code lines (comment lines aside), in their
  /// order. Its own t3s stand where they stood. Each former `inkFaint` reads its class, by the census
  /// taken for item 242 on 2026-11-17: t3 42, t4 19.
  static let inks: [String: String] = [
    "FieldDesign/ChromeList.swift": "t3 t3 t3 t3 t3",
    "FieldHistory/HistoryFiguresView.swift": "t3 t3 t3 t3 t3 t3 t3",
    "FieldHistory/HistoryLedgerView.swift": "t3 t3 t3 t3 t3 t3 t3 t3 t3",
    "FieldHistory/HistoryMessageView.swift": "t3 t3 t3",
    "FieldHistory/HistoryOlderPullView.swift": "t3",
    "FieldHistory/HistoryParts.swift": "t4 t3 t3 t3 t4 t3 t3",
    "FieldHistory/HistoryPictureView.swift": "t4 t4 t3 t3 t4 t4 t3",
    "FieldHistory/HistoryProjectView.swift": "t3 t3 t3 t3 t3 t3 t4 t3 t3 t4 t3 t3 t3 t3",
    "FieldHistory/HistorySessionView.swift":
      "t3 t3 t3 t3 t3 t3 t3 t3 t3 t3 t3 t3 t3 t3 t3 t4 t3 t4 t3 t4 t4 t3 t3 t3 t4 t3",
    "FieldHistory/HistoryToolDetailView.swift": "t3 t3 t3 t3 t4 t3 t3 t3",
    "FieldHome/Apps/AppsFolderViews.swift": "t4",
    "FieldHome/PhoneSearchSheet.swift": "t3 t3 t3 t4 t3 t3 t3 t3",
    "FieldHome/WayInView.swift": "t3 t3 t3 t4 t4",
    "FieldSettings/AboutPage.swift": "t3 t3 t3 t3 t3",
    "FieldTerminal/TerminalLookPreview.swift": "t3 t4",
  ]

  /// Every Swift source under `Sources/`, by its path below it, with its text.
  static func swiftSources() throws -> [(path: String, text: String)] {
    let root = sources.standardizedFileURL.path
    let found = FileManager.default.enumerator(atPath: root)?.allObjects as? [String] ?? []
    return try found.filter { $0.hasSuffix(".swift") }.sorted().map { path in
      (path: path, text: try String(contentsOfFile: root + "/" + path, encoding: .utf8))
    }
  }

  /// One code line's t3 and t4 inks, in their order on the line.
  static func tiers(in line: String) -> [String] {
    var found: [(at: String.Index, tier: String)] = []
    for (name, tier) in [("ChromePalette.inkTertiary", "t3"), ("ChromePalette.inkT4", "t4")] {
      var from = line.startIndex
      while let hit = line.range(of: name, range: from..<line.endIndex) {
        found.append((at: hit.lowerBound, tier: tier))
        from = hit.upperBound
      }
    }
    return found.sorted { $0.at < $1.at }.map { $0.tier }
  }

  @Test("the kit's sources are where this file says")
  func sourcesFound() throws {
    let files = try Self.swiftSources().map(\.path)
    #expect(files.contains("FieldDesign/ChromePalette.swift"), "no ChromePalette.swift under \(Self.sources.path)")
  }

  @Test("no kit source names inkFaint, the palette's declaration among them")
  func noInkFaint() throws {
    var hits: [String] = []
    for (path, text) in try Self.swiftSources() {
      for (number, line) in text.components(separatedBy: "\n").enumerated() where line.contains("inkFaint") {
        hits.append("\(path):\(number + 1)")
      }
    }
    #expect(hits.isEmpty, "\(hits.count) lines name inkFaint: \(hits.joined(separator: ", "))")
  }

  @Test("each file that held inkFaint reads its t3 and t4 inks in the table's order")
  func inksInOrder() throws {
    var read: [String: String] = [:]
    for (path, text) in try Self.swiftSources() where Self.inks[path] != nil {
      let code = text.components(separatedBy: "\n").filter {
        !$0.trimmingCharacters(in: .whitespaces).hasPrefix("//")
      }
      read[path] = code.flatMap { Self.tiers(in: $0) }.joined(separator: " ")
    }
    #expect(read == Self.inks)
  }
}
