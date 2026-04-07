#!/usr/bin/env node
/**
 * Monitor for card insert/remove events using the Context API
 *
 * Usage: node monitor-cards.js
 *
 * Press Ctrl+C to stop monitoring.
 */

import { Context, StatusWord, parseResponse } from "../lib/index.js";

console.log("PC/SC Card Monitor");
console.log("==================");
console.log("Monitoring for card events. Press Ctrl+C to stop.\n");

const context = new Context()
  .on("attach", (reader) => {
    console.log(`[+] Reader attached: ${reader.name}`);
  })
  .on("detach", (reader) => {
    console.log(`[-] Reader detached: ${reader.name}`);
  })
  .on("insert", async (reader) => {
    console.log(`\n[*] Card inserted in: ${reader.name}`);

    // Get ATR
    if (reader.atr) {
      console.log(`    ATR: ${reader.atr.toString("hex")}`);
    }

    // Try to read UID
    try {
      const response = await reader.transmit([0xff, 0xca, 0x00, 0x00, 0x00]);
      const parsed = parseResponse(response);
      if (parsed.sw === StatusWord.OK) {
        console.log(`    UID: ${parsed.data.toString("hex")}`);
      }
    } catch {
      // UID read not supported, that's OK
    }

    console.log();
  })
  .on("remove", (reader) => {
    console.log(`[*] Card removed from: ${reader.name}\n`);
  })
  .on("error", (err) => {
    // Ignore common transient errors
    const ignorable = ["unresponsive", "Sharing violation", "cancelled"];
    if (!ignorable.some((msg) => err.message.includes(msg))) {
      console.error(`[!] Error: ${err.message}`);
    }
  })
  .start();

// Handle shutdown
process.on("SIGINT", () => {
  console.log("\nStopping...");
  context.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  context.close();
  process.exit(0);
});
