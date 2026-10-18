import FieldProduct
import FieldRoutedTerminal
import Foundation

// F1 (thinking-freeway.md v0.3 §6, "the keyring") — a desktop's tickets held BEFORE the tap. While
// the link stands, the phone asks the host for a ticket for every session it lists that no
// attachment holds (`terminal-tickets`; the host's mint is microseconds) and keeps them current, so
// a tap on a session whose cell's legs are already up attaches with its grant in hand — two round
// trips and the seed, with no ticket round trip in front.
//
// What a held ticket may not do is enforced where it is used (`TerminalLanes.ticket(for:)`): it
// rides legs that are already up and never a hello, because its transport grant is one-shot and may
// sit below one a later mint presented, which the cell refuses as a rollback. And nothing is minted
// for a session after its attachment's grant: every mint moves the session's attach generation, and
// the attachment renews by a CAS on the generation it holds. So a session an attachment holds is
// never asked for, and a tap on one a pass is asking for waits for that answer and takes its ticket
// — the newest the host minted for it.

/// The tickets one desktop's host minted ahead of the taps.
@MainActor
public final class FreewayKeyring {
  /// The keyring's clocks: how often a pass runs, and how much life a ticket must still have to be
  /// handed out. Both are read against the ticket's own grants — a transport grant lives
  /// `TRANSPORT_GRANT_TTL_MS` (60 s), the host's attach grants `KEYRING_ATTACH_TTL_MS` (120 s) — so
  /// a ticket is minted again about every 40 s and handed out only with 15 s or more left.
  public struct Timing: Sendable {
    public var passMs: Int64 = 20_000
    public var marginMs: Int64 = 15_000
    public var now: @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1_000) }

    public init() {}
  }

  private let link: @Sendable () async -> FreewayLink?
  private let timing: Timing
  private var wanted: Set<String> = []
  /// The sessions an attachment holds, from its take to its release.
  private(set) var held: Set<String> = []
  private var tickets: [String: (ticket: JSONValue, usableUntil: Int64)] = [:]
  /// The pass in flight, and the sessions it is asking for.
  private var inFlight: Task<Void, Never>?
  private var asking: Set<String> = []
  private var again = false
  private var passes: Task<Void, Never>?

  /// `link` is the desktop's STANDING link, never a dial: a keyring opens no link for itself.
  public init(link: @escaping @Sendable () async -> FreewayLink?, timing: Timing = Timing()) {
    self.link = link
    self.timing = timing
  }

  /// The sessions the phone lists on this desktop. A ticket for one no longer listed goes; one
  /// newly listed is minted for now.
  public func want(_ sessions: Set<String>) {
    wanted = sessions
    tickets = tickets.filter { sessions.contains($0.key) }
    if sessions.contains(where: { tickets[$0] == nil && !held.contains($0) }) { kick() }
  }

  /// The ticket held for `session` if it is still usable — handed out once — else nil; when a pass
  /// is asking for it, its answer first. Either way the session is its attachment's from here until
  /// `release`, and nothing is minted for it.
  public func take(_ session: String) async -> JSONValue? {
    held.insert(session)
    if asking.contains(session), let inFlight { await inFlight.value }
    guard let entry = tickets.removeValue(forKey: session), entry.usableUntil > timing.now()
    else { return nil }
    return entry.ticket
  }

  /// The attachment let `session` go: while it is listed, it is minted for again.
  public func release(_ session: String) {
    held.remove(session)
    if wanted.contains(session) { kick() }
  }

  /// Keep the tickets current: a pass now, and one every `passMs`.
  public func start() {
    guard passes == nil else { return }
    let period = UInt64(timing.passMs) * 1_000_000
    passes = Task { [weak self] in
      while !Task.isCancelled {
        await self?.mint()
        try? await Task.sleep(nanoseconds: period)
      }
    }
  }

  /// Stop, and let every held ticket go.
  public func stop() {
    passes?.cancel()
    passes = nil
    tickets = [:]
  }

  /// The sessions a ticket is held for now.
  public var heldTickets: Set<String> { Set(tickets.keys) }

  private func kick() {
    if inFlight != nil {
      again = true
      return
    }
    Task { await self.mint() }
  }

  /// A pass — or, while one is in flight, that one, and another after it.
  func mint() async {
    if let inFlight {
      again = true
      await inFlight.value
      return
    }
    let pass = Task { await self.pass() }
    inFlight = pass
    await pass.value
    inFlight = nil
  }

  /// A ticket for every listed session no attachment holds whose own is missing or due within the
  /// next pass. A link that is not up mints nothing — the next pass tries again.
  private func pass() async {
    defer { asking = [] }
    repeat {
      again = false
      let now = timing.now()
      let due = wanted.subtracting(held)
        .filter { (tickets[$0]?.usableUntil ?? now) - now < timing.passMs }
        .sorted()
      asking = Set(due)
      guard !due.isEmpty, let link = await link() else { return }
      for first in stride(from: 0, to: due.count, by: FreewayContract.maxTicketsPerAsk) {
        let ask = Array(due[first..<min(first + FreewayContract.maxTicketsPerAsk, due.count)])
        guard let rows = try? await FreewayTerminalDoors.tickets(ask, on: link) else { return }
        for (session, row) in rows {
          // only what was asked; one taken while the ask was out is its taker's, who waits for it
          guard ask.contains(session), wanted.contains(session), case .success(let ticket) = row,
            let usableUntil = Self.usableUntil(ticket, margin: timing.marginMs)
          else { continue }
          tickets[session] = (ticket, usableUntil)
        }
      }
    } while again
  }

  /// The last moment a ticket may be handed out: its grants' first expiry, less the margin. Nil for
  /// a ticket the routed reader would not take.
  static func usableUntil(_ ticket: JSONValue, margin: Int64) -> Int64? {
    guard let parsed = try? RoutedTerminalTicket(json: ticket) else { return nil }
    return min(parsed.transportGrant.expiresAt, parsed.attachGrant.expiresAt) - margin
  }
}
