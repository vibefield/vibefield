import Foundation
import Testing

@testable import FieldFreeway

/// EL9's THIRD SIDE for the freeway's frames: the vector the TypeScript contracts test and the
/// host's `freeway::frame` tests decode, read here by the shipping codec. Every frame decodes to
/// the fields the vector names and encodes back byte for byte; every refused message is refused.
struct FramesVector: Decodable {
  struct Row: Decodable {
    let name: String
    let frameType: String
    let fragment: Bool
    let streamId: UInt64
    let payloadHex: String
    let frameHex: String
  }

  struct Refused: Decodable {
    let name: String
    let frameHex: String
    let why: String
  }

  let frames: [Row]
  let refused: [Refused]

  static func load() throws -> FramesVector {
    let url = try #require(
      Bundle.module.url(
        forResource: "freeway-frames.vector", withExtension: "json", subdirectory: "Fixtures"))
    return try JSONDecoder().decode(FramesVector.self, from: Data(contentsOf: url))
  }
}

func hex(_ text: String) -> Data {
  var bytes = Data()
  var index = text.startIndex
  while index < text.endIndex, text.index(after: index) < text.endIndex {
    let next = text.index(index, offsetBy: 2)
    bytes.append(UInt8(text[index..<next], radix: 16) ?? 0)
    index = next
  }
  return bytes
}

@Suite("the freeway's frame bytes (freeway-frames.vector.json)")
struct FrameVectorTests {
  @Test("every frame decodes to its fields and encodes back byte for byte")
  func frames() throws {
    let vector = try FramesVector.load()
    #expect(vector.frames.count >= 10)
    for row in vector.frames {
      let frame = try FreewayFrame.decode(hex(row.frameHex))
      #expect(frame.kind.description == row.frameType, "\(row.name)")
      #expect(frame.fragment == row.fragment, "\(row.name)")
      #expect(frame.stream == row.streamId, "\(row.name)")
      #expect(frame.payload == hex(row.payloadHex), "\(row.name)")
      #expect(try frame.encode() == hex(row.frameHex), "\(row.name)")
    }
  }

  @Test("every refused message is a framing error, never a frame")
  func refused() throws {
    let vector = try FramesVector.load()
    #expect(vector.refused.count >= 9)
    for row in vector.refused {
      #expect(throws: FreewayFrameError.self, "\(row.name): \(row.why)") {
        try FreewayFrame.decode(hex(row.frameHex))
      }
    }
  }

  @Test("a writer is held to the reader's rules")
  func writerRules() throws {
    #expect(throws: FreewayFrameError.linkOffStreamZero(1)) {
      try FreewayFrame(kind: .link, stream: 1, payload: Data("{}".utf8)).encode()
    }
    #expect(throws: FreewayFrameError.streamOnZero(.text)) {
      try FreewayFrame(kind: .text, stream: 0, payload: Data()).encode()
    }
    #expect(throws: FreewayFrameError.fragmentOn(.open)) {
      try FreewayFrame(kind: .open, fragment: true, stream: 1, payload: Data("{}".utf8)).encode()
    }
    #expect(throws: FreewayFrameError.window) {
      try FreewayFrame(kind: .window, stream: 2, payload: Data([0x80])).encode()
    }
  }

  @Test("a window frame says its grant, and the grant reads back across the whole u64 range")
  func windows() throws {
    for bytes: UInt64 in [0, 1, 127, 128, 1 << 20, UInt64.max] {
      let frame = try FreewayFrame.decode(FreewayFrame.window(stream: 7, bytes: bytes))
      #expect(frame.kind == .window)
      #expect(frame.stream == 7)
      #expect(try frame.windowGrant() == bytes)
    }
    #expect(throws: FreewayFrameError.window) {
      try FreewayFrame(kind: .text, stream: 7, payload: Data([0x01])).windowGrant()
    }
  }

  @Test("a stream id round-trips at every LEB128 width, u64's top included")
  func streamIds() throws {
    for stream: UInt64 in [1, 127, 128, 300, 16_383, 16_384, 1 << 35, UInt64.max] {
      let encoded = try FreewayFrame(kind: .binary, stream: stream, payload: Data([9])).encode()
      #expect(try FreewayFrame.decode(encoded).stream == stream)
    }
  }
}
