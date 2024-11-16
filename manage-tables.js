const { initDatabase, listAndDropTables } = require('./database.js');

async function manageTables() {
  await initDatabase();
  await listAndDropTables();
  process.exit(0);
}

manageTables().catch(error => {
  console.error('Error managing tables:', error);
  process.exit(1);
});
