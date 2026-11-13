import FieldDesign
import SwiftUI
import UIKit

// Item 362g (James's board pick, 2026-11-12 20:43Z: "images through a rosetta release"; VF-PM's rulings,
// 2026-11-13 00:24Z) — A RECORDED PICTURE, DRAWN. Where the document drew a placeholder for everything attached
// (`image shot.png on studio`), a picture the session's reader holds is drawn: a square tile in the row, and the
// picture at its full width on a sheet of its own when the tile is pressed, where a pinch zooms it. A reader
// holds pictures only for a session read straight from its desktop. Everywhere else, and for whatever is no
// picture, the placeholder stands as it always did; nothing on screen names the way a document is read.
//
// The room's strip at the phone's width (rosetta's clients/room, components/transcript/Attachments.tsx and
// styles/attachments.css), at the figures the art director ruled (2026-11-13): a square tile on the fill inside
// a hairline, 104 pt with 8 between, three across every phone. A picture on its way holds its tile's square, as
// the room's does, so a row is the height it will be when the picture lands. One thing is the phone's: the strip
// WRAPS, where the room's runs on and scrolls sideways, because a page that scrolls down does not also scroll
// across (the rule a tool line's diff follows).
//
// A picture's bytes are held by the reader, in memory and under a bound, and never by the document. What is read
// from them to draw is kept only in a view's state, so a tile that leaves the page, and a sheet that closes, let
// their picture go. A recorded picture is the adversary's as every recorded thing is (EL7): it is read by the
// system's decoder into pixels, and nothing here opens anything.
// DESIGN.md §8 "The phone's session document" (item 362g).

/// The attachments under one message, or under one group, in order: tiles side by side, wrapping, and a
/// placeholder on a row of its own.
struct HistoryPictureStrip: View {
  let attached: [HistoryAttached]
  /// This session's pictures as its reader holds them, by `HistoryPictureLayout.key`.
  let pictures: [String: HistoryPictureFace]
  /// A cell came on screen: its picture is asked for, by the attachment's id.
  let need: (String) -> Void
  /// A tile was pressed: the attachment, and the picture its tile draws.
  let open: (HistoryAttached, UIImage) -> Void

  var body: some View {
    // the layout called as a function: its init takes no content
    let flow = HistoryPictureFlow()
    flow {
      ForEach(attached) { one in
        HistoryPictureCell(
          attached: one, face: one.picture.flatMap { pictures[HistoryPictureLayout.key($0, .tile)] }, need: need,
          open: open)
      }
    }
    // the placeholder's own margins, as the document always had them: 4 above and below, and 8 between two
    .padding(.vertical, 4)
  }
}

/// A strip's layout: its cells left to right, 8 apart, on a further row where the next does not fit
/// (`HistoryPictureLayout.flow`), as Chat's acts wrap (`ChatActsLayout`, which History cannot reach: FieldHome
/// depends on it, not it on FieldHome). A tile says its own square; a placeholder takes the width it is offered,
/// and so a row.
struct HistoryPictureFlow: Layout {
  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    // a width that is not a number of points (none offered, or no bound) lays the strip out on one row
    let width: CGFloat? = proposal.width.flatMap { $0.isFinite ? $0 : nil }
    let placed = HistoryPictureLayout.flow(
      fits(subviews, within: width), width: width ?? .greatestFiniteMagnitude, gap: HistoryPictureLayout.gap)
    return CGSize(width: width ?? placed.size.width, height: placed.size.height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    let sizes = fits(subviews, within: bounds.width)
    let placed = HistoryPictureLayout.flow(sizes, width: bounds.width, gap: HistoryPictureLayout.gap)
    for (index, subview) in subviews.enumerated() {
      let origin = placed.origins[index]
      subview.place(
        at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), anchor: .topLeading,
        proposal: ProposedViewSize(sizes[index]))
    }
  }

  /// What each cell takes when it is offered the strip's width.
  private func fits(_ subviews: Subviews, within width: CGFloat?) -> [CGSize] {
    subviews.map { $0.sizeThatFits(ProposedViewSize(width: width, height: nil)) }
  }
}

