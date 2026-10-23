import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  async headers() {
    return [{
      source: "/limitleague-demo.mp4",
      headers: [{ key: "Content-Disposition", value: 'attachment; filename="limitleague-demo.mp4"' }]
    }];
  }
};

export default nextConfig;
