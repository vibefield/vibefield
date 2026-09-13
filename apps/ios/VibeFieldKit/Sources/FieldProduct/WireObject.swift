import Foundation

/// A shape the phone could not read at all. Distinct from `FieldProductError`,
/// which is the DOOR refusing: this one is us, failing to make sense of an
/// answer, and the two must never be reported as each other.
public struct WireDecodeError: Error, Sendable, Equatable, CustomStringConvertible {
  public let shape: String
  public let reason: String

  public init(shape: String, reason: String) {
    self.shape = shape
    self.reason = reason
  }

  public var description: String { "\(shape): \(reason)" }
}

/// One JSON object, read tolerantly (P3).
///
/// Every accessor RECORDS the key it touched, so "unknown field" needs no
/// second list of known keys to fall out of date — it is whatever the object
/// carried that nobody asked for. That is the whole trick: a shape's known key
/// set is its own reader, and the two cannot drift.
///
/// `null` reads as absent everywhere. The wire says `branch: null` for a
/// detached head and omits `branch` for a non-repo, and no screen here tells
/// those apart; deciding it once, in this struct, is cheaper than deciding it
/// wrong in eleven readers.
public struct WireObject: Sendable {
  public let shape: String
  public let fields: [String: JSONValue]
  private var touched: Set<String> = []

  public init(shape: String, value: JSONValue) throws {
    guard let fields = value.objectValue else {
      throw WireDecodeError(shape: shape, reason: "not an object")
    }
    self.shape = shape
    self.fields = fields
  }

  private init(shape: String, fields: [String: JSONValue]) {
    self.shape = shape
    self.fields = fields
  }

  /// The object a missing optional sub-shape leaves behind, so a reader of it
  /// needs no second spelling for "the mirror was not there". Every field of an
  /// empty object is absent, which is exactly what the caller would have had to
  /// write by hand.
  public static func empty(shape: String) -> WireObject {
    WireObject(shape: shape, fields: [:])
  }

  /// Keys the wire carried that this build does not read. The tolerant reader's
  /// other half: they are logged, never fatal, and never silently dropped.
  public var unknownFields: [String] {
    fields.keys.filter { !touched.contains($0) }.sorted()
  }

  public mutating func value(_ key: String) -> JSONValue? {
    touched.insert(key)
    guard let value = fields[key], !value.isNull else { return nil }
    return value
  }

  public mutating func string(_ key: String) -> String? { value(key)?.stringValue }
  public mutating func bool(_ key: String) -> Bool? { value(key)?.boolValue }
  public mutating func int(_ key: String) -> Int64? { value(key)?.intValue }
  public mutating func double(_ key: String) -> Double? { value(key)?.doubleValue }
  public mutating func array(_ key: String) -> [JSONValue]? { value(key)?.arrayValue }

  /// A nested object, or an empty one when the key was absent — so the reader
  /// below it is written once, for both cases.
  public mutating func object(_ key: String) -> WireObject {
    guard let value = value(key), let fields = value.objectValue else {
      return .empty(shape: "\(shape).\(key)")
    }
    return WireObject(shape: "\(shape).\(key)", fields: fields)
  }

  /// A nested object read by a shape of its own. Absent stays absent here: an
  /// optional sub-SHAPE is a fact ("this device is not serving"), where an
  /// optional sub-FIELD is only a missing value.
  public mutating func decodeObject<T>(
    _ key: String, _ make: (JSONValue) throws -> T
  ) throws -> T? {
    guard let value = value(key) else { return nil }
    return try make(value)
  }

  public mutating func requiredString(_ key: String) throws -> String {
    guard let text = string(key), !text.isEmpty else {
      throw WireDecodeError(shape: shape, reason: "missing `\(key)`")
    }
    return text
  }

  public mutating func requiredInt(_ key: String) throws -> Int64 {
    guard let value = int(key) else {
      throw WireDecodeError(shape: shape, reason: "missing integer `\(key)`")
    }
    return value
  }

  public mutating func requiredBool(_ key: String) throws -> Bool {
    guard let value = bool(key) else {
      throw WireDecodeError(shape: shape, reason: "missing boolean `\(key)`")
    }
    return value
  }

  public mutating func requiredArray(_ key: String) throws -> [JSONValue] {
    guard let value = array(key) else {
      throw WireDecodeError(shape: shape, reason: "missing array `\(key)`")
    }
    return value
  }

  /// A required array of sub-shapes. One unreadable ELEMENT does not cost the
  /// whole row: it is dropped and named, which is the array-shaped reading of
  /// the same tolerance the field accessors give an object.
  public mutating func rows<T>(
    _ key: String, _ make: (JSONValue) throws -> T, dropped: inout [String]
  ) throws -> [T] {
    Self.map(try requiredArray(key), make, dropped: &dropped)
  }

  /// The same, for an array the shape does not require. An absent array and an
  /// empty one answer alike: no rows.
  public mutating func optionalRows<T>(
    _ key: String, _ make: (JSONValue) throws -> T, dropped: inout [String]
  ) -> [T] {
    Self.map(array(key) ?? [], make, dropped: &dropped)
  }

  private static func map<T>(
    _ elements: [JSONValue], _ make: (JSONValue) throws -> T, dropped: inout [String]
  ) -> [T] {
    var rows: [T] = []
    rows.reserveCapacity(elements.count)
    for element in elements {
      do {
        rows.append(try make(element))
      } catch {
        dropped.append(String(describing: error))
      }
    }
    return rows
  }
}
