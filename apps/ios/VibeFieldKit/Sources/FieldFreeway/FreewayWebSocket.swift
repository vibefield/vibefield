import CryptoKit
import Foundation

// FW (thinking-freeway.md v0.3 §3, FW-DF-11) — the link's WebSocket, written for the one socket it
// rides. F1 builds the phone's link on `MeshNode.dial` — a raw tailnet byte stream — instead of a
// `URLSession` through TailscaleKit's loopback SOCKS5 listener, which iOS can reclaim while the app
// is suspended. A raw stream needs its own WebSocket client, and truffle's `RFC6455FrameTransport`
// hardcodes `GET /ws` and `Host: truffle`, so this is VibeField's: the RFC 6455 client handshake,
// masked client frames, and a streaming reader for the host's frames. Still WebSocket under FW-D7.
// Pure: bytes in, bytes and events out; the socket is the caller's.

/// The client's opening handshake (RFC 6455 §4.1) and its check of the server's answer (§4.2.2).
public enum FreewayHandshake {
  /// RFC 6455 §1.3's GUID, concatenated with the key the client sent.
  static let guid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
  /// The most a server's handshake head may take before the blank line; past it, the answer is
  /// not a WebSocket server's.
  public static let maxHeadBytes = 16 * 1024

  /// A fresh `Sec-WebSocket-Key`: sixteen random bytes, base64 (§4.1, step 7).
  public static func key() -> String {
    var generator = SystemRandomNumberGenerator()
    let bytes = (0..<16).map { _ in UInt8.random(in: .min ... .max, using: &generator) }
    return Data(bytes).base64EncodedString()
  }

  /// The GET that asks for the upgrade. The path is the serve's bare root: the sidecar adds the
  /// route's secret on forward, so the phone holds none.
  public static func request(host: String, port: Int, path: String = "/", key: String) -> Data {
    let lines = [
      "GET \(path) HTTP/1.1",
      "Host: \(host):\(port)",
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Key: \(key)",
      "Sec-WebSocket-Version: 13",
    ]
    return Data((lines.joined(separator: "\r\n") + "\r\n\r\n").utf8)
  }

  /// `Sec-WebSocket-Accept` for `key`: base64(SHA-1(key + GUID)).
  public static func accept(for key: String) -> String {
    Data(Insecure.SHA1.hash(data: Data((key + guid).utf8))).base64EncodedString()
  }

  public enum Answer: Equatable, Sendable {
    /// The blank line has not arrived yet.
    case incomplete
    /// Upgraded; `rest` is what the server sent after its head — frames, already.
    case upgraded(rest: Data)
    /// Not upgraded: the status the server answered (nil when its head did not parse), and why.
    case refused(status: Int?, reason: String)
  }

  /// Read the server's answer to `key` off the bytes received so far.
  public static func answer(_ received: Data, key: String) -> Answer {
    guard let end = received.range(of: Data("\r\n\r\n".utf8)) else {
      return received.count > maxHeadBytes
        ? .refused(status: nil, reason: "no handshake head within \(maxHeadBytes) bytes")
        : .incomplete
    }
    let head = String(decoding: received[received.startIndex..<end.lowerBound], as: UTF8.self)
    let rest = Data(received[end.upperBound...])
    var lines = head.components(separatedBy: "\r\n")
    let statusLine = lines.removeFirst().split(separator: " ", maxSplits: 2)
    guard statusLine.count >= 2, statusLine[0].hasPrefix("HTTP/1.1"), let status = Int(statusLine[1])
    else { return .refused(status: nil, reason: "the status line did not parse") }
    guard status == 101 else { return .refused(status: status, reason: "not switching protocols") }
    var headers: [String: String] = [:]
    for line in lines {
      guard let colon = line.firstIndex(of: ":") else { continue }
      let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
      let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
      headers[name] = headers[name].map { "\($0), \(value)" } ?? value
    }
    func tokens(_ name: String) -> [String] {
      (headers[name] ?? "").split(separator: ",").map {
        $0.trimmingCharacters(in: .whitespaces).lowercased()
      }
    }
    guard tokens("upgrade").contains("websocket") else {
      return .refused(status: status, reason: "no Upgrade: websocket")
    }
    guard tokens("connection").contains("upgrade") else {
      return .refused(status: status, reason: "no Connection: Upgrade")
    }
    guard headers["sec-websocket-accept"] == accept(for: key) else {
      return .refused(status: status, reason: "Sec-WebSocket-Accept does not answer the key")
    }
    // No extension or subprotocol was asked for, so one in the answer is a server's mistake.
    guard headers["sec-websocket-extensions"] == nil, headers["sec-websocket-protocol"] == nil else {
      return .refused(status: status, reason: "the server chose an extension or a subprotocol")
    }
    return .upgraded(rest: rest)
  }
}

