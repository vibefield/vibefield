import Foundation
import SwarmPhysics
import Testing

@testable import FieldAgents

// The reference's `bubble-model.test.ts` (the one-ink revision, 2026-09-18),
// transcribed: the same rows, the same numbers. If a row here disagrees with
// the reference, the port drifted.

private let now = Date(timeIntervalSince1970: 1_788_688_800)  // 2026-09-06T10:00:00Z
private let at = now.addingTimeInterval(-5)

/// A ledger history with the given corrected total, its newest step the tallest.
private func usageHistory(_ total: Double) -> UsageHistory {
  UsageHistory(total: total, steps: (0..<usageStepCount).map { Double($0 + 1) * 100 })
}

private func terminal(
  id: String = "a", status: AgentVisualStatus = .idle, remote: RemoteFacet? = nil
) -> FieldBubble {
  FieldBubble(
    id: id, project: "puppeteer", detail: "Editing tokens.css", status: status, identityKey: id,
    createdAt: now, agent: nil, remote: remote, color: SwarmColor(hex: "#6366f1"))
}

private func agent(
  id: String = "a",
  status: AgentVisualStatus = .idle,
  facet: AgentFacet = AgentFacet(provider: .claude, modelName: "Fable 5.1"),
  color: SwarmColor? = SwarmColor(hex: "#6366f1"),
  stale: Bool = false,
  unread: Bool = false,
  pane: PaneLink? = nil
) -> FieldBubble {
  FieldBubble(
    id: id, project: "puppeteer", detail: "Editing tokens.css", status: status, identityKey: id,
    createdAt: now, agent: facet, remote: nil, color: color, stale: stale, pane: pane, unread: unread)
}

private func model(
  _ bubble: FieldBubble, runningSince: Date? = nil, share: Double = 0
) -> SwarmBodyModel {
  bodyModel(
    BodyModelInput(
      bubble: bubble, parameters: .default, now: now, runningSince: runningSince, workingShare: share))
}

@Suite struct FormatTokensTests {
  @Test func formatsTokenCountsCompactly() {
    #expect(formatTokens(820) == "820")
    #expect(formatTokens(8_100) == "8.1k")
    #expect(formatTokens(24_000) == "24k")
    #expect(formatTokens(384_000) == "384k")
    #expect(formatTokens(1_240_000) == "1.2M")
    #expect(formatTokens(24_000_000) == "24M")
  }

  @Test func formatsElapsedLikeAClock() {
    #expect(formatElapsed(since: now.addingTimeInterval(-83), now: now) == "1:23")
    #expect(formatElapsed(since: now.addingTimeInterval(-3_725), now: now) == "1h 02m")
    #expect(formatElapsed(since: nil, now: now) == nil)
  }

  @Test func formatsTheBurnRateByTheHour() {
    #expect(formatRatePerHour(nil) == "—/hr")
    #expect(formatRatePerHour(0.52) == "$31/hr")
    #expect(formatRatePerHour(0.08) == "$4.8/hr")
    #expect(formatRatePerHour(0.01) == "$0.60/hr")
    #expect(formatRatePerHour(1.6) == "$96/hr")
  }

  @Test func lightsTheLadderAtEachStep() {
    #expect(burnLadder == [0.05, 0.15, 0.4, 1])
    #expect(burnFlames(costPerMin: 0.04) == 0)
    #expect(burnFlames(costPerMin: 0.05) == 1)
    #expect(burnFlames(costPerMin: 0.39) == 2)
    #expect(burnFlames(costPerMin: 0.4) == 3)
    #expect(burnFlames(costPerMin: 12) == 4)
  }
}

@Suite struct SwarmBodyModelTests {
  @Test func drawsAnUnclaimedIdleTerminalAsAHollowWithTheFolderInTheInkAndEmpty() {
    let body = model(terminal())
    #expect(body.state == .terminalEmpty)
    #expect(body.hollow)
    #expect(!body.running)
    #expect(body.radius == 50)
    // One line, the folder then the name, as every other body reads it; a
    // terminal has no project, so its folder wears the ink.
    #expect(body.copy.map(\.key) == ["name", "sub"])
    #expect(body.copy[0].tone == .ink)
    #expect(body.copy[0].lead?.kind == .icon("folder"))
    #expect(body.copy[0].lead?.tone == .ink)
    #expect(body.copy[1].text == "empty")
    #expect(body.ring == nil)
    #expect(body.watermark == nil)
    #expect(body.light == nil)
  }

