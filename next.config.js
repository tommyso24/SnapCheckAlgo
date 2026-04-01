/** @type {import('next').NextConfig} */
const nextConfig = {
  // Skip static generation of API routes during build
  // (they access Redis/JWT which aren't available at build time)
  experimental: {
    missingSuspenseWithCSRBailout: false,
  },
}
module.exports = nextConfig
