import Foundation

/// IOS-13a (DESIGN.md §8 "The phone's Settings", §9 "The phone's legal words") — the acknowledgements L5's generator
/// writes into the app (its IOS_OUTPUT, `acknowledgements.json`): every part the app links, what it is for, its
/// licence, and the full licence texts, each kept once and named by id. Read once, tolerantly (schema 1; a field this
/// build does not know is kept and named, never refused), and said in one of three states, never as a blank page.
public struct AcknowledgementsDoc: Equatable, Sendable {
  /// One part the app links: a crate, a Go module, a Swift package, an asset, or another library.
  public struct Part: Equatable, Sendable, Identifiable {
    public var ecosystem: String
    public var name: String
    /// Empty when the generator has none to give (an asset adapted by hand).
    public var version: String
    public var licence: String
    /// What it is for, in the generator's words ("the terminal", "the private network", …).
    public var roles: [String]
    /// Its texts, by id, in the order it names them.
    public var texts: [String]
    /// The generator's note on the part, when it sets one (schema 1's optional `note`). Kept; DESIGN.md does not draw
    /// it yet.
    public var note: String? = nil
    /// VibeField's own component, not a third party's (schema 1's optional `own: true`). Kept; not drawn yet.
    public var own: Bool = false
    public var id: String { "\(ecosystem)/\(name)" }
  }

  /// One licence or notice text, kept once however many parts name it.
  public struct LicenceText: Equatable, Sendable, Identifiable {
    public let id: String
    /// "MIT", "Apache-2.0", "Notices", …
    public let kind: String
    /// The files it was read from, as the generator names them.
    public let files: [String]
    public let body: String
  }

  public let parts: [Part]
  public let texts: [String: LicenceText]
  /// Fields this build does not know, by where they stand ("OpenSSL.homepage", "text 2e2b94025b4c.url"), sorted.
  public let unknown: [String]
}

/// What the build carries: L5's file, none (every build before L4's pbxproj bundles it), or one this build cannot
/// read, with the reason said.
public enum AcknowledgementsState: Equatable, Sendable {
  case bundled(AcknowledgementsDoc)
  case absent
  case unreadable(String)
}

public enum Acknowledgements {
  /// The ONE path: L5's IOS_OUTPUT basename, read from the app's own bundle.
  public static let resource = (name: "acknowledgements", ext: "json")
  /// The schema this build reads.
  public static let schema = 1

  /// The app's acknowledgements, read once per run.
  public static let main: AcknowledgementsState = load(bundle: .main)

  public static func load(bundle: Bundle) -> AcknowledgementsState {
    load(url: bundle.url(forResource: resource.name, withExtension: resource.ext))
  }

  public static func load(url: URL?) -> AcknowledgementsState {
    guard let url else { return .absent }
    guard let data = try? Data(contentsOf: url) else { return .unreadable("the file can’t be opened") }
    return parse(data)
  }

  private static let topKeys: Set<String> = ["schema", "note", "pins", "tailscaleKit", "components", "texts"]
  private static let partKeys: Set<String> = [
    "ecosystem", "name", "version", "licence", "roles", "texts", "note", "own",
  ]
  private static let textKeys: Set<String> = ["id", "kind", "files", "body"]

  public static func parse(_ data: Data) -> AcknowledgementsState {
    guard let object = try? JSONSerialization.jsonObject(with: data), let top = object as? [String: Any] else {
      return .unreadable("it isn’t JSON")
    }
    guard let version = top["schema"] as? Int else { return .unreadable("it names no schema") }
    guard version == schema else { return .unreadable("schema \(version), and this build reads \(schema)") }
    guard let components = top["components"] as? [[String: Any]] else { return .unreadable("it lists no parts") }
    guard let rawTexts = top["texts"] as? [[String: Any]] else { return .unreadable("it carries no texts") }

    var unknown = top.keys.filter { !topKeys.contains($0) }
    var parts: [AcknowledgementsDoc.Part] = []
    for component in components {
      guard let name = component["name"] as? String, !name.isEmpty else { return .unreadable("a part has no name") }
      guard let licence = component["licence"] as? String else { return .unreadable("\(name) names no licence") }
      parts.append(
        AcknowledgementsDoc.Part(
          ecosystem: component["ecosystem"] as? String ?? "", name: name,
          version: component["version"] as? String ?? "", licence: licence,
          roles: component["roles"] as? [String] ?? [], texts: component["texts"] as? [String] ?? [],
          note: component["note"] as? String, own: component["own"] as? Bool ?? false))
      unknown += component.keys.filter { !partKeys.contains($0) }.map { "\(name).\($0)" }
    }
    var texts: [String: AcknowledgementsDoc.LicenceText] = [:]
    for raw in rawTexts {
      guard let id = raw["id"] as? String, !id.isEmpty else { return .unreadable("a text has no id") }
      guard let body = raw["body"] as? String else { return .unreadable("text \(id) has no body") }
      if texts[id] == nil {
        texts[id] = AcknowledgementsDoc.LicenceText(
          id: id, kind: raw["kind"] as? String ?? "", files: raw["files"] as? [String] ?? [], body: body)
      }
      unknown += raw.keys.filter { !textKeys.contains($0) }.map { "text \(id).\($0)" }
    }
    return .bundled(AcknowledgementsDoc(parts: parts, texts: texts, unknown: unknown.sorted()))
  }

  // MARK: - The page's decisions

  /// One group of the page: a role, said as a sentence, and its parts by name.
  public struct Group: Equatable, Sendable, Identifiable {
    public let title: String
    public let parts: [AcknowledgementsDoc.Part]
    public var id: String { title }
  }

  /// The roles that lead, in this order (DESIGN.md §8): the terminal, the private network, the terminal's fonts, and
  /// the marks. The generator's other roles follow by name, and a part with no role comes last, under no head.
  static let leadingRoles = [
    "the terminal", "the private network", "the terminal's fonts", "the agents' marks", "the desktops' OS marks",
  ]

  public static func groups(_ doc: AcknowledgementsDoc) -> [Group] {
    let byRole = Dictionary(grouping: doc.parts) { $0.roles.first ?? "" }
    let rest = byRole.keys
      .filter { !$0.isEmpty && !leadingRoles.contains($0) }
      .sorted { $0.lowercased() < $1.lowercased() }
    let order = leadingRoles.filter { byRole[$0] != nil } + rest + (byRole[""] == nil ? [] : [""])
    return order.map { role in
      Group(
        title: SettingsModel.sentence(role),
        parts: byRole[role, default: []].sorted { $0.name.lowercased() < $1.name.lowercased() })
    }
  }

  /// A part's row: its name, its version under it (none when it has none), and its licence as the value.
  public struct Row: Equatable, Sendable {
    public let title: String
    public let detail: String?
    public let value: String
  }

  public static func row(_ part: AcknowledgementsDoc.Part) -> Row {
    Row(title: part.name, detail: part.version.isEmpty ? nil : part.version, value: part.licence)
  }

  /// A part's text as its page draws it: the text, or the id the file does not carry, named (§9), never dropped.
  public enum Resolved: Equatable, Sendable {
    case text(AcknowledgementsDoc.LicenceText)
    case missing(String)
  }

  public static func texts(of part: AcknowledgementsDoc.Part, in doc: AcknowledgementsDoc) -> [Resolved] {
    part.texts.map { id in doc.texts[id].map(Resolved.text) ?? .missing(id) }
  }
}
