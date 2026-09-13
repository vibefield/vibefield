import Foundation
import Observation

/// What the door told us about itself at hello.
public struct ProductReady: Sendable, Equatable {
  public let contractsVersion: String
  public let serverKind: String
  /// The grant this connection actually has. On the tailnet door the phone
  /// presents NO token — WhoIs makes a matching login a `self` principal and
  /// the preset does the rest — so this list is the only honest answer to
  /// "what may I ask for", and a screen that greys a control reads it.
  public let grantedScopes: [String]
  public let nativeBuild: String?
  public let userId: String?

  public init(ack: HelloAck) {
    contractsVersion = ack.contractsVersion
    serverKind = ack.serverKind
    grantedScopes = ack.grantedScopes
    nativeBuild = ack.nativeBuild
    userId = ack.userId
  }

  public func has(_ scope: String) -> Bool { grantedScopes.contains(scope) }
}

/// A live subscription. Cancelling is explicit: a handle that unsubscribed
/// itself on `deinit` would end a board the moment a view body dropped its
/// reference, which is a bug that only shows up on a slow frame.
@MainActor
public final class ProductSubscription {
  public let subId: String
  private let key: Int
  private weak var client: FieldProductClient?
  private var cancelled = false

  init(subId: String, key: Int, client: FieldProductClient) {
    self.subId = subId
    self.key = key
    self.client = client
  }

  public func cancel() {
    guard !cancelled else { return }
    cancelled = true
    client?.unsubscribe(key: key)
  }
}

/// The phone's product-API client (H-D3): JSON-RPC 2.0 over one WebSocket to a
/// desktop's capability URL, `system.hello` first, calls with ids, snapshot-
/// then-delta subscriptions, and a re-dial that replays every subscription for
/// a FRESH snapshot (P5 — reconnect IS re-snapshot; there is no ack protocol
/// and no attempt to replay the frames a dropped socket missed).
///
/// It is a `@MainActor` model and not an actor, deliberately: this is the
/// TypeScript client's own shape (`packages/fieldd-client/src/client.ts`), a
/// single-threaded state machine whose ordering rules — install the
/// subscription route BEFORE resolving the call, ignore a stale socket's
/// events, schedule at most one reconnect — are the lessons that file carries
/// forward, and they are lessons about ORDER. An actor would buy parallelism
/// this client has no use for and cost the one property its correctness rests
/// on. The socket itself is an actor (`ProductTransport`), which is where the
/// concurrency actually is.
///
/// Nothing here knows what a bubble is. Nothing here imports Ghosttea.
@MainActor
@Observable
public final class FieldProductClient {
  public enum State: Sendable, Equatable {
    /// Nobody has dialed. Not the same as `failed` and not the same as a door
    /// that answered with nothing.
    case off
    case connecting
    case ready(ProductReady)
    /// The socket dropped and a re-dial is scheduled. The rows on screen are
    /// the last board that WAS true, and the UX says so rather than blanking.
    case reconnecting
    /// Terminal. `INCOMPATIBLE`, `UNAUTHORIZED` and `PRECONDITION_FAILED` at
    /// hello cannot be fixed by asking again with the same version and the
    /// same (absent) token, so this client stops instead of pretending.
    case failed(FieldProductError)
    case closed
  }

  public struct Options: Sendable {
    /// The dial address. On the tailnet this is `productEndpoint.url` from the
    /// desktop's `field.devices.v1` slice — the C3 secret path.
    public var maxBackoff: Duration
    /// How long a call waits before it is a `TIMEOUT`. A phone needs this; the
    /// desktop client does not, because a loopback socket that stops answering
    /// also closes, and a radio's does not.
    public var callTimeout: Duration
    /// C5/D32 — the identity CLAIM in hello. A label only; the grant is the
    /// door's preset either way.
    public var deviceId: String?
    /// UA-2 — which user this client EXPECTS the daemon to serve. Restrict-only.
    public var userId: String?
    /// Empty = no credential in hello, which is RIGHT on the tailnet door: the
    /// phone is authenticated by WhoIs and a token there would be wrong, not
    /// merely absent (C5).
    public var credential: String

    public init(
      maxBackoff: Duration = .seconds(10),
      callTimeout: Duration = .seconds(20),
      deviceId: String? = nil,
      userId: String? = nil,
      credential: String = ""
    ) {
      self.maxBackoff = maxBackoff
      self.callTimeout = callTimeout
      self.deviceId = deviceId
      self.userId = userId
      self.credential = credential
    }
  }

