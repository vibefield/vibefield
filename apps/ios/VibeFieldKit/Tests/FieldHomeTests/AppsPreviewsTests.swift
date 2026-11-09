import Foundation
import Testing

@testable import FieldHome

/// MA-6e — the previews this phone holds, by digest: asked once, kept on the phone, gone at sign-out. A digest comes from
/// a desktop, so it is never a path. A real fetch over the tailnet is a device row owed beside P6.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@MainActor
@Suite("MA-6e — the previews on this phone")
struct AppsPreviewsTests {
  private static let digest = "ab12cd34"
  private static let url = "https://desk.example/previews/one/thumbnail.jpg?v=ab12cd34"
  private static let bytes = Data([1, 2, 3])

  private struct Offline: Error {}

  private actor Asked {
    private(set) var urls: [URL] = []

    func add(_ url: URL) { urls.append(url) }
  }

  private static func directory() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("ma6e-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  private static func answering(_ asked: Asked) -> AppsPreviews.Fetch {
    let answer = bytes
    return { url in
      await asked.add(url)
      return answer
    }
  }

  private static func files(in directory: URL) throws -> [String] {
    try FileManager.default.contentsOfDirectory(atPath: directory.path)
  }

  @Test("a preview is asked once and held by its digest")
  func askedOnce() async throws {
    let asked = Asked()
    let previews = AppsPreviews(directory: try Self.directory(), fetch: Self.answering(asked))
    await previews.want(digest: Self.digest, url: Self.url)
    await previews.want(digest: Self.digest, url: Self.url)
    let held = previews.images[Self.digest]
    #expect(held == Self.bytes)
    let urls = await asked.urls
    #expect(urls.count == 1)
  }

  @Test("a preview kept on the phone is read back without asking")
  func survivesTheApp() async throws {
    let directory = try Self.directory()
    let first = AppsPreviews(directory: directory, fetch: Self.answering(Asked()))
    await first.want(digest: Self.digest, url: Self.url)
    let asked = Asked()
    let second = AppsPreviews(directory: directory, fetch: Self.answering(asked))
    await second.want(digest: Self.digest, url: Self.url)
    let held = second.images[Self.digest]
    #expect(held == Self.bytes)
    let urls = await asked.urls
    #expect(urls.isEmpty)
  }

  @Test("a failed fetch leaves the fallback and is not asked again in this run")
  func failureIsNotRetried() async throws {
    let asked = Asked()
    let fetch: AppsPreviews.Fetch = { url in
      await asked.add(url)
      throw Offline()
    }
    let previews = AppsPreviews(directory: try Self.directory(), fetch: fetch)
    await previews.want(digest: Self.digest, url: Self.url)
    await previews.want(digest: Self.digest, url: Self.url)
    let held = previews.images[Self.digest]
    #expect(held == nil)
    let urls = await asked.urls
    #expect(urls.count == 1)
  }

  @Test("with no session yet nothing is asked and nothing counts as failed")
  func noSessionYet() async throws {
    let previews = AppsPreviews(directory: try Self.directory())
    await previews.want(digest: Self.digest, url: Self.url)
    let asked = Asked()
    previews.fetch = Self.answering(asked)
    await previews.want(digest: Self.digest, url: Self.url)
    let held = previews.images[Self.digest]
    #expect(held == Self.bytes)
  }

  @Test("a digest that is not hex is never a path")
  func digestIsNotAPath() async throws {
    let directory = try Self.directory()
    let asked = Asked()
    let previews = AppsPreviews(directory: directory, fetch: Self.answering(asked))
    await previews.want(digest: "../../escape", url: Self.url)
    let urls = await asked.urls
    #expect(urls.isEmpty)
    #expect(previews.images.isEmpty)
    let written = try Self.files(in: directory)
    #expect(written.isEmpty)
    await previews.want(digest: Self.digest, url: Self.url)
    let held = previews.images[Self.digest]
    #expect(held == Self.bytes)
  }

  @Test("sign-out takes the previews off the phone")
  func signedOut() async throws {
    let directory = try Self.directory()
    let previews = AppsPreviews(directory: directory, fetch: Self.answering(Asked()))
    await previews.want(digest: Self.digest, url: Self.url)
    let before = try Self.files(in: directory)
    #expect(before.isEmpty == false)
    previews.signedOut()
    #expect(previews.images.isEmpty)
    let after = try Self.files(in: directory)
    #expect(after.isEmpty)
  }
}
