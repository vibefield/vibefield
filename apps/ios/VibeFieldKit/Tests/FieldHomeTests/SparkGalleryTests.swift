#if DEBUG
  import FieldDesign
  import Testing

  @testable import FieldHome

  /// IOS-12e (its plan's §4, ruled (a) by VF-PM 07:52Z) — the spark gallery's flag, which the stills script launches
  /// the app with: a look, scrolled or not, and reduced motion, which simctl cannot turn on. A value it does not know
  /// opens nothing, so a typo in a script is the app, not a page that looks right.
  @Suite("IOS-12e — the spark gallery's flags (DEBUG)")
  struct SparkGalleryTests {
    @Test("the flag opens the gallery in a look, scrolled or not, and reduced motion is its own flag")
    func request() throws {
      let bare = try #require(SparkGalleryRequest(arguments: ["app", "-vf-spark-gallery"]))
      #expect(bare == SparkGalleryRequest(look: .auto, scrolled: false, reduceMotion: false))
      let dark = try #require(SparkGalleryRequest(arguments: ["app", "-vf-spark-gallery=dark", "-vf-reduce-motion"]))
      #expect(dark == SparkGalleryRequest(look: .dark, scrolled: false, reduceMotion: true))
      let scrolled = try #require(SparkGalleryRequest(arguments: ["app", "-vf-spark-gallery-scrolled=light"]))
      #expect(scrolled == SparkGalleryRequest(look: .light, scrolled: true, reduceMotion: false))
      #expect(SparkGalleryRequest.reducesMotion(["app", "-vf-mock", "-vf-reduce-motion"]))
    }

    @Test("no flag, or a value it does not know, opens nothing")
    func nothing() {
      for arguments in [
        ["app"], ["app", "-vf-mock"], ["app", "-vf-spark-gallery=dusk"], ["app", "-vf-spark-gallery-scroll"],
        ["app", "-vf-spark-galleryX"],
      ] {
        #expect(SparkGalleryRequest(arguments: arguments) == nil, "\(arguments)")
      }
    }
  }
#endif
