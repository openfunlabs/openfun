import { spawn } from "node:child_process";
import { root } from "./paths.mjs";

/** Run a child from the repository root with the same Node and tsx runtime. */
export async function runScript(script, args = [], timeout = 180000) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", import.meta.resolve("tsx"), script, ...args],
      {
        cwd: root,
        env: process.env,
        stdio: "inherit",
      },
    );
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${script} exited ${code}`));
    });
  });
}
