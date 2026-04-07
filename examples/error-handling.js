#!/usr/bin/env node
/**
 * Demonstrates handling context and reader errors.
 *
 * Usage: node error-handling.js
 */

import { Context, Disposition, Errors } from "../lib/index.js";

async function main() {
  const ctx = new Context();

  ctx.on("error", (error) => {
    console.error(`Context error: ${error.message}`);
  });

  try {
    ctx.start();
    const reader = await new Promise((resolve, reject) => {
      ctx.once("insert", resolve);
      ctx.once("error", reject);
    });

    console.log(`Using reader: ${reader.name}`);

    try {
      await reader.transmit([0xff, 0xca, 0x00, 0x00, 0x00]);
      console.log("Command succeeded.");
    } catch (error) {
      if (error?.code === Errors.CARD_REMOVED) {
        console.error("No card inserted.");
      } else if (typeof error?.code === "number") {
        console.error(`Smart card error: ${error.message} (0x${error.code.toString(16)})`);
      } else {
        console.error(`Unknown reader error: ${error.message}`);
      }
    }

    try {
      await reader.disconnect(Disposition.UNPOWER);
    } catch {
      await reader.disconnect(Disposition.LEAVE);
    }
  } catch (error) {
    console.error(`Fatal error: ${error.message}`);
  } finally {
    ctx.close();
  }
}

main();
