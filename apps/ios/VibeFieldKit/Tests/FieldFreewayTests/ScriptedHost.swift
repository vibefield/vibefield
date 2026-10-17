import FieldProduct
import Foundation
import Testing

@testable import FieldFreeway

/// One direction of an in-memory byte stream: what one side writes, the other reads, in order.
actor MemoryPipe {
  private var buffer = Data()
  private var closed = false
  private var waiter: CheckedContinuation<Data?, Never>?

  struct Closed: Error {}

  /// A write after the reader closed is discarded, as TCP's would be: the far side finds out by
  /// its next read, never by a write that throws in the middle of its script.
  func write(_ data: Data) {
    guard !closed else { return }
    buffer.append(data)
    if let waiter {
      self.waiter = nil
      waiter.resume(returning: take(Int.max))
    }
  }

  func read(_ max: Int) async -> Data? {
    if !buffer.isEmpty { return take(max) }
    if closed { return nil }
    return await withCheckedContinuation { waiter = $0 }
  }

  func close() {
    closed = true
    if let waiter {
      self.waiter = nil
      waiter.resume(returning: buffer.isEmpty ? nil : take(Int.max))
    }
  }

  private func take(_ max: Int) -> Data {
    let chunk = Data(buffer.prefix(max))
    buffer.removeFirst(chunk.count)
    return chunk
  }
}

/// A byte stream over two pipes — the test's stand-in for `MeshNode.dial`'s connection.
struct MemoryStream: FreewayByteStream {
  let inbound: MemoryPipe
  let outbound: MemoryPipe

  func read(_ max: Int) async throws -> Data? { await inbound.read(max) }
  func write(_ data: Data) async throws { await outbound.write(data) }
  func close() async {
    await inbound.close()
    await outbound.close()
  }

  /// The phone's end and the host's end of one connection.
  static func pair() -> (phone: MemoryStream, host: MemoryStream) {
    let up = MemoryPipe()
    let down = MemoryPipe()
    return (MemoryStream(inbound: down, outbound: up), MemoryStream(inbound: up, outbound: down))
  }
}

struct Timeout: Error, CustomStringConvertible {
  let what: String
  var description: String { "timed out: \(what)" }
}

/// Resumes a continuation once, whichever of its racers gets there first.
final class Once<T: Sendable>: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<T, any Error>?

  init(_ continuation: CheckedContinuation<T, any Error>) {
    self.continuation = continuation
  }

  func resume(with result: Result<T, any Error>) {
    lock.lock()
    let continuation = self.continuation
    self.continuation = nil
    lock.unlock()
    continuation?.resume(with: result)
  }
}

/// `body`, or a `Timeout` after `seconds` — so a broken link fails a row in seconds instead of
/// hanging it. A RACE, not a task group: a group waits for its children before it can throw, and
/// a body parked on a pipe or a link's continuation does not end when cancelled, so a group would
/// sit until the suite's time limit. The body is cancelled and left behind.
func within<T: Sendable>(
  _ seconds: Double, _ what: String, _ body: @escaping @Sendable () async throws -> T
) async throws -> T {
  try await withCheckedThrowingContinuation { continuation in
    let once = Once(continuation)
    let work = Task {
      do { once.resume(with: .success(try await body())) } catch { once.resume(with: .failure(error)) }
    }
    Task {
      try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
      work.cancel()
      once.resume(with: .failure(Timeout(what: what)))
    }
  }
}

