import Foundation

/// PG-3d — THE MODEL BOARD, FOLDED INTO ONE CHAIN, on the phone (`ModelBoardFold`,
/// `field-app/src/godview/monitor/model-board.ts`): the home's remote mesh board answers every self desktop's board,
/// each on its OWN revision chain as its owner numbered it, and the replica wants ONE chain. This fold is the join and
/// nothing more: a desktop's board becomes upserts plus the removals of its ids that are gone; a delta becomes
/// upserts and removals mapped from the board's keys (`runtimeRunId`) to the model's ids; a desktop going silent
/// keeps its rows (DS-L8: asleep is a state, not an absence); a delta the fold cannot follow is a GAP, and the caller
/// asks the home again (M23: the open replaces everything). The one reader-relative fact joined is `isSelf`.
///
/// Every map whose order the window reads is ORDERED here, as a JavaScript `Map`/`Set` is by insertion: the held
/// rows (a kept row keeps its place, item 138), each desktop's keys, the desktops, and the ids a delta releases
/// (`removed`'s order). Swift's `Dictionary` and `Set` iterate in a per-process seeded order.
///
/// Not transcribed, because nothing on the phone reads it: MV-3d's `runs()` (this desktop's desk rows for the
/// window's chrome — a remote row carries no status, so none is a desk row) and the `monitorRow`-less branch of a
/// delta (the remote cut requires `monitorRow`; `RemoteBoardScreen` has refused such a row already).
public struct RemoteModelBoard: Sendable {
  /// One row as the fold holds it: the model's row the replica applies, and the BOARD row it rode in on, kept whole
  /// beside it for the joins the phone reads by key (`HeldModelRow`).
  public struct Held: Sendable, Equatable {
    public let device: String
    public let board: AgentRemoteRow
    public let row: RemoteModelRow
  }

  /// A desktop as the board stands it: its state, when that was established, and its owner's chain once its board
  /// has answered (`HeldDevice`).
  public struct Device: Sendable, Equatable {
    public let device: String
    public internal(set) var state: AgentMeshDeviceState
    /// ISO-8601.
    public internal(set) var asOf: String
    /// The owner's chain: nil until its board has answered.
    public internal(set) var epoch: String?
    public internal(set) var revision: Int64?
    /// The model id each board key stands for, in the order the keys were first set.
    var keys = KeyMap()
  }

  /// What one frame comes to.
  public enum Outcome: Sendable, Equatable {
    /// A desktop's state moved, and nothing in the model (DS-L8).
    case state
    /// The fold's next link: hand it to the replica.
    case change(RemoteModelChange)
    /// The frame changed no row: the chain stays where it was.
    case unchanged
    /// A delta the fold cannot follow: the caller asks again (M23).
    case gap(String)
  }

  /// A `Map<String, String>` as JavaScript keeps one: a key set again keeps its place, a new key goes last.
  struct KeyMap: Sendable, Equatable {
    private(set) var keys: [String] = []
    private var idByKey: [String: String] = [:]

    subscript(key: String) -> String? { idByKey[key] }

    mutating func set(_ key: String, _ id: String) {
      if idByKey.updateValue(id, forKey: key) == nil { keys.append(key) }
    }

    mutating func delete(_ key: String) {
      guard idByKey.removeValue(forKey: key) != nil else { return }
      keys.removeAll { $0 == key }
    }

    /// The ids, in key order, each once (`new Set(idByKey.values())`).
    var ids: [String] {
      var seen: Set<String> = []
      return keys.compactMap { idByKey[$0] }.filter { seen.insert($0).inserted }
    }
  }

  /// The answering desktop: the open lists the home first.
  public private(set) var here: String?
  /// The fold's own chain: one link per change it hands up.
  public private(set) var revision: Int64 = 0

  private var deviceOrder: [String] = []
  private var deviceById: [String: Device] = [:]
  private var heldOrder: [String] = []
  private var heldById: [String: Held] = [:]

  public init() {}

  /// Every desktop the board lists, in the board's order: the open's, then each desktop as it is first heard.
  public var devices: [Device] { deviceOrder.compactMap { deviceById[$0] } }

  /// A row the fold holds, by model id — hidden or shown — with its board row.
  public func held(_ id: String) -> Held? { heldById[id] }

  /// Every row the fold holds, grouped by desktop in the board's device order, each desktop's rows in the order the
  /// fold first took them (item 138): a whole re-send keeps every row it still holds in place.
  public var heldRows: [Held] {
    var groups: [String: [Held]] = [:]
    var order = deviceOrder
    for id in heldOrder {
      guard let held = heldById[id] else { continue }
      if groups[held.device] == nil, !order.contains(held.device) { order.append(held.device) }
      groups[held.device, default: []].append(held)
    }
    return order.flatMap { groups[$0] ?? [] }
  }

