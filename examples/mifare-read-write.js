import {
  Context,
  Disposition,
  StatusWord,
  BLOCK_NUMBER,
  MIFARE_CLASSIC,
  MIFARE_ULTRALIGHT,
  parseResponse,
  protocolName,
  statusWordName,
} from "../lib/index.js";
import { toHex } from "../lib/hex.js";

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
  const parsed = parseResponse(response);
  if (parsed.sw !== StatusWord.OK) {
    const hint = statusWordName(parsed.sw);
    throw new Error(`${operation} failed (${toHex(parsed.sw, 4)} ${hint})`);
  }
}

async function main() {
  const ctx = new Context();

  try {
    console.log("Waiting for card...");
    ctx.start();

    const reader = await new Promise((resolve, reject) => {
      ctx.once("insert", resolve);
      ctx.once("error", reject);
    });
    console.log(`Reader: ${reader.name}`);
    console.log(`Protocol: ${protocolName(reader.protocol)}`);

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
    Buffer.from("DEMO", "ascii").copy(writeData);

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
    reader.disconnect(Disposition.LEAVE);
  } catch (error) {
    console.error(`Error: ${error.message}`);
  } finally {
    ctx.close();
  }
}

main();
