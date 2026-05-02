require('dotenv').config();

async function run() {
  const apiKey = process.env.GEMINI_API_KEY;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  const data = await res.json();
  const embedModels = data.models.filter(m => m.name.includes('embed'));
  console.log(embedModels);
}
run();
