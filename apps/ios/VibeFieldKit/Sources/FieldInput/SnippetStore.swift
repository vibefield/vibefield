import Foundation
import Observation

/// A saved command or prompt.
///
/// `sendsEnter` is the whole reason a snippet is more than a string: `git
/// status` wants running and a half-typed `ssh ` wants finishing, and the
/// difference has to be decided when the snippet is WRITTEN rather than
/// guessed at when it is tapped. The sheet marks it with a `⏎` so the
/// difference is visible before the tap, not after.
public struct Snippet: Codable, Identifiable, Equatable, Sendable {
  public let id: UUID
  public var title: String
  public var text: String
  public var sendsEnter: Bool

  public init(id: UUID = UUID(), title: String, text: String, sendsEnter: Bool) {
    self.id = id
    self.title = title
    self.text = text
    self.sendsEnter = sendsEnter
  }

  /// What the row shows under the title — the first line, which is what a
  /// person recognizes a command by.
  public var firstLine: String {
    text.split(separator: "\n", omittingEmptySubsequences: false).first.map(String.init) ?? ""
  }
}

/// The snippets, in `UserDefaults`.
///
/// **Why `UserDefaults` and not the Keychain.** A snippet is a command the user
/// wrote down, not a credential: the write key lives in the Keychain because a
/// grant to one device must not ride iCloud to the others, and nothing here is
/// a grant. It is also why nothing seeds this store — a shipped snippet is the
/// app guessing at someone's shell, and the empty state says so in words
/// instead (D-i6: an absence is honest, never a greyed-out row).
///
/// The defaults suite is injected so a test can round-trip a real store rather
/// than a fake one — the encoder, the key and the decode path are exactly what
/// ships, which is the half of persistence that actually breaks.
@MainActor
@Observable
public final class SnippetStore {

  /// The one key. Namespaced like every other preference this app writes.
  public static let defaultsKey = "vf.input.snippets"

  public private(set) var snippets: [Snippet] = []

  @ObservationIgnored private let defaults: UserDefaults

  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    self.snippets = Self.decode(defaults.data(forKey: Self.defaultsKey))
  }

  /// Newest first: the thing you just wrote down is the thing you are about to
  /// use.
  public func add(_ snippet: Snippet) {
    snippets.insert(snippet, at: 0)
    save()
  }

  public func update(_ snippet: Snippet) {
    guard let index = snippets.firstIndex(where: { $0.id == snippet.id }) else { return }
    snippets[index] = snippet
    save()
  }

  public func delete(_ snippet: Snippet) {
    snippets.removeAll { $0.id == snippet.id }
    save()
  }

  public func delete(atOffsets offsets: IndexSet) {
    snippets.remove(atOffsets: offsets)
    save()
  }

  private func save() {
    guard let data = try? JSONEncoder().encode(snippets) else { return }
    defaults.set(data, forKey: Self.defaultsKey)
  }

  /// A defaults value written by an older build — or by nothing at all — is an
  /// empty list rather than a crash. The tolerant-reader law, one store down.
  private static func decode(_ data: Data?) -> [Snippet] {
    guard let data else { return [] }
    return (try? JSONDecoder().decode([Snippet].self, from: data)) ?? []
  }
}
