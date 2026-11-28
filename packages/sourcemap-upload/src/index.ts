import { upload } from "./upload.js";
import { DEFAULT_URL, resolveOptions } from "./options.js";

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: traceway-sourcemaps [options]

Options:
  --url <url>          Traceway server URL, only for a self-hosted server (or TRACEWAY_URL env var; default: ${DEFAULT_URL})
  --token <token>      Source map upload token (or TRACEWAY_SOURCEMAP_TOKEN env var)
  --directory <dir>    Directory to search for .map files (default: ".")
  --help, -h           Show this help message`);
    process.exit(0);
  }

  const { url, token, directory } = resolveOptions(args, process.env);

  if (!token) {
    console.error(
      "Error: --token is required (or set TRACEWAY_SOURCEMAP_TOKEN)",
    );
    process.exit(1);
  }

  await upload({ url, token, directory });
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
