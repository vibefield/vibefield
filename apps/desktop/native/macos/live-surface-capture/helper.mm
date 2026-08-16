#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <Foundation/Foundation.h>
#import <IOSurface/IOSurface.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>

#include <bootstrap.h>
#include <mach/mach.h>
#include <signal.h>
#include <unistd.h>

#include <algorithm>
#include <array>
#include <cerrno>
#include <climits>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <string>

#include "protocol.h"

namespace {

constexpr NSUInteger kMaximumJsonLineBytes = 1024 * 1024;
constexpr NSUInteger kMaximumSessions = 16;
constexpr NSUInteger kMaximumSources = 2048;
constexpr uint64_t kMaximumSafeInteger = 9007199254740991ULL;

dispatch_queue_t OutputQueue() {
  static dispatch_queue_t queue = dispatch_queue_create("com.jamesyong.vibefield.capture.output",
                                                         DISPATCH_QUEUE_SERIAL);
  return queue;
}

void Emit(NSDictionary<NSString*, id>* message) {
  dispatch_async(OutputQueue(), ^{
    NSError* error = nil;
    NSData* data = [NSJSONSerialization dataWithJSONObject:message options:0 error:&error];
    if (data == nil || error != nil || data.length > kMaximumJsonLineBytes) _exit(70);
    @try {
      [[NSFileHandle fileHandleWithStandardOutput] writeData:data];
      [[NSFileHandle fileHandleWithStandardOutput]
          writeData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]];
    } @catch (__unused NSException* exception) {
      _exit(71);
    }
  });
}

NSDictionary<NSString*, id>* SurfaceError(NSString* code, NSString* message,
                                           NSString* recovery) {
  return @{ @"code" : code, @"message" : message, @"recovery" : recovery };
}

void EmitError(NSString* request_id, NSDictionary<NSString*, id>* error) {
  Emit(@{ @"v" : @1, @"event" : @"error", @"requestId" : request_id, @"error" : error });
}

bool BoundedString(id value, NSUInteger maximum = 512) {
  if (![value isKindOfClass:[NSString class]]) return false;
  const NSUInteger length = [(NSString*)value length];
  return length > 0 && length <= maximum;
}

bool SafeInteger(id value, uint64_t minimum = 0,
                 uint64_t maximum = kMaximumSafeInteger) {
  if (![value isKindOfClass:[NSNumber class]]) return false;
  const double number = [(NSNumber*)value doubleValue];
  return std::isfinite(number) && std::floor(number) == number && number >= minimum &&
         number <= maximum;
}

int HexDigit(unichar value) {
  if (value >= '0' && value <= '9') return value - '0';
  if (value >= 'a' && value <= 'f') return value - 'a' + 10;
  return -1;
}

bool DecodeHex(NSString* input, uint8_t* output, size_t output_size) {
  if (![input isKindOfClass:[NSString class]] || input.length != output_size * 2) return false;
  for (size_t index = 0; index < output_size; ++index) {
    const int high = HexDigit([input characterAtIndex:index * 2]);
    const int low = HexDigit([input characterAtIndex:index * 2 + 1]);
    if (high < 0 || low < 0) return false;
    output[index] = static_cast<uint8_t>((high << 4) | low);
  }
  return true;
}

NSString* EncodeHex(const uint8_t* input, size_t size) {
  static constexpr char digits[] = "0123456789abcdef";
  std::string output(size * 2, '0');
  for (size_t index = 0; index < size; ++index) {
    output[index * 2] = digits[input[index] >> 4];
    output[index * 2 + 1] = digits[input[index] & 0x0f];
  }
  return [NSString stringWithUTF8String:output.c_str()];
}

bool ConstantTimeEqual(const uint8_t* left, const uint8_t* right, size_t size) {
  uint8_t difference = 0;
  for (size_t index = 0; index < size; ++index) difference |= left[index] ^ right[index];
  return difference == 0;
}

NSString* RandomSourceRef() {
  uint8_t bytes[VF_CAPTURE_SESSION_KEY_BYTES];
  arc4random_buf(bytes, sizeof(bytes));
  return EncodeHex(bytes, sizeof(bytes));
}

NSString* CleanText(NSString* input, NSString* fallback) {
  if (input.length == 0) return fallback;
  NSMutableString* output = [[NSMutableString alloc] initWithCapacity:MIN(input.length, 512)];
  const NSUInteger limit = MIN(input.length, 512);
  for (NSUInteger index = 0; index < limit; ++index) {
    const unichar value = [input characterAtIndex:index];
    [output appendFormat:@"%C",
                         static_cast<unichar>((value <= 0x1f || value == 0x7f) ? ' ' : value)];
  }
  return output.length == 0 ? fallback : output;
}

uint64_t TimestampUs(CMTime time) {
  if (!CMTIME_IS_NUMERIC(time) || time.value < 0 || time.timescale <= 0) return 0;
  const long double microseconds =
      static_cast<long double>(time.value) * 1000000.0L / time.timescale;
  if (microseconds <= 0) return 0;
  if (microseconds >= 1.8446744e19L) {
    return std::numeric_limits<uint64_t>::max();
  }
  return static_cast<uint64_t>(microseconds);
}

