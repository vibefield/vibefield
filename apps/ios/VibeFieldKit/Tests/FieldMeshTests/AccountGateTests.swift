import Foundation
import Testing
import Truffle

@testable import FieldMesh

/// UA-P-5 — the gate's grammar, held against truffle's own matcher.
///
/// The phone builds an allow-list from a LITERAL login and hands it to a
/// matcher whose grammar is Go's `path.Match` (RFC 025 §3.2). These rows are
/// the join: what this app writes, read by the thing that will actually gate.
/// `LoginGlob` is truffle's, so a drift in either direction fails here rather
/// than on a tailnet.
@Suite struct AccountGateGrammarTests {
  @Test func anOrdinaryLoginIsItsOwnGlob() {
    #expect(AccountGate.glob(for: "alice@corp.com") == "alice@corp.com")
    #expect(AccountGate.allowList(for: "alice@corp.com") == ["alice@corp.com"])
  }

  @Test func noRememberedLoginIsNoGate() {
    #expect(AccountGate.allowList(for: nil).isEmpty)
    #expect(AccountGate.allowList(for: "").isEmpty)
  }

  /// THE GATE, RUN. The list this app writes admits its own login — in any
  /// case, because the matcher lowercases both sides — and admits nobody else.
  @Test func theListAdmitsThisLoginAndNothingElse() {
    let allow = AccountGate.allowList(for: "alice@corp.com")
    #expect(LoginGlob.allowed(allow, login: "alice@corp.com"))
    #expect(LoginGlob.allowed(allow, login: "ALICE@Corp.COM"))
    #expect(!LoginGlob.allowed(allow, login: "bob@corp.com"))
    #expect(!LoginGlob.allowed(allow, login: "alice@corp.com.attacker.example"))
    #expect(!LoginGlob.allowed(allow, login: "xalice@corp.com"))
  }

  /// FAIL CLOSED on an absent login — the property the whole gate rests on
  /// (RFC 025 §3.2), asserted here because this app is the one choosing to
  /// hand truffle a non-empty list.
  @Test func anAbsentLoginIsRefusedByANonEmptyList() {
    let allow = AccountGate.allowList(for: "alice@corp.com")
    #expect(!LoginGlob.allowed(allow, login: nil))
    #expect(!LoginGlob.allowed(allow, login: ""))
  }

  /// A LOGIN IS NOT A GLOB, and the day one carries a metacharacter is the day
  /// an unescaped gate admits a class of strangers. No tailscale login has a
  /// `*` in it today; this is four characters of insurance against the one
  /// that does, and the row that proves the insurance pays.
  @Test func aLoginCarryingGlobSyntaxIsEscapedToItself() {
    for login in ["a*b@corp.com", "a?b@corp.com", "a[bc]d@corp.com", #"a\b@corp.com"#] {
      let allow = AccountGate.allowList(for: login)
      #expect(LoginGlob.allowed(allow, login: login), "\(login) must admit itself")
    }

    // And the wildcard does not spread. Unescaped, `a*b@corp.com` would admit
    // every one of these.
    let starred = AccountGate.allowList(for: "a*b@corp.com")
    #expect(!LoginGlob.allowed(starred, login: "ab@corp.com"))
    #expect(!LoginGlob.allowed(starred, login: "aXb@corp.com"))
    #expect(!LoginGlob.allowed(starred, login: "a-very-long-b@corp.com"))

    // The class, likewise: `a[bc]d` would admit `abd` and `acd`.
    let classed = AccountGate.allowList(for: "a[bc]d@corp.com")
    #expect(!LoginGlob.allowed(classed, login: "abd@corp.com"))
    #expect(!LoginGlob.allowed(classed, login: "acd@corp.com"))
  }

  /// `gates` is what `FieldTruffleRuntime.isGatedOnAccount` asks of the NODE's
  /// own running list, so it has to be exact rather than merely satisfied: a
  /// list that admits this login AND others is not this account's gate.
  @Test func gatesMeansExactlyThisOneLogin() {
    #expect(AccountGate.gates(["alice@corp.com"], login: "alice@corp.com"))
    #expect(AccountGate.gates(["ALICE@corp.com"], login: "alice@corp.com"))
    #expect(!AccountGate.gates([], login: "alice@corp.com"))
    #expect(!AccountGate.gates(["*@corp.com"], login: "alice@corp.com"))
    #expect(
      !AccountGate.gates(["alice@corp.com", "bob@corp.com"], login: "alice@corp.com"))
    #expect(!AccountGate.gates(["bob@corp.com"], login: "alice@corp.com"))
  }

  /// Absent is not equal to anything, including another absent (RFC 022).
  @Test func anAbsentLoginMatchesNoOne() {
    #expect(AccountGate.sameLogin("alice@corp.com", "ALICE@CORP.COM"))
    #expect(!AccountGate.sameLogin(nil, nil))
    #expect(!AccountGate.sameLogin("alice@corp.com", nil))
    #expect(!AccountGate.sameLogin(nil, "alice@corp.com"))
    #expect(!AccountGate.sameLogin("", ""))
  }
}

