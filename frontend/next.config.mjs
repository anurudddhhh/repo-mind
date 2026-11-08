/** @type {import('next').NextConfig} */

// Strip any trailing /api or trailing slash to prevent duplicated /api/api routes
const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
const backendBaseUrl = rawApiUrl.replace(/\/api\/?$/, '').replace(/\/$/, '');

const nextConfig = {
  // Optimize heavy package imports for fast reloads
  experimental: {
    optimizePackageImports: ['lucide-react', 'mermaid', 'react-syntax-highlighter'],
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'github.com',
      },
    ],
  },

  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },

  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendBaseUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;