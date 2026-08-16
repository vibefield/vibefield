#include <ApplicationServices/ApplicationServices.h>
#include <CoreVideo/CoreVideo.h>
#include <IOSurface/IOSurface.h>
#include <bsm/libbsm.h>
#include <bootstrap.h>
#include <mach/mach.h>
#include <node_api.h>

#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <deque>
#include <limits>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include "protocol.h"

namespace {

constexpr size_t kMaximumQueuedFrames = 32;
constexpr uint64_t kMaximumSafeInteger = 9007199254740991ULL;
static_assert(sizeof(void*) == 8, "Electron IOSurface handles require a 64-bit process");

struct FrameRecord {
  uint64_t id = 0;
  VfCaptureFramePayload payload{};
  IOSurfaceRef surface = nullptr;
};

struct AdapterState {
  std::mutex mutex;
  std::deque<std::unique_ptr<FrameRecord>> pending;
  std::unordered_map<uint64_t, IOSurfaceRef> outstanding;
  std::thread receiver;
  std::atomic<bool> running{false};
  std::atomic<pid_t> expected_peer_pid{0};
  mach_port_t receive_port = MACH_PORT_NULL;
  std::string service_name;
  uint8_t capability[VF_CAPTURE_CAPABILITY_BYTES]{};
  uint64_t next_frame_id = 1;
  uint64_t received = 0;
  uint64_t accepted = 0;
  uint64_t rejected_identity = 0;
  uint64_t rejected_capability = 0;
  uint64_t rejected_protocol = 0;
  std::string fatal_error;
};

AdapterState g_state;

void ReleaseRecord(std::unique_ptr<FrameRecord>& record) {
  if (record && record->surface != nullptr) {
    CFRelease(record->surface);
    record->surface = nullptr;
  }
}

bool DecodeHex(const std::string& input, uint8_t* output, size_t output_size) {
  if (input.size() != output_size * 2) return false;
  auto digit = [](char value) -> int {
    if (value >= '0' && value <= '9') return value - '0';
    if (value >= 'a' && value <= 'f') return value - 'a' + 10;
    return -1;
  };
  for (size_t index = 0; index < output_size; ++index) {
    const int high = digit(input[index * 2]);
    const int low = digit(input[index * 2 + 1]);
    if (high < 0 || low < 0) return false;
    output[index] = static_cast<uint8_t>((high << 4) | low);
  }
  return true;
}

std::string EncodeHex(const uint8_t* input, size_t size) {
  static constexpr char kDigits[] = "0123456789abcdef";
  std::string output(size * 2, '0');
  for (size_t index = 0; index < size; ++index) {
    output[index * 2] = kDigits[input[index] >> 4];
    output[index * 2 + 1] = kDigits[input[index] & 0x0f];
  }
  return output;
}

bool CapabilityMatches(const uint8_t* candidate) {
  uint8_t difference = 0;
  for (size_t index = 0; index < VF_CAPTURE_CAPABILITY_BYTES; ++index) {
    difference |= candidate[index] ^ g_state.capability[index];
  }
  return difference == 0;
}

bool ValidPayload(const VfCaptureFramePayload& payload) {
  if (payload.magic != VF_CAPTURE_FRAME_MAGIC ||
      payload.version != VF_CAPTURE_PROTOCOL_VERSION || payload.reserved != 0 ||
      payload.reserved2 != 0 || payload.producer_epoch > kMaximumSafeInteger ||
      payload.slot > 1 || payload.width == 0 || payload.height == 0 ||
      payload.width > 16384 || payload.height > 16384 ||
      static_cast<uint64_t>(payload.width) * payload.height > 67108864ULL ||
      payload.bytes_per_row < payload.width * 4ULL ||
      payload.pixel_format != kCVPixelFormatType_32BGRA ||
      !std::isfinite(payload.logical_width) || !std::isfinite(payload.logical_height) ||
      payload.logical_width <= 0 || payload.logical_height <= 0 ||
      payload.logical_width > 32768 || payload.logical_height > 32768) {
    return false;
  }
  return true;
}

void SetFatalLocked(const char* message) {
  if (g_state.fatal_error.empty()) g_state.fatal_error = message;
  g_state.rejected_protocol += 1;
}

void ReceiveFrames() {
  while (g_state.running.load(std::memory_order_acquire)) {
    VfCaptureReceiveBuffer buffer{};
    const mach_msg_option_t options =
        MACH_RCV_MSG | MACH_RCV_TIMEOUT |
        MACH_RCV_TRAILER_TYPE(MACH_MSG_TRAILER_FORMAT_0) |
        MACH_RCV_TRAILER_ELEMENTS(MACH_RCV_TRAILER_AUDIT);
    const mach_msg_return_t result = mach_msg(
        &buffer.message.header, options, 0, sizeof(buffer), g_state.receive_port, 100,
        MACH_PORT_NULL);
    if (result == MACH_RCV_TIMED_OUT || result == MACH_RCV_INTERRUPTED) continue;
    if (result != MACH_MSG_SUCCESS) {
      if (!g_state.running.load(std::memory_order_acquire)) break;
      std::lock_guard<std::mutex> lock(g_state.mutex);
      SetFatalLocked("native capture receiver failed");
      break;
    }

    mach_port_t transferred_port = MACH_PORT_NULL;
    const bool has_descriptor =
        buffer.message.header.msgh_size >= sizeof(VfCaptureFrameMessage) &&
        (buffer.message.header.msgh_bits & MACH_MSGH_BITS_COMPLEX) != 0 &&
        buffer.message.body.msgh_descriptor_count == 1 &&
        buffer.message.surface_port.type == MACH_MSG_PORT_DESCRIPTOR;
    if (has_descriptor) transferred_port = buffer.message.surface_port.name;

    {
      std::lock_guard<std::mutex> lock(g_state.mutex);
      g_state.received += 1;
    }

    const auto message_size = buffer.message.header.msgh_size;
    const auto rounded_size = (message_size + sizeof(natural_t) - 1) & ~(sizeof(natural_t) - 1);
    const auto* trailer = reinterpret_cast<const mach_msg_audit_trailer_t*>(
        reinterpret_cast<const uint8_t*>(&buffer.message.header) + rounded_size);
    const bool valid_trailer =
        rounded_size + sizeof(mach_msg_audit_trailer_t) <= sizeof(buffer) &&
        trailer->msgh_trailer_type == MACH_MSG_TRAILER_FORMAT_0 &&
        trailer->msgh_trailer_size >= sizeof(mach_msg_audit_trailer_t);
    const pid_t sender_pid = valid_trailer ? audit_token_to_pid(trailer->msgh_audit) : 0;
    const pid_t expected_pid = g_state.expected_peer_pid.load(std::memory_order_acquire);
    if (expected_pid <= 0 || sender_pid != expected_pid) {
      if (transferred_port != MACH_PORT_NULL) {
        mach_port_deallocate(mach_task_self(), transferred_port);
      }
      std::lock_guard<std::mutex> lock(g_state.mutex);
      g_state.rejected_identity += 1;
      continue;
    }

    if (!has_descriptor || buffer.message.header.msgh_id != VF_CAPTURE_FRAME_MESSAGE_ID ||
        message_size != sizeof(VfCaptureFrameMessage)) {
      if (transferred_port != MACH_PORT_NULL) {
        mach_port_deallocate(mach_task_self(), transferred_port);
      }
      std::lock_guard<std::mutex> lock(g_state.mutex);
      SetFatalLocked("capture helper sent malformed Mach frame metadata");
      continue;
    }

    const VfCaptureFramePayload payload = buffer.message.payload;
    if (!CapabilityMatches(payload.capability)) {
      mach_port_deallocate(mach_task_self(), transferred_port);
      std::lock_guard<std::mutex> lock(g_state.mutex);
      g_state.rejected_capability += 1;
      continue;
    }
    if (!ValidPayload(payload)) {
      mach_port_deallocate(mach_task_self(), transferred_port);
      std::lock_guard<std::mutex> lock(g_state.mutex);
      SetFatalLocked("capture helper sent invalid frame bounds");
      continue;
    }

    IOSurfaceRef surface = IOSurfaceLookupFromMachPort(transferred_port);
    mach_port_deallocate(mach_task_self(), transferred_port);
    if (surface == nullptr || IOSurfaceGetWidth(surface) != payload.width ||
        IOSurfaceGetHeight(surface) != payload.height ||
        IOSurfaceGetBytesPerRow(surface) != payload.bytes_per_row ||
        IOSurfaceGetPixelFormat(surface) != payload.pixel_format) {
      if (surface != nullptr) CFRelease(surface);
      std::lock_guard<std::mutex> lock(g_state.mutex);
      SetFatalLocked("capture helper IOSurface did not match its metadata");
      continue;
    }

    auto record = std::make_unique<FrameRecord>();
    record->payload = payload;
    record->surface = surface;
    {
      std::lock_guard<std::mutex> lock(g_state.mutex);
      if (g_state.pending.size() + g_state.outstanding.size() >= kMaximumQueuedFrames) {
        SetFatalLocked("native capture frame queue exceeded its fixed bound");
        ReleaseRecord(record);
        continue;
      }
      if (g_state.next_frame_id == 0) {
        SetFatalLocked("native capture frame identity exhausted");
        ReleaseRecord(record);
        continue;
      }
      record->id = g_state.next_frame_id++;
      g_state.accepted += 1;
      g_state.pending.push_back(std::move(record));
    }
  }
}

void StopAdapter() {
  const bool was_running = g_state.running.exchange(false, std::memory_order_acq_rel);
  if (was_running && g_state.receiver.joinable()) g_state.receiver.join();
  if (g_state.receiver.joinable()) g_state.receiver.join();
  if (g_state.receive_port != MACH_PORT_NULL) {
    mach_port_destroy(mach_task_self(), g_state.receive_port);
    g_state.receive_port = MACH_PORT_NULL;
  }
  std::lock_guard<std::mutex> lock(g_state.mutex);
  for (auto& record : g_state.pending) ReleaseRecord(record);
  g_state.pending.clear();
  for (const auto& [id, surface] : g_state.outstanding) {
    (void)id;
    CFRelease(surface);
  }
  g_state.outstanding.clear();
  g_state.expected_peer_pid.store(0, std::memory_order_release);
  g_state.service_name.clear();
  std::memset(g_state.capability, 0, sizeof(g_state.capability));
  g_state.fatal_error.clear();
}

void Throw(napi_env env, const char* message) { napi_throw_error(env, nullptr, message); }

bool GetString(napi_env env, napi_value value, std::string* output) {
  size_t size = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &size) != napi_ok || size > 1024) {
    return false;
  }
  std::string result(size + 1, '\0');
  size_t written = 0;
  if (napi_get_value_string_utf8(env, value, result.data(), result.size(), &written) != napi_ok ||
      written != size) {
    return false;
  }
  result.resize(size);
  *output = std::move(result);
  return true;
}

