use crate::geometry::{self, Point, Rect};
use crate::sample;

pub const MARK: (u8, u8, u8) = (255, 69, 58);
const MOSAIC_BLOCK: f64 = 12.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tool {
    None,
    Rectangle,
    Ellipse,
    Arrow,
    Pen,
    Mosaic,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Annotation {
    pub tool: Tool,
    pub start: Point,
    pub end: Point,
    pub points: Vec<Point>,
    pub color: (u8, u8, u8),
    pub line_width: f64,
}

impl Annotation {
    pub fn new(tool: Tool, start: Point) -> Self {
        let line_width = if tool == Tool::Pen { 3.0 } else { 2.0 };
        Self {
            tool,
            start,
            end: start,
            points: vec![start],
            color: MARK,
            line_width,
        }
    }
}

pub fn undo(annotations: &mut Vec<Annotation>) -> bool {
    annotations.pop().is_some()
}

pub fn composite(
    snapshot: &[u8],
    image_width: u32,
    image_height: u32,
    view: Rect,
    selection: Rect,
    annotations: &[Annotation],
) -> Result<(u32, u32, Vec<u8>), String> {
    composite_with(
        snapshot,
        image_width,
        image_height,
        view,
        selection,
        annotations,
        None,
    )
}

pub fn composite_with(
    snapshot: &[u8],
    image_width: u32,
    image_height: u32,
    view: Rect,
    selection: Rect,
    annotations: &[Annotation],
    extra: Option<&Annotation>,
) -> Result<(u32, u32, Vec<u8>), String> {
    let (width, height, mut pixels) =
        geometry::crop_bgra(snapshot, image_width, image_height, view, selection)?;
    if annotations.is_empty() && extra.is_none() {
        return Ok((width, height, pixels));
    }
    let scale_x = image_width as f64 / view.width.max(1.0);
    let scale_y = image_height as f64 / view.height.max(1.0);
    let origin_x = (selection.min_x() * scale_x).floor();
    let origin_y = (selection.min_y() * scale_y).floor();
    let mut canvas = Canvas {
        pixels: &mut pixels,
        width,
        height,
    };
    for annotation in annotations {
        draw_annotation(
            &mut canvas,
            annotation,
            snapshot,
            image_width,
            image_height,
            view,
            origin_x,
            origin_y,
            scale_x,
            scale_y,
        );
    }
    if let Some(annotation) = extra {
        draw_annotation(
            &mut canvas,
            annotation,
            snapshot,
            image_width,
            image_height,
            view,
            origin_x,
            origin_y,
            scale_x,
            scale_y,
        );
    }
    Ok((width, height, pixels))
}

struct Canvas<'a> {
    pixels: &'a mut [u8],
    width: u32,
    height: u32,
}

impl Canvas<'_> {
    fn put(&mut self, x: i32, y: i32, color: (u8, u8, u8)) {
        if x < 0 || y < 0 || x >= self.width as i32 || y >= self.height as i32 {
            return;
        }
        let i = ((y as u32 * self.width + x as u32) as usize) * 4;
        self.pixels[i] = color.2;
        self.pixels[i + 1] = color.1;
        self.pixels[i + 2] = color.0;
        self.pixels[i + 3] = 255;
    }

    fn stamp(&mut self, x: i32, y: i32, radius: f64, color: (u8, u8, u8)) {
        let r = radius.max(0.6);
        let ir = r.ceil() as i32;
        let r2 = r * r;
        for dy in -ir..=ir {
            for dx in -ir..=ir {
                if (dx * dx + dy * dy) as f64 <= r2 {
                    self.put(x + dx, y + dy, color);
                }
            }
        }
    }

    fn line(&mut self, a: (i32, i32), b: (i32, i32), radius: f64, color: (u8, u8, u8)) {
        let mut x0 = a.0;
        let mut y0 = a.1;
        let x1 = b.0;
        let y1 = b.1;
        let dx = (x1 - x0).abs();
        let sx = if x0 < x1 { 1 } else { -1 };
        let dy = -(y1 - y0).abs();
        let sy = if y0 < y1 { 1 } else { -1 };
        let mut err = dx + dy;
        loop {
            self.stamp(x0, y0, radius, color);
            if x0 == x1 && y0 == y1 {
                break;
            }
            let e2 = 2 * err;
            if e2 >= dy {
                err += dy;
                x0 += sx;
            }
            if e2 <= dx {
                err += dx;
                y0 += sy;
            }
        }
    }

    fn fill_rect(&mut self, x: i32, y: i32, w: i32, h: i32, color: (u8, u8, u8)) {
        for yy in y..(y + h) {
            for xx in x..(x + w) {
                self.put(xx, yy, color);
            }
        }
    }

    fn fill_triangle(&mut self, a: (i32, i32), b: (i32, i32), c: (i32, i32), color: (u8, u8, u8)) {
        let min_x = a.0.min(b.0).min(c.0);
        let max_x = a.0.max(b.0).max(c.0);
        let min_y = a.1.min(b.1).min(c.1);
        let max_y = a.1.max(b.1).max(c.1);
        for y in min_y..=max_y {
            for x in min_x..=max_x {
                if point_in_triangle((x, y), a, b, c) {
                    self.put(x, y, color);
                }
            }
        }
    }
}

