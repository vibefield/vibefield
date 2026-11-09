import Foundation
import Observation

// MA-6e — the previews this phone holds, by digest (MA-D10 B; VF-PM's Q6): fetched through the node's URL session from
// the app's own desktop, kept on the phone, and gone at sign-out. A real fetch over the tailnet is a device row owed
// beside P6.

@MainActor
@Observable
final class AppsPreviews {
  /// One fetch of an image's bytes.
  typealias Fetch = @Sendable (URL) async throws -> Data

  /// The bytes held, by digest.
  private(set) var images: [String: Data] = [:]

  /// nil until the node's session exists: nothing is asked, and nothing counts as failed.
  @ObservationIgnored var fetch: Fetch?

  private let directory: URL?
  /// Asked in this run, so a failure is not asked again and two icons of one app ask once.
  @ObservationIgnored private var asked = Set<String>()

  /// A digest comes from a desktop, and it names a file here: hex only, and of a digest's length at most.
  private static let maxDigest = 128

  init(directory: URL?, fetch: Fetch? = nil) {
    self.directory = directory
    self.fetch = fetch
  }

  private static func isDigest(_ digest: String) -> Bool {
    !digest.isEmpty && digest.count <= maxDigest && digest.allSatisfy(\.isHexDigit)
  }

  private func file(_ digest: String) -> URL? {
    directory?.appendingPathComponent("\(digest).jpg")
  }

  /// Asks for one preview once: from the disk first, then the desktop. A failure is not asked again in this run; the
  /// icon stays its fallback.
  func want(digest: String, url: String) async {
    guard Self.isDigest(digest), images[digest] == nil, !asked.contains(digest) else { return }
    asked.insert(digest)
    let stored = file(digest)
    if let stored, let kept = await Self.read(stored) {
      images[digest] = kept
      return
    }
    guard let fetch, let address = URL(string: url) else {
      asked.remove(digest)
      return
    }
    guard let bytes = try? await fetch(address) else { return }
    images[digest] = bytes
    if let stored { await Self.write(bytes, to: stored) }
  }

  private nonisolated static func read(_ file: URL) async -> Data? {
    try? Data(contentsOf: file)
  }

  private nonisolated static func write(_ bytes: Data, to file: URL) async {
    try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? bytes.write(to: file, options: .atomic)
  }

  /// Sign-out: the previews go from the phone.
  func signedOut() {
    images = [:]
    asked = []
    guard let directory else { return }
    let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
    for name in names {
      try? FileManager.default.removeItem(at: directory.appendingPathComponent(name))
    }
  }
}
