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
  getAllCompanies,
  getEmployeeCount,
  getOrCreateCompany,
  saveJobToDatabase,
  saveApplicationToDatabase,
  getAllJobs,
  getApplicationsByUserId,
  getApplicationById,
  saveResumeSuggestionsToDatabase,
  getUserPastCompanies,
  getEmployeesWithMatchingCompanies,
  getJobById,
  getCompanyById,
} = require('./database.js');

// TODO: remove and add dynamic resumes
const HARD_CODED_RESUME = `
Ameer Rayan
Boston, MA
+1 313.423.2863
ameer.rayan@gmail.com


LinkedIn: linkedin.com/in/ameer-rayan/ 
GitHub: github.com/ameerry1998




>LANGUAGES AND TECHNOLOGIES
Proficient: React, Node.js, Ruby/Rails, Jest, Javascript,  Java, Spring Boot, Kubernetes, Docker, Firebase
Exposure: Python, SQL, Django, React Native, AWS, Scheme

>PROFESSIONAL EXPERIENCE
Constant Contact | Software Developer | Boston, MA \t\t\t\t\t\tJuly 2022  - CURRENT
Upgraded front-end repos, migrating from Backbone to React and establishing a consolidated Lerna repo.
Developed an internal tool for support engineers, consolidating 28 tools and 7 authentication methods into one platform, and modernized key components using Node.js.
Contributed to major backend efforts, refactoring legacy data models to allow for new features
Drove the migration of legacy applications to Kubernetes, leading to deployment efficiency.
Drove cross-functional collaboration and mentored junior colleagues, contributing to a culture of knowledge sharing and continuous improvement in the team.
Completed a year-long rotational program, gaining exposure to React, Node.js, Docker, Kubernetes, EKS, S3, AWS Lambda.

Hour25.ai| Student Software Developer | Boston, MA | Live URL \tMAY 2021 - May 2022
Developed a Java  Android application, to support healthy phone use habits.
Integrated event tracking  with firestore improving app tracking by 80+%.
Engineered notification system increasing app engagement by 30%.
Enhanced and optimized intervention resources leading to an increase of two clicks/day/user.
Designed and developed a new app-wide UI with Material UI increasing internal UI rating from 5/10 to 7.5/10. 
Successfully participated in two accelerators Raising $70,000 pre-seed funding.
Collaborated with MIT GameLab on product ideation to produce 4 Interactive product prototypes. 


>EDUCATION
Bachelor of Science Computer Science + Business Minor, Brandeis University  \tMay 2022

>PROJECT WORK
EasyVent - (React,  JSX, Redux)\t2021
A platform aimed at couples/wedding organizers to coordinate between wedding vendors' availability.
Delivered full-stack React application with self-contained, reusable, and testable components.
Created dynamic views changing based on user type with React and JSX decreasing the number of views that need development by 2/3.
Integrated Redux library for state management Increasing behavior consistency across the website.

Gatto - - (Java, Multithreading, Junit, Bash)\t2020
Implemented Unix command-line interface shell with piping and multithreading 
Implemented command piping in Java allowing for complex commands and task automation.
Implemented multithreading with Java threads decreasing time to output by up to 7X.
Developed comprehensive tests using Junit saving hours on code quality assurance.

>LEADERSHIP + AWARDS
Slifka full-ride scholarship, Brandeis University\t2018
BITMAP (computer science club), Brandeis University                                                                                           \t2020
Vice President of Brazilian Jiu-Jitsu Club, Brandeis University\t2020
\t
`;

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

