import Foundation
import Network
import Testing
import WebKit

@testable import FieldWeb

/// SP-4c's host rows (SP-4/MA-5), on a simulator, each red first. The page's ONLY way out
/// is the rig's stand-in proxy, which counts CONNECTs by name class and refuses all but the origin and the one
/// declared host; the origin and the declared host are loopback HTTPS servers with the rig's test identity, which
/// only the test target's `RigNavigation` trusts. The W rows come first: the rig is read from their answers, never
/// guessed. R9's loopback literals go to counting traps instead (`RigTrap`): WebKit sends a loopback address around
/// its proxy (route B's P1a-ip, 2026-11-14), so the content rule list is the only fence there.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@MainActor
@Suite("SP-4c — the app web host, on loopback", .serialized, .timeLimit(.minutes(2)))
struct HostRowsTests {
  nonisolated static let originName = "studio.tail1234.ts.net"
  nonisolated static let declaredName = "declared.example"
  nonisolated static let root = "https://\(originName):13377"
  nonisolated static let undeclared = "https://undeclared.example.org"
  nonisolated static let tailnetOther = "https://other.tail1234.ts.net:13377"

  /// The origin's pages, by path.
  nonisolated static let pages: [String: RigServer.Answer] = [
    "/": .page("<html><head></head><body>ok</body></html>"),
    "/to-tailnet": .redirect("\(tailnetOther)/"),
    "/to-tailnet-img": .redirect("\(tailnetOther)/x.png"),
    "/r1-frame": .page("<html><head></head><body><iframe src=\"/to-tailnet\"></iframe></body></html>"),
    // R2 and R2b: the main frame, a same-origin frame and a srcdoc frame.
    "/r2": .page(
      "<html><head></head><body><iframe id=\"a\" src=\"/\"></iframe><iframe id=\"b\" srcdoc=\"<p>x</p>\"></iframe>"
        + "</body></html>"),
    "/r3": .page(
      "<html><head></head><body><img src=\"/to-tailnet-img\"><img src=\"\(undeclared)/x.png\">"
        + "<img src=\"https://\(declaredName)/x.png\"></body></html>"),
    "/r4": .page(
      "<html><head></head><body><a id=\"go\" target=\"_blank\" href=\"\(undeclared)/\">go</a></body></html>"),
    "/download": RigServer.Answer(
      headers: ["Content-Type": "application/octet-stream", "Content-Disposition": "attachment; filename=\"x.bin\""],
      body: "x"),
    "/r5": .page("<html><head></head><body><a id=\"go\" download href=\"/file.bin\">go</a></body></html>"),
    "/file.bin": RigServer.Answer(headers: ["Content-Type": "application/octet-stream"], body: "x"),
    "/r7": .page("<html><head></head><body><a id=\"go\" ping=\"\(undeclared)/p\" href=\"/\">go</a></body></html>"),
  ]

  /// One rig: the stand-in proxy, the origin and the declared host. Stopped by `stop()`.
  final class Rig {
    let proxy: RigProxy
    let origin: RigServer
    let declared: RigServer
    let proxyPort: UInt16

    /// `extra`: pages only one row serves (R9's, which name its traps' ports), over the shared table.
    init(extra: [String: RigServer.Answer] = [:]) throws {
      let identity = try RigIdentity.load().identity
      origin = RigServer(identity: identity, table: HostRowsTests.pages.merging(extra) { _, row in row })
      declared = RigServer(identity: identity, table: ["/x.png": .init(headers: ["Content-Type": "image/png"])])
      let originPort = try origin.start()
      let declaredPort = try declared.start()
      proxy = RigProxy(
        originName: HostRowsTests.originName,
        routes: [HostRowsTests.originName: originPort, HostRowsTests.declaredName: declaredPort])
      proxyPort = try proxy.start()
    }

    var configuration: ProxyConfiguration { proxyAt(proxyPort) }

