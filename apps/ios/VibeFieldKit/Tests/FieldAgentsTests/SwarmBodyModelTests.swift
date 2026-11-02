import Foundation
import SwarmPhysics
import Testing

@testable import FieldAgents

// The reference's `bubble-model.test.ts` (the one-ink revision, 2026-09-18),
// transcribed: the same rows, the same numbers. If a row here disagrees with
// the reference, the port drifted.

private let now = Date(timeIntervalSince1970: 1_788_688_800)  // 2026-09-06T10:00:00Z
private let at = now.addingTimeInterval(-5)

/// The owner's priced cost with the given total.
private func priced(_ total: Double, perHour: Double? = nil) -> AgentCost {
  AgentCost(usd: total, coverage: "complete", burnPerHour: perHour)
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
  mounted: Bool = false
) -> FieldBubble {
  FieldBubble(
    id: id, project: "puppeteer", detail: "Editing tokens.css", status: status, identityKey: id,
    createdAt: now, agent: facet, remote: nil, color: color, stale: stale, mounted: mounted, unread: unread)
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

  /// J3 (a) — the rate takes USD an hour, as the sdk's `formatRatePerHour` does; the words are the same.
  @Test func formatsTheBurnRateByTheHour() {
    #expect(formatRatePerHour(perHour: nil) == "—/hr")
    #expect(formatRatePerHour(perHour: 31.2) == "$31/hr")
    #expect(formatRatePerHour(perHour: 4.8) == "$4.8/hr")
    #expect(formatRatePerHour(perHour: 0.6) == "$0.60/hr")
    #expect(formatRatePerHour(perHour: 96) == "$96/hr")
  }

  /// R0 (PG-3e, the review's [0]; J1 (a), body for body) — the money rounds as the window's does. `formatUsd` is the
  /// sdk's `Intl.NumberFormat('en-US')`: the shortest decimal, half away from zero. The rate's tenths are its
  /// `toFixed(1)`: the exact binary value, an exact tie taking the larger. Every value was measured with node against
  /// puppeteer-view-sdk 0.3.2's `toolkit/format.js` (2026-11-02); `String(format:)` rounds the binary value half to
  /// even and missed each of the ties.
  @Test func moneyRoundsAsTheWindowDoes() {
    #expect(AgentCost(usd: 1.005, coverage: "complete").estimate == "~$1.01")
    #expect(AgentCost(usd: 0.125, coverage: "complete").estimate == "~$0.13")
    #expect(AgentCost(usd: 0.0045, coverage: "complete").estimate == "~$0.005")
    #expect(formatUsd(2.675) == "$2.68")
    #expect(formatUsd(1.115) == "$1.12")
    #expect(formatUsd(8.345) == "$8.35")
    #expect(formatUsd(0.995) == "$1.00")
    #expect(formatUsd(9.995) == "$10.00")
    #expect(formatUsd(0.0095) == "$0.010")
    #expect(formatUsd(0.0125) == "$0.01")
    #expect(formatUsd(1234.565) == "$1,234.57")
    #expect(formatUsd(123_456_789.125) == "$123,456,789.13")
    #expect(formatUsd(-1.005) == "$-1.01")
    #expect(formatUsd(-0.001) == "$-0.00")
    #expect(formatRatePerHour(perHour: 2.25) == "$2.3/hr")
    #expect(formatRatePerHour(perHour: 1.25) == "$1.3/hr")
    #expect(formatRatePerHour(perHour: 1.75) == "$1.8/hr")
    #expect(formatRatePerHour(perHour: 1.005) == "$1.0/hr")
    #expect(formatRatePerHour(perHour: 1.45) == "$1.4/hr")
    #expect(formatRatePerHour(perHour: 1.05) == "$1.1/hr")
    #expect(formatRatePerHour(perHour: 9.95) == "$9.9/hr")
    #expect(formatRatePerHour(perHour: 9.995) == "$10.0/hr")
    #expect(formatRatePerHour(perHour: 10.5) == "$11/hr")
    #expect(formatRatePerHour(perHour: 0.125) == "$0.13/hr")
  }

  /// Item 164 — a peer's `burnPerHour` is unbounded (the toolkit reader §6), and from 2^63 the rate's whole dollars
  /// trapped (`Int(perHour.rounded())`). They say JavaScript's digits, `Math.round` then `String`: padded with zeros
  /// below 1e21, an exponent from it, `Infinity`. Measured with node against puppeteer-view-sdk 0.3.2's
  /// `toolkit/format.js` (2026-11-02).
  @Test func anAbsurdRateSaysJavaScriptsDigits() {
    #expect(formatRatePerHour(perHour: 9.3e18) == "$9300000000000000000/hr")
    #expect(formatRatePerHour(perHour: 0x1p63) == "$9223372036854776000/hr")
    #expect(formatRatePerHour(perHour: 0x1p64) == "$18446744073709552000/hr")
    #expect(formatRatePerHour(perHour: 1e21) == "$1e+21/hr")
    #expect(formatRatePerHour(perHour: 1.5e300) == "$1.5e+300/hr")
    #expect(formatRatePerHour(perHour: .infinity) == "$Infinity/hr")
    #expect(formatRatePerHour(perHour: 1e15 + 0.5) == "$1000000000000001/hr")
  }

  /// Item 165 — the tenths are `toFixed(1)`, as the rate's are (PG-3e): an exact tie takes the larger, where
  /// `String(format: "%.1f")` broke it to even (8250 read `8.2k`). The whole counts are `Math.round` (a tie toward +∞)
  /// and `String`, so nothing traps: NaN, ±∞ and absurd counts say what JavaScript says. Measured with node against
  /// puppeteer-view-sdk 0.3.2's `toolkit/format.js` (2026-11-02).
  @Test func tokenCountsRoundAsTheWindowDoes() {
    #expect(formatTokens(8_250) == "8.3k")
    #expect(formatTokens(1_250) == "1.3k")
    #expect(formatTokens(1_050) == "1.1k")
    #expect(formatTokens(9_950) == "9.9k")
    #expect(formatTokens(9_999.5) == "10.0k")
    #expect(formatTokens(8_250_000) == "8.3M")
    #expect(formatTokens(1_250_000) == "1.3M")
    #expect(formatTokens(999.5) == "1000")
    #expect(formatTokens(999_500) == "1000k")
    #expect(formatTokens(2.5) == "3")
    #expect(formatTokens(-0.5) == "0")
    #expect(formatTokens(-2.5) == "-2")
    #expect(formatTokens(.nan) == "NaNM")
    #expect(formatTokens(.infinity) == "InfinityM")
    #expect(formatTokens(-.infinity) == "-Infinity")
    #expect(formatTokens(1e300) == "1e+294M")
    #expect(formatTokens(-1e300) == "-1e+300")
    #expect(formatTokens(1e27) == "1e+21M")
    #expect(formatTokens(0x1p63) == "9223372036855M")
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
      cost: priced(1.24, perHour: 31.2))
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
    // The bottom figure is the owner's corrected total; the burn is the owner's
    // own live rate on the fixed ladder — $31.2/hr is $0.52/min, the third step.
    #expect(body.burn == SwarmBurn(lit: 3, priced: true))
    #expect(body.light == .ink)
    #expect(body.title.hasSuffix("· $31/hr"))
    #expect(body.accessibilityLabel.hasSuffix(", burning $31/hr"))
    #expect(body.watermark?.sprite == "claude")
    #expect(body.watermark?.opacity == SwarmWeight.watermark)
  }

  @Test func lightsTheBurnLadderByTheRateAndLeavesItUnreadWhereNothingPricesTheWork() {
    func working(_ coverage: String?, _ perHour: Double?) -> SwarmBodyModel {
      model(
        agent(
          status: .working,
          facet: AgentFacet(
            provider: .claude, modelName: "Fable 5.1",
            cost: coverage.map { AgentCost(usd: 1, coverage: $0, burnPerHour: perHour) })))
    }
    // The steps, by the hour: under $3 calm, then $3, $9, $24 and $60 (5c, 15c, 40c and a dollar a minute).
    #expect(working("complete", 2.4).burn == SwarmBurn(lit: 0, priced: true))
    #expect(working("complete", 3).burn == SwarmBurn(lit: 1, priced: true))
    #expect(working("complete", 23.4).burn == SwarmBurn(lit: 2, priced: true))
    #expect(working("complete", 24).burn == SwarmBurn(lit: 3, priced: true))
    #expect(working("complete", 720).burn == SwarmBurn(lit: 4, priced: true))
    // A priced session that has not spent lately is calm; one with no pricing
    // lane at all is unread, and never reads as calm.
    #expect(working("complete", nil).burn == SwarmBurn(lit: 0, priced: true))
    let unpriced = working("unavailable", 540)
    #expect(unpriced.burn == SwarmBurn(lit: 0, priced: false))
    #expect(unpriced.title.hasSuffix("· —/hr"))
    // Partial coverage still prices what it saw.
    #expect(working("partial", 12).burn == SwarmBurn(lit: 2, priced: true))
    // No cost at all is the missing lane, not a calm session.
    #expect(working(nil, nil).burn == SwarmBurn(lit: 0, priced: false))
  }

  @Test func marksAPartialTotalWithAPlus() {
    let facet = AgentFacet(provider: .claude, modelName: "Fable 5.1", cost: AgentCost(usd: 0.2, coverage: "partial"))
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
      agent(id: id, status: status, facet: AgentFacet(provider: .claude, cost: priced(total)))
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

  @Test func carriesTheMountTheStaleFlagAndTheAccessibleCopy() {
    let accent = SwarmColor(hex: "#ec4899")!
    let body = model(agent(color: accent, stale: true, mounted: true))
    #expect(body.stale)
    // Mounted is a fact, not a colour: the renderer draws the band in the
    // theme's ink, and the project's colour reaches the body in one place only,
    // the folder before its name.
    #expect(body.mounted)
    #expect(body.accent == accent)
    let name = body.copy.first { $0.key == "name" }
    #expect(name?.lead?.kind == .icon("folder"))
    #expect(name?.lead?.tone == .accent)
    #expect(body.copy.filter { $0.lead?.tone == .accent }.map(\.key) == ["name"])
    #expect(model(agent(color: accent)).mounted == false)
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

  @Test func namesThePeerFirstInTheAccessibleNameAndNoWritePolicy() {
    // a peer is writable by default (James, 2026-10-28): the name says no write policy either way
    for writable in [false, true] {
      #expect(
        model(remoteRow(hostWritable: writable)).accessibilityLabel
          == "on studio-mini, mesh-console, remote session, idle")
    }
  }

  @Test func wearsTheHostOnTheBodyAsTheDeskNameAlone() {
    // no write mark in the line or the hover, whichever way the host is configured (James, 2026-10-28)
    for writable in [false, true] {
      let body = model(remoteRow(hostWritable: writable))
      #expect(body.copy.first { $0.key == "host" }?.text == "studio-mini")
      #expect(body.title == "studio-mini · /Projects/mesh-console")
      #expect(!body.title.contains("host"))
    }
    // A remote row is a hollow, in the ramp, never a project's colour.
    let body = model(remoteRow(hostWritable: true))
    #expect(body.hollow)
    #expect(body.accent == nil)
  }
}