/// UA-P-5 — the state machine, every transition.
///
/// The expensive event is a node RESTART, so each of these is the question
/// "does this state ask for one", answered without one.
@Suite struct AccountGateStepTests {
  @Test func thePreLoginWindowAsksForNothing() {
    #expect(AccountGate.step(gatedOn: nil, reports: nil) == .nothing)
    #expect(AccountGate.step(gatedOn: nil, reports: "") == .nothing)
  }

  @Test func anUngatedNodeThatLearnsItsLoginIsRemembered() {
    #expect(
      AccountGate.step(gatedOn: nil, reports: "alice@corp.com") == .remember("alice@corp.com"))
  }

  @Test func aGatedNodeReportingItsOwnLoginIsSettled() {
    #expect(AccountGate.step(gatedOn: "alice@corp.com", reports: "alice@corp.com") == .nothing)
    // The gate matches case-insensitively, so the machine must too — otherwise
    // a tailnet that changes the spelling of a login restarts this node once
    // per status refresh, forever.
    #expect(AccountGate.step(gatedOn: "alice@corp.com", reports: "ALICE@Corp.com") == .nothing)
  }

  /// THE ROW THAT KEEPS A PHONE FROM SPINNING. An absent login is "this node
  /// cannot currently state who it is", never "nobody": the Apple plane reads
  /// the login through a status overlay that can fail (RFC 024 §8.1.2), and a
  /// machine that read a thin refresh as an account switch would tear the node
  /// down and rebuild it on every one.
  @Test func aGatedNodeThatCannotStateItsLoginIsNotASwitch() {
    #expect(AccountGate.step(gatedOn: "alice@corp.com", reports: nil) == .nothing)
    #expect(AccountGate.step(gatedOn: "alice@corp.com", reports: "") == .nothing)
  }

  @Test func aDifferentLoginIsARegate() {
    #expect(
      AccountGate.step(gatedOn: "alice@corp.com", reports: "bob@corp.com")
        == .regate("bob@corp.com"))
  }

  @Test func onlyTheTwoActingStepsNameALogin() {
    #expect(AccountStep.nothing.login == nil)
    #expect(AccountStep.remember("alice@corp.com").login == "alice@corp.com")
    #expect(AccountStep.regate("bob@corp.com").login == "bob@corp.com")
  }
}