  public private(set) var state: State = .off
  /// The last refusal, kept after the state has moved on so a screen can say
  /// WHY it is reconnecting.
  public private(set) var lastError: FieldProductError?
  /// The tolerant reader's other half, bounded: fields the door sent that this
  /// build does not read. Not an error, never fatal, and never silent.
  public private(set) var tolerantNotes: [String] = []

  /// The dial target. NOT public and NOT observable: it carries the C3
  /// capability secret in its path, and a public property on an `@Observable`
  /// model is one `Text(client.url)` away from being on a screen — or in a
  /// screenshot. Callers that need to know whether this client already points
  /// somewhere ask `targets(_:)`.
  private let url: URL

  @ObservationIgnored private let transport: any ProductTransport
  @ObservationIgnored private let options: Options

  @ObservationIgnored private var connection: (any ProductConnection)?
  @ObservationIgnored private var receiveTask: Task<Void, Never>?
  /// The dial in flight, held so `connect()` is idempotent across the await
  /// that precedes `connection` being assigned.
  @ObservationIgnored private var dialTask: Task<Void, Never>?
  @ObservationIgnored private var reconnectTask: Task<Void, Never>?
  @ObservationIgnored private var nextId: Int64 = 1
  @ObservationIgnored private var pending: [Int64: Pending] = [:]
  @ObservationIgnored private var subs: [Int: SubEntry] = [:]
  @ObservationIgnored private var subRoutes: [String: Int] = [:]
  /// Subscriptions cancelled while they had no live route — during a reconnect,
  /// before the replay answered. The id they must unsubscribe does not exist
  /// yet; `handle` fires it the moment the door names one.
  @ObservationIgnored private var cancelledBeforeRouted: Set<Int> = []
  @ObservationIgnored private var nextSubKey = 1
  @ObservationIgnored private var attempts = 0
  @ObservationIgnored private var closedByUser = false
  @ObservationIgnored private var readyWaiters: [CheckedContinuation<Void, any Error>] = []
  /// Bumped at every dial. Every callback checks it, so a socket that was
  /// superseded while an await was in flight can never write to this client —
  /// the NativeLink lesson the TypeScript client carries as `if (this.ws !== ws)`.
  @ObservationIgnored private var generation = 0
  /// Which dial's refusal `lastError` is holding.
  ///
  /// A door that refuses a hello then drops the socket says TWO things, a
  /// second apart: "fieldd is still adopting", and "the connection closed". The
  /// first is the reason; the second is its consequence, and letting the
  /// consequence overwrite the reason is how an honest UNAVAILABLE turns into a
  /// shrug. The door's own words win for the life of the dial that heard them.
  @ObservationIgnored private var lastErrorGeneration = -1

  /// Whether this client is already pointed at that URL — the one question
  /// about the target a caller may ask, so a re-dial can tell a NEW capability
  /// path from the same one without the path ever leaving this object.
  public func targets(_ other: URL) -> Bool { url == other }

  public init(url: URL, transport: any ProductTransport, options: Options = Options()) {
    self.url = url
    self.transport = transport
    self.options = options
  }

  // MARK: - Lifecycle

  /// Idempotent, INCLUDING while a dial is in flight.
  ///
  /// `connection` is assigned after an await, so guarding on it alone left a
  /// window: three concurrent `call()`s each reached `ready()` → `connect()`
  /// before any of them had a socket, and built three. Two were then abandoned
  /// — and, before the fix above, never closed. The in-flight dial is held in
  /// a task assigned synchronously, so the second caller sees it and waits.
  public func connect() {
    guard !closedByUser else { return }
    if case .failed = state { return }
    guard connection == nil, reconnectTask == nil, dialTask == nil else { return }
    dial(reconnecting: false)
  }

  /// Ends this client for good. A closed client never reopens — a fresh one is
  /// a fresh dial, and reusing a corpse would carry its subscriptions' ghosts.
  public func close() {
    closedByUser = true
    reconnectTask?.cancel()
    reconnectTask = nil
    dialTask?.cancel()
    dialTask = nil
    receiveTask?.cancel()
    receiveTask = nil
    let connection = self.connection
    self.connection = nil
    generation &+= 1
    Task { await connection?.close() }
    failPending(FieldProductError(kind: "UNAVAILABLE", message: "client closed"))
    subs.removeAll()
    subRoutes.removeAll()
    cancelledBeforeRouted.removeAll()
    state = .closed
    flushReadyWaiters(FieldProductError(kind: "UNAVAILABLE", message: "client closed"))
  }

