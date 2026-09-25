import AppKit

enum Tool: Equatable {
    case none
    case rectangle
    case ellipse
    case arrow
    case pen
    case mosaic
}

struct Annotation {
    var tool: Tool
    var start: CGPoint
    var end: CGPoint
    var points: [CGPoint]
    var color: NSColor
    var lineWidth: CGFloat

    func draw(in context: NSGraphicsContext, image: CGImage?, viewSize: CGSize, imageSize: CGSize) {
        let ctx = context.cgContext
        ctx.saveGState()
        color.setStroke()
        color.setFill()

        switch tool {
        case .none:
            break
        case .rectangle:
            let rect = Geometry.normalizedRect(from: start, to: end).insetBy(dx: 0.5, dy: 0.5)
            let path = NSBezierPath(rect: rect)
            path.lineWidth = lineWidth
            path.stroke()
        case .ellipse:
            let rect = Geometry.normalizedRect(from: start, to: end)
            let path = NSBezierPath(ovalIn: rect)
            path.lineWidth = lineWidth
            path.stroke()
        case .arrow:
            drawArrow(from: start, to: end, lineWidth: lineWidth)
        case .pen:
            guard points.count > 1 else { break }
            let path = NSBezierPath()
            path.lineWidth = lineWidth
            path.lineJoinStyle = .round
            path.lineCapStyle = .round
            path.move(to: points[0])
            for point in points.dropFirst() {
                path.line(to: point)
            }
            path.stroke()
        case .mosaic:
            drawMosaic(
                in: Geometry.normalizedRect(from: start, to: end),
                image: image,
                viewSize: viewSize,
                imageSize: imageSize
            )
        }
        ctx.restoreGState()
    }

    private func drawArrow(from: CGPoint, to: CGPoint, lineWidth: CGFloat) {
        let path = NSBezierPath()
        path.lineWidth = lineWidth
        path.lineCapStyle = .round
        path.lineJoinStyle = .round
        path.move(to: from)
        path.line(to: to)
        path.stroke()

        let dx = to.x - from.x
        let dy = to.y - from.y
        let length = max(hypot(dx, dy), 1)
        let ux = dx / length
        let uy = dy / length
        let head: CGFloat = 12 + lineWidth * 1.5
        let left = CGPoint(x: to.x - ux * head - uy * head * 0.45, y: to.y - uy * head + ux * head * 0.45)
        let right = CGPoint(x: to.x - ux * head + uy * head * 0.45, y: to.y - uy * head - ux * head * 0.45)
        let headPath = NSBezierPath()
        headPath.move(to: to)
        headPath.line(to: left)
        headPath.line(to: right)
        headPath.close()
        color.setFill()
        headPath.fill()
    }

    private func drawMosaic(in rect: CGRect, image: CGImage?, viewSize: CGSize, imageSize: CGSize) {
        guard let image, rect.width > 1, rect.height > 1 else { return }
        let block: CGFloat = 12
        let scaleX = imageSize.width / max(viewSize.width, 1)
        let scaleY = imageSize.height / max(viewSize.height, 1)

        var y = rect.minY
        while y < rect.maxY {
            var x = rect.minX
            let bh = min(block, rect.maxY - y)
            while x < rect.maxX {
                let bw = min(block, rect.maxX - x)
                let sample = CGPoint(x: x + bw / 2, y: y + bh / 2)
                let px = Int((sample.x * scaleX).rounded(.down))
                let py = Int(((viewSize.height - sample.y) * scaleY).rounded(.down))
                let color = ScreenCapture.pixelColor(in: image, atPixelX: px, y: py) ?? .gray
                color.setFill()
                CGRect(x: x, y: y, width: bw, height: bh).fill()
                x += block
            }
            y += block
        }
    }
}

enum ImageCompositor {
    static func composite(
        snapshot: CGImage,
        selection: CGRect,
        viewSize: CGSize,
        annotations: [Annotation]
    ) -> CGImage? {
        let scaleX = CGFloat(snapshot.width) / max(viewSize.width, 1)
        let scaleY = CGFloat(snapshot.height) / max(viewSize.height, 1)
        let crop = CGRect(
            x: selection.minX * scaleX,
            y: (viewSize.height - selection.maxY) * scaleY,
            width: selection.width * scaleX,
            height: selection.height * scaleY
        ).integral
        guard let cropped = snapshot.cropping(to: crop) else { return nil }
        guard crop.width > 0, crop.height > 0 else { return nil }
        // The common unmarked shot needs no full-size allocation/redraw.
        // CGImage's crop retains the original pixels and color profile.
        if annotations.isEmpty { return cropped }

        let width = cropped.width
        let height = cropped.height
        guard let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }

        context.interpolationQuality = .high
        context.draw(cropped, in: CGRect(x: 0, y: 0, width: width, height: height))

        let ns = NSGraphicsContext(cgContext: context, flipped: false)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = ns
        context.translateBy(x: -selection.minX * scaleX, y: -selection.minY * scaleY)
        context.scaleBy(x: scaleX, y: scaleY)
        for annotation in annotations {
            annotation.draw(
                in: ns,
                image: snapshot,
                viewSize: viewSize,
                imageSize: CGSize(width: snapshot.width, height: snapshot.height)
            )
        }
        NSGraphicsContext.restoreGraphicsState()
        return context.makeImage()
    }
}
