#!/usr/bin/env node
/**
 * Send an escape/control command to a reader.
 *
 * Usage: node control-command.js
 */

import {
  Context,
  getControlCode,
  SCARD_CTL_CODE,
  SCARD_PROTOCOL_T0,
  SCARD_LEAVE_CARD,
} from "../lib/index.js";

function formatHex(buffer) {
  return buffer.toString("hex").toUpperCase().match(/.{2}/g).join(" ");
}

async function main() {
  const command = Buffer.from([0xd4, 0x4a, 0x01, 0x00]);
  const ctx = new Context();

  // Common fallback controls used by PC/SC readers.
  const controlCandidates = [
    getControlCode(SCARD_CTL_CODE.IOCTL_CCID_ESCAPE),
    SCARD_CTL_CODE.CM_IOCTL_GET_FEATURE_REQUEST,
  ];

  try {
    ctx.start();
    const reader = await new Promise((resolve, reject) => {
      ctx.once("insert", resolve);
      ctx.once("error", reject);
    });

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