  /// Resolves once hello has succeeded; throws if this client is dead.
  public func ready() async throws {
    switch state {
    case .ready: return
    case .failed(let error): throw error
    case .closed: throw FieldProductError(kind: "UNAVAILABLE", message: "client closed")
    default: break
    }
    connect()
    try await withCheckedThrowingContinuation { continuation in
      readyWaiters.append(continuation)
    }
  }

  // MARK: - Calls

  /// One request, one answer. Waits for hello first, like every other caller.
  @discardableResult
  public func call(_ method: String, params: JSONValue? = nil) async throws -> JSONValue {
    try await ready()
    return try await send(method: method, params: params)
  }

  /// The same, read into a shape of ours.
  public func call<T>(
    _ method: String, params: JSONValue? = nil, as make: (JSONValue) throws -> T
  ) async throws -> T {
    try make(try await call(method, params: params))
  }

  /// The same, into any `Decodable` — the tolerant readers in this target all
  /// conform, so `try await client.call("device.list", as: DeviceListResult.self)`
  /// reads as one line.
  public func call<T: Decodable>(
    _ method: String, params: JSONValue? = nil, as type: T.Type
  ) async throws -> T {
    try (try await call(method, params: params)).decode(type)
  }

  // MARK: - Subscriptions

  /// Snapshot-then-delta. The FIRST snapshot arrives through `onSnapshot` just
  /// as a reconnect's does, so a caller has ONE path for a board however many
  /// times the socket has dropped under it.
  @discardableResult
  public func subscribe(
    _ method: String,
    params: JSONValue? = nil,
    onSnapshot: @escaping @MainActor (JSONValue) -> Void,
    onDelta: @escaping @MainActor (JSONValue) -> Void
  ) async throws -> ProductSubscription {
    let key = nextSubKey
    nextSubKey += 1
    subs[key] = SubEntry(
      method: method, params: params, onSnapshot: onSnapshot, onDelta: onDelta)
    do {
      try await ready()
      let result = try await send(
        method: method, params: params, subKey: key, dropSubOnFailure: true)
      guard let subId = result["subId"]?.stringValue else {
        subs.removeValue(forKey: key)
        throw WireDecodeError(shape: method, reason: "subscribe answered without a subId")
      }
      onSnapshot(result["snapshot"] ?? .null)
      return ProductSubscription(subId: subId, key: key, client: self)
    } catch {
      // Never leave an orphan the caller cannot cancel — and never leave a
      // LIVE subscription on the daemon that nobody on this side owns. If the
      // door got far enough to name a subId, it is told; if it never did
      // (a deadline, a dead socket), the subscription dies with that socket,
      // which is the door's own rule.
      let orphan = subs.removeValue(forKey: key)
      if let subId = orphan?.subId {
        subRoutes.removeValue(forKey: subId)
        sendUnsubscribe(subId)
      }
      throw error
    }
  }

  func unsubscribe(key: Int) {
    guard let entry = subs.removeValue(forKey: key) else {
      cancelledBeforeRouted.remove(key)
      return
    }
    // The id on the entry is the last one the DOOR gave us, and after a drop
    // it names a socket that no longer exists — the replay has not answered
    // yet, so the new one has no name. Sending the old id to the new socket
    // unsubscribes nothing and may unsubscribe somebody else's board.
    //
    // A live route is the proof that the id belongs to THIS socket. Without
    // one, the cancel waits for the replay's answer and fires against the id
    // that comes back (see `handle`).
    if let subId = entry.subId, subRoutes[subId] == key {
      subRoutes.removeValue(forKey: subId)
      sendUnsubscribe(subId)
      cancelledBeforeRouted.remove(key)
      return
    }
    if let subId = entry.subId { subRoutes.removeValue(forKey: subId) }
    cancelledBeforeRouted.insert(key)
  }

  /// Tell the door, best effort. A refusal here changes nothing we can act on:
  /// the subscription is already ours no longer, and the socket's close is the
  /// backstop.
  private func sendUnsubscribe(_ subId: String) {
    guard case .ready = state else { return }
    Task { [weak self] in
      _ = try? await self?.send(
        method: "system.unsubscribe", params: .object(["subId": .string(subId)]))
    }
  }

  // MARK: - Backoff (pure — pinned by tests, no clock)