bool SendFrame(mach_port_t destination, IOSurfaceRef surface,
               const VfCaptureFramePayload& payload) {
  const mach_port_t surface_port = IOSurfaceCreateMachPort(surface);
  if (surface_port == MACH_PORT_NULL) return false;
  VfCaptureFrameMessage message{};
  message.header.msgh_bits =
      MACH_MSGH_BITS_COMPLEX | MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND, 0);
  message.header.msgh_size = sizeof(message);
  message.header.msgh_remote_port = destination;
  message.header.msgh_local_port = MACH_PORT_NULL;
  message.header.msgh_id = VF_CAPTURE_FRAME_MESSAGE_ID;
  message.body.msgh_descriptor_count = 1;
  message.surface_port.name = surface_port;
  message.surface_port.disposition = MACH_MSG_TYPE_MOVE_SEND;
  message.surface_port.type = MACH_MSG_PORT_DESCRIPTOR;
  message.payload = payload;
  const mach_msg_return_t result =
      mach_msg(&message.header, MACH_SEND_MSG | MACH_SEND_TIMEOUT, message.header.msgh_size, 0,
               MACH_PORT_NULL, 100, MACH_PORT_NULL);
  if (result != MACH_MSG_SUCCESS) mach_port_deallocate(mach_task_self(), surface_port);
  return result == MACH_MSG_SUCCESS;
}

struct CaptureDemand {
  uint64_t revision = 0;
  NSString* mode = @"paused";
  NSInteger fps = 0;
  bool has_raster = false;
  size_t width = 0;
  size_t height = 0;
};

bool ParseDemand(id raw, CaptureDemand* output) {
  if (![raw isKindOfClass:[NSDictionary class]]) return false;
  NSDictionary* demand = (NSDictionary*)raw;
  id revision = demand[@"revision"];
  id mode = demand[@"mode"];
  id fps = demand[@"targetFps"];
  if (!SafeInteger(revision) || ![mode isKindOfClass:[NSString class]] ||
      ![@[ @"live", @"paused", @"hibernated" ] containsObject:mode] ||
      !SafeInteger(fps, 0, 60)) {
    return false;
  }
  const NSInteger fps_value = [fps integerValue];
  if (([mode isEqualToString:@"live"] && fps_value == 0) ||
      (![mode isEqualToString:@"live"] && fps_value != 0)) {
    return false;
  }
  CaptureDemand parsed;
  parsed.revision = [revision unsignedLongLongValue];
  parsed.mode = mode;
  parsed.fps = fps_value;
  id raster = demand[@"targetRasterSize"];
  if (raster != nil) {
    if (![raster isKindOfClass:[NSDictionary class]] ||
        !SafeInteger(((NSDictionary*)raster)[@"width"], 1, 16384) ||
        !SafeInteger(((NSDictionary*)raster)[@"height"], 1, 16384)) {
      return false;
    }
    parsed.width = [((NSDictionary*)raster)[@"width"] unsignedLongLongValue];
    parsed.height = [((NSDictionary*)raster)[@"height"] unsignedLongLongValue];
    if (parsed.width * parsed.height > 67108864ULL) return false;
    parsed.has_raster = true;
  }
  *output = parsed;
  return true;
}

struct CaptureCrop {
  bool explicit_crop = false;
  CGRect rect = CGRectZero;
};

struct CaptureRaster {
  size_t width;
  size_t height;
};

CaptureRaster FitRaster(double logical_width, double logical_height, CGFloat point_scale,
                        const CaptureDemand& demand) {
  const double requested_width = demand.has_raster ? demand.width : logical_width * point_scale;
  const double requested_height = demand.has_raster ? demand.height : logical_height * point_scale;
  double scale = std::min(requested_width / logical_width, requested_height / logical_height);
  scale = std::min(scale, 16384.0 / logical_width);
  scale = std::min(scale, 16384.0 / logical_height);
  scale = std::min(scale, std::sqrt(67108864.0 / (logical_width * logical_height)));
  scale = std::max(scale, 1e-9);
  return {
      static_cast<size_t>(std::max(1.0, std::round(logical_width * scale))),
      static_cast<size_t>(std::max(1.0, std::round(logical_height * scale))),
  };
}

bool ParseCrop(id raw, CaptureCrop* output) {
  if (![raw isKindOfClass:[NSDictionary class]]) return false;
  NSDictionary* crop = (NSDictionary*)raw;
  id mode = crop[@"mode"];
  if (![mode isKindOfClass:[NSString class]] ||
      ![@[ @"none", @"auto", @"explicit" ] containsObject:mode]) {
    return false;
  }
  CaptureCrop parsed;
  if ([mode isEqualToString:@"explicit"]) {
    id source_rect = crop[@"sourceRect"];
    if (![source_rect isKindOfClass:[NSDictionary class]]) return false;
    NSDictionary* rect = (NSDictionary*)source_rect;
    for (NSString* name in @[ @"x", @"y", @"width", @"height" ]) {
      if (![rect[name] isKindOfClass:[NSNumber class]] ||
          !std::isfinite([rect[name] doubleValue])) {
        return false;
      }
    }
    if ([rect[@"x"] doubleValue] < 0 || [rect[@"y"] doubleValue] < 0 ||
        [rect[@"width"] doubleValue] <= 0 || [rect[@"height"] doubleValue] <= 0 ||
        [rect[@"width"] doubleValue] > 32768 ||
        [rect[@"height"] doubleValue] > 32768) {
      return false;
    }
    parsed.explicit_crop = true;
    parsed.rect = CGRectMake([rect[@"x"] doubleValue], [rect[@"y"] doubleValue],
                             [rect[@"width"] doubleValue],
                             [rect[@"height"] doubleValue]);
  }
  *output = parsed;
  return true;
}

}  // namespace

