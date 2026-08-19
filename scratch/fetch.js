const url = "https://omrtbnywneezpaozbvzd.supabase.co/rest/v1/news?select=id,title,image_url,files&order=created_at.desc&limit=5";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tcnRibnl3bmVlenBhb3pidnpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NjE4NDUsImV4cCI6MjA4ODAzNzg0NX0.KWmN32ZtvpBNIoXOeMKlcHFySK7dSs1LH-_uv0yanK0";

fetch(url, {
  headers: {
    "apikey": key,
    "Authorization": `Bearer ${key}`
  }
})
.then(res => res.json())
.then(data => console.log(JSON.stringify(data, null, 2)))
.catch(err => console.error(err));
