import Foundation
import Testing

@testable import FieldProduct

struct WebSocketPongTests {
  @Test func aLateErrorCannotReplaceAPong() async throws {
    try await withCheckedThrowingContinuation { continuation in
      let pong = WebSocketPong(continuation)
      pong.finish(nil)
      pong.finish(URLError(.networkConnectionLost))
    }
  }

  @Test func aLaterCompletionPreservesTheOriginalError() async {
    let original = URLError(.networkConnectionLost)
    await #expect(throws: original) {
      try await withCheckedThrowingContinuation { continuation in
        let pong = WebSocketPong(continuation)
        pong.finish(original)
        pong.finish(URLError(.cancelled))
        pong.finish(nil)
      }
    }
  }

  @Test func simultaneousCallbacksResumeOnce() async throws {
    try await withCheckedThrowingContinuation { continuation in
      let pong = WebSocketPong(continuation)
      DispatchQueue.concurrentPerform(iterations: 16) { _ in pong.finish(nil) }
    }
  }
}