fn point_in_triangle(p: (i32, i32), a: (i32, i32), b: (i32, i32), c: (i32, i32)) -> bool {
    let v0 = (c.0 - a.0, c.1 - a.1);
    let v1 = (b.0 - a.0, b.1 - a.1);
    let v2 = (p.0 - a.0, p.1 - a.1);
    let den = v0.0 * v1.1 - v1.0 * v0.1;
    if den == 0 {
        return false;
    }
    let inv = 1.0 / den as f64;
    let u = (v2.0 * v1.1 - v1.0 * v2.1) as f64 * inv;
    let v = (v0.0 * v2.1 - v2.0 * v0.1) as f64 * inv;
    u >= 0.0 && v >= 0.0 && u + v <= 1.0
}

fn map_point(point: Point, origin_x: f64, origin_y: f64, scale_x: f64, scale_y: f64) -> (i32, i32) {
    (
        (point.x * scale_x - origin_x).round() as i32,
        (point.y * scale_y - origin_y).round() as i32,
    )
}

// A raster paint call: the canvas, the mark, the source still and the four
// numbers of the view transform. Grouping them would hide the transform.
#[allow(clippy::too_many_arguments)]
fn draw_annotation(
    canvas: &mut Canvas,
    annotation: &Annotation,
    snapshot: &[u8],
    image_width: u32,
    image_height: u32,
    view: Rect,
    origin_x: f64,
    origin_y: f64,
    scale_x: f64,
    scale_y: f64,
) {
    let radius = (annotation.line_width * scale_x.max(scale_y) / 2.0).max(0.6);
    let color = annotation.color;
    match annotation.tool {
        Tool::None => {}
        Tool::Rectangle => {
            let rect = geometry::normalized_rect(annotation.start, annotation.end);
            let a = map_point(
                Point {
                    x: rect.min_x(),
                    y: rect.min_y(),
                },
                origin_x,
                origin_y,
                scale_x,
                scale_y,
            );
            let b = map_point(
                Point {
                    x: rect.max_x(),
                    y: rect.min_y(),
                },
                origin_x,
                origin_y,
                scale_x,
                scale_y,
            );
            let c = map_point(
                Point {
                    x: rect.max_x(),
                    y: rect.max_y(),
                },
                origin_x,
                origin_y,
                scale_x,
                scale_y,
            );
            let d = map_point(
                Point {
                    x: rect.min_x(),
                    y: rect.max_y(),
                },
                origin_x,
                origin_y,
                scale_x,
                scale_y,
            );
            canvas.line(a, b, radius, color);
            canvas.line(b, c, radius, color);
            canvas.line(c, d, radius, color);
            canvas.line(d, a, radius, color);
        }
        Tool::Ellipse => {
            let rect = geometry::normalized_rect(annotation.start, annotation.end);
            let cx = (rect.mid_x() * scale_x - origin_x).round();
            let cy = (rect.mid_y() * scale_y - origin_y).round();
            let rx = (rect.width * scale_x / 2.0).max(1.0);
            let ry = (rect.height * scale_y / 2.0).max(1.0);
            draw_ellipse(canvas, cx as i32, cy as i32, rx, ry, radius, color);
        }
        Tool::Arrow => {
            let from = map_point(annotation.start, origin_x, origin_y, scale_x, scale_y);
            let to = map_point(annotation.end, origin_x, origin_y, scale_x, scale_y);
            canvas.line(from, to, radius, color);
            let dx = (to.0 - from.0) as f64;
            let dy = (to.1 - from.1) as f64;
            let length = dx.hypot(dy).max(1.0);
            let ux = dx / length;
            let uy = dy / length;
            let head = 12.0 * scale_x.max(scale_y) + annotation.line_width * 1.5;
            let left = (
                (to.0 as f64 - ux * head - uy * head * 0.45).round() as i32,
                (to.1 as f64 - uy * head + ux * head * 0.45).round() as i32,
            );
            let right = (
                (to.0 as f64 - ux * head + uy * head * 0.45).round() as i32,
                (to.1 as f64 - uy * head - ux * head * 0.45).round() as i32,
            );
            canvas.fill_triangle(to, left, right, color);
        }
        Tool::Pen => {
            if annotation.points.len() < 2 {
                let p = map_point(annotation.start, origin_x, origin_y, scale_x, scale_y);
                canvas.stamp(p.0, p.1, radius, color);
                return;
            }
            for pair in annotation.points.windows(2) {
                let a = map_point(pair[0], origin_x, origin_y, scale_x, scale_y);
                let b = map_point(pair[1], origin_x, origin_y, scale_x, scale_y);
                canvas.line(a, b, radius, color);
            }
        }
        Tool::Mosaic => {
            let rect = geometry::normalized_rect(annotation.start, annotation.end);
            if rect.width <= 1.0 || rect.height <= 1.0 {
                return;
            }
            let mut y = rect.min_y();
            while y < rect.max_y() {
                let bh = MOSAIC_BLOCK.min(rect.max_y() - y);
                let mut x = rect.min_x();
                while x < rect.max_x() {
                    let bw = MOSAIC_BLOCK.min(rect.max_x() - x);
                    let sample_pt = Point {
                        x: x + bw / 2.0,
                        y: y + bh / 2.0,
                    };
                    let color =
                        sample::sample(snapshot, image_width, image_height, view, sample_pt)
                            .map(|s| (s.r, s.g, s.b))
                            .unwrap_or((128, 128, 128));
                    let tl = map_point(Point { x, y }, origin_x, origin_y, scale_x, scale_y);
                    let br = map_point(
                        Point {
                            x: x + bw,
                            y: y + bh,
                        },
                        origin_x,
                        origin_y,
                        scale_x,
                        scale_y,
                    );
                    canvas.fill_rect(
                        tl.0,
                        tl.1,
                        (br.0 - tl.0).max(1),
                        (br.1 - tl.1).max(1),
                        color,
                    );
                    x += MOSAIC_BLOCK;
                }
                y += MOSAIC_BLOCK;
            }
        }
    }
}

