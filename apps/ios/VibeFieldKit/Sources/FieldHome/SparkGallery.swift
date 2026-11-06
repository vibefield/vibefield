#if DEBUG
  import FieldDesign
  import FieldProduct
  import SwiftUI

  // IOS-12e (its plan's §4, ruled (a) by VF-PM 07:52Z) — THE SPARK GALLERY, a DEBUG page for the stills, never in
  // Release. Under `-vf-mock` the phone's Chat list holds only an asking spark and two asleep ones, so no face there is
  // live. This page shows every status that list can say, live beside still. It mounts the SHIPPING `SparkFaceView` on
  // one `SparkStageHost` (docs/UI_SYSTEM.md: the shipping view under a fixture, never a copy), so what it shows is what
  // a row draws. The fixture is only the seed, the statuses and the sizes.
  // - A row of the list is 48 on the paper. A thread's head is 30 (on the glass, whose ground is the paper under it).
  // - One seed (4211, the 48 stills golden's) keeps each face beside its golden.
  // - `-vf-spark-time=1.7` holds the stage's clock; `-vf-spark-flat` asks for the flat star; `-vf-reduce-motion`
  //   stands in for the setting, which simctl cannot turn on.

  /// `-vf-spark-gallery[-scrolled][=light|dark|auto]`: the gallery instead of the app; bare, it wears the system's
  /// look. `-scrolled` puts its rows in a short scroll view, scrolled half a row, so faces are cut at both of its edges
  /// (row 29's clip). Any other value opens nothing.
  struct SparkGalleryRequest: Equatable, Sendable {
    var look: PhoneAppearance
    var scrolled: Bool
    var reduceMotion: Bool

    static let argument = "-vf-spark-gallery"
    static let scrolledSuffix = "-scrolled"
    /// The whole app under reduced motion, the gallery or not (HomeRoot reads it).
    static let reduceMotionArgument = "-vf-reduce-motion"

    static func reducesMotion(_ arguments: [String]) -> Bool {
      arguments.contains(reduceMotionArgument)
    }
  }

  // in an extension, so the memberwise init stays (the rows build requests with it)
  extension SparkGalleryRequest {
    init?(arguments: [String]) {
      guard let argument = arguments.last(where: { $0.hasPrefix(Self.argument) }) else { return nil }
      var rest = argument.dropFirst(Self.argument.count)
      let scrolled = rest.hasPrefix(Self.scrolledSuffix)
      if scrolled { rest = rest.dropFirst(Self.scrolledSuffix.count) }
      let look: PhoneAppearance
      if rest.isEmpty {
        look = .auto
      } else if rest.first == "=", let named = PhoneAppearance(rawValue: String(rest.dropFirst())) {
        look = named
      } else {
        return nil
      }
      self.init(look: look, scrolled: scrolled, reduceMotion: Self.reducesMotion(arguments))
    }
  }

  struct SparkGallery: View {
    let request: SparkGalleryRequest
    @State private var position: ScrollPosition

    /// The statuses the phone's list can say: what `SparkEntries.status(of:own:agents:items:)` yields, and no other.
    static let statuses: [SparkStatus] = [.hello, .ready, .thinking, .running, .asking, .approval, .stuck, .sleeping]
    static let seed: UInt32 = 4211
    /// A list row's face, then a thread's head.
    static let sizes: [CGFloat] = [ChatRow.face, 30]
    static let row: CGFloat = 64
    static let column: CGFloat = 56

    init(request: SparkGalleryRequest) {
      self.request = request
      _position = State(initialValue: ScrollPosition(y: request.scrolled ? Self.row / 2 : 0))
    }

    var body: some View {
      SparkStageHost {
        VStack(alignment: .leading, spacing: 0) {
          header
          heads
          edge
          ScrollView {
            VStack(spacing: 0) {
              ForEach(Self.statuses, id: \.self) { status in
                line(status)
              }
            }
          }
          .scrollPosition($position)
          // scrolled: four rows and a quarter, so a face is cut at the bottom edge whether or not the half-row
          // offset took, and at the top edge when it did
          .frame(height: request.scrolled ? Self.row * 4.25 : nil)
          edge
          Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(ChromePalette.paper.ignoresSafeArea())
      }
      .phoneAppearance(request.look)
    }

    private var header: some View {
      VStack(alignment: .leading, spacing: 4) {
        Text("Spark faces")
          .font(ChromeType.sans(28, .bold))
          .foregroundStyle(ChromePalette.ink)
        Text(caption)
          .font(ChromeType.sans(13))
          .foregroundStyle(ChromePalette.inkSecondary)
          .fixedSize(horizontal: false, vertical: true)
      }
      .padding(.horizontal, 16)
      .padding(.top, 8)
      .padding(.bottom, 12)
    }

    /// What this page shows, and under which flags.
    private var caption: String {
      let arguments = ProcessInfo.processInfo.arguments
      var parts = [
        "The list's eight statuses, seed \(Self.seed): live beside still, at 48 (a row) and 30 (a thread's head)"
      ]
      if let held = SparkStage.heldTime(arguments) { parts.append("held at \(held) s") }
      if arguments.contains("-vf-spark-flat") { parts.append("the flat star asked for") }
      if request.reduceMotion { parts.append("reduced motion") }
      if request.scrolled { parts.append("scrolled half a row") }
      return parts.joined(separator: " · ")
    }

    private var heads: some View {
      HStack(spacing: 0) {
        Text("Status")
          .frame(maxWidth: .infinity, alignment: .leading)
        ForEach(Self.sizes, id: \.self) { size in
          Text("\(Int(size)) live")
            .frame(width: Self.column)
          Text("\(Int(size)) still")
            .frame(width: Self.column)
        }
      }
      .font(ChromeType.sans(12, .medium))
      .foregroundStyle(ChromePalette.inkTertiary)
      .padding(.horizontal, 16)
      .frame(height: 24)
    }

    /// The scroll view's edge, drawn where it is cut.
    private var edge: some View {
      Rectangle()
        .fill(ChromePalette.separator)
        .frame(height: 1)
        .opacity(request.scrolled ? 1 : 0)
    }

    private func line(_ status: SparkStatus) -> some View {
      HStack(spacing: 0) {
        VStack(alignment: .leading, spacing: 2) {
          Text(status.word)
            .font(ChromeType.sans(15, .semibold))
            .foregroundStyle(ChromePalette.ink)
          // the list's own choice (`ChatRow.atWork`): only these move there
          Text(ChatRow.atWork.contains(status) ? "live in the list" : "a still in the list")
            .font(ChromeType.sans(12))
            .foregroundStyle(ChromePalette.inkTertiary)
        }
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .leading)
        ForEach(Self.sizes, id: \.self) { size in
          SparkFaceView(seed: Self.seed, status: status.rawValue, size: size, live: true)
            .frame(width: Self.column, height: Self.row)
          SparkFaceView(seed: Self.seed, status: status.rawValue, size: size, live: false)
            .frame(width: Self.column, height: Self.row)
        }
      }
      .padding(.horizontal, 16)
      .frame(height: Self.row)
    }
  }
#endif