bool ParseU64(const std::string& input, uint64_t* output) {
  if (input.empty() || input.size() > 20) return false;
  uint64_t value = 0;
  for (const char character : input) {
    if (character < '0' || character > '9') return false;
    const uint64_t digit = static_cast<uint64_t>(character - '0');
    if (value > (std::numeric_limits<uint64_t>::max() - digit) / 10) return false;
    value = value * 10 + digit;
  }
  if (input.size() > 1 && input[0] == '0') return false;
  *output = value;
  return true;
}

bool SetNamed(napi_env env, napi_value object, const char* name, napi_value value) {
  return napi_set_named_property(env, object, name, value) == napi_ok;
}

bool SetString(napi_env env, napi_value object, const char* name, const std::string& value) {
  napi_value string;
  return napi_create_string_utf8(env, value.data(), value.size(), &string) == napi_ok &&
         SetNamed(env, object, name, string);
}

bool SetNumber(napi_env env, napi_value object, const char* name, double value) {
  napi_value number;
  return napi_create_double(env, value, &number) == napi_ok && SetNamed(env, object, name, number);
}

bool GetNamedNumber(napi_env env, napi_value object, const char* name, double* output) {
  napi_value value;
  double number = 0;
  if (napi_get_named_property(env, object, name, &value) != napi_ok ||
      napi_get_value_double(env, value, &number) != napi_ok || !std::isfinite(number)) {
    return false;
  }
  *output = number;
  return true;
}

