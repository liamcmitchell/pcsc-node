#!/usr/bin/env node
/**
 * List all currently attached PC/SC readers.
 *
 * Usage: node list-readers.js
 */

import { Context } from "../lib/index.js";

async function main() {
  const ctx = new Context({ autoConnect: false });

  try {
    ctx.start();
    await new Promise((resolve) => setTimeout(resolve, 250));

    console.log(`Readers: ${ctx.readers.size}`);
    for (const reader of ctx.readers.values()) {
      console.log(`- ${reader.name}`);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
  } finally {
    ctx.close();
  }
}

main().catch(console.error);
