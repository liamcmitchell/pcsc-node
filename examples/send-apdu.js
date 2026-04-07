#!/usr/bin/env node
/**
 * Send a custom APDU command to a card.
 *
 * Usage: node send-apdu.js
 */

import { Context, Disposition, parseResponse, protocolName } from "../lib/index.js";
import { toHex } from "../lib/hex.js";

function formatHex(buffer) {
  return buffer.toString("hex").toUpperCase().match(/.{2}/g).join(" ");
}

async function main() {
  const apdu = Buffer.from([0xff, 0xca, 0x00, 0x00, 0x00]);
  const ctx = new Context();

  console.log(`APDU: ${formatHex(apdu)}`);

  try {
    ctx.start();
    const reader = await new Promise((resolve, reject) => {
      ctx.once("insert", resolve);
      ctx.once("error", reject);
    });

    console.log(`Reader: ${reader.name}`);
    console.log(`Protocol: ${protocolName(reader.protocol)}`);

    const response = await reader.transmit(apdu);
    console.log(`Response: ${formatHex(response)}`);

    const parsed = parseResponse(response);
    console.log(`SW: ${toHex(parsed.sw, 4)}`);

    reader.disconnect(Disposition.LEAVE);
  } catch (error) {
    console.error(`Error: ${error.message}`);
  } finally {
    ctx.close();
  }
}

main();
