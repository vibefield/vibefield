import FieldProduct
import Foundation
import RosettaClient

// SP-7b's 7b-2b, the RED's stubs: the shapes the tests compile against, answering nothing true.

public enum HistoryDirectFallback: Equatable, Sendable {
  case noTicket
  case noPages
  case refused(IndexTicketRefusal)
  case socket

  public var said: String { "" }
}

public struct HistoryDirectPlane {
  public typealias SessionProvider = @Sendable (URLSessionConfiguration) async throws -> URLSession

  let ticket: @MainActor (String) async throws -> FieldProduct.JSONValue
  let session: @MainActor () async -> SessionProvider?
  let sockets: (any RosettaSocketFactory)?
  let renewEvery: Duration
  let openDeadline: Duration

  public init(
    ticket: @escaping @MainActor (String) async throws -> FieldProduct.JSONValue,
    session: @escaping @MainActor () async -> SessionProvider?
  ) {
    self.init(ticket: ticket, session: session, sockets: nil, renewEvery: .seconds(1), openDeadline: .seconds(1))
  }

  init(
    ticket: @escaping @MainActor (String) async throws -> FieldProduct.JSONValue,
    session: @escaping @MainActor () async -> SessionProvider?,
    sockets: (any RosettaSocketFactory)?, renewEvery: Duration, openDeadline: Duration
  ) {
    self.ticket = ticket
    self.session = session
    self.sockets = sockets
    self.renewEvery = renewEvery
    self.openDeadline = openDeadline
  }
}

extension HistoryProjection {
  static func row(entry: TimelineEntry) -> IndexTimelineRow? { nil }
}
