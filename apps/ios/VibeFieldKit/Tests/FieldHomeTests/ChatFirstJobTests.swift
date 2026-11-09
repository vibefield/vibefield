import Testing

@testable import FieldHome

/// ES-5d (track ES; ES-D2 A; DESIGN.md §8 "The New spark sheet", Its first job; the Mac's `chat-first-job.test.tsx`) — a
/// starter on the night opens the sheet carrying itself. The job is handed over only after the hatch, and sent once.
@Suite("ES-5d — a first job is sent once, after the hatch")
@MainActor
struct ChatFirstJobTests {
  @Test("a carried job is taken once")
  func takenOnce() {
    let feed = ChatFeed()
    feed.carry("Keep track of my agents", to: "sp-a")
    #expect(feed.takeFirstJob(of: "sp-a") == "Keep track of my agents")
  }

  @Test("once taken, it is gone")
  func goneOnceTaken() {
    let feed = ChatFeed()
    feed.carry("Keep track of my agents", to: "sp-a")
    _ = feed.takeFirstJob(of: "sp-a")
    #expect(feed.takeFirstJob(of: "sp-a") == nil)
  }

  @Test("each spark holds its own")
  func eachItsOwn() {
    let feed = ChatFeed()
    feed.carry("one", to: "sp-a")
    feed.carry("two", to: "sp-b")
    #expect(feed.takeFirstJob(of: "sp-b") == "two")
  }

  @Test("a spark no job was carried to has none")
  func noneCarried() {
    #expect(ChatFeed().takeFirstJob(of: "sp-a") == nil)
  }

  @Test("says the words DESIGN.md records (§8, §9)")
  func words() {
    #expect(NewSparkWords.firstJob == "Its first job")
    #expect(NewSparkWords.removeFirstJob == "Remove its first job")
  }
}
