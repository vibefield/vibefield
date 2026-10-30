import Foundation
import Testing

@testable import FieldDesign

/// IOS-8f — the deal, read from the contracts' OWN vector (copied in;
/// `pnpm check:ios-fixtures` keeps it byte-identical): the deck, the hash and
/// every deal the desktop's `user-face.ts` computes are the phone's. The
/// rosters' `effectiveFaces` rows are the desktop's alone — the phone deals one
/// face from a seed, and a desktop's own answer (`user.me`) is what overrides it.
@Suite("the phone deals the desktop's deck, hash and deal")
struct FaceDealVectorTests {
  struct Vector: Decodable {
    struct Hash: Decodable { let value: String; let fnv1a32: UInt32 }
    struct Deal: Decodable { let seed: String; let taken: [String]; let face: String }
    let deck: [String]
    let hashes: [Hash]
    let deals: [Deal]
  }

  private func vector() throws -> Vector {
    let url = try #require(
      Bundle.module.url(forResource: "face-deal.vector", withExtension: "json", subdirectory: "Fixtures"))
    return try JSONDecoder().decode(Vector.self, from: Data(contentsOf: url))
  }

  @Test("the deck is the contracts' deck, in order")
  func deck() throws {
    #expect(try vector().deck == FaceDeck.all)
  }

  @Test("FNV-1a over UTF-16 code units, row for row")
  func hashes() throws {
    for row in try vector().hashes {
      #expect(FaceDeck.fnv1a32(row.value) == row.fnv1a32, "\(row.value)")
    }
  }

  @Test("every deal, a face held with a presentation selector included")
  func deals() throws {
    let deals = try vector().deals
    #expect(deals.count >= 6)
    for row in deals {
      #expect(FaceDeck.deal(seed: row.seed, taken: row.taken) == row.face, "\(row.seed)")
    }
  }
}
