const requiredVars = [
  'DATABASE_URL',
  'JWT_SECRET',
  'EMAIL_USER',
  'EMAIL_PASS',
  'FRONTEND_BASE_URL',
  'MANAGER_REG_CODE'
];

const missingVars = requiredVars.filter((key) => !process.env[key]);

if (missingVars.length > 0) {
  console.error(`❌ Missing required environment variable(s): ${missingVars.join(', ')}`);
  process.exit(1);
}

console.log('✅ All required environment variables are set.');