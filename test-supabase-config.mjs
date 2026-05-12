// Simple test to check Supabase configuration
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load admin environment variables
config({ path: 'admin/.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

console.log('🔍 Testing Supabase Connection...');
console.log('📍 URL:', supabaseUrl ? '✅ Configured' : '❌ Missing');
console.log('🔑 Key:', supabaseAnonKey ? '✅ Present' : '❌ Missing');

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Missing Supabase environment variables');
  process.exit(1);
}

// Extract project ID from URL
const projectId = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
console.log('🆔 Project ID:', projectId || '❌ Invalid URL format');

// Basic validation
if (supabaseAnonKey.startsWith('eyJ')) {
  console.log('✅ JWT token format looks valid');
} else {
  console.log('⚠️  JWT token format might be invalid');
}

console.log('🎉 Supabase configuration test completed!');
console.log('');
console.log('💡 To fully test the connection, run:');
console.log('   cd admin && npm run dev');
console.log('   Then check the browser console for any connection errors.');