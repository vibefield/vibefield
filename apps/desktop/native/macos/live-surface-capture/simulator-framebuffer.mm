#import "simulator-framebuffer.h"

#import <CoreMedia/CoreMedia.h>
#import <IOSurface/IOSurface.h>
#import <Metal/Metal.h>
#import <MetalPerformanceShaders/MetalPerformanceShaders.h>
#import <QuartzCore/QuartzCore.h>
#import <dlfcn.h>

#include <algorithm>
#include <cmath>

// Imported dynamically from the selected Xcode. The capture helper is built with this file by
// default (build-live-surface-capture.mjs; `--window-only` leaves it out), and production uses it
// unless VF_SIMULATOR_FRAMEBUFFER=0 (authority-production.ts). Corrected 2026-11-19: this line
// said "only in the opt-in benchmark helper".
@protocol VfSimContext
+ (id)sharedServiceContextForDeveloperDir:(NSString*)dir error:(NSError**)error;
- (id)defaultDeviceSetWithError:(NSError**)error;
- (NSArray*)devices;
- (NSUUID*)UDID;
- (NSString*)name;
- (NSString*)stateString;
- (id)deviceType;
- (NSString*)bundlePath;
- (id)io;
- (void)updateIOPorts;
- (NSArray*)deviceIOPorts;
- (NSString*)portIdentifier;
- (id)descriptor;
- (id)framebufferSurface;
- (void)registerScreenCallbacksWithUUID:(NSUUID*)uuid
                          callbackQueue:(dispatch_queue_t)queue
                          frameCallback:(void (^)(void))frame
                surfacesChangedCallback:(void (^)(void))surfaces
              propertiesChangedCallback:(void (^)(void))properties;
- (void)unregisterScreenCallbacksWithUUID:(NSUUID*)uuid;
@end

static NSString* DeveloperDirectory() {
  NSTask* task = [NSTask new];
  NSPipe* output = [NSPipe pipe];
  task.executableURL = [NSURL fileURLWithPath:@"/usr/bin/xcode-select"];
  task.arguments = @[ @"-p" ];
  task.standardOutput = output;
  task.standardError = [NSFileHandle fileHandleWithNullDevice];
  if ([task launchAndReturnError:nil]) {
    NSData* bytes = [output.fileHandleForReading readDataToEndOfFile];
    [task waitUntilExit];
    NSString* path = [[[NSString alloc] initWithData:bytes encoding:NSUTF8StringEncoding]
        stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (task.terminationStatus == 0 && path.isAbsolutePath &&
        [NSFileManager.defaultManager
            isExecutableFileAtPath:[path stringByAppendingPathComponent:@"usr/bin/simctl"]])
      return path;
  }
  return @"/Applications/Xcode.app/Contents/Developer";
}

static id<VfSimContext> FindDevice(NSString* udid) {
  static NSString* dir;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    dir = DeveloperDirectory();
    for (NSString* path in @[
           @"/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator",
           [dir stringByAppendingPathComponent:
                    @"Library/PrivateFrameworks/CoreSimulator.framework/CoreSimulator"],
           [dir stringByAppendingPathComponent:
                    @"Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit"],
           [dir stringByAppendingPathComponent:@"../SharedFrameworks/SimulatorKit.framework/SimulatorKit"]
         ])
      dlopen(path.fileSystemRepresentation, RTLD_NOW | RTLD_LOCAL);
  });
  Class<VfSimContext> cls = (Class<VfSimContext>)NSClassFromString(@"SimServiceContext");
  if (![(id)cls respondsToSelector:@selector(sharedServiceContextForDeveloperDir:error:)]) return nil;
  id context = [cls sharedServiceContextForDeveloperDir:dir error:nil];
  if (![context respondsToSelector:@selector(defaultDeviceSetWithError:)]) return nil;
  id set = [(id<VfSimContext>)context defaultDeviceSetWithError:nil];
  if (![set respondsToSelector:@selector(devices)]) return nil;
  NSUUID* wanted = [[NSUUID alloc] initWithUUIDString:udid];
  for (id node in [(id<VfSimContext>)set devices]) {
    id<VfSimContext> device = node;
    if ([node respondsToSelector:@selector(UDID)] && [node respondsToSelector:@selector(stateString)] &&
        [[device UDID] isEqual:wanted] && [[device stateString] isEqualToString:@"Booted"])
      return device;
  }
  return nil;
}

