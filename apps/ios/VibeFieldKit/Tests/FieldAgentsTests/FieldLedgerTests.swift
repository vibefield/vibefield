import Foundation
import Testing

@testable import FieldAgents

// The reference's `unread.test.ts`, `project-tint.test.ts` and
// `pane-colours.test.ts`, transcribed, plus the phone's own ledger fold.

private let t0: Double = 1_788_688_800_000  // 2026-09-06T10:00:00Z, epoch ms
private func at(_ seconds: Double) -> Double { t0 + seconds * 1000 }

private func row(
  _ id: String, _ status: AgentVisualStatus, active: Bool = false, hasAgent: Bool = true,
  statusSinceMs: Double? = at(-60)
) -> UnreadCandidate {
  UnreadCandidate(id: id, status: status, active: active, hasAgent: hasAgent, statusSinceMs: statusSinceMs)
}

@Suite struct UnreadLedgerTests {
  @Test func neverMarksAnAgentOnFirstSightWhateverItsHistory() {
    let ledger = UnreadLedger.empty.reconciling([row("a", .idle, statusSinceMs: at(-1))], nowMs: at(0))
    #expect(ledger.unreadIDs.isEmpty)
  }

  @Test func marksAnAgentWhoseIdleBeganAfterItWasLastInFrontOfTheUser() {
    let seen = UnreadLedger.empty.reconciling([row("a", .working)], nowMs: at(0))
    let finished = seen.reconciling([row("a", .idle, statusSinceMs: at(30))], nowMs: at(31))
    #expect(finished.unreadIDs == ["a"])
    let later = finished.reconciling([row("a", .idle, statusSinceMs: at(30))], nowMs: at(90))
    #expect(later.unreadIDs == ["a"])
  }

  @Test func marksATurnThatBeganAndEndedBetweenTwoProjections() {
    let seen = UnreadLedger.empty.reconciling([row("a", .idle, statusSinceMs: at(-60))], nowMs: at(0))
    let coalesced = seen.reconciling([row("a", .idle, statusSinceMs: at(5))], nowMs: at(6))
    #expect(coalesced.unreadIDs == ["a"])
  }

  @Test func clearsTheMarkTheMomentTheAgentIsActiveAndStaysClearAfter() {
    let seen = UnreadLedger.empty.reconciling([row("a", .working)], nowMs: at(0))
    let finished = seen.reconciling([row("a", .idle, statusSinceMs: at(30))], nowMs: at(31))
    let looked = finished.reconciling([row("a", .idle, active: true, statusSinceMs: at(30))], nowMs: at(40))
    #expect(looked.unreadIDs.isEmpty)
    let away = looked.reconciling([row("a", .idle, statusSinceMs: at(30))], nowMs: at(50))
    #expect(away.unreadIDs.isEmpty)
  }

  @Test func isNotUnreadWhileWorkingAndDoesNotMarkATurnFinishedWhileActive() {
    let seen = UnreadLedger.empty.reconciling([row("a", .working, active: true)], nowMs: at(0))
    let stillActive = seen.reconciling([row("a", .idle, active: true, statusSinceMs: at(30))], nowMs: at(31))
    #expect(stillActive.unreadIDs.isEmpty)
    let busy = seen.reconciling([row("a", .working, statusSinceMs: at(30))], nowMs: at(31))
    #expect(busy.unreadIDs.isEmpty)
  }

  @Test func ignoresBareTerminalsAndForgetsRemovedAgents() {
    let seen = UnreadLedger.empty.reconciling(
      [row("t", .working, hasAgent: false, statusSinceMs: nil), row("a", .working)], nowMs: at(0))
    let done = seen.reconciling(
      [row("t", .idle, hasAgent: false, statusSinceMs: nil), row("a", .idle, statusSinceMs: at(10))],
      nowMs: at(11))
    #expect(done.unreadIDs == ["a"])
    let gone = done.reconciling([], nowMs: at(12))
    #expect(gone.unreadIDs.isEmpty)
    #expect(gone.seenAtByID.isEmpty)
  }
}

