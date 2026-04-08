#!/usr/bin/env bash
set -e

# This script publishes final deprecation versions of @tracewayapp/backend
# and @tracewayapp/nestjs, then marks all versions as deprecated on npm.

echo "========================================"
echo "  Deprecate @tracewayapp/backend & nestjs"
echo "========================================"
echo ""

# --- 1. Check npm auth ---
echo "Checking npm authentication..."
if ! npm whoami > /dev/null 2>&1; then
  echo "Not logged in to npm. Running npm login..."
  npm login
fi
echo "Authenticated as: $(npm whoami)"
echo ""

# --- 2. Build deprecated packages ---
echo "Building @tracewayapp/backend..."
cd packages/backend
npx tsup
echo ""

echo "Building @tracewayapp/nestjs..."
cd ../nestjs
npx tsup
cd ../..
echo ""

# --- 3. Publish final versions ---
echo "Publishing @tracewayapp/backend..."
cd packages/backend
npm publish --access public
cd ../..
echo ""

echo "Publishing @tracewayapp/nestjs..."
cd packages/nestjs
npm publish --access public
cd ../..
echo ""

# --- 4. Deprecate all versions ---
echo "Deprecating all versions of @tracewayapp/backend..."
npm deprecate "@tracewayapp/backend@*" "Deprecated: use OpenTelemetry for Node.js. See https://traceway.dev/client/node-sdk"

echo "Deprecating all versions of @tracewayapp/nestjs..."
npm deprecate "@tracewayapp/nestjs@*" "Deprecated: use OpenTelemetry for NestJS. See https://traceway.dev/client/nestjs"

echo ""
echo "========================================"
echo "  Done! Both packages are now deprecated."
echo "========================================"
