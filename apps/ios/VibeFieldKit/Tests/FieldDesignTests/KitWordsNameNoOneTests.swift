import Foundation
import Testing

/// Item 533 (asked for 2026-11-18) — the kit's own words name no person, no session and no one who ruled: its comments
/// and its rows' display names say the item and the day instead. Test data is not words: a fixture keeps an older name
/// until it next moves (DESIGN.md "The made-up names"), so a string literal of code is never read here.
///
/// The row reads every Swift file of the kit's Sources and Tests and of the app, and the iOS scripts, each once as
/// bytes, in a detached task. It walks line by line only the files that hold a refused word. On a Swift line it reads
/// the comment and an `@Test` or `@Suite` display name; a script's every line is words. It prints its own time.
@Suite("the kit's words name no person, no session and no one who ruled")
struct KitWordsNameNoOneTests {
  /// The words refused, exactly. Each is built from pieces, so this file passes itself. The word for a ruling is
  /// refused after a possessive (one named as having made it) and before a number (`… 7`, `…s 17 and 18`), never
  /// alone. A lane's or a session's name other than these is not held: no such name is one exact word.
  static let refused: [String] = ["Ja" + "mes", "VF" + "-PM", "'s rul" + "ing", "session q" + "a-0"]
  static let numbered = "rul" + "ing"

  /// The kit's folder, the one that holds this file's `Tests/FieldDesignTests/`, and the iOS folder above it, which
  /// holds the app's folder and the scripts.
  static let kit = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  static let ios = kit.deletingLastPathComponent()
  static let roots: [(url: URL, ext: String)] = [
    (kit.appendingPathComponent("Sources"), "swift"), (kit.appendingPathComponent("Tests"), "swift"),
    (ios.appendingPathComponent("App"), "swift"), (ios.appendingPathComponent("scripts"), "sh"),
  ]

  /// What the row finds: the files it read, the files it walked, and each line whose words name someone.
  struct Scan: Sendable {
    var files = 0
    var walked = 0
    var named: [String] = []
  }

  /// The refused word a piece of text holds, or nil.
  static func refusedWord(in text: Substring) -> String? {
    if let word = refused.first(where: { text.contains($0) }) { return word }
    var rest = text[...]
    while let range = rest.range(of: numbered) {
      var after = rest[range.upperBound...]
      if after.first == "s" { after = after.dropFirst() }
      if after.first == " ", let digit = after.dropFirst().first, digit.isNumber {
        return numbered + " " + String(digit)
      }
      rest = rest[range.upperBound...]
    }
    return nil
  }

  /// The words of one Swift line: a comment line whole; an `@Test` or `@Suite` line whole; otherwise the part after a
  /// `//` that no string literal holds. Nil inside a multi-line string literal, which is data.
  static func words(of line: Substring, inLiteral: inout Bool) -> Substring? {
    let bare = line.drop { $0 == " " || $0 == "\t" }
    let quotes = line.components(separatedBy: "\"\"\"").count - 1
    if inLiteral {
      if quotes % 2 == 1 { inLiteral = false }
      return nil
    }
    if quotes % 2 == 1 {
      inLiteral = true
      return nil
    }
    if bare.hasPrefix("//") || bare.hasPrefix("*") || bare.hasPrefix("/*") { return line }
    if bare.hasPrefix("@Test(") || bare.hasPrefix("@Suite(") { return line }
    var open = false
    var previous: Character = " "
    for index in line.indices {
      let character = line[index]
      if character == "\"" && previous != "\\" { open.toggle() }
      if !open && character == "/" && previous == "/" { return line[index...] }
      previous = character
    }
    return nil
  }

  /// Every file of the roots, read once. A file whose bytes hold no refused word is not walked.
  static func scan() throws -> Scan {
    var scan = Scan()
    let needles = (refused + [numbered]).map { Data($0.utf8) }
    for root in roots {
      let walker = FileManager.default.enumerator(at: root.url, includingPropertiesForKeys: nil)
      while let url = walker?.nextObject() as? URL {
        guard url.pathExtension == root.ext else { continue }
        scan.files += 1
        let data = try Data(contentsOf: url)
        guard needles.contains(where: { data.range(of: $0) != nil }) else { continue }
        scan.walked += 1
        let text = String(decoding: data, as: UTF8.self)
        var inLiteral = false
        for (index, line) in text.split(separator: "\n", omittingEmptySubsequences: false).enumerated() {
          let said = root.ext == "sh" ? line : words(of: line, inLiteral: &inLiteral)
          guard let said, let word = refusedWord(in: said) else { continue }
          scan.named.append("\(url.lastPathComponent):\(index + 1) (\(word))")
        }
      }
    }
    return scan
  }

  @Test("no comment, row name or script line of the kit names a person, a session or who ruled")
  func namesNoOne() async throws {
    let clock = ContinuousClock()
    let start = clock.now
    let scan = try await Task.detached(priority: .utility) { try Self.scan() }.value
    let took = clock.now - start
    let words = (Self.refused + [Self.numbered + "(s) <n>"]).joined(separator: " · ")
    print("KitWordsNameNoOneTests: \(scan.files) files read, \(scan.walked) walked, in \(took); refuses \(words)")
    let named = scan.named
    let shown = named.prefix(40).joined(separator: "; ")
    #expect(scan.files > 700)
    #expect(named.isEmpty, "\(named.count) lines name someone: \(shown)")
  }
}
