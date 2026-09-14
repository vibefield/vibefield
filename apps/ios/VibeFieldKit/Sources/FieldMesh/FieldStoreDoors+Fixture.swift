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
      fixture(slices: [storeId: [deviceId: slice]])
    }

    /// The general shape: a store id → the device ids publishing into it → the
    /// bytes each one published. One `full` per slice, delivered the moment
    /// the reader listens, which is what a node sends a peer that just joined.
    ///
    /// Each slice is delivered as if by ITS OWN device — the sender's id and
    /// its addresses match what the payload claims — so the attribution
    /// refusal and the endpoint pin see exactly what a well-behaved mesh looks
    /// like. A fixture that could not pass its own checks would be testing a
    /// different program.
    public static func fixture(slices: [String: [String: Data]]) -> FieldStoreDoors {
      var byNamespace: [String: [FieldStoreInbound]] = [:]
      var peers: [FieldStorePeer] = []
      for (storeId, devices) in slices {
        let namespace = FieldStore.namespace(for: storeId)
        for (deviceId, bytes) in devices {
          let payload = JSONValue.object([
            "type": .string("full"),
            "device_id": .string(deviceId),
            "data": (try? JSONValue.parse(bytes)) ?? .null,
            "version": .int(1),
            "updated_at": .int(Int64(Date().timeIntervalSince1970 * 1000)),
          ])
          byNamespace[namespace, default: []].append(
            FieldStoreInbound(
              fromPeerId: "node-\(deviceId)", fromDeviceId: deviceId, msgType: "full",
              payload: (try? payload.encoded()) ?? Data(),
              fromAddresses: [fixtureHost(deviceId)]))
          if !peers.contains(where: { $0.deviceId == deviceId }) {
            peers.append(
              FieldStorePeer(
                id: "node-\(deviceId)", deviceId: deviceId, online: true,
                hostname: fixtureHost(deviceId), tailnetIPs: []))
          }
        }
      }
      // Bound to `let`s before the closures capture them: a `var` reaching
      // into concurrently-executing code is not sendable, and these are
      // finished being built.
      let inbox = byNamespace
      let roster = peers

      return FieldStoreDoors(
        onlinePeers: { roster },
        // The reader asks; nothing is listening, and that is honest — the
        // answer was already delivered below.
        send: { _, _, _, _ in },
        messages: { asked in
          AsyncStream { continuation in
            for inbound in inbox[asked] ?? [] { continuation.yield(inbound) }
            // Never finished: a finished stream would end the reader's loop,
            // and a paused-then-resumed link would find nothing listening.
          }
        },
        peerEvents: { AsyncStream { _ in } })
    }

    /// A fixture device's hostname, which is also what its published door must
    /// name for the endpoint pin to accept it.
    static func fixtureHost(_ deviceId: String) -> String { "127.0.0.1" }

    /// The contracts' own golden board, as it ships in this bundle.
    ///
    /// The JSON is `packages/contracts/fixtures/agent-field-slice.valid.json`
    /// copied byte for byte, so the lab draws the same five rows the decoders
    /// are tested against — one blocked on `Bash`, one working, one idle, one
    /// pending, one exited. `publishedAt`/`expiresAt` are REWRITTEN to now, and
    /// only that: a fixture minted in the past would be expired before it was
    /// read, and the expiry rule is one of the things worth looking at.
    public static func goldenBoard() -> FieldStoreDoors? {
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
      // The board names its own device; the devices store must agree, because
      // the link keys both by the same id.
      let boardDevice = board["deviceId"]?.stringValue ?? "dev-fixture"
      guard let refreshed = try? JSONValue.object(board).encoded() else { return nil }

      // THREE desktops, so every face the phone can draw has something to draw
      // it from — and none of them needs a listener:
      //   D1 the board's own device, serving a door at a dead loopback port —
      //      the store feeds its field, the door dials and fails;
      //   D2 no product endpoint at all — `noDoor`, on the mesh and not
      //      serving;
      //   D3 an endpoint and no board — dialing, then failed.
      // The ports are closed on purpose: the point is the FACES, and a fixture
      // that stood up a listener would be claiming a desktop answered.
      let devices: [String: Data] = [
        boardDevice: deviceSlice(
          deviceId: boardDevice, name: "studio", url: "ws://127.0.0.1:9/t/fixture", now: now),
        "dev-fixture-quiet": deviceSlice(
          deviceId: "dev-fixture-quiet", name: "laptop", url: nil, now: now),
        "dev-fixture-dialing": deviceSlice(
          deviceId: "dev-fixture-dialing", name: "mini", url: "ws://127.0.0.1:9/t/fixture",
          now: now),
      ]
      return fixture(slices: [
        FieldStoreID.agents: [boardDevice: refreshed],
        FieldStoreID.devices: devices,
      ])
    }

    /// One device's `field.devices.v1` slice, in the contract's shape.
    private static func deviceSlice(
      deviceId: String, name: String, url: String?, now: Int64
    ) -> Data {
      var fields: [String: JSONValue] = [
        "deviceId": .string(deviceId),
        "name": .string(name),
        "platform": .string("darwin"),
        "headless": .bool(false),
        "fielddVersion": .string("0.1.0"),
        "contractsVersion": .string("0.1.0"),
        "capabilities": .object([
          "terminalHost": .bool(true), "docHost": .bool(true), "push": .bool(false),
        ]),
        "bootId": .string("fieldd-fixture"),
        "publishedAt": .int(now),
      ]
      if let url {
        fields["productEndpoint"] = .object([
          "serve": .string("product"), "url": .string(url),
        ])
      }
      return (try? JSONValue.object(fields).encoded()) ?? Data()
    }
  }
#endif
