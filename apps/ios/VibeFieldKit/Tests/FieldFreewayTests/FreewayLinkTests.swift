import FieldProduct
import Foundation
import Testing

@testable import FieldFreeway

/// The phone's link against a scripted host over an in-memory stream: the hello and the welcome,
/// stream 0's heartbeat and acknowledgments, odd-id streams with their answers, messages both ways,
/// one CLOSE a side, and every way a link ends — each the way the host's `freeway::link` says.
@Suite("the freeway link (FreewayLink)", .timeLimit(.minutes(1)))
struct FreewayLinkTests {
  @Test("the hello carries the approval to the bare root of :9425, and the welcome is read")
  func hello() async throws {
    let (link, host, hello) = try await within(5, "connect") { try await connected() }
    let head = await host.requestHead
    #expect(head.hasPrefix("GET / HTTP/1.1\r\n"))
    #expect(head.contains("Host: desk.tail1234.ts.net:9425"))
    #expect(hello["type"]?.stringValue == "FreewayHello")
    #expect(hello["protocol"]?["major"]?.intValue == 1)
    #expect(hello["approval"]?["mac"]?.stringValue == "m")
    #expect(hello["device"]?["name"]?.stringValue == "phone")
    #expect(hello["capabilities"]?.arrayValue == [])
    #expect(link.welcome.deviceId == "dev-desk")
    #expect(link.welcome.clientId == "freeway:person@example.com#nPHONE~hb-1")
    #expect(link.welcome.rights == ["geometry", "input", "read"])
    #expect(link.welcome.fragmentBytes == 65_536)
    #expect(link.welcome.approvalExpiresAt == 1_787_790_600_000)
    await link.close()
  }