@interface VfCaptureSession : NSObject <SCStreamOutput, SCStreamDelegate>
- (instancetype)initWithSessionKey:(NSString*)session_key
                       sessionBytes:(const uint8_t*)session_bytes
                              epoch:(uint64_t)epoch
                             window:(SCWindow*)window
                               crop:(CaptureCrop)crop
                      captureCursor:(BOOL)capture_cursor
                             demand:(CaptureDemand)demand
                        destination:(mach_port_t)destination
                         capability:(const uint8_t*)capability;
- (void)startWithCompletion:(void (^)(NSError* _Nullable error))completion;
- (void)applyDemand:(CaptureDemand)demand
         completion:(void (^)(NSError* _Nullable error))completion;
- (void)releaseSlot:(NSUInteger)slot
           sequence:(uint64_t)sequence
        disposition:(NSString*)disposition;
- (void)stopWithCompletion:(void (^)(void))completion;
@property(nonatomic, readonly) NSString* sessionKey;
@property(nonatomic, readonly) uint64_t epoch;
@property(nonatomic, copy) void (^faultHandler)(NSDictionary<NSString*, id>* error);
@end

@implementation VfCaptureSession {
  NSString* _sessionKey;
  std::array<uint8_t, VF_CAPTURE_SESSION_KEY_BYTES> _sessionBytes;
  uint64_t _epoch;
  SCWindow* _window;
  CaptureCrop _crop;
  BOOL _captureCursor;
  CaptureDemand _demand;
  uint64_t _lastDemandRevision;
  mach_port_t _destination;
  std::array<uint8_t, VF_CAPTURE_CAPABILITY_BYTES> _capability;
  dispatch_queue_t _sampleQueue;
  SCStream* _stream;
  BOOL _capturing;
  BOOL _stopping;
  BOOL _faulted;
  uint64_t _sequence;
  double _logicalWidth;
  double _logicalHeight;
  struct {
    CMSampleBufferRef sample;
    uint64_t sequence;
    bool leased;
    bool quarantined;
  } _slots[2];
}

@synthesize faultHandler = _faultHandler;

- (instancetype)initWithSessionKey:(NSString*)session_key
                       sessionBytes:(const uint8_t*)session_bytes
                              epoch:(uint64_t)epoch
                             window:(SCWindow*)window
                               crop:(CaptureCrop)crop
                      captureCursor:(BOOL)capture_cursor
                             demand:(CaptureDemand)demand
                        destination:(mach_port_t)destination
                         capability:(const uint8_t*)capability {
  self = [super init];
  if (self != nil) {
    _sessionKey = [session_key copy];
    std::memcpy(_sessionBytes.data(), session_bytes, _sessionBytes.size());
    _epoch = epoch;
    _window = window;
    _crop = crop;
    _captureCursor = capture_cursor;
    _demand = demand;
    _lastDemandRevision = demand.revision;
    _destination = destination;
    std::memcpy(_capability.data(), capability, _capability.size());
    _sampleQueue = dispatch_queue_create(
        [[NSString stringWithFormat:@"com.jamesyong.vibefield.capture.%@", session_key]
            UTF8String],
        DISPATCH_QUEUE_SERIAL);
    _logicalWidth = crop.explicit_crop ? crop.rect.size.width : window.frame.size.width;
    _logicalHeight = crop.explicit_crop ? crop.rect.size.height : window.frame.size.height;
    for (auto& slot : _slots) slot = {nullptr, 0, false, false};
  }
  return self;
}

- (NSString*)sessionKey {
  return _sessionKey;
}

- (uint64_t)epoch {
  return _epoch;
}

- (SCStreamConfiguration*)configurationForDemand:(CaptureDemand)demand {
  SCContentFilter* filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:_window];
  CGFloat scale = 2.0;
  if (@available(macOS 14.0, *)) scale = std::max<CGFloat>(1.0, filter.pointPixelScale);
  SCStreamConfiguration* configuration = [[SCStreamConfiguration alloc] init];
  const CaptureRaster raster = FitRaster(_logicalWidth, _logicalHeight, scale, demand);
  configuration.width = raster.width;
  configuration.height = raster.height;
  configuration.minimumFrameInterval = CMTimeMake(1, std::max<NSInteger>(1, demand.fps));
  configuration.pixelFormat = kCVPixelFormatType_32BGRA;
  configuration.showsCursor = _captureCursor;
  configuration.queueDepth = 3;
  configuration.scalesToFit = YES;
  configuration.colorSpaceName = kCGColorSpaceSRGB;
  if (_crop.explicit_crop) configuration.sourceRect = _crop.rect;
  if (@available(macOS 14.0, *)) configuration.preservesAspectRatio = YES;
  if (@available(macOS 15.0, *)) configuration.captureDynamicRange = SCCaptureDynamicRangeSDR;
  return configuration;
}

