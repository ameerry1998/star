require('dotenv').config();
const { initDatabase, enrichAllProfiles } = require('./database.js');

async function main() {
  await initDatabase();
  await enrichAllProfiles();
}

main().catch(error => {
  console.error('Error enriching employee profiles:', error.message);
});

