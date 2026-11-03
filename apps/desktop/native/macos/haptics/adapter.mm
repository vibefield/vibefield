#import <AppKit/AppKit.h>
#include <node_api.h>

// AppKit chooses the performer from the active device, accessibility settings
// and system preferences on EVERY call. There is no device handle to retain.
static napi_value Alignment(napi_env env, napi_callback_info info) {
  (void)info;
  bool requested = false;
  @autoreleasepool {
    // Electron main calls this on its AppKit thread. A Node-only process, a
    // worker thread or an inactive application must not produce feedback.
    if ([NSThread isMainThread] && NSApp != nil && [NSApp isActive]) {
      [[NSHapticFeedbackManager defaultPerformer]
          performFeedbackPattern:NSHapticFeedbackPatternAlignment
          performanceTime:NSHapticFeedbackPerformanceTimeNow];
      requested = true;
    }
  }
  napi_value result;
  napi_get_boolean(env, requested, &result);
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor descriptor = {
      "alignment", nullptr, Alignment, nullptr, nullptr, nullptr, napi_default, nullptr};
  napi_define_properties(env, exports, 1, &descriptor);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
