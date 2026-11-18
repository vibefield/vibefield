#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>

@interface ProbeView : UIView
@end
@implementation ProbeView {
  CADisplayLink *_displayLink;
  CALayer *_stripe, *_marker, *_cursor;
  NSMutableArray *_events;
  NSString *_logPath;
  NSUInteger _taps, _frames, _moves;
  CFTimeInterval _lastWrite;
  dispatch_queue_t _logQueue;
  BOOL _pendingTouchDisplay;
}
- (instancetype)initWithFrame:(CGRect)rect {
  if ((self = [super initWithFrame:rect])) {
    self.backgroundColor = [UIColor colorWithRed:.08 green:.10 blue:.16 alpha:1];
    _stripe = [CALayer layer];
    _stripe.backgroundColor = [UIColor colorWithRed:.22 green:.49 blue:.95 alpha:1].CGColor;
    [self.layer addSublayer:_stripe];
    _marker = [CALayer layer];
    [self.layer addSublayer:_marker];
    _cursor = [CALayer layer];
    _cursor.bounds = CGRectMake(0, 0, 44, 44);
    _cursor.cornerRadius = 22;
    _cursor.backgroundColor = UIColor.whiteColor.CGColor;
    _cursor.hidden = YES;
    [self.layer addSublayer:_cursor];
    _events = [NSMutableArray array];
    _logQueue = dispatch_queue_create(
        "dev.vibefield.probe.log",
        dispatch_queue_attr_make_with_qos_class(DISPATCH_QUEUE_SERIAL, QOS_CLASS_UTILITY, 0));
    _logPath =
        [NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject
            stringByAppendingPathComponent:@"interaction.json"];
    [self updateMarker];
    _displayLink = [CADisplayLink displayLinkWithTarget:self selector:@selector(frame:)];
    _displayLink.preferredFrameRateRange = CAFrameRateRangeMake(60, 60, 60);
    [_displayLink addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
  }
  return self;
}
- (void)layoutSubviews {
  [super layoutSubviews];
  const CGFloat w = self.bounds.size.width, h = self.bounds.size.height;
  _marker.frame = CGRectMake(.18 * w, .35 * h, .64 * w, .30 * h);
  _stripe.bounds = CGRectMake(0, 0, .12 * w, .8 * h);
}
- (void)updateMarker {
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _marker.backgroundColor = (_taps % 2 ? [UIColor colorWithRed:.03 green:.90 blue:.14 alpha:1]
                                       : [UIColor colorWithRed:.95 green:.05 blue:.08 alpha:1])
                                .CGColor;
  [CATransaction commit];
}
- (void)frame:(CADisplayLink *)clock {
  ++_frames;
  if (_pendingTouchDisplay) {
    NSNumber *now = @([NSDate date].timeIntervalSince1970 * 1000);
    for (NSMutableDictionary *touch in _events.reverseObjectEnumerator) {
      if (touch[@"displayAt"]) break;
      touch[@"displayAt"] = now;
    }
    _pendingTouchDisplay = NO;
  }
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _stripe.position = CGPointMake((.5 + .42 * sin(clock.timestamp * 2.1)) * self.bounds.size.width,
                                 .5 * self.bounds.size.height);
  [CATransaction commit];
  if (clock.timestamp - _lastWrite >= 2) {
    _lastWrite = clock.timestamp;
    NSData *data = [NSJSONSerialization dataWithJSONObject:@{
      @"events" : _events,
      @"frames" : @(_frames),
      @"moves" : @(_moves),
      @"at" : @([NSDate date].timeIntervalSince1970 * 1000)
    }
                                                   options:0
                                                     error:nil];
    dispatch_async(_logQueue, ^{
      [data writeToFile:self->_logPath atomically:YES];
    });
  }
}
- (void)touchesBegan:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
  double received = [NSDate date].timeIntervalSince1970 * 1000;
  CGPoint point = [touches.anyObject locationInView:self];
  ++_taps;
  [_events addObject:[@{
             @"sequence" : @(_taps),
             @"at" : @(received),
             @"x" : @(point.x),
             @"y" : @(point.y)
           } mutableCopy]];
  _pendingTouchDisplay = YES;
  if (_events.count > 1000) [_events removeObjectAtIndex:0];
  [self updateMarker];
}
- (void)touchesMoved:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
  ++_moves;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _cursor.hidden = NO;
  _cursor.position = [touches.anyObject locationInView:self];
  [CATransaction commit];
}
- (void)touchesEnded:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
  _cursor.hidden = YES;
}
- (void)touchesCancelled:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
  _cursor.hidden = YES;
}
@end
@interface Controller : UIViewController
@end
@implementation Controller
- (void)loadView {
  self.view = [[ProbeView alloc] initWithFrame:UIScreen.mainScreen.bounds];
}
- (BOOL)prefersStatusBarHidden {
  return YES;
}
@end
@interface App : UIResponder <UIApplicationDelegate>
@property(nonatomic, strong) UIWindow *window;
@end
@implementation App
- (BOOL)application:(UIApplication *)app didFinishLaunchingWithOptions:(NSDictionary *)options {
  self.window = [[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];
  self.window.rootViewController = [Controller new];
  [self.window makeKeyAndVisible];
  return YES;
}
@end
int main(int argc, char **argv) {
  @autoreleasepool {
    return UIApplicationMain(argc, argv, nil, NSStringFromClass(App.class));
  }
}
