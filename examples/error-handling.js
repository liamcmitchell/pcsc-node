#!/usr/bin/env node
/**
 * Demonstrates handling context and reader errors.
 *
 * Usage: node error-handling.js [reader-name]
 */

import {
  Context,
  SCARD_LEAVE_CARD,
  SCARD_UNPOWER_CARD,
  SmartCardError,
  NoCardError,
  NoReadersAvailableError,
} from "../lib/index.js";

function waitForAttach(ctx, readerName) {
  const existing = [...ctx.readers.values()].find(
    (reader) => !readerName || reader.name === readerName,
  );
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const onAttach = (reader) => {
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
      ctx.off("attach", onAttach);
      ctx.off("error", onError);
    };

    ctx.once("attach", onAttach);
    ctx.once("error", onError);
  });
}

async function main() {
  const readerName = process.argv[2] || undefined;
  const ctx = new Context();

  ctx.on("error", (error) => {
    if (error instanceof NoReadersAvailableError) {
      console.error("No readers available. Connect a reader and retry.");
      return;
    }
    console.error(`Context error: ${error.message}`);
  });

  ctx.on("attach", (reader) => {
    console.log(`Reader attached: ${reader.name}`);
  });

  ctx.on("detach", (reader) => {
    console.log(`Reader detached: ${reader.name}`);
  });

  try {
    ctx.start();
    const reader = await waitForAttach(ctx, readerName);

    console.log(`Using reader: ${reader.name}`);

    try {
      await reader.transmit([0xff, 0xca, 0x00, 0x00, 0x00]);
      console.log("Command succeeded.");
    } catch (error) {
      if (error instanceof NoCardError) {
        console.error("No card inserted.");
      } else if (error instanceof SmartCardError) {
        console.error(`Smart card error: ${error.message} (0x${error.code?.toString(16)})`);
      } else {
        console.error(`Unknown reader error: ${error.message}`);
      }
    }

    try {
      await reader.disconnect(SCARD_UNPOWER_CARD);
    } catch {
      await reader.disconnect(SCARD_LEAVE_CARD);
    }
  } catch (error) {
    console.error(`Fatal error: ${error.message}`);
  } finally {
    ctx.close();
  }
}

main();
