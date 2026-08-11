import Foundation
import Testing

@testable import FieldAgents

private func row(
  deviceID: String = "mac-studio",
  deviceName: String = "Mac Studio",
  sessionID: String = "1",
  title: String = "zsh",
  cwdLabel: String? = "/Users/james/Projects/vibe-field",
  attachable: Bool = true,
  readWrite: Bool = false,
  createdAtMs: UInt64 = 1_700_000_000_000,
  activityKind: String? = nil
) -> RemoteSessionRow {
  RemoteSessionRow(
    host: RemoteHost(deviceID: deviceID, deviceName: deviceName),
    session: RemoteSessionInfo(
      sessionID: sessionID,
      title: title,
      cwdLabel: cwdLabel,
      running: true,
      attachable: attachable,
      readWrite: readWrite,
      createdAtMs: createdAtMs,
      activityKind: activityKind))
}

@Suite struct RemoteRowIdentityTests {
  @Test func idIsPrefixedAndDeviceQualified() {
    #expect(remoteRowID(deviceID: "mac-studio", sessionID: "1") == "remote:mac-studio:1")
    #expect(row().id == "remote:mac-studio:1")
    #expect(fieldBubble(from: row()).id == "remote:mac-studio:1")
  }

  /// The flat-namespace law: two peers can each have a session `1`, and they
  /// must be two bubbles wearing two colors.
  @Test func samePeerSessionIdOnTwoPeersStaysTwoBubbles() {
    let studio = fieldBubble(from: row(deviceID: "mac-studio", sessionID: "1"))
    let laptop = fieldBubble(from: row(deviceID: "macbook", sessionID: "1"))
    #expect(studio.id != laptop.id)
    #expect(studio.identityKey != laptop.identityKey)
    #expect(studio.identityKey == studio.id)
    // The consequence the law exists for — the accent actually differs.
    #expect(agentIdentityHue(studio.identityKey) != agentIdentityHue(laptop.identityKey))
  }
}

@Suite struct TerminalStatusTests {
  @Test func foregroundJobIsTheOnlyWorkingKind() {
    #expect(classifyTerminalStatus("foreground-job") == .working)
    #expect(classifyTerminalStatus(nil) == .idle)
    #expect(classifyTerminalStatus("idle") == .idle)
    #expect(classifyTerminalStatus("shell") == .idle)
    #expect(classifyTerminalStatus("") == .idle)
  }

  /// A terminal has no permissions, so it can never wear the loud tier — for
  /// ANY activity kind, including one that spells the word.
  @Test func aTerminalNeverReachesTheWaitingTier() {
    let kinds: [String?] = [
      nil, "", "foreground-job", "background-job", "idle", "shell", "waiting", "permission",
      "unknown-future-kind",
    ]
    for kind in kinds {
      #expect(classifyTerminalStatus(kind) != .waiting)
      #expect(fieldBubble(from: row(activityKind: kind)).status != .waiting)
    }
  }
}

@Suite struct RemoteBubbleProjectionTests {
  @Test func detailCarriesTheHostBesideThePath() {
    #expect(fieldBubble(from: row()).detail == "Mac Studio · /Users/james/Projects/vibe-field")
    #expect(fieldBubble(from: row(cwdLabel: nil)).detail == "Mac Studio")
    // An empty label is no label: the JS truthiness clause, so no dangling "·".
    #expect(fieldBubble(from: row(cwdLabel: "")).detail == "Mac Studio")
  }

  /// One clause, every use. A Swift consumer writes `if let cwd` and would
  /// bind `""` into an empty row, so the facet gets the normalized label too —
  /// while the ROW keeps the peer's literal answer, because recording what a
  /// peer said and deciding what to draw are different jobs.
  @Test func anEmptyLabelIsNoLabelInTheFacetToo() {
    let empty = row(cwdLabel: "")
    #expect(fieldBubble(from: empty).remote?.cwdLabel == nil)
    #expect(fieldBubble(from: row(cwdLabel: nil)).remote?.cwdLabel == nil)
    #expect(fieldBubble(from: empty).project == "zsh")
    // The record is untouched — normalization is the projection's job.
    #expect(empty.session.cwdLabel == "")
  }

  @Test func projectIsTheFolderWithTheTitleAsFallback() {
    #expect(fieldBubble(from: row()).project == "vibe-field")
    #expect(fieldBubble(from: row(title: "zsh", cwdLabel: nil)).project == "zsh")
    #expect(fieldBubble(from: row(title: "", cwdLabel: nil)).project == "remote")
    #expect(fieldBubble(from: row(title: "", cwdLabel: "/")).project == "remote")
  }

