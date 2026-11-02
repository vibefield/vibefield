import FieldProduct
import Foundation
import Testing

@testable import FieldFreeway

/// One of the approval's refusals as the door sends it: `UNAVAILABLE {service: "freeway", state}`.
func approvalRefusal(_ state: String, retryable: Bool = true) -> FieldProductError {
  FieldProductError(
    kind: "UNAVAILABLE", message: "freeway approval \(state)", retryable: retryable,
    details: .object([
      "service": .string(FreewayContract.Approval.service), "state": .string(state),
    ]))
}

/// The owner's refusal of a phone it will not approve (no phone behind the forward, or a desktop
/// named): not retryable — asking again changes nothing.
let forbiddenApproval = FieldProductError(
  kind: "FORBIDDEN_SCOPE", message: "freeway.approve is for a phone", retryable: false)

/// The home's own honest state when it cannot reach the owner (`peer-link`).
let unreachableOwner = FieldProductError(
  kind: "UNAVAILABLE", message: "peer link unreachable", retryable: true,
  details: .object([
    "service": .string("peer-link"), "device": .string("dev-laptop"),
    "state": .string("unreachable"),
  ]))

/// F1b's kit half (FW-D5): the approval is asked of the HOME, which forwards it to the desktop the
/// link is for, and each refusal reaches the phone in its own words.
@Suite("the approval, asked of the home (FreewayApproval)")
struct FreewayApprovalTests {
  @Test("the home's own link asks nothing more; another desktop's names it, for the home to forward")
  func params() {
    #expect(FreewayApproval.method == "freeway.approve")
    #expect(FreewayApproval.params(for: "dev-studio", home: "dev-studio") == .object([:]))
    #expect(
      FreewayApproval.params(for: "dev-laptop", home: "dev-studio")
        == .object(["device": .string("dev-laptop")]))
  }

  @Test("each refusal is said in the phone's words, the desktop by name")
  func words() {
    let said = { (error: FieldProductError) in FreewayApproval.said(error, desktop: "laptop").message }
    #expect(said(forbiddenApproval) == "laptop won't approve a connection from this phone")
    #expect(
      said(approvalRefusal(FreewayContract.Approval.stateUncorrelated))
        == "laptop doesn't know this phone yet")
    #expect(
      said(approvalRefusal(FreewayContract.Approval.stateUnread))
        == "laptop isn't ready for this phone's connection yet")
    #expect(
      said(approvalRefusal(FreewayContract.Approval.stateDown))
        == "laptop isn't taking connections from phones right now")
    #expect(said(unreachableOwner) == "your home desktop can't reach laptop right now")
    #expect(said(FreewayApproval.noHome) == "this phone isn't connected to its home desktop")
  }

  @Test("with no home to ask, the refusal is the kit's own, retryable: the phone re-homes")
  func noHome() {
    #expect(FreewayApproval.noHome.kind == "UNAVAILABLE")
    #expect(FreewayApproval.noHome.retryable)
    #expect(FreewayApproval.noHome.unavailable?.service == FreewayContract.Approval.service)
    #expect(FreewayApproval.noHome.unavailable?.state == "no_door")
  }

  @Test("the words change nothing else: the kind, the retryability and the details are the door's")
  func keepsTheTaxonomy() {
    for error in [
      forbiddenApproval, approvalRefusal("uncorrelated"), approvalRefusal("unread"),
      approvalRefusal("down"), unreachableOwner,
    ] {
      let said = FreewayApproval.said(error, desktop: "laptop")
      #expect(said.kind == error.kind)
      #expect(said.retryable == error.retryable)
      #expect(said.details == error.details)
    }
    #expect(!FreewayApproval.said(forbiddenApproval, desktop: "laptop").retryable)
    #expect(FreewayApproval.said(approvalRefusal("down"), desktop: "laptop").retryable)
  }

  @Test("a refusal this phone has no words for keeps the door's own")
  func unknownKeepsTheDoorsWords() {
    let odd = approvalRefusal("brand-new-state")
    #expect(FreewayApproval.said(odd, desktop: "laptop") == odd)
    let internalError = FieldProductError(kind: "INTERNAL", message: "boom")
    #expect(FreewayApproval.said(internalError, desktop: "laptop") == internalError)
  }
}

