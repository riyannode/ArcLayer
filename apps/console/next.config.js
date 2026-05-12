/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    externalDir: true,
  },
  transpilePackages: ['@arclayer/sdk'],
  async redirects() {
    return [
      {
        source: '/invoice',
        destination: '/docs',
        permanent: false,
      },
      {
        source: '/achievements',
        destination: '/agent/1',
        permanent: false,
      },
    ];
  },
  webpack: (config) => {
    config.resolve.alias['@'] = path.join(__dirname, 'src');
    config.resolve.alias['@arclayer/sdk'] = path.join(__dirname, '..', '..', 'sdk', 'src');
    config.resolve.alias['@arclayer/indexer'] = path.join(__dirname, '..', '..', 'indexer', 'src');
    config.resolve.fallback = {
      ...config.resolve.fallback,
      '@react-native-async-storage/async-storage': false,
      'pino-pretty': false,
    };
    return config;
  },
}

module.exports = nextConfig
