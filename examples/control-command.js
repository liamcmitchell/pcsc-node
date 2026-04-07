import {
  Context,
  Disposition,
  ControlCode,
  platformControlCode,
  protocolName,
} from "../lib/index.js";
import { toHex } from "../lib/hex.js";

function formatHex(buffer) {
  return buffer.toString("hex").toUpperCase().match(/.{2}/g).join(" ");
}

async function main() {
  const command = Buffer.from([0xd4, 0x4a, 0x01, 0x00]);
  const ctx = new Context();

  // Common fallback controls used by PC/SC readers.
  const controlCandidates = [platformControlCode(1), ControlCode.GET_FEATURE_REQUEST];

  try {
    ctx.start();
    const reader = await new Promise((resolve, reject) => {
      ctx.once("insert", resolve);
      ctx.once("error", reject);
    });

    console.log(`Reader: ${reader.name}`);
    console.log(`Protocol: ${protocolName(reader.protocol)}`);
    console.log(`Command: ${formatHex(command)}`);

    let response = null;
    let usedCode = null;

    for (const code of controlCandidates) {
      try {
        response = await reader.control(code, command);
        usedCode = code;
        break;
      } catch {
        // Try next control code candidate.
      }
    }

    if (!response) {
      throw new Error("Control command failed with all known control codes");
    }

    console.log(`Control code: ${toHex(usedCode)}`);
    console.log(`Response: ${formatHex(response)}`);

    reader.disconnect(Disposition.LEAVE);
  } catch (error) {
    console.error(`Error: ${error.message}`);
  } finally {
    ctx.close();
  }
}

main();