// These entry points belong to the selected Xcode. The HID client is constructed with
// the same SimDevice object as the display, never with a window or a host event target.
@protocol VfGuestHID <NSObject>
- (instancetype)initWithDevice:(id)device error:(NSError**)error;
- (void)sendWithMessage:(void*)message freeWhenDone:(BOOL)freeWhenDone
        completionQueue:(dispatch_queue_t)queue completion:(void (^)(NSError*))completion;
@end
using TouchMessage = void* (*)(CGPoint*, CGPoint*, uint32_t, int32_t, CGSize, uint32_t);
using KeyMessage = void* (*)(uint32_t, uint32_t);
using ButtonMessage = void* (*)(int32_t, int32_t, int32_t);

@implementation VfSimulatorFramebuffer {
  NSString* _udid;
  dispatch_queue_t _queue;
  BOOL (^_hasSpace)(void);
  void (^_deliver)(CVPixelBufferRef, double, double);
  id<VfSimContext> _device;
  id<VfSimContext> _io;
  id<VfGuestHID> _hid;
  TouchMessage _makeTouch;
  KeyMessage _makeKey;
  ButtonMessage _makeButton;
  CGPoint _finger;
  BOOL _touching, _scrolling;
  uint32_t _edge;
  NSUInteger _scrollRevision;
  NSMutableIndexSet* _keys;
  NSMutableArray* _displays;
  NSUUID* _subscription;
  id<MTLDevice> _gpu;
  id<MTLCommandQueue> _commands;
  MPSImageBilinearScale* _scaleImage;
  CVPixelBufferPoolRef _pool;
  size_t _poolWidth, _poolHeight, _screenWidth, _screenHeight, _askedWidth, _askedHeight;
  double _screenScale, _availableFrames, _lastBudgetTime;
  NSInteger _fps;
  uint32_t _lastSurface, _lastSeed;
  BOOL _sent, _pending, _retryScheduled;
  NSUInteger _generation;
}

- (instancetype)initWithDevice:(NSString*)udid
                         queue:(dispatch_queue_t)queue
                      hasSpace:(BOOL (^)(void))hasSpace
                       deliver:(void (^)(CVPixelBufferRef, double, double))deliver {
  self = [super init];
  if (self) {
    _udid = [udid copy];
    _queue = queue;
    _hasSpace = [hasSpace copy];
    _deliver = [deliver copy];
    _displays = [NSMutableArray new];
  }
  return self;
}

- (BOOL)connectInput {
  Class client = NSClassFromString(@"_TtC12SimulatorKit24SimDeviceLegacyHIDClient");
  if (!client || ![client instancesRespondToSelector:@selector(initWithDevice:error:)] ||
      ![client instancesRespondToSelector:@selector(sendWithMessage:freeWhenDone:completionQueue:completion:)])
    return NO;
  NSString* binary = [NSBundle bundleForClass:client].executablePath;
  if (!binary) return NO;
  void* lib = dlopen(binary.fileSystemRepresentation, RTLD_NOW | RTLD_LOCAL);
  if (!lib) return NO;
  _makeTouch = (TouchMessage)dlsym(lib, "IndigoHIDMessageForMouseNSEvent");
  _makeKey = (KeyMessage)dlsym(lib, "IndigoHIDMessageForKeyboardArbitrary");
  _makeButton = (ButtonMessage)dlsym(lib, "IndigoHIDMessageForButton");
  dlclose(lib);  // FindDevice retains the framework for the lifetime of the helper.
  if (!_makeTouch || !_makeKey || !_makeButton) return NO;
  _hid = [(id<VfGuestHID>)[client alloc] initWithDevice:_device error:nil];
  _keys = [NSMutableIndexSet indexSet];
  return _hid != nil;
}

- (void)sendHID:(void*)message {
  if (message) [_hid sendWithMessage:message freeWhenDone:YES completionQueue:nil completion:nil];
}

- (void)touch:(CGPoint)point down:(BOOL)down {
  if (!_touching && down) {
    _edge = point.y > 0.975 ? 3 : point.y < 0.02 ? 2 : point.x < 0.015 ? 1 : 0;
  }
  _finger = point;
  [self sendHID:_makeTouch(&point, nullptr, 0x32, down ? 1 : 2, CGSizeMake(1, 1), _edge)];
  _touching = down;
}

