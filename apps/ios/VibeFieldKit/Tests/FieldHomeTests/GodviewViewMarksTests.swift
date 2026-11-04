import CoreGraphics
import Testing

@testable import FieldHome

// PG-4t — THE VIEWS' FACES (host + kit): every case has its manifest's face, and the outline writer writes what the
// view SDK's `mark-outline.js` writes. The expected strings are mark-outline.js's own output at puppeteer-view-sdk
// 0.3.3 (node, 2026-11-04; light/mk-node.log); the five marks whole are held to the installed manifests by the marks
// golden's row.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite("PG-4t — the views' faces")
struct GodviewViewMarksTests {
  /// P2 (PIN) — every view the phone has wears its manifest's face, never the fallback; all five are transcribed.
  @Test func everyViewHasItsManifestsFace() {
    for choice in GodviewViewChoice.allCases {
      let face = GodviewViewMarks.faces[choice.rawValue]
      #expect(face != nil, "\(choice)")
      #expect(choice.face == face, "\(choice)")
      #expect(!choice.face.paths.isEmpty, "\(choice) draws a mark")
    }
    let ids = Set(GodviewViewMarks.faces.keys)
    #expect(ids == Set(GodviewViewChoice.registryOrder))
    let labels = GodviewViewChoice.registryOrder.map { GodviewViewMarks.faces[$0]?.label }
    #expect(labels == ["SWARM", "LIST", "RAIN", "TIMELINE", "SPEND"])
  }

  /// MK1 — a coordinate in `unit`'s digits: four places, a tie toward +∞, no `-0`, no trailing `.0`.
  @Test func aCoordinateInUnitsDigits() {
    let cases: [(Double, String)] = [
      (3, "3"), (7.5, "7.5"), (0.8, "0.8"), (-0.8, "-0.8"), (0.12344, "0.1234"), (0.12346, "0.1235"),
      (-0.00004, "0"), (0.00001, "0"), (12.30005, "12.3001"), (-3.25, "-3.25"), (100, "100"), (-0.0, "0"),
    ]
    for (value, expected) in cases {
      let text = GodviewViewFace.unit(value)
      #expect(text == expected, "\(value)")
    }
  }

  /// MK2 — one part's outline, as `strokeOutline` and `ringOutline` write it: a level stroke, a slanted one, a dot,
  /// a ring with its hole, a ring too narrow for one.
  @Test func onePartsOutlineAsTheSDKWritesIt() {
    let cases: [(GodviewViewFace.Part, String)] = [
      (
        .stroke(from: CGPoint(x: 5, y: 7), to: CGPoint(x: 19, y: 7), width: 1.6),
        "M5 7.8L19 7.8A0.8 0.8 0 0 0 19 6.2L5 6.2A0.8 0.8 0 0 0 5 7.8Z"
      ),
      (
        .stroke(from: CGPoint(x: 3.5, y: 18.5), to: CGPoint(x: 8, y: 14), width: 1.6),
        "M4.0657 19.0657L8.5657 14.5657A0.8 0.8 0 0 0 7.4343 13.4343L2.9343 17.9343A0.8 0.8 0 0 0 4.0657 19.0657Z"
      ),
      (
        .stroke(from: CGPoint(x: 11.5, y: 16.5), to: CGPoint(x: 17, y: 9), width: 1.6),
        "M12.1451 16.9731L17.6451 9.4731A0.8 0.8 0 0 0 16.3549 8.5269L10.8549 16.0269A0.8 0.8 0 0 0 12.1451 16.9731Z"
      ),
      (
        .stroke(from: CGPoint(x: 17, y: 9), to: CGPoint(x: 17, y: 9), width: 4.4),
        "M14.8 9A2.2 2.2 0 1 0 19.2 9A2.2 2.2 0 1 0 14.8 9Z"
      ),
      (
        .ring(center: CGPoint(x: 7.5, y: 8), radius: 3),
        "M3.7 8A3.8 3.8 0 1 0 11.3 8A3.8 3.8 0 1 0 3.7 8ZM5.3 8A2.2 2.2 0 1 1 9.7 8A2.2 2.2 0 1 1 5.3 8Z"
      ),
      (.ring(center: CGPoint(x: 1, y: 1), radius: 0.5), "M-0.3 1A1.3 1.3 0 1 0 2.3 1A1.3 1.3 0 1 0 -0.3 1Z"),
    ]
    for (part, expected) in cases {
      let outline = GodviewViewFace.outline(part)
      #expect(outline == expected, "\(part)")
    }
  }

  /// MK3 — a path is its parts' outlines joined, as `strokesOutline` joins them.
  @Test func aPathIsItsPartsJoined() {
    let face = GodviewViewFace(
      label: "PROBE",
      paths: [[
        .stroke(from: CGPoint(x: 5, y: 7), to: CGPoint(x: 19, y: 7), width: 1.6),
        .stroke(from: CGPoint(x: 5, y: 12), to: CGPoint(x: 19, y: 12), width: 1.6),
      ]])
    let outlines = face.outlines
    #expect(
      outlines == [
        "M5 7.8L19 7.8A0.8 0.8 0 0 0 19 6.2L5 6.2A0.8 0.8 0 0 0 5 7.8Z"
          + "M5 12.8L19 12.8A0.8 0.8 0 0 0 19 11.2L5 11.2A0.8 0.8 0 0 0 5 12.8Z"
      ])
  }
}
