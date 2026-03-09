import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@railgun-community/engine",
    "@railgun-community/shared-models",
    "@railgun-community/wallet",
    "leveldown",
    "snarkjs",
  ],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
