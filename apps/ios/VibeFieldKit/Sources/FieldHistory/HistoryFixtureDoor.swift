#if DEBUG
  import FieldProduct
  import Foundation

  /// `-vf-demo-history-door` (SP-6): the History tab's REAL reads over an
  /// in-process door that answers the contracts' own goldens — `index.status`,
  /// `index.projects`, `index.sessions`, `index.session`, `index.project`,
  /// `index.search`, `index.timeline` and the tail's open, byte for byte from
  /// `packages/contracts/fixtures/` (copies under `Fixtures/`, the gate keeps
  /// them identical). Every step the live reader takes runs here — the fold,
  /// the cache, the arrival pill on a scripted delta — so both themes can be
  /// photographed over real-shaped rows with no desktop and no tailnet. It is
  /// not a demo path: nothing downstream of the door knows the difference.
  /// Cannot exist in Release.
  @MainActor
  public final class HistoryFixtureDoor: HistoryDoor {
    private var tailDelivered = false
    private var onTailDelta: (@MainActor (JSONValue) -> Void)?
    /// How long after the tail opens the golden delta arrives (the arrival
    /// pill's own picture); nil never delivers it.
    public var deltaAfter: Duration?

    public init(deltaAfter: Duration? = .seconds(2)) {
      self.deltaAfter = deltaAfter
    }

    public static func fixture(_ name: String) -> JSONValue? {
      guard
        let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"),
        let data = try? Data(contentsOf: url)
      else { return nil }
      return try? JSONValue.parse(data)
    }

    private func answer(_ name: String) throws -> JSONValue {
      guard let value = Self.fixture(name) else {
        throw FieldProductError(kind: "NOT_FOUND", message: "the fixture door holds no \(name)")
      }
      return value
    }

    public func call(_ method: String, params: JSONValue?) async throws -> JSONValue {
      switch method {
      case "index.status": return try answer("index-status.valid")
      case "index.projects": return try answer("index-projects.mesh")
      case "index.sessions": return try answer("index-sessions.valid")
      case "index.session":
        // the golden header, named as the session that was asked for, so a
        // row of the listing opens as itself
        var header = try answer("index-session.valid")
        if let asked = params?["sessionId"]?.stringValue, var fields = header["session"]?.objectValue {
          fields["sessionId"] = .string(asked)
          header = .object(["session": .object(fields)])
        }
        return header
      case "index.project":
        var result = try answer("index-project.valid")
        if let asked = params?["projectId"]?.stringValue, var fields = result.objectValue {
          fields["projectId"] = .string(asked)
          result = .object(fields)
        }
        return result
      case "index.search": return try answer("index-search-result.valid")
      case "index.timeline":
        var page = try answer("index-timeline.valid")
        if let asked = params?["sessionId"]?.stringValue, var fields = page.objectValue {
          fields["sessionId"] = .string(asked)
          fields["entries"] = .array(
            (fields["entries"]?.arrayValue ?? []).map { row in
              guard var entry = row.objectValue else { return row }
              entry["sessionId"] = .string(asked)
              return .object(entry)
            })
          // the golden page says more lies behind its cursor; the fixture
          // holds one page, so the top is here
          fields["nextCursor"] = .null
          page = .object(fields)
        }
        return page
      default:
        throw FieldProductError(kind: "NOT_FOUND", message: "the fixture door does not answer \(method)")
      }
    }

    public func tail(
      _ method: String, params: JSONValue?, shape: SubscriptionShape,
      onSnapshot: @escaping @MainActor (JSONValue) -> Void,
      onDelta: @escaping @MainActor (JSONValue) -> Void
    ) async throws -> HistoryTailHandle {
      guard method == "index.session.subscribe" else {
        throw FieldProductError(kind: "NOT_FOUND", message: "the fixture door does not answer \(method)")
      }
      let open = try answer("index-session-tail-open.snapshot")
      let asked = params?["sessionId"]?.stringValue
      // the open's snapshot, re-keyed to the session asked for, and grown:
      // the golden's four rows repeated as eight turns under their own ids
      // and ordinals, so the document SCROLLS and the arrival pill has a
      // page to stand under (a four-row document shows its end at once)
      if var snapshot = open["snapshot"]?.objectValue {
        let golden = snapshot["rows"]?.arrayValue ?? []
        var rows: [JSONValue] = []
        for repeatIndex in 0..<8 {
          for (offset, row) in golden.enumerated() {
            guard var entry = row.objectValue else { continue }
            if let asked { entry["sessionId"] = .string(asked) }
            let base = entry["timelineId"]?.stringValue ?? "t\(offset)"
            entry["timelineId"] = .string(repeatIndex == 0 ? base : "\(base)-\(repeatIndex)")
            entry["ordinal"] = .int(Int64(repeatIndex * 10 + offset))
            if let at = entry["at"]?.intValue { entry["at"] = .int(at + Int64(repeatIndex) * 5_400_000) }
            rows.append(.object(entry))
          }
        }
        snapshot["rows"] = .array(rows)
        onSnapshot(.object(snapshot))
      }
      onTailDelta = onDelta
      if let deltaAfter, !tailDelivered {
        tailDelivered = true
        Task { @MainActor [weak self] in
          try? await Task.sleep(for: deltaAfter)
          guard let self, let deliver = self.onTailDelta, var delta = Self.fixture("index-session-tail-delta.valid")?.objectValue else { return }
          // the golden delta patches t1; a NEW row beside it is what the
          // arrival pill counts
          var appended = (Self.fixture("index-timeline.valid")?["entries"]?.arrayValue?.last?.objectValue) ?? [:]
          appended["timelineId"] = .string("t-arrival")
          appended["ordinal"] = .int(999)
          appended["kind"] = .string("agent")
          appended["text"] = .string("Eleven glyphs, all resolving — the tail delivered this row.")
          if let asked { appended["sessionId"] = .string(asked) }
          delta["upserts"] = .array((delta["upserts"]?.arrayValue ?? []).map { row in
            guard var entry = row.objectValue, let asked else { return row }
            entry["sessionId"] = .string(asked)
            return .object(entry)
          } + [.object(appended)])
          deliver(.object(delta))
        }
      }
      return HistoryTailHandle { [weak self] in self?.onTailDelta = nil }
    }

    public func close() {
      onTailDelta = nil
    }
  }
#endif