/// One attachment in a strip: its tile when its picture is held and reads as one, the tile's square while the
/// picture is on its way, and else its placeholder (`HistoryPictureLayout.draws`, `side`).
struct HistoryPictureCell: View {
  let attached: HistoryAttached
  /// The tile's face as the reader holds it; nil where it holds none.
  let face: HistoryPictureFace?
  let need: (String) -> Void
  let open: (HistoryAttached, UIImage) -> Void

  @Environment(\.displayScale) private var scale
  /// The held bytes, read. View state only: a cell that leaves the page lets its picture go.
  @State private var picture: UIImage?
  /// The held bytes are no picture the phone reads.
  @State private var unreadable = false

  /// The bytes held for the tile, when they are.
  private var held: Data? {
    if case .held(let data)? = face { return data }
    return nil
  }

  /// What the held bytes read as: a picture, no picture, or nil while they are not read yet.
  private var readAs: Bool? {
    if picture != nil { return true }
    return unreadable ? false : nil
  }

  var body: some View {
    let draws = HistoryPictureLayout.draws(face, read: readAs)
    // one root under every face: the ask goes out when the cell comes on screen, and not again each time its
    // face changes, so a read that failed is asked again only when the row is next come to
    ZStack(alignment: .topLeading) {
      if let side = HistoryPictureLayout.side(draws) {
        if draws == .tile, let picture {
          tile(picture, side: side)
        } else {
          square(side)
        }
      } else {
        HistoryPlaceholderLine(words: attached.words)
      }
    }
    .onAppear {
      if let id = attached.picture { need(id) }
    }
    .task(id: held) { await readHeld() }
  }

  /// Reads the held bytes at the size a tile is drawn, off the main actor; with none held, lets the picture go.
  private func readHeld() async {
    guard let data = held else {
      picture = nil
      unreadable = false
      return
    }
    let across = HistoryPictureLayout.pixels(HistoryPictureLayout.tile, scale: scale)
    let image = await HistoryPictureDecode.image(data, across: across)
    guard !Task.isCancelled else { return }
    picture = image
    unreadable = image == nil
  }

  /// The tile: the picture filling a square on the fill, inside the hairline and at the corners of the
  /// placeholder it stands in for. Its spoken name is the placeholder's words.
  private func tile(_ image: UIImage, side: CGFloat) -> some View {
    let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
    return Button {
      open(attached, image)
    } label: {
      Image(uiImage: image)
        .resizable()
        .aspectRatio(contentMode: .fill)
        .frame(width: side, height: side)
        .background(ChromePalette.fill)
        .clipShape(shape)
        .overlay { shape.strokeBorder(ChromePalette.cardHairline, lineWidth: 0.5) }
        .contentShape(shape)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(attached.words)
    .accessibilityAddTraits(.isImage)
  }

  /// A picture on its way: the tile's own square (the fill, the corners, the hairline) with the placeholder's
  /// glyph breathing at its centre, so the row is as tall as it will be when the picture lands. Under Reduce
  /// Motion the glyph is still, and the square alone says a picture is coming: one that did not arrive is the
  /// placeholder's line. Its spoken name is the placeholder's words.
  private func square(_ side: CGFloat) -> some View {
    let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
    return shape.fill(ChromePalette.fill)
      .frame(width: side, height: side)
      .overlay {
        HistoryPictureGlyph(size: 12, waiting: true)
          .foregroundStyle(ChromePalette.inkFaint)
      }
      .overlay { shape.strokeBorder(ChromePalette.cardHairline, lineWidth: 0.5) }
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(attached.words)
  }
}

/// SP-6 — what the phone does not carry, said: `image shot.png on studio`. The placeholder's line as the document
/// always drew it, moved here from HistorySessionView.swift; its margins above and below are its strip's now.
struct HistoryPlaceholderLine: View {
  let words: String

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: "photo")
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(ChromePalette.inkFaint)
      Text(words)
        .font(ChromeType.sans(12.5))
        .foregroundStyle(ChromePalette.inkTertiary)
        // the reason an attachment has no bytes is the row's point: wrap, never cut the middle out
        .lineLimit(2)
        .truncationMode(.tail)
        .multilineTextAlignment(.leading)
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 12)
    .frame(minHeight: 34)
    .background(
      RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(ChromePalette.cardHairline, lineWidth: 0.5)
    )
    .accessibilityLabel(words)
  }
}

