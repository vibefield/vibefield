#pragma once

#include <mach/message.h>
#include <stdint.h>

// Private, same-build protocol between VibeField's capture helper and its
// purpose-built Electron adapter. Control remains tokened JSON over the
// inherited pipe; only IOSurface Mach rights cross this message.

static constexpr uint32_t VF_CAPTURE_FRAME_MAGIC = 0x56464c53;  // "VFLS"
static constexpr uint16_t VF_CAPTURE_PROTOCOL_VERSION = 1;
static constexpr mach_msg_id_t VF_CAPTURE_FRAME_MESSAGE_ID = 0x56460001;
static constexpr size_t VF_CAPTURE_CAPABILITY_BYTES = 32;
static constexpr size_t VF_CAPTURE_SESSION_KEY_BYTES = 16;

struct VfCaptureFramePayload {
  uint32_t magic;
  uint16_t version;
  uint16_t reserved;
  uint8_t capability[VF_CAPTURE_CAPABILITY_BYTES];
  uint8_t session_key[VF_CAPTURE_SESSION_KEY_BYTES];
  uint64_t producer_epoch;
  uint64_t sequence;
  uint64_t timestamp_us;
  uint32_t slot;
  uint32_t width;
  uint32_t height;
  uint32_t bytes_per_row;
  uint32_t pixel_format;
  uint32_t reserved2;
  double logical_width;
  double logical_height;
};

struct VfCaptureFrameMessage {
  mach_msg_header_t header;
  mach_msg_body_t body;
  mach_msg_port_descriptor_t surface_port;
  VfCaptureFramePayload payload;
};

struct VfCaptureReceiveBuffer {
  VfCaptureFrameMessage message;
  mach_msg_max_trailer_t trailer;
};

static_assert(sizeof(((VfCaptureFramePayload*)nullptr)->capability) == VF_CAPTURE_CAPABILITY_BYTES);
static_assert(sizeof(((VfCaptureFramePayload*)nullptr)->session_key) == VF_CAPTURE_SESSION_KEY_BYTES);
