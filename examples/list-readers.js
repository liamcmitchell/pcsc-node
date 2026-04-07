import { Context } from "../lib/index.js";

async function main() {
  const ctx = new Context({ autoConnect: false });

  try {
    const readers = await ctx.getReaders();

    console.log(`Readers: ${readers.size}`);
    for (const reader of readers.values()) {
      console.log(`- ${reader.name}`);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
  } finally {
    ctx.close();
  }
}

main().catch(console.error);