/// The placeholder's glyph, as a mark. While a picture is on its way it breathes as the pulse beside a running
/// line does (`LivePulse`: to 35 % and back, 1.1 s each way); still under Reduce Motion, as that is.
struct HistoryPictureGlyph: View {
  let size: CGFloat
  let waiting: Bool
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var breathing = false

  var body: some View {
    Image(systemName: "photo")
      .font(.system(size: size, weight: .medium))
      .opacity(waiting && breathing ? 0.35 : 1)
      .onChange(of: waiting, initial: true) { _, waits in
        guard waits, !reduceMotion else {
          breathing = false
          return
        }
        withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) { breathing = true }
      }
  }
}

// MARK: - The picture, on a sheet of its own

/// The picture a sheet was opened for.
struct HistoryWholePicture: Identifiable {
  /// The attachment's id in the document, `<timelineId>/<attachmentId>`.
  let id: String
  /// The placeholder's words, `image shot.png on studio`: the sheet's name, and the picture's spoken one.
  let words: String
  /// The desktop the session is on, for the line under a picture that did not arrive.
  let desktop: String
  /// The tile's picture, which stands in until the larger one is read.
  let tile: UIImage
}

/// A picture at the sheet's width: the larger size the desktop makes (at most 1,600 pixels on its long side),
/// asked for when the sheet opens, with the tile's picture standing in until it is read. The sheet is the whole
/// message's (`HistoryMessageView`): the name, `Done`, a hairline, and the page under it.
///
/// Once the larger picture is read the page is a scroll view that also zooms (`HistoryPictureScroll`): a pinch
/// takes the picture from the page's width up to four times that, a double tap goes to twice and back, a zoomed
/// picture pans, and a picture taller than the sheet scrolls as it did. The stand-in does not zoom: it is the
/// tile's square crop, and there is nothing more in it to see.
struct HistoryPictureView: View {
  let picture: HistoryWholePicture
  /// The larger picture's face as the reader holds it; nil until it is asked for.
  let face: HistoryPictureFace?
  /// Asks for the larger picture.
  let need: () -> Void

  @Environment(\.dismiss) private var dismiss
  @Environment(\.displayScale) private var scale
  /// How wide the picture is drawn when it is fitted, in points; 0 until the sheet is laid out.
  @State private var across: CGFloat = 0
  /// The larger picture, read. View state only: it goes with the sheet.
  @State private var whole: UIImage?
  /// The bytes that arrived are no picture the phone reads.
  @State private var unreadable = false

  /// The page's margins, the whole message's (`HistoryMessageView`): 20 at the sides, 16 above, 32 below.
  private static let page = EdgeInsets(top: 16, leading: 20, bottom: 32, trailing: 20)

  /// What is read and to how many pixels: the picture is read again when either changes.
  private struct Reading: Equatable {
    let data: Data?
    let across: Int
  }

  private var held: Data? {
    if case .held(let data)? = face { return data }
    return nil
  }

  /// The larger picture did not arrive, or did not read as one: the tile's stays, and the line under it says so.
  private var failed: Bool { face == .failed || unreadable }

  /// The pixels the larger picture is read to, across: what its furthest zoom can show. The decode never reads
  /// more than the picture has (`HistoryPictureLayout.longSide`), and the desktop sends at most 1,600 on the long
  /// side, so this is the whole of what was sent: at most some 10 MB of pixels, for the one picture, while its
  /// sheet is open.
  private var pixels: Int {
    HistoryPictureLayout.pixels(across * HistoryPictureLayout.zoomMost, scale: scale)
  }

