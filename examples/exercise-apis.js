import {
  Context,
  ShareMode,
  Protocol,
  Disposition,
  ControlCode,
  parseFeaturesDetails,
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
  console.log("Exercise APIs");
  console.log("========================");
  console.log(`Platform: ${process.platform} (${process.arch}) Node ${process.version}`);

  const ctx = new Context();

  ctx.on("error", (error) => console.log(`[error] ${error.message}`));

  try {
    const readers = await ctx.getReaders();

    console.log(`Available readers: ${readers.size}`);

    for (const reader of readers.values()) {
      if (reader.name.toLowerCase().includes("windows hello")) {
        console.log(`${reader.name}: skipping`);
        continue
      }

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
      await safeTransmit(
        reader,
        "INTENTIONAL ERROR (00FF000000)",
        Buffer.from([0x00, 0xff, 0x00, 0x00, 0x00]),
      );

      try {
        await reader.control("not-a-number", Buffer.alloc(0));
      } catch (error) {
        console.log(`  INTENTIONAL JS EXCEPTION (invalid control arg): ${error.message}`);
      }

      try {
        await reader.control(0, Buffer.alloc(0));
      } catch (error) {
        const code = typeof error?.code === "number" ? toHex(error.code) : "<none>";
        console.log(`  INTENTIONAL PCSC ERROR (control code=0): ${error.message} (code=${code})`);
      }

      try {
        const response = await reader.control(ControlCode.GET_FEATURE_REQUEST, Buffer.alloc(0));
        const features = parseFeaturesDetails(response);
        console.log(
          `  GET_FEATURE_REQUEST (${toHex(ControlCode.GET_FEATURE_REQUEST)}): ${features.length} features`,
        );
        for (const feature of features) {
          console.log(`    ${feature.name}: ${toHex(feature.controlCode)}`);
        }
      } catch (error) {
        console.log(`  GET_FEATURE_REQUEST: ${error.message}`);
      }

      let exclusiveReady = false;
      let lastError = null;
      try {
        await reader.reconnect(ShareMode.EXCLUSIVE, Protocol.T0 | Protocol.T1, Disposition.LEAVE);
        exclusiveReady = true;
        console.log("  reconnect(exclusive/no-reset): ok");
      } catch (error) {
        lastError = error;
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
    }

    console.log("\nDone.");
  } finally {
    ctx.close();
  }
}

main().catch((error) => {
  console.error(`Fatal: ${error.message}`);
  process.exit(1);
});
