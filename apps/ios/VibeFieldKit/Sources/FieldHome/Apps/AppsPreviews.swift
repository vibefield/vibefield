import Foundation
import Observation

// MA-6e — the previews this phone holds, by digest (MA-D10 B; VF-PM's Q6): fetched through the node's URL session from
// the app's own desktop, kept on the phone, and gone at sign-out. A real fetch over the tailnet is a device row owed
// beside P6. RED: every answer below is a stub.

@MainActor
@Observable
final class AppsPreviews {
  /// One fetch of an image's bytes.
  typealias Fetch = @Sendable (URL) async throws -> Data

  /// The bytes held, by digest.
  private(set) var images: [String: Data] = [:]

  /// nil until the node's session exists: nothing is asked, and nothing counts as failed.
  @ObservationIgnored var fetch: Fetch?

  init(directory: URL?, fetch: Fetch? = nil) {
    self.fetch = fetch
  }

  /// Asks for one preview once: from the disk first, then the desktop. A failure is not asked again in this run; the
  /// icon stays its fallback.
  func want(digest: String, url: String) async {}

  /// Sign-out: the previews go from the phone.
  func signedOut() {}
}
