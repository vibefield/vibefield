import Foundation
import SwarmPhysics
import Testing

@testable import FieldAgents

// The reference's `bubble-model.test.ts`, transcribed: the same rows, the same
// numbers. If a row here disagrees with the reference, the port drifted.

private let now = Date(timeIntervalSince1970: 1_788_688_800)  // 2026-09-06T10:00:00Z
private let at = now.addingTimeInterval(-5)

/// A ledger history with the given total and a burn on both sides, its newest
/// step the tallest.
private func usageHistory(_ total: Double) -> UsageHistory {
  let steps = (0..<usageStepCount).map { Double($0 + 1) * 100 }
  return UsageHistory(
    total: total, steps: steps,
    sides: UsageSides(output: steps.map { $0 / 4 }, input: steps.map { $0 * 3 / 4 }))
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
}

@Suite struct SwarmBodyModelTests {
  @Test func drawsAnUnclaimedIdleTerminalAsAHollowWithTheFolderAndEmpty() {
    let body = model(terminal())
    #expect(body.state == .terminalEmpty)
    #expect(body.hollow)
    #expect(!body.running)
    #expect(body.radius == 50)
    #expect(body.copy.map(\.key) == ["folder", "name", "sub"])
    #expect(body.copy[1].tone == .ink)
    #expect(body.copy[2].text == "empty")
    #expect(body.ring == nil)
    #expect(body.watermark == nil)
  }

  @Test func drawsARunningTerminalWithTheCometRunningAndTheElapsedTime() {
    let body = model(terminal(status: .working), runningSince: now.addingTimeInterval(-83))
    #expect(body.state == .terminalRunning)
    #expect(body.running)
    #expect(body.copy.map(\.text) == ["", "puppeteer", "running", "1:23"])
  }

  @Test func neverMarksATerminalUnread() {
    var bubble = terminal()
    bubble.unread = true
    #expect(model(bubble).unread == false)
  }

  @Test func showsNameAndModelEffortOnAnIdleAgentAndTheUnreadReplyWithABlueDot() {
    let facet = AgentFacet(
      provider: .claude, modelName: "Fable 5.1",
      effort: AgentEffort(value: "high", intent: .configured),
      lastMessage: "Done: two tests fixed.\nDetails below.")
    let body = model(agent(facet: facet, unread: true))
    #expect(body.state == .idle)
    #expect(body.radius == 50)
    #expect(body.copy.map(\.key) == ["name", "model", "message"])
    #expect(body.copy[0].tone == .ink)
    #expect(body.copy[0].lead == nil)
    #expect(body.copy[1].text == "Fable 5.1 · high")
    // Launch intent, no provider evidence yet: italic.
    #expect(body.copy[1].style.italic)
    #expect(body.copy[2].text == "Done: two tests fixed.")
    #expect(body.copy[2].lead == CopyLead(kind: .dot, size: 5, gap: 4, tone: .blue))
    #expect(body.unread)
    #expect(!body.flood)
  }

  @Test func fallsBackToTheDotBeforeTheNameWhenAnUnreadAgentHasNoReplyText() {
    let body = model(agent(unread: true))
    #expect(body.copy.map(\.key) == ["name", "model"])
    #expect(body.copy[0].lead == CopyLead(kind: .dot, size: 5, gap: 4, tone: .blue))
    let read = model(agent(unread: false))
    #expect(read.copy[0].lead == nil)
    #expect(read.copy.map(\.key) == ["name", "model"])
  }

  @Test func givesAWorkingAgentTheLargerBodyBranchNameModelEffortTheGraphTheRingAndBothFigures() {
    let facet = AgentFacet(
      provider: .claude, modelName: "Fable 5.1", branch: "swarm", contextUsedPercent: 62.7,
      effort: AgentEffort(value: "high", intent: .observed), usage: usageHistory(1_240_000))
    let body = model(agent(status: .working, facet: facet))
    #expect(body.state == .working)
    #expect(body.radius == 60)
    #expect(body.copy.map(\.key) == ["branch", "name", "model"])
    #expect(body.copy[0].lead?.tone == .green)
    #expect(body.copy[1].tone == .ink)
    #expect(body.copy[2].text == "Fable 5.1 · high")
    #expect(body.ring == SwarmRing(percent: 62, hot: false))
    #expect(body.figures?.top == SwarmFigure(text: "62%", hot: false, none: false))
    #expect(body.figures?.bottom == SwarmFigure(text: "1.2M", hot: false, none: false))
    // The ledger's figure, not Core's estimate, and the bars scaled to the tallest step.
    #expect(body.graph?.up.count == usageStepCount)
    #expect(body.graph?.down.count == usageStepCount)
    #expect(body.graph?.split == true)
    #expect(body.graph?.up[usageStepCount - 1] == 1)
    #expect(abs((body.graph?.up[0] ?? 0) - 1 / Double(usageStepCount)) < 1e-6)
    #expect(body.watermark?.sprite == "claude")
  }