/// RFC 6455 §5.2's opcodes.
public enum WebSocketOpcode: UInt8, Sendable {
  case continuation = 0x0
  case text = 0x1
  case binary = 0x2
  case close = 0x8
  case ping = 0x9
  case pong = 0xA

  var isControl: Bool { rawValue & 0x8 != 0 }
}

/// A client frame (§5.3: a client MASKS every frame it sends, with a fresh key each time).
public enum WebSocketFrames {
  /// The bytes of one client frame. `mask` is the frame's masking key; production passes a random
  /// one (`randomMask()`), a test passes RFC 6455 §5.7's.
  public static func client(
    _ opcode: WebSocketOpcode, payload: Data, fin: Bool = true, mask: [UInt8] = randomMask()
  ) -> Data {
    precondition(mask.count == 4, "a masking key is four bytes")
    var out = Data(capacity: 14 + payload.count)
    out.append((fin ? 0x80 : 0) | opcode.rawValue)
    let count = payload.count
    if count < 126 {
      out.append(0x80 | UInt8(count))
    } else if count <= Int(UInt16.max) {
      out.append(0x80 | 126)
      out.append(UInt8(count >> 8))
      out.append(UInt8(count & 0xff))
    } else {
      out.append(0x80 | 127)
      for shift in stride(from: 56, through: 0, by: -8) { out.append(UInt8((count >> shift) & 0xff)) }
    }
    out.append(contentsOf: mask)
    var index = 0
    for byte in payload {
      out.append(byte ^ mask[index & 3])
      index += 1
    }
    return out
  }

  /// A close frame's payload: the code, big-endian, and its UTF-8 reason (§5.5.1).
  public static func closePayload(code: UInt16, reason: String = "") -> Data {
    var out = Data([UInt8(code >> 8), UInt8(code & 0xff)])
    out.append(contentsOf: Data(reason.utf8).prefix(123))
    return out
  }

  public static func randomMask() -> [UInt8] {
    var generator = SystemRandomNumberGenerator()
    return (0..<4).map { _ in UInt8.random(in: .min ... .max, using: &generator) }
  }
}

/// One complete thing the server said.
public enum WebSocketEvent: Equatable, Sendable {
  case text(String)
  case binary(Data)
  case ping(Data)
  case pong(Data)
  /// The server's close: its code (nil for an empty close payload) and its reason.
  case close(code: UInt16?, reason: String)
}

/// Why the server's bytes are not RFC 6455. Each one fails the connection (§7.1.7).
public enum WebSocketError: Error, Equatable, Sendable {
  /// A server never masks (§5.1).
  case maskedFromServer
  /// No extension was negotiated, so no reserved bit may be set (§5.2).
  case reservedBits
  case unknownOpcode(UInt8)
  /// A control frame is never fragmented and carries at most 125 bytes (§5.5).
  case fragmentedControl
  case controlTooLong
  /// A continuation with no message open, or a new message while one is (§5.4).
  case unexpectedContinuation
  case interleavedMessage
  /// A message past the reader's bound.
  case tooLong
  case badText
  case badClose
}

/// The server's frames, read as they arrive: bytes in, complete events out, a message reassembled
/// across its fragments and across however the stream chunked it. Control frames may arrive between
/// a message's fragments and are answered at once (§5.4).
public struct WebSocketReader: Sendable {
  public let maxMessageBytes: Int
  private var buffer = Data()
  private var message: (opcode: WebSocketOpcode, data: Data)?

