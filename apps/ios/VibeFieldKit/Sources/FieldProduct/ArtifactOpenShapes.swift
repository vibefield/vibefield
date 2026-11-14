import Foundation

// SP-4 / MA-5 (red) — `artifact.open`, as the phone asks it and reads it. A stub: nothing is read, nothing is asked.

public enum ArtifactOpenState: String, Sendable, Equatable {
  case serving
  case starting

  public init(wire: String?) { self = .starting }
}

public enum MadeAppReach {
  /// `MADE_APP_LIMITS.REACH_HOSTS`
  public static let maxHosts = 16

  public static func isHost(_ host: String) -> Bool { true }
}

/// What `artifact.open` answers.
public struct ArtifactOpenResult: Sendable, Equatable {
  public let state: ArtifactOpenState
  public let url: String?
  public let reach: [String]?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    state = .starting
    url = nil
    reach = nil
    unknownFields = []
  }
}

/// What the phone asks `artifact.open`.
public struct ArtifactOpenParams: Sendable, Equatable {
  public let appId: String
  public let device: String?
  public let presentationId: String?

  public init(appId: String, device: String?, presentationId: String? = nil) {
    self.appId = appId
    self.device = device
    self.presentationId = presentationId
  }

  public var json: JSONValue { .object([:]) }
}
