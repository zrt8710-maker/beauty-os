import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const proxy = process.env.LOCAL_DEV_PROXY || "http://127.0.0.1:7892";

process.env.HTTP_PROXY = proxy;
process.env.HTTPS_PROXY = proxy;
process.env.NODE_USE_ENV_PROXY = "1";

const next = spawn(
  process.execPath,
  [require.resolve("next/dist/bin/next"), "dev", ...process.argv.slice(2)],
  { stdio: "inherit", env: process.env },
);

next.on("error", (error) => {
  console.error("Unable to start Next.js:", error);
  process.exitCode = 1;
});

next.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
