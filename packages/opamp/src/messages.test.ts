import { describe, expect, it } from "vitest";
import { decodeServerToAgent, encodeAgentToServer, encodeServerToAgent, RemoteConfigStatus, ServerErrorType } from "./messages.js";

// Produced by opamp-go v0.25.0's generated types (proto.Marshal, deterministic) for the same messages.
const GO_AGENT_TO_SERVER =
  "0a100195f2a000007000800000000000000110031a6f0a1a0a0c736572766963652e6e616d65120a0a0873686f702d776562121a0a0f736572766963652e76657273696f6e12070a05322e332e3112140a0e62726f777365722e6d6f62696c6512021001120b0a0573656174731202180c12120a05726174696f120921000000000000d03f2083603a060a02abcd100162370a19696f2e74726163657761792e73646b2e6275666665722f76310a1a696f2e74726163657761792e73646b2e636170747572652f7631";
const GO_SERVER_TO_AGENT =
  "0a100195f2a00000700080000000000000011a570a500a4e0a08747261636577617912420a2e7b22736368656d6156657273696f6e223a312c227265706c6179223a7b226d6f6465223a2273747265616d227d7d12106170706c69636174696f6e2f6a736f6e120301020322080a0109120320ac023001382342120a10ffeeddccbbaa99887766554433221100";
const GO_SERVER_ERROR = "121108021204627573791a070880b09dc2df01";

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
const uid = fromHex("0195f2a0000070008000000000000001");

describe("OpAMP codec", () => {
  it("encodes AgentToServer byte for byte like opamp-go", () => {
    const bytes = encodeAgentToServer({
      instanceUid: uid,
      sequenceNum: 3,
      agentDescription: {
        identifying: { "service.name": "shop-web" },
        nonIdentifying: { "service.version": "2.3.1", "browser.mobile": true, seats: 12, ratio: 0.25 },
      },
      capabilities: 0x1 | 0x2 | 0x1000 | 0x2000,
      remoteConfigStatus: { lastRemoteConfigHash: fromHex("abcd"), status: RemoteConfigStatus.Applied },
      customCapabilities: ["io.traceway.sdk.buffer/v1", "io.traceway.sdk.capture/v1"],
    });
    expect(hex(bytes)).toBe(GO_AGENT_TO_SERVER);
  });

  it("decodes a ServerToAgent written by opamp-go", () => {
    const msg = decodeServerToAgent(fromHex(GO_SERVER_TO_AGENT));
    expect(hex(msg.instanceUid!)).toBe(hex(uid));
    expect(msg.flags).toBe(1);
    expect(msg.capabilities).toBe(0x23);
    expect(msg.heartbeatIntervalSeconds).toBe(300);
    expect(hex(msg.newInstanceUid!)).toBe("ffeeddccbbaa99887766554433221100");
    expect(hex(msg.remoteConfig!.configHash)).toBe("010203");
    const doc = msg.remoteConfig!.configMap.traceway!;
    expect(doc.contentType).toBe("application/json");
    expect(JSON.parse(new TextDecoder().decode(doc.body))).toEqual({ schemaVersion: 1, replay: { mode: "stream" } });
  });

  it("decodes an error response with retry info", () => {
    const msg = decodeServerToAgent(fromHex(GO_SERVER_ERROR));
    expect(msg.errorResponse).toEqual({ type: ServerErrorType.Unavailable, message: "busy", retryAfterMs: 60_000 });
  });

  it("skips fields it does not know", () => {
    const withUnknown = fromHex("f80107" + "0a02abcd".replace("0a02abcd", "") + "3001");
    expect(decodeServerToAgent(withUnknown).flags).toBe(1);
  });
});

describe("encodeServerToAgent", () => {
  it("round-trips through the decoder", () => {
    const body = new TextEncoder().encode('{"schemaVersion":1}');
    const msg = decodeServerToAgent(
      encodeServerToAgent({
        flags: 1,
        capabilities: 3,
        heartbeatIntervalSeconds: 60,
        remoteConfig: { configMap: { traceway: { body, contentType: "application/json" } }, configHash: Uint8Array.from([5]) },
      }),
    );
    expect(msg.flags).toBe(1);
    expect(msg.heartbeatIntervalSeconds).toBe(60);
    expect(new TextDecoder().decode(msg.remoteConfig!.configMap.traceway!.body)).toBe('{"schemaVersion":1}');
  });
});
