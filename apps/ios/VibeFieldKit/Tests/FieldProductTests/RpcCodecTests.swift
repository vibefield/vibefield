import Foundation
import Testing

@testable import FieldProduct

@Suite struct RpcRequestFramingTests {
  @Test func aRequestIsJsonRpcTwoWithAnIntegerId() throws {
    let text = try RpcCodec.request(
      id: 7, method: "agent.subscribe", params: AgentSubscribeParams.phoneField.json)
    let value = try JSONValue.parse(Data(text.utf8))
    #expect(value["jsonrpc"]?.stringValue == "2.0")
    #expect(value["id"] == .int(7))
    #expect(value["method"]?.stringValue == "agent.subscribe")
    #expect(value["params"]?["projection"]?.stringValue == "field")
    #expect(value["params"]?["minIntervalMs"] == .int(250))
  }

  /// A zod `.optional()` refuses `null`, so an absent params is ABSENT — not a
  /// null that would fail the very shape it is trying to satisfy.
  @Test func absentParamsAreOmittedRatherThanNull() throws {
    let text = try RpcCodec.request(id: 1, method: "agent.list", params: nil)
    let value = try JSONValue.parse(Data(text.utf8))
    #expect(value.objectValue?.keys.contains("params") == false)
  }

  @Test func integersStayIntegersThroughTheCodec() throws {
    // A millisecond clock through a Double would come back as 1.7531424e+12.
    let text = try RpcCodec.request(
      id: 1, method: "x", params: .object(["publishedAt": .int(1_753_142_400_000)]))
    #expect(text.contains("1753142400000"))
    #expect(!text.contains("e+"))
  }
}

@Suite struct RpcDecodeTests {
  @Test func aResultCarriesItsId() {
    let frame = RpcCodec.decode(Frame.result(id: 3, .object(["subId": .string("s1")])))
    guard case .result(let id, let result) = frame else {
      Issue.record("expected a result, got \(frame)")
      return
    }
    #expect(id == 3)
    #expect(result["subId"]?.stringValue == "s1")
  }

  @Test func aFailureCarriesTheTaxonomyWordAndItsRetryability() throws {
    let details = try Fixture.json("error-data.unavailable")["details"]
    let frame = RpcCodec.decode(
      Frame.failure(
        id: 4, kind: "UNAVAILABLE", message: "index is rebuilding", retryable: true,
        details: details, code: -32006))
    guard case .failure(let id, let error) = frame else {
      Issue.record("expected a failure, got \(frame)")
      return
    }
    #expect(id == 4)
    #expect(error.kind == "UNAVAILABLE")
    #expect(error.retryable)
    #expect(error.code == -32006)
    #expect(error.unavailable?.service == "index")
    #expect(error.unavailable?.state == "rebuilding")
    #expect(error.unavailable?.progress == 0.42)
    #expect(!error.isTerminal)
  }

  @Test func theThreeTerminalRefusalsAreTerminalAndNothingElseIs() {
    for kind in ["INCOMPATIBLE", "UNAUTHORIZED", "PRECONDITION_FAILED"] {
      #expect(FieldProductError(kind: kind, message: "no").isTerminal)
    }
    for kind in ["UNAVAILABLE", "NOT_FOUND", "TIMEOUT", "FORBIDDEN_SCOPE", "INTERNAL"] {
      #expect(!FieldProductError(kind: kind, message: "no").isTerminal)
    }
  }

  @Test func anErrorWithoutDataStillReads() {
    let raw = #"{"jsonrpc":"2.0","id":9,"error":{"code":-32600,"message":"bad"}}"#
    guard case .failure(_, let error) = RpcCodec.decode(raw) else {
      Issue.record("expected a failure")
      return
    }
    #expect(error.kind == "INTERNAL")
    #expect(error.message == "bad")
    #expect(!error.retryable)
  }

  @Test func subscriptionEventsSplitBySuffix() {
    let delta = RpcCodec.decode(
      Frame.subscriptionEvent(
        method: "agent.subscribe.delta", subId: "s1", payload: .object(["revision": .int(2)])))
    guard case .subscriptionEvent(_, let subId, let kind, let payload) = delta else {
      Issue.record("expected a subscription event, got \(delta)")
      return
    }
    #expect(subId == "s1")
    #expect(kind == .delta)
    #expect(payload["revision"] == .int(2))

    let snapshot = RpcCodec.decode(
      Frame.subscriptionEvent(method: "agent.subscribe.snapshot", subId: "s1", payload: .null))
    guard case .subscriptionEvent(_, _, let snapshotKind, _) = snapshot else {
      Issue.record("expected a subscription event")
      return
    }
    #expect(snapshotKind == .snapshot)
  }

  @Test func aPlainNotificationIsNotASubscriptionEvent() {
    let frame = RpcCodec.decode(Frame.notification(method: "shell.something"))
    guard case .notification(let method, _) = frame else {
      Issue.record("expected a notification, got \(frame)")
      return
    }
    #expect(method == "shell.something")
  }

  /// A method with a subId but an unknown suffix is a notification, not a
  /// guess at which half of a subscription it might be.
  @Test func aSubIdWithAnUnknownSuffixStaysANotification() {
    let frame = RpcCodec.decode(
      Frame.subscriptionEvent(method: "agent.subscribe.wat", subId: "s1", payload: .null))
    guard case .notification = frame else {
      Issue.record("expected a notification, got \(frame)")
      return
    }
  }

  @Test func garbageIsUnreadableAndNeverFatal() {
    for raw in ["not json at all", "[1,2,3]", "\"a string\"", "{}"] {
      guard case .unreadable = RpcCodec.decode(raw) else {
        Issue.record("expected `\(raw)` to be unreadable")
        continue
      }
    }
  }
}
