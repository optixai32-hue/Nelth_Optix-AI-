/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpile client libraries containing modern ES2022+ syntax for full
  // compatibility with older iOS Safari and older Android WebViews.
  transpilePackages: [
    '@ai-sdk/react',
    '@assistant-ui/react',
    'lucide-react',
    '@tabler/icons-react',
    '@hugeicons/react',
    'sonner',
    'motion',
    'radix-ui',
    '@paralleldrive/cuid2',
    'clsx',
    'tailwind-merge',
    'class-variance-authority',
    'react-textarea-autosize',
    'streamdown'
  ],
  // Keep Node-only server SDKs out of the bundle (they use crypto/network
  // modules that don't survive Next.js bundling). `imagekit` authenticates
  // server-side with the private key and must run in the Node runtime.
  serverExternalPackages: ['imagekit'],
  // Use a local/fast disk for build output. The project lives on a slow
  // (network/detected) drive E:, which makes Turbopack compilation extremely
  // slow and causes API routes to time out with 404s. We redirect .next to a
  // local SSD via a directory junction (see setup). Keep distDir default.
  distDir: '.next',
  // Reverse proxy for PostHog to reduce tracking-blocker interception.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      {
        source: '/relay/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*'
      },
      {
        source: '/relay/array/:path*',
        destination: 'https://us-assets.i.posthog.com/array/:path*'
      },
      {
        source: '/relay/:path*',
        destination: 'https://us.i.posthog.com/:path*'
      }
    ]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'i.ytimg.com',
        port: '',
        pathname: '/vi/**'
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        port: '',
        pathname: '/a/**' // Google user content often follows this pattern
      },
      {
        protocol: 'https',
        hostname: 'imgs.search.brave.com',
        port: '',
        pathname: '/**' // Brave search cached images
      },
      {
        protocol: 'https',
        hostname: 'www.google.com',
        port: '',
        pathname: '/s2/favicons/**' // Google Favicon API
      }
    ]
  }
}

export default nextConfig
