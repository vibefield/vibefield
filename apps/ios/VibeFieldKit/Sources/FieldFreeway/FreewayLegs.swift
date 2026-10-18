import FieldProduct
import FieldRoutedTerminal
import Foundation

// F1 (thinking-freeway.md v0.3 §6) — the routed client's terminals over the link. A cell's two legs
// are streams on it (`terminal-leg`): the host dials that cell's loopback door and splices it
// verbatim, so the routed client's hello, its credits and its close codes run unchanged, and a
// stream's end reads as a socket's. The tickets and renewals come from the host's keyring on the
// same link — no fieldd round trip per tap (FW-D1: fieldd approved the link once).

/// Why a leg on the link did not stand.
public enum FreewayLegError: Error, Sendable, Equatable {
  /// The URL is not a `freeway://cell/<boot>/<channel>` leg.
  case notAFreewayLeg
  /// The leg ended: its cell's close code, or nil when the link under it went (a dropped socket).
  case closed(code: Int?)
}

/// A cell's legs as streams on the desktop's link: the routed client's transport for a
/// `freeway://cell/<boot>/<channel>` endpoint. `link` yields the desktop's link — standing, or
/// dialed for this — and throws when there is none to be had; `focus`, when given, classes each
/// frames leg by the cell the person is looking at.
public struct FreewayLegTransport: RoutedLegTransport {
  private let link: @Sendable () async throws -> FreewayLink
  private let focus: FreewayFocus?

  public init(
    focus: FreewayFocus? = nil, link: @escaping @Sendable () async throws -> FreewayLink
  ) {
    self.focus = focus
    self.link = link
  }

  public func connect(to url: URL) async throws -> any RoutedLegConnection {
    guard let leg = RoutedCellEndpoints.freewayLeg(url) else { throw FreewayLegError.notAFreewayLeg }
    let stream = try await link().open(
      .object([
        "kind": .string("terminal-leg"),
        "cellBootId": .string(leg.cellBootId),
        "channel": .string(leg.channel.rawValue),
      ]))
    let classed = leg.channel == .frames ? focus : nil
    await classed?.opened(stream, cell: leg.cellBootId)
    return FreewayLegConnection(stream: stream, focus: classed)
  }
}

/// F1 (thinking-freeway.md v0.3 §5) — which cell's frames ride `live`: the one the person is
/// looking at. Every other cell's frames leg rides `sync`, so a cell seeding behind the card never
/// holds back the one in front of it. The host opens a frames leg `live`, so nothing is said until
/// a focus is, and after it only a leg whose class changes is told (`Priority`).
public actor FreewayFocus {
  private struct Key: Hashable {
    let link: ObjectIdentifier
    let stream: UInt64
  }

  private struct Leg {
    let cell: String
    let stream: FreewayStream
    var live: Bool
  }

  private var focused: String?
  private var legs: [Key: Leg] = [:]

  public init() {}

  /// The cell the person is looking at now.
  public func focus(_ cell: String) async {
    guard cell != focused else { return }
    focused = cell
    for key in legs.keys.sorted(by: { $0.stream < $1.stream }) { await settle(key) }
  }

  func opened(_ stream: FreewayStream, cell: String) async {
    let key = Key(link: ObjectIdentifier(stream.link), stream: stream.id)
    legs[key] = Leg(cell: cell, stream: stream, live: true)
    await settle(key)
  }

  func ended(_ stream: FreewayStream) {
    legs[Key(link: ObjectIdentifier(stream.link), stream: stream.id)] = nil
  }

  private func settle(_ key: Key) async {
    guard var leg = legs[key] else { return }
    let live = focused == nil || leg.cell == focused
    guard live != leg.live else { return }
    leg.live = live
    legs[key] = leg
    // a link that ended took the stream with it, and the leg ends with the stream
    try? await leg.stream.link.priority(stream: leg.stream.id, class: live ? "live" : "sync")
  }
}

/// Each endpoint to the transport its shape names: a freeway leg to the link, any other to
/// `fallback` (the mesh's own URLSession doors, for a desktop that does not serve the freeway).
public struct FreewayRoutedTransport: RoutedLegTransport {
  private let freeway: FreewayLegTransport
  private let fallback: any RoutedLegTransport

  public init(freeway: FreewayLegTransport, fallback: any RoutedLegTransport) {
    self.freeway = freeway
    self.fallback = fallback
  }

  public func connect(to url: URL) async throws -> any RoutedLegConnection {
    if RoutedCellEndpoints.freewayLeg(url) != nil { return try await freeway.connect(to: url) }
    return try await fallback.connect(to: url)
  }
}

