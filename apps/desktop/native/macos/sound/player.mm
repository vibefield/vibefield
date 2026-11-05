#import <AudioToolbox/AudioToolbox.h>
#import <Foundation/Foundation.h>
#include <node_api.h>

#include <vector>

// SD-2 (DESIGN.md §14 "In VibeField", SD-D21): the field's sounds play through macOS's system-sound path, so they
// follow the alert volume and the "Play sound effects through" device like every other alert on the Mac. Each plays
// as a system sound, never as an alert sound (AudioServicesPlayAlertSound may flash the screen), and with
// kAudioServicesPropertyIsUISound off, so "Play user interface sound effects" does not silence an agent's state: it
// is not an interface sound (S1). `play(path)` answers a Promise of the OSStatus: 0 once the system has played the
// file to its end, or the status that refused it. One SystemSoundID per play, disposed at its completion.

namespace {

struct Pending {
  napi_deferred deferred;
  OSStatus status;
};

void Settle(napi_env env, napi_value js_callback, void* context, void* data) {
  (void)js_callback;
  (void)context;
  Pending* pending = static_cast<Pending*>(data);
  if (env != nullptr) {
    napi_value status;
    napi_create_int32(env, static_cast<int32_t>(pending->status), &status);
    napi_resolve_deferred(env, pending->deferred, status);
  }
  delete pending;
}

napi_value Resolved(napi_env env, napi_deferred deferred, napi_value promise, OSStatus status) {
  napi_value value;
  napi_create_int32(env, static_cast<int32_t>(status), &value);
  napi_resolve_deferred(env, deferred, value);
  return promise;
}

napi_value Play(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  napi_value promise;
  napi_deferred deferred;
  napi_create_promise(env, &deferred, &promise);

  size_t length = 0;
  if (argc < 1 || napi_get_value_string_utf8(env, argv[0], nullptr, 0, &length) != napi_ok || length == 0) {
    napi_value message;
    napi_value error;
    napi_create_string_utf8(env, "play(path) takes a file path", NAPI_AUTO_LENGTH, &message);
    napi_create_type_error(env, nullptr, message, &error);
    napi_reject_deferred(env, deferred, error);
    return promise;
  }
  std::vector<char> path(length + 1, '\0');
  napi_get_value_string_utf8(env, argv[0], path.data(), path.size(), &length);

  SystemSoundID sound = 0;
  OSStatus status = noErr;
  @autoreleasepool {
    NSString* file = [[NSString alloc] initWithBytes:path.data() length:length encoding:NSUTF8StringEncoding];
    if (file == nil) return Resolved(env, deferred, promise, kAudioServicesBadSpecifierSizeError);
    NSURL* url = [NSURL fileURLWithPath:file];
    status = AudioServicesCreateSystemSoundID((__bridge CFURLRef)url, &sound);
  }
  if (status != noErr) return Resolved(env, deferred, promise, status);

  UInt32 interfaceSound = 0;
  status = AudioServicesSetProperty(kAudioServicesPropertyIsUISound, sizeof(sound), &sound, sizeof(interfaceSound),
                                    &interfaceSound);
  if (status != noErr) {
    AudioServicesDisposeSystemSoundID(sound);
    return Resolved(env, deferred, promise, status);
  }

  napi_value name;
  napi_create_string_utf8(env, "vibefield.sound.play", NAPI_AUTO_LENGTH, &name);
  napi_threadsafe_function settle = nullptr;
  if (napi_create_threadsafe_function(env, nullptr, nullptr, name, 0, 1, nullptr, nullptr, nullptr, Settle,
                                      &settle) != napi_ok) {
    AudioServicesDisposeSystemSoundID(sound);
    return Resolved(env, deferred, promise, kAudioServicesSystemSoundUnspecifiedError);
  }
  Pending* pending = new Pending{deferred, noErr};
  AudioServicesPlaySystemSoundWithCompletion(sound, ^{
    AudioServicesDisposeSystemSoundID(sound);
    napi_call_threadsafe_function(settle, pending, napi_tsfn_nonblocking);
    napi_release_threadsafe_function(settle, napi_tsfn_release);
  });
  return promise;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor descriptor = {"play", nullptr, Play, nullptr, nullptr, nullptr, napi_default, nullptr};
  napi_define_properties(env, exports, 1, &descriptor);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
