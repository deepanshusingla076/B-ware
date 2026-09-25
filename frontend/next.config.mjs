/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
  // Fallback proxy if someone still uses NEXT_PUBLIC_API_URL=/api
  async rewrites() {
    const backend = process.env.BACKEND_URL || "http://localhost:5000";
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
  experimental: {
    // Long NLP verification can exceed the default proxy idle timeout
    proxyTimeout: 300_000,
  },
};

export default nextConfig;