  /// The TypeScript client's own ladder: 500 ms doubling to a ceiling. Attempt
  /// 0 is the first re-dial after a drop, so a healthy blip costs half a second.
  public static func backoff(attempt: Int, ceiling: Duration) -> Duration {
    let capped = min(attempt, 20)  // 500ms << 20 is already days; never overflow
    let milliseconds = 500 * (1 << capped)
    return min(.milliseconds(milliseconds), ceiling)
  }

  // MARK: - Internals

  private struct Pending {
    let continuation: CheckedContinuation<JSONValue, any Error>
    let subKey: Int?
    /// An initial `subscribe()` has a caller waiting that cannot be handed a
    /// replacement handle after a drop, so its entry goes. A REPLAY already has
    /// an owner and must keep its entry to be replayed again.
    let dropSubOnFailure: Bool
    let deadline: Task<Void, Never>?
  }

  private struct SubEntry {
    let method: String
    let params: JSONValue?
    let onSnapshot: @MainActor (JSONValue) -> Void
    let onDelta: @MainActor (JSONValue) -> Void
    var subId: String?
    /// True once a subscribe request has reached a live socket. Only those are
    /// replayed; one still owned by a pending `subscribe()` call is not.
    var sentOnce = false

    init(
      method: String, params: JSONValue?,
      onSnapshot: @escaping @MainActor (JSONValue) -> Void,
      onDelta: @escaping @MainActor (JSONValue) -> Void
    ) {
      self.method = method
      self.params = params
      self.onSnapshot = onSnapshot
      self.onDelta = onDelta
    }
  }

  private func dial(reconnecting: Bool) {
    generation &+= 1
    let token = generation
    state = reconnecting ? .reconnecting : .connecting
    // Assigned SYNCHRONOUSLY: the body cannot run until this actor next
    // suspends, so a concurrent `connect()` always sees the task that is
    // already dialing.
    dialTask = Task { [weak self] in
      guard let self else { return }
      defer { if token == self.generation { self.dialTask = nil } }
      do {
        let connection = try await self.transport.connect(to: self.url)
        guard token == self.generation else {
          await connection.close()
          return
        }
        self.connection = connection
        self.startReceiving(connection, token: token)
        await self.hello(connection, token: token)
      } catch {
        self.socketDown(token: token, error: error)
      }
    }
  }

  private func startReceiving(_ connection: any ProductConnection, token: Int) {
    receiveTask?.cancel()
    receiveTask = Task { [weak self] in
      while !Task.isCancelled {
        do {
          let text = try await connection.receive()
          guard let self, token == self.generation else { return }
          self.handle(frame: RpcCodec.decode(text))
        } catch {
          self?.socketDown(token: token, error: error)
          return
        }
      }
    }
  }

  private func hello(_ connection: any ProductConnection, token: Int) async {
    var fields: [String: JSONValue] = [
      "contractsVersion": .string(FieldProductContract.contractsVersion),
      "minCompatible": .string(FieldProductContract.minCompatible),
      "clientKind": .string(FieldProductContract.clientKind),
    ]
    if !options.credential.isEmpty { fields["credential"] = .string(options.credential) }
    if let deviceId = options.deviceId { fields["deviceId"] = .string(deviceId) }
    if let userId = options.userId { fields["userId"] = .string(userId) }

    do {
      let result = try await send(method: "system.hello", params: .object(fields))
      guard token == generation else { return }
      let ack = try HelloAck(json: result)
      note(unknownFields: ack.unknownFields, shape: "HelloAck")
      attempts = 0
      lastError = nil
      lastErrorGeneration = -1
      state = .ready(ProductReady(ack: ack))
      flushReadyWaiters(nil)
      await replaySubscriptions(token: token)
    } catch {
      guard token == generation else { return }
      let refusal = Self.refusal(from: error)
      if refusal.isTerminal {
        fail(refusal)
        return
      }
      // Transient. Drop the socket; its close schedules the re-dial, so there
      // is exactly one path into the backoff ladder.
      record(refusal, for: token)
      await connection.close()
      socketDown(token: token, error: refusal)
    }
  }

