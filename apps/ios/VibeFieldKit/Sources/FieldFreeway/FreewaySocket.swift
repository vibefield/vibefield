import Foundation

/// The byte stream a link rides: `MeshNode.dial`'s connection, as FieldMesh hands it over. The
/// same three calls as truffle's `MeshConnection`, so the mesh leg's adapter is a line each and
/// this target never imports truffle.
public protocol FreewayByteStream: Sendable {
  /// Up to `max` bytes; nil at the end of the stream.
  func read(_ max: Int) async throws -> Data?
  func write(_ data: Data) async throws
  func close() async
}

/// Why a WebSocket over the stream did not stand, or stopped standing.
public enum FreewaySocketError: Error, Equatable, Sendable {
  /// The server answered the upgrade with something else.
  case handshake(status: Int?, reason: String)
  /// The stream ended where a handshake or a frame was still owed.
  case ended
  /// The server's bytes were not RFC 6455.
  case wire(WebSocketError)
}

/// One client WebSocket over one byte stream: the handshake, then masked binary messages out and
/// the server's events in. A ping is answered here (§5.5.2) and a close is sent once (§5.5.1); the
/// one reader is the link's read loop, and every write goes out in the order it was asked for.
public actor FreewaySocket {
  private let stream: any FreewayByteStream
  private var reader: WebSocketReader
  private var events: [WebSocketEvent] = []
  private var writing: Task<Void, any Error>?
  private var closeSent = false

  /// The most one read asks the stream for.
  static let readChunk = 64 * 1024

  private init(stream: any FreewayByteStream, maxMessageBytes: Int) {
    self.stream = stream
    self.reader = WebSocketReader(maxMessageBytes: maxMessageBytes)
  }

  /// Upgrade `stream` to a WebSocket at `host:port`'s bare root.
  public static func open(
    over stream: any FreewayByteStream, host: String, port: Int, maxMessageBytes: Int
  ) async throws -> FreewaySocket {
    let key = FreewayHandshake.key()
    try await stream.write(FreewayHandshake.request(host: host, port: port, key: key))
    var received = Data()
    while true {
      guard let chunk = try await stream.read(readChunk) else {
        await stream.close()
        throw FreewaySocketError.ended
      }
      received.append(chunk)
      switch FreewayHandshake.answer(received, key: key) {
      case .incomplete:
        continue
      case .refused(let status, let reason):
        await stream.close()
        throw FreewaySocketError.handshake(status: status, reason: reason)
      case .upgraded(let rest):
        let socket = FreewaySocket(stream: stream, maxMessageBytes: maxMessageBytes)
        try await socket.take(rest)
        return socket
      }
    }
  }

  /// The server's next binary or text message, or its close. Pings are answered and pongs passed
  /// over on the way. Throws when the stream ends without a close or the bytes are not RFC 6455.
  public func receive() async throws -> WebSocketEvent {
    while true {
      while !events.isEmpty {
        let event = events.removeFirst()
        switch event {
        case .ping(let payload):
          try await write(WebSocketFrames.client(.pong, payload: payload))
        case .pong:
          continue
        case .text, .binary, .close:
          return event
        }
      }
      guard let chunk = try await stream.read(Self.readChunk) else {
        throw FreewaySocketError.ended
      }
      try take(chunk)
    }
  }

  /// One binary message.
  public func send(_ message: Data) async throws {
    try await write(WebSocketFrames.client(.binary, payload: message))
  }

  /// Several binary messages back to back, in one write: nothing else goes out between them (a
  /// stream's fragments).
  public func send(frames messages: [Data]) async throws {
    var bytes = Data()
    for message in messages { bytes.append(WebSocketFrames.client(.binary, payload: message)) }
    try await write(bytes)
  }

  /// Say the close once, then end the stream. A close already said, or a stream already gone, is
  /// nothing to this.
  public func close(code: UInt16, reason: String = "") async {
    if !closeSent {
      closeSent = true
      let frame = WebSocketFrames.client(
        .close, payload: WebSocketFrames.closePayload(code: code, reason: reason))
      try? await write(frame)
    }
    await stream.close()
  }

  private func take(_ bytes: Data) throws {
    do {
      events += try reader.feed(bytes)
    } catch let error as WebSocketError {
      throw FreewaySocketError.wire(error)
    }
  }

  /// Writes in the order they were asked for: each waits for the one before it.
  private func write(_ bytes: Data) async throws {
    let previous = writing
    let stream = self.stream
    let next = Task {
      _ = try? await previous?.value
      try await stream.write(bytes)
    }
    writing = next
    try await next.value
  }
}
