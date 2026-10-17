import Foundation
import Testing

@testable import FieldFreeway

/// The link's own WebSocket client, held to RFC 6455's worked examples (§1.3's handshake key,
/// §5.7's frames) and to the failures §5 and §7 require a client to fail the connection on.
@Suite("the freeway's WebSocket client (RFC 6455)")
struct WebSocketCodecTests {
  // MARK: the handshake

  @Test("the accept answers the key as §1.3 says it does")
  func accept() {
    #expect(
      FreewayHandshake.accept(for: "dGhlIHNhbXBsZSBub25jZQ==") == "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")
  }

  @Test("the request asks for the upgrade at the serve's bare root, and a key is 16 random bytes")
  func request() throws {
    let text = String(
      decoding: FreewayHandshake.request(host: "desk.tail1234.ts.net", port: 9425, key: "abc"),
      as: UTF8.self)
    #expect(
      text
        == "GET / HTTP/1.1\r\nHost: desk.tail1234.ts.net:9425\r\nUpgrade: websocket\r\n"
        + "Connection: Upgrade\r\nSec-WebSocket-Key: abc\r\nSec-WebSocket-Version: 13\r\n\r\n")
    let key = FreewayHandshake.key()
    #expect(Data(base64Encoded: key)?.count == 16)
    #expect(key != FreewayHandshake.key())
  }

  private func head(_ lines: [String], then rest: Data = Data()) -> Data {
    var data = Data((lines.joined(separator: "\r\n") + "\r\n\r\n").utf8)
    data.append(rest)
    return data
  }

  @Test("an upgrade is read — case-insensitively, token lists and all — with the frames after it")
  func upgraded() {
    let key = "dGhlIHNhbXBsZSBub25jZQ=="
    let frames = Data([0x82, 0x01, 0x07])
    let answer = FreewayHandshake.answer(
      head(
        [
          "HTTP/1.1 101 Switching Protocols", "upgrade: WebSocket",
          "Connection: keep-alive, Upgrade", "Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=",
        ], then: frames), key: key)
    #expect(answer == .upgraded(rest: frames))
  }

  @Test("anything else is refused, and a head still arriving is incomplete")
  func refused() {
    let key = "dGhlIHNhbXBsZSBub25jZQ=="
    let good = "Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
    #expect(
      FreewayHandshake.answer(Data("HTTP/1.1 101 Switching".utf8), key: key) == .incomplete)
    guard case .refused(404?, _) = FreewayHandshake.answer(head(["HTTP/1.1 404 Not Found"]), key: key)
    else { Issue.record("a 404 is a refusal with its status"); return }
    let wrongAccept = head([
      "HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade",
      "Sec-WebSocket-Accept: AAAA",
    ])
    let noUpgrade = head(["HTTP/1.1 101 Switching Protocols", "Connection: Upgrade", good])
    let extension_ = head([
      "HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", good,
      "Sec-WebSocket-Extensions: permessage-deflate",
    ])
    for answer in [wrongAccept, noUpgrade, extension_, head(["garbage"])] {
      guard case .refused = FreewayHandshake.answer(answer, key: key) else {
        Issue.record("refused: \(String(decoding: answer, as: UTF8.self))")
        continue
      }
    }
    let flood = Data(repeating: 0x41, count: FreewayHandshake.maxHeadBytes + 1)
    guard case .refused(nil, _) = FreewayHandshake.answer(flood, key: key) else {
      Issue.record("a head with no end is refused")
      return
    }
  }

  // MARK: frames the client sends

  @Test("a masked text frame is §5.7's, byte for byte")
  func maskedHello() {
    let bytes = WebSocketFrames.client(
      .text, payload: Data("Hello".utf8), mask: [0x37, 0xfa, 0x21, 0x3d])
    #expect(bytes == hex("818537fa213d7f9f4d5158"))
  }

  @Test("the length takes its two longer forms where §5.2 puts them")
  func lengths() {
    let mask: [UInt8] = [1, 2, 3, 4]
    let short = WebSocketFrames.client(.binary, payload: Data(count: 125), mask: mask)
    #expect(Array(short.prefix(2)) == [0x82, 0x80 | 125])
    let medium = WebSocketFrames.client(.binary, payload: Data(count: 256), mask: mask)
    #expect(Array(medium.prefix(4)) == [0x82, 0xfe, 0x01, 0x00])
    #expect(medium.count == 4 + 4 + 256)
    let long = WebSocketFrames.client(.binary, payload: Data(count: 65_536), mask: mask)
    #expect(Array(long.prefix(10)) == [0x82, 0xff, 0, 0, 0, 0, 0, 0x01, 0, 0])
    #expect(long.count == 10 + 4 + 65_536)
  }

  @Test("a close payload is its code, big-endian, then its reason")
  func closePayload() {
    #expect(WebSocketFrames.closePayload(code: 1000, reason: "bye") == Data([0x03, 0xe8]) + Data("bye".utf8))
  }

  // MARK: frames the server sends

  @Test("§5.7's server frames read as their events — whole, fragmented, and between fragments")
  func serverFrames() throws {
    var reader = WebSocketReader(maxMessageBytes: 1 << 20)
    #expect(try reader.feed(hex("810548656c6c6f")) == [.text("Hello")])
    #expect(try reader.feed(hex("010348656c")) == [])
    #expect(try reader.feed(hex("8905") + Data("Hello".utf8)) == [.ping(Data("Hello".utf8))])
    #expect(try reader.feed(hex("80026c6f")) == [.text("Hello")])
    #expect(try reader.feed(hex("8a0548656c6c6f")) == [.pong(Data("Hello".utf8))])
    let block = Data((0..<256).map { UInt8($0 & 0xff) })
    #expect(try reader.feed(hex("827e0100") + block) == [.binary(block)])
    let big = Data(repeating: 0x5a, count: 65_536)
    #expect(try reader.feed(hex("827f0000000000010000") + big) == [.binary(big)])
    #expect(
      try reader.feed(hex("880503e8") + Data("bye".utf8) + hex("8800"))
        == [.close(code: 1000, reason: "bye"), .close(code: nil, reason: "")])
  }

  @Test("however the stream chunks the bytes, the events are the same")
  func chunking() throws {
    let stream =
      hex("010348656c") + hex("8900") + hex("80026c6f") + hex("827e0100")
      + Data(repeating: 7, count: 256) + hex("880203e8")
    var whole = WebSocketReader(maxMessageBytes: 1 << 20)
    let expected = try whole.feed(stream)
    #expect(expected.count == 4)
    var trickle = WebSocketReader(maxMessageBytes: 1 << 20)
    var events: [WebSocketEvent] = []
    for byte in stream { events += try trickle.feed(Data([byte])) }
    #expect(events == expected)
  }

  @Test("what §5 and §7 say a client fails the connection on, it fails on")
  func failures() {
    let cases: [(String, WebSocketError)] = [
      ("818537fa213d7f9f4d5158", .maskedFromServer),
      ("c10548656c6c6f", .reservedBits),
      ("830100", .unknownOpcode(0x3)),
      ("090548656c6c6f", .fragmentedControl),
      ("897e007e", .controlTooLong),
      ("80026c6f", .unexpectedContinuation),
      ("8801" + "03", .badClose),
      ("8102c328", .badText),
    ]
    for (bytes, error) in cases {
      var reader = WebSocketReader(maxMessageBytes: 1 << 20)
      #expect(throws: error, "\(bytes)") { try reader.feed(hex(bytes)) }
    }
    var interleaved = WebSocketReader(maxMessageBytes: 1 << 20)
    #expect(throws: WebSocketError.interleavedMessage) {
      try interleaved.feed(hex("010148") + hex("810148"))
    }
  }

  @Test("a message past the bound is refused as soon as its length is read, before its bytes")
  func bound() throws {
    var reader = WebSocketReader(maxMessageBytes: 1_000)
    #expect(throws: WebSocketError.tooLong) { try reader.feed(hex("827e03e9")) }
    var fragments = WebSocketReader(maxMessageBytes: 1_000)
    #expect(try fragments.feed(hex("027e0200") + Data(count: 512)) == [])
    #expect(throws: WebSocketError.tooLong) { try fragments.feed(hex("807e0200")) }
  }
}
