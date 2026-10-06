import FieldProduct
import Foundation

/// The contracts' goldens, copied under `Fixtures/` (byte-identical; the gate
/// `pnpm check:ios-fixtures` keeps them so).
enum Fixture {
  static func json(_ name: String) throws -> JSONValue {
    guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures")
    else { throw FixtureError.missing(name) }
    return try JSONValue.parse(try Data(contentsOf: url))
  }

  enum FixtureError: Error, CustomStringConvertible {
    case missing(String)

    var description: String {
      switch self {
      case .missing(let name): "fixture `\(name).json` is not in the test bundle"
      }
    }
  }
}
