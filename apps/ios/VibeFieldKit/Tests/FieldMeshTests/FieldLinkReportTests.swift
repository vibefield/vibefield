import FieldAgents
import FieldProduct
import Foundation
import Testing

@testable import FieldMesh

// PG-3f (design v2 §4, Q-E5) — THE PHONE IS A SCREEN. What its one pane shows (the open card) is reported to the row's
// OWNER as `agent.reportShown {ids: [model id], device}`, routed through the home, so the owner never marks unread a
// turn the phone is showing. The card follows its body by VISUAL id; the link resolves the row under it at every refold
// and sends:
// - on a change of the effective row: the old device's empty first when the device changes (or the row goes), then the
//   new row's report — on the same device the replacing report alone;
// - after every open (the subscribe, a whole-mesh resync, a re-subscribe), the effective row again;
// - nothing else: no timer, no resend on a frame, the same row twice once.
// A lasting refusal (`locality: "local"`, `carried-cap`) is recorded for its device, which is then sent nothing until
// its board re-attaches on a new epoch, a new home or hello, or `stop()`; every other refusal is transient.
//
// The rows run through the harness's home door answering PG-3a's WITNESS (three desktops: the home `RemoteRows.home`,
// the Loft `RemoteRows.loft`, the asleep Attic), so a report names a real owner. No key path and no `try` inside an
// #expect/#require argument: hoisted first (T10f's kit trap).

private typealias R = RemoteRows
private let home = RemoteRows.home
private let loft = RemoteRows.loft

/// A home answering the witness's open on every subscribe, and each report by `reports`.
private func witnessDoor(_ reports: ReportScript) -> LinkDoor.Script {
  let witness = (try? RemoteRows.openJSON()) ?? .null
  return { method, id, params in
    switch method {
    case "system.hello": return [frame(id: id, ack)]
    case "agent.subscribe": return [frame(id: id, .object(["subId": .string("m1"), "snapshot": witness]))]
    case "agent.reportShown": return reports.answer(id: id, params: params)
    default: return []
    }
  }
}

/// A link homed to the witness, its board drawn.
@MainActor
private func reportLink(
  _ reports: ReportScript = ReportScript(), answerDelay: Duration = .zero
) async throws -> (FieldLink, LinkDoor) {
  let door = LinkDoor(answerDelay: answerDelay, script: witnessDoor(reports))
  let (link, _, _, _) = try await standingLink(door: door)
  try await waitUntil("the witness drawn") { link.rows.count == 11 }
  return (link, door)
}

/// A whole-mesh resync, as the door sends one (PG-1c): an open.
@MainActor
private func resync(_ door: LinkDoor) async throws {
  let connection = try #require(await door.latest)
  await connection.deliver(event(method: "agent.snapshot", subId: "m1", payload: try R.openJSON()))
}

/// 3d's V1 on the home's chain: `run-h-launch` takes over the shell `pty-h2`'s body.
@MainActor
private func handOff(_ door: LinkDoor) async throws {
  let connection = try #require(await door.latest)
  let delta = R.deltaJSON(
    home, epoch: R.homeEpoch, since: R.homeRevision, revision: R.homeRevision + 1, upserts: [try R.launchJSON()])
  await connection.deliver(meshFrame(delta))
}

/// A beat for a send that must NOT happen to have happened: "nothing sent" is evidence only after it.
private func beat() async throws { try await Task.sleep(for: .milliseconds(80)) }

@MainActor
private func sentCount(_ door: LinkDoor) async -> Int { await reportsSent(door).count }

