import { describe, it } from "node:test";
import assert from "node:assert";
import { StatusWord, parseResponse, statusWordName } from "../lib/index.js";

describe("Status words", () => {
  it("parseResponse should parse sw1/sw2/sw and provide data view", () => {
    const response = Buffer.from([0xde, 0xad, 0xbe, 0x90, 0x00]);
    const parsed = parseResponse(response);

    assert.strictEqual(parsed.sw1, 0x90);
    assert.strictEqual(parsed.sw2, 0x00);
    assert.strictEqual(parsed.sw, StatusWord.OK);
    assert.strictEqual(parsed.data.length, 3);
    assert.strictEqual(parsed.data.toString("hex"), "deadbe");
  });

  it("parseResponse should return a zero-copy data subarray", () => {
    const response = Buffer.from([0x01, 0x02, 0x90, 0x00]);
    const parsed = parseResponse(response);

    response[0] = 0xaa;
    assert.strictEqual(parsed.data[0], 0xaa);
  });

  it("parseResponse should throw for too-short responses", () => {
    assert.throws(() => parseResponse(Buffer.from([0x90])), /at least SW1 and SW2/);
  });

  it("statusWordName should return names for common status words", () => {
    assert.strictEqual(statusWordName(StatusWord.OK), "ok");
    assert.strictEqual(statusWordName(StatusWord.WRONG_LENGTH), "wrong length");
    assert.strictEqual(
      statusWordName(StatusWord.FILE_OR_APPLICATION_NOT_FOUND),
      "file or application not found",
    );
  });

  it("statusWordName should return hex fallback for unknown status words", () => {
    assert.strictEqual(statusWordName(0x6fff), "0x6FFF");
  });
});
