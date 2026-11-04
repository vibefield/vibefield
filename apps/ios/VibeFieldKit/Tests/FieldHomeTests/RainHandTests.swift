import FieldProduct
import Foundation
import Testing

@testable import FieldHome

// PG-8 — THE RAIN'S HAND ROWS: what the witness run lacks (read-pg8 §7). Each row's expectation is what puppeteer-
// views 0.3.3's own `rain-streams.js` says for it (computed by the shipping code:
// `lanes/pg8-rain/light/hand-probe.mjs`, its log beside it), and each says what the witness does not carry.

extension RainViewTests {
  @Suite("hand rows: what the witness lacks")
  struct Hand {
    /// A row as the rain reads it, written out: an agent of `p`, model `m`, on the home unless told.
    static func agent(
      project: String = "p", branch: String? = nil, model: String = "m", usedPercent: Double? = nil,
      kind: MonitorRowKind = .agent, isSelf: Bool = true, deviceName: String = "Studio"
    ) -> RainAgent {
      RainAgent(
        id: "hand", kind: kind, status: .working, isSelf: isSelf, deviceName: deviceName, projectName: project,
        branch: branch, model: model, usedPercent: usedPercent, detail: "")
    }

    static func text(_ units: [UInt16]) -> String { String(decoding: units, as: UTF16.self) }

    /// H1 — a branch that names nothing, an empty part and an absent one are all dropped (`parts.filter(Boolean)`);
    /// the witness names a branch on every agent that has one.
    @Test func anEmptyOrAbsentPartIsDropped() throws {
      let plain = Self.agent(project: "vibe-field", model: "Opus 5.5", usedPercent: 62)
      let noBranch = Self.text(RainStreams.data(plain))
      #expect(noBranch == " vibe field Opus 5.5 CTX 62% ")
      let blank = Self.agent(project: "vibe-field", branch: "", model: "Opus 5.5", usedPercent: 62)
      let emptyBranch = Self.text(RainStreams.data(blank))
      #expect(emptyBranch == " vibe field Opus 5.5 CTX 62% ")
      let nothing = RainStreams.data(Self.agent(project: "", model: ""))
      #expect(Self.text(nothing) == "  ")
      // and through the row: the witness's run-h-root says no branch (`.notLooked`); a branch `null` reads the same
      let rows = try RainGolden.witness(editing: "run-h-root") {
        $0["project"] = .object(["name": .string("vibe-field"), "branch": .null])
      }
      let root = try #require(rows.first { $0.id == "run-h-root" })
      let agent = RainAgent(row: root)
      #expect(agent.branch == nil)
      let data = Self.text(RainStreams.data(agent))
      #expect(data == " vibe field Opus 5.5 CTX 05% ")
    }

    /// H2 — `CTX:` rounds as `Math.round` does (a tie toward +∞; −0 prints `0`), prints as `toString` does and pads
    /// to two digits; a `-` and an exponent's `+` are symbols, flattened. The witness's contexts are whole, 5 to 83.
    @Test func theContextRoundsAsJavaScriptRounds() {
      let cases: [(Double, String)] = [
        (4.5, " p m CTX 05% "), (0.49999999999999994, " p m CTX 00% "), (-0.4, " p m CTX 00% "),
        (-1.5, " p m CTX  1% "), (100.5, " p m CTX 101% "), (2.5, " p m CTX 03% "), (0, " p m CTX 00% "),
        (9.5, " p m CTX 10% "), (99.5, " p m CTX 100% "), (140, " p m CTX 140% "),
        // past 2^53 and past 1e21, JavaScript's own digits (`toString`), then flattened
        (9_007_199_254_740_994, " p m CTX 9007199254740994% "), (1e21, " p m CTX 1e 21% "),
        (2.5e25, " p m CTX 2.5e 25% "), (1e300, " p m CTX 1e 300% "),
      ]
      for (percent, expected) in cases {
        let data = Self.text(RainStreams.data(Self.agent(usedPercent: percent)))
        #expect(data == expected, "CTX of \(percent)")
      }
    }

    /// H3 — the flatten works on UTF-16 code units, as a regular expression with no `u` flag does: an astral character
    /// is two cells, JavaScript's whitespace stays (NBSP, U+3000, CR and LF), and a combining mark is a symbol. The
    /// witness's names are ASCII.
    @Test func theFlattenIsUnitByUnit() {
      let cases: [(String, [UInt16])] = [
        ("café", Array(" caf  m ".utf16)),
        ("\u{1F98A}fox", Array("   fox m ".utf16)),
        ("a\u{00A0}b", Array(" a\u{00A0}b m ".utf16)),
        ("a\r\nb", [0x20, 0x61, 0x0D, 0x0A, 0x62, 0x20, 0x6D, 0x20]),
        ("a\u{3000}b", Array(" a\u{3000}b m ".utf16)),
        ("e\u{0301}", Array(" e  m ".utf16)),
        ("feat/x-y_z", Array(" feat x y z m ".utf16)),
      ]
      for (project, expected) in cases {
        let data = RainStreams.data(Self.agent(project: project))
        let scalars = project.unicodeScalars.map { String($0.value, radix: 16) }
        #expect(data == expected, "the flatten of \(scalars)")
      }
      // "\r\n" is ONE Character and two cells: the length is the units'
      let crlf = RainStreams.data(Self.agent(project: "a\r\nb"))
      #expect(crlf.count == 8)
    }

