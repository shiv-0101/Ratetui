/**
 * Generate RSA Key Pair
 * 
 * Generates 2048-bit RSA key pair for JWT signing
 * Keys are saved to backend/keys/ directory
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const keysDir = path.join(__dirname, '..', 'keys');
const privateKeyPath = path.join(keysDir, 'private.key');
const publicKeyPath = path.join(keysDir, 'public.key');

// Ensure keys directory exists
if (!fs.existsSync(keysDir)) {
  fs.mkdirSync(keysDir, { recursive: true });
}

// Generate RSA key pair
console.log('Generating 2048-bit RSA key pair...');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem'
  }
});

// Save keys to files
fs.writeFileSync(privateKeyPath, privateKey);
fs.writeFileSync(publicKeyPath, publicKey);

console.log('✓ Keys generated successfully!');
console.log(`  Private key: ${privateKeyPath}`);
console.log(`  Public key:  ${publicKeyPath}`);
console.log('\n⚠️  Security Notice:');
console.log('  - Never commit private.key to version control');
console.log('  - Add keys/ to .gitignore');
console.log('  - Store private key securely in production');

// Generate single-line versions for .env
const privateKeySingleLine = privateKey.replace(/\n/g, '\\n');
const publicKeySingleLine = publicKey.replace(/\n/g, '\\n');

console.log('\n📋 For .env file (optional - you can also use file paths):');
console.log('\nJWT_PRIVATE_KEY="' + privateKeySingleLine + '"');
console.log('\nJWT_PUBLIC_KEY="' + publicKeySingleLine + '"');
console.log('\nOr use file paths (recommended):');
console.log('JWT_PRIVATE_KEY_PATH=./keys/private.key');
console.log('JWT_PUBLIC_KEY_PATH=./keys/public.key');
