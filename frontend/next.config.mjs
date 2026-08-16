/** @type {import('next').NextConfig} */
const nextConfig = {
  // ==========================================================================
  // IMAGES
  // ==========================================================================
  // Next.js blocks external images by default for security.
  // We explicitly whitelist trusted domains where user avatars come from.
  // ==========================================================================
  images: {
    remotePatterns: [
      {
        // GitHub user avatars (profile pictures)
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
      {
        // GitHub's general image CDN
        protocol: 'https',
        hostname: 'github.com',
      },
    ],
  },

  // ==========================================================================
  // ENVIRONMENT VARIABLES
  // ==========================================================================
  // Variables prefixed with NEXT_PUBLIC_ are automatically exposed to
  // the browser. Without that prefix they stay server-side only.
  // ==========================================================================
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },

  // ==========================================================================
  // REWRITES (API PROXY)
  // ==========================================================================
  // During development, instead of the browser making cross-origin requests
  // from localhost:3000 to localhost:5000 (which triggers CORS issues),
  // we let Next.js forward /api/* requests to our Express backend.
  //
  // Think of Next.js as a receptionist forwarding calls:
  //   Browser → Next.js (/api/*) → Express Backend (port 5000)
  // ==========================================================================
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;