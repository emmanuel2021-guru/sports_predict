/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // In production, set NEXT_PUBLIC_BACKEND_URL to your deployed backend URL
    // (e.g. https://markets-pro-backend.onrender.com). Locally it falls back to :8000.
    const backend = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
    return [
      {
        source: '/api/:path*',
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
