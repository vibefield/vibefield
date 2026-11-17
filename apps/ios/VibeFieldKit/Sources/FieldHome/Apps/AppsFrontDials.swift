#if DEBUG || VF_WEB_RELAY
  import FieldFreeway
  import FieldMesh
  import FieldWeb
  import Foundation

  // Item 522 (2026-11-17) — the dials an app page's filtering front carries on with, from the mesh this screen holds:
  // the app's origin over the mesh node's own dial (`MeshModel.peerStream`, its one peer looked up again at every
  // dial), a declared host by the system's own connection (`WebFrontDials`'s default), never the mesh, so the app's
  // own node never carries a declared name into the tailnet (the system's own VPN, when it is up, is item 373's). Nil
  // while the mesh has no runtime: then no page is made.
  enum AppsFrontDials {
    @MainActor
    static func from(_ mesh: MeshModel) async -> WebFrontDials? {
      guard await mesh.urlSessionProvider != nil else { return nil }
      return WebFrontDials(origin: { host, port in
        AppsMeshStream(try await mesh.peerStream(host: host, port: port))
      })
    }
  }

  /// The mesh's stream as the front's: the same three calls, its `close()` passed on once however often it is called.
  final class AppsMeshStream: WebFrontStream, @unchecked Sendable {
    private let stream: any FreewayByteStream
    private let lock = NSLock()
    private var closed = false

    init(_ stream: any FreewayByteStream) {
      self.stream = stream
    }

    func read(_ max: Int) async throws -> Data? { try await stream.read(max) }
    func write(_ data: Data) async throws { try await stream.write(data) }

    func close() async {
      let first = lock.withLock {
        defer { closed = true }
        return !closed
      }
      if first { await stream.close() }
    }
  }
#endif
