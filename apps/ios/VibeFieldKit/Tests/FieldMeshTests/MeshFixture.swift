import FieldProduct
import Foundation

// The contracts' own bytes, in this bundle. Its own file since PG-3e (it lived at the foot of FieldLinkHarness.swift),
// so a suite that needs only the bytes builds without the harness: the body parity suite runs on the host inner loop
// too, where FieldMesh's UIKit and Truffle do not build.

enum MeshFixture {
  static func json(_ name: String) throws -> JSONValue {
    guard
      let url = Bundle.module.url(
        forResource: name, withExtension: "json", subdirectory: "Fixtures")
    else { throw MissingFixture(name: name) }
    return try JSONValue.parse(try Data(contentsOf: url))
  }

  struct MissingFixture: Error, CustomStringConvertible {
    let name: String
    var description: String { "fixture `\(name).json` is not in the FieldMeshTests bundle" }
  }
}
