import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const nextCli = require.resolve("next/dist/bin/next");
const firebaseScript = fileURLToPath(
  new URL("./firebase-emulator.mjs", import.meta.url),
);

const processes = [
  {
    name: "firebase",
    child: spawn(process.execPath, [firebaseScript], {
      detached: process.platform !== "win32",
      env: process.env,
      stdio: "inherit",
    }),
  },
  {
    name: "next",
    child: spawn(process.execPath, [nextCli, "dev"], {
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
        NEXT_PUBLIC_USE_FIREBASE_EMULATOR: "true",
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-brainshare-shoebill",
        FIREBASE_PROJECT_ID: "demo-brainshare-shoebill",
        MONGODB_URI:
          "mongodb://brainshare:brainshare@127.0.0.1:27018/brainshare?authSource=admin&directConnection=true",
        MONGODB_DB: "brainshare",
      },
      stdio: "inherit",
    }),
  },
];

let shuttingDown = false;
let exitCode = 0;

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const service of processes) {
    if (service.child.exitCode === null) {
      service.child.kill(signal);
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(signal));
}

for (const service of processes) {
  service.child.on("error", (error) => {
    console.error(`${service.name} failed to start:`, error);
    exitCode = 1;
    shutdown("SIGTERM");
  });

  service.child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      exitCode = code ?? (signal ? 1 : 0);
      shutdown("SIGTERM");
    }
  });
}

await Promise.all(
  processes.map(
    ({ child }) =>
      new Promise((resolve) => {
        child.on("exit", resolve);
      }),
  ),
);

process.exit(exitCode);
