import Foundation
import Testing

@testable import FieldMesh

/// TS-7b — the phone code, read from the contracts' OWN vector (copied in;
/// `pnpm check:ios-fixtures` keeps it byte-identical): every code the
/// TypeScript parser reads, this one reads to the same login and Mac, and
/// every text it refuses, this one refuses in the same word (EL9).
@Suite("the phone code reads the contracts' vector exactly as TypeScript does")
struct PhoneCodeVectorTests {
  struct Vector: Decodable {
    struct Limits: Decodable { let text: Int; let login: Int; let from: Int }
    struct Code: Decodable { let text: String; let login: String; let from: String; let why: String }
    struct Refused: Decodable { let text: String; let why: String }
    let prefix: String
    let limits: Limits
    let codes: [Code]
    let refused: [Refused]
  }

  private func vector() throws -> Vector {
    let url = try #require(
      Bundle.module.url(forResource: "phone-code.vector", withExtension: "json", subdirectory: "Fixtures"))
    return try JSONDecoder().decode(Vector.self, from: Data(contentsOf: url))
  }

  @Test("the prefix and the bounds are the contract's")
  func bounds() throws {
    let vector = try vector()
    #expect(vector.prefix == "\(PhoneCode.scheme)://\(PhoneCode.host)")
    #expect(vector.limits.text == PhoneCode.maxText)
    #expect(vector.limits.login == PhoneCode.maxLogin)
    #expect(vector.limits.from == PhoneCode.maxFrom)
  }

  @Test("every code reads to its login and its Mac")
  func codes() throws {
    let vector = try vector()
    #expect(vector.codes.count >= 9)
    for row in vector.codes {
      #expect(PhoneCode.parse(row.text) == .success(PhoneCode(login: row.login, from: row.from)), "\(row.why)")
    }
  }

  @Test("every refusal is refused in the same word")
  func refusals() throws {
    let vector = try vector()
    #expect(vector.refused.count >= 24)
    for row in vector.refused {
      let refusal = PhoneCode.Refusal(rawValue: row.why)
      #expect(refusal != nil, "\(row.why) is a word the Swift parser does not have")
      #expect(PhoneCode.parse(row.text) == .failure(refusal ?? .notACode), "\(row.text.prefix(72))")
    }
  }
}
