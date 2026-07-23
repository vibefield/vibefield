import type { LogBufferLimits, LogRetentionPolicy } from "./types";

export const FIRST_PARTY_RETENTION: Readonly<LogRetentionPolicy> = {
  maxSegmentBytes: 10 * 1024 * 1024,
  maxClosedSegments: 6,
  maxAgeMs: 7 * 24 * 60 * 60 * 1_000,
  categoryCapBytes: 250 * 1024 * 1024,
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

export const FIRST_PARTY_VALUE_LIMITS = {
  messageBytes: 16 * 1024,
  stringBytes: 16 * 1024,
  stackBytes: 32 * 1024,
  objectDepth: 6,
  objectKeys: 100,
  arrayItems: 100,
  errorCauses: 4,
  identityBytes: 256,
  componentBytes: 160,
} as const;