- (void)releaseInput {
  if (_touching) [self touch:_finger down:NO];
  _scrolling = NO;
  ++_scrollRevision;
  [_keys enumerateIndexesUsingBlock:^(NSUInteger usage, BOOL*) {
    [self sendHID:self->_makeKey((uint32_t)usage, 2)];
  }];
  [_keys removeAllIndexes];
}

- (void)input:(NSDictionary*)event {
  if (!_hid) return;
  NSString* kind = event[@"kind"];
  if ([kind isEqual:@"release"]) { [self releaseInput]; return; }
  if (_fps <= 0) return;
  if ([kind isEqual:@"home"]) {
    [self sendHID:_makeButton(0, 1, 0x33)];
    [self sendHID:_makeButton(0, 2, 0x33)];
    return;
  }
  if ([kind isEqual:@"key"]) {
    NSNumber* usage = event[@"usage"];
    if (![usage isKindOfClass:NSNumber.class] || usage.intValue < 4 || usage.intValue > 231) return;
    const NSUInteger code = usage.unsignedIntegerValue;
    const BOOL down = [event[@"down"] isEqual:@YES];
    if (down == [_keys containsIndex:code]) return;
    if (down) [_keys addIndex:code]; else [_keys removeIndex:code];
    [self sendHID:_makeKey((uint32_t)code, down ? 1 : 2)];
    return;
  }
  NSNumber* x = event[@"x"];
  NSNumber* y = event[@"y"];
  if (![x isKindOfClass:NSNumber.class] || ![y isKindOfClass:NSNumber.class] ||
      !(x.doubleValue >= 0 && x.doubleValue <= 1 && y.doubleValue >= 0 && y.doubleValue <= 1)) return;
  const CGPoint point = CGPointMake(x.doubleValue, y.doubleValue);
  if ([kind isEqual:@"wheel"]) {
    if (_touching && !_scrolling) return;
    if (!_scrolling) { [self touch:point down:YES]; _scrolling = YES; }
    const double dx = [event[@"dx"] doubleValue], dy = [event[@"dy"] doubleValue];
    if (!std::isfinite(dx) || !std::isfinite(dy)) return;
    CGPoint next = CGPointMake(std::clamp(_finger.x - dx, 0.02, 0.98),
                               std::clamp(_finger.y - dy, 0.02, 0.98));
    if (CGPointEqualToPoint(_finger, next) && (dx || dy)) {
      [self touch:_finger down:NO]; [self touch:point down:YES];
      next = CGPointMake(std::clamp(point.x - dx, 0.02, 0.98), std::clamp(point.y - dy, 0.02, 0.98));
    }
    [self touch:next down:YES];
    const NSUInteger revision = ++_scrollRevision;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 90000000), _queue, ^{
      if (self->_scrollRevision == revision && self->_scrolling) {
        [self touch:self->_finger down:NO];
        self->_scrolling = NO;
      }
    });
  } else if ([kind isEqual:@"touch"]) {
    NSString* phase = event[@"phase"];
    if ([phase isEqual:@"down"]) {
      if (_touching) [self touch:_finger down:NO];
      _scrolling = NO; ++_scrollRevision;
      [self touch:point down:YES];
    } else if (_touching && !_scrolling && ([phase isEqual:@"move"] || [phase isEqual:@"up"])) {
      [self touch:point down:[phase isEqual:@"move"]];
    }
  }
}

