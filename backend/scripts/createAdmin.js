/**
 * Create Initial Admin User
 * 
 * Script to create the first admin user for the system
 * Run with: node scripts/createAdmin.js
 */

require('dotenv').config();

const bcrypt = require('bcryptjs');
const { createUser, getUserByEmail } = require('../src/models/User');
const { connectRedis, closeRedis } = require('../src/config/redis');
const { validatePassword } = require('../src/validators/passwordValidator');
const logger = require('../src/utils/logger');

/**
 * Create admin user
 */
const createAdminUser = async () => {
  try {
    console.log('🔐 Creating admin user...\n');

    // Connect to Redis
    console.log('📡 Connecting to Redis...');
    await connectRedis();
    console.log('✓ Redis connected\n');

    // Admin credentials
    const email = process.env.ADMIN_EMAIL || 'admin@example.com';
    const password = process.env.ADMIN_PASSWORD || 'admin123';

    // Validate password requirements
    console.log('🔍 Validating password requirements...');
    const passwordValidation = validatePassword(password);
    
    if (!passwordValidation.valid) {
      console.log('❌ Password does not meet security requirements:\n');
      passwordValidation.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
      console.log('\n💡 Password must:');
      console.log('   - Be at least 12 characters long');
      console.log('   - Contain at least one uppercase letter');
      console.log('   - Contain at least one lowercase letter');
      console.log('   - Contain at least one number');
      console.log('   - Contain at least one special character');
      console.log('\n   Set a strong password in your .env file:');
      console.log('   ADMIN_PASSWORD=YourSecureP@ssw0rd123');
      throw new Error('Password does not meet security requirements');
    }
    console.log('✓ Password meets security requirements\n');

    // Check if admin already exists
    console.log('🔍 Checking if admin user exists...');
    const existingAdmin = await getUserByEmail(email);
    
    if (existingAdmin) {
      console.log('⚠️  Admin user already exists!');
      console.log(`   Email: ${existingAdmin.email}`);
      console.log(`   Role: ${existingAdmin.role}`);
      console.log(`   Created: ${existingAdmin.createdAt}`);
      console.log('\n💡 To reset password, delete the user from Redis first:');
      console.log(`   redis-cli DEL user:email:${email}`);
      console.log(`   redis-cli DEL user:${existingAdmin.id}`);
      return;
    }

    // Hash password
    console.log('🔒 Hashing password...');
    const passwordHash = await bcrypt.hash(password, 12);
    console.log('✓ Password hashed\n');

    // Create admin user
    console.log('👤 Creating admin user...');
    const admin = await createUser({
      email,
      passwordHash,
      role: 'admin',
    });

    console.log('✓ Admin user created successfully!\n');
    console.log('📋 Admin Details:');
    console.log(`   ID: ${admin.id}`);
    console.log(`   Email: ${admin.email}`);
    console.log(`   Role: ${admin.role}`);
    console.log(`   Password: ${password}`);
    console.log(`   Created: ${admin.createdAt}`);
    
    console.log('\n⚠️  SECURITY NOTICE:');
    console.log('   1. Change the default password immediately');
    console.log('   2. Set ADMIN_PASSWORD in .env for production');
    console.log('   3. Never commit credentials to version control');
    
    console.log('\n🔐 Login with:');
    console.log(`   curl -X POST http://localhost:3000/admin/auth/login \\`);
    console.log(`     -H "Content-Type: application/json" \\`);
    console.log(`     -d '{"email":"${email}","password":"${password}"}'`);

  } catch (error) {
    console.error('❌ Error creating admin user:', error.message);
    logger.error('Failed to create admin user', { error: error.message, stack: error.stack });
    process.exit(1);
  } finally {
    // Close Redis connection
    await closeRedis();
    console.log('\n✓ Done!\n');
    process.exit(0);
  }
};

// Run if called directly
if (require.main === module) {
  createAdminUser();
}

module.exports = createAdminUser;