  @Test func growsAWorkingBodyFromTheWorkingSizeToTheLargestByItsShare() {
    let bubble = agent(status: .working)
    #expect(model(bubble).radius == 60)
    #expect(model(bubble, share: 0.5).radius == 70)
    #expect(model(bubble, share: 1).radius == 80)
  }

  @Test func placesWorkingSessionsByTotalTokensLeastZeroAndMostOne() {
    func working(_ id: String, _ total: Double, status: AgentVisualStatus = .working) -> FieldBubble {
      agent(id: id, status: status, facet: AgentFacet(provider: .claude, usage: usageHistory(total)))
    }
    let shares = workingShares([
      working("a", 100), working("b", 400), working("c", 1300), working("d", 9000, status: .idle),
    ])
    #expect(shares == ["a": 0, "b": 0.25, "c": 1])
    #expect(workingShares([working("a", 100)]) == ["a": 0])
  }

  @Test func holdsABlockedAgentAtTheIdleSizeLightsItAndShowsItsLatestReplyWithAnOrangeDot() {
    let facet = AgentFacet(
      provider: .claude, modelName: "Fable 5.1", contextUsedPercent: 88,
      permissions: [AgentPermission(tool: "Bash")], blockerKind: .permission,
      lastMessage: "May I run pnpm test?")
    let body = model(agent(status: .blocked, facet: facet))
    #expect(body.state == .blocked)
    #expect(body.radius == 50)
    #expect(body.flood)
    #expect(body.blockerKind == .permission)
    #expect(body.copy.map(\.key) == ["name", "model", "message"])
    #expect(body.copy[2].text == "May I run pnpm test?")
    #expect(body.copy[2].lead == CopyLead(kind: .dot, size: 5, gap: 4, tone: .orange))
    #expect(body.ring == SwarmRing(percent: 88, hot: true))
    #expect(body.figures == nil)
  }

  @Test func namesTheBlockerWhenABlockedAgentHasNoReplyText() {
    let facet = AgentFacet(provider: .claude, modelName: "Fable 5.1", blockerKind: .question)
    let body = model(agent(status: .blocked, facet: facet))
    let kind = body.copy.first { $0.key == "kind" }
    #expect(kind?.text == "question")
    #expect(kind?.tone == .orange)
    #expect(kind?.lead == nil)
  }

  @Test func carriesThePaneLinkTheStaleFlagAndTheAccessibleCopy() {
    let accent = SwarmColor(hex: "#ec4899")!
    let pane = SwarmColor(hex: "#22cc88")!
    let body = model(agent(color: accent, stale: true, pane: PaneLink(color: pane)))
    #expect(body.stale)
    // The band is the pane's colour; the project's colour is the body's accent
    // and the tag before its name.
    #expect(body.linked == pane)
    #expect(body.accent == accent)
    let name = body.copy.first { $0.key == "name" }
    #expect(name?.tag?.kind == .bar)
    #expect(name?.tag?.tone == .accent)
    #expect(model(agent(color: accent)).linked == nil)
    #expect(body.accessibilityLabel == "puppeteer, Fable 5.1, idle: Editing tokens.css, CTX:--%")
    #expect(body.title == "puppeteer · Fable 5.1 · Editing tokens.css")
  }

  @Test func figuresReadDashesWhenNothingIsKnown() {
    let body = model(agent(status: .working, facet: AgentFacet(provider: .codex, modelName: "o5")))
    #expect(body.figures?.top == SwarmFigure(text: "--", hot: false, none: true))
    #expect(body.figures?.bottom == SwarmFigure(text: "--", hot: false, none: true))
    #expect(body.graph == nil)
    #expect(body.ring == nil)
    #expect(body.copy.map(\.key) == ["name", "model"])
    #expect(body.copy[1].text == "o5")
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
