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
/// dialed for this — and throws when there is none to be had.
public struct FreewayLegTransport: RoutedLegTransport {
  private let link: @Sendable () async throws -> FreewayLink

  public init(link: @escaping @Sendable () async throws -> FreewayLink) {
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
    return FreewayLegConnection(stream: stream)
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

  init(stream: FreewayStream) {
    self.stream = stream
    self.events = stream.events.makeAsyncIterator()
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
      throw FreewayLegError.closed(code: closed)
    case .ended, nil:
      throw FreewayLegError.closed(code: code)
    }
  }

  /// The cell's close code, once it closed; nil while the leg stands or when its link went.
  func closeCode() async -> Int? { code }

  func close() async { await stream.close() }
}

/// The host's tickets and renewals on the link — the attachment's `TicketDoor` and `RenewalDoor`,
/// answered as the raw JSON the attachment reads (`TerminalOpenTicket`, `{attachGrant}`). A refusal
/// is the door's own `FieldProductError` in the product taxonomy (`NOT_FOUND`, `CONFLICT`,
/// `UNAUTHORIZED`, `UNAVAILABLE`), as fieldd's door says it; a refused open or a link that ended is
/// `UNAVAILABLE {service: "freeway"}`, retryable as the host said.
public enum FreewayTerminalDoors {
  /// One session's ticket (`terminal-tickets`).
  public static func ticket(_ sessionId: String, on link: FreewayLink) async throws -> JSONValue {
    let stream = try await opened(
      link,
      .object([
        "kind": .string("terminal-tickets"), "sessionIds": .array([.string(sessionId)]),
      ]))
    let row = (stream.opened["tickets"]?.arrayValue ?? []).first {
      $0["sessionId"]?.stringValue == sessionId
    }
    if let ticket = row?["ticket"] { return ticket }
    throw refusal(row?["refusal"], otherwise: "the host answered no ticket for the session")
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
