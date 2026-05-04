// Metro config for the Expo demo app.
//
// We resolve `@tracewayapp/react-native` and `@tracewayapp/core` to the
// workspace packages so changes to the SDK are picked up without publishing.
// Metro's `nodeModulesPaths` is told about the monorepo root so RN's
// hoisted deps are still found.

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

config.resolver.disableHierarchicalLookup = true;

module.exports = config;