fn draw_ellipse(
    canvas: &mut Canvas,
    cx: i32,
    cy: i32,
    rx: f64,
    ry: f64,
    radius: f64,
    color: (u8, u8, u8),
) {
    let steps = ((rx + ry) * 4.0).ceil().max(16.0) as i32;
    let mut prev = ((cx as f64 + rx).round() as i32, cy);
    for i in 1..=steps {
        let t = std::f64::consts::TAU * (i as f64) / (steps as f64);
        let next = (
            (cx as f64 + rx * t.cos()).round() as i32,
            (cy as f64 + ry * t.sin()).round() as i32,
        );
        canvas.line(prev, next, radius, color);
        prev = next;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gradient(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = vec![0u8; (width * height * 4) as usize];
        for y in 0..height {
            for x in 0..width {
                let i = ((y * width + x) * 4) as usize;
                bytes[i] = ((x * 255) / width.max(1).saturating_sub(1).max(1)) as u8;
                bytes[i + 1] = ((y * 255) / height.max(1).saturating_sub(1).max(1)) as u8;
                bytes[i + 2] = (((x + y) * 255) / (width + height).saturating_sub(2).max(1)) as u8;
                bytes[i + 3] = 255;
            }
        }
        bytes
    }

    fn fixture() -> (u32, u32, Vec<u8>, Rect, Rect) {
        let (w, h) = (80u32, 48u32);
        let view = Rect::from_xywh(0.0, 0.0, 80.0, 48.0);
        let selection = Rect::from_xywh(10.0, 8.0, 40.0, 24.0);
        (w, h, gradient(w, h), view, selection)
    }

    fn mark(tool: Tool, start: Point, end: Point, points: Vec<Point>) -> Annotation {
        Annotation {
            tool,
            start,
            end,
            points,
            color: MARK,
            line_width: 4.0,
        }
    }

    #[test]
    fn unmarked_composite_matches_plain_crop() {
        let (w, h, pixels, view, selection) = fixture();
        let composed = composite(&pixels, w, h, view, selection, &[]).unwrap();
        let cropped = geometry::crop_bgra(&pixels, w, h, view, selection).unwrap();
        assert_eq!(composed, cropped);
    }

    #[test]
    fn each_tool_changes_crop_pixels() {
        let (w, h, pixels, view, selection) = fixture();
        let unmarked = composite(&pixels, w, h, view, selection, &[]).unwrap();
        assert!(unmarked.0 > 0 && unmarked.1 > 0);

        let tools = [
            mark(
                Tool::Rectangle,
                Point { x: 12.0, y: 10.0 },
                Point { x: 36.0, y: 26.0 },
                vec![],
            ),
            mark(
                Tool::Ellipse,
                Point { x: 14.0, y: 11.0 },
                Point { x: 38.0, y: 28.0 },
                vec![],
            ),
            mark(
                Tool::Arrow,
                Point { x: 14.0, y: 12.0 },
                Point { x: 42.0, y: 28.0 },
                vec![],
            ),
            mark(
                Tool::Pen,
                Point { x: 14.0, y: 12.0 },
                Point { x: 40.0, y: 26.0 },
                vec![
                    Point { x: 14.0, y: 12.0 },
                    Point { x: 22.0, y: 20.0 },
                    Point { x: 40.0, y: 26.0 },
                ],
            ),
            mark(
                Tool::Mosaic,
                Point { x: 12.0, y: 10.0 },
                Point { x: 46.0, y: 30.0 },
                vec![],
            ),
        ];

        for annotation in &tools {
            let marked = composite(
                &pixels,
                w,
                h,
                view,
                selection,
                std::slice::from_ref(annotation),
            )
            .unwrap();
            assert_eq!((marked.0, marked.1), (unmarked.0, unmarked.1));
            assert_ne!(
                marked.2, unmarked.2,
                "{:?} markup must change crop pixels",
                annotation.tool
            );
        }
    }

    #[test]
    fn extra_annotation_matches_appended_slice() {
        let (w, h, pixels, view, selection) = fixture();
        let rect = mark(
            Tool::Rectangle,
            Point { x: 12.0, y: 10.0 },
            Point { x: 36.0, y: 26.0 },
            vec![],
        );
        let extra = mark(
            Tool::Pen,
            Point { x: 14.0, y: 12.0 },
            Point { x: 40.0, y: 26.0 },
            vec![
                Point { x: 14.0, y: 12.0 },
                Point { x: 22.0, y: 20.0 },
                Point { x: 40.0, y: 26.0 },
            ],
        );
        let via_slice = composite(
            &pixels,
            w,
            h,
            view,
            selection,
            &[rect.clone(), extra.clone()],
        )
        .unwrap();
        let via_extra =
            composite_with(&pixels, w, h, view, selection, &[rect], Some(&extra)).unwrap();
        assert_eq!(via_slice, via_extra);
    }

    #[test]
    fn undo_last_mark_restores_unmarked_pixels() {
        let (w, h, pixels, view, selection) = fixture();
        let rect = mark(
            Tool::Rectangle,
            Point { x: 12.0, y: 10.0 },
            Point { x: 36.0, y: 26.0 },
            vec![],
        );
        let arrow = mark(
            Tool::Arrow,
            Point { x: 14.0, y: 12.0 },
            Point { x: 42.0, y: 28.0 },
            vec![],
        );
        let unmarked = composite(&pixels, w, h, view, selection, &[]).unwrap();
        let one = composite(&pixels, w, h, view, selection, std::slice::from_ref(&rect)).unwrap();
        let two = composite(
            &pixels,
            w,
            h,
            view,
            selection,
            &[rect.clone(), arrow.clone()],
        )
        .unwrap();
        let mut stack = vec![rect.clone(), arrow];
        assert!(undo(&mut stack));
        let after_undo = composite(&pixels, w, h, view, selection, &stack).unwrap();
        assert_ne!(one.2, unmarked.2);
        assert_ne!(two.2, one.2);
        assert_eq!(after_undo.2, one.2);
        assert!(undo(&mut stack));
        let empty = composite(&pixels, w, h, view, selection, &stack).unwrap();
        assert_eq!(empty.2, unmarked.2);
        assert!(!undo(&mut stack));
    }
}
