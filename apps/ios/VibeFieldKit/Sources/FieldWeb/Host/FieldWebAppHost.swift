#if DEBUG || VF_WEB_RELAY
  import Foundation
  import Network
  import WebKit

  // SP-4c — one made app's page on the phone (SP-4/MA-5): its own ephemeral store whose ONLY proxy is the filtering
  // front it makes for the page (`WebFront`, item 522), which holds the page's rule at every connection WebKit sends
  // through it, before any dial, and carries on what it admits by the dials it is handed (whether WebRTC or
  // WebTransport leave the page around a proxy is item 524's to measure); the app's rule list, the document-start
  // script in every frame, and every navigation, redirect, response and window put to `WebNavigationPolicy`. It logs
  // counts, never a URL, a host, a title or content. It decides no certificate: WebKit's own system evaluation does.
  // Item 373: this whole file compiles only in a Debug build or with SP-4d's relay, so a Release archive
  // without the relay carries none of it (`WebShipGate`, the archive check's markers).

  /// What the open screen hears from an app's page. `outside` carries the URL for the screen to hand to Safari; it is
  /// never logged.
  public enum WebAppEvent: Equatable, Sendable {
    case outside(URL)
    case refused(WebRefusal)
    case download
    case failed
    case ended
  }

  /// What a page did, by count only.
  public struct WebAppCounts: Equatable, Sendable {
    public var allowed = 0
    public var refused: [WebRefusal: Int] = [:]
    public var outside = 0
    public var downloads = 0
    public var popups = 0
    public var redirects = 0
    public var failures = 0
    public var deaths = 0
  }

  /// The page's navigation and window decisions, every one `WebNavigationPolicy`'s. It implements no authentication
  /// challenge, so WebKit evaluates every certificate itself. Public and not final so the TEST target's rig can
  /// subclass it (`@testable import`); the app never passes one.
  @MainActor
  public class FieldWebAppNavigation: NSObject, WKNavigationDelegate, WKUIDelegate {
    public let policy: WebNavigationPolicy
    public internal(set) var counts = WebAppCounts()
    var events: (@MainActor (WebAppEvent) -> Void)?

    public init(policy: WebNavigationPolicy) {
      self.policy = policy
    }

    /// The policy's answer for one URL, counted, and the screen told.
    func decide(_ url: URL, mainFrame: Bool) -> WKNavigationActionPolicy {
      switch policy.decide(url, mainFrame: mainFrame) {
      case .allow:
        counts.allowed += 1
        return .allow
      case .outside:
        counts.outside += 1
        events?(.outside(url))
        return .cancel
      case .refuse(let why):
        counts.refused[why, default: 0] += 1
        events?(.refused(why))
        return .cancel
      }
    }

    /// Every navigation action, in every frame, server redirects included (§2b row 1).
    public func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async
      -> WKNavigationActionPolicy
    {
      if action.shouldPerformDownload {
        counts.downloads += 1
        events?(.download)
        return .cancel
      }
      guard let url = action.request.url else { return .cancel }
      return decide(url, mainFrame: action.targetFrame?.isMainFrame ?? true)
    }

    /// A response the page cannot show, or one sent as an attachment, is a download: refused, never `.download`.
    public func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse) async
      -> WKNavigationResponsePolicy
    {
      let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")
      let attachment = disposition?.lowercased().hasPrefix("attachment") ?? false
      guard response.canShowMIMEType, !attachment else {
        counts.downloads += 1
        events?(.download)
        return .cancel
      }
      return .allow
    }

    /// A second net behind the action's own decision: the redirected URL is decided again.
    public func webView(
      _ webView: WKWebView, didReceiveServerRedirectForProvisionalNavigation navigation: WKNavigation!
    ) {
      counts.redirects += 1
      guard let url = webView.url, decide(url, mainFrame: true) == .cancel else { return }
      webView.stopLoading()
    }

    public func webView(
      _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error
    ) {
      failed(error)
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
      failed(error)
    }

    /// The page's front stopped listening after it started (iOS may reclaim a loopback listener in the background):
    /// a failed load, so the open screen reads its way out again and makes a new page and front once, then falls to
    /// its honest screen, "Can't reach ‹desktop›", in today's words.
    func frontLost() {
      counts.failures += 1
      events?(.failed)
    }

    /// A content process that dies reloads once; a second death ends the page.
    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
      counts.deaths += 1
      if counts.deaths == 1 { webView.reload() } else { events?(.ended) }
    }

    /// Popups, `target=_blank` and `window.open`: never a second web view. An allowed URL of the app's own origin
    /// loads in place.
    public func webView(
      _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction,
      windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
      counts.popups += 1
      guard let url = action.request.url, decide(url, mainFrame: true) == .allow, policy.origin.contains(url) else {
        return nil
      }
      webView.load(action.request)
      return nil
    }

    /// What an app's page gets when it asks for the camera, the microphone or both: iOS's own ask, naming the page;
    /// nothing is granted without a tap (MA-D15, 2026-11-14).
    nonisolated static func mediaCaptureDecision(_ type: WKMediaCaptureType) -> WKPermissionDecision {
      .prompt
    }

    /// Device motion and orientation were not in MA-D15's answer: denied.
    nonisolated static func motionDecision() -> WKPermissionDecision {
      .deny
    }

    public func webView(
      _ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
      initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType
    ) async -> WKPermissionDecision {
      Self.mediaCaptureDecision(type)
    }

    public func webView(
      _ webView: WKWebView, requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin,
      initiatedByFrame frame: WKFrameInfo
    ) async -> WKPermissionDecision {
      Self.motionDecision()
    }

    /// A navigation this delegate cancelled reports itself as interrupted: that is not a failure.
    private func failed(_ error: any Error) {
      let error = error as NSError
      if error.domain == "WebKitErrorDomain", error.code == 102 { return }
      if error.domain == NSURLErrorDomain, error.code == NSURLErrorCancelled { return }
      counts.failures += 1
      events?(.failed)
    }
  }

  /// One made app's page. At most one is alive (`PhoneBudget.webViews`); the open screen (5b) holds it.
  @MainActor
  public final class FieldWebAppHost {
    public enum Failure: Error, Equatable {
      /// No way out for the page (no dials, or its front did not start): no web view is made.
      case noProxy
      /// The app's rule list did not compile: nothing loads.
      case ruleList
    }

    public let webView: WKWebView
    public let navigation: FieldWebAppNavigation
    private let webFront: WebFront
    public var counts: WebAppCounts { navigation.counts }
    /// What the page's front did with its connections, by count only.
    public var front: WebFrontCounts { webFront.counts }

    /// Makes the page and its front, and loads `url`. `dials` carry on what the front admits: the origin over the
    /// mesh, a declared host by the system's own connection; nil, no page. `navigation` is the TEST target's alone.
    public static func open(
      url: URL, policy: WebNavigationPolicy, dials: WebFrontDials?, appId: String,
      navigation: FieldWebAppNavigation? = nil, events: @escaping @MainActor (WebAppEvent) -> Void
    ) async throws -> FieldWebAppHost {
      guard let dials else { throw Failure.noProxy }
      let rules: WKContentRuleList
      do {
        rules = try await ruleList(policy)
      } catch {
        throw Failure.ruleList
      }
      let front = WebFront(rule: WebFrontRule(policy: policy), dials: dials)
      let proxy: ProxyConfiguration
      do {
        proxy = try await front.start()
      } catch {
        throw Failure.noProxy
      }
      let host = FieldWebAppHost(
        policy: policy, proxy: proxy, front: front, appId: appId, rules: rules,
        navigation: navigation ?? FieldWebAppNavigation(policy: policy), events: events)
      host.webView.load(URLRequest(url: url))
      return host
    }

    private init(
      policy: WebNavigationPolicy, proxy: ProxyConfiguration, front: WebFront, appId: String,
      rules: WKContentRuleList, navigation: FieldWebAppNavigation, events: @escaping @MainActor (WebAppEvent) -> Void
    ) {
      webFront = front
      let store: WKWebsiteDataStore =
        switch WebAppStore.chosen {
        case .ephemeral: .nonPersistent()
        case .perApp: WKWebsiteDataStore(forIdentifier: WebAppStore.identifier(appId: appId))
        }
      // Failover OFF: a dead front or a dead dial fails the load, never falls back to a direct one, which with the
      // system VPN up would reach the tailnet past the front (probe5 run 1's L3x).
      var proxy = proxy
      proxy.allowFailover = false
      store.proxyConfigurations = [proxy]
      let configuration = WKWebViewConfiguration()
      configuration.websiteDataStore = store
      configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
      configuration.dataDetectorTypes = []
      configuration.mediaTypesRequiringUserActionForPlayback = .all
      configuration.userContentController.add(rules)
      configuration.userContentController.addUserScript(WebDocumentStart.script())
      webView = WKWebView(frame: .zero, configuration: configuration)
      webView.allowsLinkPreview = false
      #if DEBUG
        webView.isInspectable = ProcessInfo.processInfo.arguments.contains("-vf-web-inspect")
      #endif
      navigation.events = events
      self.navigation = navigation
      webView.navigationDelegate = navigation
      webView.uiDelegate = navigation
      front.whenLost { [weak navigation] in
        Task { @MainActor [weak navigation] in navigation?.frontLost() }
      }
    }

    deinit {
      webFront.stop()
    }

    /// Lets the page go: nothing more loads, its front stops with every tunnel, and its store goes with the view.
    public func release() {
      webView.stopLoading()
      webView.navigationDelegate = nil
      webView.uiDelegate = nil
      navigation.events = nil
      webFront.stop()
    }

    /// The app's rule list (MA-L7), looked up by its identifier, else compiled.
    static func ruleList(_ policy: WebNavigationPolicy) async throws -> WKContentRuleList {
      let reach = policy.reach.sorted()
      let identifier = WebRuleList.identifier(origin: policy.origin, reach: reach)
      guard let store = WKContentRuleListStore.default() else { throw Failure.ruleList }
      if let found = await withCheckedContinuation({ (done: CheckedContinuation<WKContentRuleList?, Never>) in
        store.lookUpContentRuleList(forIdentifier: identifier) { list, _ in done.resume(returning: list) }
      }) {
        return found
      }
      let json = WebRuleList.json(origin: policy.origin, reach: reach)
      return try await withCheckedThrowingContinuation { (done: CheckedContinuation<WKContentRuleList, any Error>) in
        store.compileContentRuleList(forIdentifier: identifier, encodedContentRuleList: json) { list, error in
          if let list { done.resume(returning: list) } else { done.resume(throwing: error ?? Failure.ruleList) }
        }
      }
    }
  }
#endif
