import {
  addDebugIdComment,
  addDebugIdToMap,
  extractDebugIdFromSource,
  getDebugIdSnippet,
  getInjectionOffset,
  hasDebugIdComment,
  stringToDebugId,
} from "./debug-id";

const PLUGIN_NAME = "TracewayDebugIdsWebpackPlugin";
const JS_FILE_RE = /\.(js|mjs|cjs)$/;

interface AssetLike {
  name: string;
  source: { source(): string | Buffer };
  info?: { related?: { sourceMap?: string } };
}

interface CompilationLike {
  hooks: {
    processAssets: {
      tap(
        options: { name: string; stage: number },
        fn: () => void,
      ): void;
    };
  };
  getAssets(): AssetLike[];
  getAsset(name: string): AssetLike | undefined;
  updateAsset(name: string, source: unknown): void;
}

interface CompilerLike {
  webpack: {
    Compilation: {
      PROCESS_ASSETS_STAGE_ADDITIONS: number;
      PROCESS_ASSETS_STAGE_OPTIMIZE_TRANSFER: number;
    };
    sources: {
      RawSource: new (code: string) => unknown;
      // The source parameter must stay `any`: a constructor property is
      // checked contravariantly, so `unknown` would make webpack's real
      // Compiler (whose ReplaceSource takes a Source) unassignable to this
      // shape and break `plugins: [new TracewayDebugIdsWebpackPlugin()]`.
      ReplaceSource: new (source: any, name?: string) => {
        insert(pos: number, content: string): void;
      };
    };
  };
  hooks: {
    thisCompilation: {
      tap(name: string, fn: (compilation: CompilationLike) => void): void;
    };
  };
}

function isInjectableJsAsset(name: string): boolean {
  return JS_FILE_RE.test(name) && !name.includes(".hot-update.");
}

function assetCode(asset: AssetLike): string {
  return asset.source.source().toString();
}

export class TracewayDebugIdsWebpackPlugin {
  apply(compiler: CompilerLike): void {
    const { Compilation, sources } = compiler.webpack;

    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation) => {
      compilation.hooks.processAssets.tap(
        { name: PLUGIN_NAME, stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS },
        () => {
          for (const asset of compilation.getAssets()) {
            if (!isInjectableJsAsset(asset.name)) {
              continue;
            }
            const code = assetCode(asset);
            if (code.includes("_tracewayDebugIdIdentifier")) {
              continue;
            }
            const debugId = stringToDebugId(code);
            const replaced = new sources.ReplaceSource(asset.source, asset.name);
            replaced.insert(getInjectionOffset(code), getDebugIdSnippet(debugId));
            compilation.updateAsset(asset.name, replaced);
          }
        },
      );

      compilation.hooks.processAssets.tap(
        {
          name: PLUGIN_NAME,
          stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_TRANSFER,
        },
        () => {
          for (const asset of compilation.getAssets()) {
            if (!isInjectableJsAsset(asset.name)) {
              continue;
            }
            const code = assetCode(asset);
            const debugId = extractDebugIdFromSource(code);
            if (!debugId) {
              continue;
            }

            if (!hasDebugIdComment(code)) {
              compilation.updateAsset(
                asset.name,
                new sources.RawSource(addDebugIdComment(code, debugId)),
              );
            }

            const mapName =
              asset.info?.related?.sourceMap ?? asset.name + ".map";
            const mapAsset = compilation.getAsset(mapName);
            if (mapAsset) {
              const mapJson = assetCode(mapAsset);
              const patched = addDebugIdToMap(mapJson, debugId);
              if (patched !== mapJson) {
                compilation.updateAsset(mapName, new sources.RawSource(patched));
              }
            }
          }
        },
      );
    });
  }
}
