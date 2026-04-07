#!/usr/bin/env node
/**
 * Wait for a card and read ATR + UID.
 *
 * Usage: node read-card.js
 */

import {
  Context,
  Disposition,
  StatusWord,
  parseResponse,
  protocolName,
  statusWordName,
} from "../lib/index.js";
import { toHex } from "../lib/hex.js";

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
    console.log(`Connected! Protocol: ${protocolName(reader.protocol)}`);

    if (reader.atr) {
      console.log(`ATR: ${reader.atr.toString("hex")}`);
    }

    try {
      const response = await reader.transmit([0xff, 0xca, 0x00, 0x00, 0x00]);
      const parsed = parseResponse(response);
      if (parsed.sw === StatusWord.OK) {
        console.log(`UID: ${parsed.data.toString("hex")}`);
      } else {
        const hint = statusWordName(parsed.sw);
        console.log(`UID command returned: ${toHex(parsed.sw, 4)} (${hint})`);
      }
    } catch (error) {
      console.log(`Could not read UID: ${error.message}`);
    }

    reader.disconnect(Disposition.LEAVE);
  } catch (error) {
    console.error(`Error: ${error.message}`);
  } finally {
    ctx.close();
  }
}

main();