@MainActor
@Suite struct FieldLinkReportTests {
  /// S1 — on a row whose model id, key and visual id all differ (3d's V1, after the hand-off): ONE report, of the model
  /// id, routed by the row's owner.
  @Test func sendsTheShownRowsModelIdRoutedByItsDevice() async throws {
    let (link, door) = try await reportLink()
    defer { link.stop() }
    try await handOff(door)
    try await waitUntil("the hand-off drawn") { link.rows.contains { $0.id == "run-h-launch" } }
    let launched = try #require(link.rows.first { $0.id == "run-h-launch" })
    let ids = [launched.id, launched.key, launched.visualId]
    #expect(ids == ["run-h-launch", "run-h-launch-key", "pty-h2"], "three ids that differ")

    link.show(visualId: "pty-h2")
    try await waitUntil("the report") { await sentCount(door) >= 1 }
    try await beat()
    let sent = await reportsSent(door)
    #expect(sent == [report(["run-h-launch"], home)])
  }

  /// S2 — the effective row is sent again after every open: the resync, and the re-subscribe after a gap.
  @Test func resendsAfterEveryOpen() async throws {
    let (link, door) = try await reportLink()
    defer { link.stop() }
    link.show(visualId: "pty-p3")
    try await waitUntil("the first report") { await sentCount(door) == 1 }

    try await resync(door)
    try await waitUntil("again after the resync") { await sentCount(door) == 2 }

    let connection = try #require(await door.latest)
    await connection.deliver(meshFrame(R.deltaJSON(home, epoch: R.homeEpoch, since: 5, revision: 6)))
    try await waitUntil("again after the gap's open") { await sentCount(door) == 3 }
    try await beat()
    let sent = await reportsSent(door)
    #expect(sent == Array(repeating: report(["pty-p3"], loft), count: 3))
  }

  /// S3 — the body changes hands under the open card: the replacing report alone (no empty between), and the body
  /// reads the launched run's unread.
  @Test func theBodyChangingHandsReportsTheNewRow() async throws {
    let (link, door) = try await reportLink()
    defer { link.stop() }
    link.show(visualId: "pty-h2")
    try await waitUntil("the shell's report") { await sentCount(door) == 1 }
    let before = link.bubbles.first { $0.id == "pty-h2" }?.unread
    #expect(before == false)

    try await handOff(door)
    try await waitUntil("the launch's report") { await sentCount(door) == 2 }
    try await beat()
    let sent = await reportsSent(door)
    #expect(sent == [report(["pty-h2"], home), report(["run-h-launch"], home)])
    let body = link.bubbles.first { $0.id == "pty-h2" }
    #expect(body?.modelId == "run-h-launch")
    #expect(body?.unread == true, "the launched run's own unread")
  }

  /// S4 — the card moves to another desktop's row: the old device's empty FIRST, then the new device's report.
  @Test func emptiesTheOldDeviceFirst() async throws {
    let (link, door) = try await reportLink()
    defer { link.stop() }
    link.show(visualId: "pty-h1")
    try await waitUntil("the home row's report") { await sentCount(door) == 1 }
    link.show(visualId: "pty-p3")
    try await waitUntil("the move") { await sentCount(door) == 3 }
    try await beat()
    let sent = await reportsSent(door)
    #expect(sent == [report(["pty-h1"], home), report([], home), report(["pty-p3"], loft)])
  }

  /// S5 — the shown row leaves: its empty; it comes back: its report again.
  @Test func aRowThatLeavesSendsItsEmpty() async throws {
    let (link, door) = try await reportLink()
    defer { link.stop() }
    link.show(visualId: "run-p-done")
    try await waitUntil("the report") { await sentCount(door) == 1 }

    let connection = try #require(await door.latest)
    await connection.deliver(
      meshFrame(R.deltaJSON(loft, epoch: R.loftEpoch, since: 30, revision: 31, removed: ["run-p-done"])))
    try await waitUntil("the empty") { await sentCount(door) == 2 }
    let back = try R.row("run-p-done")
    await connection.deliver(meshFrame(R.deltaJSON(loft, epoch: R.loftEpoch, since: 31, revision: 32, upserts: [back])))
    try await waitUntil("the report again") { await sentCount(door) == 3 }
    try await beat()
    let sent = await reportsSent(door)
    #expect(sent == [report(["run-p-done"], loft), report([], loft), report(["run-p-done"], loft)])
  }

