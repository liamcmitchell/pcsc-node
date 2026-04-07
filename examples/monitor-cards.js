#!/usr/bin/env node
import { Context, Errors, StatusWord, parseResponse } from "../lib/index.js";

console.log("PC/SC Card Monitor");
console.log("==================");
console.log("Monitoring for card events. Press Ctrl+C to stop.\n");

const context = new Context()
  .on("reader", (reader) => {
    reader.on("insert", async () => {
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
    });

    reader.on("remove", () => {
      console.log(`[*] Card removed from: ${reader.name}\n`);
    });
  })
  .on("attach", (reader) => {
    console.log(`[+] Reader attached: ${reader.name}`);
  })
  .on("detach", (reader) => {
    console.log(`[-] Reader detached: ${reader.name}`);
  })
  .on("error", (err) => {
    // Ignore common transient PC/SC errors by stable code.
    const ignoredCodes = new Set([
      Errors.CARD_UNRESPONSIVE,
      Errors.SHARING_VIOLATION,
      Errors.CANCELLED,
      Errors.SYSTEM_CANCELLED,
    ]);
    if (!ignoredCodes.has(err?.code)) {
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
