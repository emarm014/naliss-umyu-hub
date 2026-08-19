async function checkLocalRows() {
  const url = `http://127.0.0.1:54321/rest/v1/announcements?select=id,title,cover_image_url,created_at&limit=5`;
  
  // Default local supabase anon key
  const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1cGFiYXNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE1MTYyMzkwMjIsImV4cCI6MTkyMTI5MjgxM30.4qM-M7e-y1Z1q1mXn46T1w4r5Zt5vA7X4yD3O4XzX8M';
  
  try {
    const res = await fetch(url, {
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`
      }
    });
    
    if (!res.ok) {
        console.log('Local supabase failed:', res.status, await res.text());
        return;
    }
    
    const data = await res.json();
    console.log(`Found ${data.length} records in local announcements:`);
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
      console.log('Local supabase fetch error:', error.message);
  }
}

checkLocalRows();
