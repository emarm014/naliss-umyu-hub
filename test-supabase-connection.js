// Simple test script to verify Supabase connection
const { createClient } = require('@supabase/supabase-js');

// Load environment variables
require('dotenv').config({ path: 'admin/.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

console.log('🔍 Testing Supabase Connection...');
console.log('📍 URL:', supabaseUrl);
console.log('🔑 Key:', supabaseAnonKey ? '✅ Present' : '❌ Missing');

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Missing Supabase environment variables');
  process.exit(1);
}

async function testConnection() {
  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    
    console.log('🔄 Testing connection...');
    
    // Test 1: Basic connection by fetching system info
    const { data: systemInfo, error: systemError } = await supabase
      .rpc('select_now')
      .single();
    
    if (systemError) {
      console.error('❌ Connection test failed:', systemError.message);
      return false;
    }
    
    console.log('✅ Basic connection successful');
    console.log('⏰ Server time:', systemInfo);
    
    // Test 2: Check if tables exist by querying a simple table
    const { data: departments, error: tableError } = await supabase
      .from('departments')
      .select('count')
      .limit(1);
    
    if (tableError) {
      console.error('❌ Table access test failed:', tableError.message);
      console.log('💡 This might be normal if tables are not created yet');
    } else {
      console.log('✅ Table access successful');
    }
    
    // Test 3: Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError) {
      console.log('⚠️  Auth test (expected for anon key):', authError.message);
    } else {
      console.log('✅ Auth check successful');
    }
    
    console.log('🎉 Supabase connection test completed successfully!');
    return true;
    
  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    return false;
  }
}

// Run the test
testConnection().then(success => {
  process.exit(success ? 0 : 1);
});