@Suite struct ProjectTintTests {
  /// Goldens generated from the reference's `project-tint.ts` under Node 26 on
  /// 2026-09-13 (`scratchpad/tint-goldens.mts`). If a row fails, the port has
  /// drifted — fix the port, never the goldens.
  @Test func matchesTheReferenceHueGoldens() {
    let hues: [Double] = [
      285, 130.80531825371497, 3.6106365074299447, 209.41595476114503, 82.22127301485989,
      315.026591268575, 160.83190952229006, 33.63722777600492, 266.44254602972, 112.24786428343486,
      345.05318253714995, 190.85850079086504,
    ]
    for (seq, hue) in hues.enumerated() {
      #expect(abs(projectHue(seq) - hue) < 1e-9, "projectHue(\(seq))")
    }
    let panes: [Double] = [
      27.902659126857486, 233.70797738057252, 106.51329563428749, 339.31861388800246,
    ]
    for (seq, hue) in panes.enumerated() {
      #expect(abs(paneHue(seq) - hue) < 1e-9, "paneHue(\(seq))")
    }
  }

  @Test func matchesTheReferenceColourGoldens() {
    let light = [
      "#7970d5", "#60911f", "#c65376", "#0091a2", "#a57700", "#a161bd", "#009865", "#ca5840",
      "#577ad9", "#828700", "#bc5694", "#00938f",
    ]
    let dark = [
      "#a29dff", "#89bd51", "#f77fa0", "#00c0d6", "#d9a00e", "#ce8ceb", "#35c78b", "#fa846a",
      "#84a7ff", "#adb42d", "#ec81c0", "#00c4be",
    ]
    for seq in 0..<12 {
      #expect(projectTint(seq, .light) == light[seq], "light \(seq)")
      #expect(projectTint(seq, .dark) == dark[seq], "dark \(seq)")
    }
    #expect(paneTint(0, .light) == "#ca564b")
    #expect(paneTint(1, .light) == "#008bbf")
    #expect(paneTint(0, .dark) == "#fb8274")
    #expect(paneTint(3, .dark) == "#e883c9")
    #expect(oklchToHex(l: 0, c: 0, hueDegrees: 0) == "#000000")
    #expect(oklchToHex(l: 1, c: 0, hueDegrees: 0) == "#ffffff")
    #expect(oklchToHex(l: 0.6, c: 0, hueDegrees: 0) == "#808080")
    // A saturated colour outside sRGB comes back valid rather than clipped to a different hue.
    #expect(oklchToHex(l: 0.74, c: 0.4, hueDegrees: 145) == "#00ce39")
    #expect(oklchToHex(l: 0.5, c: 0.2, hueDegrees: 30) == "#ba0d01")
    #expect(oklchToHex(l: 0.8, c: 0.1, hueDegrees: 200) == "#64d1d7")
  }

  @Test func dealsHuesAlongTheGoldenRatioOffTheWithheldBand() {
    let hues = (0..<24).map { projectHue($0) }
    for hue in hues {
      #expect(hue >= 0 && hue < 360)
      // Nothing lands in the 27° band around --vf-select.
      #expect(hue < 238 || hue >= 265)
    }
    // Every prefix stays spread: no two of the first eight within 20°.
    for left in 0..<8 {
      for right in (left + 1)..<8 {
        let distance = abs(hues[left] - hues[right])
        #expect(min(distance, 360 - distance) > 20)
      }
    }
    func distance(_ a: Double, _ b: Double) -> Double { min(abs(a - b), 360 - abs(a - b)) }
    for seq in 0..<12 {
      #expect(distance(paneHue(seq), projectHue(seq)) > 40)
      #expect(paneHue(seq) < 238 || paneHue(seq) >= 265)
    }
  }

  @Test func isTheSameHueInBothThemesOnlyLightnessMoves() {
    #expect(projectTint(0, .light) != projectTint(0, .dark))
    #expect(projectTint(3, .light) == projectTint(3, .light))
    #expect(SwarmColor.project(0, .light).hex == "#7970d5")
  }
}

