import { Context, protocolName } from "../lib/index.js";

async function main() {
  const timeoutMs = 30_000;

  const ctx = new Context();

  try {
    console.log("Waiting for first available card...");
    console.log("(Timeout: 30 seconds)");
    ctx.start();

    const reader = await Promise.race([
      new Promise((resolve, reject) => {
        ctx.once("insert", resolve);
        ctx.once("error", reject);
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Timeout waiting for card.")), timeoutMs);
      }),
    ]);

    console.log(`Card detected in: ${reader.name}`);
    console.log(`Connected! Protocol: ${protocolName(reader.protocol)}`);
    if (reader.atr) {
      console.log(`ATR: ${reader.atr.toString("hex")}`);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
  } finally {
    ctx.close();
  }
}

main().catch(console.error);
