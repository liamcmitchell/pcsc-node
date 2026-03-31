#!/usr/bin/env node
/**
 * Demonstrates reader.reconnect() for reset/protocol/share-mode changes.
 *
 * Usage: node reconnect.js
 */

import {
  Context,
  SCARD_SHARE_SHARED,
  SCARD_SHARE_EXCLUSIVE,
  SCARD_PROTOCOL_T0,
  SCARD_PROTOCOL_T1,
  SCARD_LEAVE_CARD,
  SCARD_RESET_CARD,
  SCARD_UNPOWER_CARD,
} from "../lib/index.js";

function protocolName(protocol) {
  if (protocol === SCARD_PROTOCOL_T0) return "T=0";
  if (protocol === SCARD_PROTOCOL_T1) return "T=1";
  return `Unknown (${protocol})`;
}

async function main() {
  const ctx = new Context();

  try {
    ctx.start();
    const reader = await new Promise((resolve, reject) => {
      ctx.once("insert", resolve);
      ctx.once("error", reject);
    });

    console.log(`Reader: ${reader.name}`);
    console.log(`Protocol: ${protocolName(reader.protocol)}`);

    await reader.reconnect(
      SCARD_SHARE_SHARED,
      SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1,
      SCARD_RESET_CARD,
    );
    console.log(`After reset: ${protocolName(reader.protocol)}`);

    try {
      await reader.reconnect(SCARD_SHARE_SHARED, SCARD_PROTOCOL_T0, SCARD_RESET_CARD);
      console.log(`T=0 reconnect: ${protocolName(reader.protocol)}`);
    } catch (error) {
      console.log(`T=0 not supported: ${error.message}`);
    }

    try {
      await reader.reconnect(SCARD_SHARE_SHARED, SCARD_PROTOCOL_T1, SCARD_RESET_CARD);
      console.log(`T=1 reconnect: ${protocolName(reader.protocol)}`);
    } catch (error) {
      console.log(`T=1 not supported: ${error.message}`);
    }

    await reader.reconnect(
      SCARD_SHARE_SHARED,
      SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1,
      SCARD_UNPOWER_CARD,
    );
    console.log(`After power cycle: ${protocolName(reader.protocol)}`);

    try {
      await reader.reconnect(
        SCARD_SHARE_EXCLUSIVE,
        SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1,
        SCARD_LEAVE_CARD,
      );
      console.log("Exclusive mode acquired.");
      await reader.reconnect(
        SCARD_SHARE_SHARED,
        SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1,
        SCARD_LEAVE_CARD,
      );
      console.log("Back to shared mode.");
    } catch (error) {
      console.log(`Exclusive mode failed: ${error.message}`);
    }

    reader.disconnect(SCARD_LEAVE_CARD);
  } catch (error) {
    console.error(`Error: ${error.message}`);
  } finally {
    ctx.close();
  }
}

main().catch(console.error);