    /// H4 — an agent with no context is measured mid-scale (0.5); a terminal's context is never read. The witness's
    /// every agent reports one.
    @Test func anUnmeasuredWindowSitsMidScale() {
      let agent = Self.agent(project: "vibe-field", branch: "main", model: "Opus 5.5")
      let data = RainStreams.data(agent)
      #expect(Self.text(data) == " vibe field main Opus 5.5 ")
      let tail = RainStreams.tailLength(agent, rows: 54, tailMultiplier: 1, dataLength: data.count)
      #expect(tail == 32)
      let terminal = Self.agent(project: "notes", usedPercent: 90, kind: .terminal)
      let terminalData = RainStreams.data(terminal)
      #expect(Self.text(terminalData) == " notes terminal ")
      let terminalTail = RainStreams.tailLength(terminal, rows: 54, tailMultiplier: 1, dataLength: terminalData.count)
      #expect(terminalTail == 24.3)
      // past 100 the usage clamps to 1; 99.5 rounds to 100 in its words but measures 0.995
      let full = RainStreams.tailLength(Self.agent(usedPercent: 140), rows: 54, tailMultiplier: 1, dataLength: 14)
      #expect(full == 48.6)
      let almost = RainStreams.tailLength(Self.agent(usedPercent: 99.5), rows: 54, tailMultiplier: 1, dataLength: 14)
      #expect(almost == 48.357)
    }

    /// H5 — the tail's own floor of 3 wins only where the data is all but empty and the multiplier is up: `"  "` at
    /// three rows ×3 is 9, where the data floor says 8. A home terminal in no folder says `terminal` twice.
    @Test func theTailsFloorsAreBoth() {
      let empty = Self.agent(project: "", model: "")
      let tripled = RainStreams.tailLength(empty, rows: 3, tailMultiplier: 3, dataLength: 2)
      #expect(tripled == 9)
      let short = RainStreams.tailLength(empty, rows: 3, tailMultiplier: 1, dataLength: 2)
      #expect(short == 8)
      let tall = RainStreams.tailLength(empty, rows: 54, tailMultiplier: 1, dataLength: 2)
      #expect(tall == 24.3)
      let terminal = Self.agent(project: "terminal", kind: .terminal)
      let terminalWords = Self.text(RainStreams.data(terminal))
      #expect(terminalWords == " terminal terminal ")
      let peer = Self.agent(project: "notes", kind: .terminal, isSelf: false, deviceName: "Loft")
      let peerWords = Self.text(RainStreams.data(peer))
      #expect(peerWords == " Loft notes ")
    }

    /// H17 — the placement's edges: no columns or no agents place nothing; one column for two agents places the first
    /// alone; a kept stream keeps its column, a surplus one is reclaimed and its column goes to a newcomer; a stage
    /// that narrows drops what no longer fits.
    @Test func thePlacementsEdges() {
      var births = 0.0
      let create: (String) -> RainDrop = { agentId in
        defer { births += 1 }
        return RainDrop(agentId: agentId, y: births, speed: 0.5)
      }
      func dump(_ columns: RainColumns) -> [String] {
        columns.entries.map { "\($0.column) \($0.drop.agentId) \(Int($0.drop.y))" }
      }
      let noColumns = RainStreams.reconcile(agents: ["a"], columns: 0, previous: RainColumns(), createDrop: create)
      #expect(noColumns.isEmpty)
      let noAgents = RainStreams.reconcile(agents: [], columns: 4, previous: RainColumns(), createDrop: create)
      #expect(noAgents.isEmpty)
      births = 0
      let one = RainStreams.reconcile(agents: ["a", "b"], columns: 1, previous: RainColumns(), createDrop: create)
      #expect(dump(one) == ["0 a 0"])
      births = 0
      let alone = RainStreams.reconcile(agents: ["a"], columns: 4, previous: RainColumns(), createDrop: create)
      #expect(dump(alone) == ["2 a 0", "3 a 1"])
      let three = RainStreams.reconcile(agents: ["a", "b", "c"], columns: 4, previous: alone, createDrop: create)
      #expect(dump(three) == ["2 a 0", "3 b 2", "1 c 3"])
      let kept = three.drop(at: 2)
      let same = alone.drop(at: 2)
      #expect(kept === same, "a kept stream is the same drop")
      let narrowed = RainStreams.reconcile(agents: ["c"], columns: 2, previous: three, createDrop: create)
      #expect(dump(narrowed) == ["1 c 3", "0 c 4"])
    }
  }
}
