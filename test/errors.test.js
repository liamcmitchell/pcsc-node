import { describe, it } from "node:test";
import assert from "node:assert";
import { Errors } from "../lib/errors.js";

describe("Error Classes", () => {
  it("Errors constants should expose known PC/SC codes", () => {
    assert.strictEqual(Errors.CARD_REMOVED, 0x80100069);
    assert.strictEqual(Errors.TIMEOUT, 0x8010000a);
    assert.strictEqual(Errors.NO_READERS_AVAILABLE, 0x8010002e);
    assert.strictEqual(Errors.NO_SERVICE, 0x8010001d);
    assert.strictEqual(Errors.SHARING_VIOLATION, 0x8010000b);
  });
});