  /// Every established subscription, re-sent for a fresh snapshot (P5).
  ///
  /// TWO RULES, both of them scars. A subscription that vanished mid-replay
  /// (its handle was cancelled while we awaited) skips — it does NOT end the
  /// loop, because the boards after it in the key order are still owned and
  /// their routes were cleared when the socket went. And a replay that FAILS
  /// takes the socket down rather than returning quietly: the door answering
  /// `NOT_FOUND` for a board that is gone, or a deadline on a slow radio, are
  /// ordinary weather, and the old code left every remaining subscription
  /// unsent with the client sitting in `.ready` — a frozen field under a state
  /// that said fine, for the life of that socket. Dropping the socket puts the
  /// re-dial in charge, which replays all of them from the top.
  ///
  /// This is the TypeScript client's shape: its replay rejection reaches
  /// hello's own catch, which closes the socket (`client.ts:302`).
  private func replaySubscriptions(token: Int) async {
    for key in subs.keys.sorted() {
      guard token == generation else { return }
      guard let entry = subs[key], entry.sentOnce else { continue }
      do {
        let result = try await send(method: entry.method, params: entry.params, subKey: key)
        guard token == generation else { return }
        // Cancelled while we awaited: its board is nobody's now, and the rest
        // of the loop is still owed.
        guard let live = subs[key] else { continue }
        live.onSnapshot(result["snapshot"] ?? .null)
      } catch {
        guard token == generation else { return }
        let refusal = Self.refusal(from: error)
        record(refusal, for: token)
        note("replaying \(entry.method) failed — re-dialing: \(refusal.message)")
        let dying = connection
        connection = nil
        if let dying { Task { await dying.close() } }
        socketDown(token: token, error: refusal)
        return
      }
    }
  }

  private func handle(frame: RpcFrame) {
    switch frame {
    case .result(let id, let result):
      guard let entry = pending.removeValue(forKey: id) else { return }
      entry.deadline?.cancel()
      // Install the subscription route BEFORE resuming the caller: a delta can
      // land in the very next frame, and a route installed after an await is a
      // dropped first delta (the NativeLink lesson, kept on principle).
      if let key = entry.subKey, let subId = result["subId"]?.stringValue {
        subRoutes[subId] = key
        subs[key]?.subId = subId
        // Cancelled while this was in flight: now there is an id to name.
        if cancelledBeforeRouted.remove(key) != nil {
          subRoutes.removeValue(forKey: subId)
          subs.removeValue(forKey: key)
          sendUnsubscribe(subId)
        }
      }
      entry.continuation.resume(returning: result)

    case .failure(let id, let error):
      guard let entry = pending.removeValue(forKey: id) else { return }
      entry.deadline?.cancel()
      if let key = entry.subKey, entry.dropSubOnFailure { subs.removeValue(forKey: key) }
      entry.continuation.resume(throwing: error)

    case .subscriptionEvent(_, let subId, let kind, let payload):
      guard let key = subRoutes[subId], let entry = subs[key] else { return }
      switch kind {
      case .snapshot: entry.onSnapshot(payload)
      case .delta: entry.onDelta(payload)
      }

    case .notification:
      // Server-originated control notifications have no consumer on the phone
      // yet. Ignoring one is the tolerant reader's answer, not a defect.
      break

    case .unreadable(let reason):
      note("unreadable frame: \(reason)")
    }
  }

  private func send(
    method: String, params: JSONValue?, subKey: Int? = nil, dropSubOnFailure: Bool = false
  ) async throws -> JSONValue {
    guard let connection else {
      throw FieldProductError(kind: "UNAVAILABLE", message: "not connected", retryable: true)
    }
    if let subKey { subs[subKey]?.sentOnce = true }
    let id = nextId
    nextId += 1
    let text = try RpcCodec.request(id: id, method: method, params: params)
    let callTimeout = options.callTimeout

    return try await withCheckedThrowingContinuation { continuation in
      let deadline = Task { [weak self] in
        try? await Task.sleep(for: callTimeout)
        guard !Task.isCancelled else { return }
        self?.timeOut(id: id, method: method)
      }
      pending[id] = Pending(
        continuation: continuation, subKey: subKey, dropSubOnFailure: dropSubOnFailure,
        deadline: deadline)
      Task { [weak self] in
        do {
          try await connection.send(text)
        } catch {
          self?.failOne(id: id, with: Self.refusal(from: error))
        }
      }
    }
  }

  private func timeOut(id: Int64, method: String) {
    failOne(
      id: id,
      with: FieldProductError(
        kind: "TIMEOUT", message: "\(method) did not answer", retryable: true))
  }

  private func failOne(id: Int64, with error: FieldProductError) {
    guard let entry = pending.removeValue(forKey: id) else { return }
    entry.deadline?.cancel()
    if let key = entry.subKey, entry.dropSubOnFailure { subs.removeValue(forKey: key) }
    entry.continuation.resume(throwing: error)
  }

