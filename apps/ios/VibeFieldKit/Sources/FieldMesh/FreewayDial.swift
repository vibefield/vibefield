import FieldFreeway
import Foundation
import Truffle

/// F1 (FW-DF-11) — `MeshNode.dial`'s connection as the freeway link's byte stream: the same three
/// calls, so the link never learns it rides truffle.
struct MeshFreewayStream: FreewayByteStream {
  let connection: any MeshConnection

  func read(_ max: Int) async throws -> Data? { try await connection.read(max) }
  func write(_ data: Data) async throws { try await connection.write(data) }
  func close() async { await connection.close() }
}

/// Why a desktop's freeway could not be dialed by the node.
public enum FreewayDialError: Error, Sendable, Equatable {
  /// The node does not see the desktop online right now.
  case notInReach
}
