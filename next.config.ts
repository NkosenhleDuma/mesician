import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@coderline/alphatab", "postgres"],
  transpilePackages: [
    "@spotify/basic-pitch",
    "@tensorflow/tfjs",
    "@tensorflow/tfjs-backend-wasm",
    "@tensorflow/tfjs-core",
  ],
};

export default nextConfig;