- (void)startWithCompletion:(void (^)(NSError* _Nullable error))completion {
  SCContentFilter* filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:_window];
  _stream = [[SCStream alloc] initWithFilter:filter
                               configuration:[self configurationForDemand:_demand]
                                    delegate:self];
  NSError* output_error = nil;
  if (![_stream addStreamOutput:self
                           type:SCStreamOutputTypeScreen
             sampleHandlerQueue:_sampleQueue
                          error:&output_error]) {
    completion(output_error ?: [NSError errorWithDomain:@"VfCapture" code:1 userInfo:nil]);
    return;
  }
  [_stream startCaptureWithCompletionHandler:^(NSError* error) {
    dispatch_async(self->_sampleQueue, ^{
      self->_capturing = error == nil;
      completion(error);
    });
  }];
}

- (void)applyDemand:(CaptureDemand)demand
         completion:(void (^)(NSError* _Nullable error))completion {
  dispatch_async(_sampleQueue, ^{
    if (self->_stopping || demand.revision <= self->_lastDemandRevision) {
      completion([NSError errorWithDomain:@"VfCapture" code:2 userInfo:nil]);
      return;
    }
    self->_lastDemandRevision = demand.revision;
    self->_demand = demand;
    if (![demand.mode isEqualToString:@"live"]) {
      if (!self->_capturing) {
        completion(nil);
        return;
      }
      [self->_stream stopCaptureWithCompletionHandler:^(NSError* error) {
        dispatch_async(self->_sampleQueue, ^{
          self->_capturing = NO;
          completion(error);
        });
      }];
      return;
    }
    SCStreamConfiguration* configuration = [self configurationForDemand:demand];
    [self->_stream updateConfiguration:configuration
                     completionHandler:^(NSError* error) {
      if (error != nil) {
        completion(error);
        return;
      }
      dispatch_async(self->_sampleQueue, ^{
        if (self->_capturing) {
          completion(nil);
          return;
        }
        [self->_stream startCaptureWithCompletionHandler:^(NSError* start_error) {
          dispatch_async(self->_sampleQueue, ^{
            self->_capturing = start_error == nil;
            completion(start_error);
          });
        }];
      });
    }];
  });
}

- (void)stream:(SCStream*)stream
    didOutputSampleBuffer:(CMSampleBufferRef)sample_buffer
                  ofType:(SCStreamOutputType)type {
  (void)stream;
  if (type != SCStreamOutputTypeScreen || _stopping || _faulted) return;
  CFArrayRef attachment_array =
      CMSampleBufferGetSampleAttachmentsArray(sample_buffer, false);
  if (attachment_array == nullptr || CFArrayGetCount(attachment_array) == 0) return;
  NSDictionary* attachments = (__bridge NSDictionary*)CFArrayGetValueAtIndex(attachment_array, 0);
  NSNumber* raw_status = attachments[SCStreamFrameInfoStatus];
  if (raw_status == nil || raw_status.integerValue != SCFrameStatusComplete) return;
  if (!CMSampleBufferIsValid(sample_buffer)) return;
  CVImageBufferRef image = CMSampleBufferGetImageBuffer(sample_buffer);
  if (image == nullptr || CVPixelBufferGetPixelFormatType(image) != kCVPixelFormatType_32BGRA) return;
  IOSurfaceRef surface = CVPixelBufferGetIOSurface(image);
  if (surface == nullptr) return;
  NSUInteger slot_index = 2;
  for (NSUInteger index = 0; index < 2; ++index) {
    if (!_slots[index].leased) {
      slot_index = index;
      break;
    }
  }
  if (slot_index == 2) return;
  if (_sequence == std::numeric_limits<uint64_t>::max()) {
    [self fault:SurfaceError(@"protocol-violation", @"Capture sequence exhausted", @"permanent")];
    return;
  }
  const uint64_t sequence = ++_sequence;
  CFRetain(sample_buffer);
  _slots[slot_index] = {sample_buffer, sequence, true, false};

  VfCaptureFramePayload payload{};
  payload.magic = VF_CAPTURE_FRAME_MAGIC;
  payload.version = VF_CAPTURE_PROTOCOL_VERSION;
  std::memcpy(payload.capability, _capability.data(), _capability.size());
  std::memcpy(payload.session_key, _sessionBytes.data(), _sessionBytes.size());
  payload.producer_epoch = _epoch;
  payload.sequence = sequence;
  payload.timestamp_us = TimestampUs(CMSampleBufferGetPresentationTimeStamp(sample_buffer));
  payload.slot = static_cast<uint32_t>(slot_index);
  payload.width = static_cast<uint32_t>(CVPixelBufferGetWidth(image));
  payload.height = static_cast<uint32_t>(CVPixelBufferGetHeight(image));
  payload.bytes_per_row = static_cast<uint32_t>(CVPixelBufferGetBytesPerRow(image));
  payload.pixel_format = kCVPixelFormatType_32BGRA;
  payload.logical_width = _logicalWidth;
  payload.logical_height = _logicalHeight;
  if (!SendFrame(_destination, surface, payload)) {
    CFRelease(_slots[slot_index].sample);
    _slots[slot_index] = {nullptr, 0, false, false};
    [self fault:SurfaceError(@"producer-crashed", @"Capture frame handoff failed", @"automatic")];
  }
}

- (void)stream:(SCStream*)stream didStopWithError:(NSError*)error {
  (void)stream;
  dispatch_async(_sampleQueue, ^{
    self->_capturing = NO;
    if (!self->_stopping) {
      [self fault:SurfaceError(@"source-closed", @"The captured window stream stopped",
                               @"automatic")];
    }
    (void)error;
  });
}