/// A desktop whose approvals are scripted, one answer per ask, the last repeated.
final class ScriptedApprovals: @unchecked Sendable {
  private let lock = NSLock()
  private var answers: [Result<JSONValue, FieldProductError>]
  private var asked = 0

  init(_ answers: [Result<JSONValue, FieldProductError>]) { self.answers = answers }

  var asks: Int { lock.withLock { asked } }

  func next() throws -> JSONValue {
    let answer = lock.withLock { () -> Result<JSONValue, FieldProductError> in
      asked += 1
      return answers.count > 1 ? answers.removeFirst() : answers[0]
    }
    return try answer.get()
  }

  static let granted: Result<JSONValue, FieldProductError> = .success(
    .object([
      "approval": .object(["mac": .string("granted")]), "expiresAt": .int(1_787_790_600_000),
    ]))
}

@Suite("a refused approval on a desktop's link", .timeLimit(.minutes(1)))
struct FreewayApprovalRefusalTests {
  func dialing(_ mesh: TestMesh, _ approvals: ScriptedApprovals) -> FreewayDesktopLink.Dialing {
    FreewayDesktopLink.Dialing(
      dial: { mesh.dial() }, host: "desk.tail1234.ts.net", deviceId: "dev-desk",
      approve: { try approvals.next() }, deviceName: "phone", desktopName: "laptop")
  }

  @Test("the ask hears the refusal in the phone's words, and a refusal no retry fixes is not asked again on its own")
  func forbiddenIsNotRedialed() async throws {
    let mesh = TestMesh()
    let approvals = ScriptedApprovals([.failure(forbiddenApproval)])
    let desktop = FreewayDesktopLink(dialing(mesh, approvals), timing: fast())
    do {
      _ = try await within(5, "the refused ask") { try await desktop.link() }
      Issue.record("a refused approval linked")
    } catch let error as FieldProductError {
      #expect(error.kind == "FORBIDDEN_SCOPE")
      #expect(error.message == "laptop won't approve a connection from this phone")
    }
    guard case .refused(let refusal) = await desktop.state else {
      Issue.record("refused, and waiting for a tap: \(await desktop.state)")
      return
    }
    #expect(refusal.kind == "FORBIDDEN_SCOPE")
    try await Task.sleep(nanoseconds: 300_000_000)  // past the 80 ms ceiling, several times over
    #expect(approvals.asks == 1, "never asked again on its own")
    #expect(mesh.dials == 0, "an unapproved phone dials nothing")
  }

  @Test("a tap still asks again after a refusal no retry fixes — the person's word, not the supervisor's")
  func aTapAsksAgain() async throws {
    let mesh = TestMesh()
    let approvals = ScriptedApprovals([.failure(forbiddenApproval), ScriptedApprovals.granted])
    let desktop = FreewayDesktopLink(dialing(mesh, approvals), timing: fast())
    _ = try? await within(5, "the refused ask") { try await desktop.link() }
    var hosts = mesh.hosts.makeAsyncIterator()
    let asking = Task { try await desktop.link() }
    let host = try #require(await hosts.next())
    #expect(try await within(5, "the hello") { try await take(host) } == "granted")
    _ = try await within(5, "the link") { try await asking.value }
    #expect(approvals.asks == 2)
  }

  @Test("a retryable refusal is said, then asked again on the backoff until the desktop knows the phone")
  func uncorrelatedIsRetried() async throws {
    let mesh = TestMesh()
    let approvals = ScriptedApprovals([
      .failure(approvalRefusal(FreewayContract.Approval.stateUncorrelated)),
      ScriptedApprovals.granted,
    ])
    let desktop = FreewayDesktopLink(dialing(mesh, approvals), timing: fast())
    do {
      _ = try await within(5, "the refused ask") { try await desktop.link() }
      Issue.record("an uncorrelated phone linked at once")
    } catch let error as FieldProductError {
      #expect(error.message == "laptop doesn't know this phone yet")
      #expect(error.retryable)
    }
    var hosts = mesh.hosts.makeAsyncIterator()
    let host = try #require(await hosts.next())
    #expect(try await within(5, "the redial's hello") { try await take(host) } == "granted")
    try await within(5, "up again on its own") {
      while true {
        if case .up = await desktop.state { return }
        try await Task.sleep(nanoseconds: 10_000_000)
      }
    }
    #expect(approvals.asks == 2)
  }
}
