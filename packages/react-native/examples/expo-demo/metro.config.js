// Metro config for the Expo demo app.
//
// We resolve `@tracewayapp/react-native` and `@tracewayapp/core` to the
// workspace packages so changes to the SDK are picked up without publishing.
// React and React Native are pinned to this example's own node_modules via
// `resolveRequest` — including subpath imports like `react/jsx-runtime` that
// Babel's automatic JSX transform generates. Without that, when Metro
// bundles the SDK source from `packages/react-native/dist/`, hierarchical
// lookup walks up to the workspace root and pulls in React 18's
// jsx-runtime alongside the example's React 19, causing
// "Cannot read property 'ReactCurrentDispatcher' of undefined" at runtime.

const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../../../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

config.resolver.extraNodeModules = {
  "@tracewayapp/react-native": path.resolve(
    workspaceRoot,
    "packages/react-native",
  ),
  "@tracewayapp/core": path.resolve(workspaceRoot, "packages/core"),
};

const reactDir = path.dirname(
  require.resolve("react/package.json", { paths: [projectRoot] }),
);
const rnDir = path.dirname(
  require.resolve("react-native/package.json", { paths: [projectRoot] }),
);

const PINNED_PACKAGES = new Map([
  ["react", reactDir],
  ["react-native", rnDir],
]);

function pinnedDirFor(moduleName) {
  // Match either the bare package name or any subpath (e.g. `react/jsx-runtime`).
  for (const [name, dir] of PINNED_PACKAGES) {
    if (moduleName === name || moduleName.startsWith(`${name}/`)) {
      return dir;
    }
  }
  return null;
}

const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const dir = pinnedDirFor(moduleName);
  if (dir) {
    return context.resolveRequest(
      { ...context, originModulePath: path.join(dir, "package.json") },
      moduleName,
      platform,
    );
  }
  if (typeof upstreamResolveRequest === "function") {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
