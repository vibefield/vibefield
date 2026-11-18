#pragma once

#import <CoreVideo/CoreVideo.h>
#import <Foundation/Foundation.h>

// Device-scoped CoreSimulator display and HID connection. All methods and callbacks run on the supplied serial queue.
@interface VfSimulatorFramebuffer : NSObject
- (instancetype)initWithDevice:(NSString*)udid
                         queue:(dispatch_queue_t)queue
                      hasSpace:(BOOL (^)(void))hasSpace
                       deliver:(void (^)(CVPixelBufferRef, double, double))deliver;
- (BOOL)start;
- (void)setFPS:(NSInteger)fps width:(size_t)width height:(size_t)height;
- (void)capacityAvailable;
- (void)input:(NSDictionary*)event;
- (void)stop;
@end
