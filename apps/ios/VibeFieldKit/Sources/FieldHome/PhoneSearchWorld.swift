import FieldHistory
import FieldMesh
import FieldProduct
import Foundation

/// SE-2 — search's own state while the sheet stands: the scope, and Everything's kind and project. SE-2e (red).
struct SearchState: Equatable {
  var scope: PhoneSearch.Scope = .live
  var kind: FieldHistoryModel.SearchKind = .any
  var project: PhoneSearch.Project?
}

/// SE-2 — the home's world as search reads it, and the sheet's content composed from it. SE-2e (red): every read is
/// empty and every act does nothing.
enum PhoneSearchWorld {
  static func session(_ row: RemoteFieldRow, desks: [PhoneSearch.Desk]) -> PhoneSearch.LiveSession {
    PhoneSearch.LiveSession(
      id: "", title: "", folder: nil, agent: nil, state: .idle, profileSet: nil, device: "", deviceName: "",
      platform: nil, isHome: false, nativeSessionId: nil)
  }

  static func desks(_ desktops: [FieldDesktop], home: String?) -> [PhoneSearch.Desk] { [] }

  static func desks(rows: [RemoteFieldRow]) -> [PhoneSearch.Desk] { [] }

  static func live(
    rows: [RemoteFieldRow], desks: [PhoneSearch.Desk], lens: ProfileLens, lines: [String: [HistoryHit]]
  ) -> PhoneSearch.Live {
    PhoneSearch.Live(sessions: [], desks: [], profiles: [])
  }

  static func runs(_ live: PhoneSearch.Live) -> [String: [String]] { [:] }

  static func content(
    _ state: SearchState, query: String, lens: ProfileLens, live: PhoneSearch.Live,
    answers: [(corpus: HistoryCorpus, groups: [HistoryHitGroup])], latest: HistoryCorpus?,
    agentLabel: (String) -> String
  ) -> SearchSheetContent {
    SearchSheetContent(
      scope: state.scope, terms: [], tokens: [], chips: [], offer: nil, rows: .live([]), empty: nil, foot: "",
      profiles: [])
  }

  static func apply(_ filter: PhoneSearch.Filter, label: String, state: inout SearchState, lens: inout ProfileLens) {}

  static func remove(_ filter: PhoneSearch.Filter, state: inout SearchState, lens: inout ProfileLens) {}

  static func act(_ act: PhoneSearch.EmptyAct, state: inout SearchState, lens: inout ProfileLens) {}

  /// The mock's doors.
  struct Doors: Equatable {
    var lens: String?
    var scope: PhoneSearch.Scope?
    var desk: String?

    static func read(_ arguments: [String]) -> Doors { Doors() }
  }
}