- (void)releaseSlot:(NSUInteger)slot
           sequence:(uint64_t)sequence
        disposition:(NSString*)disposition {
  dispatch_async(_sampleQueue, ^{
    if (slot > 1 || !self->_slots[slot].leased || self->_slots[slot].sequence != sequence) {
      [self fault:SurfaceError(@"protocol-violation", @"Capture lease provenance did not match",
                               @"permanent")];
      return;
    }
    if ([disposition isEqualToString:@"quarantined"]) {
      self->_slots[slot].quarantined = true;
      return;
    }
    if (self->_slots[slot].quarantined) return;
    CFRelease(self->_slots[slot].sample);
    self->_slots[slot] = {nullptr, 0, false, false};
  });
}

- (void)stopWithCompletion:(void (^)(void))completion {
  dispatch_async(_sampleQueue, ^{
    if (self->_stopping) {
      completion();
      return;
    }
    self->_stopping = YES;
    void (^finish)(void) = ^{
      dispatch_async(self->_sampleQueue, ^{
        self->_capturing = NO;
        for (auto& slot : self->_slots) {
          if (slot.sample != nullptr) CFRelease(slot.sample);
          slot = {nullptr, 0, false, false};
        }
        completion();
      });
    };
    if (self->_capturing) [self->_stream stopCaptureWithCompletionHandler:^(__unused NSError* error) { finish(); }];
    else finish();
  });
}

- (void)fault:(NSDictionary<NSString*, id>*)error {
  if (_faulted || _stopping) return;
  _faulted = YES;
  if (_faultHandler != nil) _faultHandler(error);
}

- (void)dealloc {
  for (auto& slot : _slots) {
    if (slot.sample != nullptr) CFRelease(slot.sample);
    slot.sample = nullptr;
  }
}

@end

@interface VfCaptureHelper : NSObject
- (instancetype)initWithServiceName:(NSString*)service_name;
- (void)acceptCommand:(NSDictionary<NSString*, id>*)command;
- (void)requestShutdown;
@end

@implementation VfCaptureHelper {
  NSString* _serviceName;
  pid_t _parentPid;
  BOOL _authenticated;
  std::array<uint8_t, VF_CAPTURE_CAPABILITY_BYTES> _capability;
  mach_port_t _destination;
  NSMutableDictionary<NSString*, NSDictionary<NSString*, id>*>* _sources;
  NSMutableDictionary<NSString*, VfCaptureSession*>* _sessions;
  dispatch_queue_t _controlQueue;
  BOOL _shuttingDown;
}

