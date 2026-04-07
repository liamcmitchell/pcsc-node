# smartcard

Stable PC/SC bindings for Node.js.

Works with Node.js 22+ without recompilation. Built on N-API for ABI stability.

## Install

```bash
npm install smartcard
```

## Platform Setup

macOS and Windows are ready out of the box.

Linux:

```bash
sudo apt-get install libpcsclite-dev pcscd   # Debian/Ubuntu
sudo dnf install pcsc-lite-devel pcsc-lite   # Fedora/RHEL
sudo systemctl start pcscd
```

## API Model

There is one API surface:

- Context: lifecycle and reader/card event monitoring
- Reader: connected card operations (`transmit`, `control`, `reconnect`, `disconnect`)

Typical flow:

1. Create `new Context()`
2. Register event listeners (`attach`, `detach`, `insert`, `remove`, `change`, `error`)
3. Call `start()`
4. Use `reader` methods inside event handlers
5. Call `close()` on shutdown

## Quick Start

```javascript
const { Context, StatusWord, parseResponse, protocolName } = require("smartcard");

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
    console.error("Monitor error:", error.message);
  })
  .start();

process.on("SIGINT", () => {
  ctx.close();
  process.exit(0);
});
```

## Context

```typescript
class Context {
  constructor(options?: { autoConnect?: boolean; autoGetResponse?: boolean });
  readonly isValid: boolean;
  readonly readers: ReadonlyMap<string, Reader>;
  start(): this;
  close(): void;

  on(event: "attach", listener: (reader: Reader) => void): this;
  on(event: "detach", listener: (reader: Reader) => void): this;
  on(event: "change", listener: (reader: Reader, prevState: number) => void): this;
  on(event: "insert", listener: (reader: Reader) => void): this;
  on(event: "remove", listener: (reader: Reader) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}
```

Set `PCSC_DEBUG=1` to enable native monitor logging in the format `[pcsc] <location> <bits> <reader>`, where location is a single character and bits are emitted in `UICNVEPAXSM` order.

## Reader

```typescript
class Reader {
  readonly name: string;
  state: number;
  atr: Buffer | null;
  readonly connected: boolean;
  readonly protocol: number;

  connect(shareMode?: number, preferredProtocols?: number): Promise<void>;
  transmit(
    command: Buffer | number[],
    options?: { maxRecvLength?: number; autoGetResponse?: boolean },
  ): Promise<Buffer>;
  control(code: number, data?: Buffer | number[]): Promise<Buffer>;
  reconnect(shareMode?: number, protocol?: number, initialization?: number): Promise<void>;
  disconnect(disposition?: number): void;
}
```

## Auto GET RESPONSE (T=0)

Automatic handling is enabled by default for T=0 status words:

- `61 xx`: sends GET RESPONSE automatically
- `6C xx`: retries with corrected Le automatically

Per-call opt-out:

```javascript
const response = await reader.transmit([0x00, 0xa4, 0x04, 0x00, 0x0e], {
  autoGetResponse: false,
});
```

Or disable it as a context default:

```javascript
const ctx = new Context({ autoGetResponse: false });
```

## Control Codes

```javascript
const { ControlCode, Feature, parseFeaturesDetails, platformControlCode } = require("smartcard");

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

## Constants

```javascript
ShareMode.EXCLUSIVE;
ShareMode.SHARED;
ShareMode.DIRECT;

Protocol.T0;
Protocol.T1;
Protocol.RAW;

Disposition.LEAVE;
Disposition.RESET;
Disposition.UNPOWER;
Disposition.EJECT;

State.PRESENT;
State.EMPTY;
State.CHANGED;
```

## Error Handling

```javascript
const { Errors } = require("smartcard");

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

- [emv](https://github.com/tomkp/emv) - Interactive EMV chip card explorer built on smartcard.