  @Test func drawsARunningTerminalWithTheCometRunningAndTheElapsedTime() {
    let body = model(terminal(status: .working), runningSince: now.addingTimeInterval(-83))
    #expect(body.state == .terminalRunning)
    #expect(body.running)
    #expect(body.copy.map(\.text) == ["puppeteer", "running", "1:23"])
  }

  @Test func neverMarksATerminalUnread() {
    var bubble = terminal()
    bubble.unread = true
    #expect(model(bubble).unread == false)
  }

  @Test func putsAnUnreadReplyItselfInTheNamesPlaceAndFillsTheBodyBlueBehindIt() {
    let facet = AgentFacet(
      provider: .claude, modelName: "Fable 5.1",
      effort: AgentEffort(value: "high", intent: .configured),
      lastMessage: "Done: two tests fixed.\nDetails below.")
    let body = model(agent(facet: facet, unread: true))
    #expect(body.state == .idle)
    #expect(body.radius == 50)
    // Three lines: the project above, what arrived, the model. Nothing after it.
    #expect(body.copy.map(\.key) == ["name", "state", "model"])
    // The project moves above in label type: its folder turns solid and keeps
    // full strength, while its NAME steps back to a supporting rung, because
    // the name is no longer what the body is telling you.
    #expect(body.copy[0].text == "puppeteer")
    #expect(body.copy[0].style.size == 7.5)
    #expect(body.copy[0].opacity == SwarmWeight.supporting)
    #expect(body.copy[0].lead?.kind == .icon("folder-solid"))
    #expect(body.copy[0].lead?.tone == .accent)
    #expect(body.copy[0].lead?.opacity == SwarmWeight.title)
    // The reply's own words behind the chat mark. The state's colour is the
    // body's GROUND now, so the words are the theme's ink like every other
    // body's — light on a dark theme, dark on a light one.
    #expect(body.copy[1].text == "Done: two tests fixed.")
    #expect(body.copy[1].tone == .ink)
    #expect(body.copy[1].lead?.kind == .icon("message"))
    #expect(body.copy[1].lead?.tone == nil)
    #expect(body.copy[2].text == "Fable 5.1 · high")
    // Launch intent, no provider evidence yet: italic.
    #expect(body.copy[2].style.italic)
    #expect(body.unread)
    #expect(body.light == .blue)
    #expect(body.accessibilityLabel.hasSuffix(", new message: Done: two tests fixed."))
  }

  @Test func fallsBackToTheWordsNewMessageWithNoReplyToShowAndSaysNothingOnceRead() {
    let body = model(agent(unread: true))
    #expect(body.copy.map(\.key) == ["name", "state", "model"])
    #expect(body.copy[1].text == "new message")
    let read = model(agent(unread: false))
    #expect(read.copy.map(\.key) == ["name", "model"])
    // Read and idle: the name keeps the full size, the outlined folder, and no light.
    #expect(read.copy[0].style.size == 12)
    #expect(read.copy[0].opacity == SwarmWeight.title)
    #expect(read.copy[0].lead?.kind == .icon("folder"))
    #expect(read.copy[0].lead?.tone == .accent)
    #expect(read.light == nil)
  }