  /// The open — and every re-snapshot — replaces everything held (M23). A row the new open still holds keeps its
  /// place among its desktop's (item 138).
  public mutating func open(_ open: AgentRemoteMeshOpen) -> RemoteModelUpdate {
    let kept = Set(open.devices.flatMap { $0.snapshot?.rows ?? [] }.map { $0.monitorRow.id })
    for id in heldOrder where !kept.contains(id) { deleteHeld(id) }
    deviceOrder = []
    deviceById = [:]
    here = open.devices.first?.device
    for entry in open.devices {
      var device = Device(device: entry.device, state: entry.state, asOf: entry.asOf)
      if let snapshot = entry.snapshot { _ = replaceBoard(&device, snapshot) }
      setDevice(device)
    }
    revision += 1
    return .snapshot(revision: revision, rows: heldRows.map { $0.row })
  }

  /// One per-device frame. A desktop's snapshot replaces that desktop's rows; a delta applies on its owner's chain or
  /// is a GAP; a state change keeps the rows (DS-L8). `now` (ISO-8601) dates a desktop first heard by its board,
  /// where the window stamps `new Date()`.
  public mutating func frame(_ frame: AgentRemoteMeshFrame, now: String) -> Outcome {
    switch frame {
    case .state(let id, let state, let asOf):
      if var device = deviceById[id] {
        device.state = state
        device.asOf = asOf
        deviceById[id] = device
      } else {
        setDevice(Device(device: id, state: state, asOf: asOf))
      }
      return .state
    case .snapshot(let id, let snapshot):
      // a desktop first heard by its board is live: it has just answered
      var device = deviceById[id] ?? Device(device: id, state: .live, asOf: now)
      let before = device.keys.ids
      let upserts = replaceBoard(&device, snapshot)
      setDevice(device)
      // gone is an id no key of the desktop maps to now (item 137's rule)
      let mapped = Set(device.keys.ids)
      return change(upserts, before.filter { !mapped.contains($0) })
    case .delta(let id, let delta):
      guard var device = deviceById[id] else { return .gap("a delta from a desktop the board never met") }
      guard let epoch = device.epoch, let at = device.revision else {
        return .gap("a delta from a desktop whose board has not answered")
      }
      guard delta.epoch == epoch else { return .gap("a delta on another chain (\(delta.epoch), held \(epoch))") }
      guard delta.since == at else { return .gap("a delta since \(delta.since), held \(at)") }
      var upserts: [RemoteModelRow] = []
      // Item 137 — the ids a key let go of in this frame, each dropped only if no key of the desktop maps to it once
      // the whole frame is applied: one model id can change keys inside one delta (a shell promoted to an agent, and
      // back at the run's end), and dropping by key alone drew a departure and a birth where M22 keeps one body.
      var released: [String] = []
      func release(_ id: String) { if !released.contains(id) { released.append(id) } }
      for row in delta.upserts {
        let previous = device.keys[row.runtimeRunId]
        let next = RemoteModelRow(row.monitorRow, here: here)
        if let previous, previous != next.id { release(previous) }
        device.keys.set(row.runtimeRunId, next.id)
        setHeld(Held(device: id, board: row, row: next))
        upserts.append(next)
      }
      for key in delta.removed {
        guard let previous = device.keys[key] else { continue }
        device.keys.delete(key)
        release(previous)
      }
      let mapped = Set(device.keys.ids)
      let removed = released.filter { !mapped.contains($0) }
      for gone in removed { deleteHeld(gone) }
      device.revision = delta.revision
      setDevice(device)
      return change(upserts, removed)
    }
  }

  /// A desktop's board, whole: its rows replace that desktop's; the upserts. A row the new board still holds keeps
  /// its place (item 138): only the ids it no longer holds leave, so a re-send that changed nothing moves nothing.
  private mutating func replaceBoard(_ device: inout Device, _ snapshot: AgentRemoteMeshSnapshot) -> [RemoteModelRow] {
    let kept = Set(snapshot.rows.map { $0.monitorRow.id })
    for id in device.keys.ids where !kept.contains(id) { deleteHeld(id) }
    device.keys = KeyMap()
    device.epoch = snapshot.epoch
    device.revision = snapshot.revision
    var upserts: [RemoteModelRow] = []
    for row in snapshot.rows {
      let next = RemoteModelRow(row.monitorRow, here: here)
      device.keys.set(row.runtimeRunId, next.id)
      setHeld(Held(device: device.device, board: row, row: next))
      upserts.append(next)
    }
    return upserts
  }

  private mutating func change(_ upserts: [RemoteModelRow], _ removed: [String]) -> Outcome {
    if upserts.isEmpty, removed.isEmpty { return .unchanged }
    let since = revision
    revision += 1
    return .change(RemoteModelChange(since: since, revision: revision, upserts: upserts, removed: removed))
  }

  private mutating func setDevice(_ device: Device) {
    if deviceById.updateValue(device, forKey: device.device) == nil { deviceOrder.append(device.device) }
  }

  private mutating func setHeld(_ held: Held) {
    if heldById.updateValue(held, forKey: held.row.id) == nil { heldOrder.append(held.row.id) }
  }

  private mutating func deleteHeld(_ id: String) {
    guard heldById.removeValue(forKey: id) != nil else { return }
    heldOrder.removeAll { $0 == id }
  }
}