bool CopyAxFrame(AXUIElementRef element, CGRect* output) {
  CFTypeRef raw_position = nullptr;
  CFTypeRef raw_size = nullptr;
  CGPoint position{};
  CGSize size{};
  const bool valid =
      AXUIElementCopyAttributeValue(element, kAXPositionAttribute, &raw_position) == kAXErrorSuccess &&
      AXUIElementCopyAttributeValue(element, kAXSizeAttribute, &raw_size) == kAXErrorSuccess &&
      raw_position != nullptr && raw_size != nullptr &&
      CFGetTypeID(raw_position) == AXValueGetTypeID() &&
      CFGetTypeID(raw_size) == AXValueGetTypeID() &&
      AXValueGetType(static_cast<AXValueRef>(raw_position)) == kAXValueCGPointType &&
      AXValueGetType(static_cast<AXValueRef>(raw_size)) == kAXValueCGSizeType &&
      AXValueGetValue(static_cast<AXValueRef>(raw_position),
                      static_cast<AXValueType>(kAXValueCGPointType), &position) &&
      AXValueGetValue(static_cast<AXValueRef>(raw_size),
                      static_cast<AXValueType>(kAXValueCGSizeType), &size) &&
      std::isfinite(position.x) && std::isfinite(position.y) && std::isfinite(size.width) &&
      std::isfinite(size.height) && size.width > 0 && size.height > 0;
  if (raw_position != nullptr) CFRelease(raw_position);
  if (raw_size != nullptr) CFRelease(raw_size);
  if (!valid) return false;
  *output = CGRectMake(position.x, position.y, size.width, size.height);
  return true;
}

