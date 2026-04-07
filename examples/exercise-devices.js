#!/usr/bin/env node
/**
 * Exercise both known readers with a PKI card.
 *
 * Usage:
 *   node examples/exercise-devices.js
 */

import {
  Context,
  ShareMode,
  Protocol,
  Disposition,
  ControlCode,
  parseResponse,
  protocolName,
  statusWordName,
} from "../lib/index.js";
import { toHex } from "../lib/hex.js";

function formatHex(buffer) {
  return buffer.toString("hex").toUpperCase();
}

async function safeTransmit(reader, name, command) {
  try {
    const response = await reader.transmit(command);
    const parsed = parseResponse(response);
    const description = statusWordName(parsed.sw);
    console.log(`  ${name}: ${formatHex(response)} (SW=${toHex(parsed.sw, 4)} ${description})`);
  } catch (error) {
    console.log(`  ${name}: ${error.message}`);
  }
}

async function main() {
  console.log("Smartcard Device Exercise");
  console.log("========================");
  console.log("Safe checks are enabled by default.\n");

  const ctx = new Context();

  ctx.on("error", (error) => console.log(`[error] ${error.message}`));

  try {
    await ctx.start().whenReady();

    console.log(`Available readers: ${ctx.readers.size}`);
    const readerTasks = [...ctx.readers.values()].map(async (reader) => {
      if (!reader.connected) {
        console.log(`${reader.name}: waiting for card...`);
        await new Promise((resolve) => {
          reader.once("insert", resolve);
        });
      }

      console.log(`${reader.name}:`);
      console.log(`  connected: ${reader.connected ? "yes" : "no"}`);
      console.log(`  protocol: ${protocolName(reader.protocol)}`);
      if (reader.atr) {
        console.log(`  ATR: ${formatHex(reader.atr)}`);
      }

      // Safe APDUs
      await safeTransmit(reader, "UID (FFCA000000)", Buffer.from([0xff, 0xca, 0x00, 0x00, 0x00]));
      await safeTransmit(
        reader,
        "SELECT MF (00A40000023F00)",
        Buffer.from([0x00, 0xa4, 0x00, 0x00, 0x02, 0x3f, 0x00]),
      );
      await safeTransmit(
        reader,
        "GET CHALLENGE (0084000008)",
        Buffer.from([0x00, 0x84, 0x00, 0x00, 0x08]),
      );

      try {
        const response = await reader.control(ControlCode.GET_FEATURE_REQUEST, Buffer.alloc(0));
        console.log(
          `  GET_FEATURE_REQUEST (${toHex(ControlCode.GET_FEATURE_REQUEST)}): ${formatHex(response) || "<empty>"}`,
        );
      } catch (error) {
        console.log(`  GET_FEATURE_REQUEST: ${error.message}`);
      }

      let exclusiveReady = false;
      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await reader.reconnect(ShareMode.EXCLUSIVE, Protocol.T0 | Protocol.T1, Disposition.LEAVE);
          exclusiveReady = true;
          if (attempt > 1) {
            console.log(`  reconnect(exclusive/no-reset): ok (attempt ${attempt}/3)`);
          } else {
            console.log("  reconnect(exclusive/no-reset): ok");
          }
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 3) {
            console.log(`  reconnect(exclusive/no-reset): retry ${attempt}/3 (${error.message})`);
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
      }

      if (!exclusiveReady) {
        console.log(`  reconnect(exclusive/no-reset): ${lastError?.message ?? "failed"}`);
        console.log("  skipping reset tests: could not acquire exclusive access");
      }

      if (exclusiveReady) {
        try {
          await reader.reconnect(ShareMode.EXCLUSIVE, Protocol.T0 | Protocol.T1, Disposition.RESET);
          console.log("  reconnect(reset): ok");
        } catch (error) {
          console.log(`  reconnect(reset): ${error.message}`);
        }

        try {
          await reader.reconnect(
            ShareMode.EXCLUSIVE,
            Protocol.T0 | Protocol.T1,
            Disposition.UNPOWER,
          );
          console.log("  reconnect(unpower): ok");
        } catch (error) {
          console.log(`  reconnect(unpower): ${error.message}`);
        }
      }

      try {
        reader.disconnect(Disposition.LEAVE);
      } catch {
        // Ignore cleanup failures.
      }
    });

    await Promise.allSettled(readerTasks);

    console.log("\nDone.");
  } finally {
    ctx.close();
  }
}

main().catch((error) => {
  console.error(`Fatal: ${error.message}`);
  process.exit(1);
});
