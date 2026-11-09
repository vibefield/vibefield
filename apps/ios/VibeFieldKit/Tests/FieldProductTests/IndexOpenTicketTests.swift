import Foundation
import Testing

@testable import FieldProduct

// SP-7b's 7b-2b — the ticket, read against the contracts' own goldens (byte-identical copies,
// `pnpm check:ios-fixtures`): the two endpoint sets, the ask, and the four refusals a reader falls
// back on. A set with no usable `restUrl` is a ticket with no pages: nil, and the door's pages.

@Suite struct IndexOpenTicketTests {
  private func ticket(
    sessionUrl: JSONValue = .string("ws://desk.tail.ts.net:9424/ws/sessions/s1"),
    restUrl: JSONValue? = .string("http://desk.tail.ts.net:9424"),
    grant: JSONValue = .string("g.h"),
    expiresAt: JSONValue = .int(1_790_000_060_000)
  ) -> JSONValue {
    var endpoints: [String: JSONValue] = ["sessionUrl": sessionUrl]
    endpoints["restUrl"] = restUrl
    return .object([
      "device": .string("dev-1"),
      "endpoints": .object(endpoints),
      "grant": grant,
      "expiresAt": expiresAt,
    ])
  }

  private func refusal(_ name: String) throws -> IndexTicketRefusal? {
    let golden = try Fixture.json(name)
    let error = FieldProductError(
      kind: golden["kind"]?.stringValue ?? "",
      message: "the door's words",
      retryable: golden["retryable"]?.boolValue ?? false,
      details: golden["details"])
    return IndexTicketRefusal(error: error)
  }

  // MARK: - The goldens

  @Test func theTailnetSetReads() throws {
    let read = try IndexOpenTicket(json: try Fixture.json("index-open-ticket.valid"))
    #expect(read.device == "dev-01HQ8ZK4M7")
    #expect(read.sessionUrl.absoluteString == "ws://studio-mbp.tail9f2c.ts.net:9424/ws/sessions/s1")
    #expect(read.restUrl?.absoluteString == "http://studio-mbp.tail9f2c.ts.net:9424")
    #expect(read.grant.hasPrefix("eyJjaWQiOiJmaWVsZGQ"))
    #expect(read.expiresAt == 1_790_000_060_000)
    #expect(read.unknownFields.isEmpty)
  }

  @Test func theLoopbackSetReads() throws {
    let read = try IndexOpenTicket(json: try Fixture.json("index-open-ticket.local"))
    #expect(read.sessionUrl.absoluteString == "ws://127.0.0.1:52811/ws/sessions/s1")
    #expect(read.restUrl?.absoluteString == "http://127.0.0.1:52811")
  }

  @Test func theAskIsTheGoldensOwn() throws {
    let golden = try Fixture.json("index-open-ticket-params.valid")
    let ask = IndexOpenTicket.params(sessionId: "s1", device: "dev-01HQ8ZK4M7")
    #expect(ask == golden)
  }

  @Test func theAskOmitsADeviceItDoesNotName() {
    let ask = IndexOpenTicket.params(sessionId: "s1", device: nil)
    #expect(ask == .object(["sessionId": .string("s1")]))
  }

  // MARK: - The tolerances

  @Test func anUnknownMemberIsNamedNotRefused() throws {
    guard case .object(var fields) = ticket() else {
      Issue.record("the ticket is not an object")
      return
    }
    fields["lease"] = .string("new")
    let read = try IndexOpenTicket(json: .object(fields))
    #expect(read.unknownFields == ["lease"])
  }

  @Test func anOlderOwnersSetHasNoPages() throws {
    let read = try IndexOpenTicket(json: ticket(restUrl: nil))
    #expect(read.restUrl == nil)
    #expect(read.sessionUrl.host == "desk.tail.ts.net")
  }

