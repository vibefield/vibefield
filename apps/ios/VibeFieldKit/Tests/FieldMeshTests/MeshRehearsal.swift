import FieldProduct
import Foundation

@testable import FieldMesh

/// A mesh made of streams and a list of peers.
///
/// The doors are closures for exactly this reason: every rule the reader has —
/// ask on start, ask a joiner once, take only newer versions, drop on clear,
/// drop when a peer leaves, ignore what does not parse — is a rule about
/// MESSAGES, and none of them wants Tailscale to be running.
///
/// It is namespace-aware because a node's `onMessage(namespace:)` is per
/// namespace, and a rehearsal that pooled them would let one store's message
/// land on another's. `FieldLink` reads ONE store since DS-D14
/// (`field.devices.v1`; `field.agents.v1` retired 2026-10-01), and a row proves
/// the retired namespace has no listener — which only a namespace-aware
/// rehearsal can say.
actor MeshRehearsal {
  struct Sent: Equatable {
    let peerId: String
    let namespace: String
    let msgType: String
    let payload: JSONValue
  }

  private(set) var sent: [Sent] = []
  private var peers: [FieldStorePeer] = []
  private var messages: [String: AsyncStream<FieldStoreInbound>.Continuation] = [:]
  /// A LIST: every store asks for its own peer-event stream, and two stores
  /// over one node get two.
  private var peerEvents: [AsyncStream<FieldStorePeerEvent>.Continuation] = []
  private var unreachable: Set<String> = []

  func set(peers: [FieldStorePeer]) { self.peers = peers }
  func refuse(_ peerId: String) { unreachable.insert(peerId) }

  var isListening: Bool { !messages.isEmpty && !peerEvents.isEmpty }

  func isListening(to namespace: String) -> Bool { messages[namespace] != nil }

  func requests(to peerId: String) -> Int {
    sent.filter { $0.peerId == peerId && $0.msgType == "request" }.count
  }

  func requests(to peerId: String, on namespace: String) -> Int {
    sent.filter {
      $0.peerId == peerId && $0.msgType == "request" && $0.namespace == namespace
    }.count
  }

  /// Deliver to every namespace being listened to — the single-store tests'
  /// shorthand, where there is only one.
  func deliver(_ inbound: FieldStoreInbound) {
    for (_, continuation) in messages { continuation.yield(inbound) }
  }

  /// Deliver to ONE namespace. What a real node does, and what the two-store
  /// tests need.
  func deliver(_ inbound: FieldStoreInbound, to namespace: String) {
    messages[namespace]?.yield(inbound)
  }

  func emit(_ event: FieldStorePeerEvent) {
    for continuation in peerEvents { continuation.yield(event) }
  }

  func doors() -> FieldStoreDoors {
    FieldStoreDoors(
      onlinePeers: { await self.onlinePeers() },
      send: { peerId, namespace, msgType, payload in
        try await self.record(
          Sent(peerId: peerId, namespace: namespace, msgType: msgType, payload: payload))
      },
      messages: { namespace in await self.messageStream(namespace) },
      peerEvents: { await self.peerEventStream() })
  }

  private func onlinePeers() -> [FieldStorePeer] { peers.filter(\.online) }

  private func record(_ entry: Sent) throws {
    if unreachable.contains(entry.peerId) { throw FieldStoreError.peerGone(entry.peerId) }
    sent.append(entry)
  }

  private func messageStream(_ namespace: String) -> AsyncStream<FieldStoreInbound> {
    let (stream, continuation) = AsyncStream.makeStream(of: FieldStoreInbound.self)
    messages[namespace] = continuation
    return stream
  }

  private func peerEventStream() -> AsyncStream<FieldStorePeerEvent> {
    let (stream, continuation) = AsyncStream.makeStream(of: FieldStorePeerEvent.self)
    peerEvents.append(continuation)
    return stream
  }
}

// MARK: - The wire, as truffle writes it

func sliceFrame(
  _ type: String, deviceId: String, version: Int64, updatedAt: Int64 = 1_757_808_000_000,
  data: JSONValue
) -> Data {
  (try? JSONValue.object([
    "type": .string(type),
    "device_id": .string(deviceId),
    "data": data,
    "version": .int(version),
    "updated_at": .int(updatedAt),
  ]).encoded()) ?? Data()
}

func clearFrame(deviceId: String) -> Data {
  (try? JSONValue.object(["type": .string("clear"), "device_id": .string(deviceId)])
    .encoded()) ?? Data()
}

func inbound(
  from peerId: String, deviceId: String?, msgType: String, payload: Data,
  addresses: [String] = ["studio", "100.64.0.2"]
) -> FieldStoreInbound {
  FieldStoreInbound(
    fromPeerId: peerId, fromDeviceId: deviceId, msgType: msgType, payload: payload,
    fromAddresses: addresses)
}

let studio = FieldStorePeer(
  id: "node-studio", deviceId: "dev-studio", online: true, hostname: "studio",
  tailnetIPs: ["100.64.0.2"])
let laptop = FieldStorePeer(
  id: "node-laptop", deviceId: "dev-laptop", online: true, hostname: "laptop",
  tailnetIPs: ["100.64.0.3"])
let asleep = FieldStorePeer(id: "node-asleep", deviceId: "dev-asleep", online: false)

/// The tailnet these rehearsals are on, so a peer's fully-qualified name can
/// be built the way the live check builds it.
let rehearsalSuffix = "tail.ts.net" 
