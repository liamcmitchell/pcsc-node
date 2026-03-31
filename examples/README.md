# Examples

Ready-to-run scripts for the current Context/Reader API.

## Prerequisites

Build/install dependencies first:

```bash
cd ..
npm install
```

## Basic

### list-readers.js

List attached readers and current card state.

```bash
node examples/list-readers.js
```

### monitor-cards.js

Monitor reader/card lifecycle events.

```bash
node examples/monitor-cards.js
```

### read-card.js

Wait for a card in a reader and read ATR + UID.

```bash
node examples/read-card.js
node examples/read-card.js "ACS ACR122U PICC Interface 00 00"
```

### send-apdu.js

Send a custom APDU to a detected card.

```bash
node examples/send-apdu.js "FF CA 00 00 00"
node examples/send-apdu.js "00 A4 04 00" "ACS ACR122U PICC Interface 00 00"
```

## Advanced

### wait-for-card.js

Wait for card insertion using Context `insert` events.

```bash
node examples/wait-for-card.js
node examples/wait-for-card.js 30
```

### control-command.js

Send a reader control command with common PC/SC control-code fallbacks.

```bash
node examples/control-command.js "FF 00 40 00 04 D4 4A 01 00"
node examples/control-command.js "FF 00 40 00 04 D4 4A 01 00" "ACS ACR122U PICC Interface 00 00"
```

### reconnect.js

Demonstrate `reader.reconnect()` for reset/protocol/share-mode changes.

```bash
node examples/reconnect.js
node examples/reconnect.js "ACS ACR122U PICC Interface 00 00"
```

### mifare-read-write.js

Authenticate, read, write, verify, and restore a MIFARE Classic block.

```bash
node examples/mifare-read-write.js
node examples/mifare-read-write.js "ACS ACR122U PICC Interface 00 00"
```

### error-handling.js

Demonstrates error handling patterns for operation, monitoring, and retry logic.

```bash
node examples/error-handling.js
```

## Notes

- APDU status words are the last two bytes (SW1/SW2)
- Most contactless readers support UID via `FF CA 00 00 00`
- Some reader control commands are vendor-specific
