const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  logger.error('Missing required Supabase environment variables');
  process.exit(1);
}

// Create Supabase client with service role key for backend operations
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    global: {
      headers: {
        'User-Agent': 'ZimAI-Backend/1.0.0'
      }
    }
  }
);

// Test connection
async function testConnection() {
  try {
    const { data, error } = await supabase
      .from('companies')
      .select('count')
      .limit(1);
    
    if (error) throw error;
    logger.info('✅ Supabase connection established successfully');
  } catch (error) {
    logger.error('❌ Failed to connect to Supabase:', error.message);
    process.exit(1);
  }
}

// Initialize connection test
testConnection();

module.exports = supabase;