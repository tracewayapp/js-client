import { upload } from "./upload.js";

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: traceway-sourcemaps [options]

Options:
  --url <url>          Traceway backend URL (or TRACEWAY_URL env var)
  --token <token>      Source map upload token (or TRACEWAY_SOURCEMAP_TOKEN env var)
  --version <version>  App version to associate with the source maps
  --directory <dir>    Directory to search for .map files (default: ".")
  --help, -h           Show this help message`);
    process.exit(0);
  }

  const url = getArg(args, "--url") ?? process.env.TRACEWAY_URL;
  const token = getArg(args, "--token") ?? process.env.TRACEWAY_SOURCEMAP_TOKEN;
  const version = getArg(args, "--version");
  const directory = getArg(args, "--directory") ?? ".";

  if (!url) {
    console.error("Error: --url is required (or set TRACEWAY_URL)");
    process.exit(1);
  }
  if (!token) {
    console.error(
      "Error: --token is required (or set TRACEWAY_SOURCEMAP_TOKEN)",
    );
    process.exit(1);
  }
  if (!version) {
    console.error("Error: --version is required");
    process.exit(1);
  }

  await upload({ url, token, version, directory });
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
