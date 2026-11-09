import FieldProduct
import Foundation

// MA-6a — what the phone says of one app, the Mac's reading (field-app's `made-apps.ts`), held to it by
// `Tests/FieldHomeTests/Fixtures/made-apps/made-app-facts.golden.json`. The phone asks `artifact.open` nothing before
// MA-5 (VF-PM's Q1, 2026-11-09), so an app's state comes from its row and its desktop's standing alone. Words not in
// DESIGN.md §9 are the desk's provisional ones, owed to James.

enum MadeAppFacts {
  /// §2.5's tone of a state. Every state from a row alone is muted; MA-5's opens bring the others.
  enum Tone: String, Equatable {
    case muted
  }

  /// What the phone says when an app cannot open: its heading and its line.
  struct Why: Equatable {
    let title: String
    let detail: String?
  }

  /// An app's state from its row and its desktop's standing.
  struct State: Equatable {
    let tone: Tone
    let word: String?
    let opens: Bool
    let why: Why?
  }

  /// The order and the day of an app: the serving row's `publishedAt ?? capturedAt ?? 0`.
  static func at(_ row: IndexAppRow) -> Int64 {
    row.publishedAt ?? row.capturedAt ?? 0
  }

  /// The fallback icon's letter (§2.9's exception): the title's first letter or digit, upper case, else the file
  /// name's. Its combining marks ride with it, so "é" written either way is "É".
  static func initial(title: String, filename: String) -> String {
    for words in [title, filename] {
      let scalars = Array(words.precomposedStringWithCanonicalMapping.unicodeScalars)
      guard let start = scalars.firstIndex(where: isLetterOrNumber) else { continue }
      var end = start + 1
      while end < scalars.count, isMark(scalars[end]) { end += 1 }
      var letter = String.UnicodeScalarView()
      letter.append(contentsOf: scalars[start..<end])
      return String(letter).uppercased().precomposedStringWithCanonicalMapping
    }
    return ""
  }

  private static func isLetterOrNumber(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.properties.generalCategory {
    case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
      .decimalNumber, .letterNumber, .otherNumber:
      true
    default:
      false
    }
  }

  private static func isMark(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.properties.generalCategory {
    case .nonspacingMark, .spacingMark, .enclosingMark: true
    default: false
    }
  }

  /// The app's desktop's standing in the answer, by its serving row's device.
  static func source(of row: IndexAppRow, in sources: [IndexAppsSource]) -> IndexAppsSource? {
    sources.first { $0.device == row.device }
  }

  /// Whether this desktop's own apps have not been read from its library yet: its own source's `stale`, until its
  /// first walk completes. A peer's `stale` is a desktop not answering, never this.
  static func selfUnread(_ source: IndexAppsSource) -> Bool {
    source.isSelf && source.state == .stale
  }

  /// Whether an app's desktop is away (DS-L8): its icon is greyed. This desktop still reading its library is not away.
  static func away(_ source: IndexAppsSource?) -> Bool {
    guard let source else { return false }
    return source.state != .live && !selfUnread(source)
  }

  /// The app's preview image over its OWN desktop's `previewsBase`, never stored; nil with no preview or no base.
  static func imageURL(_ row: IndexAppRow, sources: [IndexAppsSource]) -> String? {
    guard let preview = row.preview, let base = source(of: row, in: sources)?.previewsBase else { return nil }
    let root = base.hasSuffix("/") ? base : "\(base)/"
    return "\(root)\(preview.id)/thumbnail.jpg?v=\(preview.digest)"
  }

  /// The host of an app's recorded hosted link, read as data, for "Open in ‹host›".
  static func host(_ hostedUrl: String?) -> String? {
    guard let hostedUrl, let url = URLComponents(string: hostedUrl), url.scheme?.lowercased() == "https",
      let host = url.host, !host.isEmpty
    else { return nil }
    return host.lowercased()
  }

  /// A desktop's name as the field names it, the answering desktop's own word when the roster names none.
  static func desktop(_ source: IndexAppsSource?, here: String) -> String {
    if let name = source?.name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty { return name }
    return source?.isSelf == true ? here : "Another desktop"
  }

  /// The agent's label through the catalog (R23b): the row's provider is a catalog id, compared to the catalog's own.
  static func agentLabel(_ row: IndexAppRow, catalog: [AgentCatalogRow]) -> String? {
    guard let provider = row.provider else { return nil }
    return catalog.first { $0.id == provider }?.label
  }

  /// The order: the desktop's standing (DS-L8), then the page's availability, then whether its desktop can write it out.
  static func state(_ row: IndexAppRow, source: IndexAppsSource?, desktop: String) -> State {
    switch source?.state {
    case .some(.asleep):
      return muted(
        "asleep", opens: false,
        Why(title: "\(desktop) is asleep", detail: "This app runs on \(desktop). It opens when \(desktop) wakes."))
    case .some(.stale):
      if let source, selfUnread(source) { break }
      return muted(
        "not answering", opens: false, Why(title: "Can't reach \(desktop)", detail: "It isn't answering."))
    case .some(.incompatible):
      return muted(
        "another build", opens: false,
        Why(title: "\(desktop) runs another build of VibeField", detail: "Its apps open here once it's updated."))
    default:
      break
    }
    switch row.availability {
    case .notCaptured, .missing, .changedDuringRead:
      return muted("not kept", opens: false, Why(title: "This page wasn't kept", detail: nil))
    case .tooLarge:
      return muted("too large", opens: false, Why(title: "Too large to keep", detail: nil))
    case .unsupported:
      return muted("can't be kept", opens: false, Why(title: "This page can't be kept", detail: nil))
    case .unknown:
      return muted("unknown", opens: false, Why(title: "This app can't open here yet", detail: nil))
    case .captured:
      break
    }
    guard row.openable else {
      return muted(
        "not written out yet", opens: false, Why(title: "\(desktop) can't write this app out yet", detail: nil))
    }
    return muted(nil, opens: true, nil)
  }

  private static func muted(_ word: String?, opens: Bool, _ why: Why?) -> State {
    State(tone: .muted, word: word, opens: opens, why: why)
  }
}