/// AC-5 — the body is named and marked by the CATALOG's row: the label stands
/// in when there is no model name, and the watermark is read by the mark key.
/// With no row it is the raw id for both, which is what an older desktop, the
/// scripted fleet and an unfamiliar agent all draw (R4).
@Suite struct BodyCatalogNamingTests {
  @Test func aBodyWithNoModelWearsTheCatalogsLabel() {
    let row = AgentCatalogEntry(id: .claude, label: "Claude Code", status: "supported")
    let body = model(agent(facet: AgentFacet(provider: .claude, catalogEntry: row)))
    #expect(body.title == "puppeteer · Claude Code · Editing tokens.css")
    #expect(body.watermark?.sprite == "claude")
  }

  @Test func aBodyWithNoRowWearsItsRawId() {
    let body = model(agent(facet: AgentFacet(provider: AgentProvider(rawValue: "hermes"))))
    #expect(body.title == "puppeteer · hermes · Editing tokens.css")
    #expect(body.watermark?.sprite == "hermes")
  }

  /// A row that points its agent at another mark is drawn by that mark.
  @Test func theWatermarkIsReadByTheRowsMarkKey() {
    let row = AgentCatalogEntry(
      id: AgentProvider(rawValue: "claude-next"), label: "Claude Next", status: "preview",
      mark: "claude")
    let body = model(
      agent(
        facet: AgentFacet(
          provider: AgentProvider(rawValue: "claude-next"), modelName: "Fable 5.1",
          catalogEntry: row)))
    #expect(body.watermark?.sprite == "claude")
    // The model name still comes first: the label is only its stand-in.
    #expect(body.title == "puppeteer · Fable 5.1 · Editing tokens.css")
  }
}

