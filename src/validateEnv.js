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
  console.error('\n Environment Validation Failed!');
  console.error(`Missing required environment variable(s):\n  - ${missingVars.join('\n  - ')}`);
  console.error('\n Make sure your .env file is properly loaded and the variables are defined.\n');
  process.exit(1);
}

console.log('All required environment variables are set.');