- (BOOL)start {
  @try {
    _device = FindDevice(_udid);
    if (![(id)_device respondsToSelector:@selector(deviceType)] ||
        ![(id)_device respondsToSelector:@selector(io)])
      return NO;
    id type = [_device deviceType];
    if (![type respondsToSelector:@selector(bundlePath)]) return NO;
    NSString* path = [[(id<VfSimContext>)type bundlePath]
        stringByAppendingPathComponent:@"Contents/Resources/profile.plist"];
    NSDictionary* profile = [NSDictionary dictionaryWithContentsOfFile:path];
    _screenWidth = [profile[@"mainScreenWidth"] unsignedIntegerValue];
    _screenHeight = [profile[@"mainScreenHeight"] unsignedIntegerValue];
    _screenScale = [profile[@"mainScreenScale"] doubleValue];
    if (!_screenWidth || !_screenHeight || _screenWidth > 16384 || _screenHeight > 16384 ||
        !std::isfinite(_screenScale) || _screenScale < 1 || _screenScale > 8)
      return NO;
    _io = [_device io];
    if (![(id)_io respondsToSelector:@selector(updateIOPorts)] ||
        ![(id)_io respondsToSelector:@selector(deviceIOPorts)])
      return NO;
    _gpu = MTLCreateSystemDefaultDevice();
    _commands = [_gpu newCommandQueue];
    if (!_commands || !MPSSupportsMTLDevice(_gpu)) return NO;
    _scaleImage = [[MPSImageBilinearScale alloc] initWithDevice:_gpu];
    [_io updateIOPorts];
    for (id item in [_io deviceIOPorts]) {
      if (![item respondsToSelector:@selector(portIdentifier)] ||
          ![item respondsToSelector:@selector(descriptor)])
        continue;
      id<VfSimContext> port = item;
      if (![[port portIdentifier] isEqualToString:@"com.apple.framebuffer.display"]) continue;
      id display = [port descriptor];
      if ([display respondsToSelector:@selector(framebufferSurface)] &&
          [display respondsToSelector:@selector
                   (registerScreenCallbacksWithUUID:
                                      callbackQueue:frameCallback:surfacesChangedCallback
                                                   :propertiesChangedCallback:)] &&
          [display respondsToSelector:@selector(unregisterScreenCallbacksWithUUID:)])
        [_displays addObject:display];
    }
    return _displays.count > 0 && [self connectInput];
  } @catch (__unused NSException* error) {
    return NO;
  }
}

- (void)unsubscribe {
  if (!_subscription) return;
  for (id<VfSimContext> display in _displays) [display unregisterScreenCallbacksWithUUID:_subscription];
  _subscription = nil;
}

- (void)setFPS:(NSInteger)fps width:(size_t)width height:(size_t)height {
  _fps = fps;
  _askedWidth = width;
  _askedHeight = height;
  _sent = NO;
  _generation++;
  _retryScheduled = NO;
  _pending = fps > 0;
  _availableFrames = 1;
  _lastBudgetTime = CACurrentMediaTime();
  if (fps <= 0) {
    [self releaseInput];
    [self unsubscribe];
    return;
  }
  if (!_subscription) {
    _subscription = [NSUUID UUID];
    __weak VfSimulatorFramebuffer* weakSelf = self;
    void (^changed)(void) = ^{
      [weakSelf frameChanged];
    };
    for (id<VfSimContext> display in _displays) {
      [display registerScreenCallbacksWithUUID:_subscription
                                 callbackQueue:_queue
                                 frameCallback:changed
                       surfacesChangedCallback:changed
                     propertiesChangedCallback:changed];
    }
  }
  [self capture];
}

- (CVPixelBufferRef)makeOutput:(size_t)width height:(size_t)height CF_RETURNS_RETAINED {
  if (_pool && (width != _poolWidth || height != _poolHeight)) {
    CFRelease(_pool);
    _pool = nullptr;
  }
  if (!_pool) {
    NSDictionary* attributes = @{
      (id)kCVPixelBufferWidthKey : @(width),
      (id)kCVPixelBufferHeightKey : @(height),
      (id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
      (id)kCVPixelBufferMetalCompatibilityKey : @YES,
      (id)kCVPixelBufferIOSurfacePropertiesKey : @{}
    };
    if (CVPixelBufferPoolCreate(nullptr, nullptr, (__bridge CFDictionaryRef)attributes, &_pool) !=
        kCVReturnSuccess)
      return nullptr;
    _poolWidth = width;
    _poolHeight = height;
  }
  CVPixelBufferRef result = nullptr;
  const NSDictionary* limits = @{(id)kCVPixelBufferPoolAllocationThresholdKey : @3};
  CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(nullptr, _pool, (__bridge CFDictionaryRef)limits,
                                                      &result);
  return result;
}

- (id<MTLTexture>)texture:(IOSurfaceRef)surface usage:(MTLTextureUsage)usage {
  MTLTextureDescriptor* description =
      [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
                                                         width:IOSurfaceGetWidth(surface)
                                                        height:IOSurfaceGetHeight(surface)
                                                     mipmapped:NO];
  description.usage = usage;
  description.storageMode = MTLStorageModeShared;
  return [_gpu newTextureWithDescriptor:description iosurface:surface plane:0];
}

- (void)frameChanged {
  _pending = YES;
  [self capacityAvailable];
}

- (void)retryAfter:(double)seconds {
  if (_retryScheduled || _fps <= 0) return;
  _retryScheduled = YES;
  const NSUInteger generation = _generation;
  __weak VfSimulatorFramebuffer* weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(std::max(seconds, 0.0005) * NSEC_PER_SEC)),
                 _queue, ^{
                   VfSimulatorFramebuffer* strongSelf = weakSelf;
                   if (!strongSelf || generation != strongSelf->_generation) return;
                   strongSelf->_retryScheduled = NO;
                   [strongSelf capacityAvailable];
                 });
}

