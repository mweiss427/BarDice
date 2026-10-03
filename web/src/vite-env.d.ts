/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_CHAIN?: string;
  readonly VITE_BARDICE_ADDRESS?: string;
  readonly VITE_BARDICE_DEPLOY_BLOCK?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_E2E_ACCOUNT?: string;
}