bool AxStringEquals(AXUIElementRef element, CFStringRef attribute, CFStringRef wanted) {
  CFTypeRef raw = nullptr;
  const bool matches =
      AXUIElementCopyAttributeValue(element, attribute, &raw) == kAXErrorSuccess && raw != nullptr &&
      CFGetTypeID(raw) == CFStringGetTypeID() &&
      CFStringCompare(static_cast<CFStringRef>(raw), wanted, 0) == kCFCompareEqualTo;
  if (raw != nullptr) CFRelease(raw);
  return matches;
}

std::string CopyAxString(AXUIElementRef element, CFStringRef attribute) {
  CFTypeRef raw = nullptr;
  if (AXUIElementCopyAttributeValue(element, attribute, &raw) != kAXErrorSuccess ||
      raw == nullptr || CFGetTypeID(raw) != CFStringGetTypeID()) {
    if (raw != nullptr) CFRelease(raw);
    return {};
  }
  const CFStringRef string = static_cast<CFStringRef>(raw);
  const CFIndex length = CFStringGetLength(string);
  const CFIndex maximum =
      CFStringGetMaximumSizeForEncoding(std::min<CFIndex>(length, 1024), kCFStringEncodingUTF8) + 1;
  std::string output(static_cast<size_t>(std::max<CFIndex>(maximum, 1)), '\0');
  if (!CFStringGetCString(string, output.data(), maximum, kCFStringEncodingUTF8)) output.clear();
  else output.resize(std::strlen(output.c_str()));
  CFRelease(raw);
  return output;
}

void AddAxCandidate(std::vector<AXUIElementRef>* output, AXUIElementRef candidate) {
  if (candidate == nullptr) return;
  for (const AXUIElementRef existing : *output) {
    if (CFEqual(existing, candidate)) return;
  }
  CFRetain(candidate);
  output->push_back(candidate);
}

