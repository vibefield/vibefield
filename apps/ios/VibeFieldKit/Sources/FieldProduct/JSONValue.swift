import Foundation

/// A JSON value, whole. The tolerant reader's own container (design-00's P3):
/// every inbound object is parsed into this first, the fields the phone reads
/// are pulled out by name, and everything else is CARRIED rather than dropped —
/// which is what makes an unknown field a logged fact instead of a decode error.
///
/// Integers stay integers. `updated_at`, `publishedAt` and `expiresAt` are
/// millisecond counters and `version` is a u64; re-encoding one through a
/// `Double` would put `1.7531424e+12` on a wire that said `1753142400000`, so
/// the two number shapes are kept apart and only merge in the accessors.
public enum JSONValue: Sendable, Equatable, Hashable {
  case null
  case bool(Bool)
  case int(Int64)
  case double(Double)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])
}

// MARK: - Reading

extension JSONValue {
  public subscript(key: String) -> JSONValue? {
    guard case .object(let fields) = self else { return nil }
    return fields[key]
  }

  public var objectValue: [String: JSONValue]? {
    guard case .object(let fields) = self else { return nil }
    return fields
  }

  public var arrayValue: [JSONValue]? {
    guard case .array(let items) = self else { return nil }
    return items
  }

  public var stringValue: String? {
    guard case .string(let text) = self else { return nil }
    return text
  }

  public var boolValue: Bool? {
    guard case .bool(let flag) = self else { return nil }
    return flag
  }

  /// An integer, from either number shape — a whole `.double` counts, because a
  /// JSON writer is free to spell 5 as `5.0` and refusing that would be pedantry
  /// rather than tolerance. A fractional double is not an integer and says so.
  public var intValue: Int64? {
    switch self {
    case .int(let value): value
    case .double(let value):
      value.rounded() == value && value.magnitude < 9.007_199_254_740_992e15
        ? Int64(value) : nil
    default: nil
    }
  }

  public var doubleValue: Double? {
    switch self {
    case .int(let value): Double(value)
    case .double(let value): value
    default: nil
    }
  }

  /// `null` and "the key was absent" are the same answer to every reader here,
  /// and this is the one place that is decided.
  public var isNull: Bool {
    if case .null = self { return true }
    return false
  }
}

// MARK: - Codable

extension JSONValue: Codable {
  public init(from decoder: any Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() {
      self = .null
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode(Int64.self) {
      self = .int(value)
    } else if let value = try? container.decode(Double.self) {
      self = .double(value)
    } else if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode([JSONValue].self) {
      self = .array(value)
    } else if let value = try? container.decode([String: JSONValue].self) {
      self = .object(value)
    } else {
      throw DecodingError.dataCorruptedError(
        in: container, debugDescription: "not a JSON value")
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .null: try container.encodeNil()
    case .bool(let value): try container.encode(value)
    case .int(let value): try container.encode(value)
    case .double(let value): try container.encode(value)
    case .string(let value): try container.encode(value)
    case .array(let value): try container.encode(value)
    case .object(let value): try container.encode(value)
    }
  }
}

// MARK: - Bridging

extension JSONValue {
  public static func parse(_ data: Data) throws -> JSONValue {
    try JSONDecoder().decode(JSONValue.self, from: data)
  }

  public func encoded() throws -> Data {
    try JSONEncoder().encode(self)
  }

  /// Re-decode a slice of wire JSON into a caller's own type. The value came
  /// off the wire as bytes and goes back to bytes to be read as one — one
  /// encoder, one decoder, and no hand-rolled mirror of `Decodable` to drift.
  public func decode<T: Decodable>(_ type: T.Type) throws -> T {
    try JSONDecoder().decode(type, from: try encoded())
  }
}
