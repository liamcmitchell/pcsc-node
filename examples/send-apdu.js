#!/usr/bin/env node
/**
 * Send a custom APDU command to a card.
 *
 * Usage: node send-apdu.js
 */

import { Context, SCARD_PROTOCOL_T0, SCARD_LEAVE_CARD } from "../lib/index.js";

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
    console.log(`Protocol: ${reader.protocol === SCARD_PROTOCOL_T0 ? "T=0" : "T=1"}`);

    const response = await reader.transmit(apdu);
    console.log(`Response: ${formatHex(response)}`);

    if (response.length >= 2) {
      const sw1 = response[response.length - 2];
      const sw2 = response[response.length - 1];
      console.log(`SW: ${((sw1 << 8) | sw2).toString(16).toUpperCase().padStart(4, "0")}`);
    }

    reader.disconnect(SCARD_LEAVE_CARD);
  } catch (error) {
    console.error(`Error: ${error.message}`);
  } finally {
    ctx.close();
  }
}

main();