async function generateResumeSuggestions(applicationId, userPrompt = '', existingSuggestions = [], requestType = 'initial') {
  // Retrieve the application details
  const application = await getApplicationById(applicationId, 1); // Replace 1 with actual user ID

  if (!application) {
    throw new Error('Application not found');
  }

  // Retrieve job description from the application
  const jobDescription = application.jobDescription;

  // Retrieve user's resume
  const userResume = HARD_CODED_RESUME; // Replace with actual user's resume

  // Retrieve previous suggestions
  const previousSuggestions = application.resume_suggestions || '';

  // Prepare the conversation messages for OpenAI
  const messages = [
    {
      role: 'system',
      content: `You are an expert in resume optimization.`,
    },
    {
      role: 'user',
      content: `
User's Resume:
${userResume}

Job Description:
${jobDescription}

Suggest specific, one line long honest tweaks to the user's resume to better match the job description. Provide the suggestions in bullet points. 
Keep it to a maximum of 5 suggestions. And write out the example tweak (so don't say "Modify the 'Professional Summary' to include experience with Typescript" type out the modification yourself and give an explaination.  
Remember to maintain the user's honesty and avoid fabricating any information. Again make sure you're doing 5 suggestions and try to keep them to one liners.`,
    },
  ];

  // Include existing suggestions to avoid duplicates
  if (existingSuggestions && existingSuggestions.length > 0) {
    messages.push({
      role: 'assistant',
      content: `Previous Suggestions:\n${existingSuggestions.map((s) => `- ${s}`).join('\n')}`,
    });
  }

  // If there's a user prompt, include it in the conversation
  if (userPrompt) {
    messages.push({
      role: 'user',
      content: userPrompt,
    });
  }

  // Adjust the prompt based on requestType
  let assistantInstruction = '';
  if (requestType === 'single') {
    assistantInstruction = 'Provide one new suggestion that is different from the previous ones. Format the suggestion and reasoning as follows:\n\nSuggestion: [Your suggestion here]\nReasoning: [Your reasoning here]';
  } else {
    assistantInstruction = 'Provide up to 5 suggestions. For each suggestion, format it as follows:\n\nSuggestion: [Your suggestion here]\nReasoning: [Your reasoning here]\n\n';
  }

  messages.push({
    role: 'user',
    content: assistantInstruction,
  });

  // Call the OpenAI API
  const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4',
        messages: messages,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
  );

  const suggestionsText = response.data.choices[0].message.content;

  console.log('OpenAI response:', suggestionsText);

  // Extract suggestions from the response
  const newSuggestions = parseSuggestions(suggestionsText);

  if (requestType === 'single') {
    const newSuggestion = newSuggestions[0];

    // Optionally, you could check for duplicates before adding
    if (!existingSuggestions.includes(newSuggestion)) {
      existingSuggestions.push(newSuggestion);
    }

    // Save the updated suggestions array in the database
    await saveResumeSuggestionsToDatabase(applicationId, existingSuggestions);

    return newSuggestion;
  } else {
    // For initial suggestions, replace existing suggestions
    await saveResumeSuggestionsToDatabase(applicationId, newSuggestions);

    return newSuggestions;
  }
}

function parseSuggestions(suggestionsText) {
  const suggestionBlocks = suggestionsText.split(/\n\n+/).map((block) => block.trim()).filter((block) => block);

  const suggestions = suggestionBlocks.map((block) => {
    const suggestionMatch = block.match(/Suggestion:\s*(.*)/i);
    const reasoningMatch = block.match(/Reasoning:\s*(.*)/i);

    return {
      suggestion: suggestionMatch ? suggestionMatch[1].trim() : '',
      reasoning: reasoningMatch ? reasoningMatch[1].trim() : '',
    };
  });

  return suggestions;
}

async function fetchEmployeesFromFlask(jobLink, titles, pastCompanyNames, distance1, limit) {
  try {
    const response = await axios.post('http://localhost:5000/get_close_employees', {
      job_link: jobLink,
      titles: titles,
      past_company_names: pastCompanyNames,
      distance_1: distance1,
      limit: limit
    });

    return response.data.employees;
    console.log("Tracking response.data.employees:", response.data.employees);
  } catch (error) {
    console.error('Error fetching employees from Flask API:', error.message);
    throw error;
  }
}

app.post('/api/analyze', async (req, res) => {
  const { link, userID, jobDescription: providedJobDescription } = req.body;
  try {
    let jobDescription = providedJobDescription;
    let companyName, jobTitle;

    if (!jobDescription) {
      if (link.includes('linkedin.com/jobs')) {
        const linkedInData = await fetchLinkedInJobDescription(link);
        jobDescription = linkedInData.jobDescription;
        companyName = linkedInData.companyName;
        jobTitle = linkedInData.jobTitle;
      } else {
        jobDescription = await fetchJobDescription(link);
      }
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
    const company = await getOrCreateCompany(companyName);

    if (!company) {
      throw new Error(`Company "${companyName}" could not be found or created.`);
    }

    ////////// Jobs logic ////////////
    const jobData = {
      companyName,
      jobTitle,
      jobDescription,
      jobLink: link,
    };
    const job = await saveJobToDatabase(jobData);

    ////////// Application logic ////////////
    const userId = 1; // Assuming user_id = 1 for now
    const applicationData = {
      userId,
      jobId: job.id,
      dateApplied: new Date().toISOString(),
      status: 'Applied',
      // Add other fields if necessary
    };
    const applicationId = await saveApplicationToDatabase(applicationData);

    ////////// Resume suggestions logic ////////////
    try {
      await generateResumeSuggestions(applicationId, '', [], 'initial');
    } catch (error) {
      console.error('Error generating resume suggestions:', error.message);
      // Decide whether to fail the request or continue
    }

    ////////// Employees logic ////////////
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

    res.json({ companyName, roleTitle: jobTitle, summary: jobDescription, employees: allEmployees, jobDescription, applicationId, });
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'An error occurred while processing your request.' });
  }
});

