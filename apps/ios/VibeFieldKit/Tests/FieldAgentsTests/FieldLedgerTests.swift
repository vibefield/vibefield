import Foundation
import Testing

@testable import FieldAgents

// The reference's `project-tint.test.ts` and `pane-colours.test.ts`, transcribed, plus the phone's own fold.
// (PG-3e: `unread.test.ts`'s rows went with the phone's unread ledger, which retired — the row carries its owner's
// mark — and so did the fold's 30 s and desktop-grey rows; F2 pins that the dress keeps the row's own marks.)

private let t0: Double = 1_788_688_800_000  // 2026-09-06T10:00:00Z, epoch ms

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
      cardSubjectID: nil)
    #expect(rows[0].color == SwarmColor.project(0, .light))
    #expect(rows[1].color == SwarmColor.project(1, .light))
    // Two runs in one project share a colour.
    #expect(rows[2].color == rows[0].color)
    #expect(rows[3].color == nil)
    // The deal is kept across folds and the theme only changes the tint.
    assembly.tint = .dark
    let again = assembly.fold([agent("b", project: "truffle")], cardSubjectID: nil)
    #expect(again[0].color == SwarmColor.project(1, .dark))
  }

  @Test func theOpenCardsSubjectIsTheOnePane() {
    var assembly = FieldAssembly(tint: .light)
    let rows = assembly.fold([agent("a", project: "p"), agent("b", project: "q")], cardSubjectID: "b")
    #expect(rows[0].active == false)
    #expect(rows[0].mounted == false)
    #expect(rows[1].active)
    #expect(rows[1].mounted)
    let closed = assembly.fold([agent("a", project: "p"), agent("b", project: "q")], cardSubjectID: nil)
    #expect(closed[1].mounted == false)
    #expect(closed[1].active == false)
  }

  /// F1 (PG-3e) — the dress never rebuilds a row: the ids a drawn row carries beside its body's (the host's name, the
  /// model id a report names, the board key a resume names) ride through the fold exactly.
  @Test func theDressKeepsTheRowsIds() {
    var assembly = FieldAssembly(tint: .light)
    let base = agent("pty-h2", project: "vibe-field")
    let row = FieldBubble(
      id: base.id, project: base.project, detail: base.detail, status: base.status, identityKey: base.identityKey,
      createdAt: base.createdAt, agent: base.agent, host: "Loft", modelId: "run-h-launch", runKey: "run-h-launch-key")
    let dressed = assembly.fold([row], cardSubjectID: nil)
    #expect(dressed.count == 1)
    #expect(dressed.first?.host == "Loft")
    #expect(dressed.first?.modelId == "run-h-launch")
    #expect(dressed.first?.runKey == "run-h-launch-key")
    #expect(dressed.first?.id == "pty-h2")
  }

  /// F2 (PG-3e) — the dress keeps the row's own marks: a remote-cut row carries its owner's `stale` and `unread`, so a
  /// folded bubble keeps each exactly — whatever the phone's own clock and its ledger would have said of evidence an
  /// hour old (Q01's 30 s rule and the phone's unread ledger, retired with the switch).
  @Test func theDressKeepsTheRowsMarks() {
    var assembly = FieldAssembly(tint: .light)
    let hourOld = now.addingTimeInterval(-3_600)
    func row(_ id: String, status: AgentVisualStatus, stale: Bool, unread: Bool) -> FieldBubble {
      FieldBubble(
        id: id, project: "p", detail: "d", status: status, identityKey: id, createdAt: hourOld,
        agent: AgentFacet(provider: .claude, statusSince: hourOld, lastEvidenceAt: hourOld),
        stale: stale, unread: unread, modelId: id, runKey: id)
    }
    let rows = [
      row("marked", status: .idle, stale: true, unread: true),
      row("clear", status: .working, stale: false, unread: false),
      row("quiet", status: .blocked, stale: false, unread: true),
    ]
    let dressed = assembly.fold(rows, cardSubjectID: nil)
    let stale = dressed.map { $0.stale }
    let unread = dressed.map { $0.unread }
    #expect(stale == [true, false, false])
    #expect(unread == [true, false, true])
  }

  @Test func theProjectionCarriesTheMonitorsFacts() {
    let state = AgentRuntimeState(
      permissions: [AgentPermission(tool: "Bash")], effort: AgentEffort(value: "high", intent: .configured),
      lastAssistantMessage: "May I?",
      usage: AgentUsage(cumulativeTokens: 5, costUsd: 0.5, costCoverage: .partial, costRatePerMin: 0.2),
      statusSince: now, lastEvidenceAt: now)
    let bubble = agent("a", project: "p", state: state)
    #expect(bubble.status == .blocked)
    #expect(bubble.agent?.blockerKind == .permission)
    #expect(bubble.agent?.effort == AgentEffort(value: "high", intent: .configured))
    #expect(bubble.agent?.lastMessage == "May I?")
    // the usage reaches the body as the owner's cost: the USD, the word, and the rate by the hour (J3 (a))
    #expect(bubble.agent?.cost == AgentCost(usd: 0.5, coverage: "partial", burnPerHour: 0.2 * 60))
    #expect(agentCost(AgentUsage(cumulativeTokens: 5)) == nil)
    #expect(agentCost(AgentUsage(costUsd: 2)) == AgentCost(usd: 2, coverage: "unavailable"))
    #expect(bubble.agent?.statusSince == now)
    // Not blocked: no kind, even with a stale blocker list nobody classified.
    #expect(agent("b", project: "p").agent?.blockerKind == nil)
  }
}
