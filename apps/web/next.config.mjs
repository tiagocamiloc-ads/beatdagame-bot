/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // apps/web imports the Prisma client from the workspace package.
  transpilePackages: ["@beatdagame/db"],
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
