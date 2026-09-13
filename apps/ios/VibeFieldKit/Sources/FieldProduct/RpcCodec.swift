import Foundation

/// A refusal from the product API, in the daemon's own words.
///
/// `kind` is the contracts' error taxonomy (`errors.ts`: `NOT_FOUND`,
/// `UNAVAILABLE`, `FORBIDDEN_SCOPE`, `INCOMPATIBLE`, …) carried as the STRING
/// the door sent, never re-spelled into a phone-side enum: a taxonomy that
/// grows upstream must reach a screen as itself, and a case this build has
/// never heard of is still a word a person can read.
public struct FieldProductError: Error, Sendable, Equatable {
  /// The taxonomy word. `INTERNAL` when the door sent an error with no `kind`
  /// — an honest default, and the same one the TypeScript client picks.
  public let kind: String
  public let message: String
  public let retryable: Bool
  public let details: JSONValue?
  /// The JSON-RPC numeric code, when there was one. Diagnostics only: `kind`
  /// is the authority, and the numbers are a projection of it.
  public let code: Int?

  public init(
    kind: String, message: String, retryable: Bool = false,
    details: JSONValue? = nil, code: Int? = nil
  ) {
    self.kind = kind
    self.message = message
    self.retryable = retryable
    self.details = details
    self.code = code
  }

  /// The three refusals a re-dial can never fix: the same version, the same
  /// token, the same unmet precondition. The TypeScript client stops on
  /// exactly these and so does this one — a client that retries them turns a
  /// clear "no" into an endless one.
  public static let terminalKinds: Set<String> = [
    "INCOMPATIBLE", "UNAUTHORIZED", "PRECONDITION_FAILED",
  ]

  public var isTerminal: Bool { Self.terminalKinds.contains(kind) }

  /// `UNAVAILABLE`'s own details (`{service, state, progress?}`) — the honest
  /// degraded state the UX renders instead of a blank.
  public var unavailable: (service: String, state: String, progress: Double?)? {
    guard kind == "UNAVAILABLE", let details else { return nil }
    guard let service = details["service"]?.stringValue,
      let state = details["state"]?.stringValue
    else { return nil }
    return (service, state, details["progress"]?.doubleValue)
  }
}

/// Which half of a subscription a frame is (P5 — snapshot, then deltas).
public enum SubEventKind: Sendable, Equatable {
  case snapshot
  case delta
}

/// One decoded inbound frame.
///
/// `unreadable` is a case rather than a throw on purpose: a garbage frame must
/// never take the connection down (the TypeScript client returns from its
/// `JSON.parse` catch for the same reason), and a reason a person can read is
/// worth more than a silent `return`.
public enum RpcFrame: Sendable, Equatable {
  case result(id: Int64, result: JSONValue)
  case failure(id: Int64, error: FieldProductError)
  case subscriptionEvent(method: String, subId: String, kind: SubEventKind, payload: JSONValue)
  case notification(method: String, params: JSONValue)
  case unreadable(String)
}

/// JSON-RPC 2.0 on the wire, both directions. Pure and free of the client's
/// state so the framing can be tested without a socket.
public enum RpcCodec {
  public static func request(id: Int64, method: String, params: JSONValue?) throws -> String {
    var fields: [String: JSONValue] = [
      "jsonrpc": .string("2.0"),
      "id": .int(id),
      "method": .string(method),
    ]
    // An absent `params` is omitted, never sent as `null`: the daemon's zod
    // shapes are `.optional()`, and `null` is a value that fails them.
    if let params { fields["params"] = params }
    let data = try JSONValue.object(fields).encoded()
    guard let text = String(data: data, encoding: .utf8) else {
      throw FieldProductError(kind: "INTERNAL", message: "request is not UTF-8")
    }
    return text
  }

  public static func decode(_ text: String) -> RpcFrame {
    guard let data = text.data(using: .utf8) else { return .unreadable("frame is not UTF-8") }
    return decode(data)
  }

  public static func decode(_ data: Data) -> RpcFrame {
    guard let value = try? JSONValue.parse(data), value.objectValue != nil else {
      return .unreadable("frame is not a JSON object")
    }

    // A response is anything carrying an integer id. Ids are ours — we minted
    // them — so a string id belongs to nobody here and reads as a notification
    // without a method, which is unreadable.
    if let id = value["id"]?.intValue {
      if let error = value["error"], !error.isNull {
        return .failure(id: id, error: rpcError(from: error))
      }
      return .result(id: id, result: value["result"] ?? .null)
    }

    guard let method = value["method"]?.stringValue else {
      return .unreadable("frame is neither a response nor a notification")
    }
    let params = value["params"] ?? .null

    if let subId = params["subId"]?.stringValue {
      if method.hasSuffix(".snapshot") {
        return .subscriptionEvent(
          method: method, subId: subId, kind: .snapshot, payload: params["payload"] ?? .null)
      }
      if method.hasSuffix(".delta") {
        return .subscriptionEvent(
          method: method, subId: subId, kind: .delta, payload: params["payload"] ?? .null)
      }
    }
    return .notification(method: method, params: params)
  }

  /// The `error` member of a JSON-RPC failure → the taxonomy. The `kind` and
  /// `retryable` live under `data` (contracts `ErrorData`); a door that sends
  /// neither still produces a readable refusal rather than a decode failure.
  public static func rpcError(from value: JSONValue) -> FieldProductError {
    let data = value["data"]
    return FieldProductError(
      kind: data?["kind"]?.stringValue ?? "INTERNAL",
      message: value["message"]?.stringValue ?? "rpc error",
      retryable: data?["retryable"]?.boolValue ?? false,
      details: data?["details"],
      code: value["code"]?.intValue.map(Int.init))
  }
}
