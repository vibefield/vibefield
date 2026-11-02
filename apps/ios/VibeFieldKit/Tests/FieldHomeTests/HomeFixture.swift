import FieldProduct
import Foundation

// PG-4s — the Godview views' bytes, in THIS bundle (FieldHomeTests' `Fixtures/`): PG-3a's witness, which every view
// suite replays, and the goldens the views are held to. The twin of FieldMeshTests' `MeshFixture`, because a test
// target cannot read another target's bundle (`Tests/FieldMeshTests/RemoteRows.swift:6-7`). It reads FieldProduct
// alone, so a view suite that needs only the bytes runs on the host inner loop too.

enum HomeFixture {
  /// The instant the witness is applied at: the body suite's (`RemoteRows.now`).
  static let now = "2026-11-01T00:00:00.000Z"

  /// `Fixtures/<name>.json`, parsed.
  static func json(_ name: String) throws -> JSONValue {
    guard
      let url = Bundle.module.url(
        forResource: name, withExtension: "json", subdirectory: "Fixtures")
    else { throw MissingFixture(name: name) }
    return try JSONValue.parse(try Data(contentsOf: url))
  }

  /// The witness open applied through `RemoteMeshCopy` as FieldLink drives it (open, then publish), and the window's
  /// rows it draws: where every view lane's harness starts (`PhoneBodyParityTests`' path).
  static func witnessRows(now: String = HomeFixture.now) throws -> [RemoteFieldRow] {
    let open = try AgentRemoteMeshOpen(json: try json("agent-remote-mesh-open.witness"))
    var copy = RemoteMeshCopy()
    _ = copy.open(open, now: now)
    _ = copy.publish()
    return copy.drawn()
  }

  struct MissingFixture: Error, CustomStringConvertible {
    let name: String
    var description: String { "fixture `\(name).json` is not in the FieldHomeTests bundle" }
  }
}
