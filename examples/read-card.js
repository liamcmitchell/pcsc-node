#!/usr/bin/env node
/**
 * Wait for a card and read ATR + UID.
 *
 * Usage: node read-card.js
 */

import { Context, SCARD_PROTOCOL_T0, SCARD_LEAVE_CARD } from "../lib/index.js";

async function main() {
  const ctx = new Context();

  try {
    console.log("Waiting for first available card...");

    ctx.start();
    const reader = await new Promise((resolve, reject) => {
      ctx.once("insert", resolve);
      ctx.once("error", reject);
    });

    console.log(`Using reader: ${reader.name}`);
    console.log(`Connected! Protocol: ${reader.protocol === SCARD_PROTOCOL_T0 ? "T=0" : "T=1"}`);

    if (reader.atr) {
      console.log(`ATR: ${reader.atr.toString("hex")}`);
    }

    try {
      const response = await reader.transmit([0xff, 0xca, 0x00, 0x00, 0x00]);
      const sw1 = response[response.length - 2];
      const sw2 = response[response.length - 1];
      if (sw1 === 0x90 && sw2 === 0x00) {
        console.log(`UID: ${response.subarray(0, -2).toString("hex")}`);
      } else {
        console.log(`UID command returned: ${sw1.toString(16)} ${sw2.toString(16)}`);
      }
    } catch (error) {
      console.log(`Could not read UID: ${error.message}`);
    }

    reader.disconnect(SCARD_LEAVE_CARD);
  } catch (error) {
    console.error(`Error: ${error.message}`);
  } finally {
    ctx.close();
  }
}

main();
