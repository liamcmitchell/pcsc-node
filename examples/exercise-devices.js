#!/usr/bin/env node
/**
 * Exercise both known readers with a PKI card.
 *
 * Usage:
 *   node examples/exercise-devices.js
 */

import {
  Context,
  SCARD_SHARE_EXCLUSIVE,
  SCARD_PROTOCOL_T0,
  SCARD_PROTOCOL_T1,
  SCARD_LEAVE_CARD,
  SCARD_RESET_CARD,
  SCARD_UNPOWER_CARD,
  CM_IOCTL_GET_FEATURE_REQUEST,
} from "../lib/index.js";

function formatHex(buffer) {
  return buffer.toString("hex").toUpperCase();
}

function describeStatusWord(statusWord) {
  switch (statusWord) {
    case 0x9000:
      return "ok";
    case 0x6700:
      return "wrong length";
    case 0x6881:
      return "not supported";
    case 0x6982:
      return "security status not satisfied";
    case 0x6985:
      return "conditions of use not satisfied";
    case 0x6a82:
      return "file or application not found";
    case 0x6d00:
      return "instruction not supported";
    default:
      return null;
  }
}

async function safeTransmit(reader, name, command) {
  try {
    const response = await reader.transmit(command);
    const sw1 = response[response.length - 2];
    const sw2 = response[response.length - 1];
    const statusWord = (sw1 << 8) | sw2;
    const description = describeStatusWord(statusWord);
    console.log(
      `  ${name}: ${formatHex(response)} (SW=${statusWord.toString(16).toUpperCase().padStart(4, "0")}${description ? ` ${description}` : ""})`,
    );
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
      console.log(
        `  protocol: ${reader.protocol === SCARD_PROTOCOL_T0 ? "T=0" : reader.protocol === SCARD_PROTOCOL_T1 ? "T=1" : reader.protocol}`,
      );
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
        const response = await reader.control(CM_IOCTL_GET_FEATURE_REQUEST, Buffer.alloc(0));
        console.log(
          `  GET_FEATURE_REQUEST (0x${CM_IOCTL_GET_FEATURE_REQUEST.toString(16).toUpperCase()}): ${formatHex(response) || "<empty>"}`,
        );
      } catch (error) {
        console.log(`  GET_FEATURE_REQUEST: ${error.message}`);
      }

      let exclusiveReady = false;
      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await reader.reconnect(
            SCARD_SHARE_EXCLUSIVE,
            SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1,
            SCARD_LEAVE_CARD,
          );
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
          await reader.reconnect(
            SCARD_SHARE_EXCLUSIVE,
            SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1,
            SCARD_RESET_CARD,
          );
          console.log("  reconnect(reset): ok");
        } catch (error) {
          console.log(`  reconnect(reset): ${error.message}`);
        }

        try {
          await reader.reconnect(
            SCARD_SHARE_EXCLUSIVE,
            SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1,
            SCARD_UNPOWER_CARD,
          );
          console.log("  reconnect(unpower): ok");
        } catch (error) {
          console.log(`  reconnect(unpower): ${error.message}`);
        }
      }

      try {
        reader.disconnect(SCARD_LEAVE_CARD);
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
