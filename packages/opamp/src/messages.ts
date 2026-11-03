import { Reader, Writer, WIRE_LENGTH, WIRE_VARINT } from "./wire.js";

/** AgentCapabilities from the OpAMP spec. */
export const AgentCapabilities = {
  ReportsStatus: 0x1,
  AcceptsRemoteConfig: 0x2,
  ReportsEffectiveConfig: 0x4,
  ReportsHealth: 0x800,
  ReportsRemoteConfig: 0x1000,
  ReportsHeartbeat: 0x2000,
} as const;

export const AgentToServerFlags = { RequestInstanceUid: 0x1 } as const;
export const ServerToAgentFlags = { ReportFullState: 0x1 } as const;

export enum RemoteConfigStatus {
  Unset = 0,
  Applied = 1,
  Applying = 2,
  Failed = 3,
}

export enum ServerErrorType {
  Unknown = 0,
  BadRequest = 1,
  Unavailable = 2,
}

export type AttributeValue = string | boolean | number | string[];

export interface AgentToServer {
  instanceUid: Uint8Array;
  sequenceNum: number;
  agentDescription?: {
    identifying: Record<string, AttributeValue>;
    nonIdentifying: Record<string, AttributeValue>;
  };
  capabilities: number;
  remoteConfigStatus?: { lastRemoteConfigHash: Uint8Array; status: RemoteConfigStatus; errorMessage?: string };
  agentDisconnect?: boolean;
  flags?: number;
  customCapabilities?: string[];
}

export interface AgentConfigObject {
  body: Uint8Array;
  contentType: string;
}

export interface ServerToAgent {
  instanceUid?: Uint8Array;
  errorResponse?: { type: ServerErrorType; message: string; retryAfterMs?: number };
  remoteConfig?: { configMap: Record<string, AgentConfigObject>; configHash: Uint8Array };
  heartbeatIntervalSeconds?: number;
  flags: number;
  capabilities: number;
  newInstanceUid?: Uint8Array;
  customMessage?: { capability: string; type: string; data: Uint8Array };
}

function writeAnyValue(w: Writer, value: AttributeValue): void {
  if (typeof value === "string") {
    w.string(1, value);
  } else if (typeof value === "boolean") {
    w.bool(2, value);
  } else if (typeof value === "number") {
    if (Number.isInteger(value) && value >= 0) {
      if (value !== 0) w.tag(3, WIRE_VARINT).varint(value);
    } else {
      w.double(4, value);
    }
  } else {
    w.message(5, (array) => {
      for (const item of value) array.message(1, (v) => v.string(1, item), true);
    });
  }
}

function writeAttributes(w: Writer, field: number, attrs: Record<string, AttributeValue>): void {
  for (const [key, value] of Object.entries(attrs)) {
    w.message(field, (kv) => {
      kv.string(1, key);
      kv.message(2, (v) => writeAnyValue(v, value), true);
    });
  }
}

export function encodeAgentToServer(msg: AgentToServer): Uint8Array {
  const w = new Writer();
  w.bytes(1, msg.instanceUid);
  w.uint(2, msg.sequenceNum);
  if (msg.agentDescription) {
    const description = msg.agentDescription;
    w.message(3, (d) => {
      writeAttributes(d, 1, description.identifying);
      writeAttributes(d, 2, description.nonIdentifying);
    });
  }
  w.uint(4, msg.capabilities);
  if (msg.remoteConfigStatus) {
    const status = msg.remoteConfigStatus;
    w.message(7, (s) => {
      s.bytes(1, status.lastRemoteConfigHash);
      s.uint(2, status.status);
      if (status.errorMessage) s.string(3, status.errorMessage);
    });
  }
  if (msg.agentDisconnect) w.message(9, () => {}, true);
  w.uint(10, msg.flags ?? 0);
  if (msg.customCapabilities?.length) {
    const capabilities = msg.customCapabilities;
    w.message(12, (c) => {
      for (const capability of capabilities) c.string(1, capability);
    });
  }
  return w.finish();
}

function each(buf: Uint8Array, handle: (field: number, wireType: number, r: Reader) => boolean): void {
  const r = new Reader(buf);
  while (!r.done()) {
    const { field, wireType } = r.tag();
    if (!handle(field, wireType, r)) r.skip(wireType);
  }
}

function decodeConfigObject(buf: Uint8Array): AgentConfigObject {
  const object: AgentConfigObject = { body: new Uint8Array(), contentType: "" };
  each(buf, (field, wireType, r) => {
    if (wireType !== WIRE_LENGTH) return false;
    if (field === 1) object.body = r.bytes().slice();
    else if (field === 2) object.contentType = r.string();
    else return false;
    return true;
  });
  return object;
}

