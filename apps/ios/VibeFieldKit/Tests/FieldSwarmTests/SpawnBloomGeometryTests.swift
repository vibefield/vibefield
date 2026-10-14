import Foundation
import Testing

@testable import FieldSwarm

/// PJ-7 — the spawn bloom's geometry, held to the REFERENCE (the IOS-6 rule:
/// the reference first, then Swift). `spawn-bloom-geometry.lane.json` is what
/// puppeteer's own `views/swarm/bloom` answers on the phone's field
/// (`apps/ios/scripts/spawn-bloom-goldens.mjs`, at the pin): both rings at
/// eight holds across the field for two and three desktops, and what a pointer
/// targets with the rings closed and open. Words are measured the same
/// synthetic way on both sides (characters × 0.6 em).
@Suite struct SpawnBloomGeometryTests {
  private let measure: BloomMeasure = { text, font in
    Double(text.utf16.count) * (font == .label ? 9.5 : 7.5) * 0.6
  }

  private func golden() throws -> [String: Any] {
    let url = try #require(Bundle.module.url(forResource: "spawn-bloom-geometry.lane", withExtension: "json", subdirectory: "Fixtures"))
    return try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
  }

  private func num(_ any: Any?) -> Double { (any as? NSNumber)?.doubleValue ?? .nan }