  @Test func givesAWorkingAgentTheLargerBodyBranchNameModelEffortTheBurnTheRingAndBothFigures() {
    let facet = AgentFacet(
      provider: .claude, modelName: "Fable 5.1", branch: "swarm", contextUsedPercent: 62.7,
      effort: AgentEffort(value: "high", intent: .observed),
      monitorUsage: AgentUsage(cumulativeTokens: 999, costCoverage: .complete, costRatePerMin: 0.52),
      usage: usageHistory(1.24))
    let body = model(agent(status: .working, facet: facet))
    #expect(body.state == .working)
    #expect(body.radius == 60)
    #expect(body.copy.map(\.key) == ["branch", "name", "model"])
    #expect(body.copy[0].lead?.tone == .green)
    #expect(body.copy[1].tone == .ink)
    #expect(body.copy[1].lead?.kind == .icon("folder"))
    #expect(body.copy[2].text == "Fable 5.1 · high")
    #expect(body.ring == SwarmRing(percent: 62, hot: false))
    #expect(body.figures?.top == SwarmFigure(text: "62%", hot: false, none: false))
    #expect(body.figures?.bottom == SwarmFigure(text: "~$1.24", hot: false, none: false))
    // The bottom figure is the ledger's corrected total; the burn is Core's own
    // live rate on the fixed ladder — $0.52/min is the third step.
    #expect(body.burn == SwarmBurn(lit: 3, priced: true))
    #expect(body.light == .ink)
    #expect(body.title.hasSuffix("· $31/hr"))
    #expect(body.accessibilityLabel.hasSuffix(", burning $31/hr"))
    #expect(body.watermark?.sprite == "claude")
    #expect(body.watermark?.opacity == SwarmWeight.watermark)
  }

  @Test func lightsTheBurnLadderByTheRateAndLeavesItUnreadWhereNothingPricesTheWork() {
    func working(_ coverage: AgentCostCoverage?, _ rate: Double?) -> SwarmBodyModel {
      model(
        agent(
          status: .working,
          facet: AgentFacet(
            provider: .claude, modelName: "Fable 5.1",
            monitorUsage: AgentUsage(costCoverage: coverage, costRatePerMin: rate))))
    }
    // The steps: under 5c calm, then 5c, 15c, 40c and a dollar a minute.
    #expect(working(.complete, 0.04).burn == SwarmBurn(lit: 0, priced: true))
    #expect(working(.complete, 0.05).burn == SwarmBurn(lit: 1, priced: true))
    #expect(working(.complete, 0.39).burn == SwarmBurn(lit: 2, priced: true))
    #expect(working(.complete, 0.4).burn == SwarmBurn(lit: 3, priced: true))
    #expect(working(.complete, 12).burn == SwarmBurn(lit: 4, priced: true))
    // A priced session that has not spent lately is calm; one with no pricing
    // lane at all is unread, and never reads as calm.
    #expect(working(.complete, nil).burn == SwarmBurn(lit: 0, priced: true))
    let unpriced = working(.unavailable, 9)
    #expect(unpriced.burn == SwarmBurn(lit: 0, priced: false))
    #expect(unpriced.title.hasSuffix("· —/hr"))
    // Partial coverage still prices what it saw.
    #expect(working(.partial, 0.2).burn == SwarmBurn(lit: 2, priced: true))
    // No usage at all — today's wire — is the missing lane, not a calm session.
    #expect(working(nil, nil).burn == SwarmBurn(lit: 0, priced: false))
  }

  @Test func marksAPartialTotalWithAPlus() {
    let facet = AgentFacet(
      provider: .claude, modelName: "Fable 5.1",
      usage: UsageHistory(total: 0.2, coverage: .partial, steps: [Double](repeating: 0, count: usageStepCount)))
    #expect(model(agent(status: .working, facet: facet)).figures?.bottom?.text == "~$0.20+")
  }

  @Test func growsAWorkingBodyFromTheWorkingSizeToTheLargestByItsShare() {
    let bubble = agent(status: .working)
    #expect(model(bubble).radius == 60)
    #expect(model(bubble, share: 0.5).radius == 70)
    #expect(model(bubble, share: 1).radius == 80)
  }

  @Test func placesWorkingSessionsByEstimatedUSDLeastZeroAndMostOne() {
    func working(_ id: String, _ total: Double, status: AgentVisualStatus = .working) -> FieldBubble {
      agent(id: id, status: status, facet: AgentFacet(provider: .claude, usage: usageHistory(total)))
    }
    let shares = workingShares([
      working("a", 100), working("b", 400), working("c", 1300), working("d", 9000, status: .idle),
    ])
    #expect(shares == ["a": 0, "b": 0.25, "c": 1])
    #expect(workingShares([working("a", 100)]) == ["a": 0])
  }