/// The far side of the link, scripted: the server half of RFC 6455 and the freeway host's frames.
/// It reads the phone's MASKED frames (a client masks every frame) and writes unmasked ones.
actor ScriptedHost {
  let stream: MemoryStream
  private var buffer = Data()
  private(set) var requestHead = ""

  init(_ stream: MemoryStream) {
    self.stream = stream
  }

  private func fill() async throws {
    guard let chunk = try await stream.read(64 * 1024) else { throw MemoryPipe.Closed() }
    buffer.append(chunk)
  }

  /// Read the phone's upgrade and answer it 101 with the accept its key calls for.
  func upgrade() async throws {
    while buffer.range(of: Data("\r\n\r\n".utf8)) == nil { try await fill() }
    let end = buffer.range(of: Data("\r\n\r\n".utf8))!
    requestHead = String(decoding: buffer[buffer.startIndex..<end.lowerBound], as: UTF8.self)
    buffer.removeSubrange(buffer.startIndex..<end.upperBound)
    let key =
      requestHead.components(separatedBy: "\r\n")
      .first { $0.lowercased().hasPrefix("sec-websocket-key:") }?
      .split(separator: ":", maxSplits: 1)[1]
      .trimmingCharacters(in: .whitespaces) ?? ""
    let answer =
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
      + "Sec-WebSocket-Accept: \(FreewayHandshake.accept(for: key))\r\n\r\n"
    try await stream.write(Data(answer.utf8))
  }

  /// The phone's next WebSocket frame: its opcode and its UNMASKED payload.
  func nextMessage() async throws -> (opcode: UInt8, payload: Data) {
    while true {
      if let (opcode, payload, used) = Self.parseClientFrame(buffer) {
        buffer.removeSubrange(buffer.startIndex..<(buffer.startIndex + used))
        return (opcode, payload)
      }
      try await fill()
    }
  }

  /// The phone's next freeway frame, skipping its `Ping`s when asked to.
  func nextFrame(skippingPings: Bool = true) async throws -> FreewayFrame {
    while true {
      let (opcode, payload) = try await nextMessage()
      guard opcode == 0x2 else {
        throw WireDecodeError(shape: "frame", reason: "opcode \(opcode), not binary")
      }
      let frame = try FreewayFrame.decode(payload)
      if skippingPings, frame.kind == .link,
        (try? JSONValue.parse(frame.payload))?["type"]?.stringValue == "Ping"
      {
        continue
      }
      return frame
    }
  }

  /// The phone's next stream-0 message.
  func nextLink(skippingPings: Bool = true) async throws -> JSONValue {
    let frame = try await nextFrame(skippingPings: skippingPings)
    #expect(frame.kind == .link)
    return try JSONValue.parse(frame.payload)
  }

  /// The phone's close frame: its code.
  func nextClose() async throws -> UInt16? {
    while true {
      let (opcode, payload) = try await nextMessage()
      guard opcode == 0x8 else { continue }
      guard payload.count >= 2 else { return nil }
      return UInt16(payload[payload.startIndex]) << 8 | UInt16(payload[payload.startIndex + 1])
    }
  }

  func send(_ frame: FreewayFrame) async throws {
    try await sendMessage(opcode: 0x2, try frame.encode())
  }

  func sendLink(_ message: JSONValue) async throws {
    try await send(FreewayFrame(kind: .link, stream: 0, payload: message.encoded()))
  }

  func sendJSON(_ kind: FreewayFrameType, stream: UInt64, _ message: JSONValue) async throws {
    try await send(FreewayFrame(kind: kind, stream: stream, payload: message.encoded()))
  }

  func welcome(
    deviceId: String = "dev-desk", heartbeatMs: Int = 60_000, fragmentBytes: Int = 65_536,
    maxStreams: Int = 64
  ) async throws {
    try await sendLink(
      .object([
        "type": .string("FreewayWelcome"),
        "linkId": .string("lk-1"),
        "hostBootId": .string("hb-1"),
        "floorBootId": .string("fb-1"),
        "deviceId": .string(deviceId),
        "clientId": .string("freeway:person@example.com#nPHONE~hb-1"),
        "rights": .array([.string("geometry"), .string("input"), .string("read")]),
        "limits": .object([
          "fragmentBytes": .int(Int64(fragmentBytes)),
          "streamWindowBytes": .int(1 << 20),
          "maxStreams": .int(Int64(maxStreams)),
        ]),
        "heartbeatMs": .int(Int64(heartbeatMs)),
        "approvalExpiresAt": .int(1_787_790_600_000),
      ]))
  }

  /// A server close frame.
  func close(code: UInt16, reason: String = "") async throws {
    var payload = Data([UInt8(code >> 8), UInt8(code & 0xff)])
    payload.append(Data(reason.utf8))
    try await sendMessage(opcode: 0x8, payload)
  }

  func sendText(_ text: String) async throws {
    try await sendMessage(opcode: 0x1, Data(text.utf8))
  }

  func sendMessage(opcode: UInt8, _ payload: Data) async throws {
    var out = Data([0x80 | opcode])
    if payload.count < 126 {
      out.append(UInt8(payload.count))
    } else if payload.count <= Int(UInt16.max) {
      out.append(126)
      out.append(UInt8(payload.count >> 8))
      out.append(UInt8(payload.count & 0xff))
    } else {
      out.append(127)
      for shift in stride(from: 56, through: 0, by: -8) {
        out.append(UInt8((payload.count >> shift) & 0xff))
      }
    }
    out.append(payload)
    try await stream.write(out)
  }

  /// One masked client frame off the front of `bytes`: opcode, unmasked payload, bytes used. Nil
  /// until all of it is there. A client frame that is not masked fails the row.
  static func parseClientFrame(_ bytes: Data) -> (UInt8, Data, Int)? {
    let b = [UInt8](bytes)
    guard b.count >= 2 else { return nil }
    let opcode = b[0] & 0x0f
    #expect(b[1] & 0x80 != 0, "a client frame is masked")
    var length = Int(b[1] & 0x7f)
    var index = 2
    if length == 126 {
      guard b.count >= 4 else { return nil }
      length = Int(b[2]) << 8 | Int(b[3])
      index = 4
    } else if length == 127 {
      guard b.count >= 10 else { return nil }
      length = b[2..<10].reduce(0) { $0 << 8 | Int($1) }
      index = 10
    }
    guard b.count >= index + 4 + length else { return nil }
    let mask = Array(b[index..<(index + 4)])
    let payload = Data(b[(index + 4)..<(index + 4 + length)].enumerated().map { $1 ^ mask[$0 & 3] })
    return (opcode, payload, index + 4 + length)
  }
}

/// A connected link and its host: the upgrade answered, the hello read, the welcome sent.
func connected(
  heartbeatMs: Int = 60_000, fragmentBytes: Int = 65_536
) async throws -> (link: FreewayLink, host: ScriptedHost, hello: JSONValue) {
  let (phone, far) = MemoryStream.pair()
  let host = ScriptedHost(far)
  let approval: JSONValue = .object(["protected": .object([:]), "claims": .object([:]), "mac": .string("m")])
  async let link = FreewayLink.connect(
    over: phone, host: "desk.tail1234.ts.net", approval: approval, deviceName: "phone",
    expect: "dev-desk")
  try await host.upgrade()
  let hello = try await host.nextLink()
  try await host.welcome(heartbeatMs: heartbeatMs, fragmentBytes: fragmentBytes)
  return (try await link, host, hello)
}
