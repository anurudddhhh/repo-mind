// ============================================================
// ENV LOADER — Preloads .env & handles local network proxies
// ============================================================
// This file is required via node's -r flag in package.json:
//   ts-node -r ./env-loader.js -r tsconfig-paths/register src/index.ts
//
// Prepopulates process.env and provides zero-config ISP DNS
// bypass for Neon databases on local networks that refuse .tech domains.
// ============================================================

const path = require('path');
const dotenv = require('dotenv');
const net = require('net');
const dns = require('dns');

// Load .env from backend directory and root directory
const backendEnvPath = path.resolve(__dirname, '.env');
const rootEnvPath = path.resolve(__dirname, '../.env');

dotenv.config({ path: backendEnvPath });
dotenv.config({ path: rootEnvPath });

console.log(`✅ [env-loader] Loaded environment variables`);

// Neon DNS bypass for local development on ISPs that refuse .tech domains (e.g. JioFiber)
if (process.env.NODE_ENV !== 'production' && process.env.DATABASE_URL && process.env.DATABASE_URL.includes('neon.tech')) {
  try {
    const rawUrl = process.env.DATABASE_URL;
    const dbUrl = new URL(rawUrl);
    const originalHost = dbUrl.hostname;
    const originalPort = parseInt(dbUrl.port || '5432', 10);
    const endpointId = originalHost.split('.')[0].replace(/-pooler$/, '');

    // Configure public DNS resolvers (Google, Cloudflare)
    dns.setServers(['8.8.8.8', '1.1.1.1']);

    let cachedIps = [];

    const resolveHost = () => {
      dns.resolve4(originalHost, (err, ips) => {
        if (!err && ips && ips.length > 0) {
          cachedIps = ips;
        }
      });
    };
    resolveHost();
    setInterval(resolveHost, 60000); // refresh every minute

    const PROXY_PORT = 5433;

    const proxyServer = net.createServer((clientSocket) => {
      const connectToNeon = (ip) => {
        const neonSocket = net.connect(originalPort, ip, () => {
          clientSocket.pipe(neonSocket).pipe(clientSocket);
        });

        neonSocket.on('error', (err) => {
          clientSocket.destroy(err);
        });

        clientSocket.on('error', () => {
          neonSocket.destroy();
        });
      };

      if (cachedIps && cachedIps.length > 0) {
        connectToNeon(cachedIps[0]);
      } else {
        dns.resolve4(originalHost, (err, ips) => {
          if (err || !ips || ips.length === 0) {
            clientSocket.destroy(new Error(`Could not resolve ${originalHost}: ${err ? err.message : 'no IPs'}`));
            return;
          }
          cachedIps = ips;
          connectToNeon(ips[0]);
        });
      }
    });

    proxyServer.on('error', (err) => {
      if (err.code !== 'EADDRINUSE') {
        console.error('⚠️ [env-loader] Proxy server error:', err.message);
      }
    });

    proxyServer.listen(PROXY_PORT, '127.0.0.1', () => {
      console.log(`🔌 [env-loader] Local Neon proxy active on 127.0.0.1:${PROXY_PORT} (bypassing ISP DNS restriction)`);
    });

    proxyServer.unref();

    // Rewrite DATABASE_URL to use local proxy + Neon endpoint parameter
    dbUrl.hostname = '127.0.0.1';
    dbUrl.port = String(PROXY_PORT);
    if (!dbUrl.searchParams.has('options')) {
      dbUrl.searchParams.set('options', `endpoint=${endpointId}`);
    }
    process.env.DATABASE_URL = dbUrl.toString();
  } catch (err) {
    console.error('⚠️ [env-loader] Failed to initialize Neon local proxy:', err.message);
  }
}
