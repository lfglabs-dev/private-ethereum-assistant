import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@kohaku-eth/railgun",
    "@kohaku-eth/plugins",
    "@kohaku-eth/provider",
    "snarkjs",
    "ethers",
  ],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
