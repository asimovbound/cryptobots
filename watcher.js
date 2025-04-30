import chokidar from 'chokidar';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const SERVER_URL = 'ws://80.240.21.90:8765';
const ws = new WebSocket(SERVER_URL);

// Utility to hash files and detect changes
const getFileHash = (filePath) => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
};

const fileHashes = {};

ws.on('open', () => {
  console.log('🟢 Connected to sync server');

  chokidar.watch('.', {
    ignored: /(^|[\/\\])(\.config|node_modules)([\/\\]|$)/, // ignore both .config and node_modules
    ignoreInitial: true,
    persistent: true,
    depth: 99,
  }).on('change', async (relativePath) => {
    const absolutePath = path.join(process.cwd(), relativePath);

    try {
      const currentHash = await getFileHash(absolutePath);

      if (fileHashes[relativePath] !== currentHash) {
        fileHashes[relativePath] = currentHash;
        fs.readFile(absolutePath, 'utf8', (err, data) => {
          if (err) return console.error(`Error reading ${relativePath}:`, err);
          ws.send(`${relativePath}|${data}`);
          console.log(`📤 Sent: ${relativePath}`);
        });
      } else {
        console.log(`🔄 No changes detected for: ${relativePath}`);
      }
    } catch (err) {
      console.error(`❌ Error processing ${relativePath}:`, err.message);
    }
  });
});
