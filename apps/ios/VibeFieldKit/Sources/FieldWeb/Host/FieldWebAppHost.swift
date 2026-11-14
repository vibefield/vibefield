#if DEBUG || VF_WEB_RELAY
  import Foundation
  import Network
  import WebKit

  // SP-4c (red) — the app web host, a stub that fences nothing: every navigation allowed, every response shown, a
  // popup loaded in place undecided, no rule list, no script, and a page made without a proxy.

  public enum WebAppEvent: Equatable, Sendable {
    case outside(URL)
    case refused(WebRefusal)
    case download
    case failed
    case ended
  }

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

  @MainActor
  public class FieldWebAppNavigation: NSObject, WKNavigationDelegate, WKUIDelegate {
    public let policy: WebNavigationPolicy
    public internal(set) var counts = WebAppCounts()
    var events: (@MainActor (WebAppEvent) -> Void)?

    public init(policy: WebNavigationPolicy) {
      self.policy = policy
    }

    public func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async
      -> WKNavigationActionPolicy
    {
      counts.allowed += 1
      return .allow
    }

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
      withError error: any Error)
    {
      counts.failures += 1
      events?(.failed)
    }

    public func webView(
      _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction,
      windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
      counts.popups += 1
      webView.load(action.request)
      return nil
    }
  }

  @MainActor
  public final class FieldWebAppHost {
    public enum Failure: Error, Equatable {
      case noProxy
      case ruleList
    }

    public let webView: WKWebView
    public let navigation: FieldWebAppNavigation
    public var counts: WebAppCounts { navigation.counts }

    public static func open(
      url: URL, policy: WebNavigationPolicy, proxy: ProxyConfiguration?, appId: String,
      navigation: FieldWebAppNavigation? = nil, events: @escaping @MainActor (WebAppEvent) -> Void
    ) async throws -> FieldWebAppHost {
      let host = FieldWebAppHost(proxy: proxy, navigation: navigation ?? FieldWebAppNavigation(policy: policy))
      host.navigation.events = events
      host.webView.load(URLRequest(url: url))
      return host
    }

    private init(proxy: ProxyConfiguration?, navigation: FieldWebAppNavigation) {
      let store = WKWebsiteDataStore.nonPersistent()
      if let proxy { store.proxyConfigurations = [proxy] }
      let configuration = WKWebViewConfiguration()
      configuration.websiteDataStore = store
      webView = WKWebView(frame: .zero, configuration: configuration)
      self.navigation = navigation
      webView.navigationDelegate = navigation
      webView.uiDelegate = navigation
    }

    public func release() {}
  }
#endif