  /// S6 — closing the card sends the empty.
  @Test func closingTheCardSendsTheEmpty() async throws {
    let (link, door) = try await reportLink()
    defer { link.stop() }
    link.show(visualId: "pty-h1")
    try await waitUntil("the report") { await sentCount(door) == 1 }
    link.show(visualId: nil)
    try await waitUntil("the empty") { await sentCount(door) == 2 }
    let sent = await reportsSent(door)
    #expect(sent == [report(["pty-h1"], home), report([], home)])
  }

  /// S7 — `no-screen` is transient: nothing is recorded and nothing re-sent until the next open, which sends once.
  @Test func noScreenIsTransient() async throws {
    let reports = ReportScript()
    reports.queue(loft, .noScreen)
    let (link, door) = try await reportLink(reports)
    defer { link.stop() }
    link.show(visualId: "pty-p3")
    try await waitUntil("the refusal heard") { !link.reportAnswers.isEmpty }
    let heard = link.reportAnswers.last?.outcome
    #expect(heard == .transient)
    try await beat()
    #expect(await sentCount(door) == 1, "no resend before an open")

    try await resync(door)
    try await waitUntil("the open's resend") { await sentCount(door) == 2 }
    try await waitUntil("it landed") { link.reportAnswers.last?.outcome == .reported }
  }

  /// S8 — `locality: "local"` is lasting, once per device: nothing for Loft on the next opens, no empty when the card
  /// leaves it, and the home's rows still reported.
  @Test func aLocalityRefusalIsRecordedOncePerDevice() async throws {
    let reports = ReportScript()
    reports.set(loft, .localityLocal)
    let (link, door) = try await reportLink(reports)
    defer { link.stop() }
    link.show(visualId: "pty-p3")
    try await waitUntil("the refusal recorded") { !link.reportAnswers.isEmpty }
    let heard = link.reportAnswers.last?.outcome
    #expect(heard == .lasting(.noScreens))
    for _ in 0..<3 {
      try await resync(door)
      try await beat()
    }
    #expect(await sentCount(door) == 1, "three opens send nothing for a recorded device")

    link.show(visualId: "pty-h1")
    try await waitUntil("the home's row reported") { await sentCount(door) == 2 }
    try await resync(door)
    try await waitUntil("and re-sent at its open") { await sentCount(door) == 3 }
    try await beat()
    let sent = await reportsSent(door)
    #expect(sent == [report(["pty-p3"], loft), report(["pty-h1"], home), report(["pty-h1"], home)])
  }

  /// S9 — `carried-cap` is lasting too, recorded once.
  @Test func theCarriedCapIsRecordedOnce() async throws {
    let reports = ReportScript()
    reports.set(loft, .carriedCap)
    let (link, door) = try await reportLink(reports)
    defer { link.stop() }
    link.show(visualId: "pty-p3")
    try await waitUntil("the refusal recorded") { !link.reportAnswers.isEmpty }
    let heard = link.reportAnswers.last?.outcome
    #expect(heard == .lasting(.carriedCap))
    for _ in 0..<2 {
      try await resync(door)
      try await beat()
    }
    #expect(await sentCount(door) == 1)
    link.show(visualId: "pty-h1")
    try await waitUntil("the home's row") { await sentCount(door) == 2 }
    let sent = await reportsSent(door)
    #expect(sent == [report(["pty-p3"], loft), report(["pty-h1"], home)], "no empty for the recorded device")
  }

  /// S10 — a refusal with no details at all (NOT_FOUND) is transient: re-sent at the next open.
  @Test func aRefusalWithNoDetailsIsTransient() async throws {
    let reports = ReportScript()
    reports.queue(loft, .noDetails)
    let (link, door) = try await reportLink(reports)
    defer { link.stop() }
    link.show(visualId: "pty-p3")
    try await waitUntil("the refusal heard") { !link.reportAnswers.isEmpty }
    let heard = link.reportAnswers.last?.outcome
    #expect(heard == .transient)
    try await resync(door)
    try await waitUntil("the open's resend") { await sentCount(door) == 2 }
  }

