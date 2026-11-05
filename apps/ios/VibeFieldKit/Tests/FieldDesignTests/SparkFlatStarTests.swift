import Foundation
import Testing

@testable import FieldDesign

/// IOS-12b (PC-D6 A; DESIGN.md §2.10; VF-PM's Q3) — the flat star the phone draws is design-kit's `flat-star.ts`, held
/// to `spark-flat-star.golden.json` (written beside the DNA golden by
/// `packages/design-kit/scripts/spark-dna-golden.mjs`,
/// held to flat-star.ts by field-app's spark-face test, copied in byte for byte by `pnpm check:ios-fixtures`).
///
/// The eyes are arithmetic and match exactly. The outline goes through `cos` and `sin`, and Darwin's libm and V8's may
/// differ in the last place, which can move a value across a rounding edge of the desktop's three decimals: each
/// number may differ by one step of the last digit (0.001), never more, and the path's commands must be the same.
@Suite("the phone's flat star is design-kit's")
struct SparkFlatStarTests {
  struct Golden: Decodable {
    struct Row: Decodable {
      struct Scaled: Decodable {
        struct Eye: Decodable { let x, y, width, height: Double }
        let faceScale: Double
        let pair: [Eye]
      }
      let seed: UInt32
      let outline: String
      let eyes: [Scaled]
    }
    let faceScales: [Double]
    let seeds: [Row]
  }

  private func golden() throws -> Golden {
    let url = try #require(
      Bundle.module.url(forResource: "spark-flat-star.golden", withExtension: "json", subdirectory: "Fixtures"))
    return try JSONDecoder().decode(Golden.self, from: Data(contentsOf: url))
  }

  /// An SVG path's commands and numbers: "M0.5 -0.4Q…Z" → ["M", "Q", …, "Z"] and every number in order.
  private func parse(_ path: String) -> (commands: [Character], numbers: [Double]) {
    var commands: [Character] = []
    var numbers: [Double] = []
    var token = ""
    func flush() {
      if let value = Double(token) { numbers.append(value) }
      token = ""
    }
    for character in path {
      if character.isLetter {
        flush()
        commands.append(character)
      } else if character == " " {
        flush()
      } else {
        token.append(character)
      }
    }
    flush()
    return (commands, numbers)
  }

  @Test("the outline is flat-star.ts's for every seed: the same curves, each number within the last digit")
  func outline() throws {
    var exact = 0
    let rows = try golden().seeds
    #expect(rows.count == 24)
    for row in rows {
      let dna = SparkEngine.agentDNA(row.seed)
      let star = SparkFlatStar(
        body: SparkEngine.makeBody(row.seed, dna.body), eyes: SparkEngine.makeEyes(row.seed, dna.eyes))
      let path = star.svgPath
      if path == row.outline { exact += 1 }
      let mine = parse(path)
      let theirs = parse(row.outline)
      #expect(mine.commands == theirs.commands, "seed \(row.seed)")
      #expect(mine.numbers.count == theirs.numbers.count, "seed \(row.seed)")
      for (a, b) in zip(mine.numbers, theirs.numbers) {
        #expect(abs(a - b) <= 0.001 + 1e-9, "seed \(row.seed): \(a) against \(b)")
      }
    }
    // said, not required: how many paths matched to the character
    print("SparkFlatStarTests: \(exact) of \(rows.count) outlines match flat-star.ts character for character")
  }

  @Test("the eyes are flat-star.ts's at every face scale the phone draws")
  func eyes() throws {
    let golden = try golden()
    #expect(golden.faceScales == [1, 1.12, 1.25])
    for row in golden.seeds {
      let dna = SparkEngine.agentDNA(row.seed)
      let eyes = SparkEngine.makeEyes(row.seed, dna.eyes)
      for scaled in row.eyes {
        let pair = SparkFlatStar.eyes(eyes, faceScale: scaled.faceScale)
        #expect(pair.count == 2 && scaled.pair.count == 2)
        for (mine, theirs) in zip(pair, scaled.pair) {
          #expect(
            mine.x == theirs.x && mine.y == theirs.y && mine.width == theirs.width && mine.height == theirs.height,
            "seed \(row.seed) at \(scaled.faceScale)")
        }
      }
    }
  }

  @Test("the face scale is the desktop's: 1.25 to 32, 1.12 to 48, 1 above")
  func faceScale() {
    #expect(SparkFlatStar.faceScale(size: 22) == 1.25)
    #expect(SparkFlatStar.faceScale(size: 32) == 1.25)
    #expect(SparkFlatStar.faceScale(size: 48) == 1.12)
    #expect(SparkFlatStar.faceScale(size: 120) == 1)
  }

  @Test("the desktop's rounding: to three places, a half toward +∞, and no negative zero")
  func rounding() {
    #expect(SparkFlatStar.rounded(0.0005) == 0.001)
    #expect(SparkFlatStar.rounded(-0.0005) == 0)
    #expect(SparkFlatStar.rounded(-0.0005).sign == .plus)
    #expect(SparkFlatStar.number(1.0) == "1")
    #expect(SparkFlatStar.number(-0.0) == "0")
    #expect(SparkFlatStar.number(-0.492) == "-0.492")
  }
}
