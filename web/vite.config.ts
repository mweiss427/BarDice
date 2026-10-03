/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

/**
 * Production builds get a strict Content-Security-Policy: only our own scripts may run and the
 * page may only talk to the configured RPC. (Dev mode skips it because HMR needs inline scripts.)
 */
function contentSecurityPolicy(rpcOrigins: string[]): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src 'self' ${rpcOrigins.join(" ")}`,
    "base-uri 'self'",
    "form-action 'none'",
    "object-src 'none'",
  ].join("; ");
  return {
    name: "bardice-csp",
    apply: "build",
    transformIndexHtml: (html) =>
      html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`),
  };
}

const DEFAULT_RPCS: Record<string, string> = {
  localhost: "http://127.0.0.1:8545",
  baseSepolia: "https://sepolia.base.org",
  base: "https://mainnet.base.org",
};

/** Headers that only work as real HTTP headers (not <meta>). Mirrored in public/_headers for hosting. */
const SECURITY_HEADERS = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const chain = env.VITE_CHAIN ?? "localhost";
  const rpc = env.VITE_RPC_URL || DEFAULT_RPCS[chain] || DEFAULT_RPCS.localhost!;
  return {
    plugins: [react(), tailwindcss(), contentSecurityPolicy([new URL(rpc).origin])],
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true, headers: SECURITY_HEADERS },
    build: { sourcemap: true },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