  var body: some View {
    VStack(spacing: 0) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text(verbatim: picture.words)
          .font(ChromeType.sans(15, .semibold))
          .foregroundStyle(ChromePalette.ink)
          .lineLimit(1)
          .truncationMode(.middle)
        Spacer(minLength: 8)
        Button("Done") { dismiss() }
          .font(ChromeType.sans(15, .medium))
          .foregroundStyle(ChromePalette.inkSecondary)
          .frame(minWidth: 44, minHeight: 44, alignment: .trailing)
      }
      .padding(.leading, 20)
      .padding(.trailing, 16)
      .padding(.top, 14)
      Rectangle()
        .fill(ChromePalette.cardHairline)
        .frame(height: 0.5)
      if let whole {
        // the larger picture: its page scrolls as the stand-in's does, and zooms
        HistoryPictureZoom(picture: whole, words: picture.words, margins: Self.page)
          .ignoresSafeArea(edges: .bottom)
      } else {
        ScrollView {
          VStack(alignment: .leading, spacing: 10) {
            standIn
            HistoryPictureNote(
              words: failed ? "full size on \(picture.desktop)" : "Reading from \(picture.desktop)…",
              waiting: !failed)
          }
          .padding(Self.page)
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
    }
    // the sheet's width less the page's margins: how wide a fitted picture is, whichever page is up
    .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width in
      across = max(0, width - Self.page.leading - Self.page.trailing)
    }
    .onAppear(perform: need)
    .task(id: Reading(data: held, across: pixels)) { await readHeld() }
  }

  /// The tile's picture, standing in at the page's width until the larger one is read: its square, inside the
  /// tile's hairline and corners.
  private var standIn: some View {
    let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
    return Image(uiImage: picture.tile)
      .resizable()
      .aspectRatio(contentMode: .fit)
      .clipShape(shape)
      .overlay { shape.strokeBorder(ChromePalette.cardHairline, lineWidth: 0.5) }
      .accessibilityLabel(picture.words)
      .accessibilityAddTraits(.isImage)
  }

  /// Reads the held bytes to the pixels the picture's furthest zoom shows, off the main actor. With none held it
  /// keeps what it read: a picture the reader let go while its sheet is open stays on the sheet.
  private func readHeld() async {
    guard let data = held, across > 0 else { return }
    let image = await HistoryPictureDecode.image(data, across: pixels)
    guard !Task.isCancelled else { return }
    whole = image
    unreadable = image == nil
  }
}

/// The larger picture on its page, which scrolls and zooms (`HistoryPictureScroll`).
private struct HistoryPictureZoom: UIViewRepresentable {
  let picture: UIImage
  /// The picture's spoken name.
  let words: String
  /// The page's margins, outside the picture at every zoom.
  let margins: EdgeInsets

  func makeUIView(context: Context) -> HistoryPictureScroll {
    HistoryPictureScroll(
      margins: UIEdgeInsets(top: margins.top, left: margins.leading, bottom: margins.bottom, right: margins.trailing))
  }

  func updateUIView(_ page: HistoryPictureScroll, context: Context) {
    page.show(picture, spoken: words)
  }
}

/// The sheet's page for the larger picture: a scroll view that scrolls a tall picture, as the page always did,
/// and also zooms it. Fitted, the picture stands at the page's width inside the page's margins
/// (`HistoryPictureLayout.fitted`). A pinch takes it up to `zoomMost` times that; a double tap goes to `zoomTap`
/// times, about the point tapped, and back to fitted; a zoomed picture pans. The corners and the hairline keep
/// their size on screen whatever the zoom. Nothing else: no gallery, no next or previous, no control.
final class HistoryPictureScroll: UIScrollView, UIScrollViewDelegate {
  private let drawn = UIImageView()
  private let hairline = UIColor(ChromePalette.cardHairline)
  /// The width the picture was last fitted to: the fit is made again only when the page's width changes, or
  /// another picture is shown.
  private var fittedAcross: CGFloat = 0