/// UA-P-5 — the remembered login on disk, and the two launches it joins.
@Suite struct AccountLoginStoreTests {
  private func scratch() throws -> URL {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("vf-gate-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  @Test func nothingRememberedReadsAsNothing() throws {
    let store = AccountLoginStore(stateDirectory: try scratch())
    #expect(store.read() == nil)
  }

  @Test func whatIsWrittenIsWhatIsRead() throws {
    let store = AccountLoginStore(stateDirectory: try scratch())
    try store.write("alice@corp.com")
    #expect(store.read() == "alice@corp.com")
    #expect(store.url.lastPathComponent == "account.login")
  }

  /// A trailing newline would make the gate a glob that matches nothing —
  /// fail-closed, and therefore a phone with an empty mesh and no reason on
  /// screen. The one hand that would ever leave one is a person looking at the
  /// file, which is reason enough to trim.
  @Test func whitespaceAroundARememberedLoginIsNotPartOfIt() throws {
    let directory = try scratch()
    let store = AccountLoginStore(stateDirectory: directory)
    try Data("  alice@corp.com\n".utf8).write(to: store.url)
    #expect(store.read() == "alice@corp.com")
  }

  @Test func anEmptyFileIsNoLoginRatherThanAnEmptyOne() throws {
    let directory = try scratch()
    let store = AccountLoginStore(stateDirectory: directory)
    try Data("\n   \n".utf8).write(to: store.url)
    #expect(store.read() == nil)
    // And an empty remembered login is no gate, not a gate nothing satisfies.
    #expect(AccountGate.allowList(for: store.read()).isEmpty)
  }

  @Test func aSecondWriteReplacesTheFirst() throws {
    let store = AccountLoginStore(stateDirectory: try scratch())
    try store.write("alice@corp.com")
    try store.write("bob@corp.com")
    #expect(store.read() == "bob@corp.com")
  }

  /// The directory may not exist yet on a first launch — truffle makes it, and
  /// the order of the two is not this app's to assume.
  @Test func theDirectoryIsMadeIfItIsNotThere() throws {
    let root = try scratch()
    let store = AccountLoginStore(
      stateDirectory: root.appendingPathComponent("not-yet", isDirectory: true))
    try store.write("alice@corp.com")
    #expect(store.read() == "alice@corp.com")
  }
}

/// UA-P-5 — THE MACHINE, driven end to end over a real directory.
///
/// Each step is what one launch of the app does, in order, against the same
/// state directory two launches share. It runs the real decision function and
/// the real file, so what is proven is the SEQUENCE — that the gate a second
/// launch comes up with is the one the first launch learned — rather than each
/// half in isolation.
@Suite struct AccountGateMachineTests {
  private func scratch() throws -> URL {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("vf-machine-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  private func plan(_ directory: URL) -> FieldTruffleRuntime.StartPlan {
    FieldTruffleRuntime.startPlan(deviceName: "James's iPhone", stateDirectory: directory)
  }

  /// no login → ungated → learned → restart gated. Four states, one restart.
  @Test func aFreshSignInGatesOnTheSecondStart() throws {
    let directory = try scratch()

    // 1. Nothing remembered: the node starts UNGATED, on the whole tailnet.
    let first = plan(directory)
    #expect(first.rememberedLogin == nil)
    #expect(first.isGated == false)
    #expect(first.configuration.loginAllow.isEmpty)

    // 2. It is up and Layer 3 has not named a login yet. Nothing to do — and
    //    nothing recorded, which is what keeps the window from being a guess.
    #expect(AccountGate.step(gatedOn: first.rememberedLogin, reports: nil) == .nothing)
    #expect(AccountLoginStore(stateDirectory: directory).read() == nil)

    // 3. The login arrives. Record it, then restart.
    let step = AccountGate.step(gatedOn: first.rememberedLogin, reports: "alice@corp.com")
    #expect(step == .remember("alice@corp.com"))
    try AccountLoginStore(stateDirectory: directory).write(try #require(step.login))

    // 4. The restart, which is just another start on the same directory.
    let second = plan(directory)
    #expect(second.rememberedLogin == "alice@corp.com")
    #expect(second.isGated)
    #expect(second.configuration.loginAllow == ["alice@corp.com"])
    #expect(AccountGate.gates(second.configuration.loginAllow, login: "alice@corp.com"))

    // 5. ONE restart. The gated node reports the same login and asks for
    //    nothing, which is what makes it one rather than a loop.
    #expect(AccountGate.step(gatedOn: second.rememberedLogin, reports: "alice@corp.com") == .nothing)
  }

  /// A launch after the sign-in gates from the FIRST packet — no window at all.
  @Test func everyLaterLaunchIsGatedBeforeItJoins() throws {
    let directory = try scratch()
    try AccountLoginStore(stateDirectory: directory).write("alice@corp.com")
    let launch = plan(directory)
    #expect(launch.isGated)
    #expect(launch.configuration.loginAllow == ["alice@corp.com"])
  }

  /// The device is signed into another tailscale account. Re-gate on the new
  /// login — and CLEAR NOTHING. What a phone forgets when the account changes
  /// is UA-P-D4, which is open and James's; this lane builds none of it, and
  /// this row is the boundary written down as a test.
  @Test func anAccountSwitchReGatesAndForgetsNothingElse() throws {
    let directory = try scratch()
    try AccountLoginStore(stateDirectory: directory).write("alice@corp.com")

    // Something of the person's, sitting in the same directory the gate lives
    // in. Nothing in this lane may touch it.
    let theirs = directory.appendingPathComponent("device-id.txt")
    try Data("01J0000000000000000000000A".utf8).write(to: theirs)

    let before = plan(directory)
    let step = AccountGate.step(gatedOn: before.rememberedLogin, reports: "bob@corp.com")
    #expect(step == .regate("bob@corp.com"))
    try AccountLoginStore(stateDirectory: directory).write(try #require(step.login))

    let after = plan(directory)
    #expect(after.configuration.loginAllow == ["bob@corp.com"])
    #expect(!LoginGlob.allowed(after.configuration.loginAllow, login: "alice@corp.com"))

    // Untouched, byte for byte.
    #expect(
      String(decoding: try Data(contentsOf: theirs), as: UTF8.self)
        == "01J0000000000000000000000A")
    #expect(FileManager.default.fileExists(atPath: theirs.path))
  }

  /// The gate travels with the node's state across the app-id rename, because
  /// it lives IN that directory. A phone that signed in under the old name and
  /// launches under the new one keeps its account, and does not spend a second
  /// ungated window earning it back.
  @Test func theRememberedLoginRidesTheStateDirectoryRename() throws {
    let root = try scratch()
    let previous = root.appendingPathComponent("ghosttea-terminal", isDirectory: true)
    let current = root.appendingPathComponent("vibefield", isDirectory: true)
    try FileManager.default.createDirectory(at: previous, withIntermediateDirectories: true)
    try AccountLoginStore(stateDirectory: previous).write("alice@corp.com")

    #expect(FieldTruffleRuntime.migrateStateDirectory(from: previous, to: current) == .moved)
    #expect(AccountLoginStore(stateDirectory: current).read() == "alice@corp.com")
    #expect(plan(current).isGated)
  }
}
