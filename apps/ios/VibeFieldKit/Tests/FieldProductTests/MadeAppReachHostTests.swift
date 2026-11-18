import Foundation
import Testing

@testable import FieldProduct

/// Item 525 — a made app's declared host is never an address in another spelling: the contracts' cross-language vector
/// (`made-app-reach-host.vector.json`, its copy held byte-identical by check:ios-fixtures), read by
/// `MadeAppReach.isHost` as the TypeScript check reads it. Its `moved` rows are the ones this item turned from admitted
/// to refused; every other row pins the rule as it already stood.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("525 — a declared host is never an address in another spelling")
struct MadeAppReachHostTests {
  struct Row {
    let host: String
    let why: String
    let moved: Bool
  }

  static func rows(_ list: String) throws -> [Row] {
    let json = try Fixture.json("made-app-reach-host.vector")
    let items = json.objectValue?[list]?.arrayValue ?? []
    return items.compactMap { item in
      guard let fields = item.objectValue, let host = fields["host"]?.stringValue,
        let why = fields["why"]?.stringValue
      else { return nil }
      return Row(host: host, why: why, moved: fields["moved"]?.boolValue ?? false)
    }
  }

  @Test("accepts every host the vector names")
  func hosts() throws {
    let rows = try Self.rows("hosts")
    #expect(rows.count == 5)
    for row in rows {
      let accepted = MadeAppReach.isHost(row.host)
      #expect(accepted, "\(row.host): \(row.why)")
    }
  }

  @Test("refuses every row it refused before this item, as it did")
  func unmoved() throws {
    let rows = try Self.rows("refused").filter { !$0.moved }
    #expect(rows.count == 12)
    for row in rows {
      let accepted = MadeAppReach.isHost(row.host)
      #expect(!accepted, "\(row.host): \(row.why)")
    }
  }

  @Test("refuses a last label of 0x and hex, a bare 0x included")
  func moved() throws {
    let rows = try Self.rows("refused").filter(\.moved)
    #expect(rows.count == 6)
    for row in rows {
      let accepted = MadeAppReach.isHost(row.host)
      #expect(!accepted, "\(row.host): \(row.why)")
    }
  }
}
