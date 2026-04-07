#!/usr/bin/env node
/**
 * Demonstrates reader.reconnect() for reset/protocol/share-mode changes.
 *
 * Usage: node reconnect.js
 */

import { Context, ShareMode, Protocol, Disposition, protocolName } from "../lib/index.js";

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

    await reader.reconnect(ShareMode.SHARED, Protocol.T0 | Protocol.T1, Disposition.RESET);
    console.log(`After reset: ${protocolName(reader.protocol)}`);

    try {
      await reader.reconnect(ShareMode.SHARED, Protocol.T0, Disposition.RESET);
      console.log(`T=0 reconnect: ${protocolName(reader.protocol)}`);
    } catch (error) {
      console.log(`T=0 not supported: ${error.message}`);
    }

    try {
      await reader.reconnect(ShareMode.SHARED, Protocol.T1, Disposition.RESET);
      console.log(`T=1 reconnect: ${protocolName(reader.protocol)}`);
    } catch (error) {
      console.log(`T=1 not supported: ${error.message}`);
    }

    await reader.reconnect(ShareMode.SHARED, Protocol.T0 | Protocol.T1, Disposition.UNPOWER);
    console.log(`After power cycle: ${protocolName(reader.protocol)}`);

    try {
      await reader.reconnect(ShareMode.EXCLUSIVE, Protocol.T0 | Protocol.T1, Disposition.LEAVE);
      console.log("Exclusive mode acquired.");
      await reader.reconnect(ShareMode.SHARED, Protocol.T0 | Protocol.T1, Disposition.LEAVE);
      console.log("Back to shared mode.");
    } catch (error) {
      console.log(`Exclusive mode failed: ${error.message}`);
    }

    reader.disconnect(Disposition.LEAVE);
  } catch (error) {
    console.error(`Error: ${error.message}`);
  } finally {
    ctx.close();
  }
}

main().catch(console.error);