/// PG-3e — the body reads its OWNER's cost (`AgentCost`, the remote cut's `cost`): the total and the shares from the
/// owner's ledger, the flames from the owner's burn per hour (J3 (a)), the host on a peer's agent, the question's header
/// before its prompt. The rows the body golden cannot reach (`phone-goldens.ts` BODY_NOTE; the body read §5), each
/// transcribed from `bubble-model.js` 0.3.2.
@Suite struct OwnersCostBodyTests {
  private func owned(
    id: String = "a", status: AgentVisualStatus = .working, cost: AgentCost? = nil, host: String? = nil,
    blocker: AgentBlocker? = nil
  ) -> FieldBubble {
    FieldBubble(
      id: id, project: "puppeteer", detail: "Editing tokens.css", status: status, identityKey: id, createdAt: now,
      agent: AgentFacet(provider: .claude, modelName: "Opus 5.5", blocker: blocker, cost: cost),
      color: SwarmColor(hex: "#6366f1"), host: host)
  }

  /// B1 — the flames read the owner's burn PER HOUR, divided back to the per-minute ladder and restored to fifteen
  /// significant digits (`perMinute`, M27): 8.999999999999998 an hour divides raw to 0.14999999999999997, one flame,
  /// and restores to 0.15, two. At a rung's exact multiple the restore cannot show, so 9.0 alone could not fail.
  @Test func aWorkingBodyBurnsByTheHour() {
    func lit(_ perHour: Double) -> Int? {
      model(owned(cost: AgentCost(usd: 1, coverage: "complete", burnPerHour: perHour))).burn?.lit
    }
    #expect(lit(8.999999999999998) == 2)
    #expect(lit(9.0) == 2)
    #expect(lit(8.99) == 1)
    #expect(lit(30) == 3)
    let body = model(owned(cost: AgentCost(usd: 1, coverage: "complete", burnPerHour: 9)))
    #expect(body.burn == SwarmBurn(lit: 2, priced: true))
    #expect(body.title.hasSuffix("· $9.0/hr"))
    // priced with no burn said: calm, never unpriced
    #expect(model(owned(cost: AgentCost(usd: 1, coverage: "partial"))).burn == SwarmBurn(lit: 0, priced: true))
  }

