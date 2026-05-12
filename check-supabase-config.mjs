// Simple test to check Supabase configuration
import { readFileSync } from 'fs';

console.log('🔍 Testing Supabase Configuration...\n');

// Check admin .env
try {
  const adminEnv = readFileSync('admin/.env', 'utf8');
  const adminUrl = adminEnv.match(/VITE_SUPABASE_URL=(.+)/)?.[1];
  const adminKey = adminEnv.match(/VITE_SUPABASE_ANON_KEY=(.+)/)?.[1];
  
  console.log('📊 Admin Panel Configuration:');
  console.log('  📍 URL:', adminUrl ? '✅ Configured' : '❌ Missing');
  console.log('  🔑 Key:', adminKey ? '✅ Present' : '❌ Missing');
  
  if (adminUrl && adminKey) {
    const projectId = adminUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
    console.log('  🆔 Project ID:', projectId || '❌ Invalid URL format');
    console.log('  🔐 JWT Format:', adminKey.startsWith('eyJ') ? '✅ Valid' : '⚠️  Invalid');
  }
} catch (error) {
  console.log('❌ Could not read admin/.env file');
}

console.log('');

// Check mobile .env
try {
  const mobileEnv = readFileSync('mobile/.env', 'utf8');
  const mobileUrl = mobileEnv.match(/EXPO_PUBLIC_SUPABASE_URL=(.+)/)?.[1];
  const mobileKey = mobileEnv.match(/EXPO_PUBLIC_SUPABASE_ANON_KEY=(.+)/)?.[1];
  
  console.log('📱 Mobile App Configuration:');
  console.log('  📍 URL:', mobileUrl ? '✅ Configured' : '❌ Missing');
  console.log('  🔑 Key:', mobileKey ? '✅ Present' : '❌ Missing');
  
  if (mobileUrl && mobileKey) {
    const projectId = mobileUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
    console.log('  🆔 Project ID:', projectId || '❌ Invalid URL format');
    console.log('  🔐 JWT Format:', mobileKey.startsWith('eyJ') ? '✅ Valid' : '⚠️  Invalid');
  }
} catch (error) {
  console.log('❌ Could not read mobile/.env file');
}

console.log('\n🎉 Configuration check completed!');
console.log('\n💡 Next steps to test connection:');
console.log('1. Check if both projects use the same Supabase instance');
console.log('2. Run: cd admin && npm run dev');
console.log('3. Check browser console for connection errors');
console.log('4. Run: cd mobile && npm start');
console.log('5. Check Metro logs for connection status');