  @Test func aRestUrlNothingCanDialIsNoPages() throws {
    let unusable = [
      "ftp://desk.tail.ts.net:9424",
      "http://desk.tail.ts.net:9424/api",
      "http://user@desk.tail.ts.net:9424",
      "http://desk.tail.ts.net:9424?a=1",
      "http://desk.tail.ts.net:9424#a",
      "not a url",
    ]
    for text in unusable {
      let read = try IndexOpenTicket(json: ticket(restUrl: .string(text)))
      #expect(read.restUrl == nil, "\(text)")
    }
  }

  // MARK: - What no reader can use

  @Test func aSessionUrlNothingCanDialIsNoTicket() {
    let unusable = [
      "http://desk.tail.ts.net:9424/ws/sessions/s1",
      "ws://desk.tail.ts.net:9424/sessions/s1",
      "ws://desk.tail.ts.net:9424/ws/sessions/",
      "ws://desk.tail.ts.net:9424/ws/sessions/s1/more",
      "ws://desk.tail.ts.net:9424/ws/sessions/s1?grant=x",
      "ws://desk.tail.ts.net:9424/ws/sessions/s1#a",
      "ws://user:pw@desk.tail.ts.net:9424/ws/sessions/s1",
      "not a url",
    ]
    for text in unusable {
      #expect(throws: WireDecodeError.self, "\(text)") {
        try IndexOpenTicket(json: ticket(sessionUrl: .string(text)))
      }
    }
  }

  @Test func aGrantOutOfBoundsIsNoTicket() {
    let long = String(repeating: "x", count: 4097)
    #expect(throws: WireDecodeError.self) {
      try IndexOpenTicket(json: ticket(grant: .string("")))
    }
    #expect(throws: WireDecodeError.self) {
      try IndexOpenTicket(json: ticket(grant: .string(long)))
    }
  }

  @Test func aNegativeExpiryIsNoTicket() {
    #expect(throws: WireDecodeError.self) {
      try IndexOpenTicket(json: ticket(expiresAt: .int(-1)))
    }
  }

  // MARK: - The refusals

  @Test func anOlderOwnersUnbuiltStillReads() throws {
    let read = try refusal("error-data.index-direct-plane-unbuilt")
    #expect(read == .directPlaneUnbuilt)
  }

  @Test func thePlaneSwitchedOffReads() throws {
    let read = try refusal("error-data.index-direct-plane-off")
    #expect(read == .directPlaneOff)
  }

  @Test func theRoadRefusalsNameTheirDesktop() throws {
    let egress = try refusal("error-data.index-egress-unavailable")
    let doors = try refusal("error-data.index-doors-not-published")
    #expect(egress == .egressUnavailable(device: "dev-01HQ8ZK4M7"))
    #expect(doors == .doorsNotPublished(device: "dev-01HQ8ZK4M7"))
  }

  @Test func theWordsAreTheContractsOwn() {
    #expect(IndexTicketLimits.service == "index")
    #expect(IndexTicketLimits.ttlMs == 600_000)
  }

  @Test func anotherRefusalIsNotATicketRefusal() {
    let starting = FieldProductError(
      kind: "UNAVAILABLE", message: "m", retryable: true,
      details: .object(["service": .string("index"), "state": .string("starting")]))
    let peer = FieldProductError(
      kind: "UNAVAILABLE", message: "m", retryable: true,
      details: .object([
        "service": .string("peer-link"), "state": .string("egress_unavailable"),
        "device": .string("d"),
      ]))
    let noDevice = FieldProductError(
      kind: "UNAVAILABLE", message: "m", retryable: true,
      details: .object(["service": .string("index"), "state": .string("egress_unavailable")]))
    let denied = FieldProductError(kind: "FORBIDDEN_SCOPE", message: "m")
    #expect(IndexTicketRefusal(error: starting) == nil)
    #expect(IndexTicketRefusal(error: peer) == nil)
    #expect(IndexTicketRefusal(error: noDevice) == nil)
    #expect(IndexTicketRefusal(error: denied) == nil)
  }
}
