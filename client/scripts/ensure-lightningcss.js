const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const platform = process.platform;
const arch = process.arch;

if (platform !== 'darwin') {
  process.exit(0);
}

const packageName = arch === 'arm64' ? 'lightningcss-darwin-arm64' : 'lightningcss-darwin-x64';
const binaryName = arch === 'arm64' ? 'lightningcss.darwin-arm64.node' : 'lightningcss.darwin-x64.node';
const binaryPath = path.join(__dirname, '..', 'node_modules', 'lightningcss', binaryName);

if (fs.existsSync(binaryPath)) {
  process.exit(0);
}

console.log(`Installing missing ${packageName} for EAS build...`);
execSync(`npm install --no-save ${packageName}@1.31.1`, {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
});
