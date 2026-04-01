#!/usr/bin/env node
/**
 * Exercise both known readers with a PKI card, using safe checks by default.
 *
 * Usage:
 *   node examples/exercise-devices.js
 *   node examples/exercise-devices.js --allow-reset
 *   node examples/exercise-devices.js --allow-reset --allow-unpower
 */

import {
  Context,
  SCARD_SHARE_SHARED,
  SCARD_PROTOCOL_T0,
  SCARD_PROTOCOL_T1,
  SCARD_LEAVE_CARD,
  SCARD_RESET_CARD,
  SCARD_UNPOWER_CARD,
  platformControlCode,
  CM_IOCTL_GET_FEATURE_REQUEST,
  parseFeatures,
} from "../lib/index.js";

const EXPECTED_READERS = ["ACS ACR39U ICC Reader", "ACS ACR122U"];

const allowReset = process.argv.includes("--allow-reset");
const allowUnpower = process.argv.includes("--allow-unpower");

function formatHex(buffer) {
  return buffer.toString("hex").toUpperCase();
}

function getKnownReaderLabel(name) {
  const lower = name.toLowerCase();
  return EXPECTED_READERS.find((label) => lower.includes(label.toLowerCase()));
}

async function safeTransmit(reader, name, command) {
  try {
    const response = await reader.transmit(command);
    const sw1 = response[response.length - 2];
    const sw2 = response[response.length - 1];
    console.log(
      `  ${name}: ${formatHex(response)} (SW=${((sw1 << 8) | sw2).toString(16).toUpperCase().padStart(4, "0")})`,
    );
  } catch (error) {
    console.log(`  ${name}: ${error.message}`);
  }
}

async function safeControl(reader) {
  // Escape command IOCTL often maps to code 1 on PC/SC stacks.
  const controlCodes = [CM_IOCTL_GET_FEATURE_REQUEST, platformControlCode(1)];

  for (const code of controlCodes) {
    try {
      const response = await reader.control(code, Buffer.alloc(0));
      console.log(
        `  control(0x${code.toString(16).toUpperCase()}): ${formatHex(response) || "<empty>"}`,
      );
      if (response.length > 0) {
        const features = parseFeatures(response);
        console.log(`  parsed features: ${features.size}`);
      }
      return;
    } catch {
      // Try next control code.
    }
  }

  console.log("  control: not supported by this reader/driver");
}

async function main() {
  console.log("Smartcard Device Exercise");
  console.log("========================");
  console.log("Safe checks are enabled by default.");
  console.log(`Opt-in reset checks: ${allowReset ? "enabled" : "disabled"}`);
  console.log(`Opt-in unpower checks: ${allowUnpower ? "enabled" : "disabled"}\n`);

  const ctx = new Context();

  ctx.on("error", (error) => console.log(`[error] ${error.message}`));

  try {
    await ctx.start().whenReady();

    console.log(`Available readers: ${ctx.readers.size}`);
    const readerTasks = [...ctx.readers.values()].map(async (reader) => {
      const matchedLabel = getKnownReaderLabel(reader.name);
      if (!matchedLabel) {
        console.log(`${reader.name}: unknown, skipping`);
        return;
      }

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

      // Safe APDUs: UID (works on many contactless cards), then generic SELECT MF, then GET CHALLENGE.
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

      await safeControl(reader);

      if (allowReset) {
        try {
          await reader.reconnect(
            SCARD_SHARE_SHARED,
            SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1,
            SCARD_RESET_CARD,
          );
          console.log("  reconnect(reset): ok");
        } catch (error) {
          console.log(`  reconnect(reset): ${error.message}`);
        }
      }

      if (allowUnpower) {
        try {
          await reader.reconnect(
            SCARD_SHARE_SHARED,
            SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1,
            SCARD_UNPOWER_CARD,
          );
          console.log("  reconnect(unpower): ok");
        } catch (error) {
          console.log(`  reconnect(unpower): ${error.message}`);
        }
      }

      try {
        await reader.disconnect(SCARD_LEAVE_CARD);
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
