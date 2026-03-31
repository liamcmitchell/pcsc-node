#!/usr/bin/env node
/**
 * Monitor for card insert/remove events using the createClient API
 *
 * Usage: node monitor-cards.js
 *
 * Press Ctrl+C to stop monitoring.
 */

import { createContext } from "../lib/index.js";

console.log("PC/SC Card Monitor");
console.log("==================");
console.log("Monitoring for card events. Press Ctrl+C to stop.\n");

const context = createContext({
  onReaderAttached(reader) {
    console.log(`[+] Reader attached: ${reader.name}`);
  },

  onReaderDetached(reader) {
    console.log(`[-] Reader detached: ${reader.name}`);
  },

  async onCardInserted(reader) {
    console.log(`\n[*] Card inserted in: ${reader.name}`);

    // Get ATR
    if (reader.atr) {
      console.log(`    ATR: ${reader.atr.toString("hex")}`);
    }

    // Try to read UID
    try {
      const response = await reader.transmit([0xff, 0xca, 0x00, 0x00, 0x00]);
      if (response.length >= 2) {
        const sw1 = response[response.length - 2];
        const sw2 = response[response.length - 1];
        if (sw1 === 0x90 && sw2 === 0x00) {
          const uid = response.subarray(0, -2);
          console.log(`    UID: ${uid.toString("hex")}`);
        }
      }
    } catch {
      // UID read not supported, that's OK
    }

    console.log();
  },

  onCardRemoved(reader) {
    console.log(`[*] Card removed from: ${reader.name}\n`);
  },

  onError(err) {
    // Ignore common transient errors
    const ignorable = ["unresponsive", "Sharing violation", "cancelled"];
    if (!ignorable.some((msg) => err.message.includes(msg))) {
      console.error(`[!] Error: ${err.message}`);
    }
  },
});

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
