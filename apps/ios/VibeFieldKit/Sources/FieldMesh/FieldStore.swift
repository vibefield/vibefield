import FieldProduct
import Foundation
import Observation

// The synced-store READER (§10.3). truffle's SyncedStore is namespaced JSON on
// `ss:<storeId>`, and this is the half of it a phone needs: the phone owns no
// slice, publishes nothing, and answers nobody's `request` — it asks, and it
// listens. `field.devices.v1` is how it learns a desktop's door;
// `terminal.v1.hosts` is the floor's advertised sessions; `field.agents.v1`
// will be the board.
//
// The protocol is transcribed from `truffle-core 0.7.12`
// (`src/synced_store/{types,sync}.rs`), which is the pinned crate both daemon
// planes run: `{type: "update"|"full", device_id, data, version, updated_at}`,
// `{type: "request"}`, `{type: "clear", device_id}` — snake_case, with `type`
// INSIDE the payload and ALSO as the envelope's `msg_type` (the Rust sends
// both; this reader trusts the payload's, because that is the one serde's
// tagged enum actually round-trips).

/// One device's slice of a store, as this phone last heard it.
public struct FieldStoreSlice: Sendable, Equatable, Identifiable {
  /// The slice key: the publisher's DURABLE device id (a ULID). RFC 017 §8 —
  /// propagated peer to peer in truffle's hello, and deliberately NOT the
  /// Tailscale node id, which is the routing keyspace and a different thing.
  public let deviceId: String
  public let data: JSONValue
  /// Per-device and monotonic. A lower or equal version is a replay and is
  /// dropped, which is the whole of the store's conflict rule.
  public let version: Int64
  /// The publisher's clock, in milliseconds. Kept as it was sent — a phone's
  /// clock has no business rewriting a desktop's timestamp.
  public let updatedAt: Int64
  /// The AUTHENTICATED sender this slice arrived from (truffle's hello-verified
  /// identity, never the wire's own `device_id`). See `attributionMismatches`.
  public let sentBy: String?

  public var id: String { deviceId }

  public init(
    deviceId: String, data: JSONValue, version: Int64, updatedAt: Int64, sentBy: String? = nil
  ) {
    self.deviceId = deviceId
    self.data = data
    self.version = version
    self.updatedAt = updatedAt
    self.sentBy = sentBy
  }

  /// Read this slice as a shape of ours — `DeviceInfo` for `field.devices.v1`,
  /// `AgentFieldSlice` for `field.agents.v1`.
  public func decode<T: Decodable>(_ type: T.Type) throws -> T {
    try data.decode(type)
  }
}

/// One message on `ss:<storeId>`.
public enum StoreSyncMessage: Sendable, Equatable {
  case update(FieldStoreSlice)
  case full(FieldStoreSlice)
  /// A peer asking for OUR slice. The phone has none, so this is heard and not
  /// answered — which is the correct answer, not a silent drop.
  case request
  case clear(deviceId: String)

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "StoreSyncMessage", value: json)
    let type = try object.requiredString("type")
    switch type {
    case "request":
      self = .request
    case "clear":
      self = .clear(deviceId: try object.requiredString("device_id"))
    case "update", "full":
      let slice = FieldStoreSlice(
        deviceId: try object.requiredString("device_id"),
        data: object.value("data") ?? .null,
        version: try object.requiredInt("version"),
        updatedAt: object.int("updated_at") ?? 0)
      self = type == "update" ? .update(slice) : .full(slice)
    default:
      throw WireDecodeError(shape: "StoreSyncMessage", reason: "unknown type `\(type)`")
    }
  }

  static let requestPayload = JSONValue.object(["type": .string("request")])
}

// MARK: - The doors

/// A peer, as this reader needs one.
public struct FieldStorePeer: Sendable, Equatable, Identifiable {
  /// The ROUTING key — truffle's Tailscale stable node id. What a send is
  /// addressed to.
  public let id: String
  /// The DURABLE key — the ULID the store's slices are filed under, learned at
  /// truffle's hello. Nil before the hello has completed, which is honest: a
  /// peer we have not spoken to yet cannot be matched to a slice.
  public let deviceId: String?
  public let online: Bool

  public init(id: String, deviceId: String?, online: Bool) {
    self.id = id
    self.deviceId = deviceId
    self.online = online
  }
}

public enum FieldStorePeerEvent: Sendable {
  case upsert(FieldStorePeer)
  case left(FieldStorePeer)
}

/// One inbound message, with the sender truffle authenticated.
public struct FieldStoreInbound: Sendable {
  public let fromPeerId: String
  public let fromDeviceId: String?
  public let msgType: String
  public let payload: Data

  public init(fromPeerId: String, fromDeviceId: String?, msgType: String, payload: Data) {
    self.fromPeerId = fromPeerId
    self.fromDeviceId = fromDeviceId
    self.msgType = msgType
    self.payload = payload
  }
}