  @Test func facetCarriesWhatTheCardNeedsToOpenIt() {
    let bubble = fieldBubble(from: row(attachable: false, readWrite: true))
    #expect(bubble.agent == nil)
    #expect(
      bubble.remote
        == RemoteFacet(
          deviceID: "mac-studio",
          deviceName: "Mac Studio",
          sessionID: "1",
          attachable: false,
          readWrite: true,
          cwdLabel: "/Users/james/Projects/vibe-field"))
  }

  @Test func createdAtComesFromThePeersMilliseconds() {
    let bubble = fieldBubble(from: row(createdAtMs: 1_700_000_000_500))
    #expect(bubble.createdAt == Date(timeIntervalSince1970: 1_700_000_000.5))
  }
}

@Suite struct AgentBubbleProjectionTests {
  private func snapshot(state: AgentRuntimeState?) -> AgentSnapshot {
    AgentSnapshot(
      id: "session-7",
      runtimeSessionID: "runtime-7",
      provider: .codex,
      project: "vibe-field",
      state: state,
      createdAt: Date(timeIntervalSince1970: 1_700_000_000))
  }

  /// The projection may not become a second classifier: status and detail are
  /// whatever today's functions say, for every tier.
  @Test func classifierAndDetailAreUnchanged() {
    let states: [AgentRuntimeState?] = [
      nil,
      AgentRuntimeState(),
      AgentRuntimeState(activeTurn: true),
      AgentRuntimeState(activeReasoning: true),
      AgentRuntimeState(toolRuns: [AgentToolRun(title: "pnpm verify")]),
      AgentRuntimeState(permissions: [AgentPermission(tool: "Bash")]),
    ]
    for state in states {
      let bubble = fieldBubble(from: snapshot(state: state))
      let status = classifyAgentStatus(state)
      #expect(bubble?.status == status)
      #expect(bubble?.detail == status.map { agentDetail(state, status: $0) })
    }
  }

  @Test func agentsKeepHashingTheRuntimeAlias() {
    let bubble = fieldBubble(from: snapshot(state: AgentRuntimeState()))
    #expect(bubble?.id == "session-7")
    #expect(bubble?.identityKey == "runtime-7")
    #expect(bubble?.project == "vibe-field")
    #expect(bubble?.createdAt == Date(timeIntervalSince1970: 1_700_000_000))
    #expect(bubble?.remote == nil)
  }

  @Test func facetCarriesTheVendorAndItsNumbers() {
    let state = AgentRuntimeState(contextUsedPercent: 41, modelName: "o5", branch: "ios-bootstrap")
    let bubble = fieldBubble(from: snapshot(state: state))
    #expect(
      bubble?.agent
        == AgentFacet(
          provider: .codex, modelName: "o5", branch: "ios-bootstrap", contextUsedPercent: 41))
    // A session that has not reported yet has a provider and nothing else.
    #expect(fieldBubble(from: snapshot(state: nil))?.agent == AgentFacet(provider: .codex))
  }

  @Test func aTerminatedSessionLeavesTheField() {
    #expect(fieldBubble(from: snapshot(state: AgentRuntimeState(lifecycle: .exited))) == nil)
    #expect(fieldBubble(from: snapshot(state: AgentRuntimeState(lifecycle: .failed))) == nil)
  }
}

@Suite struct FolderNameTests {
  @Test func portsTheDesktopsClauses() {
    #expect(folderName("/Users/james/Projects/vibe-field", fallback: "x") == "vibe-field")
    // Trailing separators are stripped before the split, so this is not "x".
    #expect(folderName("/Users/james/Projects/vibe-field/", fallback: "x") == "vibe-field")
    #expect(folderName("/Users/james/Projects/vibe-field///", fallback: "x") == "vibe-field")
    // A peer may be a Windows host.
    #expect(folderName("C:\\Users\\james\\repo", fallback: "x") == "repo")
    #expect(folderName("C:\\Users\\james\\repo\\", fallback: "x") == "repo")
    #expect(folderName("vibe-field", fallback: "x") == "vibe-field")
    #expect(folderName("  /a/b  ", fallback: "x") == "b")
  }

  @Test func emptyResultsFallBackRatherThanRenderBlank() {
    #expect(folderName(nil, fallback: "remote") == "remote")
    #expect(folderName("", fallback: "remote") == "remote")
    #expect(folderName("   ", fallback: "remote") == "remote")
    #expect(folderName("/", fallback: "remote") == "remote")
    #expect(folderName("///", fallback: "remote") == "remote")
    #expect(folderName("\\", fallback: "remote") == "remote")
  }

  /// The original's own oddities, pinned so a "cleanup" is a deliberate act:
  /// only the WHOLE string is trimmed, and interior empty components are
  /// irrelevant because only the last one is read.
  @Test func keepsTheOriginalsEdges() {
    #expect(folderName("/a/ b", fallback: "x") == " b")
    #expect(folderName("a//b", fallback: "x") == "b")
    #expect(folderName("a/b/ ", fallback: "x") == "b")
  }
}
