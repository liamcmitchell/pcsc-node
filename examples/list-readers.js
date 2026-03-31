#!/usr/bin/env node
/**
 * List all currently attached PC/SC readers.
 *
 * Usage: node list-readers.js
 */

import { Context, SCARD_STATE_PRESENT } from "../lib/index.js";

function main() {
  console.log("Listing readers...\n");
  const ctx = new Context({ autoConnect: false });

  ctx
    .on("error", (error) => {
      console.error("Error:", error.message);
      ctx.close();
      process.exit(1);
    })
    .start();

  setTimeout(() => {
    const readers = [...ctx.readers.values()];
    if (readers.length === 0) {
      console.log("No readers found.");
      console.log("\nMake sure:");
      console.log("  - A PC/SC compatible reader is connected");
      console.log("  - On Linux: pcscd service is running (sudo systemctl start pcscd)");
      ctx.close();
      return;
    }

    console.log(`Found ${readers.length} reader(s):\n`);

    for (const reader of readers) {
      const hasCard = (reader.state & SCARD_STATE_PRESENT) !== 0;
      console.log(`  Name: ${reader.name}`);
      console.log(`  State: 0x${reader.state.toString(16)}`);
      console.log(`  Card present: ${hasCard ? "Yes" : "No"}`);
      if (hasCard && reader.atr) {
        console.log(`  ATR: ${reader.atr.toString("hex")}`);
      }
      console.log();
    }

    ctx.close();
  }, 250);
}

main();
