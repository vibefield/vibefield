import Testing

@testable import FieldDesign

/// The phone's copy of the deal (IOS-8a, AP-D2): every golden below was
/// computed from the desktop's own code — `packages/contracts/src/user-face.ts`
/// through `node --experimental-strip-types` for the deck, the hash and the
/// deal; `packages/design-kit/src/face.tsx`'s formulas for the tilt and the
/// edge — so a drift on either plane is a red here rather than two faces for
/// one person.
@Suite("the deck deals the same face on both planes")
struct FaceDeckTests {
  @Test("the deck is the contracts' 48, in order, each face once")
  func theDeck() {
    #expect(FaceDeck.all.count == 48)
    #expect(FaceDeck.all.first == "🦊")
    #expect(FaceDeck.all[12] == "🐳")
    #expect(FaceDeck.all.last == "🧪")
    #expect(Set(FaceDeck.all.map(FaceDeck.key)).count == 48)
  }

  @Test("FNV-1a over UTF-16 code units, the same bits as Math.imul")
  func theHash() {
    #expect(FaceDeck.fnv1a32("") == 0x811c_9dc5)
    #expect(FaceDeck.fnv1a32("a") == 0xe40c_292c)
    #expect(FaceDeck.fnv1a32("james") == 0xb00b_1beb)
    #expect(FaceDeck.fnv1a32("01J8F2ZQ9K3M4N5P6Q7R8S9T0V") == 0xc4a4_414c)
    #expect(FaceDeck.fnv1a32("me@jamesyong42.com") == 0xfac9_e3a9)
  }

  @Test("a deal starts at the seed's hash and walks past what is held")
  func theDeal() {
    let ulid = "01J8F2ZQ9K3M4N5P6Q7R8S9T0V"
    #expect(FaceDeck.deal(seed: ulid) == "🐳")
    #expect(FaceDeck.deal(seed: ulid, taken: ["🐳"]) == "🦋")
    // All 48 held: the starting face, honest and never a blank.
    #expect(FaceDeck.deal(seed: ulid, taken: FaceDeck.all) == "🐳")
    #expect(FaceDeck.deal(seed: "me@jamesyong42.com") == "🐌")
  }

  @Test("a presentation selector does not make a second face")
  func theKey() {
    #expect(FaceDeck.key("🐿️") == "🐿")
    #expect(FaceDeck.key("🐿️").unicodeScalars.count == 1)
    #expect(FaceDeck.deal(seed: "x", taken: ["🐿"]) != "🐿️" || FaceDeck.deal(seed: "x") != "🐿️")
  }

  @Test("the tilt is ±2–5° from 40 pt, straight below, and stable per seed")
  func theTilt() {
    #expect(FaceDeck.tilt(seed: "01J8F2ZQ9K3M4N5P6Q7R8S9T0V", size: 34) == 0)
    #expect(FaceDeck.tilt(seed: "01J8F2ZQ9K3M4N5P6Q7R8S9T0V", size: 40) == -2)
    #expect(FaceDeck.tilt(seed: "me@jamesyong42.com", size: 96) == 3)
    #expect(FaceDeck.tilt(seed: "a", size: 128) == -2)
    for seed in ["b", "c", "d", "e", "studio", "mini"] {
      let magnitude = abs(FaceDeck.tilt(seed: seed, size: 40))
      #expect(magnitude >= 2 && magnitude <= 5)
    }
  }

  @Test("the die-cut edge is 3.2 % of the size, between 1 and 8")
  func theEdge() {
    #expect(FaceDeck.stickerEdge(size: 16) == 1)
    #expect(FaceDeck.stickerEdge(size: 34) == 1)
    #expect(FaceDeck.stickerEdge(size: 40) == 1)
    #expect(FaceDeck.stickerEdge(size: 48) == 2)
    #expect(FaceDeck.stickerEdge(size: 96) == 3)
    #expect(FaceDeck.stickerEdge(size: 128) == 4)
    #expect(FaceDeck.stickerEdge(size: 300) == 8)
  }
}
