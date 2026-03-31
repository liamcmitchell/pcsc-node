#!/usr/bin/env node
/**
 * Send a custom APDU command to a card.
 *
 * Usage: node send-apdu.js <hex-apdu> [reader-name]
 */

import { Context, SCARD_PROTOCOL_T0, SCARD_LEAVE_CARD } from "../lib/index.js";

function parseHex(str) {
  const clean = str.replace(/\s+/g, "").replace(/0x/gi, "");
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error("Invalid hex string");
  if (clean.length % 2 !== 0) throw new Error("Hex string must have even length");

  const bytes = [];
  for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.substr(i, 2), 16));
  return Buffer.from(bytes);
}

function formatHex(buffer) {
  return buffer.toString("hex").toUpperCase().match(/.{2}/g).join(" ");
}

function waitForInsert(ctx, readerName) {
  const existing = [...ctx.readers.values()].find(
    (reader) => (!readerName || reader.name === readerName) && reader.connected,
  );
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const onInsert = (reader) => {
      if (!readerName || reader.name === readerName) {
        cleanup();
        resolve(reader);
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      ctx.off("insert", onInsert);
      ctx.off("error", onError);
    };

    ctx.on("insert", onInsert);
    ctx.on("error", onError);
  });
}

async function main() {
  if (process.argv.length < 3) {
    console.log("Usage: node send-apdu.js <hex-apdu> [reader-name]");
    process.exit(1);
  }

  const apdu = parseHex(process.argv[2]);
  const readerName = process.argv[3] || undefined;
  const ctx = new Context();

  console.log(`APDU: ${formatHex(apdu)}`);

  try {
    ctx.start();
    const reader = await waitForInsert(ctx, readerName);

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
