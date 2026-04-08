# pcsc-node

[PC/SC](https://en.wikipedia.org/wiki/PC/SC) bindings for Node.js 22+. Access hardware smart card readers and NFC devices on macOS, Windows, and Linux.

- Built on N-API for ABI stability, no need to recompile across node versions.
- ES modules, TS types in JSDoc. No JS build step means you can fork & install from git.
- Compatible with Electron.

## Install

Not yet available on npm.

```bash
npm install github:liamcmitchell/pcsc-node
```

## Platform Setup

macOS and Windows are ready out of the box.

Linux requires pcsclite headers for compilation and pcscd at runtime:

```bash
sudo apt-get install libpcsclite-dev pcscd   # Debian/Ubuntu
sudo dnf install pcsc-lite-devel pcsc-lite   # Fedora/RHEL
sudo systemctl start pcscd
```

## API Model

- Context: lifecycle and reader/card event monitoring
- Reader: connected card operations (`transmit`, `control`, `reconnect`, `disconnect`)

Typical flow:

1. Create `new Context()`
2. Register event listeners (`reader`, `attach`, `detach`, `insert`, `remove`, `change`, `error`)
3. Call `start()` or `getReaders()` (auto-start)
4. Use `reader` methods
5. Call `close()` on shutdown

## Quick Start

```javascript
import { Context, StatusWord, parseResponse, protocolName } from "pcsc-node";

const ctx = new Context();

ctx
  .on("attach", (reader) => {
    console.log("Reader attached:", reader.name);
  })
  .on("insert", async (reader) => {
    console.log("Card inserted in", reader.name);
    if (reader.atr) {
      console.log("ATR:", reader.atr.toString("hex"));
    }

    try {
      const uidResponse = await reader.transmit([0xff, 0xca, 0x00, 0x00, 0x00]);
      const parsed = parseResponse(uidResponse);
      if (parsed.sw === StatusWord.OK) {
        console.log("UID:", parsed.data.toString("hex"));
      }
    } catch (error) {
      console.error("Transmit failed:", error.message);
    }
  })
  .on("remove", (reader) => {
    console.log("Card removed from", reader.name);
  })
  .on("error", (error) => {
    console.error("Error:", error.message);
  })
  .start();

process.on("SIGINT", () => {
  ctx.close();
  process.exit(0);
});
```

## Context

```typescript
class Context extends EventEmitter {
  constructor(options?: { autoConnect?: boolean; autoGetResponse?: boolean });
  readonly isValid: boolean;
  // All known readers, currently or previously attached.
  readonly readers: ReadonlyMap<string, Reader>;
  // Start monitoring.
  start(): this;
  // Starts monitoring if needed and resolves after initial reader discovery has completed.
  getReaders(): Promise<ReadonlyMap<string, Reader>>;
  // Stop monitoring.
  close(): void;
}
```

Context events:

| Event    | Args                  | Description                                                                                                                   |
| -------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `reader` | `(reader)`            | Fired once when a new `Reader` instance is created for a reader name. This fires before the first `attach` for that instance. |
| `attach` | `(reader)`            | Fired when a reader becomes available. Can fire multiple times for the same `Reader` instance after detach/reattach.          |
| `detach` | `(reader)`            | Fired when a reader is removed/unavailable.                                                                                   |
| `change` | `(reader, prevState)` | Fired when PC/SC state flags change for a currently attached reader.                                                          |
| `insert` | `(reader)`            | Fired when a card becomes present. If `autoConnect` is enabled, connection is established before this event.                  |
| `remove` | `(reader)`            | Fired when a card is removed or when a connected reader is detached.                                                          |
| `error`  | `(error)`             | Fired for monitor errors or propagated reader operation errors without a reader-level error listener.                         |
| `ready`  | `()`                  | Fired after initial startup events are processed (same lifecycle point as `await ctx.getReaders()`).                          |

## Reader

```typescript
class Reader extends EventEmitter {
  readonly name: string;
  readonly attached: boolean;
  readonly state: number;
  readonly atr: Buffer | null;
  readonly connected: boolean;
  readonly protocol: number;

  connect(
    shareMode?: number, // ShareMode.SHARED | ShareMode.EXCLUSIVE | ShareMode.DIRECT
    preferredProtocols?: number, // Protocol.T0 | Protocol.T1 | Protocol.RAW | Protocol.UNDEFINED
  ): Promise<void>;

  transmit(
    command: Buffer | number[], // APDU command bytes
    maxRecvLength?: number, // max bytes to request (Le), default 256
    autoGetResponse?: boolean, // enable/disable auto GET RESPONSE, default true
  ): Promise<Buffer>;

  control(
    code: number, // control code
    data?: Buffer | number[], // optional data payload
  ): Promise<Buffer>;

  reconnect(
    shareMode?: number, // ShareMode.SHARED | ShareMode.EXCLUSIVE
    protocol?: number, // Protocol.T0 | Protocol.T1 | Protocol.RAW
    initialization?: number, // Disposition.LEAVE | Disposition.RESET | Disposition.UNPOWER | Disposition.EJECT
  ): Promise<void>;

  disconnect(
    disposition?: number, // Disposition.LEAVE | Disposition.RESET | Disposition.UNPOWER | Disposition.EJECT
  ): void;
}
```

Reader events:

| Event    | Args                  | Description                                                                                              |
| -------- | --------------------- | -------------------------------------------------------------------------------------------------------- |
| `attach` | `(reader)`            | Mirrors context `attach` for this reader instance.                                                       |
| `detach` | `(reader)`            | Mirrors context `detach` for this reader instance.                                                       |
| `change` | `(reader, prevState)` | Mirrors context `change` for this reader instance.                                                       |
| `insert` | `(reader)`            | Mirrors context `insert` for this reader instance.                                                       |
| `remove` | `(reader)`            | Mirrors context `remove` for this reader instance.                                                       |
| `error`  | `(error)`             | Reader-targeted operation errors (for example connect failures) when a reader error listener is present. |

## Transmit (Sending APDUs)

Send ISO 7816-4 APDUs (application protocol data units) and parse responses.

```javascript
import { StatusWord, parseResponse, statusWordName } from "pcsc-node";

// Send a command and receive response
const response = await reader.transmit([0x00, 0xa4, 0x04, 0x00, 0x0e, ...appId]);

// Parse response into data + status word
const { data, sw } = parseResponse(response);

// Check common status words
if (sw === StatusWord.OK) {
  // Command succeeded
  console.log("Selected:", data.toString("hex"));
} else if (sw === StatusWord.FILE_OR_APPLICATION_NOT_FOUND) {
  console.log("App not found");
} else {
  // Get human-readable name for unknown status words
  console.log("Error:", statusWordName(sw));
}
```

**Response Parsing** (`parseResponse(buffer)`):
Returns `{ sw1, sw2, sw, data }` where:

- `sw1`, `sw2` — individual status bytes
- `sw` — combined status word (sw1 << 8 | sw2)
- `data` — response body (excludes status bytes)

The `autoGetResponse` option only applies to T=0 protocol and handles status words:

- `61 xx` — automatically sends GET RESPONSE
- `6C xx` — automatically retries with corrected Le

To disable for a specific call:

```javascript
const response = await reader.transmit([0x00, 0xa4, 0x04, 0x00, 0x0e], undefined, false);
```

Or disable by default for all calls:

```javascript
const ctx = new Context({ autoGetResponse: false });
```

## Control Codes

```javascript
import { ControlCode, Feature, parseFeaturesDetails, platformControlCode } from "pcsc-node";

const featuresRaw = await reader.control(ControlCode.GET_FEATURE_REQUEST);
const features = parseFeaturesDetails(featuresRaw);

for (const feature of features) {
  console.log(feature.name, feature.controlCode);
}

const verify = features.find((f) => f.tag === Feature.VERIFY_PIN_DIRECT);
if (verify) {
  console.log("verify code", verify.controlCode);
}

const customCode = platformControlCode(3500);
```

## Errors

```javascript
import { Errors } from "pcsc-node";

try {
  await reader.transmit([0x00, 0xa4, 0x04, 0x00]);
} catch (error) {
  if (error?.code === Errors.CARD_REMOVED) {
    console.log("Card removed");
  } else if (error?.code === Errors.SHARING_VIOLATION) {
    console.log("Card is in use elsewhere");
  } else {
    console.log(`Error: ${error.message}`);
  }
}
```

## Examples

```bash
npm install
node examples/list-readers.js
```

| File                            | Description                                                             |
| ------------------------------- | ----------------------------------------------------------------------- |
| `examples/list-readers.js`      | List current readers and print total count via `ctx.readers.size`.      |
| `examples/monitor-cards.js`     | Monitor reader/card lifecycle events.                                   |
| `examples/read-card.js`         | Wait for first card and read ATR + UID.                                 |
| `examples/send-apdu.js`         | Send a UID APDU (`FF CA 00 00 00`) to the first available card.         |
| `examples/wait-for-card.js`     | Wait for first card insertion with a fixed 30-second timeout.           |
| `examples/control-command.js`   | Send a control payload with common PC/SC control-code fallbacks.        |
| `examples/reconnect.js`         | Demonstrate `reader.reconnect()` for reset/protocol/share-mode changes. |
| `examples/mifare-read-write.js` | Authenticate, read, write, verify, and restore a MIFARE Classic block.  |
| `examples/error-handling.js`    | Demonstrate monitor and card operation error handling.                  |
| `examples/exercise-apis.js`     | Exercise as many APIs as possible in one command.                       |

## License

MIT

## Related Projects

- [smartcard](https://github.com/tomkp/smartcard) - Source of this fork, very different now
- [node-pcsclite](https://github.com/pokusew/node-pcsclite) - Uses older NaN abstraction, no longer compiles on newer node/electron
- [pcsc-mini](https://github.com/liamcmitchell/pcsc-mini) - Written in TS/Zig, distributes pre-built binaries, doesn't work on electron
