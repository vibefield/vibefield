import { LOG_TRANSPORT_LIMITS } from "@vibefield/contracts";
import type { LogBufferLimits, LogRetentionPolicy } from "./types";

export interface LogValueLimits {
  messageBytes: number;
  stringBytes: number;
  stackBytes: number;
  objectDepth: number;
  objectKeys: number;
  arrayItems: number;
  errorCauses: number;
  identityBytes: number;
  componentBytes: number;
}

export const FIRST_PARTY_RETENTION: Readonly<LogRetentionPolicy> = {
  maxSegmentBytes: 10 * 1024 * 1024,
  maxClosedSegments: 6,
  maxAgeMs: 7 * 24 * 60 * 60 * 1_000,
  categoryCapBytes: 250 * 1024 * 1024,
};

export const PLUGIN_RETENTION: Readonly<LogRetentionPolicy> = {
  maxSegmentBytes: 5 * 1024 * 1024,
  maxClosedSegments: 2,
  maxAgeMs: 3 * 24 * 60 * 60 * 1_000,
  categoryCapBytes: 100 * 1024 * 1024,
};

export const FIRST_PARTY_BUFFERS: Readonly<LogBufferLimits> = {
  queueRecords: 8_192,
  queueBytes: 8 * 1024 * 1024,
  reservedRecords: 256,
  reservedBytes: 512 * 1024,
  ringRecords: 2_000,
  ringBytes: 2 * 1024 * 1024,
  maxRecordBytes: 64 * 1024,
};

export const PLUGIN_BUFFERS: Readonly<LogBufferLimits> = {
  queueRecords: 4_096,
  queueBytes: 4 * 1024 * 1024,
  reservedRecords: 256,
  reservedBytes: 512 * 1024,
  ringRecords: 1_000,
  ringBytes: 1 * 1024 * 1024,
  maxRecordBytes: LOG_TRANSPORT_LIMITS.PLUGIN_RECORD_BYTES,
};

export const FIRST_PARTY_VALUE_LIMITS: Readonly<LogValueLimits> = {
  messageBytes: 16 * 1024,
  stringBytes: 16 * 1024,
  stackBytes: 32 * 1024,
  objectDepth: 6,
  objectKeys: 100,
  arrayItems: 100,
  errorCauses: 4,
  identityBytes: 256,
  componentBytes: 160,
};

export const PLUGIN_VALUE_LIMITS: Readonly<LogValueLimits> = {
  messageBytes: LOG_TRANSPORT_LIMITS.PLUGIN_MESSAGE_BYTES,
  stringBytes: LOG_TRANSPORT_LIMITS.PLUGIN_STRING_BYTES,
  stackBytes: LOG_TRANSPORT_LIMITS.PLUGIN_STACK_BYTES,
  objectDepth: LOG_TRANSPORT_LIMITS.PLUGIN_OBJECT_DEPTH,
  objectKeys: LOG_TRANSPORT_LIMITS.PLUGIN_OBJECT_KEYS,
  arrayItems: LOG_TRANSPORT_LIMITS.PLUGIN_ARRAY_ITEMS,
  errorCauses: LOG_TRANSPORT_LIMITS.PLUGIN_ERROR_CAUSES,
  identityBytes: 256,
  componentBytes: 160,
};