  /// S11 — the open card on a recorded device is never drawn unread while it is shown (the owner never heard the
  /// phone); every other row keeps its owner's mark, and the card's row its own once the card closes.
  @Test func aRecordedDevicesOpenCardIsNotDrawnUnread() async throws {
    let reports = ReportScript()
    let (link, door) = try await reportLink(reports)
    defer { link.stop() }
    link.show(visualId: "run-p-done")
    try await waitUntil("the report landed") { link.reportAnswers.last?.outcome == .reported }
    let owners = link.bubbles.first { $0.id == "run-p-done" }?.unread
    #expect(owners == true, "the owner's unread, while it can hear the phone")

    reports.set(loft, .localityLocal)
    try await resync(door)
    try await waitUntil("the record") { link.reportAnswers.last?.outcome == .lasting(.noScreens) }
    try await waitUntil("held out of unread") { link.bubbles.first { $0.id == "run-p-done" }?.unread == false }
    let other = link.bubbles.first { $0.id == "pty-h1" }?.unread
    #expect(other == true, "that row alone")

    link.show(visualId: nil)
    try await waitUntil("its own mark back") { link.bubbles.first { $0.id == "run-p-done" }?.unread == true }
    let sent = await reportsSent(door)
    #expect(sent.count == 2, "no empty for a recorded device")
  }

  /// S12 — a record clears when its desktop's board re-attaches on a new epoch (the report goes at once, with no
  /// whole open between: the v2 check's S3), and when the home says hello again.
  @Test func aNewEpochOrAHelloClearsTheRecord() async throws {
    let reports = ReportScript()
    reports.set(loft, .localityLocal)
    let (link, door) = try await reportLink(reports)
    defer { link.stop() }
    link.show(visualId: "pty-p3")
    try await waitUntil("recorded") { link.reportAnswers.last?.outcome == .lasting(.noScreens) }

    reports.set(loft, .ok)
    let loftRows =
      try R.openJSON()["devices"]?.arrayValue?.first { $0["device"]?.stringValue == loft }?["snapshot"]?["rows"]
      ?? .array([])
    let reattached = JSONValue.object([
      "device": .string(loft),
      "snapshot": .object(["epoch": .string(R.loftReattached), "revision": .int(1), "rows": loftRows]),
    ])
    let connection = try #require(await door.latest)
    await connection.deliver(meshFrame(reattached))
    try await waitUntil("reported at once on the new epoch") { await sentCount(door) == 2 }
    try await waitUntil("it landed") { link.reportAnswers.last?.outcome == .reported }

    // recorded again, then the home's hello clears it: the open after the hello reports Loft
    reports.set(loft, .localityLocal)
    try await resync(door)
    try await waitUntil("recorded again") { link.reportAnswers.last?.outcome == .lasting(.noScreens) }
    reports.set(loft, .ok)
    await door.latest?.drop()
    try await waitUntil("reported after the hello") { link.reportAnswers.last?.outcome == .reported }
    let last = await reportsSent(door).last
    #expect(last == report(["pty-p3"], loft))
  }

  /// S13 — a NEW link with the card already open (`show` before its open) sends once, after its open (the v2 check's
  /// S2: the open's rule alone, not both rules).
  @Test func aNewLinkHearsTheOpenCard() async throws {
    let door = LinkDoor(answerDelay: .milliseconds(150), script: witnessDoor(ReportScript()))
    let (link, _, _, _) = try await standingLink(door: door)
    defer { link.stop() }
    link.show(visualId: "pty-h1")
    #expect(link.rows.isEmpty, "shown before the open")
    try await waitUntil("the open's report") { await sentCount(door) == 1 }
    try await beat()
    let sent = await reportsSent(door)
    #expect(sent == [report(["pty-h1"], home)])
  }

