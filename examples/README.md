# Examples

Ready-to-run scripts for the current Context/Reader API.

## Prerequisites

Build/install dependencies first:

```bash
cd ..
npm install
```

## Canonical Examples

### list-readers.js

List current readers and print total count via `ctx.readers.size`.

```bash
node examples/list-readers.js
```

### monitor-cards.js

Monitor reader/card lifecycle events.

```bash
node examples/monitor-cards.js
```

### read-card.js

Wait for the first card and read ATR + UID.

```bash
node examples/read-card.js
```

### send-apdu.js

Send a canonical UID APDU (`FF CA 00 00 00`) to the first available card.

```bash
node examples/send-apdu.js
```

### wait-for-card.js

Wait for first card insertion with a fixed 30-second timeout via `Promise.race`.

```bash
node examples/wait-for-card.js
```

### control-command.js

Send a canonical control payload with common PC/SC control-code fallbacks.

```bash
node examples/control-command.js
```

### reconnect.js

Demonstrate `reader.reconnect()` for reset/protocol/share-mode changes.

```bash
node examples/reconnect.js
```

### mifare-read-write.js

Authenticate, read, write, verify, and restore a MIFARE Classic block.

```bash
node examples/mifare-read-write.js
```

### error-handling.js

Demonstrates error handling for monitoring and card operations.

```bash
node examples/error-handling.js
```

## Notes

- APDU status words are the last two bytes (SW1/SW2)
- Most contactless readers support UID via `FF CA 00 00 00`
- Some reader control commands are vendor-specific