  @Test func holdsABlockedAgentAtTheIdleSizeLightsItOrangeAndSaysWhatItWaitsOn() {
    let facet = AgentFacet(
      provider: .claude, modelName: "Fable 5.1", contextUsedPercent: 88,
      permissions: [AgentPermission(tool: "Bash")], blocker: AgentBlocker(kind: .permission, tool: "Bash"),
      lastMessage: "May I run pnpm test?")
    let body = model(agent(status: .blocked, facet: facet))
    #expect(body.state == .blocked)
    #expect(body.radius == 50)
    #expect(body.light == .orange)
    #expect(body.blockerKind == .permission)
    #expect(body.copy.map(\.key) == ["name", "state", "model"])
    // The permission's own evidence — the tool it wants — before the reply's words.
    #expect(body.copy[1].text == "Bash")
    #expect(body.copy[1].tone == .ink)
    #expect(body.copy[1].lead?.kind == .icon("permission"))
    #expect(body.copy[1].lead?.tone == nil)
    #expect(body.copy[1].lead?.size == 11 && body.copy[1].lead?.width == 8)
    #expect(body.accessibilityLabel.hasSuffix(", permission: Bash"))
    #expect(body.ring == SwarmRing(percent: 88, hot: true))
    #expect(body.figures == nil)
    #expect(body.copyMaxWidthRatio == 0.86)
  }

  @Test func asksTheQuestionAsItWasAskedAndNamesTheBlockerWhenThereIsNothingToQuote() {
    let asked = AgentFacet(
      provider: .claude, modelName: "Fable 5.1",
      blocker: AgentBlocker(kind: .question, question: "Which key should the export use?"))
    let body = model(agent(status: .blocked, facet: asked))
    #expect(body.copy.map(\.key) == ["name", "state", "model"])
    let state = body.copy.first { $0.key == "state" }
    #expect(state?.text == "Which key should the export use?")
    #expect(state?.tone == .ink)
    #expect(state?.lead?.kind == .icon("question"))

    let bare = AgentFacet(provider: .claude, modelName: "Fable 5.1", blocker: AgentBlocker(kind: .question))
    let unnamed = model(agent(status: .blocked, facet: bare))
    #expect(unnamed.copy.first { $0.key == "state" }?.text == "question")
  }

