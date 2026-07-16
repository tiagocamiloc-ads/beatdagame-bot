import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.join(__dirname, "../..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // apps/web imports the Prisma client from the workspace package.
  transpilePackages: ["@beatdagame/db"],
  experimental: {
    // In a pnpm monorepo, @prisma/client (and its compiled query-engine
    // .node binary) lives symlinked from the workspace root's virtual
    // store, not inside apps/web/node_modules. Next's default file tracer
    // only follows symlinks within apps/web, so it silently drops the
    // engine binary from the serverless function bundle -- the resulting
    // deploy 500s at request time with "Query Engine ... could not be
    // found", even though the build itself succeeds. Pointing the tracer
    // at the monorepo root fixes resolution; the explicit include is a
    // second safety net in case the glob still misses the binary.
    outputFileTracingRoot: monorepoRoot,
    outputFileTracingIncludes: {
      "/board": ["../../node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/*.node"],
      "/admin/health": ["../../node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/*.node"],
      "/api/articles": ["../../node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/*.node"],
      "/api/articles/[id]": ["../../node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/*.node"],
      "/api/auth/[...nextauth]": ["../../node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/*.node"],
    },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.wsopcdn.com" },
      { protocol: "https", hostname: "**.pnimg.net" },
      { protocol: "https", hostname: "**.kie.ai" },
      { protocol: "https", hostname: "beatdagame.com" },
      { protocol: "https", hostname: "www.beatdagame.com" },
    ],
  },
  webpack: (config) => {
    // packages/db is authored with NodeNext-style ".js"-suffixed relative
    // imports (required for tsx/node to resolve them outside webpack, e.g.
    // in the GitHub Actions worker jobs). transpilePackages hands the raw
    // .ts source to webpack, whose default resolver doesn't know that
    // ".js" import specifier should map to the sibling ".ts" file: this
    // alias teaches it to.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".js", ".ts", ".tsx"],
    };
    return config;
  },
};

export default nextConfig;
