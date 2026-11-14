import Foundation
import Testing

@testable import FieldHome

/// MA-5a — the warm app (MA §5.7): ten minutes after the person leaves it, one at a time (`WEB_VIEWS: 1`).
@Suite("MA-5a — the warm app")
struct AppWarmTests {
  let start = ContinuousClock().now

  @Test("one web view, ten minutes")
  func numbers() {
    #expect(AppWarm.views == 1)
    #expect(AppWarm.keep == .seconds(600))
  }

  @Test("an open app is warm; nothing else is")
  func open() {
    var warm = AppWarm()
    #expect(!warm.isWarm("a", now: start))
    warm.opened("a")
    #expect(warm.isWarm("a", now: start))
    #expect(!warm.isWarm("b", now: start))
  }

  @Test("left, it stays warm for ten minutes and not a moment more")
  func left() {
    var warm = AppWarm()
    warm.opened("a")
    warm.left(at: start)
    #expect(warm.isWarm("a", now: start + .seconds(599)))
    #expect(!warm.isWarm("a", now: start + .seconds(600)))
    warm.expire(now: start + .seconds(599))
    #expect(warm.appKey == "a")
    warm.expire(now: start + .seconds(600))
    #expect(warm.appKey == nil)
  }

  @Test("opening another replaces the warm one; reopening it starts its ten minutes over")
  func replaced() {
    var warm = AppWarm()
    warm.opened("a")
    warm.left(at: start)
    warm.opened("b")
    #expect(!warm.isWarm("a", now: start))
    #expect(warm.isWarm("b", now: start + .seconds(3600)))
    warm.left(at: start + .seconds(10))
    warm.left(at: start + .seconds(500))
    #expect(warm.leftAt == start + .seconds(10))
  }
}
