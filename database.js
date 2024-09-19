const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const fs = require('fs');
const fsPromises = require('fs').promises;
const csv = require('csv-parser');
const path = require('path');
const readline = require('readline');
const axios = require('axios');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

let db;

async function initDatabase() {
  if (!db) {
    db = await open({
      filename: './employees.db',
      driver: sqlite3.Database
    });

    await db.exec(`
      CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        website TEXT,
        domain TEXT,
        linkedin_url TEXT
      );

      CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        linkedInURL TEXT UNIQUE,
        title TEXT,
        company_id INTEGER,
        location TEXT,
        city TEXT,
        region TEXT,
        country TEXT,
        country_code TEXT,
        phone_numbers TEXT,
        emails TEXT,
        personal_emails TEXT,
        professional_emails TEXT,
        birth_year INTEGER,
        current_employer_website TEXT,
        current_employer_domain TEXT,
        current_employer_id INTEGER,
        current_employer_linkedin_url TEXT,
        profile_picture_url TEXT,
        region_latitude REAL,
        region_longitude REAL,
        status TEXT,
        suppressed BOOLEAN,
        category TEXT,
        current_company TEXT,
        current_employer TEXT,
        education TEXT,
        job_history TEXT,
        skills TEXT,
        is_enriched BOOLEAN DEFAULT 0,
        FOREIGN KEY (company_id) REFERENCES companies(id)
      );

      CREATE INDEX IF NOT EXISTS idx_companies_name_nocase ON companies(name COLLATE NOCASE);
    `);

    // Check and add columns if they don't exist (for existing databases)
    const existingColumns = await db.all("PRAGMA table_info(employees)");
    const columnNames = existingColumns.map(col => col.name);

    const newColumns = [
      { name: 'education', type: 'TEXT' },
      { name: 'job_history', type: 'TEXT' },
      { name: 'skills', type: 'TEXT' },
      { name: 'is_enriched', type: 'BOOLEAN DEFAULT 0' }
    ];

    for (const col of newColumns) {
      if (!columnNames.includes(col.name)) {
        await db.run(`ALTER TABLE employees ADD COLUMN ${col.name} ${col.type}`);
      }
    }
  }
  return db;
}

async function listAndDropTables() {
  const tables = await db.all("SELECT name, sql, type FROM sqlite_master WHERE type='table'");
  
  console.log("Existing tables:");
  tables.forEach((table, index) => {
    console.log(`${index + 1}. ${table.name}`);
    console.log(`   Creation SQL: ${table.sql}`);
    console.log('---');
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

  const tablesToDrop = await askQuestion("Enter the numbers of the tables you want to drop (comma-separated), or 'none' to cancel: ");

  if (tablesToDrop.toLowerCase() === 'none') {
    console.log("No tables will be dropped.");
    rl.close();
    return;
  }

  const password = await askQuestion("Enter the password to confirm dropping tables: ");

  if (password !== '206611667') {
    console.log("Incorrect password. No tables will be dropped.");
    rl.close();
    return;
  }

  const tableIndices = tablesToDrop.split(',').map(num => parseInt(num.trim()) - 1);
  for (const index of tableIndices) {
    if (index >= 0 && index < tables.length) {
      const tableName = tables[index].name;
      await db.run(`DROP TABLE IF EXISTS ${tableName}`);
      console.log(`Dropped table: ${tableName}`);
    }
  }

  console.log("Table dropping complete.");
  rl.close();
}

async function getOrCreateCompany(companyName, website, domain, linkedinUrl) {
  if (!companyName) {
    console.log('Warning: Empty company name provided');
    return null;
  }

  const normalizedName = companyName.trim();
  
  try {
    // Try to find the company with case-insensitive matching
    let company = await db.get('SELECT * FROM companies WHERE name COLLATE NOCASE = ?', [normalizedName]);
    
    if (!company) {
      // If no match found, create a new company
      const result = await db.run(
        'INSERT INTO companies (name, website, domain, linkedin_url) VALUES (?, ?, ?, ?)',
        [normalizedName, website, domain, linkedinUrl]
      );
      company = { 
        id: result.lastID, 
        name: normalizedName,
        website,
        domain,
        linkedin_url: linkedinUrl
      };
      console.log('New company created:', company);
    } else {
      // If a match is found, update the company information if it has changed
      if (company.website !== website || company.domain !== domain || company.linkedin_url !== linkedinUrl) {
        await db.run(
          'UPDATE companies SET website = ?, domain = ?, linkedin_url = ? WHERE id = ?',
          [website, domain, linkedinUrl, company.id]
        );
        company = { ...company, website, domain, linkedin_url: linkedinUrl };
        console.log('Company information updated:', company);
      } else {
        console.log('Company already exists, no updates needed:', company);
      }
    }

    return company;
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT') {
      console.log(`Conflict detected for company "${companyName}". This might be due to concurrent inserts. Fetching existing record.`);
      const existingCompany = await db.get('SELECT * FROM companies WHERE name COLLATE NOCASE = ?', [normalizedName]);
      return existingCompany;
    } else {
      console.error('Error in getOrCreateCompany:', error);
      throw error;
    }
  }
}

async function checkCompanyDetails(companyName) {
  const company = await db.get('SELECT * FROM companies WHERE name COLLATE NOCASE = ?', [companyName]);
  console.log('Company details:', company);
  
  if (company) {
    const employeeCount = await db.get('SELECT COUNT(*) as count FROM employees WHERE company_id = ?', [company.id]);
    console.log(`Number of employees with company_id ${company.id}:`, employeeCount.count);
  }

  const allEmployeesForCompany = await db.all('SELECT * FROM employees WHERE current_company COLLATE NOCASE = ?', [companyName]);
  console.log(`Number of employees with current_company "${companyName}":`, allEmployeesForCompany.length);
  
  if (allEmployeesForCompany.length > 0) {
    console.log('Sample employees:', allEmployeesForCompany);
  }
}

function readCSVFile(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error));
  });
}

