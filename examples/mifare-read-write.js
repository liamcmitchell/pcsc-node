#!/usr/bin/env node
/**
 * MIFARE Classic block read/write demo.
 *
 * Usage: node mifare-read-write.js [reader-name]
 *
 * WARNING: This writes block 4. Use a test card only.
 */

import {
  Context,
  SCARD_PROTOCOL_T0,
  SCARD_LEAVE_CARD,
  BLOCK_NUMBER,
  MIFARE_CLASSIC,
  MIFARE_ULTRALIGHT,
} from "../lib/index.js";

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

function detectCardType(atr) {
  if (!atr || atr.length < 14) return MIFARE_ULTRALIGHT;

  const standard = atr[13];
  if (standard === 0) return MIFARE_ULTRALIGHT;
  if (standard === 1) return MIFARE_CLASSIC;

  return MIFARE_ULTRALIGHT;
}

function buildAuthApdu(blockNumber, keyType = 0x60, keyNumber = 0x00) {
  return Buffer.from([0xff, 0x86, 0x00, 0x00, 0x05, 0x01, 0x00, blockNumber, keyType, keyNumber]);
}

function buildReadApdu(blockNumber, length = 16) {
  return Buffer.from([0xff, 0xb0, 0x00, blockNumber, length]);
}

function buildWriteApdu(blockNumber, data) {
  return Buffer.concat([Buffer.from([0xff, 0xd6, 0x00, blockNumber, data.length]), data]);
}

function assertSuccess(response, operation) {
  const sw1 = response[response.length - 2];
  const sw2 = response[response.length - 1];
  if (sw1 !== 0x90 || sw2 !== 0x00) {
    throw new Error(`${operation} failed (${sw1.toString(16)} ${sw2.toString(16)})`);
  }
}

async function main() {
  const readerName = process.argv[2] || undefined;
  const ctx = new Context();

  try {
    console.log("Waiting for card...");
    ctx.start();

    const reader = await waitForInsert(ctx, readerName);
    console.log(`Reader: ${reader.name}`);
    console.log(`Protocol: ${reader.protocol === SCARD_PROTOCOL_T0 ? "T=0" : "T=1"}`);

    if (reader.atr) console.log(`ATR: ${reader.atr.toString("hex")}`);

    const cardType = detectCardType(reader.atr);
    console.log(
      cardType === MIFARE_CLASSIC ? "Detected MIFARE Classic" : "Detected MIFARE Ultralight",
    );

    if (cardType !== MIFARE_CLASSIC) {
      throw new Error("This demo currently expects a MIFARE Classic card");
    }

    console.log(`Authenticating block ${BLOCK_NUMBER} with Key A...`);
    const auth = await reader.transmit(buildAuthApdu(BLOCK_NUMBER));
    assertSuccess(auth, "Authentication");

    console.log(`Reading block ${BLOCK_NUMBER}...`);
    const original = await reader.transmit(buildReadApdu(BLOCK_NUMBER));
    assertSuccess(original, "Read");
    const originalData = original.subarray(0, -2);
    console.log(`Original: ${originalData.toString("hex")}`);

    const writeData = Buffer.alloc(16, 0);
    Buffer.from("SMARTCARD-DEMO", "ascii").copy(writeData);

    console.log(`Writing block ${BLOCK_NUMBER}...`);
    const write = await reader.transmit(buildWriteApdu(BLOCK_NUMBER, writeData));
    assertSuccess(write, "Write");

    const verify = await reader.transmit(buildReadApdu(BLOCK_NUMBER));
    assertSuccess(verify, "Verify read");
    const verifyData = verify.subarray(0, -2);
    console.log(`Updated: ${verifyData.toString("hex")}`);

    console.log("Restoring original block data...");
    const restore = await reader.transmit(buildWriteApdu(BLOCK_NUMBER, originalData));
    assertSuccess(restore, "Restore write");

    console.log("Done.");
    reader.disconnect(SCARD_LEAVE_CARD);
  } catch (error) {
    console.error(`Error: ${error.message}`);
  } finally {
    ctx.close();
  }
}

main();