void AddAxAttributeCandidates(AXUIElementRef application, CFStringRef attribute,
                              std::vector<AXUIElementRef>* output) {
  CFTypeRef raw = nullptr;
  if (AXUIElementCopyAttributeValue(application, attribute, &raw) != kAXErrorSuccess || raw == nullptr)
    return;
  if (CFGetTypeID(raw) == AXUIElementGetTypeID()) {
    AddAxCandidate(output, static_cast<AXUIElementRef>(raw));
  } else if (CFGetTypeID(raw) == CFArrayGetTypeID()) {
    const CFArrayRef array = static_cast<CFArrayRef>(raw);
    const CFIndex count = std::min<CFIndex>(CFArrayGetCount(array), 64);
    for (CFIndex index = 0; index < count; ++index) {
      CFTypeRef value = static_cast<CFTypeRef>(CFArrayGetValueAtIndex(array, index));
      if (value != nullptr && CFGetTypeID(value) == AXUIElementGetTypeID()) {
        AddAxCandidate(output, static_cast<AXUIElementRef>(value));
      }
    }
  }
  CFRelease(raw);
}

void FindIosContentGroups(AXUIElementRef element, size_t depth, size_t* visited,
                          std::vector<AXUIElementRef>* output) {
  if (element == nullptr || depth > 8 || *visited >= 512) return;
  *visited += 1;
  if (AxStringEquals(element, kAXSubroleAttribute, CFSTR("iOSContentGroup"))) {
    AddAxCandidate(output, element);
  }
  CFTypeRef raw_children = nullptr;
  if (AXUIElementCopyAttributeValue(element, kAXChildrenAttribute, &raw_children) != kAXErrorSuccess ||
      raw_children == nullptr || CFGetTypeID(raw_children) != CFArrayGetTypeID()) {
    if (raw_children != nullptr) CFRelease(raw_children);
    return;
  }
  const CFArrayRef children = static_cast<CFArrayRef>(raw_children);
  const CFIndex count = std::min<CFIndex>(CFArrayGetCount(children), 128);
  for (CFIndex index = 0; index < count && *visited < 512; ++index) {
    CFTypeRef value = static_cast<CFTypeRef>(CFArrayGetValueAtIndex(children, index));
    if (value != nullptr && CFGetTypeID(value) == AXUIElementGetTypeID()) {
      FindIosContentGroups(static_cast<AXUIElementRef>(value), depth + 1, visited, output);
    }
  }
  CFRelease(raw_children);
}

napi_value ViewportStatus(napi_env env, const char* status) {
  napi_value result;
  napi_create_object(env, &result);
  if (!SetString(env, result, "status", status)) {
    Throw(env, "could not materialize Simulator viewport status");
    return nullptr;
  }
  return result;
}

/**
 * Low-rate, purpose-specific Simulator geometry query. It never performs input or exposes a
 * general accessibility bridge: callers supply one already-enumerated process/window frame and
 * receive only the declared iOSContentGroup rectangle relative to that exact outer window.
 */