  @Test func aBlockerSpeaksItsOwnEvidenceBeforeTheReplyAndTheWordLast() {
    // An adapter's line beats the tool; the tool beats the reply; the reply beats the word.
    #expect(
      blockerText(AgentBlocker(kind: .permission, detail: "Delete the stale build folder", tool: "Bash"), message: "May I?")
        == "Delete the stale build folder")
    #expect(blockerText(AgentBlocker(kind: .permission, tool: "Bash"), message: "May I?") == "Bash")
    #expect(blockerText(AgentBlocker(kind: .permission), message: "May I?") == "May I?")
    #expect(blockerText(AgentBlocker(kind: .permission), message: nil) == "permission")
    #expect(blockerText(AgentBlocker(kind: .failure, code: "E_TOOL"), message: "it broke") == "E_TOOL")
    #expect(blockerText(AgentBlocker(kind: .failure), message: nil) == "failed")
    // Whitespace is not evidence.
    #expect(blockerText(AgentBlocker(kind: .question, question: "  "), message: nil) == "question")
  }

  @Test func aBlockedBodyWithNoBlockerFallsBackToTheReplyThenTheWord() {
    let facet = AgentFacet(provider: .claude, modelName: "Fable 5.1", lastMessage: "stuck here")
    let body = model(agent(status: .blocked, facet: facet))
    let state = body.copy.first { $0.key == "state" }
    #expect(state?.text == "stuck here")
    #expect(state?.lead?.kind == .icon("failure"))
    #expect(body.blockerKind == nil)
    let bare = model(agent(status: .blocked, facet: AgentFacet(provider: .claude, modelName: "Fable 5.1")))
    #expect(bare.copy.first { $0.key == "state" }?.text == "blocked")
  }

  @Test func carriesThePaneLinkTheStaleFlagAndTheAccessibleCopy() {
    let accent = SwarmColor(hex: "#ec4899")!
    let pane = SwarmColor(hex: "#22cc88")!
    let body = model(agent(color: accent, stale: true, pane: PaneLink(color: pane)))
    #expect(body.stale)
    // The band is the pane's colour; the project's colour reaches the body in
    // one place only, the folder before its name.
    #expect(body.linked == pane)
    #expect(body.accent == accent)
    let name = body.copy.first { $0.key == "name" }
    #expect(name?.lead?.kind == .icon("folder"))
    #expect(name?.lead?.tone == .accent)
    #expect(body.copy.filter { $0.lead?.tone == .accent }.map(\.key) == ["name"])
    #expect(model(agent(color: accent)).linked == nil)
    #expect(body.accessibilityLabel == "puppeteer, Fable 5.1, idle: Editing tokens.css, CTX:--%")
    #expect(body.title == "puppeteer · Fable 5.1 · Editing tokens.css")
  }

  @Test func figuresReadDashesWhenNothingIsKnown() {
    let body = model(agent(status: .working, facet: AgentFacet(provider: .codex, modelName: "o5")))
    #expect(body.figures?.top == SwarmFigure(text: "--", hot: false, none: true))
    #expect(body.figures?.bottom == SwarmFigure(text: "—", hot: false, none: true))
    #expect(body.burn == SwarmBurn(lit: 0, priced: false))
    #expect(body.ring == nil)
    #expect(body.copy.map(\.key) == ["name", "model"])
    #expect(body.copy[1].text == "o5")
  }

  @Test func theFolderIsDrawnLargerThanTheTypeAndNarrowedToItsInk() {
    let outlined = projectFolder(SwarmCopyStyle.workingName)
    #expect(outlined.kind == .icon("folder") && outlined.size == 16 && outlined.width == 12 && outlined.gap == 4)
    #expect(outlined.opacity == nil && outlined.tone == .accent)
    let solid = projectFolder(SwarmCopyStyle.projectAbove, solid: true)
    #expect(solid.kind == .icon("folder-solid") && solid.size == 10 && solid.width == 8)
    #expect(solid.opacity == SwarmWeight.title)
    #expect(projectFolder(SwarmCopyStyle.terminalName, tone: .ink).tone == .ink)
  }
}

@Suite struct RemoteBodyModelTests {
  private func remoteRow(hostWritable: Bool) -> FieldBubble {
    FieldBubble(
      id: "r1", project: "mesh-console", detail: "studio-mini · /Projects/mesh-console",
      status: .idle, identityKey: "r1", createdAt: now, agent: nil,
      remote: RemoteFacet(
        deviceID: "mini", deviceName: "studio-mini", sessionID: "s1", attachable: true,
        readWrite: hostWritable, cwdLabel: "/Projects/mesh-console"))
  }

  @Test func namesThePeerFirstInTheAccessibleNameThenTheHostWritePolicy() {
    #expect(
      model(remoteRow(hostWritable: false)).accessibilityLabel
        == "on studio-mini, mesh-console, remote session, idle, read-only host")
    #expect(
      model(remoteRow(hostWritable: true)).accessibilityLabel
        == "on studio-mini, mesh-console, remote session, idle, writable host")
  }

  @Test func wearsTheHostOnTheBodyInBothDirections() {
    let refusing = model(remoteRow(hostWritable: false)).copy.first { $0.key == "host" }
    let permitting = model(remoteRow(hostWritable: true)).copy.first { $0.key == "host" }
    #expect(refusing?.text == "studio-mini · read-only host")
    #expect(permitting?.text == "studio-mini · writable host")
    // …and a host property is never upgraded into a promise to the viewer.
    #expect(permitting?.text.contains("you") == false)
    #expect(model(remoteRow(hostWritable: true)).title.contains("decided when you attach"))
    // A remote row is a hollow, in the ramp, never a project's colour.
    let body = model(remoteRow(hostWritable: true))
    #expect(body.hollow)
    #expect(body.accent == nil)
  }
}
