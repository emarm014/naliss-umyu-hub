const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://omrtbnywneezpaozbvzd.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tcnRibnl3bmVlenBhb3pidnpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NjE4NDUsImV4cCI6MjA4ODAzNzg0NX0.KWmN32ZtvpBNIoXOeMKlcHFySK7dSs1LH-_uv0yanK0'
);

async function findOldMedia() {
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

  console.log('Searching for announcements created before:', oneMonthAgo.toISOString());

  const { data, error } = await supabase
    .from('announcements')
    .select('id, title, cover_image_url, created_at')
    .not('cover_image_url', 'is', null)
    .lt('created_at', oneMonthAgo.toISOString())
    .limit(5);

  if (error) {
    console.error('Error fetching data:', error);
  } else {
    console.log(`Found ${data.length} records:`);
    console.log(JSON.stringify(data, null, 2));
  }
}

findOldMedia();
