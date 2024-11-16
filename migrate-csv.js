const path = require('path');
const { initDatabase, migrateCSVToDatabase } = require('./database.js');

const CSV_DIR = path.join(__dirname, '..', 'rr-backend', 'Retrieved info', 'csv1');

async function runMigration() {
  try {
    await initDatabase();
    console.log('Database initialized. Starting migration...');
    await migrateCSVToDatabase(CSV_DIR);
    console.log('Migration completed successfully.');
  } catch (error) {
    console.error('Error during migration:', error);
  }
}

runMigration();
 