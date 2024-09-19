const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');
const cheerio = require('cheerio');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BRIGHT_DATA_API_KEY = process.env.BRIGHT_DATA_API_KEY;
const ROCKETREACH_API_KEY = process.env.ROCKETREACH_API_KEY;
const { 
  initDatabase, 
  saveEmployeesToDatabase, 
  searchCompanyEmployees, 
  migrateCSVToDatabase, 
  getAllCompanies, 
  getEmployeeCount, 
  getOrCreateCompany 
} = require('./database.js');


function getWeightedRandomStart() {
  const rand = Math.random();
  if (rand < 4/9) {  // 2/3 * 2/3 = 4/9 chance for 1-250
    return Math.floor(Math.random() * 250) + 1;
  } else if (rand < 2/3) {  // 2/3 - 4/9 = 2/9 chance for 251-500
    return Math.floor(Math.random() * 250) + 251;
  } else {  // 1/3 chance for 501-1000
    return Math.floor(Math.random() * 500) + 501;
  }
}

async function searchCompanyInRocketReach(companyName) {
  console.log(`Searching RocketReach for employees of ${companyName}...`);

  try {
    const randomStart = getWeightedRandomStart();
    console.log(`Using random start number: ${randomStart}`);

    const response = await axios.post('https://api.rocketreach.co/v2/api/search', {
      query: {
        current_employer: [`"${companyName}"`],
        location: ['United States']
      },
      start: randomStart,
      page_size: 10
    }, {
      headers: {
        'Api-Key': ROCKETREACH_API_KEY
      }
    });

    if (response.data && response.data.profiles) {
      const employees = response.data.profiles
          .filter(profile => profile.current_employer && profile.current_employer.toLowerCase() === companyName.toLowerCase())
          .map(profile => ({
            name: profile.name || 'N/A',
            title: profile.current_title || 'N/A',
            linkedInURL: profile.linkedin_url || 'N/A',
            company: companyName,  // Use the original company name to ensure consistency
            location: profile.location || '',
            city: profile.city || '',
            region: profile.region || '',
            country: profile.country || '',
            country_code: profile.country_code || '',
            phone_numbers: profile.phones ? profile.phones.map(p => p.number).join(', ') : '',
            emails: profile.emails ? profile.emails.join(', ') : '',
            personal_emails: profile.personal_emails ? profile.personal_emails.join(', ') : '',
            professional_emails: profile.professional_emails ? profile.professional_emails.join(', ') : '',
            birth_year: profile.birth_year || null,
            current_employer_website: profile.current_employer_website || '',
            current_employer_domain: profile.current_employer_domain || '',
            current_employer_id: profile.current_employer_id || null,
            current_employer_linkedin_url: profile.current_employer_linkedin_url || '',
            profile_picture_url: profile.profile_pic || '',
            region_latitude: profile.region_latitude || null,
            region_longitude: profile.region_longitude || null,
            status: profile.status || '',
            suppressed: profile.suppressed || false,
            category: ''  // RocketReach doesn't provide this, so we'll leave it empty
          }));

      console.log(`Found ${employees.length} matching employees for ${companyName} on RocketReach.`);
      return employees;
    } else {
      console.log(`No employees found for ${companyName} on RocketReach.`);
      return [];
    }
  } catch (error) {
    console.error('Error searching RocketReach:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    return [];
  }
}

function searchCompanyInCSVs(companyName) {
  const csvDir = path.join(__dirname, '..', 'rr-backend', 'Retrieved info', 'csv1');
  let employees = [];

  return new Promise((resolve, reject) => {
    fs.readdir(csvDir, (err, files) => {
      if (err) {
        reject(err);
        return;
      }

      let processedFiles = 0;
      files.forEach(file => {
        if (path.extname(file).toLowerCase() === '.csv') {
          fs.createReadStream(path.join(csvDir, file))
              .pipe(csv())
              .on('data', (row) => {
                if (row.CurrentCompany && row.CurrentCompany.toLowerCase() === companyName.toLowerCase()) {
                  employees.push({
                    name: row.Name,
                    title: row.Title,
                    linkedInURL: row.LinkedInURL
                  });
                }
              })
              .on('end', () => {
                processedFiles++;
                if (processedFiles === files.length) {
                  resolve(employees);
                }
              });
        } else {
          processedFiles++;
          if (processedFiles === files.length) {
            resolve(employees);
          }
        }
      });
    });
  });
}

async function fetchLinkedInJobDescription(url) {
  try {
    console.log('Attempting to fetch LinkedIn job description for URL:', url);

    // Step 1: Trigger data collection
    const triggerResponse = await axios.post(
        'https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_lpfll7v5hcqtkxl6l&format=json&uncompressed_webhook=true',
        [{ url }],
        {
          headers: {
            'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
    );

    const snapshotId = triggerResponse.data.snapshot_id;
    console.log('Data collection triggered. Snapshot ID:', snapshotId);

    // Step 2: Retrieve the data
    let retries = 0;
    const maxRetries = 5;
    while (retries < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 5 seconds

      const dataResponse = await axios.get(
          `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}?format=json`,
          {
            headers: {
              'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
            },
          }
      );

      if (dataResponse.data && dataResponse.data.length > 0) {
        const jobData = dataResponse.data[0];
        console.log('Job data retrieved:', jobData);

        const jobDescription = jobData.job_summary || 'No job description found';
        const companyName = jobData.company_name;
        const jobTitle = jobData.job_title;

        return { jobDescription, companyName, jobTitle };
      }

      retries++;
      console.log(`Data not ready yet. Retry ${retries}/${maxRetries}`);
    }

    throw new Error('Failed to retrieve job data after multiple attempts');
  } catch (error) {
    console.error('Error fetching LinkedIn job description:', error.message);
    console.error('Response data:', error.response?.data);
    throw new Error('Failed to fetch LinkedIn job description');
  }
}


async function fetchJobDescription(url) {
  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    
    // This is a basic implementation. You might need to adjust the selector
    // based on the specific structure of the job posting websites you're targeting.
    const jobDescription = $('body').text().trim();
    
    return jobDescription;
  } catch (error) {
    console.error('Error fetching job description:', error.message);
    throw new Error('Failed to fetch job description');
  }
}

app.post('/api/analyze', async (req, res) => {
  try {
    const { link, jobDescription: providedJobDescription } = req.body;

    let jobDescription, companyName, jobTitle;

    if (!providedJobDescription && link) {
      if (link.includes('linkedin.com/jobs')) {
        const linkedInData = await fetchLinkedInJobDescription(link);
        jobDescription = linkedInData.jobDescription;
        companyName = linkedInData.companyName;
        jobTitle = linkedInData.jobTitle;
      } else {
        jobDescription = await fetchJobDescription(link);
      }
    } else {
      jobDescription = providedJobDescription;
    }

    if (!jobDescription) {
      return res.status(400).json({ error: 'No job description provided or fetched.' });
    }

    // Only use OpenAI if we don't have company name and job title
    if (!companyName || !jobTitle) {
      const prompt = `
        Analyze the following job description and extract the following information:
        1. Company name
        2. Role title
        3. Summarize: A brief summary of the role (MAX 100 words)

        Job posting link: ${link}
        Job description: ${jobDescription}

        Please provide the information in the following format:
        Company Name: [extracted company name]
        Role Title: [extracted role title]
        Summary: [brief summary of the role]
      `;

      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
      }, {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      const analysisResult = response.data.choices[0].message.content;
      const lines = analysisResult.split('\n');
      companyName = companyName || lines.find(line => line.startsWith('Company Name:'))?.split(': ')[1] || '';
      jobTitle = jobTitle || lines.find(line => line.startsWith('Role Title:'))?.split(': ')[1] || '';
      const summary = lines.find(line => line.startsWith('Summary:'))?.split(': ')[1] || '';
    }

    // Ensure the company exists in the database
    await getOrCreateCompany(companyName);

    // Search for employees in the database
    let dbEmployees = await searchCompanyEmployees(companyName);
    console.log(`Found ${dbEmployees.length} employees in the database for ${companyName}.`);

    // Always search RocketReach
    const rocketReachEmployees = await searchCompanyInRocketReach(companyName);
    console.log(`Found ${rocketReachEmployees.length} matching employees from RocketReach for ${companyName}.`);

    // Identify new employees from RocketReach
    let newEmployees = rocketReachEmployees.filter(rocketReachEmployee => 
      !dbEmployees.some(dbEmployee => dbEmployee.linkedInURL === rocketReachEmployee.linkedInURL)
    );

    // Save new employees to the database
    if (newEmployees.length > 0) {
      await saveEmployeesToDatabase(newEmployees, companyName);
    }

    // Combine all employees
    let allEmployees = [...dbEmployees, ...newEmployees];

    // Sort employees by name for consistency
    allEmployees.sort((a, b) => a.name.localeCompare(b.name));

    console.log(`Returning ${allEmployees.length} employees for ${companyName}.`);

    res.json({ companyName, roleTitle: jobTitle, summary: jobDescription, employees: allEmployees, jobDescription });
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'An error occurred while processing your request.' });
  }
});

async function startServer() {
  await initDatabase();
  
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

startServer().catch(console.error);