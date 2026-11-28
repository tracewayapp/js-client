<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tracewayapp/opamp"><img src="https://img.shields.io/npm/v/@tracewayapp/opamp.svg" alt="npm"></a>
  <a href="https://opensource.org/license/mit"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
</p>

# Traceway OpAMP client

A minimal [OpAMP](https://opentelemetry.io/docs/specs/opamp/) (Open Agent Management Protocol) client over plain HTTP,
for browsers and other runtimes with `fetch`. The Traceway browser SDK uses it to fetch its remote collection settings.
Zero runtime dependencies; the protobuf messages are encoded and decoded by hand, only the fields the client uses.

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

> **You probably don't need to install this directly.** It is a dependency of `@tracewayapp/frontend`, which starts it
> for you: see [remote settings](https://docs.tracewayapp.com/learn/remote-config/reference). Use it directly only to
> talk OpAMP to a server from your own agent.

## Installation

```bash
npm install @tracewayapp/opamp
```

## Quick Start

```ts
import { AgentCapabilities, OpampHttpClient } from "@tracewayapp/opamp";

const client = new OpampHttpClient({
  endpoint: "https://cloud.tracewayapp.com/api/otel/v1/opamp",
  headers: { Authorization: "Bearer YOUR_TOKEN" },
  // 16 bytes that identify this agent, e.g. a UUID v7.
  instanceUid: crypto.getRandomValues(new Uint8Array(16)),
  capabilities:
    AgentCapabilities.ReportsStatus |
    AgentCapabilities.AcceptsRemoteConfig |
    AgentCapabilities.ReportsRemoteConfig,
  describe: () => ({
    identifying: { "service.name": "checkout" },
    nonIdentifying: { "service.version": "1.4.2" },
  }),
  onRemoteConfig: ({ configMap }) => {
    const document = new TextDecoder().decode(configMap.traceway?.body);
    // Apply it, then say whether it took effect: the client reports the result on its next poll.
    return { applied: true };
  },
});

client.start();
// Later: poll now, or stop.
await client.poll();
client.stop();
```

## Behaviour

- Polls the server and sends its full state every time, so a stateless server can answer without asking for it.
- Follows the server's heartbeat interval (at least 30 seconds between polls), backs off after errors and honours
  `Retry-After`. A `413` is not retried.
- Reports `RemoteConfigStatus` (applied or failed, with the message `onRemoteConfig` returned) right after applying.
- Stops for good when the server rejects the credentials (`401` / `403`, `onUnauthorized`) or has no OpAMP endpoint
  (`404` / `405` / `501`, `onUnsupported`). A failed request calls `onUnavailable` and is retried later.
- `appliedConfigHash` is the hash of a configuration applied earlier, so the server does not send it again.

`encodeAgentToServer`, `decodeServerToAgent` and `encodeServerToAgent` are the message codecs, exported for tests and
for servers written in JavaScript.

## License

MIT
