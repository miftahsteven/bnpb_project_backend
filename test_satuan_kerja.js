const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

// Create a valid token
const token = jwt.sign({ id: 1, role: 1 }, JWT_SECRET, { expiresIn: '1h' });

async function main() {
  const fetch = (await import('node-fetch')).default;
  try {
    const res = await fetch('http://localhost:8000/users/satuan-kerja', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    console.log('Status:', res.status);
    const text = await res.text();
    console.log('Response body length:', text.length);
  } catch (e) {
    console.error(e);
  }
}
main();