  public init(maxMessageBytes: Int) {
    self.maxMessageBytes = maxMessageBytes
  }

  /// Take `bytes` and return every event they complete, in order.
  public mutating func feed(_ bytes: Data) throws -> [WebSocketEvent] {
    buffer.append(bytes)
    var events: [WebSocketEvent] = []
    var offset = buffer.startIndex
    while let (frame, next) = try nextFrame(at: offset) {
      offset = next
      if let event = try take(frame) { events.append(event) }
    }
    buffer.removeSubrange(buffer.startIndex..<offset)
    return events
  }

  private struct Frame {
    var fin: Bool
    var opcode: WebSocketOpcode
    var payload: Data
  }

  /// The frame at `offset`, and where the next begins; nil until all of it has arrived.
  private func nextFrame(at offset: Data.Index) throws -> (Frame, Data.Index)? {
    let available = buffer.endIndex - offset
    guard available >= 2 else { return nil }
    let first = buffer[offset]
    let second = buffer[offset + 1]
    guard first & 0x70 == 0 else { throw WebSocketError.reservedBits }
    guard let opcode = WebSocketOpcode(rawValue: first & 0x0f) else {
      throw WebSocketError.unknownOpcode(first & 0x0f)
    }
    guard second & 0x80 == 0 else { throw WebSocketError.maskedFromServer }
    let fin = first & 0x80 != 0
    var length = UInt64(second & 0x7f)
    var header = 2
    if length == 126 {
      guard available >= 4 else { return nil }
      length = UInt64(buffer[offset + 2]) << 8 | UInt64(buffer[offset + 3])
      header = 4
    } else if length == 127 {
      guard available >= 10 else { return nil }
      length = 0
      for index in 0..<8 { length = length << 8 | UInt64(buffer[offset + 2 + index]) }
      // §5.2: the most significant bit MUST be 0
      guard length >> 63 == 0 else { throw WebSocketError.tooLong }
      header = 10
    }
    if opcode.isControl {
      guard fin else { throw WebSocketError.fragmentedControl }
      guard length <= 125 else { throw WebSocketError.controlTooLong }
    }
    // Refused before it is buffered whole: a length past the bound is the stream's whole failure.
    let held = UInt64(message?.data.count ?? 0)
    guard length <= UInt64(maxMessageBytes), opcode.isControl || held + length <= UInt64(maxMessageBytes)
    else { throw WebSocketError.tooLong }
    guard UInt64(available - header) >= length else { return nil }
    let start = offset + header
    let end = start + Int(length)
    return (Frame(fin: fin, opcode: opcode, payload: Data(buffer[start..<end])), end)
  }

  private mutating func take(_ frame: Frame) throws -> WebSocketEvent? {
    switch frame.opcode {
    case .ping: return .ping(frame.payload)
    case .pong: return .pong(frame.payload)
    case .close: return try close(frame.payload)
    case .text, .binary:
      guard message == nil else { throw WebSocketError.interleavedMessage }
      if frame.fin { return try complete(frame.opcode, frame.payload) }
      message = (frame.opcode, frame.payload)
      return nil
    case .continuation:
      guard var open = message else { throw WebSocketError.unexpectedContinuation }
      open.data.append(frame.payload)
      if !frame.fin {
        message = open
        return nil
      }
      message = nil
      return try complete(open.opcode, open.data)
    }
  }

  private func complete(_ opcode: WebSocketOpcode, _ data: Data) throws -> WebSocketEvent {
    guard opcode == .text else { return .binary(data) }
    guard let text = String(data: data, encoding: .utf8) else { throw WebSocketError.badText }
    return .text(text)
  }

  private func close(_ payload: Data) throws -> WebSocketEvent {
    if payload.isEmpty { return .close(code: nil, reason: "") }
    guard payload.count >= 2 else { throw WebSocketError.badClose }
    let code = UInt16(payload[payload.startIndex]) << 8 | UInt16(payload[payload.startIndex + 1])
    guard let reason = String(data: payload.dropFirst(2), encoding: .utf8) else {
      throw WebSocketError.badClose
    }
    return .close(code: code, reason: reason)
  }
}
