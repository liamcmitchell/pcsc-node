#!/usr/bin/env node
/**
 * Send an escape/control command to a reader.
 *
 * Usage: node control-command.js <hex-command> [reader-name]
 */

import {
  Context,
  getControlCode,
  SCARD_CTL_CODE,
  SCARD_PROTOCOL_T0,
  SCARD_LEAVE_CARD,
} from "../lib/index.js";

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
    console.log("Usage: node control-command.js <hex-command> [reader-name]");
    process.exit(1);
  }

  const command = parseHex(process.argv[2]);
  const readerName = process.argv[3] || undefined;
  const ctx = new Context();

  // Common fallback controls used by PC/SC readers.
  const controlCandidates = [
    getControlCode(SCARD_CTL_CODE.IOCTL_CCID_ESCAPE),
    SCARD_CTL_CODE.CM_IOCTL_GET_FEATURE_REQUEST,
  ];

  try {
    ctx.start();
    const reader = await waitForInsert(ctx, readerName);

    console.log(`Reader: ${reader.name}`);
    console.log(`Protocol: ${reader.protocol === SCARD_PROTOCOL_T0 ? "T=0" : "T=1"}`);
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

    console.log(`Control code: 0x${usedCode.toString(16).toUpperCase()}`);
    console.log(`Response: ${formatHex(response)}`);

    reader.disconnect(SCARD_LEAVE_CARD);
  } catch (error) {
    console.error(`Error: ${error.message}`);
  } finally {
    ctx.close();
  }
}

main();
