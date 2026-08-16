#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>

#include <signal.h>
#include <unistd.h>

constexpr CGFloat kFixtureWidth = 390;
constexpr CGFloat kFixtureHeight = 844;

@interface VfLiveSurfaceFixtureView : NSView
@property(nonatomic) BOOL phase;
@end

@implementation VfLiveSurfaceFixtureView

- (BOOL)isOpaque {
  return YES;
}

- (void)drawRect:(NSRect)dirty_rect {
  (void)dirty_rect;
  CGContextRef context = NSGraphicsContext.currentContext.CGContext;
  CGContextSetBlendMode(context, kCGBlendModeCopy);
  CGContextSetRGBFillColor(context, 0, 0, 1, 1);
  CGContextFillRect(context, CGRectMake(0, 0, self.bounds.size.width,
                                        self.bounds.size.height / 2));
  CGContextSetRGBFillColor(context, 1, 0, 0, 1);
  CGContextFillRect(context,
                    CGRectMake(0, self.bounds.size.height / 2, self.bounds.size.width,
                               self.bounds.size.height / 2));

  // A tiny changing patch forces complete ScreenCaptureKit frames. Pixel
  // assertions deliberately sample the band interiors, outside this corner.
  const CGFloat level = self.phase ? 1 : 0;
  CGContextSetRGBFillColor(context, level, level, level, 1);
  CGContextFillRect(context, CGRectMake(0, 0, 8, 8));
}

@end

int main() {
  @autoreleasepool {
    signal(SIGPIPE, SIG_IGN);
    NSApplication* application = NSApplication.sharedApplication;
    [application setActivationPolicy:NSApplicationActivationPolicyAccessory];

    NSWindow* window = [[NSWindow alloc]
        initWithContentRect:NSMakeRect(0, 0, kFixtureWidth, kFixtureHeight)
                  styleMask:NSWindowStyleMaskBorderless
                    backing:NSBackingStoreBuffered
                      defer:NO];
    window.title = [NSString stringWithFormat:@"VibeField LSF4 Pixel Fixture %d", getpid()];
    window.opaque = YES;
    window.hasShadow = NO;
    window.backgroundColor = NSColor.blackColor;
    window.colorSpace = NSColorSpace.sRGBColorSpace;
    window.ignoresMouseEvents = YES;
    window.releasedWhenClosed = NO;
    window.contentView = [[VfLiveSurfaceFixtureView alloc] initWithFrame:window.contentLayoutRect];
    [window center];
    [window orderFrontRegardless];

    VfLiveSurfaceFixtureView* view = (VfLiveSurfaceFixtureView*)window.contentView;
    [NSTimer scheduledTimerWithTimeInterval:1.0 / 30.0
                                    repeats:YES
                                      block:^(__unused NSTimer* timer) {
      view.phase = !view.phase;
      [view setNeedsDisplayInRect:NSMakeRect(0, 0, 8, 8)];
    }];

    NSDictionary* ready = @{
      @"ok" : @YES,
      @"pid" : @(getpid()),
      @"title" : window.title,
      @"width" : @(kFixtureWidth),
      @"height" : @(kFixtureHeight),
    };
    NSData* json = [NSJSONSerialization dataWithJSONObject:ready options:0 error:nil];
    [[NSFileHandle fileHandleWithStandardOutput] writeData:json];
    [[NSFileHandle fileHandleWithStandardOutput]
        writeData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]];
    [application run];
    return 0;
  }
}