  init(margins: UIEdgeInsets) {
    super.init(frame: .zero)
    delegate = self
    contentInset = margins
    minimumZoomScale = 1
    maximumZoomScale = HistoryPictureLayout.zoomMost
    // the page gives under a pull whatever the picture's height, as the stand-in's page does
    alwaysBounceVertical = true
    drawn.clipsToBounds = true
    drawn.layer.cornerCurve = .continuous
    drawn.isAccessibilityElement = true
    drawn.accessibilityTraits = .image
    addSubview(drawn)
    let twice = UITapGestureRecognizer(target: self, action: #selector(tappedTwice(_:)))
    twice.numberOfTapsRequired = 2
    addGestureRecognizer(twice)
    // the hairline is a layer's colour, which does not follow the appearance by itself
    registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (page: HistoryPictureScroll, _: UITraitCollection) in
      page.edge()
    }
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  /// The picture to show, and its spoken name. The same picture shown again changes nothing, so a zoom is kept
  /// through every redraw of the sheet; another picture starts fitted.
  func show(_ picture: UIImage, spoken words: String) {
    drawn.accessibilityLabel = words
    guard drawn.image !== picture else { return }
    drawn.image = picture
    fittedAcross = 0
    setNeedsLayout()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let across = bounds.width - contentInset.left - contentInset.right
    guard across > 0, across != fittedAcross, let picture = drawn.image else { return }
    fittedAcross = across
    // a picture shown anew, and a page whose width changed, start fitted: the frame is set at no zoom, and the
    // page stands at its top, the margins showing
    zoomScale = 1
    let size = HistoryPictureLayout.fitted(width: picture.size.width, height: picture.size.height, across: across)
    drawn.frame = CGRect(origin: .zero, size: size)
    contentSize = size
    contentOffset = CGPoint(x: -adjustedContentInset.left, y: -adjustedContentInset.top)
    edge()
  }

  /// The tile's corners and hairline, at the size they are on screen whatever the zoom: the layer is zoomed with
  /// its picture, so each is set smaller as the picture is drawn larger.
  private func edge() {
    let zoom = max(zoomScale, 0.1)
    drawn.layer.cornerRadius = 10 / zoom
    drawn.layer.borderWidth = 0.5 / zoom
    drawn.layer.borderColor = hairline.resolvedColor(with: traitCollection).cgColor
  }

  func viewForZooming(in scrollView: UIScrollView) -> UIView? { drawn }

  func scrollViewDidZoom(_ scrollView: UIScrollView) { edge() }

  /// A double tap: from fitted to `zoomTap` times about the point tapped, and from any zoom back to fitted. The
  /// system's own zoom animation; none under Reduce Motion.
  @objc private func tappedTwice(_ tap: UITapGestureRecognizer) {
    let moves = !UIAccessibility.isReduceMotionEnabled
    let next = HistoryPictureLayout.tapped(from: zoomScale)
    guard next > 1 else {
      setZoomScale(1, animated: moves)
      return
    }
    zoom(
      to: HistoryPictureLayout.zoomRect(around: tap.location(in: drawn), page: bounds.size, zoom: next),
      animated: moves)
  }
}

/// The quiet line under a picture on its sheet, in the cut mark's voice (`HistoryCutNote`): that the larger
/// picture is being read, or, when it did not arrive, where the full size is.
struct HistoryPictureNote: View {
  let words: String
  var waiting = false

  var body: some View {
    HStack(spacing: 6) {
      HistoryPictureGlyph(size: 10.5, waiting: waiting)
      Text(verbatim: words)
        .font(ChromeType.sans(11.5))
        .lineLimit(1)
    }
    .foregroundStyle(ChromePalette.inkFaint)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(words)
  }
}
