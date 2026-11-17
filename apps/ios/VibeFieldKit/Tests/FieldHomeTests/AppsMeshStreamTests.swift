#if DEBUG || VF_WEB_RELAY
  import FieldFreeway
  import Foundation
  import Testing

  @testable import FieldHome

  /// Item 522 — the mesh's stream as the page's front carries it: its close passed on once, however often it is asked.
  @Suite("522 — the mesh stream behind an app page's front")
  struct AppsMeshStreamTests {
    final class Counted: FreewayByteStream, @unchecked Sendable {
      private let lock = NSLock()
      private var closes = 0

      var closed: Int { lock.withLock { closes } }

      func read(_ max: Int) async throws -> Data? { nil }
      func write(_ data: Data) async throws {}
      func close() async { lock.withLock { closes += 1 } }
    }

    @Test("closing the front's stream twice closes the mesh's once")
    func closeOnce() async {
      let mesh = Counted()
      let stream = AppsMeshStream(mesh)
      await stream.close()
      await stream.close()
      let closed = mesh.closed
      #expect(closed == 1)
    }
  }
#endif