  private func socketDown(token: Int, error: any Error) {
    guard token == generation else { return }  // a stale socket's last word
    // CLOSE WHAT YOU WALK AWAY FROM. The real transport's `connect` never
    // throws — it builds a URLSession and hands back a task at once — so a
    // dial that never reaches a door still leaves a live session behind, and
    // only `close()` (`invalidateAndCancel`) ends one. Dropping the reference
    // alone leaked one session per backoff tick against a sleeping desktop.
    let dying = connection
    connection = nil
    if let dying { Task { await dying.close() } }
    receiveTask?.cancel()
    receiveTask = nil
    record(Self.refusal(from: error), for: token)
    failPending(FieldProductError(kind: "UNAVAILABLE", message: "connection closed", retryable: true))
    subRoutes.removeAll()
    if closedByUser { return }
    switch state {
    case .failed, .closed: return
    default: scheduleReconnect()
    }
  }

  /// At most one reconnect is ever scheduled.
  private func scheduleReconnect() {
    guard !closedByUser, reconnectTask == nil, connection == nil else { return }
    if case .failed = state { return }
    let delay = Self.backoff(attempt: attempts, ceiling: options.maxBackoff)
    attempts += 1
    state = .reconnecting
    reconnectTask = Task { [weak self] in
      try? await Task.sleep(for: delay)
      guard let self, !Task.isCancelled else { return }
      self.reconnectTask = nil
      guard !self.closedByUser else { return }
      self.dial(reconnecting: true)
    }
  }

  /// The standing reason for this dial. The first refusal a dial hears is the
  /// one that is kept — see `lastErrorGeneration`.
  private func record(_ error: FieldProductError, for token: Int) {
    guard lastErrorGeneration != token else { return }
    lastErrorGeneration = token
    lastError = error
  }

  private func fail(_ error: FieldProductError) {
    lastErrorGeneration = generation
    lastError = error
    let connection = self.connection
    self.connection = nil  // detach first: this socket's close is now stale
    generation &+= 1
    dialTask?.cancel()
    dialTask = nil
    receiveTask?.cancel()
    receiveTask = nil
    state = .failed(error)
    Task { await connection?.close() }
    failPending(error)
    flushReadyWaiters(error)
  }

  private func failPending(_ error: FieldProductError) {
    let entries = pending
    pending.removeAll()
    for (_, entry) in entries {
      entry.deadline?.cancel()
      if let key = entry.subKey, entry.dropSubOnFailure { subs.removeValue(forKey: key) }
      entry.continuation.resume(throwing: error)
    }
  }

  private func flushReadyWaiters(_ error: (any Error)?) {
    let waiters = readyWaiters
    readyWaiters = []
    for waiter in waiters {
      if let error {
        waiter.resume(throwing: error)
      } else {
        waiter.resume()
      }
    }
  }

  private func note(unknownFields: [String], shape: String) {
    guard !unknownFields.isEmpty else { return }
    note("\(shape) carried unread fields: \(unknownFields.joined(separator: ", "))")
  }

  private func note(_ line: String) {
    guard !tolerantNotes.contains(line) else { return }
    tolerantNotes.append(line)
    if tolerantNotes.count > 32 { tolerantNotes.removeFirst() }
  }

  /// Any thrown thing, as a refusal. A transport error is `UNAVAILABLE` and
  /// retryable — the socket is gone, and the socket coming back is exactly what
  /// would fix it.
  static func refusal(from error: any Error) -> FieldProductError {
    if let refusal = error as? FieldProductError { return refusal }
    if let decode = error as? WireDecodeError {
      return FieldProductError(kind: "INCOMPATIBLE", message: decode.description)
    }
    if error is CancellationError {
      return FieldProductError(kind: "UNAVAILABLE", message: "cancelled", retryable: true)
    }
    return FieldProductError(
      kind: "UNAVAILABLE", message: shortReason(error), retryable: true)
  }

  /// An error rendered for a status line, WITHOUT its URL.
  ///
  /// `URLError`'s `localizedDescription` and its `userInfo` both carry
  /// `NSErrorFailingURLStringKey` — the capability path, secret and all — and
  /// the old rendering kept it out only by accident: a 117-character truncation
  /// that happened to cut just before the URL. An accident is not a redaction.
  /// A transport failure is named by its DOMAIN and CODE, which is what a
  /// person can act on anyway ("the socket refused", not which path).
  static func shortReason(_ error: any Error) -> String {
    if let refusal = error as? FieldProductError { return refusal.message }
    if let decode = error as? WireDecodeError { return decode.description }
    let ns = error as NSError
    return "\(ns.domain) \(ns.code)"
  }
}