/// One leg on a stream. Its one reader is the leg's pump, which asks for frames one at a time.
actor FreewayLegConnection: RoutedLegConnection {
  private let stream: FreewayStream
  private var events: AsyncStream<FreewayStreamEvent>.Iterator
  private var code: Int?
  /// The focus classing this leg while it stands — a frames leg's.
  private var focus: FreewayFocus?

  init(stream: FreewayStream, focus: FreewayFocus? = nil) {
    self.stream = stream
    self.events = stream.events.makeAsyncIterator()
    self.focus = focus
  }

  func send(_ frame: RoutedLegFrame) async throws {
    switch frame {
    case .text(let text): try await stream.send(text: text)
    case .binary(let bytes): try await stream.send(binary: bytes)
    }
  }

  func receive() async throws -> RoutedLegFrame {
    // The iterator's state is the stream's own: a copy advanced here is the iterator advanced, and
    // it advances in this actor's isolation (`next(isolation:)`), never sent out of it.
    var iterator = events
    let event = await iterator.next(isolation: #isolation)
    events = iterator
    switch event {
    case .text(let text): return .text(text)
    case .binary(let bytes): return .binary(bytes)
    case .closed(let closed, _):
      code = closed
      await ended()
      throw FreewayLegError.closed(code: closed)
    case .ended, nil:
      await ended()
      throw FreewayLegError.closed(code: code)
    }
  }

  /// The cell's close code, once it closed; nil while the leg stands or when its link went.
  func closeCode() async -> Int? { code }

  func close() async {
    await ended()
    await stream.close()
  }

  /// The leg is over: its focus classes it no more.
  private func ended() async {
    let focus = self.focus
    self.focus = nil
    await focus?.ended(stream)
  }
}

/// The host's tickets and renewals on the link — the attachment's `TicketDoor` and `RenewalDoor`,
/// answered as the raw JSON the attachment reads (`TerminalOpenTicket`, `{attachGrant}`). A refusal
/// is the door's own `FieldProductError` in the product taxonomy (`NOT_FOUND`, `CONFLICT`,
/// `UNAUTHORIZED`, `UNAVAILABLE`), as fieldd's door says it; a refused open or a link that ended is
/// `UNAVAILABLE {service: "freeway"}`, retryable as the host said.
public enum FreewayTerminalDoors {
  /// One session's ticket (`terminal-tickets`).
  public static func ticket(_ sessionId: String, on link: FreewayLink) async throws -> JSONValue {
    switch try await tickets([sessionId], on: link)[sessionId] {
    case .success(let ticket): return ticket
    case .failure(let refusal): throw refusal
    case nil: throw refusal(nil, otherwise: "the host answered no ticket for the session")
    }
  }

  /// Many sessions' tickets in one ask (`terminal-tickets`, at most
  /// `FreewayContract.maxTicketsPerAsk`): a row for each session the host answered, its ticket or
  /// its refusal.
  public static func tickets(_ sessionIds: [String], on link: FreewayLink) async throws
    -> [String: Result<JSONValue, FieldProductError>]
  {
    let stream = try await opened(
      link,
      .object([
        "kind": .string("terminal-tickets"), "sessionIds": .array(sessionIds.map { .string($0) }),
      ]))
    var rows: [String: Result<JSONValue, FieldProductError>] = [:]
    for row in stream.opened["tickets"]?.arrayValue ?? [] {
      guard let sessionId = row["sessionId"]?.stringValue else { continue }
      if let ticket = row["ticket"] {
        rows[sessionId] = .success(ticket)
      } else {
        rows[sessionId] = .failure(
          refusal(row["refusal"], otherwise: "the host answered no ticket for the session"))
      }
    }
    return rows
  }

  /// A renewal of a session's attach grant (`terminal-renew`): a CAS on the generation held,
  /// idempotent by `requestId`.
  public static func renew(
    _ sessionId: String, expectGeneration: Int64, requestId: String, on link: FreewayLink
  ) async throws -> JSONValue {
    let stream = try await opened(
      link,
      .object([
        "kind": .string("terminal-renew"), "sessionId": .string(sessionId),
        "expectGeneration": .int(expectGeneration), "requestId": .string(requestId),
      ]))
    if stream.opened["attachGrant"] != nil { return stream.opened }
    throw refusal(stream.opened["refusal"], otherwise: "the host answered no grant")
  }

  private static func opened(_ link: FreewayLink, _ request: JSONValue) async throws -> FreewayStream {
    do {
      return try await link.open(request)
    } catch let refused as FreewayOpenRefusal {
      throw FieldProductError(
        kind: "UNAVAILABLE", message: refused.state, retryable: refused.retryable,
        details: .object(["service": .string("freeway"), "code": .int(Int64(refused.code))]))
    } catch is FreewayLinkEnd {
      throw FieldProductError(
        kind: "UNAVAILABLE", message: "the link to the desktop ended", retryable: true,
        details: .object(["service": .string("freeway")]))
    }
  }

  private static func refusal(_ refusal: JSONValue?, otherwise: String) -> FieldProductError {
    guard let refusal else { return FieldProductError(kind: "INTERNAL", message: otherwise) }
    return FieldProductError(
      kind: refusal["code"]?.stringValue ?? "INTERNAL",
      message: refusal["message"]?.stringValue ?? "",
      retryable: refusal["retryable"]?.boolValue ?? false)
  }
}