- (instancetype)initWithServiceName:(NSString*)service_name {
  self = [super init];
  if (self != nil) {
    _serviceName = [service_name copy];
    _parentPid = getppid();
    _destination = MACH_PORT_NULL;
    _sources = [[NSMutableDictionary alloc] init];
    _sessions = [[NSMutableDictionary alloc] init];
    _controlQueue = dispatch_queue_create("com.jamesyong.vibefield.capture.control",
                                          DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

- (void)acceptCommand:(NSDictionary<NSString*, id>*)command {
  dispatch_async(_controlQueue, ^{
    if (self->_shuttingDown) return;
    id type = command[@"type"];
    if (![type isKindOfClass:[NSString class]]) {
      [self fatalProtocol:@"Capture command omitted its type"];
      return;
    }
    if ([type isEqualToString:@"hello"]) {
      [self hello:command];
      return;
    }
    if (!self->_authenticated || ![self authorize:command]) {
      [self fatalSecurity:@"Capture command authentication failed"];
      return;
    }
    if ([type isEqualToString:@"enumerate"]) [self enumerate:command];
    else if ([type isEqualToString:@"request-permission"]) [self requestPermission:command];
    else if ([type isEqualToString:@"start"]) [self start:command];
    else if ([type isEqualToString:@"demand"]) [self demand:command];
    else if ([type isEqualToString:@"release"]) [self release:command];
    else if ([type isEqualToString:@"stop"]) [self stop:command];
    else if ([type isEqualToString:@"shutdown"]) [self shutdownNow];
    else [self fatalProtocol:@"Capture command type was unknown"];
  });
}

- (BOOL)authorize:(NSDictionary<NSString*, id>*)command {
  uint8_t candidate[VF_CAPTURE_CAPABILITY_BYTES];
  return DecodeHex(command[@"token"], candidate, sizeof(candidate)) &&
         ConstantTimeEqual(candidate, _capability.data(), _capability.size());
}

- (void)hello:(NSDictionary<NSString*, id>*)command {
  NSString* request_id = command[@"requestId"];
  uint8_t candidate[VF_CAPTURE_CAPABILITY_BYTES];
  if (_authenticated || !BoundedString(request_id, 128) ||
      !SafeInteger(command[@"expectedParentPid"], 1, INT_MAX) ||
      [command[@"expectedParentPid"] intValue] != _parentPid || getppid() != _parentPid ||
      !DecodeHex(command[@"token"], candidate, sizeof(candidate))) {
    [self fatalSecurity:@"Capture helper parent handshake failed"];
    return;
  }
  mach_port_t destination = MACH_PORT_NULL;
  name_t bootstrap_name{};
  const std::string service([_serviceName UTF8String]);
  if (service.empty() || service.size() >= BOOTSTRAP_MAX_NAME_LEN) {
    [self fatalSecurity:@"Capture helper service name was invalid"];
    return;
  }
  std::memcpy(bootstrap_name, service.c_str(), service.size() + 1);
  const kern_return_t result = bootstrap_look_up(bootstrap_port, bootstrap_name, &destination);
  if (result != KERN_SUCCESS || destination == MACH_PORT_NULL) {
    [self fatalSecurity:@"Capture helper could not bind its parent receiver"];
    return;
  }
  std::memcpy(_capability.data(), candidate, sizeof(candidate));
  _destination = destination;
  _authenticated = YES;
  Emit(@{
    @"v" : @1,
    @"event" : @"ready",
    @"requestId" : request_id,
    @"protocolVersion" : @1,
    @"pid" : @(getpid()),
  });
}

- (void)enumerate:(NSDictionary<NSString*, id>*)command {
  NSString* request_id = command[@"requestId"];
  id all_spaces = command[@"allSpaces"];
  if (!BoundedString(request_id, 128) || ![all_spaces isKindOfClass:[NSNumber class]]) {
    [self fatalProtocol:@"Capture enumeration request was invalid"];
    return;
  }
  [SCShareableContent
      getShareableContentExcludingDesktopWindows:NO
                        onScreenWindowsOnly:![all_spaces boolValue]
                           completionHandler:^(SCShareableContent* content, NSError* error) {
    dispatch_async(self->_controlQueue, ^{
      if (error != nil || content == nil) {
        const BOOL denied = !CGPreflightScreenCaptureAccess();
        EmitError(request_id,
                  denied ? SurfaceError(@"permission-denied", @"Screen Recording permission is required",
                                        @"user-action")
                         : SurfaceError(@"producer-crashed", @"Screen sources could not be enumerated",
                                        @"automatic"));
        return;
      }
      [self->_sources removeAllObjects];
      NSMutableArray* output = [[NSMutableArray alloc] init];
      for (SCWindow* window in content.windows) {
        if (output.count >= kMaximumSources) break;
        SCRunningApplication* owner = window.owningApplication;
        if (owner == nil || owner.processID == getpid() || owner.processID == self->_parentPid ||
            window.title.length == 0 || owner.applicationName.length == 0 ||
            window.frame.size.width <= 1 || window.frame.size.height <= 1 ||
            [owner.bundleIdentifier isEqualToString:@"com.jamesyong.vibefield"]) {
          continue;
        }
        NSString* source_ref = RandomSourceRef();
        NSDictionary* record = @{
          @"sourceRef" : source_ref,
          @"window" : window,
          @"windowId" : @(window.windowID),
          @"ownerPid" : @(owner.processID),
        };
        self->_sources[source_ref] = record;
        NSString* application_name = CleanText(owner.applicationName, @"Unknown application");
        NSString* bundle_identifier = CleanText(owner.bundleIdentifier, @"-");
        NSString* title = CleanText(window.title, @"Untitled window");
        [output addObject:@{
          @"sourceRef" : source_ref,
          @"applicationName" : application_name,
          @"bundleIdentifier" : bundle_identifier,
          @"title" : title,
          @"windowId" : @(window.windowID),
          @"ownerPid" : @(owner.processID),
          @"frame" : @{
            @"x" : @(window.frame.origin.x), @"y" : @(window.frame.origin.y),
            @"width" : @(window.frame.size.width), @"height" : @(window.frame.size.height),
          },
          @"onScreen" : @(window.isOnScreen),
        }];
      }
      Emit(@{ @"v" : @1, @"event" : @"sources", @"requestId" : request_id,
              @"sources" : output });
    });
  }];
}

- (void)requestPermission:(NSDictionary<NSString*, id>*)command {
  NSString* request_id = command[@"requestId"];
  if (!BoundedString(request_id, 128)) {
    [self fatalProtocol:@"Capture permission request was invalid"];
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    const BOOL granted = CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess();
    Emit(@{ @"v" : @1, @"event" : @"permission", @"requestId" : request_id,
            @"granted" : @(granted) });
  });
}

- (void)start:(NSDictionary<NSString*, id>*)command {
  NSString* request_id = command[@"requestId"];
  NSString* session_key = command[@"sessionKey"];
  NSString* source_ref = command[@"sourceRef"];
  std::array<uint8_t, VF_CAPTURE_SESSION_KEY_BYTES> session_bytes{};
  CaptureDemand demand;
  CaptureCrop crop;
  if (!BoundedString(request_id, 128) ||
      !DecodeHex(session_key, session_bytes.data(), session_bytes.size()) ||
      !SafeInteger(command[@"producerEpoch"]) || !BoundedString(source_ref) ||
      !ParseDemand(command[@"demand"], &demand) || ![demand.mode isEqualToString:@"live"] ||
      !ParseCrop(command[@"crop"], &crop) ||
      ![command[@"captureCursor"] isKindOfClass:[NSNumber class]] ||
      _sessions.count >= kMaximumSessions || _sessions[session_key] != nil) {
    [self fatalProtocol:@"Capture start request was invalid"];
    return;
  }
  NSDictionary* source = _sources[source_ref];
  if (source == nil) {
    EmitError(request_id, SurfaceError(@"source-not-found", @"The selected window is stale",
                                       @"user-action"));
    return;
  }
  const CGWindowID wanted_window = [source[@"windowId"] unsignedIntValue];
  const pid_t wanted_pid = [source[@"ownerPid"] intValue];
  [SCShareableContent
      getShareableContentExcludingDesktopWindows:NO
                        onScreenWindowsOnly:NO
                           completionHandler:^(SCShareableContent* content, NSError* error) {
    dispatch_async(self->_controlQueue, ^{
      if (error != nil || content == nil) {
        EmitError(request_id,
                  !CGPreflightScreenCaptureAccess()
                      ? SurfaceError(@"permission-denied", @"Screen Recording permission is required",
                                     @"user-action")
                      : SurfaceError(@"producer-crashed", @"Capture source validation failed",
                                     @"automatic"));
        return;
      }
      SCWindow* current = nil;
      for (SCWindow* window in content.windows) {
        if (window.windowID == wanted_window && window.owningApplication.processID == wanted_pid) {
          current = window;
          break;
        }
      }
      if (current == nil || wanted_pid == self->_parentPid || wanted_pid == getpid()) {
        EmitError(request_id, SurfaceError(@"source-not-found", @"The selected window closed",
                                           @"user-action"));
        return;
      }
      if (crop.explicit_crop &&
          (CGRectGetMaxX(crop.rect) > current.frame.size.width ||
           CGRectGetMaxY(crop.rect) > current.frame.size.height)) {
        EmitError(request_id, SurfaceError(@"source-not-found", @"Capture crop exceeds the selected window",
                                           @"user-action"));
        return;
      }
      const uint64_t epoch = [command[@"producerEpoch"] unsignedLongLongValue];
      VfCaptureSession* session = [[VfCaptureSession alloc]
          initWithSessionKey:session_key
               sessionBytes:session_bytes.data()
                      epoch:epoch
                     window:current
                       crop:crop
              captureCursor:[command[@"captureCursor"] boolValue]
                     demand:demand
                destination:self->_destination
                 capability:self->_capability.data()];
      __weak VfCaptureHelper* weak_self = self;
      session.faultHandler = ^(NSDictionary<NSString*, id>* session_error) {
        VfCaptureHelper* strong_self = weak_self;
        if (strong_self == nil) return;
        dispatch_async(strong_self->_controlQueue, ^{
          if (strong_self->_sessions[session_key] != session) return;
          Emit(@{ @"v" : @1, @"event" : @"session-fault", @"sessionKey" : session_key,
                  @"error" : session_error });
        });
      };
      self->_sessions[session_key] = session;
      [session startWithCompletion:^(NSError* start_error) {
        dispatch_async(self->_controlQueue, ^{
          if (start_error != nil) {
            [self->_sessions removeObjectForKey:session_key];
            EmitError(request_id,
                      !CGPreflightScreenCaptureAccess()
                          ? SurfaceError(@"permission-denied", @"Screen Recording permission is required",
                                         @"user-action")
                          : SurfaceError(@"producer-crashed", @"Screen capture could not start",
                                         @"automatic"));
            return;
          }
          Emit(@{ @"v" : @1, @"event" : @"started", @"requestId" : request_id,
                  @"sessionKey" : session_key });
        });
      }];
    });
  }];
}

- (VfCaptureSession*)sessionForCommand:(NSDictionary<NSString*, id>*)command
                             requestId:(NSString*)request_id {
  NSString* session_key = command[@"sessionKey"];
  std::array<uint8_t, VF_CAPTURE_SESSION_KEY_BYTES> scratch{};
  if (!DecodeHex(session_key, scratch.data(), scratch.size()) ||
      !SafeInteger(command[@"producerEpoch"])) {
    if (request_id != nil) [self fatalProtocol:@"Capture session identity was invalid"];
    return nil;
  }
  VfCaptureSession* session = _sessions[session_key];
  if (session == nil || session.epoch != [command[@"producerEpoch"] unsignedLongLongValue]) {
    if (request_id != nil) {
      EmitError(request_id, SurfaceError(@"source-closed", @"Capture session is no longer active",
                                         @"automatic"));
    }
    return nil;
  }
  return session;
}

- (void)demand:(NSDictionary<NSString*, id>*)command {
  NSString* request_id = command[@"requestId"];
  CaptureDemand demand;
  if (!BoundedString(request_id, 128) || !ParseDemand(command[@"demand"], &demand)) {
    [self fatalProtocol:@"Capture demand request was invalid"];
    return;
  }
  VfCaptureSession* session = [self sessionForCommand:command requestId:request_id];
  if (session == nil) return;
  [session applyDemand:demand
            completion:^(NSError* error) {
    if (error != nil) {
      EmitError(request_id, SurfaceError(@"producer-crashed", @"Capture demand update failed",
                                         @"automatic"));
      return;
    }
    Emit(@{ @"v" : @1, @"event" : @"demand-applied", @"requestId" : request_id });
  }];
}

- (void)release:(NSDictionary<NSString*, id>*)command {
  VfCaptureSession* session = [self sessionForCommand:command requestId:nil];
  id sequence = command[@"sequence"];
  id slot = command[@"slot"];
  id disposition = command[@"disposition"];
  if (session == nil || !BoundedString(sequence, 20) ||
      !SafeInteger(slot, 0, 1) || ![disposition isKindOfClass:[NSString class]] ||
      ![@[ @"released", @"dropped", @"quarantined" ] containsObject:disposition]) {
    [self fatalProtocol:@"Capture release provenance was invalid"];
    return;
  }
  const char* raw = [(NSString*)sequence UTF8String];
  if ([(NSString*)sequence length] > 1 && raw[0] == '0') {
    [self fatalProtocol:@"Capture release sequence was non-canonical"];
    return;
  }
  char* end = nullptr;
  errno = 0;
  const unsigned long long parsed = strtoull(raw, &end, 10);
  if (errno != 0 || end == raw || *end != '\0') {
    [self fatalProtocol:@"Capture release sequence was invalid"];
    return;
  }
  [session releaseSlot:[slot unsignedIntegerValue]
              sequence:parsed
           disposition:disposition];
}

- (void)stop:(NSDictionary<NSString*, id>*)command {
  NSString* request_id = command[@"requestId"];
  if (!BoundedString(request_id, 128)) {
    [self fatalProtocol:@"Capture stop request was invalid"];
    return;
  }
  VfCaptureSession* session = [self sessionForCommand:command requestId:request_id];
  if (session == nil) return;
  NSString* session_key = session.sessionKey;
  [session stopWithCompletion:^{
    dispatch_async(self->_controlQueue, ^{
      if (self->_sessions[session_key] == session) {
        [self->_sessions removeObjectForKey:session_key];
      }
      Emit(@{ @"v" : @1, @"event" : @"stopped", @"requestId" : request_id });
    });
  }];
}

- (void)fatalProtocol:(NSString*)message {
  Emit(@{ @"v" : @1, @"event" : @"helper-fault",
          @"error" : SurfaceError(@"protocol-violation", message, @"permanent") });
  [self shutdownNow];
}

- (void)fatalSecurity:(NSString*)message {
  Emit(@{ @"v" : @1, @"event" : @"helper-fault",
          @"error" : SurfaceError(@"security-rejected", message, @"permanent") });
  [self shutdownNow];
}

- (void)requestShutdown {
  dispatch_async(_controlQueue, ^{ [self shutdownNow]; });
}

- (void)shutdownNow {
  if (_shuttingDown) return;
  _shuttingDown = YES;
  NSArray<VfCaptureSession*>* sessions = _sessions.allValues;
  [_sessions removeAllObjects];
  if (sessions.count == 0) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 20 * NSEC_PER_MSEC),
                   dispatch_get_main_queue(), ^{ [NSApp terminate:nil]; });
    return;
  }
  dispatch_group_t group = dispatch_group_create();
  for (VfCaptureSession* session in sessions) {
    dispatch_group_enter(group);
    [session stopWithCompletion:^{ dispatch_group_leave(group); }];
  }
  dispatch_group_notify(group, dispatch_get_main_queue(), ^{ [NSApp terminate:nil]; });
}