async function saveEmployeesToDatabase(employees, companyName) {
  console.log('First few employees:', JSON.stringify(employees.slice(0, 3), null, 2));

  const stmt = await db.prepare(`
    INSERT OR REPLACE INTO employees (
      name, linkedInURL, title, location, city, region, country, country_code,
      phone_numbers, emails, personal_emails, professional_emails, birth_year,
      current_employer_website, current_employer_domain, current_employer_id, current_employer_linkedin_url,
      profile_picture_url, region_latitude, region_longitude, status, suppressed, category,
      company_id, current_company, current_employer, education, job_history, skills, is_enriched
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const errors = [];
  let savedCount = 0;
  let skippedCount = 0;

  for (const employee of employees) {
    try {
      const currentCompany = employee.company || companyName;
      if (!currentCompany) {
        console.log(`Skipping employee: ${employee.name || 'Unknown'} - No CurrentCompany`);
        errors.push({ employee: employee.name || 'Unknown', error: 'No CurrentCompany' });
        skippedCount++;
        continue;
      }

      const company = await getOrCreateCompany(
          currentCompany,
          employee.current_employer_website,
          employee.current_employer_domain,
          employee.current_employer_linkedin_url
      );

      if (!company) {
        console.log(`Skipping employee: ${employee.name || 'Unknown'} - Could not create or find company: ${currentCompany}`);
        errors.push({ employee: employee.name || 'Unknown', error: `Could not create or find company: ${currentCompany}` });
        skippedCount++;
        continue;
      }

      // Enrich the employee profile
      let enrichedEmployee = { ...employee };
      try {
        enrichedEmployee = await enrichProfile(enrichedEmployee);
      } catch (error) {
        console.error(`Error enriching profile for ${employee.name}: ${error.message}`);
        enrichedEmployee.is_enriched = 0;
        // Decide whether to proceed with saving the employee without enrichment
      }

      console.log('Inserting employee:', {
        name: enrichedEmployee.name,
        currentCompany: currentCompany,
        company_id: company.id,
        is_enriched: enrichedEmployee.is_enriched
      });

      // Proceed with saving the employee
      await stmt.run([
        enrichedEmployee.name,
        enrichedEmployee.linkedInURL,
        enrichedEmployee.title,
        enrichedEmployee.location,
        enrichedEmployee.city,
        enrichedEmployee.region,
        enrichedEmployee.country,
        enrichedEmployee.country_code,
        enrichedEmployee.phone_numbers,
        enrichedEmployee.emails,
        enrichedEmployee.personal_emails,
        enrichedEmployee.professional_emails,
        enrichedEmployee.birth_year,
        enrichedEmployee.current_employer_website,
        enrichedEmployee.current_employer_domain,
        enrichedEmployee.current_employer_id,
        enrichedEmployee.current_employer_linkedin_url,
        enrichedEmployee.profile_picture_url,
        enrichedEmployee.region_latitude,
        enrichedEmployee.region_longitude,
        enrichedEmployee.status,
        enrichedEmployee.suppressed ? 1 : 0,
        enrichedEmployee.category,
        company.id,
        currentCompany,
        enrichedEmployee.current_employer,
        enrichedEmployee.education,
        enrichedEmployee.job_history,
        enrichedEmployee.skills,
        enrichedEmployee.is_enriched || 0
      ]);

      savedCount++;
      console.log(`Saved employee: ${enrichedEmployee.name} for company: ${currentCompany}`);

    } catch (error) {
      console.error(`Error processing employee: ${employee.name || 'Unknown'}`, error);
      errors.push({ employee: employee.name || 'Unknown', error: error.message });
      skippedCount++;
    }
  }

  await stmt.finalize();

  console.log(`Finished processing ${employees.length} employees. Saved: ${savedCount}, Skipped: ${skippedCount}, Errors: ${errors.length}`);

  if (errors.length > 0) {
    const logFile = path.join(__dirname, 'employee_save_errors.log');
    const logContent = errors.map(e => `${new Date().toISOString()} - Employee: ${e.employee}, Error: ${e.error}`).join('\n');
    await fsPromises.appendFile(logFile, logContent + '\n');
    console.error(`Encountered ${errors.length} issues while saving employees. Details written to ${logFile}`);
  }
}

// Helper function to make requests with retry logic
async function makeRequestWithRetry(url, options, retryCount = 0) {
  const maxRetries = 5;
  try {
    const response = await axios(url, options);
    return response;
  } catch (error) {
    if (error.response && error.response.status === 429) {
      const retryAfter = parseInt(error.response.headers['retry-after']) || 60;
      console.log(`Rate limit reached. Waiting for ${retryAfter} seconds before retrying...`);
      await delay(retryAfter * 1000);

      if (retryCount < maxRetries) {
        return makeRequestWithRetry(url, options, retryCount + 1);
      } else {
        throw new Error(`Exceeded maximum retries for ${url}`);
      }
    } else {
      throw error;
    }
  }
}

async function enrichProfile(employee) {
  const apiKey = process.env.ROCKETREACH_API_KEY;
  let retryCount = 0;

  const payload = {
    name: employee.name,
    current_employer: employee.current_company || employee.current_employer,
    linkedin_url: employee.linkedInURL
  };

  // Remove undefined or empty fields
  Object.keys(payload).forEach(
      key => (payload[key] === undefined || payload[key] === '') && delete payload[key]
  );

  try {
    // Start the lookup with retry logic
    const lookupResponse = await makeRequestWithRetry(
        'https://api.rocketreach.co/v2/api/person/lookup',
        {
          method: 'get',
          params: payload,
          headers: {
            'Api-Key': apiKey,
            'Content-Type': 'application/json'
          }
        }
    );

    let profile = lookupResponse.data;
    const profileId = profile.id;

    if (!profileId) {
      throw new Error(`No profile ID returned for ${employee.name}.`);
    }

    // Poll the checkStatus endpoint until the status is 'complete' or 'failed'
    let status = profile.status || 'unknown';

    while (status !== 'complete' && status !== 'failed') {
      await delay(5000); // Wait for 5 seconds before polling again

      const statusResponse = await makeRequestWithRetry(
          'https://api.rocketreach.co/v2/api/person/checkStatus',
          {
            method: 'get',
            params: { ids: profileId },
            headers: {
              'Api-Key': apiKey,
              'Content-Type': 'application/json'
            }
          }
      );

      if (Array.isArray(statusResponse.data) && statusResponse.data.length > 0) {
        profile = statusResponse.data.find(p => p.id === profileId);
        status = profile ? profile.status : 'unknown';
      } else {
        profile = statusResponse.data;
        status = profile.status || 'unknown';
      }
    }

    if (status === 'complete') {
      // Extract relevant fields
      const education = profile.education || [];
      const job_history = profile.job_history || [];
      const skills = profile.skills || [];

      // Improved Logging
      const educationInstitutions = education.map(edu => edu.school).filter(Boolean).join(', ') || 'N/A';
      const companies = job_history.map(job => job.company_name).filter(Boolean).join(', ') || 'N/A';
      const skillList = skills.join(', ') || 'N/A';

      console.log(`${employee.name} enriched profile`);
      console.log(`Education: [${educationInstitutions}]`);
      console.log(`Work History: [${companies}]`);
      console.log(`Skills: [${skillList}]\n`);

      // Update the employee object with enriched data
      return {
        ...employee,
        education: JSON.stringify(education),
        job_history: JSON.stringify(job_history),
        skills: JSON.stringify(skills),
        is_enriched: 1,

        // Include all additional fields from the enriched profile
        birth_year: profile.birth_year,
        region_latitude: profile.region_latitude,
        region_longitude: profile.region_longitude,
        city: profile.city,
        region: profile.region,
        country: profile.country,
        country_code: profile.country_code,
        current_employer_website: profile.current_employer_website,
        current_employer_domain: profile.current_employer_domain,
        current_employer_id: profile.current_employer_id,
        current_employer_linkedin_url: profile.current_employer_linkedin_url,
        profile_picture_url: profile.profile_pic,
        status: profile.status,
        suppressed: profile.suppressed,
        current_employer: profile.current_employer,
        current_title: profile.current_title,
        location: profile.location,
        emails: JSON.stringify(profile.emails || []),
        phone_numbers: JSON.stringify(profile.phones || [])
      };
    } else {
      throw new Error(`Profile enrichment failed for ${employee.name}. Status: ${status}`);
    }
  } catch (error) {
    console.error(`Error fetching enriched data for ${employee.name}:`, error.message);
    // Optionally, mark the profile as not enriched in your database
    return { ...employee, is_enriched: 0 };
  }
}

async function enrichAllProfiles() {
  // Get total profiles and enriched profiles before starting
  const totalProfilesResult = await db.get('SELECT COUNT(*) as count FROM employees');
  const totalProfiles = totalProfilesResult.count;

  const enrichedBeforeResult = await db.get('SELECT COUNT(*) as count FROM employees WHERE is_enriched = 1');
  const enrichedBeforeRun = enrichedBeforeResult.count;

  const profilesLeftBeforeRun = totalProfiles - enrichedBeforeRun;

  const employees = await db.all('SELECT * FROM employees WHERE is_enriched IS NULL OR is_enriched = 0');
  console.log(`Enriching ${employees.length} employee profiles...\n`);

  let profilesEnrichedThisRun = 0;
  const startTime = Date.now();

  for (const employee of employees) {
    try {
      const beforeEnrichment = { ...employee }; // Copy data before enrichment

      // Enrich the employee profile
      const enrichedEmployee = await enrichProfile(employee);

      // Update the employee record with the new data
      await db.run(
          `UPDATE employees SET education = ?, job_history = ?, skills = ?, is_enriched = 1 WHERE id = ?`,
          [
            enrichedEmployee.education,
            enrichedEmployee.job_history,
            enrichedEmployee.skills,
            employee.id
          ]
      );

      profilesEnrichedThisRun++;

      // Calculate stats
      const totalEnrichedSoFar = enrichedBeforeRun + profilesEnrichedThisRun;
      const profilesLeftToEnrichNow = totalProfiles - totalEnrichedSoFar;
      const timeTakenSoFar = (Date.now() - startTime) / 1000; // in seconds
      const timePerProfile = timeTakenSoFar / profilesEnrichedThisRun;
      const estimatedTimeLeft = profilesLeftToEnrichNow * timePerProfile; // in seconds

      // Format estimated time left
      const etaHours = Math.floor(estimatedTimeLeft / 3600);
      const etaMinutes = Math.floor((estimatedTimeLeft % 3600) / 60);
      const etaSeconds = Math.floor(estimatedTimeLeft % 60);

      // Determine what data was added
      const addedData = {};

      if ((!beforeEnrichment.education || beforeEnrichment.education === '[]') && enrichedEmployee.education && enrichedEmployee.education !== '[]') {
        addedData.education = JSON.parse(enrichedEmployee.education);
      }
      if ((!beforeEnrichment.job_history || beforeEnrichment.job_history === '[]') && enrichedEmployee.job_history && enrichedEmployee.job_history !== '[]') {
        addedData.job_history = JSON.parse(enrichedEmployee.job_history);
      }
      if ((!beforeEnrichment.skills || beforeEnrichment.skills === '[]') && enrichedEmployee.skills && enrichedEmployee.skills !== '[]') {
        addedData.skills = JSON.parse(enrichedEmployee.skills);
      }

      // Output the enriched profile info
      console.log(`Enriched profile for ${employee.name}`);
      if (Object.keys(addedData).length > 0) {
        console.log(`New data added: ${JSON.stringify(addedData)}`);
      }

      // Output summary stats on the last line
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);

      process.stdout.write(`Total enriched in DB: ${totalEnrichedSoFar}, Profiles left: ${profilesLeftToEnrichNow}, Enriched this run: ${profilesEnrichedThisRun}, Estimated time left: ${etaHours}h ${etaMinutes}m ${etaSeconds}s`);

      // Respect rate limits
      await delay(2000); // Adjust delay based on API rate limits
    } catch (error) {
      console.error(`Error enriching profile for ${employee.name}:`, error.message);
      // Optionally handle errors or update is_enriched flag
    }
  }

  console.log('\nProfile enrichment complete.');
}

async function migrateCSVToDatabase(csvDir) {
  const files = fs.readdirSync(csvDir);
  for (const file of files) {
    if (path.extname(file).toLowerCase() === '.csv') {
      const filePath = path.join(csvDir, file);
      const employees = [];
      
      await new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
          .pipe(csv())
          .on('data', (row) => {
            if (row.Name && row.CurrentCompany) {
              employees.push({
                Name: row.Name,
                LinkedInURL: row.LinkedInURL || '',
                CurrentCompany: row.CurrentCompany,
                Title: row.Title || '',
                Location: row.Location || '',
                City: row.City || '',
                Region: row.Region || '',
                Country: row.Country || '',
                CountryCode: row.CountryCode || '',
                PhoneNumbers: row.PhoneNumbers || '',
                Emails: row.Emails || '',
                PersonalEmails: row.PersonalEmails || '',
                ProfessionalEmails: row.ProfessionalEmails || '',
                BirthYear: row.BirthYear || null,
                CurrentEmployerWebsite: row.CurrentEmployerWebsite || '',
                CurrentEmployerDomain: row.CurrentEmployerDomain || '',
                CurrentEmployerId: row.CurrentEmployerId || null,
                CurrentEmployerLinkedInURL: row.CurrentEmployerLinkedInURL || '',
                ProfilePictureURL: row.ProfilePictureURL || '',
                RegionLatitude: row.RegionLatitude || null,
                RegionLongitude: row.RegionLongitude || null,
                Status: row.Status || '',
                Suppressed: row.Suppressed === 'true',
                Category: row.Category || ''
              });
            } else {
              console.log(`Skipping row due to missing Name or CurrentCompany: ${JSON.stringify(row)}`);
            }
          })
          .on('end', resolve)
          .on('error', reject);
      });

      await saveEmployeesToDatabase(employees);
      console.log(`Processed ${file}`);
    }
  }
}

async function searchCompanyEmployees(companyName) {
  console.log(`Searching for employees of company: "${companyName}"`);

  await checkCompanyDetails(companyName);

  const company = await getOrCreateCompany(companyName);

  if (!company) {
    console.log(`Company "${companyName}" not found`);
    return [];
  }

  console.log(`Found company: ${company.name}, ID: ${company.id}`);

  const employees = await db.all(`
    SELECT DISTINCT * FROM employees 
    WHERE company_id = ? OR current_company COLLATE NOCASE = ?
  `, [company.id, companyName]);

  console.log(`Retrieved ${employees.length} unique employees from database for ${companyName}`);

  if (employees.length > 0) {
    console.log('First few employees:', employees.slice(0, 3).map(e => ({name: e.name, title: e.title, linkedInURL: e.linkedInURL})));
  } else {
    console.log('No employees found for this company');
  }

  return employees;
}

async function getAllCompanies() {
  return await db.all('SELECT * FROM companies');
}

async function getEmployeeCount() {
  const result = await db.get('SELECT COUNT(*) as count FROM employees');
  return result.count;
}

module.exports = {
  get db() {
    return db;
  },
  initDatabase,
  saveEmployeesToDatabase,
  searchCompanyEmployees,
  enrichProfile,
  enrichAllProfiles,
  migrateCSVToDatabase,
  getAllCompanies,
  getEmployeeCount,
  listAndDropTables,
  getOrCreateCompany
};