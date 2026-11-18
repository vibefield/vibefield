#if DEBUG || VF_WEB_RELAY
  import FieldMesh
  import FieldWeb
  import SwiftUI
  import WebKit

  // MA-5b-1 — the open app's page (DESIGN.md §8 "The open app"): SP-4's host, made when the page stands and released
  // when it goes, its only way out its own filtering front (item 522), whose dials are made from the mesh at each load
  // (`AppsFrontDials`). A failed load, or a front that stops listening, makes the page and its front once more; a
  // second failure, or a content process that ends twice, falls to the honest screen. A link the page may
  // not keep goes to Safari. Item 373: this whole file compiles only in a Debug build or with SP-4d's relay
  // (`WebShipGate`, `check:web-markers`).

  struct AppsWebPage: View {
    let url: URL
    let policy: WebNavigationPolicy
    let appId: String
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

    var body: some View {
      ZStack {
        if let host { AppsWebView(webView: host.webView) }
      }
      .task(id: loads) { await load() }
      .onChange(of: reloads) { _ = host?.webView.reload() }
      .onDisappear { letGo() }
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
        openURL(url)
      case .failed:
        if retry.failed() { loads += 1 } else { onFall(.unreachable) }
      case .ended:
        onFall(.ended)
      case .refused, .download:
        break
      }
    }

    /// Lets the page go: nothing more loads.
    private func letGo() {
      host?.release()
      host = nil
    }
  }

  /// The host's own web view, placed as it is: SwiftUI never makes another.
  private struct AppsWebView: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }

    func updateUIView(_ webView: WKWebView, context: Context) {}
  }
#endif