- (void)dealloc {
  if (_destination != MACH_PORT_NULL) mach_port_deallocate(mach_task_self(), _destination);
}

@end

int main(int argc, const char* argv[]) {
  @autoreleasepool {
    signal(SIGPIPE, SIG_IGN);
    if (argc != 3 || std::strcmp(argv[1], "--mach-service") != 0 ||
        std::strlen(argv[2]) == 0 || std::strlen(argv[2]) >= BOOTSTRAP_MAX_NAME_LEN) {
      return 64;
    }
    NSApplication* application = [NSApplication sharedApplication];
    [application setActivationPolicy:NSApplicationActivationPolicyAccessory];
    VfCaptureHelper* helper =
        [[VfCaptureHelper alloc] initWithServiceName:[NSString stringWithUTF8String:argv[2]]];
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      NSFileHandle* input = [NSFileHandle fileHandleWithStandardInput];
      NSMutableData* buffer = [[NSMutableData alloc] init];
      for (;;) {
        @autoreleasepool {
          NSData* chunk = nil;
          @try {
            chunk = [input availableData];
          } @catch (__unused NSException* exception) {
            chunk = nil;
          }
          if (chunk.length == 0) break;
          [buffer appendData:chunk];
          if (buffer.length > kMaximumJsonLineBytes) {
            Emit(@{ @"v" : @1, @"event" : @"helper-fault",
                    @"error" : SurfaceError(@"protocol-violation", @"Capture command exceeded its bound",
                                             @"permanent") });
            break;
          }
          for (;;) {
            const uint8_t* bytes = static_cast<const uint8_t*>(buffer.bytes);
            NSUInteger newline = NSNotFound;
            for (NSUInteger index = 0; index < buffer.length; ++index) {
              if (bytes[index] == '\n') {
                newline = index;
                break;
              }
            }
            if (newline == NSNotFound) break;
            NSData* line = [buffer subdataWithRange:NSMakeRange(0, newline)];
            [buffer replaceBytesInRange:NSMakeRange(0, newline + 1) withBytes:nullptr length:0];
            if (line.length == 0) continue;
            NSError* error = nil;
            id value = [NSJSONSerialization JSONObjectWithData:line options:0 error:&error];
            if (error != nil || ![value isKindOfClass:[NSDictionary class]]) {
              Emit(@{ @"v" : @1, @"event" : @"helper-fault",
                      @"error" : SurfaceError(@"protocol-violation", @"Capture command was malformed",
                                               @"permanent") });
              [helper requestShutdown];
              return;
            }
            [helper acceptCommand:value];
          }
        }
      }
      [helper requestShutdown];
    });
    [application run];
    return 0;
  }
}
