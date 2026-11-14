#if DEBUG || VF_WEB_RELAY
  import WebKit

  // SP-4c (red) — the document-start script, a stub: it removes nothing.

  enum WebDocumentStart {
    static let tag = "vibefield.web-host.document-start.v1"
    static let removed: [String] = []

    static var source: String { "//# sourceURL=\(tag)\n" }

    @MainActor static func script() -> WKUserScript {
      WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: false, in: .page)
    }
  }
#endif