napi_value ResolveSimulatorViewport(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  int32_t pid = 0;
  double wanted_x = 0;
  double wanted_y = 0;
  double wanted_width = 0;
  double wanted_height = 0;
  napi_valuetype frame_type = napi_undefined;
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 2 ||
      napi_get_value_int32(env, argv[0], &pid) != napi_ok || pid <= 0 ||
      napi_typeof(env, argv[1], &frame_type) != napi_ok || frame_type != napi_object ||
      !GetNamedNumber(env, argv[1], "x", &wanted_x) ||
      !GetNamedNumber(env, argv[1], "y", &wanted_y) ||
      !GetNamedNumber(env, argv[1], "width", &wanted_width) ||
      !GetNamedNumber(env, argv[1], "height", &wanted_height) || wanted_width <= 0 ||
      wanted_height <= 0 || wanted_width > 32768 || wanted_height > 32768 ||
      std::abs(wanted_x) > 131072 || std::abs(wanted_y) > 131072) {
    Throw(env, "resolveSimulatorViewport requires a positive PID and bounded outer frame");
    return nullptr;
  }
  if (!AXIsProcessTrusted()) return ViewportStatus(env, "permission-denied");

  AXUIElementRef application = AXUIElementCreateApplication(static_cast<pid_t>(pid));
  if (application == nullptr) return ViewportStatus(env, "window-not-found");
  std::vector<AXUIElementRef> windows;
  AddAxAttributeCandidates(application, kAXWindowsAttribute, &windows);
  AddAxAttributeCandidates(application, kAXChildrenAttribute, &windows);
  AddAxAttributeCandidates(application, kAXMainWindowAttribute, &windows);
  AddAxAttributeCandidates(application, kAXFocusedWindowAttribute, &windows);
  CFRelease(application);

  AXUIElementRef matched_window = nullptr;
  CGRect matched_frame = CGRectZero;
  size_t match_count = 0;
  for (const AXUIElementRef window : windows) {
    CGRect frame = CGRectZero;
    if (!AxStringEquals(window, kAXRoleAttribute, kAXWindowRole) || !CopyAxFrame(window, &frame))
      continue;
    constexpr double kFrameTolerance = 1.5;
    if (std::abs(frame.origin.x - wanted_x) <= kFrameTolerance &&
        std::abs(frame.origin.y - wanted_y) <= kFrameTolerance &&
        std::abs(frame.size.width - wanted_width) <= kFrameTolerance &&
        std::abs(frame.size.height - wanted_height) <= kFrameTolerance) {
      matched_window = window;
      matched_frame = frame;
      match_count += 1;
    }
  }
  if (match_count != 1 || matched_window == nullptr) {
    for (const AXUIElementRef window : windows) CFRelease(window);
    return ViewportStatus(env, "window-not-found");
  }

  std::vector<AXUIElementRef> content_groups;
  size_t visited = 0;
  FindIosContentGroups(matched_window, 0, &visited, &content_groups);
  CGRect content_frame = CGRectZero;
  const bool exactly_one = content_groups.size() == 1 && CopyAxFrame(content_groups[0], &content_frame);
  for (const AXUIElementRef group : content_groups) CFRelease(group);
  const std::string window_title = CopyAxString(matched_window, kAXTitleAttribute);
  for (const AXUIElementRef window : windows) CFRelease(window);
  if (!exactly_one) return ViewportStatus(env, "viewport-not-found");

  CGRect relative = CGRectOffset(content_frame, -matched_frame.origin.x, -matched_frame.origin.y);
  constexpr double kContainmentTolerance = 1.5;
  if (relative.origin.x < -kContainmentTolerance || relative.origin.y < -kContainmentTolerance ||
      CGRectGetMaxX(relative) > matched_frame.size.width + kContainmentTolerance ||
      CGRectGetMaxY(relative) > matched_frame.size.height + kContainmentTolerance ||
      relative.size.width <= 0 || relative.size.height <= 0 || relative.size.width > 32768 ||
      relative.size.height > 32768) {
    return ViewportStatus(env, "viewport-not-found");
  }
  relative.origin.x = std::max<CGFloat>(0, relative.origin.x);
  relative.origin.y = std::max<CGFloat>(0, relative.origin.y);

  napi_value result = ViewportStatus(env, "resolved");
  if (result == nullptr) return nullptr;
  napi_value source_rect;
  if (napi_create_object(env, &source_rect) != napi_ok ||
      !SetNumber(env, source_rect, "x", relative.origin.x) ||
      !SetNumber(env, source_rect, "y", relative.origin.y) ||
      !SetNumber(env, source_rect, "width", relative.size.width) ||
      !SetNumber(env, source_rect, "height", relative.size.height) ||
      !SetNamed(env, result, "sourceRect", source_rect) ||
      !SetString(env, result, "windowTitle", window_title)) {
    Throw(env, "could not materialize Simulator viewport geometry");
    return nullptr;
  }
  return result;
}

