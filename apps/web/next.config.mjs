/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @phillybricks/core ships untranspiled TS via package "exports"; let Next compile it.
  transpilePackages: ['@phillybricks/core'],
  experimental: {
    // core is consumed as source (.ts) across the workspace.
    externalDir: true,
  },
};

export default nextConfig;
