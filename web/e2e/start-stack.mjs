// Boots the whole stack for E2E: local chain -> deploy -> VRF auto-fulfiller -> production build -> preview.
// Extra Hardhat CLI args (e.g. a custom --config) can be passed with HH_ARGS.
import { spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";

const contracts = new URL("../../contracts/", import.meta.url).pathname;
const web = new URL("../", import.meta.url).pathname;
const hh = (process.env.HH_ARGS ?? "").split(" ").filter(Boolean);
const children = [];
const stop = () => children.forEach((c) => c.kill("SIGTERM"));
process.on("SIGTERM", () => (stop(), process.exit(0)));
process.on("SIGINT", () => (stop(), process.exit(0)));
process.on("exit", stop);

const run = (cmd, args, cwd, env = {}) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
};
const bg = (cmd, args, cwd, env = {}) => {
  const c = spawn(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
  children.push(c);
  return c;
};
const waitForPort = (port) =>
  new Promise((resolve) => {
    const tryOnce = () =>
      createConnection({ port, host: "127.0.0.1" })
        .on("connect", function () { this.end(); resolve(); })
        .on("error", () => setTimeout(tryOnce, 250));
    tryOnce();
  });

bg("npx", ["hardhat", ...hh, "node"], contracts);
await waitForPort(8545);
run("npx", ["hardhat", ...hh, "run", "scripts/deploy-local.ts", "--network", "localhost"], contracts);
bg("npx", ["hardhat", ...hh, "run", "scripts/vrf-autofulfill.ts", "--network", "localhost"], contracts);

// Hardhat's 2nd default account (unlocked on the local node) plays as the E2E user.
const env = { VITE_E2E_ACCOUNT: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" };
run("npx", ["vite", "build", "--mode", "e2e"], web, env);
bg("npx", ["vite", "preview", "--mode", "e2e"], web, env);
