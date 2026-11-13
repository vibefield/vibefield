import Foundation
import Testing

@testable import FieldHistory

/// Item 362g — the memory a session's recorded pictures are kept in on the phone: encoded bytes by key, under a
/// bound in bytes, the one used longest ago out first. It is memory only; nothing here touches a disk.
///
/// `get` marks a use, so it changes the store: every row reads into a local first and expects on that.
@Suite("item 362g — the pictures' bounded memory")
struct HistoryPictureStoreTests {
  private func key(_ face: String, session: String = "s1") -> HistoryPictureStore.Key {
    HistoryPictureStore.Key(session: session, face: face)
  }

  private func bytes(_ count: Int, _ fill: UInt8 = 0) -> Data {
    Data(repeating: fill, count: count)
  }

  @Test func whatIsPutIsHeldAndCounted() {
    var store = HistoryPictureStore(limit: 100)
    let first = store.put(bytes(40, 1), for: key("a"))
    let second = store.put(bytes(30, 2), for: key("b"))
    #expect(first.isEmpty)
    #expect(second.isEmpty)
    let a = store.get(key("a"))
    let b = store.get(key("b"))
    let c = store.get(key("c"))
    #expect(a == bytes(40, 1))
    #expect(b == bytes(30, 2))
    #expect(c == nil)
    #expect(store.bytes == 70)
  }

  @Test func aKeyPutAgainIsReplacedAndCountedOnce() {
    var store = HistoryPictureStore(limit: 100)
    store.put(bytes(40, 1), for: key("a"))
    let gone = store.put(bytes(10, 2), for: key("a"))
    #expect(gone.isEmpty)
    let a = store.get(key("a"))
    #expect(a == bytes(10, 2))
    #expect(store.bytes == 10)
  }

  @Test func theOneUsedLongestAgoGoesFirst() {
    var store = HistoryPictureStore(limit: 100)
    store.put(bytes(40), for: key("a"))
    store.put(bytes(40), for: key("b"))
    // a is read, so b is now the one used longest ago
    _ = store.get(key("a"))
    let gone = store.put(bytes(40), for: key("c"))
    #expect(gone == [key("b")])
    let a = store.get(key("a"))
    let b = store.get(key("b"))
    let c = store.get(key("c"))
    #expect(a != nil)
    #expect(b == nil)
    #expect(c != nil)
    #expect(store.bytes == 80)
  }

  @Test func itLetsGoUntilItIsUnderItsBound() {
    var store = HistoryPictureStore(limit: 100)
    for name in ["a", "b", "c", "d"] { store.put(bytes(25), for: key(name)) }
    #expect(store.bytes == 100, "at the bound exactly, all four are held")
    let gone = store.put(bytes(60), for: key("e"))
    #expect(gone == [key("a"), key("b"), key("c")])
    #expect(store.bytes == 85)
    #expect(store.bytes <= 100)
  }

  @Test func whatIsLargerThanTheWholeBoundIsNotKept() {
    var store = HistoryPictureStore(limit: 100)
    store.put(bytes(40), for: key("a"))
    let gone = store.put(bytes(101), for: key("big"))
    #expect(gone == [key("big")])
    let big = store.get(key("big"))
    let a = store.get(key("a"))
    #expect(big == nil)
    #expect(a != nil, "what was held is not let go for bytes that cannot be kept")
    #expect(store.bytes == 40)
  }

  @Test func aSessionsPicturesGoTogether() {
    var store = HistoryPictureStore(limit: 100)
    store.put(bytes(10), for: key("a", session: "s1"))
    store.put(bytes(10), for: key("a", session: "s2"))
    store.put(bytes(10), for: key("b", session: "s1"))
    store.remove(session: "s1")
    let first = store.get(key("a", session: "s1"))
    let second = store.get(key("b", session: "s1"))
    let other = store.get(key("a", session: "s2"))
    #expect(first == nil)
    #expect(second == nil)
    #expect(other != nil)
    #expect(store.bytes == 10)
  }

  @Test func clearLeavesNothingAndTheStoreHoldsAgainAfter() {
    var store = HistoryPictureStore(limit: 100)
    store.put(bytes(40), for: key("a"))
    let before = store.get(key("a"))
    #expect(before != nil)
    store.clear()
    let after = store.get(key("a"))
    #expect(after == nil)
    #expect(store.bytes == 0)
    store.put(bytes(40), for: key("a"))
    #expect(store.bytes == 40)
  }
}
