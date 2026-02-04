import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@veyrun/shared", "@ozentti/veyrun"]
};

export default nextConfig;
