import FieldProduct
import Foundation

// SP-7b's 7b-2b, the RED's stubs: the shapes the tests compile against, answering nothing true.

public enum HistoryProjection {
  public static let textChars = 2_000
  public static let objectChars = 200

  static func row(entry: JSONValue) -> IndexTimelineRow? { nil }

  static func rowJSON(entry: JSONValue) -> JSONValue? { .object([:]) }

  static func firstLine(_ text: String) -> String { "" }

  static func clip(_ text: String, _ max: Int) -> (text: String, clipped: Bool) { ("", false) }
}

struct HistoryProjectionCache<Entry: Equatable, Row> {
  private(set) var projections = 0

  init() {}

  mutating func rows(
    of entries: [Entry], id: (Entry) -> String, project: (Entry) -> Row?
  ) -> [Row] {
    []
  }
}
