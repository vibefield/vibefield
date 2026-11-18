#if DEBUG || VF_WEB_RELAY
  import FieldMesh
  import FieldWeb
  import SwiftUI
  import WebKit

  // MA-5b-1 — the open app's page (DESIGN.md §8 "The open app"): SP-4's host, made when the page stands and released
  // when it goes, its only way out its own filtering front (item 522), whose dials are made from the mesh at each load
  // (`AppsFrontDials`). A failed load, or a front that stops listening, makes the page and its front once more; a
  // second failure, or a content process that ends twice, falls to the honest screen. A link the page may
  // not keep goes to Safari, but only after the person's touch and their yes (item 523, `AppsLinkOut`). Item 373: this
  // whole file compiles only in a Debug build or with SP-4d's relay (`WebShipGate`, `check:web-markers`).

  struct AppsWebPage: View {
    let url: URL
    let policy: WebNavigationPolicy
    let appId: String
    /// The app's title, for the link out's ask.
    let title: String
    /// The mesh the front's dials are made from, again at each load.
    let mesh: MeshModel
    /// ···'s Reload: each new number loads the page again.
    let reloads: Int
    let onFall: (AppsPageFall) -> Void

    @Environment(\.openURL) private var openURL
    @State private var host: FieldWebAppHost?
    @State private var retry = AppsPageRetry()
    /// Each load's number: a new one makes the host and its front again.
    @State private var loads = 0
    /// Item 523 — the person's touches, and whether an ask stands.
    @State private var linkOut = AppsLinkOut()
    @State private var asking: AppsLinkOutAsk?

    var body: some View {
      ZStack {
        if let host {
          AppsWebView(
            webView: host.webView, began: { linkOut.began() },
            lifted: { linkOut.lifted(at: ContinuousClock().now) })
        }
      }
      .task(id: loads) { await load() }
      .onChange(of: reloads) { _ = host?.webView.reload() }
      .onDisappear { letGo() }
      .confirmationDialog(
        AppsLinkOut.title(site: asking?.site ?? ""), isPresented: askingShows, titleVisibility: .visible,
        presenting: asking
      ) { ask in
        Button(AppsLinkOut.open) {
          answered()
          openURL(ask.url)
        }
        Button(AppsLinkOut.cancel, role: .cancel) { answered() }
      } message: { _ in
        Text(AppsLinkOut.line(app: title))
      }
    }

    /// The ask stands while `asking` does; the sheet going away is a Cancel.
    private var askingShows: Binding<Bool> {
      Binding(get: { asking != nil }, set: { if !$0 { answered() } })
    }

    private func load() async {
      letGo()
      let dials = await AppsFrontDials.from(mesh)
      do {
        let made = try await FieldWebAppHost.open(url: url, policy: policy, dials: dials, appId: appId) { heard($0) }
        guard !Task.isCancelled else {
          made.release()
          return
        }
        host = made
      } catch FieldWebAppHost.Failure.noProxy {
        onFall(.noProxy)
      } catch {
        onFall(.ruleList)
      }
    }

    private func heard(_ event: WebAppEvent) {
      switch event {
      case .outside(let url):
        // Item 523: only on an unspent touch of the person's, and never without their yes.
        guard let site = AppsSite.of(url), linkOut.asks(at: ContinuousClock().now) else { return }
        asking = AppsLinkOutAsk(url: url, site: site)
      case .failed:
        if retry.failed() { loads += 1 } else { onFall(.unreachable) }
      case .ended:
        onFall(.ended)
      case .refused, .download:
        break
      }
    }

    private func answered() {
      linkOut.answered()
      asking = nil
    }

    /// Lets the page go: nothing more loads.
    private func letGo() {
      host?.release()
      host = nil
    }
  }

  /// The host's own web view, placed as it is: SwiftUI never makes another. It wears the one touch watcher.
  private struct AppsWebView: UIViewRepresentable {
    let webView: WKWebView
    let began: () -> Void
    let lifted: () -> Void

    func makeUIView(context: Context) -> WKWebView {
      for watcher in webView.gestureRecognizers ?? [] where watcher is AppsTouchWatcher {
        webView.removeGestureRecognizer(watcher)
      }
      webView.addGestureRecognizer(AppsTouchWatcher.make(began: began, lifted: lifted))
      return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
  }
#endif
