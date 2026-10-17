import Foundation

/// FW (thinking-freeway.md v0.3 §5.1) — the link's frame codec, the host's `freeway::frame` on the
/// phone. One binary WebSocket message is one frame: `u8 frameType` · LEB128 `streamId` · payload.
/// `fixtures/freeway-frames.vector.json` pins the bytes on every side. Pure: no socket and no state.
/// A framing error is the whole link's — it closes with `FreewayContract.Code.protocolError` (4400)
/// — so every rule a reader holds is checked here, once, and a writer is held to the same rules, so
/// the phone can never send what the host would close the link over.
public enum FreewayFrameType: Sendable, Equatable, CustomStringConvertible {
  case link, open, opened, text, binary, close, window, openRefused

  public var byte: UInt8 {
    switch self {
    case .link: FreewayContract.FrameByte.link
    case .open: FreewayContract.FrameByte.open
    case .opened: FreewayContract.FrameByte.opened
    case .text: FreewayContract.FrameByte.text
    case .binary: FreewayContract.FrameByte.binary
    case .close: FreewayContract.FrameByte.close
    case .window: FreewayContract.FrameByte.window
    case .openRefused: FreewayContract.FrameByte.openRefused
    }
  }

  init?(byte: UInt8) {
    switch byte {
    case FreewayContract.FrameByte.link: self = .link
    case FreewayContract.FrameByte.open: self = .open
    case FreewayContract.FrameByte.opened: self = .opened
    case FreewayContract.FrameByte.text: self = .text
    case FreewayContract.FrameByte.binary: self = .binary
    case FreewayContract.FrameByte.close: self = .close
    case FreewayContract.FrameByte.window: self = .window
    case FreewayContract.FrameByte.openRefused: self = .openRefused
    default: return nil
    }
  }

  /// TEXT and BINARY alone may carry the FRAGMENT bit.
  public var fragments: Bool { self == .text || self == .binary }

  public var description: String {
    switch self {
    case .link: "LINK"
    case .open: "OPEN"
    case .opened: "OPENED"
    case .text: "TEXT"
    case .binary: "BINARY"
    case .close: "CLOSE"
    case .window: "WINDOW"
    case .openRefused: "OPEN_REFUSED"
    }
  }
}

/// Why a message is not a frame. Every one closes the link `protocolError`.
public enum FreewayFrameError: Error, Equatable, Sendable {
  case empty
  case unknownType(UInt8)
  case fragmentOn(FreewayFrameType)
  case linkOffStreamZero(UInt64)
  case streamOnZero(FreewayFrameType)
  case truncatedStreamId
  case streamIdOverflow
  /// A WINDOW's payload is exactly one LEB128 count.
  case window
}

/// One frame. LINK is stream 0's alone and stream 0 carries nothing else; TEXT and BINARY carry a
/// stream's protocol messages, fragmented when `fragment` says more follow.
public struct FreewayFrame: Sendable, Equatable {
  public var kind: FreewayFrameType
  /// More fragments of this TEXT or BINARY message follow.
  public var fragment: Bool
  public var stream: UInt64
  public var payload: Data

  public init(kind: FreewayFrameType, fragment: Bool = false, stream: UInt64, payload: Data) {
    self.kind = kind
    self.fragment = fragment
    self.stream = stream
    self.payload = payload
  }

  /// Read one frame. Its payload is checked only where the frame type fixes its shape (a WINDOW's
  /// count); JSON payloads are their kind's to parse.
  public static func decode(_ message: Data) throws -> FreewayFrame {
    guard let first = message.first else { throw FreewayFrameError.empty }
    let fragment = first & FreewayContract.fragmentBit != 0
    let typeByte = first & ~FreewayContract.fragmentBit
    guard let kind = FreewayFrameType(byte: typeByte) else {
      throw FreewayFrameError.unknownType(first)
    }
    let (stream, end) = try readLEB128(message, from: message.index(after: message.startIndex))
    let frame = FreewayFrame(
      kind: kind, fragment: fragment, stream: stream, payload: Data(message[end...]))
    try frame.check()
    return frame
  }

  /// Write one frame, held to the rules a reader holds.
  public func encode() throws -> Data {
    try check()
    var out = Data(capacity: 1 + 10 + payload.count)
    out.append(kind.byte | (fragment ? FreewayContract.fragmentBit : 0))
    Self.writeLEB128(stream, into: &out)
    out.append(payload)
    return out
  }

  /// A WINDOW frame granting `bytes` on `stream`.
  public static func window(stream: UInt64, bytes: UInt64) throws -> Data {
    var payload = Data(capacity: 10)
    writeLEB128(bytes, into: &payload)
    return try FreewayFrame(kind: .window, stream: stream, payload: payload).encode()
  }

  /// The bytes a WINDOW frame grants.
  public func windowGrant() throws -> UInt64 {
    guard kind == .window else { throw FreewayFrameError.window }
    let grant: (UInt64, Data.Index)
    do {
      grant = try Self.readLEB128(payload, from: payload.startIndex)
    } catch {
      throw FreewayFrameError.window
    }
    guard grant.1 == payload.endIndex else { throw FreewayFrameError.window }
    return grant.0
  }

  private func check() throws {
    if fragment && !kind.fragments { throw FreewayFrameError.fragmentOn(kind) }
    switch (kind, stream) {
    case (.link, 0): break
    case (.link, let stream): throw FreewayFrameError.linkOffStreamZero(stream)
    case (let kind, 0): throw FreewayFrameError.streamOnZero(kind)
    default: break
    }
    if kind == .window { _ = try windowGrant() }
  }

  /// Unsigned LEB128: seven bits a byte, low first, the high bit set while more follow. At most ten
  /// bytes, and the tenth may carry only u64's top bit.
  static func readLEB128(_ bytes: Data, from start: Data.Index) throws -> (UInt64, Data.Index) {
    var value: UInt64 = 0
    var index = start
    var count = 0
    while index < bytes.endIndex, count < 10 {
      let byte = bytes[index]
      let low = UInt64(byte & 0x7f)
      if count == 9 && low > 1 { throw FreewayFrameError.streamIdOverflow }
      value |= low << (7 * UInt64(count))
      index = bytes.index(after: index)
      count += 1
      if byte & 0x80 == 0 { return (value, index) }
    }
    throw count >= 10 ? FreewayFrameError.streamIdOverflow : FreewayFrameError.truncatedStreamId
  }

  static func writeLEB128(_ value: UInt64, into out: inout Data) {
    var value = value
    repeat {
      let low = UInt8(value & 0x7f)
      value >>= 7
      out.append(value == 0 ? low : low | 0x80)
    } while value != 0
  }
}