- (void)capacityAvailable {
  if (_pending && _fps > 0) [self capture];
}

- (void)capture {
  @autoreleasepool {
    if (_fps <= 0 || !_hasSpace()) return;
    const double now = CACurrentMediaTime();
    // Preserve a late phone frame after a scheduling hitch. Bound the burst and charge real copies only.
    _availableFrames = std::min(2.0, _availableFrames + (now - _lastBudgetTime) * _fps);
    _lastBudgetTime = now;
    if (_availableFrames < 0.995) {
      [self retryAfter:(1.0 - _availableFrames) / _fps];
      return;
    }
    _pending = NO;
    for (id<VfSimContext> display in _displays) {
      id surfaceObject = [display framebufferSurface];
      if (!surfaceObject || CFGetTypeID((__bridge CFTypeRef)surfaceObject) != IOSurfaceGetTypeID()) continue;
      IOSurfaceRef source = (__bridge IOSurfaceRef)surfaceObject;
      if (IOSurfaceGetWidth(source) != _screenWidth || IOSurfaceGetHeight(source) != _screenHeight ||
          IOSurfaceGetBytesPerElement(source) != 4 || IOSurfaceGetPlaneCount(source) != 0)
        continue;
      const uint32_t idValue = IOSurfaceGetID(source), seed = IOSurfaceGetSeed(source);
      if (_sent && _lastSurface == idValue && _lastSeed == seed) continue;
      const double ratio =
          _askedWidth && _askedHeight
              ? std::min({1.0, double(_askedWidth) / _screenWidth, double(_askedHeight) / _screenHeight})
              : 1.0;
      const size_t w = std::max(1L, std::lround(_screenWidth * ratio));
      const size_t h = std::max(1L, std::lround(_screenHeight * ratio));
      CVPixelBufferRef output = [self makeOutput:w height:h];
      if (!output) {
        _pending = YES;
        return;
      }

      // The guest reuses its surface. Finish the GPU copy before publishing our independently leased surface.
      id<MTLTexture> src = [self texture:source usage:MTLTextureUsageShaderRead];
      id<MTLTexture> dst = [self texture:CVPixelBufferGetIOSurface(output) usage:MTLTextureUsageShaderWrite];
      id<MTLCommandBuffer> command = [_commands commandBuffer];
      if (src && dst && command) {
        if (w == _screenWidth && h == _screenHeight) {
          id<MTLBlitCommandEncoder> blit = [command blitCommandEncoder];
          [blit copyFromTexture:src
                    sourceSlice:0
                    sourceLevel:0
                   sourceOrigin:MTLOriginMake(0, 0, 0)
                     sourceSize:MTLSizeMake(w, h, 1)
                      toTexture:dst
               destinationSlice:0
               destinationLevel:0
              destinationOrigin:MTLOriginMake(0, 0, 0)];
          [blit endEncoding];
        } else {
          [_scaleImage encodeToCommandBuffer:command sourceTexture:src destinationTexture:dst];
        }
        [command commit];
        [command waitUntilCompleted];
        if (command.status == MTLCommandBufferStatusCompleted && IOSurfaceGetSeed(source) == seed) {
          _lastSurface = idValue;
          _lastSeed = seed;
          _sent = YES;
          _availableFrames -= 1.0;
          _deliver(output, _screenWidth / _screenScale, _screenHeight / _screenScale);
        } else if (command.status == MTLCommandBufferStatusCompleted) {
          // A new guest image raced the copy. Deliver the final change even if the display then goes idle.
          _pending = YES;
          [self retryAfter:1.0 / _fps];
        }
      }
      CVPixelBufferRelease(output);
      return;
    }
  }
}

- (void)stop {
  [self releaseInput];
  _hid = nil;
  _generation++;
  _pending = NO;
  _fps = 0;
  [self unsubscribe];
  _deliver = nil;
  _hasSpace = nil;
  [_displays removeAllObjects];
  _io = nil;
  _device = nil;
}
- (void)dealloc {
  if (_pool) CFRelease(_pool);
}
@end