/// The three things a reader asks of a mesh node, as functions.
///
/// Injected rather than subclassed because `MeshNode` is an upstream ACTOR with
/// no seam of its own, and because the rules worth testing here — request on
/// start, version monotonicity, clear, a peer leaving — are rules about
/// MESSAGES, not about Tailscale.
public struct FieldStoreDoors: Sendable {
  public var onlinePeers: @Sendable () async -> [FieldStorePeer]
  public var send:
    @Sendable (_ peerId: String, _ namespace: String, _ msgType: String, _ payload: JSONValue)
      async throws -> Void
  public var messages: @Sendable (_ namespace: String) async -> AsyncStream<FieldStoreInbound>
  public var peerEvents: @Sendable () async -> AsyncStream<FieldStorePeerEvent>

  public init(
    onlinePeers: @escaping @Sendable () async -> [FieldStorePeer],
    send: @escaping @Sendable (String, String, String, JSONValue) async throws -> Void,
    messages: @escaping @Sendable (String) async -> AsyncStream<FieldStoreInbound>,
    peerEvents: @escaping @Sendable () async -> AsyncStream<FieldStorePeerEvent>
  ) {
    self.onlinePeers = onlinePeers
    self.send = send
    self.messages = messages
    self.peerEvents = peerEvents
  }
}

// MARK: - The reader

public enum FieldStoreState: Sendable, Equatable {
  /// Nobody is reading. Not the same as "reading, and the store is empty" —
  /// the first is a question nobody asked, the second is an answer.
  case closed
  case reading(storeId: String)
}

/// A store, read.
///
/// Nothing here publishes: `set` has no counterpart, a `request` from a peer is
/// heard and not answered, and the phone never appears in anybody else's store.
/// That is the corpus law about this device (it runs no fieldd and is not a
/// device row), spelled as an absent method rather than a comment.
@MainActor
@Observable
public final class FieldStore {
  /// Device id → that device's slice. The keyspace is the DURABLE one.
  public private(set) var slices: [String: FieldStoreSlice] = [:]
  public private(set) var state: FieldStoreState = .closed
  /// What was heard and not used, and why — a stale version, an unreadable
  /// payload, a peer that could not be asked. Bounded, deduplicated, and never
  /// an error: a store is a gossip protocol and a dropped message is Tuesday.
  public private(set) var notes: [String] = []
  /// Slices whose payload claimed a device id the AUTHENTICATED sender does not
  /// have. In truffle 0.7.12 a node only ever broadcasts its OWN slice, so this
  /// should be zero; it is COUNTED rather than refused because this reader has
  /// never watched a live mesh do it, and a guard written from a guess is how a
  /// phone silently reads nothing. When a live run confirms the keyspaces, this
  /// becomes a refusal (IOS-4b).
  public private(set) var attributionMismatches = 0

  @ObservationIgnored private let doors: FieldStoreDoors
  @ObservationIgnored private var messageTask: Task<Void, Never>?
  @ObservationIgnored private var peerTask: Task<Void, Never>?
  @ObservationIgnored private var generation = 0
  /// Peers we have asked, by routing id — so a peer flapping does not re-ask on
  /// every netmap tick, and so a peer that LEFT can be matched to its slice by
  /// the durable id we last saw it wearing.
  @ObservationIgnored private var asked: [String: String?] = [:]
  @ObservationIgnored private var paused = false

  public init(doors: FieldStoreDoors) {
    self.doors = doors
  }

  public var storeId: String? {
    if case .reading(let storeId) = state { return storeId }
    return nil
  }

  /// truffle's namespace for a store. `nonisolated` because it is a pure
  /// string: a caller should not need the main actor to spell one.
  public nonisolated static func namespace(for storeId: String) -> String { "ss:\(storeId)" }

  /// Begin reading. Idempotent for the same store; reading a different one is
  /// an unsubscribe and a fresh start, because slices are per-store and keeping
  /// the old ones would file one store's answers under another's name.
  public func subscribe(_ storeId: String) {
    if case .reading(let current) = state {
      guard current != storeId else { return }
      unsubscribe()
    }
    generation &+= 1
    let token = generation
    let namespace = Self.namespace(for: storeId)
    state = .reading(storeId: storeId)

    messageTask = Task { [doors] in
      let stream = await doors.messages(namespace)
      for await inbound in stream {
        guard !Task.isCancelled else { return }
        self.ingest(inbound, token: token)
      }
    }
    peerTask = Task { [doors] in
      let stream = await doors.peerEvents()
      for await event in stream {
        guard !Task.isCancelled else { return }
        await self.handle(event, namespace: namespace, token: token)
      }
    }
    Task { await self.requestFromOnlinePeers(namespace: namespace, token: token) }
  }

  /// Stop LISTENING, and keep what was heard.
  ///
  /// The phone in the background (§5): the door's subscription goes, and so do
  /// this reader's streams — but the mesh NODE is left running and the slices
  /// stand. They are not a claim that they are still true; `expiresAt` on the
  /// board inside them already decides that, and a long enough background makes
  /// every slice stale on its own. Forgetting them here instead would empty the
  /// field on a two-second app switch, which is a worse lie than a board that
  /// says how old it is.
  public func pause() {
    guard case .reading = state else { return }
    generation &+= 1
    messageTask?.cancel()
    messageTask = nil
    peerTask?.cancel()
    peerTask = nil
    asked.removeAll()
    paused = true
  }

