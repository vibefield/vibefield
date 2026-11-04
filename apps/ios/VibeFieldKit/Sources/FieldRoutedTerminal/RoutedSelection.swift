import FieldProduct
import Foundation

/// Absolute retained-grid coordinates, including scrollback. Reading a
/// selection requires read authority; it does not take input or geometry.
public struct RoutedSelection: Sendable, Equatable {
  public let startColumn: UInt16
  public let startRow: UInt32
  public let endColumn: UInt16
  public let endRow: UInt32
  public let selectAll: Bool

  public init(
    startColumn: UInt16 = 0, startRow: UInt32 = 0,
    endColumn: UInt16 = 0, endRow: UInt32 = 0, selectAll: Bool = false
  ) {
    self.startColumn = startColumn
    self.startRow = startRow
    self.endColumn = endColumn
    self.endRow = endRow
    self.selectAll = selectAll
  }
}

public enum RoutedSelectionError: Error, Sendable, Equatable, LocalizedError {
  case unsupported, unavailable, tooLarge, busy, timedOut

  public var errorDescription: String? {
    switch self {
    case .unsupported: "This desktop needs an update to support terminal copy."
    case .unavailable: "This terminal selection is no longer available."
    case .tooLarge: "This selection is too large to copy. Select fewer rows."
    case .busy: "Other copy requests are still pending. Try again shortly."
    case .timedOut: "The desktop did not answer the copy request. Try again."
    }
  }
}

struct RoutedSelectionResult {
  let requestId: String
  let sessionId: String
  let activationId: String
  let leaseEpoch: Int64
  let result: Result<String, RoutedSelectionError>

  init(json: JSONValue) throws {
    guard let request = json["requestId"]?.stringValue, !request.isEmpty,
      request.utf8.count <= 64,
      let session = json["sessionId"]?.stringValue, !session.isEmpty, session.utf8.count <= 256,
      let activation = json["activationId"]?.stringValue, !activation.isEmpty,
      activation.utf8.count <= 256,
      let epoch = json["leaseEpoch"]?.intValue, epoch >= 0, epoch <= 9_007_199_254_740_991
    else { throw RoutedSelectionError.unavailable }
    requestId = request
    sessionId = session
    activationId = activation
    leaseEpoch = epoch
    if let text = json["text"]?.stringValue, json["error"] == nil {
      result = .success(text)
    } else if json["text"] == nil, let error = json["error"]?.stringValue {
      switch error {
      case "UNAVAILABLE": result = .failure(.unavailable)
      case "TOO_LARGE": result = .failure(.tooLarge)
      default: throw RoutedSelectionError.unavailable
      }
    } else {
      throw RoutedSelectionError.unavailable
    }
  }
}