function decodeRemoteConfig(buf: Uint8Array): NonNullable<ServerToAgent["remoteConfig"]> {
  const config: NonNullable<ServerToAgent["remoteConfig"]> = { configMap: {}, configHash: new Uint8Array() };
  each(buf, (field, wireType, r) => {
    if (wireType !== WIRE_LENGTH) return false;
    if (field === 2) {
      config.configHash = r.bytes().slice();
      return true;
    }
    if (field !== 1) return false;
    each(r.bytes(), (mapField, mapWire, mapReader) => {
      if (mapField !== 1 || mapWire !== WIRE_LENGTH) return false;
      let key = "";
      let value: AgentConfigObject = { body: new Uint8Array(), contentType: "" };
      each(mapReader.bytes(), (entryField, entryWire, entryReader) => {
        if (entryWire !== WIRE_LENGTH) return false;
        if (entryField === 1) key = entryReader.string();
        else if (entryField === 2) value = decodeConfigObject(entryReader.bytes());
        else return false;
        return true;
      });
      config.configMap[key] = value;
      return true;
    });
    return true;
  });
  return config;
}

export function decodeServerToAgent(buf: Uint8Array): ServerToAgent {
  const msg: ServerToAgent = { flags: 0, capabilities: 0 };
  each(buf, (field, wireType, r) => {
    switch (field) {
      case 1:
        if (wireType !== WIRE_LENGTH) return false;
        msg.instanceUid = r.bytes().slice();
        return true;
      case 2: {
        if (wireType !== WIRE_LENGTH) return false;
        const error: NonNullable<ServerToAgent["errorResponse"]> = { type: ServerErrorType.Unknown, message: "" };
        each(r.bytes(), (f, w, er) => {
          if (f === 1 && w === WIRE_VARINT) error.type = er.varint();
          else if (f === 2 && w === WIRE_LENGTH) error.message = er.string();
          else if (f === 3 && w === WIRE_LENGTH) {
            each(er.bytes(), (rf, rw, rr) => {
              if (rf !== 1 || rw !== WIRE_VARINT) return false;
              error.retryAfterMs = rr.varint() / 1e6;
              return true;
            });
          } else return false;
          return true;
        });
        msg.errorResponse = error;
        return true;
      }
      case 3:
        if (wireType !== WIRE_LENGTH) return false;
        msg.remoteConfig = decodeRemoteConfig(r.bytes());
        return true;
      case 4:
        if (wireType !== WIRE_LENGTH) return false;
        each(r.bytes(), (f, w, cr) => {
          if (f !== 2 || w !== WIRE_LENGTH) return false;
          each(cr.bytes(), (of, ow, or) => {
            if (of !== 4 || ow !== WIRE_VARINT) return false;
            msg.heartbeatIntervalSeconds = or.varint();
            return true;
          });
          return true;
        });
        return true;
      case 6:
        if (wireType !== WIRE_VARINT) return false;
        msg.flags = r.varint();
        return true;
      case 7:
        if (wireType !== WIRE_VARINT) return false;
        msg.capabilities = r.varint();
        return true;
      case 8:
        if (wireType !== WIRE_LENGTH) return false;
        each(r.bytes(), (f, w, ir) => {
          if (f !== 1 || w !== WIRE_LENGTH) return false;
          msg.newInstanceUid = ir.bytes().slice();
          return true;
        });
        return true;
      case 11: {
        if (wireType !== WIRE_LENGTH) return false;
        const custom = { capability: "", type: "", data: new Uint8Array() };
        each(r.bytes(), (f, w, cr) => {
          if (w !== WIRE_LENGTH) return false;
          if (f === 1) custom.capability = cr.string();
          else if (f === 2) custom.type = cr.string();
          else if (f === 3) custom.data = cr.bytes().slice();
          else return false;
          return true;
        });
        msg.customMessage = custom;
        return true;
      }
    }
    return false;
  });
  return msg;
}

/** Encodes the parts of a ServerToAgent this client reads; for mock servers in tests. */
export function encodeServerToAgent(msg: Omit<ServerToAgent, "errorResponse" | "customMessage">): Uint8Array {
  const w = new Writer();
  if (msg.instanceUid) w.bytes(1, msg.instanceUid);
  if (msg.remoteConfig) {
    const config = msg.remoteConfig;
    w.message(3, (rc) => {
      rc.message(1, (map) => {
        for (const [key, object] of Object.entries(config.configMap)) {
          map.message(1, (entry) => {
            entry.string(1, key);
            entry.message(2, (o) => o.bytes(1, object.body).string(2, object.contentType), true);
          });
        }
      });
      rc.bytes(2, config.configHash);
    });
  }
  if (msg.heartbeatIntervalSeconds) {
    const seconds = msg.heartbeatIntervalSeconds;
    w.message(4, (cs) => cs.message(2, (o) => o.uint(4, seconds)));
  }
  w.uint(6, msg.flags);
  w.uint(7, msg.capabilities);
  if (msg.newInstanceUid) w.message(8, (id) => id.bytes(1, msg.newInstanceUid!));
  return w.finish();
}
