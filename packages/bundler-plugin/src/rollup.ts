import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import MagicString from "magic-string";

import {
  addDebugIdComment,
  addDebugIdToMap,
  extractDebugIdFromSource,
  getDebugIdSnippet,
  getInjectionOffset,
  hasDebugIdComment,
  stringToDebugId,
} from "./debug-id";

interface OutputChunkLike {
  type: string;
  code?: string;
  sourcemapFileName?: string | null;
}

interface OutputOptionsLike {
  dir?: string;
  file?: string;
}

export interface TracewayDebugIdPlugin {
  name: string;
  renderChunk(
    code: string,
    chunk: { fileName: string },
  ): { code: string; map: ReturnType<MagicString["generateMap"]> } | null;
  writeBundle(
    options: OutputOptionsLike,
    bundle: Record<string, OutputChunkLike>,
  ): Promise<void>;
}

const JS_FILE_RE = /\.(js|mjs|cjs)$/;

export function tracewayDebugIds(): TracewayDebugIdPlugin {
  return {
    name: "traceway-debug-ids",

    renderChunk(code, chunk) {
      if (!JS_FILE_RE.test(chunk.fileName.replace(/[?#].*$/, ""))) {
        return null;
      }
      if (code.includes("_tracewayDebugIdIdentifier")) {
        return null;
      }
      const debugId = stringToDebugId(code);
      const ms = new MagicString(code);
      ms.appendLeft(getInjectionOffset(code), getDebugIdSnippet(debugId));
      return { code: ms.toString(), map: ms.generateMap({ hires: "boundary" }) };
    },

    async writeBundle(options, bundle) {
      const dir =
        options.dir ?? (options.file ? dirname(options.file) : undefined);
      if (!dir) {
        return;
      }
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== "chunk" || !JS_FILE_RE.test(fileName)) {
          continue;
        }
        const debugId = extractDebugIdFromSource(output.code ?? "");
        if (!debugId) {
          continue;
        }

        const filePath = join(dir, fileName);
        try {
          const code = await readFile(filePath, "utf8");
          if (!hasDebugIdComment(code)) {
            await writeFile(filePath, addDebugIdComment(code, debugId));
          }
        } catch {
          continue;
        }

        const mapFileName = output.sourcemapFileName ?? fileName + ".map";
        const mapPath = join(dir, mapFileName);
        try {
          const mapJson = await readFile(mapPath, "utf8");
          const patched = addDebugIdToMap(mapJson, debugId);
          if (patched !== mapJson) {
            await writeFile(mapPath, patched);
          }
        } catch {
          continue;
        }
      }
    },
  };
}