  /// S14 — a report queued behind one in flight, then a re-home before it runs: the old home receives nothing more,
  /// and the new home's open sends the effective row once.
  @Test func aQueuedSendForAnOldHomeIsDropped() async throws {
    let first = ReportScript()
    first.set(home, .silent)
    let door = LinkDoor(script: selfDoor)
    await door.route(laptopDoorHost, witnessDoor(first))  // dev-laptop sorts first: the first home
    await door.route(studioDoorHost, witnessDoor(ReportScript()))
    let (link, _, _, _) = try await standingLink(peers: [laptop, studio], door: door)
    defer { link.stop() }
    try await waitUntil("homed to the laptop") { link.home == "dev-laptop" && link.rows.count == 11 }

    link.show(visualId: "pty-h1")  // in flight, never answered
    try await waitUntil("in flight") {
      await door.latest(to: laptopDoorHost)?.requests.contains { $0.method == "agent.reportShown" } == true
    }
    link.show(visualId: "pty-p3")  // queued behind it: the home's empty, then Loft's report
    await door.refuse(laptopDoorHost)
    await door.latest(to: laptopDoorHost)?.drop()
    try await waitUntil("re-homed") { link.home == "dev-studio" }
    try await waitUntil("the new home's open sends") {
      await door.latest(to: studioDoorHost)?.requests.contains { $0.method == "agent.reportShown" } == true
    }
    try await beat()
    let old = await door.latest(to: laptopDoorHost)?.requests.filter { $0.method == "agent.reportShown" }.count
    #expect(old == 1, "only the one in flight reached the old home")
    let fresh = await door.latest(to: studioDoorHost)?.requests.filter { $0.method == "agent.reportShown" }
      .map { $0.params }
    #expect(fresh == [report(["pty-p3"], loft)])
  }

  /// S15 — paused, nothing is sent; resumed, the effective row once, after the open.
  @Test func pauseSendsNothingAndResumeResendsAfterItsOpen() async throws {
    let (link, door) = try await reportLink()
    defer { link.stop() }
    link.show(visualId: "pty-h1")
    try await waitUntil("the report") { await sentCount(door) == 1 }

    link.pause()
    link.show(visualId: "pty-p3")
    try await beat()
    #expect(await sentCount(door) == 1, "paused: nothing")

    link.resume()
    try await waitUntil("after the open") { await sentCount(door) == 2 }
    try await beat()
    let sent = await reportsSent(door)
    #expect(sent == [report(["pty-h1"], home), report(["pty-p3"], loft)])
  }

  /// S16 — `stop()` forgets the shown row and the records: after a new start nothing is sent until `show`, and a
  /// device recorded before the stop is asked again.
  @Test func stopForgetsTheShownAndTheRecords() async throws {
    let reports = ReportScript()
    reports.set(loft, .localityLocal)
    let (link, door) = try await reportLink(reports)
    defer { link.stop() }
    link.show(visualId: "pty-p3")
    try await waitUntil("recorded") { link.reportAnswers.last?.outcome == .lasting(.noScreens) }
    link.show(visualId: "pty-h1")
    try await waitUntil("the home's row") { await sentCount(door) == 2 }

    link.stop()
    link.start()
    try await waitUntil("drawn again") { link.rows.count == 11 }
    try await beat()
    #expect(await sentCount(door) == 2, "nothing until show")

    link.show(visualId: "pty-p3")
    try await waitUntil("Loft asked again") { await sentCount(door) == 3 }
    let last = await reportsSent(door).last
    #expect(last == report(["pty-p3"], loft))
  }

  /// S17 — the same row twice, and a refold that changes nothing under it, send once.
  @Test func theSameRowTwiceSendsOnce() async throws {
    let (link, door) = try await reportLink()
    defer { link.stop() }
    link.show(visualId: "pty-h1")
    try await waitUntil("the report") { await sentCount(door) == 1 }
    link.show(visualId: "pty-h1")
    let connection = try #require(await door.latest)
    await connection.deliver(meshFrame(meshState(R.attic, "asleep")))
    try await beat()
    #expect(await sentCount(door) == 1)
  }
}
