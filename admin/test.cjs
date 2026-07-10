const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://omrtbnywneezpaozbvzd.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tcnRibnl3bmVlenBhb3pidnpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NjE4NDUsImV4cCI6MjA4ODAzNzg0NX0.KWmN32ZtvpBNIoXOeMKlcHFySK7dSs1LH-_uv0yanK0';
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  console.log('Invoking cloudinary-usage...');
  const { data, error } = await supabase.functions.invoke('cloudinary-usage');
  console.log('Data:', data);
  console.log('Error:', error);
}

test();
