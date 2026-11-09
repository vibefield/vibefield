import FieldProduct
import Foundation
import Testing

@testable import FieldHome

/// UM-5b (UM-D14) — THE PHONE'S JOIN IS THE DESKTOP'S (`packages/field-app/src/usage/plan-sessions.ts`): which plan a
/// run spends, from what every row already says, its Agent Profile set and its agent. `BandsParityTests` holds the two
/// joins to one golden over the contracts' profile sets; this suite pins the branches a fixture does not reach.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("which plan a session spends, the desktop's join, on the phone")
struct PlanSessionsTests {
  static func persona(_ profileId: String, _ provider: String, holds: JSONValue? = nil) -> JSONValue {
    var fields: [String: JSONValue] = ["profileId": .string(profileId), "provider": .string(provider)]
    if let holds { fields["holds"] = holds }
    return .object(fields)
  }

  static func holding(runsOn: Bool = true, key: Bool = false, planId: String? = nil) -> JSONValue {
    var fields: [String: JSONValue] = ["runsOn": .bool(runsOn), "key": .bool(key)]
    if let planId { fields["planId"] = .string(planId) }
    return .object(fields)
  }

  static func plan(_ id: String, holders: [String], alsoIn: [String] = [], email: String? = nil) -> JSONValue {
    var fields: [String: JSONValue] = [
      "id": .string(id), "service": .object(["id": .string("anthropic"), "label": .string("Anthropic")]),
      "holders": .array(holders.map(JSONValue.string)), "alsoIn": .array(alsoIn.map(JSONValue.string)),
    ]
    if let email { fields["account"] = .object(["email": .string(email)]) }
    return .object(fields)
  }

  static func set(_ id: String, personas: [JSONValue], plans: [JSONValue] = []) throws -> AgentProfileSet {
    try AgentProfileSet(
      json: .object([
        "id": .string(id), "kind": .string("managed"), "personas": .array(personas), "plans": .array(plans),
      ]))
  }

  @Test("a present runsOn holding decides over the plans' holders")
  func runsOnDecides() throws {
    let sets = [
      try Self.set(
        "s", personas: [Self.persona("p", "claude", holds: .array([Self.holding(planId: "b")]))],
        plans: [Self.plan("a", holders: ["p"]), Self.plan("b", holders: [])])
    ]
    let key = PlanSessions.planKey(sets, profileSet: "s", provider: "claude")
    #expect(key == "s/plan:b")
  }

  @Test("a key run beside a subscription sign-in is on no plan: it is pay per use")
  func keyRun() throws {
    let holds = JSONValue.array([Self.holding(key: true), Self.holding(runsOn: false, planId: "a")])
    let sets = [try Self.set("s", personas: [Self.persona("p", "claude", holds: holds)], plans: [Self.plan("a", holders: ["p"])])]
    let key = PlanSessions.planKey(sets, profileSet: "s", provider: "claude")
    #expect(key == nil)
    let runs = PlanSessions.runs(sets, key: "s/plan:a")
    #expect(runs == "")
  }

  @Test("a key-only sign-in on no plan joins its own meter row: nothing else names it (the desktop's own row)")
  func keyOnly() throws {
    let holds = JSONValue.array([Self.holding(key: true)])
    let sets = [try Self.set("s", personas: [Self.persona("p", "claude", holds: holds)])]
    let key = PlanSessions.planKey(sets, profileSet: "s", provider: "claude")
    #expect(key == "s/agent:p")
  }

  @Test("no holds at all (an older daemon, the tolerant reader): the plan whose holders has it, then its own row")
  func noHolds() throws {
    let sets = [
      try Self.set(
        "s", personas: [Self.persona("p", "claude"), Self.persona("q", "codex")], plans: [Self.plan("a", holders: ["p"])])
    ]
    let onPlan = PlanSessions.planKey(sets, profileSet: "s", provider: "claude")
    #expect(onPlan == "s/plan:a")
    let onNone = PlanSessions.planKey(sets, profileSet: "s", provider: "codex")
    #expect(onNone == "s/agent:q")
    let terminal = PlanSessions.planKey(sets, profileSet: "s", provider: nil)
    #expect(terminal == nil)
  }

  @Test("a family: the same account in another profile `alsoIn` names is a twin; a plan with nothing to share is its own")
  func family() throws {
    let sets = [
      try Self.set(
        "a", personas: [Self.persona("p", "claude")],
        plans: [Self.plan("one", holders: ["p"], alsoIn: ["b"], email: "kim@example.com")]),
      try Self.set(
        "b", personas: [Self.persona("q", "claude")],
        plans: [Self.plan("one", holders: ["q"], alsoIn: ["a"], email: "kim@example.com")]),
    ]
    let family = PlanSessions.family(sets, key: "a/plan:one")
    #expect(family == ["a/plan:one", "b/plan:one"])
    let runs = PlanSessions.runs(sets, key: "b/plan:one")
    #expect(runs == "a\u{0}claude\nb\u{0}claude")
    let lonely = [try Self.set("c", personas: [Self.persona("r", "claude")], plans: [Self.plan("two", holders: ["r"])])]
    let own = PlanSessions.family(lonely, key: "c/plan:two")
    #expect(own == ["c/plan:two"])
  }

  @Test("what recedes: a lens keeps its own desktop's rows, a plan the runs on it, and a peer's or a terminal's recede")
  func recedes() {
    let runs: Set<String> = ["work\u{0}claude"]
    #expect(!PlanSessions.recedes(.none, isSelf: true, profileSet: "work", provider: "claude"))
    #expect(!PlanSessions.recedes("work", isSelf: true, profileSet: "work", provider: nil))
    #expect(PlanSessions.recedes("work", isSelf: false, profileSet: "work", provider: "claude"))
    let plan = PlanSessions.Lens(planRuns: runs)
    #expect(!PlanSessions.recedes(plan, isSelf: true, profileSet: "work", provider: "claude"))
    #expect(PlanSessions.recedes(plan, isSelf: true, profileSet: "work", provider: "codex"))
    #expect(PlanSessions.recedes(plan, isSelf: true, profileSet: "work", provider: nil))
    #expect(PlanSessions.recedes(plan, isSelf: false, profileSet: "work", provider: "claude"))
    let both = PlanSessions.Lens(profile: "native", planRuns: runs)
    #expect(PlanSessions.recedes(both, isSelf: true, profileSet: "work", provider: "claude"))
  }
}
