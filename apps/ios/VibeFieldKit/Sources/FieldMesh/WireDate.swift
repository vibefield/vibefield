import Foundation

// One wire date (PG-3e: moved here, whole, from `AgentFieldProjection.swift`, the field cut's projection, when that
// file retired; the remote cut's `asOf` stamps are read by it — `RemoteMirrorTests`' T10m).

/// One wire date. Both spellings are accepted because both are on the wire:
/// fieldd's own timestamps carry milliseconds, and nothing forbids a producer
/// that omits them.
private let iso8601WithFraction = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
private let iso8601WithoutFraction = Date.ISO8601FormatStyle(includingFractionalSeconds: false)

public func parseWireDate(_ text: String?) -> Date? {
  guard let text, !text.isEmpty else { return nil }
  if let date = try? iso8601WithFraction.parse(text) { return date }
  return try? iso8601WithoutFraction.parse(text)
}
