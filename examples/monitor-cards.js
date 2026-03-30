#!/usr/bin/env node
/**
 * Monitor for card insert/remove events using the createClient API
 *
 * Usage: node monitor-cards.js
 *
 * Press Ctrl+C to stop monitoring.
 */

import { createClient } from "../lib/index.js";

console.log("PC/SC Card Monitor");
console.log("==================");
console.log("Monitoring for card events. Press Ctrl+C to stop.\n");

const client = createClient({
  onReaderAttached({ name }) {
    console.log(`[+] Reader attached: ${name}`);
  },

  onReaderDetached({ name }) {
    console.log(`[-] Reader detached: ${name}`);
  },

  async onCardInserted({ name, card }) {
    console.log(`\n[*] Card inserted in: ${name}`);

    // Get ATR
    try {
      const status = card.getStatus();
      console.log(`    ATR: ${status.atr.toString("hex")}`);
    } catch (err) {
      console.log(`    Could not get ATR: ${err.message}`);
    }

    // Try to read UID
    try {
      const response = await card.transmit([0xff, 0xca, 0x00, 0x00, 0x00]);
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

  onCardRemoved({ name }) {
    console.log(`[*] Card removed from: ${name}\n`);
  },

  onError(err) {
    // Ignore common transient errors
    const ignorable = ["unresponsive", "Sharing violation", "cancelled"];
    if (!ignorable.some((msg) => err.message.includes(msg))) {
      console.error(`[!] Error: ${err.message}`);
    }
  },
});

// Start monitoring
client.start();

// Handle shutdown
process.on("SIGINT", () => {
  console.log("\nStopping...");
  client.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  client.stop();
  process.exit(0);
});
