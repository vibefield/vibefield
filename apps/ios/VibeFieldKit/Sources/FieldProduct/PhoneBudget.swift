import Foundation

/// SP-2 (g) — the phone's connection budget: `PHONE_BUDGET` in
/// `packages/contracts/src/registries.ts`, mirrored as literals because this
/// kit is outside `pnpm verify` and has no generator pointed at it.
/// `pnpm check:ios-fixtures` pins each literal to the registry VERBATIM, so a
/// number that moves on one side only is a red there, never a quiet
/// disagreement about how many sockets this phone may hold.
///
/// These are the AS-BUILT numbers (2026-10-01). SP-D12 is OPEN — its lean is
/// one door to the HOME desktop, two attached terminals (the open card and one
/// warm), one web view — and when it rules, the registry moves and this file
/// moves with it.
public enum PhoneBudget {
  /// One product-door WebSocket per self desktop. The phone dials every self
  /// desktop its roster lists until DS-8 homes it to one, so the honest number
  /// today is PER DESKTOP: a replacement door waits for its predecessor's
  /// socket to close.
  public static let doorsPerDesktop = 1
  /// One attached terminal: its control leg and its frames leg.
  public static let terminalLegs = 2
  /// One web view. Nothing on the phone opens one yet (SP-4).
  public static let webViews = 1
}

/// SP-2 (g) — the ledger a product door's socket counts against, and the
/// desktop it counts as (`PhoneBudget.doorsPerDesktop` per desktop).
public struct ProductDoorBudget: Sendable {
  public let ledger: PhoneConnectionBudget
  public let desktop: String

  public init(ledger: PhoneConnectionBudget, desktop: String) {
    self.ledger = ledger
    self.desktop = desktop
  }
}

/// SP-2 (g) — the budget, ENFORCED: a ledger of the slots this phone holds.
///
/// A dial beyond the budget WAITS for a slot — it is never refused and never
/// raced past — and waiters are admitted in the order they asked (no barging:
/// a later small ask never jumps an earlier one). A waiter whose task is
/// cancelled leaves the queue at once. A slot is given back by `release`,
/// exactly once however often it is called.
///
/// One ledger per phone: the composition passes `shared` to every door and
/// every terminal attachment. Tests make their own, so two rows never share a
/// budget by accident.
@MainActor
public final class PhoneConnectionBudget {
  public enum Resource: Hashable, Sendable {
    /// One self desktop's product door (`PhoneBudget.doorsPerDesktop` each).
    case door(desktop: String)
    /// Routed terminal legs, across every attachment (`PhoneBudget.terminalLegs`).
    case terminalLegs
    /// Web views (`PhoneBudget.webViews`).
    case webViews
  }

  /// Slots held — the receipt `release` takes back.
  public struct Grant: Hashable, Sendable {
    public let resource: Resource
    public let count: Int
    let id: UUID
  }

  /// An ask that could never be met: more slots than the budget has at all.
  public struct BeyondTheBudget: Error, Sendable, Equatable {
    public let resource: Resource
    public let asked: Int
    public let limit: Int
  }

  public static let shared = PhoneConnectionBudget()

  private var held: [Resource: Int] = [:]
  private var granted: Set<UUID> = []
  private var queue: [Waiter] = []

  private struct Waiter {
    let id: UUID
    let resource: Resource
    let count: Int
    let wake: CheckedContinuation<Void, any Error>
  }

  public init() {}

  public func limit(_ resource: Resource) -> Int {
    switch resource {
    case .door: PhoneBudget.doorsPerDesktop
    case .terminalLegs: PhoneBudget.terminalLegs
    case .webViews: PhoneBudget.webViews
    }
  }

  public func inUse(_ resource: Resource) -> Int { held[resource] ?? 0 }

  /// How many asks are waiting for `resource` right now.
  public func waiting(for resource: Resource) -> Int {
    queue.filter { $0.resource == resource }.count
  }

  /// Take `count` slots, waiting while the budget is spent.
  public func acquire(_ resource: Resource, count: Int = 1) async throws -> Grant {
    let limit = limit(resource)
    guard count > 0, count <= limit else {
      throw BeyondTheBudget(resource: resource, asked: count, limit: limit)
    }
    let id = UUID()
    if !queue.contains(where: { $0.resource == resource }), inUse(resource) + count <= limit {
      return take(resource, count: count, id: id)
    }
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { (wake: CheckedContinuation<Void, any Error>) in
        if Task.isCancelled {
          wake.resume(throwing: CancellationError())
          return
        }
        queue.append(Waiter(id: id, resource: resource, count: count, wake: wake))
      }
    } onCancel: {
      Task { @MainActor [weak self] in self?.cancelWaiter(id) }
    }
    // Admitted by `admit`, which took the slots on this waiter's behalf. A task
    // cancelled in the same breath gives them straight back.
    let grant = Grant(resource: resource, count: count, id: id)
    if Task.isCancelled {
      release(grant)
      throw CancellationError()
    }
    return grant
  }

  /// Give slots back, and admit whoever was waiting for them, in order.
  public func release(_ grant: Grant) {
    guard granted.remove(grant.id) != nil else { return }
    held[grant.resource] = max(0, inUse(grant.resource) - grant.count)
    admit(grant.resource)
  }

  private func take(_ resource: Resource, count: Int, id: UUID) -> Grant {
    held[resource] = inUse(resource) + count
    granted.insert(id)
    return Grant(resource: resource, count: count, id: id)
  }

  private func admit(_ resource: Resource) {
    while let index = queue.firstIndex(where: { $0.resource == resource }) {
      let waiter = queue[index]
      guard inUse(resource) + waiter.count <= limit(resource) else { return }
      queue.remove(at: index)
      _ = take(resource, count: waiter.count, id: waiter.id)
      waiter.wake.resume()
    }
  }

  private func cancelWaiter(_ id: UUID) {
    guard let index = queue.firstIndex(where: { $0.id == id }) else { return }
    let waiter = queue.remove(at: index)
    waiter.wake.resume(throwing: CancellationError())
    admit(waiter.resource)
  }
}
