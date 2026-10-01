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

  /// SP-2 (a) — the last frame this subscription APPLIED (nil for a `stream`,
  /// and before the open answer).
  public var cursor: SubscriptionCursor? { client?.cursor(forKey: key) }

  /// How many times the table re-subscribed this for a fresh snapshot after a
  /// gap. A diagnostic.
  public var resnapshots: Int { client?.resnapshotCount(forKey: key) ?? 0 }

  /// Ask for a fresh snapshot — the owner's own belt, for a board it could not
  /// apply. The table already does this by itself on every gap it can see.
  public func resnapshot(because reason: String) {
    client?.resnapshot(key: key, because: reason)
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
    /// SP-2 (b) — the keepalive's numbers.
    public var keepalive: ProductKeepalive
    /// SP-2 — the clock every keepalive timer reads. Tests drive a manual one.
    public var clock: any ProductClock
    /// SP-2 (d) — the roster's word, asked before EVERY dial: the first, every
    /// re-dial after a drop, and the one after a silent door. `false` PARKS the
    /// client: nothing is dialled and nothing is scheduled until `connect()`
    /// asks again — the owner watches the roster and calls it.
    ///
    /// The phone's roster is the tailnet's own peer list: a peer listed online
    /// is `awake` or `restarting` (its node answers while its daemon comes back,
    /// and the backoff ladder is exactly what that needs) and is dialled; one
    /// listed offline is `asleep`, and one not listed is gone — neither is ever
    /// dialled. `nil` = no roster (a loopback door): always dial.
    public var mayDial: (@Sendable () async -> Bool)?
    /// SP-2 (h) — where each subscription's bytes-per-second line goes, and
    /// what this door is called in it (FieldLink passes the desktop's id).
    public var trafficLog: @Sendable (SubscriptionTraffic) -> Void
    public var logLabel: String?
    /// SP-2 (g) — the phone's budget this door's socket counts against. Nil:
    /// no budget (a loopback door, most tests).
    public var doorBudget: ProductDoorBudget?

    public init(
      maxBackoff: Duration = .seconds(10),
      callTimeout: Duration = .seconds(20),
      deviceId: String? = nil,
      userId: String? = nil,
      credential: String = "",
      keepalive: ProductKeepalive = .init(),
      clock: any ProductClock = SystemProductClock(),
      mayDial: (@Sendable () async -> Bool)? = nil,
      trafficLog: @escaping @Sendable (SubscriptionTraffic) -> Void = SubscriptionTraffic.log,
      logLabel: String? = nil,
      doorBudget: ProductDoorBudget? = nil
    ) {
      self.maxBackoff = maxBackoff
      self.callTimeout = callTimeout
      self.deviceId = deviceId
      self.userId = userId
      self.credential = credential
      self.keepalive = keepalive
      self.clock = clock
      self.mayDial = mayDial
      self.trafficLog = trafficLog
      self.logLabel = logLabel
      self.doorBudget = doorBudget
    }
  }

  public private(set) var state: State = .off
  /// The last refusal, kept after the state has moved on so a screen can say
  /// WHY it is reconnecting.
  public private(set) var lastError: FieldProductError?
  /// The tolerant reader's other half, bounded: fields the door sent that this
  /// build does not read. Not an error, never fatal, and never silent.
  public private(set) var tolerantNotes: [String] = []
  /// SP-2 (b) — the interval the door last announced in `system.tick`, or nil
  /// before its first tick (the registry's interval stands in until then).
  @ObservationIgnored public private(set) var doorTickIntervalMs: Int64?
  /// Diagnostics, never a state: protocol pings sent, and doors the receive
  /// deadline closed for silence.
  @ObservationIgnored public private(set) var pingsSent = 0
  @ObservationIgnored public private(set) var silentDoorCloses = 0
  /// SP-2 (d) — dials the roster turned away (a diagnostic, never a state).
  @ObservationIgnored public private(set) var parkedDials = 0

  /// The dial target. NOT public and NOT observable: it carries the C3
  /// capability secret in its path, and a public property on an `@Observable`
  /// model is one `Text(client.url)` away from being on a screen — or in a
  /// screenshot. Callers that need to know whether this client already points
  /// somewhere ask `targets(_:)`.
  private let url: URL

  @ObservationIgnored private let transport: any ProductTransport
  @ObservationIgnored private let options: Options

  @ObservationIgnored private var connection: (any ProductConnection)?
  /// SP-2 (g) — the budget slot `connection` holds, given back after its close.
  @ObservationIgnored private var connectionGrant: PhoneConnectionBudget.Grant?
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
  // SP-2 (b) — the keepalive's state, per socket. Both instants are on
  // `options.clock`'s timeline, and both timers exist only while a socket does.
  @ObservationIgnored private var lastInboundAt: Duration = .zero
  @ObservationIgnored private var lastSentAt: Duration = .zero
  @ObservationIgnored private var watchdogTask: Task<Void, Never>?
  @ObservationIgnored private var pingTask: Task<Void, Never>?
  @ObservationIgnored private var keepalivePaused = false
  /// SP-2 (h) — ONE timer for every subscription's traffic window, armed only
  /// while a window holds bytes: an idle board wakes nothing to say so.
  @ObservationIgnored private var trafficTask: Task<Void, Never>?
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
    stopKeepalive()
    trafficTask?.cancel()
    trafficTask = nil
    reconnectTask?.cancel()
    reconnectTask = nil
    dialTask?.cancel()
    dialTask = nil
    receiveTask?.cancel()
    receiveTask = nil
    retireConnection()
    generation &+= 1
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
    shape: SubscriptionShape = .stream,
    onSnapshot: @escaping @MainActor (JSONValue) -> Void,
    onDelta: @escaping @MainActor (JSONValue) -> Void
  ) async throws -> ProductSubscription {
    let key = nextSubKey
    nextSubKey += 1
    subs[key] = SubEntry(
      method: method, params: params, shape: shape, onSnapshot: onSnapshot, onDelta: onDelta)
    do {
      try await ready()
      guard let entry = subs[key] else {
        throw FieldProductError(kind: "UNAVAILABLE", message: "client closed", retryable: true)
      }
      let result = try await send(
        method: method, params: subscribeParams(for: entry, resuming: false), subKey: key,
        dropSubOnFailure: true)
      guard let subId = result["subId"]?.stringValue else {
        subs.removeValue(forKey: key)
        throw WireDecodeError(shape: method, reason: "subscribe answered without a subId")
      }
      // The snapshot was handed over in `handle`, the moment the answer was
      // read (SP-2 a) — never after this await, where a frame could pass it.
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

  func cursor(forKey key: Int) -> SubscriptionCursor? { subs[key]?.cursor }

  func resnapshotCount(forKey key: Int) -> Int { subs[key]?.resnapshots ?? 0 }

  /// SP-2 (a) — the repair for a gap: let the gapped stream go, and subscribe
  /// again for a fresh snapshot (a rows table WITH the last cursor it applied,
  /// so a source whose journal covers it answers `resumed`). The tolerant
  /// reader's own rule; there is no ack protocol anywhere.
  ///
  /// A socket that is not up does nothing here: the re-dial replays every
  /// subscription, and a replay IS a fresh snapshot (P5). A re-subscribe the
  /// door refuses takes the socket down for the same reason a failed replay
  /// does — the re-dial puts every subscription back from the top.
  func resnapshot(key: Int, because reason: String) {
    guard var entry = subs[key], !entry.resnapshotting else { return }
    guard case .ready = state, connection != nil else { return }
    entry.resnapshotting = true
    entry.resnapshots += 1
    entry.paging = nil
    let retired = entry.subId
    if let retired { subRoutes.removeValue(forKey: retired) }
    entry.subId = nil
    subs[key] = entry
    if let retired { sendUnsubscribe(retired) }
    note("\(entry.method): \(reason) — re-subscribing for a fresh snapshot")
    let token = generation
    let method = entry.method
    let params = subscribeParams(for: entry, resuming: true)
    Task { [weak self] in
      guard let self else { return }
      do {
        // The open answer is applied in `handle`, before any frame after it.
        _ = try await self.send(method: method, params: params, subKey: key)
      } catch {
        guard token == self.generation else { return }
        let refusal = Self.refusal(from: error)
        self.record(refusal, for: token)
        self.note("re-subscribing \(method) failed — re-dialing: \(refusal.message)")
        self.retireConnection()
        self.socketDown(token: token, error: refusal)
      }
    }
  }

  /// The params a subscribe carries: the caller's, with the table's cadence
  /// (`minIntervalMs`) written in when the shape names one, and — for a rows
  /// table subscribing AGAIN — the last cursor it applied as `since`.
  private func subscribeParams(for entry: SubEntry, resuming: Bool) -> JSONValue? {
    var fields = entry.params?.objectValue ?? [:]
    guard entry.params == nil || entry.params?.objectValue != nil else { return entry.params }
    var changed = false
    if let minIntervalMs = entry.shape.minIntervalMs {
      fields["minIntervalMs"] = .int(Int64(minIntervalMs))
      changed = true
    }
    if resuming, entry.shape.kind == .rows, let since = entry.cursor?.json {
      fields["since"] = since
      changed = true
    }
    guard changed else { return entry.params }
    return .object(fields)
  }

  /// The OPEN answer, applied the moment it is read — before any frame after
  /// it, so a delta in the same breath continues the snapshot instead of
  /// looking like a gap against a cursor not yet set.
  private func deliverOpen(_ payload: JSONValue, key: Int) {
    guard var entry = subs[key] else { return }
    entry.resnapshotting = false
    entry.paging = nil
    switch entry.shape.kind {
    case .stream:
      subs[key] = entry
      entry.onSnapshot(payload)
    case .snapshotDelta:
      entry.cursor = SubscriptionCursor.of(snapshot: payload)
      subs[key] = entry
      entry.onSnapshot(payload)
    case .rows:
      if let resumed = payload["resumed"], let cursor = SubscriptionCursor.of(snapshot: resumed) {
        // The source's journal still covers the cursor: the caller's copy
        // stands, and what it missed follows as deltas.
        entry.cursor = cursor
        subs[key] = entry
        return
      }
      subs[key] = entry
      applyRowsPage(payload["snapshot"] ?? payload, key: key)
    }
  }

  /// A later frame, judged against the cursor before the caller sees it.
  private func deliverEvent(_ kind: SubEventKind, _ payload: JSONValue, key: Int) {
    guard var entry = subs[key] else { return }
    switch (entry.shape.kind, kind) {
    case (.stream, .snapshot):
      entry.onSnapshot(payload)
    case (.stream, .delta):
      entry.onDelta(payload)
    case (.snapshotDelta, .snapshot):
      entry.cursor = SubscriptionCursor.of(snapshot: payload)
      subs[key] = entry
      entry.onSnapshot(payload)
    case (.rows, .snapshot):
      applyRowsPage(payload, key: key)
    case (.snapshotDelta, .delta), (.rows, .delta):
      if entry.paging != nil {
        resnapshot(key: key, because: "a delta arrived inside a paged snapshot")
        return
      }
      guard let held = entry.cursor else {
        // The open answer named no revision: there is nothing to continue
        // from. The frame passes through untracked — the owner's own checks
        // stand — rather than a re-subscribe on every frame of a door that will
        // never name one (a storm, on a metered radio).
        note("\(entry.method) names no revision — its frames pass through untracked")
        entry.onDelta(payload)
        return
      }
      guard let next = held.after(delta: payload, kind: entry.shape.kind) else {
        let since = payload["since"]?.intValue.map(String.init) ?? "?"
        resnapshot(key: key, because: "a delta since \(since) does not continue \(held.revision)")
        return
      }
      entry.cursor = next
      subs[key] = entry
      entry.onDelta(payload)
    }
  }

  /// One page of a rows snapshot: assembled while `more` says another follows,
  /// handed over ONCE, whole, as `{epoch, revision, rows}`. A page of another
  /// cursor than the one being assembled starts over — it is a newer reset.
  private func applyRowsPage(_ page: JSONValue, key: Int) {
    guard var entry = subs[key] else { return }
    guard let cursor = SubscriptionCursor.of(snapshot: page) else {
      note("\(entry.method) sent a snapshot that names no revision")
      return
    }
    var rows = page["rows"]?.arrayValue ?? []
    if let paging = entry.paging, paging.cursor == cursor { rows = paging.rows + rows }
    if page["more"]?.boolValue == true {
      entry.paging = (cursor, rows)
      subs[key] = entry
      return
    }
    entry.paging = nil
    entry.cursor = cursor
    subs[key] = entry
    var whole: [String: JSONValue] = ["revision": .int(cursor.revision), "rows": .array(rows)]
    if let epoch = cursor.epoch { whole["epoch"] = .string(epoch) }
    entry.onSnapshot(.object(whole))
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

  // MARK: - The keepalive (SP-2 b)

  /// SP-2 (c) — the app went away: the keepalive's clocks stop with it.
  ///
  /// A suspended app reads no frames and sends no pings, so a deadline measured
  /// across a suspension would call a healthy door dead on the way back — and
  /// every desktop's door at the same instant, which is the herd SP-L7 forbids.
  /// The socket is left alone, as `FieldLink.pause` leaves it.
  public func pauseKeepalive() {
    guard !keepalivePaused else { return }
    keepalivePaused = true
    stopKeepalive()
  }

  /// Back: a FRESH deadline, because a suspension is not silence, and one ping
  /// at once, so a socket that died while the phone was away is found by asking
  /// rather than by waiting out the deadline.
  public func resumeKeepalive() {
    guard keepalivePaused else { return }
    keepalivePaused = false
    guard connection != nil else { return }
    let token = generation
    lastInboundAt = options.clock.now()
    armWatchdog(token: token)
    armPing(token: token)
    ping(token: token)
  }

  /// Both timers start with a socket: the hello itself is the first traffic
  /// in each direction, so both instants start NOW.
  private func startKeepalive(token: Int) {
    let now = options.clock.now()
    lastInboundAt = now
    lastSentAt = now
    guard !keepalivePaused else { return }
    armWatchdog(token: token)
    armPing(token: token)
  }

  private func stopKeepalive() {
    watchdogTask?.cancel()
    watchdogTask = nil
    pingTask?.cancel()
    pingTask = nil
  }

  /// ANY inbound frame is liveness — a result, an event, a tick, a notification
  /// this build has never heard of, a frame it cannot even read, a pong.
  private func noteInbound(token: Int) {
    guard token == generation else { return }
    lastInboundAt = options.clock.now()
  }

  private var receiveDeadline: Duration {
    options.keepalive.receiveDeadline(intervalMs: doorTickIntervalMs)
  }

  /// The receive deadline's timer. It sleeps until the deadline the LAST frame
  /// set, wakes, and either finds a newer frame moved it (and sleeps again) or
  /// calls the door dead — one timer per socket, never one per frame.
  private func armWatchdog(token: Int) {
    watchdogTask?.cancel()
    let clock = options.clock
    watchdogTask = Task { [weak self] in
      while !Task.isCancelled {
        // Read through the weak reference and let go of it before sleeping, so
        // a parked timer never keeps a client alive.
        guard let deadline = self?.watchdogDeadline(token: token) else { return }
        if clock.now() >= deadline {
          self?.doorWentSilent(token: token)
          return
        }
        do { try await clock.sleep(until: deadline) } catch { return }
      }
    }
  }

  /// When this socket's door is dead if nothing arrives first — nil once the
  /// socket is not the live one, which ends its timer.
  private func watchdogDeadline(token: Int) -> Duration? {
    guard token == generation, connection != nil, !keepalivePaused else { return nil }
    return lastInboundAt + receiveDeadline
  }

  /// The phone's own half: a protocol ping after `pingAfter` with nothing sent.
  private func armPing(token: Int) {
    pingTask?.cancel()
    let clock = options.clock
    pingTask = Task { [weak self] in
      while !Task.isCancelled {
        guard let due = self?.pingDue(token: token) else { return }
        if clock.now() >= due {
          self?.ping(token: token)
          continue
        }
        do { try await clock.sleep(until: due) } catch { return }
      }
    }
  }

  private func pingDue(token: Int) -> Duration? {
    guard token == generation, connection != nil, !keepalivePaused else { return nil }
    return lastSentAt + options.keepalive.pingAfter
  }

  /// One ping, fired and not awaited by the timer: a pong that never comes is
  /// the receive deadline's to judge, and the timer must not stall behind it.
  private func ping(token: Int) {
    guard token == generation, let connection else { return }
    lastSentAt = options.clock.now()
    pingsSent += 1
    Task { [weak self] in
      do {
        try await connection.ping()
        self?.noteInbound(token: token)
      } catch is ProductPingUnsupported {
        // A transport with no ping: no pong to count. The deadline still stands.
      } catch {
        // The socket refused a ping, which only a dead socket does. The re-dial
        // is in charge from here — the same single road every drop takes.
        self?.socketDown(token: token, error: error)
      }
    }
  }

  /// The receive deadline passed with nothing heard: close, and dial again.
  private func doorWentSilent(token: Int) {
    guard token == generation, connection != nil else { return }
    silentDoorCloses += 1
    let quiet = Self.wholeSeconds(options.clock.now() - lastInboundAt)
    let refusal = FieldProductError(
      kind: "UNAVAILABLE",
      message: "the door said nothing for \(quiet) s — closing it and dialing again",
      retryable: true,
      details: .object(["service": .string("product"), "state": .string("silent")]))
    note(refusal.message)
    record(refusal, for: token)
    socketDown(token: token, error: refusal)
  }

  /// SP-1's tick: liveness is already counted (any frame is), and the tick also
  /// says how often the next one comes — which is what the deadline is
  /// measured in from now on.
  private func applyTick(_ params: JSONValue) {
    guard let interval = params["intervalMs"]?.intValue,
      ProductKeepalive.acceptedIntervalsMs.contains(interval)
    else {
      note(
        "system.tick named an interval this client cannot measure — the deadline stays "
          + "\(Self.wholeSeconds(receiveDeadline)) s")
      return
    }
    guard interval != doorTickIntervalMs else { return }
    doorTickIntervalMs = interval
    // A shorter interval must bite on time, not at the old deadline.
    if watchdogTask != nil { armWatchdog(token: generation) }
  }

  static func wholeSeconds(_ duration: Duration) -> Int64 {
    duration.components.seconds
  }

  // MARK: - Traffic (SP-2 h)

  /// Count one frame against its subscription's open window, opening one (and
  /// arming the shared timer) when none is open.
  private func account(_ bytes: Int, to key: Int) {
    guard var entry = subs[key] else { return }
    if entry.windowStart == nil { entry.windowStart = options.clock.now() }
    entry.windowBytes += bytes
    entry.windowFrames += 1
    subs[key] = entry
    if trafficTask == nil { armTrafficTimer() }
  }

  /// Sleeps until the EARLIEST open window closes, writes every window that
  /// has, and re-arms for the next — or ends, when nothing holds bytes.
  private func armTrafficTimer() {
    let clock = options.clock
    trafficTask = Task { [weak self] in
      while !Task.isCancelled {
        guard let due = self?.nextTrafficDeadline() else { break }
        if clock.now() < due {
          do { try await clock.sleep(until: due) } catch { return }
        }
        self?.flushTraffic()
      }
      self?.trafficTask = nil
    }
  }

  private func nextTrafficDeadline() -> Duration? {
    subs.values.compactMap(\.windowStart).min().map { $0 + SubscriptionTraffic.window }
  }

  private func flushTraffic() {
    let now = options.clock.now()
    for key in subs.keys.sorted() {
      guard var entry = subs[key], let start = entry.windowStart,
        now >= start + SubscriptionTraffic.window
      else { continue }
      let traffic = SubscriptionTraffic(
        label: options.logLabel, method: entry.method, subId: entry.subId,
        bytes: entry.windowBytes, frames: entry.windowFrames, window: SubscriptionTraffic.window)
      entry.windowStart = nil
      entry.windowBytes = 0
      entry.windowFrames = 0
      subs[key] = entry
      options.trafficLog(traffic)
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
    let shape: SubscriptionShape
    let onSnapshot: @MainActor (JSONValue) -> Void
    let onDelta: @MainActor (JSONValue) -> Void
    var subId: String?
    /// True once a subscribe request has reached a live socket. Only those are
    /// replayed; one still owned by a pending `subscribe()` call is not.
    var sentOnce = false
    /// SP-2 (a) — the last frame applied.
    var cursor: SubscriptionCursor?
    var resnapshots = 0
    /// A re-subscribe for a fresh snapshot is in flight: the gapped stream's
    /// route is retired, and a second gap cannot start a second one.
    var resnapshotting = false
    /// A paged rows snapshot being assembled: its cursor and the rows so far.
    var paging: (cursor: SubscriptionCursor, rows: [JSONValue])?
    /// SP-2 (h) — the open traffic window: when it began, and what it holds.
    var windowStart: Duration?
    var windowBytes = 0
    var windowFrames = 0

    init(
      method: String, params: JSONValue?, shape: SubscriptionShape,
      onSnapshot: @escaping @MainActor (JSONValue) -> Void,
      onDelta: @escaping @MainActor (JSONValue) -> Void
    ) {
      self.method = method
      self.params = params
      self.shape = shape
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
      // SP-2 (d) — never dial a peer the roster calls asleep or gone.
      if let mayDial = self.options.mayDial {
        let allowed = await mayDial()
        guard token == self.generation else { return }
        guard allowed else {
          self.park(token: token)
          return
        }
      }
      // SP-2 (g) — a dial beyond the budget WAITS for a slot (a replacement
      // door to one desktop waits for its predecessor's socket to close). A
      // close, or a newer dial, cancels the wait.
      var grant: PhoneConnectionBudget.Grant?
      let ledger = self.options.doorBudget?.ledger
      if let budget = self.options.doorBudget {
        guard let slot = try? await budget.ledger.acquire(.door(desktop: budget.desktop)) else {
          return
        }
        guard token == self.generation else {
          budget.ledger.release(slot)
          return
        }
        grant = slot
      }
      do {
        let connection = try await self.transport.connect(to: self.url)
        guard token == self.generation else {
          await connection.close()
          if let grant { ledger?.release(grant) }
          return
        }
        self.connection = connection
        self.connectionGrant = grant
        self.startKeepalive(token: token)
        self.startReceiving(connection, token: token)
        await self.hello(connection, token: token)
      } catch {
        if let grant { ledger?.release(grant) }
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
          self.noteInbound(token: token)
          self.handle(frame: RpcCodec.decode(text), bytes: text.utf8.count)
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
        // A rows table asks for what it missed from the cursor it kept; the
        // open answer is handed over in `handle`, as every open answer is.
        _ = try await send(
          method: entry.method, params: subscribeParams(for: entry, resuming: true), subKey: key)
        guard token == generation else { return }
      } catch {
        guard token == generation else { return }
        let refusal = Self.refusal(from: error)
        record(refusal, for: token)
        note("replaying \(entry.method) failed — re-dialing: \(refusal.message)")
        retireConnection()
        socketDown(token: token, error: refusal)
        return
      }
    }
  }

  private func handle(frame: RpcFrame, bytes: Int) {
    switch frame {
    case .result(let id, let result):
      guard let entry = pending.removeValue(forKey: id) else { return }
      entry.deadline?.cancel()
      // SP-2 (h) — an open answer is its subscription's traffic too.
      if let key = entry.subKey { account(bytes, to: key) }
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
        } else {
          // SP-2 (a) — the open answer is applied HERE, synchronously, before
          // the receive loop reads the next frame: the first snapshot, a
          // replay's, a re-subscribe's, alike.
          deliverOpen(result["snapshot"] ?? .null, key: key)
        }
      }
      entry.continuation.resume(returning: result)

    case .failure(let id, let error):
      guard let entry = pending.removeValue(forKey: id) else { return }
      entry.deadline?.cancel()
      if let key = entry.subKey, entry.dropSubOnFailure { subs.removeValue(forKey: key) }
      entry.continuation.resume(throwing: error)

    case .subscriptionEvent(_, let subId, let kind, let payload):
      guard let key = subRoutes[subId], subs[key] != nil else { return }
      account(bytes, to: key)
      deliverEvent(kind, payload, key: key)

    case .notification(let method, let params):
      // SP-2 (b) — the door's keepalive tick. Every OTHER server notification
      // still has no consumer on the phone, and ignoring one is the tolerant
      // reader's answer, not a defect: an unknown notification is a FRAME (its
      // liveness was counted on arrival) and never an error.
      if method == FieldProductContract.tickMethod { applyTick(params) }

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
    // Bytes in the phone's direction: the ping is owed only after this long.
    lastSentAt = options.clock.now()

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
    stopKeepalive()
    // CLOSE WHAT YOU WALK AWAY FROM. The real transport's `connect` never
    // throws — it builds a URLSession and hands back a task at once — so a
    // dial that never reaches a door still leaves a live session behind, and
    // only `close()` (`invalidateAndCancel`) ends one. Dropping the reference
    // alone leaked one session per backoff tick against a sleeping desktop.
    retireConnection()
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

  /// SP-2 (d) — the roster said this desktop is not online. Nothing is dialled
  /// and nothing is scheduled: the client waits, saying why in the honest
  /// degraded shape, until `connect()` asks again. A caller parked on `ready()`
  /// is TOLD rather than left waiting for a dial that will not come.
  private func park(token: Int) {
    guard token == generation else { return }
    parkedDials += 1
    let refusal = FieldProductError(
      kind: "UNAVAILABLE",
      message: "the tailnet says this desktop is not online — not dialing it until it is",
      retryable: true,
      details: .object(["service": .string("product"), "state": .string("asleep")]))
    record(refusal, for: token)
    state = .reconnecting
    flushReadyWaiters(refusal)
  }

  /// Detach the live socket and its budget slot TOGETHER — every road that
  /// walks away from a socket comes through here — close the socket, and give
  /// the slot back once the close has finished, so a replacement door waits for
  /// its predecessor's close rather than its predecessor's intention.
  private func retireConnection() {
    let dying = connection
    let grant = connectionGrant
    connection = nil
    connectionGrant = nil
    guard dying != nil || grant != nil else { return }
    let ledger = options.doorBudget?.ledger
    Task {
      await dying?.close()
      if let grant { ledger?.release(grant) }
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
    retireConnection()  // detach first: this socket's close is now stale
    stopKeepalive()
    generation &+= 1
    dialTask?.cancel()
    dialTask = nil
    receiveTask?.cancel()
    receiveTask = nil
    state = .failed(error)
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