  /// B2 — a coverage word this build does not know still shows its total, unpriced: `~$x` with no plus and `none`
  /// false, and the ladder drawn unread (`formatEstimate`; `priced` is complete or partial only).
  @Test func anUnrecognizedCoverageShowsItsTotalUnpriced() {
    let body = model(owned(cost: AgentCost(usd: 0.62, coverage: "estimated", burnPerHour: 30)))
    #expect(body.figures?.bottom == SwarmFigure(text: "~$0.62", hot: false, none: false))
    #expect(body.burn == SwarmBurn(lit: 0, priced: false))
  }

  /// B3 — `unavailable` is no total, whatever its usd: a missing lane is never zero dollars (RFC 008).
  @Test func unavailableIsNoTotal() {
    let priced = model(owned(cost: AgentCost(usd: 0.62, coverage: "complete")))
    #expect(priced.figures?.bottom == SwarmFigure(text: "~$0.62", hot: false, none: false))
    let missing = model(owned(cost: AgentCost(usd: 0.62, coverage: "unavailable", burnPerHour: 30)))
    #expect(missing.figures?.bottom == SwarmFigure(text: "—", hot: false, none: true))
    #expect(missing.burn == SwarmBurn(lit: 0, priced: false))
    // no cost at all reads the same
    #expect(model(owned()).figures?.bottom == SwarmFigure(text: "—", hot: false, none: true))
  }