napi_value Start(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 2) {
    Throw(env, "start requires a service name and capability");
    return nullptr;
  }
  std::string service_name;
  std::string capability_hex;
  uint8_t capability[VF_CAPTURE_CAPABILITY_BYTES];
  if (!GetString(env, argv[0], &service_name) || service_name.empty() ||
      service_name.size() >= BOOTSTRAP_MAX_NAME_LEN ||
      !GetString(env, argv[1], &capability_hex) ||
      !DecodeHex(capability_hex, capability, sizeof(capability))) {
    Throw(env, "invalid native capture receiver bootstrap material");
    return nullptr;
  }
  if (g_state.running.load(std::memory_order_acquire) || g_state.receive_port != MACH_PORT_NULL) {
    Throw(env, "native capture receiver is already running");
    return nullptr;
  }

  mach_port_t receive_port = MACH_PORT_NULL;
  kern_return_t result = mach_port_allocate(mach_task_self(), MACH_PORT_RIGHT_RECEIVE, &receive_port);
  if (result == KERN_SUCCESS) {
    result = mach_port_insert_right(mach_task_self(), receive_port, receive_port,
                                    MACH_MSG_TYPE_MAKE_SEND);
  }
  name_t bootstrap_name{};
  std::memcpy(bootstrap_name, service_name.c_str(), service_name.size() + 1);
  if (result == KERN_SUCCESS) {
    result = bootstrap_register(bootstrap_port, bootstrap_name, receive_port);
  }
  if (result != KERN_SUCCESS) {
    if (receive_port != MACH_PORT_NULL) mach_port_destroy(mach_task_self(), receive_port);
    Throw(env, "native capture receiver could not register its private Mach service");
    return nullptr;
  }

  {
    std::lock_guard<std::mutex> lock(g_state.mutex);
    g_state.received = 0;
    g_state.accepted = 0;
    g_state.rejected_identity = 0;
    g_state.rejected_capability = 0;
    g_state.rejected_protocol = 0;
    g_state.next_frame_id = 1;
    g_state.fatal_error.clear();
  }
  g_state.receive_port = receive_port;
  g_state.service_name = service_name;
  std::memcpy(g_state.capability, capability, sizeof(capability));
  g_state.expected_peer_pid.store(0, std::memory_order_release);
  g_state.running.store(true, std::memory_order_release);
  try {
    g_state.receiver = std::thread(ReceiveFrames);
  } catch (...) {
    StopAdapter();
    Throw(env, "native capture receiver thread could not start");
    return nullptr;
  }
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value SetExpectedPeerPid(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  int32_t pid = 0;
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1 ||
      napi_get_value_int32(env, argv[0], &pid) != napi_ok || pid <= 0 ||
      !g_state.running.load(std::memory_order_acquire)) {
    Throw(env, "setExpectedPeerPid requires a live receiver and positive PID");
    return nullptr;
  }
  pid_t expected = 0;
  if (!g_state.expected_peer_pid.compare_exchange_strong(expected, static_cast<pid_t>(pid),
                                                          std::memory_order_acq_rel)) {
    Throw(env, "native capture peer PID is immutable for one generation");
    return nullptr;
  }
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value Drain(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  uint32_t maximum = 0;
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1 ||
      napi_get_value_uint32(env, argv[0], &maximum) != napi_ok || maximum == 0 ||
      maximum > kMaximumQueuedFrames) {
    Throw(env, "drain maximum is outside the native capture bound");
    return nullptr;
  }
  std::deque<std::unique_ptr<FrameRecord>> records;
  {
    std::lock_guard<std::mutex> lock(g_state.mutex);
    if (!g_state.fatal_error.empty()) {
      Throw(env, g_state.fatal_error.c_str());
      return nullptr;
    }
    while (!g_state.pending.empty() && records.size() < maximum) {
      records.push_back(std::move(g_state.pending.front()));
      g_state.pending.pop_front();
    }
  }

  napi_value array;
  if (napi_create_array_with_length(env, records.size(), &array) != napi_ok) {
    for (auto& record : records) ReleaseRecord(record);
    Throw(env, "could not allocate native capture frame array");
    return nullptr;
  }
  uint32_t index = 0;
  for (auto& record : records) {
    napi_value object;
    napi_value handle;
    void* copied = nullptr;
    uintptr_t pointer = reinterpret_cast<uintptr_t>(record->surface);
    const auto& payload = record->payload;
    const bool created =
        napi_create_object(env, &object) == napi_ok &&
        napi_create_buffer_copy(env, sizeof(pointer), &pointer, &copied, &handle) == napi_ok &&
        SetString(env, object, "frameId", std::to_string(record->id)) &&
        SetString(env, object, "sessionKey",
                  EncodeHex(payload.session_key, sizeof(payload.session_key))) &&
        SetNumber(env, object, "producerEpoch", static_cast<double>(payload.producer_epoch)) &&
        SetString(env, object, "sequence", std::to_string(payload.sequence)) &&
        SetNumber(env, object, "slot", payload.slot) &&
        SetNumber(env, object, "width", payload.width) &&
        SetNumber(env, object, "height", payload.height) &&
        SetNumber(env, object, "logicalWidth", payload.logical_width) &&
        SetNumber(env, object, "logicalHeight", payload.logical_height) &&
        SetString(env, object, "timestampUs", std::to_string(payload.timestamp_us)) &&
        SetNamed(env, object, "ioSurface", handle) &&
        napi_set_element(env, array, index, object) == napi_ok;
    if (!created) {
      ReleaseRecord(record);
      for (auto& remaining : records) ReleaseRecord(remaining);
      Throw(env, "could not materialize native capture frame");
      return nullptr;
    }
    {
      std::lock_guard<std::mutex> lock(g_state.mutex);
      g_state.outstanding.emplace(record->id, record->surface);
    }
    record->surface = nullptr;
    index += 1;
  }
  return array;
}