  private func expectLayout(_ got: BloomGeometry.ArcLayout, _ want: [String: Any], _ what: String) {
    #expect(abs(got.theta - num(want["theta"])) < 1e-6, "\(what) theta")
    #expect(got.turn == num(want["turn"]), "\(what) turn")
    #expect(abs(got.step - num(want["step"])) < 1e-6, "\(what) step")
    #expect(got.kept == (want["kept"] as? Bool), "\(what) kept")
    let items = want["items"] as? [[String: Any]] ?? []
    #expect(got.items.count == items.count, "\(what) count")
    for (i, (have, item)) in zip(got.items, items).enumerated() {
      #expect(abs(have.x - num(item["x"])) < 1e-6 && abs(have.y - num(item["y"])) < 1e-6, "\(what) bud \(i)")
      #expect(abs(have.a - num(item["a"])) < 1e-6, "\(what) bud \(i) angle")
      let label = item["label"] as? [String: Any] ?? [:]
      #expect(
        abs(have.label.x - num(label["x"])) < 1e-6 && abs(have.label.y - num(label["y"])) < 1e-6
          && abs(have.label.w - num(label["w"])) < 1e-6 && abs(have.label.h - num(label["h"])) < 1e-6,
        "\(what) bud \(i) words \(have.label) vs \(label)")
      #expect(have.label.align.rawValue == (label["align"] as? String), "\(what) bud \(i) align")
      #expect(have.short == (item["short"] as? Bool), "\(what) bud \(i) short")
    }
  }

  @Test func bothRingsStandWhereTheReferencePutsThemAtEveryHold() throws {
    let g = try golden()
    let fieldJSON = g["field"] as? [String: Any] ?? [:]
    let field = BloomSize(w: num(fieldJSON["w"]), h: num(fieldJSON["h"]))
    let chrome = (g["chrome"] as? [[String: Any]] ?? []).map {
      BloomRect(x: num($0["x"]), y: num($0["y"]), width: num($0["width"]), height: num($0["height"]))
    }
    let menus = g["menus"] as? [String: [[String: Any]]] ?? [:]
    let rings = g["rings"] as? [[String: Any]] ?? []
    #expect(rings.count == 16)
    for ring in rings {
      let menu = menus[ring["menu"] as? String ?? ""] ?? []
      let hold = ring["hold"] as? [String: Any] ?? [:]
      let P = BloomPoint(x: num(hold["x"]), y: num(hold["y"]))
      let labels = menu.map { BloomLabelText(name: $0["name"] as? String ?? "", sub: $0["sub"] as? String) }
      let profiles = menu.map { Int(num($0["profiles"])) }
      let one = BloomRings.one(at: P, labels: labels, profiles: profiles, field: field, chrome: chrome, measure: measure)
      let what = "\(ring["menu"] ?? "") at (\(P.x), \(P.y))"
      expectLayout(one, ring["one"] as? [String: Any] ?? [:], "\(what) ring one")
      for two in ring["two"] as? [[String: Any]] ?? [] {
        let open = Int(num(two["open"]))
        let names = two["names"] as? [String] ?? []
        let layout = BloomRings.two(
          at: P, ring: one, open: open, openLabel: labels[open], names: names, field: field, chrome: chrome,
          measure: measure)
        expectLayout(layout, two["layout"] as? [String: Any] ?? [:], "\(what) ring two of \(open)")
      }
    }
  }

  @Test func aPointerTargetsWhatTheReferenceTargets() throws {
    let g = try golden()
    let fieldJSON = g["field"] as? [String: Any] ?? [:]
    let field = BloomSize(w: num(fieldJSON["w"]), h: num(fieldJSON["h"]))
    let chrome = (g["chrome"] as? [[String: Any]] ?? []).map {
      BloomRect(x: num($0["x"]), y: num($0["y"]), width: num($0["width"]), height: num($0["height"]))
    }
    let menu = (g["menus"] as? [String: [[String: Any]]])?["three"] ?? []
    let labels = menu.map { BloomLabelText(name: $0["name"] as? String ?? "", sub: $0["sub"] as? String) }
    let P = BloomPoint(x: 201, y: 437)
    let one = BloomRings.one(
      at: P, labels: labels, profiles: menu.map { Int(num($0["profiles"])) }, field: field, chrome: chrome,
      measure: measure)
    let two = BloomRings.two(
      at: P, ring: one, open: 0, openLabel: labels[0], names: ["Default", "Work"], field: field, chrome: chrome,
      measure: measure)
    let closed = BloomTargetState(P: P, l1: one.items.map(\.a), l1step: one.step)
    var opened = closed
    opened.l2 = two.items.map(\.a)
    opened.l2step = two.step
    opened.open = (0, BloomPoint(x: one.items[0].x, y: one.items[0].y), 0)
    func word(_ result: (collapse: Bool, target: BloomTarget)) -> (Bool, String, Int?) {
      switch result.target {
      case .hub: (result.collapse, "hub", nil)
      case .none: (result.collapse, "none", nil)
      case .ring1(let index, _): (result.collapse, "device", index)
      case .ring2(let index): (result.collapse, "profile", index)
      }
    }
    let targets = g["targets"] as? [[String: Any]] ?? []
    #expect(targets.count == 23)
    for target in targets {
      let point = target["point"] as? [String: Any] ?? [:]
      let p = BloomPoint(x: num(point["x"]), y: num(point["y"]))
      for (state, key) in [(closed, "closed"), (opened, "open")] {
        let want = target[key] as? [String: Any] ?? [:]
        let got = word(BloomTargeting.resolve(state, p, now: 10))
        #expect(got.0 == (want["collapse"] as? Bool), "\(key) at (\(p.x), \(p.y)) collapse")
        #expect(got.1 == (want["kind"] as? String), "\(key) at (\(p.x), \(p.y)) kind")
        #expect(got.2 == (want["index"] as? NSNumber)?.intValue, "\(key) at (\(p.x), \(p.y)) index")
      }
    }
  }

  @Test func theNumbersAreTheReferencesTable() {
    #expect(BloomConstants.holdMs == 520 && BloomConstants.r1 == 92 && BloomConstants.bud1 == 48)
    #expect(BloomConstants.step1 == 42 && BloomConstants.r2 == 80 && BloomConstants.bud2 == 42)
    #expect(BloomGeometry.turnAt(0) == 0 && BloomGeometry.turnAt(1) == 15 && BloomGeometry.turnAt(2) == -15)
    #expect(BloomGeometry.turnAt(3) == 30 && BloomGeometry.turnAt(4) == -30)
    #expect(BloomGeometry.angDiff(170, -170) == 20)
  }
}
