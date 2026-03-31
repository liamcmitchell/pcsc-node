#!/usr/bin/env node
/**
 * Wait for a card insertion event.
 *
 * Usage: node wait-for-card.js [timeout-seconds]
 *
 * Examples:
 *   node wait-for-card.js        # Wait indefinitely
 *   node wait-for-card.js 30     # Wait up to 30 seconds
 */

import { Context, SCARD_PROTOCOL_T0, SCARD_LEAVE_CARD } from "../lib/index.js";

/** @type {Context | undefined} */
let globalCtx;

async function main() {
  const timeoutSeconds = parseInt(process.argv[2]) || 0;
  const timeout = timeoutSeconds > 0 ? timeoutSeconds * 1000 : 0;

  console.log("Wait for Card Example");
  console.log("=====================\n");

  const ctx = new Context();
  globalCtx = ctx;

  try {
    console.log("Waiting for a card to be inserted...");
    if (timeout > 0) {
      console.log(`(Timeout: ${timeoutSeconds} seconds)`);
    }
    console.log();

    const reader = await new Promise((resolve, reject) => {
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let timeoutId;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        ctx.off("attach", onAttach);
        ctx.off("insert", onInsert);
        ctx.off("error", onError);
      };

      const onAttach = (attachedReader) => {
        console.log(`Reader attached: ${attachedReader.name}`);
      };

      const onInsert = (insertedReader) => {
        cleanup();
        resolve(insertedReader);
      };

      const onError = (error) => {
        cleanup();
        reject(error);
      };

      ctx.on("attach", onAttach);
      ctx.on("insert", onInsert);
      ctx.on("error", onError);
      ctx.start();

      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error("Timeout waiting for card."));
        }, timeout);
      }
    });

    console.log(`Card detected in: ${reader.name}`);
    console.log(`Connected! Protocol: ${reader.protocol === SCARD_PROTOCOL_T0 ? "T=0" : "T=1"}`);
    if (reader.atr) {
      console.log(`ATR: ${reader.atr.toString("hex")}`);
    }

    try {
      const response = await reader.transmit([0xff, 0xca, 0x00, 0x00, 0x00]);
      if (response.length >= 2) {
        const sw = (response[response.length - 2] << 8) | response[response.length - 1];
        if (sw === 0x9000) {
          console.log(`UID: ${response.subarray(0, -2).toString("hex")}`);
        }
      }
    } catch {
      // UID not available for this card type
    }

    reader.disconnect(SCARD_LEAVE_CARD);
    console.log("\nDone!");
  } catch (err) {
    console.error(`Error: ${err.message}`);
  } finally {
    ctx.close();
  }
}

process.on("SIGINT", () => {
  console.log("\nCancelling...");
  globalCtx?.close();
  process.exit(0);
});

main().catch(console.error);