  @Test("a refused hello is the host's refusal")
  func refusedHello() async throws {
    let (phone, far) = MemoryStream.pair()
    let host = ScriptedHost(far)
    let link = Task { try await FreewayLink.connect(over: phone, host: "desk", approval: .null) }
    try await host.upgrade()
    _ = try await host.nextLink()
    try await host.sendLink(
      .object([
        "type": .string("FreewayRefused"), "code": .string("APPROVAL_EXPIRED"),
        "retryable": .bool(true), "message": .string("the approval has lapsed"),
      ]))
    try await host.close(code: 4401, reason: "APPROVAL")
    await #expect(
      throws: FreewayLinkEnd.refused(
        code: "APPROVAL_EXPIRED", retryable: true, message: "the approval has lapsed")
    ) { try await within(5, "refusal") { try await link.value } }
  }

  @Test("a welcome from another desktop than the one dialed is closed 4403 (FW-L9)")
  func wrongDesktop() async throws {
    let (phone, far) = MemoryStream.pair()
    let host = ScriptedHost(far)
    let link = Task {
      try await FreewayLink.connect(over: phone, host: "desk", approval: .null, expect: "dev-desk")
    }
    try await host.upgrade()
    _ = try await host.nextLink()
    try await host.welcome(deviceId: "dev-other")
    await #expect(throws: FreewayLinkEnd.wrongDesktop(expected: "dev-desk", welcomed: "dev-other")) {
      try await within(5, "the check") { try await link.value }
    }
    #expect(try await within(5, "the close") { try await host.nextClose() } == 4403)
  }

  @Test("the host's ping is answered with its seq, its time and every byte received")
  func pong() async throws {
    let (link, host, _) = try await within(5, "connect") { try await connected() }
    let ping: JSONValue = .object(["type": .string("Ping"), "seq": .int(7), "sentAtMs": .int(123)])
    try await host.sendLink(ping)
    let pong = try await within(5, "the pong") { try await host.nextLink() }
    let size = try FreewayFrame(kind: .link, stream: 0, payload: ping.encoded()).encode().count
    #expect(pong["type"]?.stringValue == "Pong")
    #expect(pong["seq"]?.intValue == 7)
    #expect(pong["sentAtMs"]?.intValue == 123)
    #expect(pong["ackBytes"]?.intValue == Int64(size))
    await link.close()
  }

  @Test("streams are odd, answered, and a refusal is the host's own")
  func opens() async throws {
    let (link, host, _) = try await within(5, "connect") { try await connected() }
    let tickets: JSONValue = .object([
      "kind": .string("terminal-tickets"), "sessionIds": .array([.string("s-1")]),
    ])
    let first = Task { try await link.open(tickets) }
    let open = try await within(5, "the open") { try await host.nextFrame() }
    #expect(open.kind == .open)
    #expect(open.stream == 1)
    #expect(try JSONValue.parse(open.payload) == tickets)
    try await host.sendJSON(.opened, stream: 1, .object(["tickets": .array([])]))
    let stream = try await within(5, "the answer") { try await first.value }
    #expect(stream.id == 1)
    #expect(stream.opened == .object(["tickets": .array([])]))

    let leg: JSONValue = .object([
      "kind": .string("terminal-leg"), "cellBootId": .string("cb-1"), "channel": .string("frames"),
    ])
    let second = Task { try await link.open(leg) }
    let next = try await within(5, "the second open") { try await host.nextFrame() }
    #expect(next.stream == 3)
    try await host.sendJSON(
      .openRefused, stream: 3,
      .object([
        "code": .int(4504), "state": .string("the cell did not answer"), "retryable": .bool(true),
      ]))
    await #expect(
      throws: FreewayOpenRefusal(code: 4504, state: "the cell did not answer", retryable: true)
    ) { try await within(5, "the refusal") { try await second.value } }
    await link.close()
  }

  @Test("a stream carries messages both ways, fragmented at the welcome's size, and closes once a side")
  func streamMessages() async throws {
    let (link, host, _) = try await within(5, "connect") { try await connected(fragmentBytes: 1_024) }
    let leg: JSONValue = .object([
      "kind": .string("terminal-leg"), "cellBootId": .string("cb-1"), "channel": .string("control"),
    ])
    let opening = Task { try await link.open(leg) }
    _ = try await within(5, "the open") { try await host.nextFrame() }
    try await host.sendJSON(.opened, stream: 1, .object([:]))
    let stream = try await within(5, "the answer") { try await opening.value }

    // the host's message in two fragments is one message here
    try await host.send(FreewayFrame(kind: .binary, fragment: true, stream: 1, payload: Data([1, 2])))
    try await host.send(FreewayFrame(kind: .binary, stream: 1, payload: Data([3])))
    var events = stream.events.makeAsyncIterator()
    #expect(await events.next() == .binary(Data([1, 2, 3])))

    // the phone's: one frame under the size, fragments over it
    try await stream.send(text: "hello")
    let text = try await within(5, "the text") { try await host.nextFrame() }
    #expect(text.kind == .text && !text.fragment && text.payload == Data("hello".utf8))
    try await stream.send(binary: Data(repeating: 9, count: 2_500))
    var parts: [FreewayFrame] = []
    for _ in 0..<3 { parts.append(try await within(5, "a fragment") { try await host.nextFrame() }) }
    #expect(parts.map(\.fragment) == [true, true, false])
    #expect(parts.map(\.payload.count) == [1_024, 1_024, 452])

    // the host's CLOSE ends the stream and is answered with the phone's, its code
    try await host.sendJSON(.close, stream: 1, .object(["code": .int(1000)]))
    #expect(await events.next() == .closed(code: 1000, reason: nil))
    #expect(await events.next() == nil)
    let answer = try await within(5, "the phone's close") { try await host.nextFrame() }
    #expect(answer.kind == .close && answer.stream == 1)
    #expect(try JSONValue.parse(answer.payload)["code"]?.intValue == 1000)
    await #expect(throws: FreewayLinkError.streamClosed) { try await stream.send(text: "late") }
    await link.close()
  }

  @Test("an Ack every 64 KiB the phone takes off the link")
  func acks() async throws {
    let (link, host, _) = try await within(5, "connect") { try await connected() }
    let opening = Task { try await link.open(
      .object([
        "kind": .string("terminal-leg"), "cellBootId": .string("cb-1"), "channel": .string("frames"),
      ])) }
    _ = try await within(5, "the open") { try await host.nextFrame() }
    try await host.sendJSON(.opened, stream: 1, .object([:]))
    _ = try await within(5, "the answer") { try await opening.value }
    for _ in 0..<5 {
      try await host.send(
        FreewayFrame(kind: .binary, stream: 1, payload: Data(repeating: 1, count: 16_000)))
    }
    let ack = try await within(5, "the ack") { try await host.nextLink() }
    #expect(ack["type"]?.stringValue == "Ack")
    #expect((ack["bytes"]?.intValue ?? 0) >= Int64(FreewayContract.ackEveryBytes))
    await link.close()
  }

  @Test("a planned restart is said before its close, and the link ends restarting with its wait")
  func restarting() async throws {
    let (link, host, _) = try await within(5, "connect") { try await connected() }
    try await host.sendLink(
      .object([
        "type": .string("Restarting"), "reason": .string("update"),
        "planes": .array([.string("field-native")]), "at": .int(1), "ttlMs": .int(1_500),
      ]))
    try await host.close(code: 4503, reason: "RESTARTING")
    #expect(
      try await within(5, "the end") { try await link.ended() }
        == .restarting(ttlMs: 1_500, reason: "update"))
  }

  @Test("three heartbeats with no pong is a dead link; a pong keeps it")
  func heartbeat() async throws {
    let (link, host, _) = try await within(5, "connect") { try await connected(heartbeatMs: 40) }
    // answered: the link stands past three heartbeats
    for _ in 0..<4 {
      let ping = try await within(5, "a ping") { try await host.nextLink(skippingPings: false) }
      #expect(ping["type"]?.stringValue == "Ping")
      try await host.sendLink(
        .object([
          "type": .string("Pong"), "seq": ping["seq"] ?? .int(0),
          "sentAtMs": ping["sentAtMs"] ?? .int(0),
        ]))
    }
    // unanswered: dead
    #expect(try await within(5, "the death") { try await link.ended() } == .dead)
  }

  @Test("a renewal is answered with the new expiry, and a refused one leaves the link standing")
  func renewal() async throws {
    let (link, host, _) = try await within(5, "connect") { try await connected() }
    let renewed = Task { try await link.renew(approval: .object(["mac": .string("fresh")])) }
    let renew = try await within(5, "the renew") { try await host.nextLink() }
    #expect(renew["type"]?.stringValue == "Renew")
    #expect(renew["approval"]?["mac"]?.stringValue == "fresh")
    try await host.sendLink(
      .object(["type": .string("Renewed"), "approvalExpiresAt": .int(1_787_799_000_000)]))
    #expect(try await within(5, "the expiry") { try await renewed.value } == 1_787_799_000_000)

    let refused = Task { try await link.renew(approval: .null) }
    _ = try await within(5, "the second renew") { try await host.nextLink() }
    try await host.sendLink(
      .object([
        "type": .string("FreewayRefused"), "code": .string("IDENTITY_MISMATCH"),
        "retryable": .bool(false), "message": .string("another node"),
      ]))
    await #expect(throws: FreewayLinkError.renewRefused(code: "IDENTITY_MISMATCH", message: "another node")) {
      try await within(5, "the refusal") { try await refused.value }
    }
    // the link stands: a ping is still answered
    try await host.sendLink(.object(["type": .string("Ping"), "seq": .int(1), "sentAtMs": .int(1)]))
    #expect(try await within(5, "the pong") { try await host.nextLink() }["type"]?.stringValue == "Pong")
    await link.close()
  }

  @Test("bytes that are not the protocol end the link 4400 — a frame that does not parse, or text")
  func protocolErrors() async throws {
    let (badFrame, host, _) = try await within(5, "connect") { try await connected() }
    try await host.sendMessage(opcode: 0x2, Data([0x08, 0x01]))
    #expect(try await within(5, "the end") { try await badFrame.ended() } == .local(code: 4400))
    #expect(try await within(5, "the close") { try await host.nextClose() } == 4400)

    let (text, textHost, _) = try await within(5, "connect") { try await connected() }
    try await textHost.sendText("hello")
    #expect(try await within(5, "the end") { try await text.ended() } == .local(code: 4400))
  }

  @Test("the host's own open is refused KIND_NOT_SERVED: the phone serves nothing")
  func peerOpen() async throws {
    let (link, host, _) = try await within(5, "connect") { try await connected() }
    try await host.sendJSON(.open, stream: 2, .object(["kind": .string("product")]))
    let refused = try await within(5, "the refusal") { try await host.nextFrame() }
    #expect(refused.kind == .openRefused && refused.stream == 2)
    #expect(try JSONValue.parse(refused.payload)["code"]?.intValue == 4404)
    await link.close()
  }

  @Test("a caller that stops waiting is told so: an end, an open and a renewal, each cancelled")
  func cancellation() async throws {
    let (link, host, _) = try await within(5, "connect") { try await connected() }
    let waiting = Task { try await link.ended() }
    waiting.cancel()
    await #expect(throws: CancellationError.self) { try await within(5, "the end's wait") { try await waiting.value } }
    let opening = Task {
      try await link.open(.object(["kind": .string("terminal-tickets"), "sessionIds": .array([])]))
    }
    _ = try await within(5, "the open") { try await host.nextFrame() }
    opening.cancel()
    await #expect(throws: CancellationError.self) { try await within(5, "the open's wait") { try await opening.value } }
    // the host's answer comes after all: the abandoned stream is closed again
    try await host.sendJSON(.opened, stream: 1, .object(["tickets": .array([])]))
    let close = try await within(5, "the close") { try await host.nextFrame() }
    #expect(close.kind == .close && close.stream == 1)
    let renewing = Task { try await link.renew(approval: .null) }
    _ = try await within(5, "the renew") { try await host.nextLink() }
    renewing.cancel()
    await #expect(throws: CancellationError.self) { try await within(5, "the renewal's wait") { try await renewing.value } }
    await link.close()
  }

  @Test("the link's end ends every stream with it, and says why — here, a newer link took its place")
  func endEndsStreams() async throws {
    let (link, host, _) = try await within(5, "connect") { try await connected() }
    let opening = Task { try await link.open(
      .object([
        "kind": .string("terminal-leg"), "cellBootId": .string("cb-1"), "channel": .string("frames"),
      ])) }
    _ = try await within(5, "the open") { try await host.nextFrame() }
    try await host.sendJSON(.opened, stream: 1, .object([:]))
    let stream = try await within(5, "the answer") { try await opening.value }
    try await host.close(code: 4409, reason: "SUPERSEDED")
    var events = stream.events.makeAsyncIterator()
    #expect(
      await events.next() == .ended(.closed(code: 4409, reason: "SUPERSEDED")))
    #expect(
      try await within(5, "the link's end") { try await link.ended() }
        == .closed(code: 4409, reason: "SUPERSEDED"))
    await #expect(throws: FreewayLinkEnd.closed(code: 4409, reason: "SUPERSEDED")) {
      try await link.open(.object(["kind": .string("terminal-tickets")]))
    }
  }
}