    func proxyAt(_ port: UInt16) -> ProxyConfiguration {
      let configuration = ProxyConfiguration(
        socksv5Proxy: .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port) ?? 9))
      configuration.applyCredential(username: proxy.user, password: proxy.password)
      return configuration
    }

    func stop() {
      proxy.stop()
      origin.stop()
      declared.stop()
    }
  }

  static var policy: WebNavigationPolicy {
    WebNavigationPolicy(origin: WebOrigin(claim: root)!, reach: [declaredName])
  }

  /// Opens `path` on the origin through `proxy`, with the rig's trust, and waits for the page to settle.
  func open(_ path: String, proxy: ProxyConfiguration?, events: @escaping @MainActor (WebAppEvent) -> Void = { _ in })
    async throws -> FieldWebAppHost
  {
    let pinned = try #require(RigIdentity.pinned)
    let navigation = RigNavigation(policy: Self.policy, pinned: pinned)
    let url = try #require(URL(string: Self.root + path))
    let host = try await FieldWebAppHost.open(
      url: url, policy: Self.policy, proxy: proxy, appId: String(repeating: "a", count: 64), navigation: navigation,
      events: events)
    try await settle(host.webView)
    return host
  }

  func settle(_ view: WKWebView, _ extra: Duration = .milliseconds(300)) async throws {
    let clock = ContinuousClock()
    let deadline = clock.now + .seconds(10)
    while view.isLoading, clock.now < deadline { try await Task.sleep(for: .milliseconds(50)) }
    try await Task.sleep(for: extra)
  }

  func page(_ view: WKWebView, _ body: String) async throws -> [String: Any] {
    let answer = try await view.callAsyncJavaScript(body, contentWorld: .page)
    return answer as? [String: Any] ?? [:]
  }

  // MARK: - W: the rig, read before any row leans on it

  @Test("W1 + W3: a page loads in this test process, through the stand-in, as its origin", .rigMade)
  func w1() async throws {
    let rig = try Rig()
    defer { rig.stop() }
    let host = try await open("/", proxy: rig.configuration)
    let read = try await page(host.webView, "return { body: document.body.textContent };")
    let body = read["body"] as? String
    #expect(body == "ok")
    let origins = rig.proxy.count(.origin)
    #expect(origins >= 1)
  }

  @Test("W2: the test identity was made for this run, imports, and a TLS listener serves with it")
  func w2() throws {
    guard RigIdentity.made else {
      print("SP4C-W2 not made")
      Issue.record(Comment(rawValue: RigIdentity.notMade))
      return
    }
    let identity = try RigIdentity.load().identity
    let server = RigServer(identity: identity, table: [:])
    let port = try server.start()
    server.stop()
    #expect(port > 0)
    #expect(RigIdentity.pinned != nil)
  }

  @Test("W4: the stand-in replies ONCE per CONNECT; a far side failing after it closes the tunnel, adding nothing")
  func w4() async throws {
    let resetPort = try RigReset.start()
    let proxy = RigProxy(originName: Self.originName, routes: ["reset.example": resetPort])
    let proxyPort = try proxy.start()
    defer { proxy.stop() }
    let heard = try await RigSocksClient.connect(
      port: proxyPort, user: proxy.user, password: proxy.password, name: "reset.example", waitSeconds: 2)
    try await Task.sleep(for: .milliseconds(300))
    let replies = proxy.replyCounts()
    print("SP4C-W4 code=\(heard.code) after=\(heard.after) replies=\(replies)")
    #expect(heard.code == 0)
    #expect(heard.after == 0)
    #expect(replies == [1])
  }

  // MARK: - R: §2b's seven, and R8

  @Test("R1: every navigation action is decided, redirects included: a link into the tailnet goes nowhere", .rigMade)
  func r1() async throws {
    let rig = try Rig()
    defer { rig.stop() }
    let top = try await open("/to-tailnet", proxy: rig.configuration)
    let frame = try await open("/r1-frame", proxy: rig.configuration)
    let refusedTop = top.counts.refused[.tailnetOffOrigin, default: 0]
    let refusedFrame = frame.counts.refused[.tailnetOffOrigin, default: 0]
    #expect(refusedTop >= 1)
    #expect(refusedFrame >= 1)
    let reached = rig.proxy.count(.tailnetOther)
    #expect(reached == 0)
  }

  /// MA-D14 (2026-11-14: WebRTC as on any website). A PIN of that ruling, green from the
  /// red commit on: an app's own view keeps WebRTC as any website has it, so a later block shows red here.
  @Test("R2: WebRTC is there, as any website has it: the main frame and a same-origin frame", .rigMade)
  func r2() async throws {
    let rig = try Rig()
    defer { rig.stop() }
    let host = try await open("/r2", proxy: rig.configuration)
    let read = try await page(
      host.webView,
      """
      const read = (w) => { try { return typeof w.RTCPeerConnection; } catch (_) { return "denied"; } };
      return { main: typeof RTCPeerConnection, same: read(document.getElementById("a").contentWindow) };
      """)
    let main = read["main"] as? String ?? "absent"
    let same = read["same"] as? String ?? "absent"
    print("SP4C-R2 main=\(main) same=\(same)")
    #expect(main == "function")
    #expect(same == "function")
  }

  /// WebTransport and `navigator.mediaDevices` stand as on any website (MA-D15, 2026-11-14).
  /// `sendBeacon` stays stubbed (reach, not that question): in the main frame, a same-origin and a srcdoc frame.
  @Test("R2b: WebTransport and the camera and microphone's door stand as on any website, sendBeacon sends nothing",
    .rigMade)
  func r2b() async throws {
    let rig = try Rig()
    defer { rig.stop() }
    let host = try await open("/r2", proxy: rig.configuration)
    let read = try await page(
      host.webView,
      """
      const read = (w) => {
        try {
          return [typeof w.WebTransport, typeof w.navigator.mediaDevices, String(w.navigator.sendBeacon("/b", "x"))];
        } catch (_) { return ["denied", "denied", "denied"]; }
      };
      const out = {};
      const frames = { main: window, same: document.getElementById("a").contentWindow,
        srcdoc: document.getElementById("b").contentWindow };
      for (const [k, w] of Object.entries(frames)) {
        const [t, m, b] = read(w);
        out[k + "Transport"] = t; out[k + "Media"] = m; out[k + "Beacon"] = b;
      }
      return out;
      """)
    let said = ["main", "same", "srcdoc"].map { frame in
      ["Transport", "Media", "Beacon"].map { "\(frame)\($0)=\(read[frame + $0] as? String ?? "absent")" }
        .joined(separator: " ")
    }.joined(separator: " ")
    print("SP4C-R2b \(said)")
    for frame in ["main", "same", "srcdoc"] {
      let transport = read[frame + "Transport"] as? String
      let media = read[frame + "Media"] as? String
      let beacon = read[frame + "Beacon"] as? String
      #expect(transport == "function", "\(frame)")
      #expect(media == "object", "\(frame)")
      #expect(beacon == "false", "\(frame)")
    }
  }

  /// A page asking for the camera, the microphone or both gets iOS's own ask; nothing is granted without a tap
  /// (MA-D15, 2026-11-14).
  /// Device motion was not asked about and stays denied.
  @Test("R2c: a page asking for the camera or the microphone gets iOS's own ask; device motion stays denied")
  func r2c() {
    let camera = FieldWebAppNavigation.mediaCaptureDecision(.camera)
    let microphone = FieldWebAppNavigation.mediaCaptureDecision(.microphone)
    let both = FieldWebAppNavigation.mediaCaptureDecision(.cameraAndMicrophone)
    let motion = FieldWebAppNavigation.motionDecision()
    print(
      "SP4C-R2c camera=\(camera.rawValue) microphone=\(microphone.rawValue) both=\(both.rawValue)"
        + " motion=\(motion.rawValue)")
    #expect(camera == .prompt)
    #expect(microphone == .prompt)
    #expect(both == .prompt)
    #expect(motion == .deny)
  }

  @Test("R3: a subresource redirected into the tailnet, and one to an undeclared host, never reach out", .rigMade)
  func r3() async throws {
    let rig = try Rig()
    defer { rig.stop() }
    _ = try await open("/r3", proxy: rig.configuration)
    try await Task.sleep(for: .seconds(1))
    let tailnet = rig.proxy.count(.tailnetOther)
    let undeclared = rig.proxy.count(.undeclared)
    let declared = rig.proxy.count(.declared)
    #expect(tailnet == 0)
    #expect(undeclared == 0)
    #expect(declared >= 1)
  }

  @Test("R4: popups and window.open make no second web view, and an undeclared one reaches nothing", .rigMade)
  func r4() async throws {
    let rig = try Rig()
    defer { rig.stop() }
    let host = try await open("/r4", proxy: rig.configuration)
    _ = try await page(
      host.webView,
      "document.getElementById('go').click(); window.open('\(Self.undeclared)/', '_blank'); return {};")
    try await Task.sleep(for: .seconds(1))
    let undeclared = rig.proxy.count(.undeclared)
    #expect(undeclared == 0)
    print("SP4C-R4 popups=\(host.counts.popups)")
  }

  @Test("R5: an attachment and an <a download> are cancelled: no file", .rigMade)
  func r5() async throws {
    let rig = try Rig()
    defer { rig.stop() }
    let attachment = try await open("/download", proxy: rig.configuration)
    let link = try await open("/r5", proxy: rig.configuration)
    _ = try await page(link.webView, "document.getElementById('go').click(); return {};")
    try await settle(link.webView)
    let first = attachment.counts.downloads
    let second = link.counts.downloads
    #expect(first == 1)
    #expect(second == 1)
  }

  @Test("R6: no service worker registers", .rigMade)
  func r6() async throws {
    let rig = try Rig()
    defer { rig.stop() }
    let host = try await open("/", proxy: rig.configuration)
    let read = try await page(
      host.webView,
      """
      if (!navigator.serviceWorker) return { worker: "absent" };
      try { await navigator.serviceWorker.register("/sw.js"); return { worker: "registered" }; }
      catch (_) { return { worker: "rejected" }; }
      """)
    let worker = read["worker"] as? String
    #expect(worker == "absent" || worker == "rejected")
  }

  @Test("R7: <a ping> and sendBeacon to an undeclared host reach nothing", .rigMade)
  func r7() async throws {
    let rig = try Rig()
    defer { rig.stop() }
    let host = try await open("/r7", proxy: rig.configuration)
    _ = try await page(
      host.webView,
      "navigator.sendBeacon('\(Self.undeclared)/b', 'x'); document.getElementById('go').click(); return {};")
    try await Task.sleep(for: .seconds(1))
    let undeclared = rig.proxy.count(.undeclared)
    #expect(undeclared == 0)
  }

  @Test("R8: a dead proxy fails the load; no proxy, no web view; no link preview; counts carry no words", .rigMade)
  func r8() async throws {
    let rig = try Rig()
    defer { rig.stop() }
    final class Heard { var failed = 0 }
    let heard = Heard()
    let dead = try await open("/", proxy: rig.proxyAt(9), events: { if $0 == .failed { heard.failed += 1 } })
    let reachedDead = dead.counts.allowed
    let failed = heard.failed
    #expect(failed >= 1)
    #expect(reachedDead >= 1)
    await #expect(throws: FieldWebAppHost.Failure.noProxy) {
      _ = try await open("/", proxy: nil)
    }
    #expect(dead.webView.allowsLinkPreview == false)
    // Failover off, read back off the live view: the rig cannot see a fallback (a fake name fails direct anyway).
    let failover = dead.webView.configuration.websiteDataStore.proxyConfigurations.first?.allowFailover
    #expect(failover == false)
    let strings = Mirror(reflecting: WebAppCounts()).children.filter { $0.value is String || $0.value is URL }
    #expect(strings.isEmpty)
  }

  @Test("R9: loads to loopback and address literals, plain, behind userinfo or redirected, reach nothing", .rigMade)
  func r9() async throws {
    let trap = try RigTrap(["plain4", "plain6", "img", "xhr", "fetch", "ws", "redirect"])
    defer { trap.stop() }
    let rig = try Rig(extra: [
      "/to-loopback": .redirect("https://127.0.0.1:\(trap.port("redirect"))/r.png"),
      "/r9": .page(Self.r9Page(trap)),
    ])
    defer { rig.stop() }
    _ = try await open("/r9", proxy: rig.configuration)
    try await Task.sleep(for: .milliseconds(1500))
    let said = trap.labels.map { "\($0)=\(trap.count($0))" }.joined(separator: " ")
    let address = rig.proxy.count(.address)
    let undeclared = rig.proxy.count(.undeclared)
    let tailnet = rig.proxy.count(.tailnetOther)
    print("SP4C-R9 \(said) address=\(address) undeclared=\(undeclared) tailnet=\(tailnet)")
    for label in trap.labels {
      let reached = trap.count(label)
      #expect(reached == 0, "\(label)")
    }
    #expect(address == 0)
    #expect(undeclared == 0)
    #expect(tailnet == 0)
    // The page ran: its declared image went out through the stand-in, and the redirect was asked of the origin.
    let declared = rig.proxy.count(.declared)
    let redirect = rig.origin.asked("/to-loopback")
    #expect(declared >= 1)
    #expect(redirect >= 1)
  }

  /// R9's page: every load to a loopback or address literal it can make — plainly, behind a declared name's userinfo
  /// (`https://declared.example:x@127.0.0.1/`, whose host is the address), and by a same-origin redirect — each kind to
  /// its own trap, and one load to the declared host, so a zero is a refusal, not a page that never ran.
  static func r9Page(_ trap: RigTrap) -> String {
    let named = "https://\(declaredName):x@"
    let p4 = trap.port("plain4")
    let p6 = trap.port("plain6")
    let plain = [
      "https://127.0.0.1:\(p4)/", "http://127.0.0.1:\(p4)/", "http://127.1:\(p4)/", "http://2130706433:\(p4)/",
      "http://localhost:\(p4)/", "http://[::ffff:127.0.0.1]:\(p4)/", "https://[::1]:\(p6)/", "http://[::1]:\(p6)/",
    ]
    let list = plain.map { "\"\($0)\"" }.joined(separator: ",")
    let img = "\(named)127.0.0.1:\(trap.port("img"))/i.png"
    let xhr = "\(named)127.0.0.1:\(trap.port("xhr"))/x"
    let fetch = "\(named)127.0.0.1:\(trap.port("fetch"))/f"
    let ws = "wss://\(declaredName):x@127.0.0.1:\(trap.port("ws"))/w"
    let address = "\(named)100.101.102.103:13377/a.png"
    let undeclared = "\(named)undeclared.example.org/u.png"
    let tailnet = "\(named)other.tail1234.ts.net:13377/t.png"
    return """
      <html><head></head><body><img src="https://\(declaredName)/x.png"><img src="/to-loopback"><script>
      for (const t of [\(list)]) {
        new Image().src = t + "i.png";
        fetch(t + "f").catch(() => {});
        try { const x = new XMLHttpRequest(); x.open("GET", t + "x"); x.send(); } catch (_) {}
        try { new WebSocket(t.replace("http", "ws") + "w"); } catch (_) {}
      }
      new Image().src = "\(img)";
      try { const x = new XMLHttpRequest(); x.open("GET", "\(xhr)"); x.send(); } catch (_) {}
      fetch("\(fetch)").catch(() => {});
      try { new WebSocket("\(ws)"); } catch (_) {}
      new Image().src = "\(address)";
      new Image().src = "\(undeclared)";
      new Image().src = "\(tailnet)";
      </script></body></html>
      """
  }
}

extension Trait where Self == ConditionTrait {
  /// Runs a row only when this run was handed the rig's identity; otherwise skips it BY NAME, never as a pass.
  static var rigMade: Self { .enabled(if: RigIdentity.made, Comment(rawValue: RigIdentity.notMade)) }
}
