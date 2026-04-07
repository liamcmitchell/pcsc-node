import { describe, it } from "node:test";
import assert from "node:assert";
import { Protocol, State, protocolName, stateNames } from "../lib/index.js";

describe("Protocol helpers", () => {
  it("protocolName should resolve known protocol values", () => {
    assert.strictEqual(protocolName(Protocol.T0), "T=0");
    assert.strictEqual(protocolName(Protocol.T1), "T=1");
    assert.strictEqual(protocolName(Protocol.RAW), "RAW");
    assert.strictEqual(protocolName(Protocol.UNDEFINED), "UNDEFINED");
  });

  it("protocolName should format unknown values as hex", () => {
    assert.strictEqual(protocolName(0x7f), "0x7F");
  });
});

describe("State helpers", () => {
  it("stateNames should return UNAWARE for zero flags", () => {
    assert.deepStrictEqual(stateNames(State.UNAWARE), ["UNAWARE"]);
  });

  it("stateNames should decode active bit flags", () => {
    const flags = State.PRESENT | State.INUSE | State.MUTE;
    assert.deepStrictEqual(stateNames(flags), ["PRESENT", "INUSE", "MUTE"]);
  });

  it("stateNames should ignore unknown bits", () => {
    const flags = State.PRESENT | 0x80000000;
    assert.deepStrictEqual(stateNames(flags), ["PRESENT"]);
  });
});