  /// B4 — a peer's agent wears its desktop's name under its model line, on all three agent branches (Q16; the
  /// window's `hostLine`); the home's own agent wears none.
  @Test func aPeersAgentWearsItsHost() {
    let waiting = AgentBlocker(kind: .question, question: "Which order?")
    for (status, blocker) in [(AgentVisualStatus.working, nil), (.idle, nil), (.blocked, waiting)] {
      let body = model(owned(status: status, host: "Loft", blocker: blocker))
      let keys = body.copy.map { $0.key }
      #expect(keys.last == "host", "\(status)")
      #expect(keys.firstIndex(of: "host") == keys.firstIndex(of: "model").map { $0 + 1 }, "\(status)")
      let host = body.copy.last
      #expect(host?.text == "Loft", "\(status)")
      #expect(host?.style == SwarmCopyStyle.labelStacked, "\(status)")
      #expect(host?.gapBefore == 3, "\(status)")
      let home = model(owned(status: status, blocker: blocker)).copy.map { $0.key }
      #expect(!home.contains("host"), "\(status)")
    }
  }

  /// B5 — a question says its header first, then its prompt (`waitBodyLine`).
  @Test func aQuestionSaysItsHeaderFirst() {
    let blocker = AgentBlocker(kind: .question, header: "Peer order", question: "Which order?")
    let body = model(owned(status: .blocked, blocker: blocker))
    let state = body.copy.first { $0.key == "state" }
    #expect(state?.text == "Peer order")
    #expect(state?.lead?.kind == .icon("question"))
    // a blank header is no header
    let blank = AgentBlocker(kind: .question, header: "  ", question: "Which order?")
    #expect(model(owned(status: .blocked, blocker: blank)).copy.first { $0.key == "state" }?.text == "Which order?")
  }

  /// N13 (the v2 check) — the percent's bound has no red row: past `Int`'s range the floor TRAPPED, and a trap is not
  /// a red a suite can record. This pins it after the fact: an absurd or non-finite context reads `--` and no ring.
  @Test func anAbsurdContextReadsDashes() {
    for absurd in [1e21, -1e21, Double.infinity, Double.nan] {
      let facet = AgentFacet(provider: .claude, modelName: "Opus 5.5", contextUsedPercent: absurd)
      let working = model(owned(status: .working).with(facet))
      #expect(working.figures?.top == SwarmFigure(text: "--", hot: false, none: true), "\(absurd)")
      #expect(working.ring == nil, "\(absurd)")
      #expect(working.accessibilityLabel.contains("CTX:--%"), "\(absurd)")
    }
    let edge = model(owned(status: .working).with(AgentFacet(provider: .claude, contextUsedPercent: 1e9)))
    #expect(edge.figures?.top?.text == "1000000000%")
    #expect(edge.ring == SwarmRing(percent: 100, hot: true))
  }

  /// B6 — partial coverage adds the plus.
  @Test func partialAddsThePlus() {
    let body = model(owned(cost: AgentCost(usd: 0.2, coverage: "partial", burnPerHour: 12)))
    #expect(body.figures?.bottom == SwarmFigure(text: "~$0.20+", hot: false, none: false))
    #expect(body.burn == SwarmBurn(lit: 2, priced: true))
  }

  /// B7 — the working shares rank by the owner's total: an unavailable total counts as 0, so it is the least here, and
  /// 0.02 and 0.62 share 0.02 / 0.62 and 1; an idle body and a terminal do not count. (Corrected 2026-11-02, PG-3e, the
  /// review's [20]: it said 0.02 and 0.62 share 0 and 1, which holds only without the unavailable row.)
  @Test func workingSharesReadTheCost() {
    let rows = [
      owned(id: "a", cost: AgentCost(usd: 0.02, coverage: "complete")),
      owned(id: "b", cost: AgentCost(usd: 0.62, coverage: "partial")),
      owned(id: "c", cost: AgentCost(usd: 9, coverage: "unavailable")),
      owned(id: "d", status: .idle, cost: AgentCost(usd: 40, coverage: "complete")),
    ]
    let shares = workingShares(rows)
    #expect(shares["a"] == 0.02 / 0.62)
    #expect(shares["b"] == 1)
    #expect(shares["c"] == 0)
    #expect(shares["d"] == nil)
  }
}

private extension FieldBubble {
  /// The same row with another facet (the rows above build their bubbles by hand).
  func with(_ facet: AgentFacet) -> FieldBubble {
    FieldBubble(
      id: id, project: project, detail: detail, status: status, identityKey: identityKey, createdAt: createdAt,
      agent: facet, remote: remote, color: color, stale: stale, active: active, mounted: mounted, unread: unread,
      host: host, modelId: modelId, runKey: runKey)
  }
}
