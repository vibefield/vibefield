import Foundation
import Testing

@testable import FieldProduct

// SP-2 (g) — the phone's connection budget, enforced: a dial beyond the budget
// WAITS for a slot, never refused and never raced past.

@MainActor
private func waitUntil(
  _ what: String, timeout: Duration = .seconds(5), _ condition: @MainActor () async -> Bool
) async throws {
  let deadline = ContinuousClock.now.advanced(by: timeout)
  while ContinuousClock.now < deadline {
    if await condition() { return }
    try await Task.sleep(for: .milliseconds(2))
  }
  Issue.record("timed out waiting for \(what)")
}

private func helloDoor() throws -> FakeDoor {
  let ack = try Fixture.json("hello-ack.valid")
  return FakeDoor { method, id, _ in method == "system.hello" ? [Frame.result(id: id, ack)] : [] }
}

@MainActor
private func budgetedClient(_ door: FakeDoor, _ ledger: PhoneConnectionBudget, desktop: String)
  -> FieldProductClient
{
  FieldProductClient(
    url: URL(string: "ws://\(desktop).tail1234.ts.net/")!, transport: door,
    options: .init(
      maxBackoff: .milliseconds(1), callTimeout: .seconds(5),
      doorBudget: ProductDoorBudget(ledger: ledger, desktop: desktop)))
}

@MainActor
@Suite struct DoorBudgetTests {
  /// One door per self desktop: a second client for the SAME desktop — the
  /// replacement FieldLink builds when a door moves or a stopped client is
  /// retried — waits for the first one's socket to close before it dials.
  @Test func aSecondDoorToOneDesktopWaitsForTheFirstToClose() async throws {
    let ledger = PhoneConnectionBudget()
    let door = try helloDoor()
    let first = budgetedClient(door, ledger, desktop: "studio")
    defer { first.close() }
    first.connect()
    try await waitUntil("the first door ready") { if case .ready = first.state { true } else { false } }

    let second = budgetedClient(door, ledger, desktop: "studio")
    defer { second.close() }
    second.connect()
    try await waitUntil("the second ask queued") {
      ledger.waiting(for: .door(desktop: "studio")) == 1
    }
    try await Task.sleep(for: .milliseconds(30))
    #expect(await door.dials == 1)

    first.close()
    try await waitUntil("the second door dialled") { await door.dials == 2 }
    try await waitUntil("the second door ready") { if case .ready = second.state { true } else { false } }
    #expect(ledger.inUse(.door(desktop: "studio")) == 1)
  }

  /// Doors to DIFFERENT desktops never wait for each other.
  @Test func doorsToDifferentDesktopsNeverWait() async throws {
    let ledger = PhoneConnectionBudget()
    let door = try helloDoor()
    let studio = budgetedClient(door, ledger, desktop: "studio")
    let laptop = budgetedClient(door, ledger, desktop: "laptop")
    defer {
      studio.close()
      laptop.close()
    }
    studio.connect()
    laptop.connect()
    try await waitUntil("both ready") {
      if case .ready = studio.state, case .ready = laptop.state { true } else { false }
    }
    #expect(await door.dials == 2)
    #expect(ledger.inUse(.door(desktop: "studio")) == 1)
    #expect(ledger.inUse(.door(desktop: "laptop")) == 1)
  }

  /// A socket that drops gives its slot back, and the re-dial takes it again —
  /// a client never waits on itself.
  @Test func aDroppedSocketGivesItsSlotBackAndTheRedialTakesIt() async throws {
    let ledger = PhoneConnectionBudget()
    let door = try helloDoor()
    let client = budgetedClient(door, ledger, desktop: "studio")
    defer { client.close() }
    client.connect()
    try await waitUntil("ready") { if case .ready = client.state { true } else { false } }
    #expect(ledger.inUse(.door(desktop: "studio")) == 1)

    await door.latest?.drop()
    try await waitUntil("the re-dial") { await door.dials == 2 }
    try await waitUntil("ready again") { if case .ready = client.state { true } else { false } }
    #expect(ledger.inUse(.door(desktop: "studio")) == 1)

    client.close()
    try await waitUntil("the slot back") { ledger.inUse(.door(desktop: "studio")) == 0 }
  }
}

@MainActor
@Suite struct PhoneConnectionBudgetTests {
  /// In order, no barging; a cancelled waiter leaves the queue; a release is
  /// taken once however often it is given.
  @Test func waitersAreAdmittedInOrderAndACancelledOneLeaves() async throws {
    let ledger = PhoneConnectionBudget()
    // the whole budget held, so the next ask has to wait
    let held = try await ledger.acquire(.terminalLegs, count: PhoneBudget.terminalLegs)
    #expect(ledger.inUse(.terminalLegs) == PhoneBudget.terminalLegs)

    var order: [String] = []
    let first = Task { @MainActor in
      let grant = try await ledger.acquire(.terminalLegs, count: 2)
      order.append("first")
      return grant
    }
    try await waitUntil("first queued") { ledger.waiting(for: .terminalLegs) == 1 }
    let cancelled = Task { @MainActor in try await ledger.acquire(.terminalLegs, count: 1) }
    try await waitUntil("second queued") { ledger.waiting(for: .terminalLegs) == 2 }
    cancelled.cancel()
    try await waitUntil("the cancelled one gone") { ledger.waiting(for: .terminalLegs) == 1 }
    await #expect(throws: CancellationError.self) { _ = try await cancelled.value }

    ledger.release(held)
    ledger.release(held)  // twice: taken once
    let grant = try await first.value
    #expect(order == ["first"])
    #expect(ledger.inUse(.terminalLegs) == 2)
    ledger.release(grant)
    #expect(ledger.inUse(.terminalLegs) == 0)
  }

  /// An ask the budget could never meet is refused at once, never queued.
  @Test func anAskBeyondTheWholeBudgetIsRefused() async throws {
    let ledger = PhoneConnectionBudget()
    await #expect(throws: PhoneConnectionBudget.BeyondTheBudget.self) {
      _ = try await ledger.acquire(.terminalLegs, count: PhoneBudget.terminalLegs + 1)
    }
    #expect(ledger.waiting(for: .terminalLegs) == 0)
    #expect(ledger.limit(.door(desktop: "x")) == PhoneBudget.doorsPerDesktop)
    #expect(ledger.limit(.webViews) == PhoneBudget.webViews)
  }

  /// The kit's own pin on the mirror (`pnpm check:ios-fixtures` pins it to the
  /// registry; this pins it where the kit runs, outside `pnpm verify`).
  @Test func theMirrorIsTheAsBuiltTable() {
    #expect(PhoneBudget.doorsPerDesktop == 1)
    #expect(PhoneBudget.terminalLegs == 6)
    #expect(PhoneBudget.webViews == 1)
  }
}
