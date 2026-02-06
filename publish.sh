#!/usr/bin/env bash
set -e

PACKAGES=(core backend frontend react vue svelte nestjs)
PACKAGE_DIRS=(packages/core packages/backend packages/frontend packages/react packages/vue packages/svelte packages/nestjs)

# --- 1. Read current version from packages/core/package.json ---
CURRENT_VERSION=$(node -p "require('./packages/core/package.json').version")
echo "Current version: $CURRENT_VERSION"

# --- 2. Prompt for new version and validate semver ---
read -rp "Enter new version: " NEW_VERSION

if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo "Error: '$NEW_VERSION' is not a valid semver version (e.g. 1.0.0 or 1.0.0-beta.1)"
  exit 1
fi

# --- 3. Check npm auth ---
echo ""
echo "Checking npm authentication..."
if ! npm whoami > /dev/null 2>&1; then
  echo "Not logged in to npm. Running npm login..."
  npm login
fi
echo "Authenticated as: $(npm whoami)"

# --- 4. Show summary and confirm ---
echo ""
echo "========================================"
echo "  Publish @tracewayapp/* packages"
echo "========================================"
echo "  Version: $CURRENT_VERSION → $NEW_VERSION"
echo "  Packages:"
for pkg in "${PACKAGES[@]}"; do
  echo "    - @tracewayapp/$pkg"
done
echo "========================================"
echo ""
read -rp "Proceed? (y/N) " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

# --- 5. Bump version in all workspace package.json files ---
echo ""
echo "Bumping version to $NEW_VERSION in all workspaces..."
npm version "$NEW_VERSION" --workspaces --no-git-tag-version

# Update cross-package dependency references
echo "Updating cross-package dependency references..."
for dir in "${PACKAGE_DIRS[@]}"; do
  for pkg in "${PACKAGES[@]}"; do
    sed -i.bak "s/\"@tracewayapp\/$pkg\": \"$CURRENT_VERSION\"/\"@tracewayapp\/$pkg\": \"$NEW_VERSION\"/g" "$dir/package.json"
  done
  rm -f "$dir/package.json.bak"
done

# --- 6. Sync package-lock.json ---
echo ""
echo "Running npm install to sync package-lock.json..."
npm install

# --- 7. Build all workspaces ---
echo ""
echo "Building all packages..."
npm run build

# --- 8. Publish all workspaces ---
echo ""
echo "Publishing all packages..."
npm publish --workspaces

# --- 9. Git commit and tag ---
echo ""
echo "Committing version bump and tagging..."
git add -A
git commit -m "v$NEW_VERSION"
git tag "v$NEW_VERSION"

# --- 10. Reminder to push ---
echo ""
echo "========================================"
echo "  Published @tracewayapp/* v$NEW_VERSION"
echo "========================================"
echo ""
echo "Don't forget to push commits and tags:"
echo "  git push && git push --tags"
