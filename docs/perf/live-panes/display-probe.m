#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>
#include <math.h>

static NSNumber *Percentile(NSArray<NSNumber *> *samples, double fraction) {
  NSArray *sorted = [samples sortedArrayUsingSelector:@selector(compare:)];
  return sorted[(NSUInteger)floor((sorted.count - 1) * fraction)];
}

@interface DisplayProbe : UIResponder <UIApplicationDelegate>
@property(nonatomic, strong) UIWindow *window;
@end

@implementation DisplayProbe {
  CADisplayLink *_link;
  NSMutableArray<NSNumber *> *_callbackIntervals, *_targetIntervals;
  CFTimeInterval _warmUntil, _previousCallback, _previousTarget, _end;
}

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
  self.window = [[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];
  self.window.rootViewController = [[UIViewController alloc] init];
  [self.window makeKeyAndVisible];
  _callbackIntervals = [NSMutableArray new];
  _targetIntervals = [NSMutableArray new];
  _link = [CADisplayLink displayLinkWithTarget:self selector:@selector(tick:)];
  _link.preferredFrameRateRange = CAFrameRateRangeMake(120, 120, 120);
  _warmUntil = CACurrentMediaTime() + 4;
  [_link addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
  return YES;
}

- (void)tick:(CADisplayLink *)link {
  CFTimeInterval now = CACurrentMediaTime();
  self.window.rootViewController.view.backgroundColor =
      [UIColor colorWithHue:fmod(now / 2, 1) saturation:1 brightness:1 alpha:1];
  if (now < _warmUntil) return;
  if (_previousCallback > 0) {
    [_callbackIntervals addObject:@((now - _previousCallback) * 1000)];
    [_targetIntervals addObject:@((link.targetTimestamp - _previousTarget) * 1000)];
  } else {
    _end = now + 16;
  }
  _previousCallback = now;
  _previousTarget = link.targetTimestamp;
  if (now < _end || _callbackIntervals.count < 2) return;
  double elapsed = [[_callbackIntervals valueForKeyPath:@"@sum.self"] doubleValue];
  NSDictionary *result = @{
    @"runtime": UIDevice.currentDevice.systemVersion,
    @"requestedHz": @120,
    @"maximumFramesPerSecond": @(self.window.screen.maximumFramesPerSecond),
    @"linkDurationMs": @(link.duration * 1000),
    @"callbacks": @(_callbackIntervals.count),
    @"elapsedMs": @(elapsed),
    @"callbacksPerSecond": @(1000 * _callbackIntervals.count / elapsed),
    @"callbackP50Ms": Percentile(_callbackIntervals, 0.5),
    @"callbackP95Ms": Percentile(_callbackIntervals, 0.95),
    @"targetP50Ms": Percentile(_targetIntervals, 0.5),
    @"targetP95Ms": Percentile(_targetIntervals, 0.95),
  };
  NSData *data = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted error:nil];
  [data writeToFile:[NSHomeDirectory() stringByAppendingPathComponent:@"Documents/display-link.json"] atomically:YES];
  [link invalidate];
}
@end

int main(int argc, char **argv) {
  @autoreleasepool {
    return UIApplicationMain(argc, argv, nil, NSStringFromClass(DisplayProbe.class));
  }
}