  /// Listening again, and asking afresh: every online peer is re-`request`ed,
  /// so a board that changed while nobody was listening is replaced rather than
  /// waited for.
  public func resume() {
    guard paused, case .reading(let storeId) = state else { return }
    paused = false
    let restored = slices
    state = .closed
    subscribe(storeId)
    // `subscribe` starts clean; the slices heard before the pause are put back
    // under it, each still carrying its own version, so the first newer update
    // supersedes them by the ordinary rule.
    for (deviceId, slice) in restored where slices[deviceId] == nil {
      slices[deviceId] = slice
    }
  }

  public var isPaused: Bool { paused }

  /// Stop reading, and forget. A store nobody is watching holds no answers: the
  /// next subscribe asks again and is told afresh, which is cheaper than
  /// rendering a board from a mesh that has moved on.
  public func unsubscribe() {
    generation &+= 1
    messageTask?.cancel()
    messageTask = nil
    peerTask?.cancel()
    peerTask = nil
    asked.removeAll()
    slices.removeAll()
    paused = false
    state = .closed
  }

  /// Ask every online peer for its slice. truffle's own node does this on peer
  /// join AND sends its own data unasked; this one only asks, because it has
  /// nothing to send.
  public func requestFromOnlinePeers(namespace: String, token: Int) async {
    for peer in await doors.onlinePeers() where peer.online {
      guard token == generation else { return }
      await ask(peer, namespace: namespace)
    }
  }

  private func ask(_ peer: FieldStorePeer, namespace: String) async {
    asked[peer.id] = peer.deviceId
    do {
      try await doors.send(peer.id, namespace, "request", StoreSyncMessage.requestPayload)
    } catch {
      note("could not ask \(peer.id): \(MeshModel.shortReason(error))")
    }
  }

  private func handle(_ event: FieldStorePeerEvent, namespace: String, token: Int) async {
    guard token == generation else { return }
    switch event {
    case .upsert(let peer):
      guard peer.online else { return }
      // A peer already asked is not asked again: a netmap tick is not a join.
      // Its durable id is refreshed, though — an upsert is often exactly the
      // moment truffle's hello finally attached one.
      if asked.keys.contains(peer.id) {
        if let deviceId = peer.deviceId { asked[peer.id] = deviceId }
        return
      }
      await ask(peer, namespace: namespace)

    case .left(let peer):
      // The durable id is what files a slice, and a leaving peer may no longer
      // carry one — so the id we saw when we asked it stands in.
      let deviceId = peer.deviceId ?? (asked[peer.id] ?? nil)
      asked.removeValue(forKey: peer.id)
      guard let deviceId, slices.removeValue(forKey: deviceId) != nil else { return }
      note("dropped \(deviceId)'s slice: the peer left")
    }
  }

  /// One inbound message, folded in. Internal so the rules can be tested
  /// without a mesh — the seam is the doors, and this is what they feed.
  func ingest(_ inbound: FieldStoreInbound, token: Int) {
    guard token == generation else { return }
    let message: StoreSyncMessage
    do {
      message = try StoreSyncMessage(json: try JSONValue.parse(inbound.payload))
    } catch {
      note("ignored a \(inbound.msgType) from \(inbound.fromPeerId): \(error)")
      return
    }

    switch message {
    case .request:
      // Heard, and rightly unanswered: this device publishes no slice.
      break

    case .clear(let deviceId):
      guard slices.removeValue(forKey: deviceId) != nil else { return }
      note("dropped \(deviceId)'s slice: cleared")

    case .update(let slice), .full(let slice):
      if let sender = inbound.fromDeviceId, sender != slice.deviceId {
        attributionMismatches += 1
        note("\(inbound.fromPeerId) sent a slice claiming \(slice.deviceId)")
      }
      if let existing = slices[slice.deviceId], slice.version <= existing.version {
        note(
          "ignored \(slice.deviceId) v\(slice.version): not newer than v\(existing.version)")
        return
      }
      slices[slice.deviceId] = FieldStoreSlice(
        deviceId: slice.deviceId, data: slice.data, version: slice.version,
        updatedAt: slice.updatedAt, sentBy: inbound.fromDeviceId)
    }
  }

  /// Every slice, read as one shape. A slice that does not fit is NAMED rather
  /// than dropped in silence — one desktop on a newer build must not make the
  /// whole roster look empty.
  public func decodeAll<T: Decodable>(_ type: T.Type) -> (values: [String: T], failed: [String]) {
    var values: [String: T] = [:]
    var failed: [String] = []
    for (deviceId, slice) in slices {
      do {
        values[deviceId] = try slice.decode(type)
      } catch {
        failed.append("\(deviceId): \(MeshModel.shortReason(error))")
      }
    }
    return (values, failed)
  }

  private func note(_ line: String) {
    guard !notes.contains(line) else { return }
    notes.append(line)
    if notes.count > 32 { notes.removeFirst() }
  }
}
