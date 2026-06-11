import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const dataDirectory = ".firebase/emulator-data";
const require = createRequire(import.meta.url);
const firebaseCli = require.resolve("firebase-tools/lib/bin/firebase");
const args = [
  "emulators:start",
  "--only",
  "auth",
  "--project",
  "demo-brainshare-shoebill",
  `--export-on-exit=${dataDirectory}`,
];

if (existsSync(dataDirectory)) {
  args.push(`--import=${dataDirectory}`);
}

const child = spawn(process.execPath, [firebaseCli, ...args], {
  detached: process.platform !== "win32",
  stdio: "inherit",
});

let shuttingDown = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    child.kill(signal);
  });
}

child.on("exit", (code) => process.exit(code ?? 1));