@Suite struct SwarmColorTests {
  @Test func readsTheHexFormsTheTokensUse() {
    #expect(SwarmColor(hex: "#ff9f0a") == SwarmColor(r: 1, g: 159.0 / 255, b: 10.0 / 255, a: 1))
    #expect(SwarmColor(hex: "#fff") == .white)
    #expect(SwarmColor(hex: "#00000080") == SwarmColor(r: 0, g: 0, b: 0, a: 128.0 / 255))
    #expect(SwarmColor(hex: "#12345") == nil)
    #expect(SwarmColor(hex: "rgb(0 0 0)") == nil)
    #expect(SwarmColor(hex: "#7970d5")?.hex == "#7970d5")
  }

  @Test func scalesAlphaAndTellsALightGroundFromADarkOne() {
    #expect(SwarmColor(r: 1, g: 1, b: 1, a: 0.5).withAlpha(0.5) == SwarmColor(r: 1, g: 1, b: 1, a: 0.25))
    #expect(abs(SwarmColor.white.luminance - 1) < 1e-6)
    #expect(SwarmColor(r: 0.067, g: 0.067, b: 0.067).luminance < 0.5)
  }
}

@Suite struct ProjectLedgerTests {
  @Test func dealsUnseenKeysInOrderAndNeverDealsANumberTwice() {
    var ledger = ProjectLedger.empty.dealing(["vibe-field", "truffle"])
    #expect(ledger.seqByKey == ["vibe-field": 0, "truffle": 1])
    #expect(ledger.next == 2)
    let same = ledger.dealing(["truffle", "vibe-field"])
    #expect(same == ledger)
    ledger = ledger.dealing(["ice", "truffle"])
    #expect(ledger.seqByKey["ice"] == 2)
    #expect(ledger.seqByKey["truffle"] == 1)
  }

  @Test func roundTripsThroughTheDesktopsStoredShape() {
    let ledger = ProjectLedger(seqByKey: ["a": 0, "b": 1, "c": 2], next: 3)
    let data = ProjectLedgerCodec.encode(ledger)!
    #expect(ProjectLedgerCodec.decode(data) == ledger)
    // `next` is the larger of what was saved and what the dealt sequences imply.
    let truncated = ProjectLedgerCodec.decode(
      #"{"version":1,"next":1,"seqs":[["a",0],["b",4]]}"#.data(using: .utf8)!)
    #expect(truncated == ProjectLedger(seqByKey: ["a": 0, "b": 4], next: 5))
    #expect(ProjectLedgerCodec.decode(#"{"version":2}"#.data(using: .utf8)!) == .empty)
    #expect(ProjectLedgerCodec.decode(Data("junk".utf8)) == .empty)
  }

  @Test func dealsPanesInTheOrderTheyOpenAndNeverDealsANumberTwice() {
    var ledger = PaneColourLedger.empty.dealing(["a", "b"])
    #expect(ledger.seqByID == ["a": 0, "b": 1])
    let same = ledger.dealing(["a", "b"])
    #expect(same == ledger)
    ledger = ledger.dealing(["b", "c"])
    #expect(ledger.seqByID == ["b": 1, "c": 2])
    // A reopened pane id is a new pane: the closed pane's number stays retired.
    ledger = ledger.dealing(["b", "c", "a"])
    #expect(ledger.seqByID["a"] == 3)
    let colours = PaneColourLedger.empty.dealing(["a", "b"]).colours(.light)
    #expect(colours["a"] == SwarmColor.pane(0, .light))
    #expect(colours["b"] == SwarmColor.pane(1, .light))
    #expect(colours["a"] != SwarmColor.project(0, .light))
  }
}

@Suite struct FieldAssemblyTests {
  private let now = Date(timeIntervalSince1970: t0 / 1000)

  private func agent(_ id: String, project: String, status: AgentVisualStatus = .idle, state: AgentRuntimeState? = nil)
    -> FieldBubble
  {
    let runtime = state ?? AgentRuntimeState(statusSince: now.addingTimeInterval(-60), lastEvidenceAt: now)
    let snapshot = AgentSnapshot(
      id: id, runtimeSessionID: "r-\(id)", provider: .claude, project: project, state: runtime, createdAt: now)
    return fieldBubble(from: snapshot)!
  }

  private func terminal(_ id: String) -> FieldBubble {
    FieldBubble(id: id, project: "zsh", detail: "studio", status: .idle, identityKey: id, createdAt: now, remote: RemoteFacet(
      deviceID: "d", deviceName: "studio", sessionID: "1", attachable: true, readWrite: false))
  }

