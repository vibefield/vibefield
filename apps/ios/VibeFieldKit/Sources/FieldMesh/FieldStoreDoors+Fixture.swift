#if DEBUG
  import FieldProduct
  import Foundation

  extension FieldStoreDoors {
    /// A store that has already been told one thing.
    ///
    /// This is a FIXTURE STORE and not a demo path, and the difference is the
    /// whole point: `FieldLink` runs its real reconcile over these doors, the
    /// real `AgentFieldSlice` reader parses the real bytes, and the real fold
    /// makes the bodies. What is fake is the MESH — one peer, one message,
    /// never a second — so a screenshot run can put the swarm over
    /// real-shaped rows in both themes without a desktop, a tailnet, or a
    /// finger on the glass.
    ///
    /// It cannot exist in Release. A `full` is the message a node sends to a
    /// peer that just joined, which is exactly what this phone would have
    /// received.
    public static func fixture(
      slice: Data, deviceId: String = "dev-fixture", storeId: String
    ) -> FieldStoreDoors {
      let namespace = FieldStore.namespace(for: storeId)
      let payload = JSONValue.object([
        "type": .string("full"),
        "device_id": .string(deviceId),
        "data": (try? JSONValue.parse(slice)) ?? .null,
        "version": .int(1),
        "updated_at": .int(Int64(Date().timeIntervalSince1970 * 1000)),
      ])
      let frame = (try? payload.encoded()) ?? Data()

      return FieldStoreDoors(
        onlinePeers: {
          [FieldStorePeer(id: "node-fixture", deviceId: deviceId, online: true)]
        },
        // The reader asks; nothing is listening, and that is honest — the
        // answer was already delivered below.
        send: { _, _, _, _ in },
        messages: { asked in
          AsyncStream { continuation in
            if asked == namespace {
              continuation.yield(
                FieldStoreInbound(
                  fromPeerId: "node-fixture", fromDeviceId: deviceId, msgType: "full",
                  payload: frame))
            }
            // Never finished: a finished stream would end the reader's loop,
            // and a paused-then-resumed link would find nothing listening.
          }
        },
        peerEvents: { AsyncStream { _ in } })
    }

    /// The contracts' own golden board, as it ships in this bundle.
    ///
    /// The JSON is `packages/contracts/fixtures/agent-field-slice.valid.json`
    /// copied byte for byte, so the lab draws the same five rows the decoders
    /// are tested against — one blocked on `Bash`, one working, one idle, one
    /// pending, one exited. `publishedAt`/`expiresAt` are REWRITTEN to now, and
    /// only that: a fixture minted in the past would be expired before it was
    /// read, and the expiry rule is one of the things worth looking at.
    public static func goldenBoard(storeId: String = FieldStoreID.agents) -> FieldStoreDoors? {
      guard
        let url = Bundle.module.url(
          forResource: "agent-field-slice.valid", withExtension: "json",
          subdirectory: "Fixtures"),
        let data = try? Data(contentsOf: url),
        var board = (try? JSONValue.parse(data))?.objectValue
      else { return nil }

      let now = Int64(Date().timeIntervalSince1970 * 1000)
      board["publishedAt"] = .int(now)
      board["expiresAt"] = .int(now + 30_000)
      guard let refreshed = try? JSONValue.object(board).encoded() else { return nil }
      return fixture(slice: refreshed, storeId: storeId)
    }
  }
#endif