napi_value Release(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  std::string raw_id;
  uint64_t id = 0;
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1 ||
      !GetString(env, argv[0], &raw_id) || !ParseU64(raw_id, &id)) {
    Throw(env, "release requires a decimal native frame identity");
    return nullptr;
  }
  IOSurfaceRef surface = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_state.mutex);
    const auto found = g_state.outstanding.find(id);
    if (found != g_state.outstanding.end()) {
      surface = found->second;
      g_state.outstanding.erase(found);
    }
  }
  if (surface != nullptr) CFRelease(surface);
  napi_value result;
  napi_get_boolean(env, surface != nullptr, &result);
  return result;
}

napi_value Stats(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value object;
  napi_create_object(env, &object);
  std::lock_guard<std::mutex> lock(g_state.mutex);
  SetNumber(env, object, "received", static_cast<double>(g_state.received));
  SetNumber(env, object, "accepted", static_cast<double>(g_state.accepted));
  SetNumber(env, object, "rejectedIdentity", static_cast<double>(g_state.rejected_identity));
  SetNumber(env, object, "rejectedCapability", static_cast<double>(g_state.rejected_capability));
  SetNumber(env, object, "rejectedProtocol", static_cast<double>(g_state.rejected_protocol));
  SetNumber(env, object, "outstanding",
            static_cast<double>(g_state.pending.size() + g_state.outstanding.size()));
  return object;
}

napi_value Stop(napi_env env, napi_callback_info info) {
  (void)info;
  StopAdapter();
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

void Cleanup(void*) { StopAdapter(); }

}  // namespace

NAPI_MODULE_INIT() {
  napi_property_descriptor properties[] = {
      {"start", nullptr, Start, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setExpectedPeerPid", nullptr, SetExpectedPeerPid, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"drain", nullptr, Drain, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"release", nullptr, Release, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"stats", nullptr, Stats, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"resolveSimulatorViewport", nullptr, ResolveSimulatorViewport, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"stop", nullptr, Stop, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  if (napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties) !=
      napi_ok) {
    return nullptr;
  }
  napi_add_env_cleanup_hook(env, Cleanup, nullptr);
  return exports;
}