  @Test func dealsEveryAgentsProjectAColourAndLeavesTerminalsInTheRamp() {
    var assembly = FieldAssembly(tint: .light)
    let rows = assembly.fold(
      [agent("a", project: "vibe-field"), agent("b", project: "truffle"), agent("c", project: "vibe-field"), terminal("t")],
      cardSubjectID: nil, nowMs: t0)
    #expect(rows[0].color == SwarmColor.project(0, .light))
    #expect(rows[1].color == SwarmColor.project(1, .light))
    // Two runs in one project share a colour.
    #expect(rows[2].color == rows[0].color)
    #expect(rows[3].color == nil)
    // The deal is kept across folds and the theme only changes the tint.
    assembly.tint = .dark
    let again = assembly.fold([agent("b", project: "truffle")], cardSubjectID: nil, nowMs: t0 + 1000)
    #expect(again[0].color == SwarmColor.project(1, .dark))
  }

  @Test func theOpenCardsSubjectIsThePaneAndWearsItsColour() {
    var assembly = FieldAssembly(tint: .light)
    let rows = assembly.fold([agent("a", project: "p"), agent("b", project: "q")], cardSubjectID: "b", nowMs: t0)
    #expect(rows[0].active == false)
    #expect(rows[0].pane == nil)
    #expect(rows[1].active)
    #expect(rows[1].pane == PaneLink(color: SwarmColor.pane(0, .light)))
    let closed = assembly.fold([agent("a", project: "p"), agent("b", project: "q")], cardSubjectID: nil, nowMs: t0 + 1)
    #expect(closed[1].pane == nil)
    #expect(closed[1].active == false)
  }

  @Test func joinsTheUsageLedgerAndMarksUnreadAndStaleRows() {
    var assembly = FieldAssembly(tint: .light)
    let working = AgentRuntimeState(
      activeTurn: true, usage: AgentUsage(cumulativeTokens: 1_000), statusSince: now, lastEvidenceAt: now)
    var rows = assembly.fold([agent("a", project: "p", state: working)], cardSubjectID: nil, nowMs: t0)
    #expect(rows[0].agent?.usage?.total == 1_000)
    #expect(rows[0].unread == false)
    #expect(rows[0].stale == false)
    // The turn ends after the row was seen: the reply is unread until its card opens.
    let done = AgentRuntimeState(
      lastAssistantMessage: "Done.", usage: AgentUsage(cumulativeTokens: 1_400),
      statusSince: now.addingTimeInterval(30), lastEvidenceAt: now.addingTimeInterval(30))
    rows = assembly.fold([agent("a", project: "p", state: done)], cardSubjectID: nil, nowMs: t0 + 31_000)
    #expect(rows[0].unread)
    #expect(rows[0].agent?.usage?.total == 1_400)
    rows = assembly.fold([agent("a", project: "p", state: done)], cardSubjectID: "a", nowMs: t0 + 32_000)
    #expect(rows[0].unread == false)
    // Evidence older than the freshness policy dims the body.
    rows = assembly.fold([agent("a", project: "p", state: done)], cardSubjectID: nil, nowMs: t0 + 31_000 + 30_001)
    #expect(rows[0].stale)
  }

  @Test func theProjectionCarriesTheMonitorsFacts() {
    let state = AgentRuntimeState(
      permissions: [AgentPermission(tool: "Bash")], effort: AgentEffort(value: "high", intent: .configured),
      lastAssistantMessage: "May I?", usage: AgentUsage(cumulativeTokens: 5),
      statusSince: now, lastEvidenceAt: now)
    let bubble = agent("a", project: "p", state: state)
    #expect(bubble.status == .blocked)
    #expect(bubble.agent?.blockerKind == .permission)
    #expect(bubble.agent?.effort == AgentEffort(value: "high", intent: .configured))
    #expect(bubble.agent?.lastMessage == "May I?")
    #expect(bubble.agent?.monitorUsage?.cumulativeTokens == 5)
    #expect(bubble.agent?.statusSince == now)
    // Not blocked: no kind, even with a stale blocker list nobody classified.
    #expect(agent("b", project: "p").agent?.blockerKind == nil)
  }
}
