import { EventEmitter } from "node:events";

export interface ContextOptions {
  autoGetResponse?: boolean;
  autoConnect?: boolean;
}

export interface ContextEvents {
  reader: [reader: Reader];
  attach: [reader: Reader];
  detach: [reader: Reader];
  change: [reader: Reader, prevState: number];
  insert: [reader: Reader];
  remove: [reader: Reader];
  error: [err: Error & { code?: number }];
  ready: [];
}

export interface ReaderEvents {
  attach: [reader: Reader];
  detach: [reader: Reader];
  change: [reader: Reader, prevState: number];
  insert: [reader: Reader];
  remove: [reader: Reader];
  error: [err: Error & { code?: number }];
}

export declare class Context extends EventEmitter<ContextEvents> {
  constructor(options?: ContextOptions);
  readonly isValid: boolean;
  readonly readers: ReadonlyMap<string, Reader>;
  start(): this;
  getReaders(): Promise<ReadonlyMap<string, Reader>>;
  close(): void;
}

export declare class Reader extends EventEmitter<ReaderEvents> {
  readonly name: string;
  readonly attached: boolean;
  readonly state: number;
  readonly atr: Buffer | null;
  readonly connected: boolean;
  readonly protocol: number;

  connect(shareMode?: number, preferredProtocols?: number): Promise<void>;

  transmit(
    command: Buffer | number[],
    maxRecvLength?: number,
    autoGetResponse?: boolean,
  ): Promise<Buffer>;

  control(code: number, data?: Buffer | number[]): Promise<Buffer>;

  reconnect(shareMode?: number, protocol?: number, initialization?: number): Promise<void>;

  disconnect(disposition?: number): void;
}

export const Errors: Readonly<Record<string, number>>;

export const ShareMode: Readonly<{
  EXCLUSIVE: number;
  SHARED: number;
  DIRECT: number;
}>;

export const Protocol: Readonly<{
  T0: number;
  T1: number;
  RAW: number;
  UNDEFINED: number;
}>;

export const Disposition: Readonly<{
  LEAVE: number;
  RESET: number;
  UNPOWER: number;
  EJECT: number;
}>;

export const State: Readonly<{
  UNAWARE: number;
  IGNORE: number;
  CHANGED: number;
  UNKNOWN: number;
  UNAVAILABLE: number;
  EMPTY: number;
  PRESENT: number;
  ATRMATCH: number;
  EXCLUSIVE: number;
  INUSE: number;
  MUTE: number;
}>;

export const ControlCode: Readonly<{
  GET_FEATURE_REQUEST: number;
}>;

export const Feature: Readonly<{
  VERIFY_PIN_START: number;
  VERIFY_PIN_FINISH: number;
  MODIFY_PIN_START: number;
  MODIFY_PIN_FINISH: number;
  GET_KEY_PRESSED: number;
  VERIFY_PIN_DIRECT: number;
  MODIFY_PIN_DIRECT: number;
  MCT_READER_DIRECT: number;
  MCT_UNIVERSAL: number;
  IFD_PIN_PROPERTIES: number;
  ABORT: number;
  SET_SPE_MESSAGE: number;
  VERIFY_PIN_DIRECT_APP_ID: number;
  MODIFY_PIN_DIRECT_APP_ID: number;
  WRITE_DISPLAY: number;
  GET_KEY: number;
  IFD_DISPLAY_PROPERTIES: number;
  GET_TLV_PROPERTIES: number;
  CCID_ESC_COMMAND: number;
}>;

export interface FeatureDetail {
  tag: number;
  name: string;
  controlCode: number;
}

export function platformControlCode(code: number): number;
export function featureName(tag: number): string;
export function parseFeatures(response: Buffer): Map<number, number>;
export function parseFeaturesDetails(response: Buffer): FeatureDetail[];

export const StatusWord: Readonly<{
  OK: number;
  WRONG_LENGTH: number;
  LOGICAL_CHANNEL_NOT_SUPPORTED: number;
  SECURITY_STATUS_NOT_SATISFIED: number;
  CONDITIONS_NOT_SATISFIED: number;
  FILE_OR_APPLICATION_NOT_FOUND: number;
  INSTRUCTION_NOT_SUPPORTED: number;
}>;

export interface ParsedResponse {
  sw1: number;
  sw2: number;
  sw: number;
  data: Buffer | Uint8Array;
}

export function parseResponse(response: Buffer | Uint8Array): ParsedResponse;
export function statusWordName(statusWord: number): string;
export function protocolName(protocol: number): string;
export function stateNames(flags: number): string[];