app.get('/api/jobs', async (req, res) => {
  try {
    const jobs = await getAllJobs(); // Implement this function in your database module
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

app.post('/api/applications', async (req, res) => {
  const applicationData = req.body;
  //TODO: implement actual user logins
  applicationData.userId = 1;

  try {
    //TODO: add fetching employees using the flask service
    // const employees = await fetchEmployeesFromFlask(jobLink, titles, pastCompanyNames, distance1, limit);

    const applicationId = await saveApplicationToDatabase(applicationData);
    res.status(201).json({applicationId});
  } catch (error) {
    res.status(500).json({ error: 'Failed to save application' });
  }
});

app.get('/api/applications', async (req, res) => {
  //TODO: implement actual user logins
  // const userId = req.query.userId; // In a real app, you'd get this from auth middleware
  const userId = 1;

  try {
    const applications = await getApplicationsByUserId(userId);
    res.json(applications);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

app.get('/api/applications/:id', async (req, res) => {
  const applicationId = req.params.id;

  //TODO: implement actual user logins
  //const userId = req.query.userId; // In a real app, you'd get this from auth middleware
  const userId = 1;

  try {
    const application = await getApplicationById(applicationId, userId);
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    // Get target company name
    const job = await getJobById(application.job_id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const company = await getCompanyById(job.company_id);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const targetCompanyName = company.name;

    // Retrieve user's past companies
    const companyNames = await getUserPastCompanies(userId);

    // Find close contacts
    application.close_contacts = await getEmployeesWithMatchingCompanies(targetCompanyName, companyNames);

    // Parse resume_suggestions if it's a JSON string
    if (application.resume_suggestions) {
      try {
        application.resume_suggestions = JSON.parse(application.resume_suggestions);
      } catch (parseError) {
        console.error('Error parsing resume_suggestions:', parseError);
        application.resume_suggestions = [];
      }
    } else {
      application.resume_suggestions = [];
    }

    res.json(application);
  } catch (error) {
    console.error('Error fetching application:', error);
    res.status(500).json({ error: 'Failed to fetch application' });
  }
});

app.post('/api/generate-resume-suggestions', async (req, res) => {
  const { applicationId, userPrompt, existingSuggestions, requestType } = req.body;

  try {
    const suggestion = await generateResumeSuggestions(applicationId, userPrompt, existingSuggestions, requestType);
    res.json({ suggestion });
  } catch (error) {
    console.error('Error generating resume suggestion:', error.message);
    res.status(500).json({ error: 'Failed to generate resume suggestion' });
  }
});

app.post('/api/update-resume-suggestions', async (req, res) => {
  const { applicationId, suggestions } = req.body;

  try {
    await saveResumeSuggestionsToDatabase(applicationId, suggestions);
    res.json({ message: 'Suggestions updated successfully.' });
  } catch (error) {
    console.error('Error updating suggestions:', error.message);
    res.status(500).json({ error: 'Failed to update suggestions.' });
  }
});

app.post('/api/lookup-email-with-jobright', async (req, res) => {
  const { linkedinUrl } = req.body;
  const jobrightCookie = req.headers['jobright-cookie'];

  if (!linkedinUrl || !jobrightCookie) {
    return res.status(400).json({ error: 'LinkedIn URL and Jobright cookie are required.' });
  }

  try {
    // Refactor the LinkedIn URL as needed
    const encodedLinkedinUrl = encodeURIComponent(linkedinUrl);

    // Construct the Jobright API endpoint
    const jobrightEndpoint = `https://jobright.ai/swan/email/linkedin-to-email?url=${encodedLinkedinUrl}`;

    // Make the request to the Jobright API
    const response = await axios.get(jobrightEndpoint, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Cookie': jobrightCookie,
        'Content-Type': 'application/json',
        // Include any other necessary headers
      },
    });

    // Return both the response body and status code from Jobright
    res.json({
      statusCode: response.status,
      data: response.data,
    });
  } catch (error) {
    console.error('Error fetching email from Jobright:', error.message);

    // Check if the error has a response (i.e., the request was made and the server responded with a status code)
    if (error.response) {
      res.status(error.response.status).json({
        error: 'Failed to retrieve email.',
        statusCode: error.response.status,
        data: error.response.data,
      });
    } else {
      // The request was made but no response was received or an error occurred while setting up the request
      res.status(500).json({ error: 'Failed to retrieve email.', details: error.message });
    }
  }
});

app.post('/api/lookup-employees-of-company', async (req, res) =>{
  //Look up company in DB if it's there display employee list
  //Make a call to rocket reach, display first 100-200 employees (return
  // status code 322, frontend should let customer know the list is incomplete and to check back soon)
  //if we don't call rocket reach add a job to queue
  // to scrape that company's data with local library return status 422 to front end
});

app.get('/api/employees/:companyName', async (req, res) => {
  const { companyName } = req.params;
  try {
    const employees = await searchCompanyEmployees(companyName);
    res.json(employees);
  } catch (error) {
    console.error('Error retrieving employees for company:', companyName, error.message);
    res.status(500).json({ error: 'Failed to retrieve employees' });
  }
});

//TODO: check whether we're going to use this endpoint when a user registers or whether we're going to have one endpoint that does all of their analysis
app.post('/api/users/job-history', async (req, res) => {
  //TODO: add actual user ID
  const userId = 1; // Replace with actual user ID from authentication
  const jobHistory = req.body.jobHistory;

  try {
    await insertUserJobHistory(userId, jobHistory);
    res.status(200).json({ message: 'Job history saved successfully.' });
  } catch (error) {
    console.error('Error saving user job history:', error);
    res.status(500).json({ error: 'Failed to save job history.' });
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