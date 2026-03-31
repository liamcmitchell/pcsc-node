import { describe, it } from "node:test";
import assert from "node:assert";
import {
  PCSCError,
  CardRemovedError,
  TimeoutError,
  NoReadersError,
  ServiceNotRunningError,
  SharingViolationError,
  createPCSCError,
} from "../lib/errors.js";

describe("Error Classes", () => {
  it("PCSCError should have code property", () => {
    const err = new PCSCError("Test error", 0x80100001);
    assert.strictEqual(err.code, 0x80100001);
    assert.strictEqual(err.name, "PCSCError");
    assert.strictEqual(err.message, "Test error");
  });

  it("CardRemovedError should have correct code", () => {
    const err = new CardRemovedError();
    assert.strictEqual(err.code, 0x80100069);
    assert.strictEqual(err.name, "CardRemovedError");
    assert(err instanceof PCSCError);
  });

  it("TimeoutError should have correct code", () => {
    const err = new TimeoutError();
    assert.strictEqual(err.code, 0x8010000a);
    assert.strictEqual(err.name, "TimeoutError");
    assert(err instanceof PCSCError);
  });

  it("NoReadersError should have correct code", () => {
    const err = new NoReadersError();
    assert.strictEqual(err.code, 0x8010002e);
    assert.strictEqual(err.name, "NoReadersError");
    assert(err instanceof PCSCError);
  });

  it("ServiceNotRunningError should have correct code", () => {
    const err = new ServiceNotRunningError();
    assert.strictEqual(err.code, 0x8010001d);
    assert.strictEqual(err.name, "ServiceNotRunningError");
    assert(err instanceof PCSCError);
  });

  it("SharingViolationError should have correct code", () => {
    const err = new SharingViolationError();
    assert.strictEqual(err.code, 0x8010000b);
    assert.strictEqual(err.name, "SharingViolationError");
    assert(err instanceof PCSCError);
  });

  it("createPCSCError should return CardRemovedError for 0x80100069", () => {
    const err = createPCSCError("Card was removed", 0x80100069);
    assert(err instanceof CardRemovedError);
    assert.strictEqual(err.code, 0x80100069);
  });

  it("createPCSCError should return TimeoutError for 0x8010000A", () => {
    const err = createPCSCError("Timeout", 0x8010000a);
    assert(err instanceof TimeoutError);
    assert.strictEqual(err.code, 0x8010000a);
  });

  it("createPCSCError should return NoReadersError for 0x8010002E", () => {
    const err = createPCSCError("No readers", 0x8010002e);
    assert(err instanceof NoReadersError);
    assert.strictEqual(err.code, 0x8010002e);
  });

  it("createPCSCError should return ServiceNotRunningError for 0x8010001D", () => {
    const err = createPCSCError("Service not running", 0x8010001d);
    assert(err instanceof ServiceNotRunningError);
    assert.strictEqual(err.code, 0x8010001d);
  });

  it("createPCSCError should return SharingViolationError for 0x8010000B", () => {
    const err = createPCSCError("Sharing violation", 0x8010000b);
    assert(err instanceof SharingViolationError);
    assert.strictEqual(err.code, 0x8010000b);
  });

  it("createPCSCError should return PCSCError for unknown codes", () => {
    const err = createPCSCError("Unknown error", 0x80100099);
    assert(err instanceof PCSCError);
    assert(!(err instanceof CardRemovedError));
    assert.strictEqual(err.code, 0x80100099);
  });
});
