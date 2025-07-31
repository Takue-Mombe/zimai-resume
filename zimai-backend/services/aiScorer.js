const OpenAI = require('openai');
const logger = require('../utils/logger');
const dbQueries = require('../supabase/queries');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

class AIScorer {
  constructor() {
    this.model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    this.maxTokens = 2000;
  }

  async scoreResume(resumeText, jobRequirements, basicInfo) {
    try {
      logger.info('Starting AI resume scoring');

      const prompt = this.buildScoringPrompt(resumeText, jobRequirements, basicInfo);
      
      const completion = await openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert HR professional and resume reviewer. Analyze resumes objectively and provide detailed, actionable feedback.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: this.maxTokens,
        temperature: 0.3, // Lower temperature for more consistent scoring
        response_format: { type: 'json_object' }
      });

      const responseText = completion.choices[0].message.content;
      const aiResponse = JSON.parse(responseText);

      // Validate and structure the response
      const scoringResult = this.processAIResponse(aiResponse, basicInfo);

      logger.info('AI resume scoring completed:', {
        overallScore: scoringResult.overallScore,
        tokensUsed: completion.usage.total_tokens
      });

      return {
        ...scoringResult,
        tokensUsed: completion.usage.total_tokens
      };

    } catch (error) {
      logger.error('AI scoring failed:', error);
      throw new Error(`AI scoring failed: ${error.message}`);
    }
  }

  buildScoringPrompt(resumeText, jobRequirements, basicInfo) {
    const jobReqText = jobRequirements ? `
JOB REQUIREMENTS:
Title: ${jobRequirements.title || 'Not specified'}
Required Skills: ${jobRequirements.required_skills || 'Not specified'}
Experience Level: ${jobRequirements.experience_level || 'Not specified'}
Education: ${jobRequirements.education_requirements || 'Not specified'}
Keywords: ${jobRequirements.keywords || 'Not specified'}
Description: ${jobRequirements.description || 'Not specified'}
` : 'No specific job requirements provided - evaluate generally.';

    return `
Please analyze this resume and provide a comprehensive scoring based on the job requirements.

${jobReqText}

RESUME TEXT:
${resumeText}

CANDIDATE BASIC INFO:
Name: ${basicInfo.candidateName || 'Not extracted'}
Email: ${basicInfo.email || 'Not found'}
Phone: ${basicInfo.phone || 'Not found'}
Location: ${basicInfo.location || 'Not found'}

Please provide your analysis in the following JSON format:
{
  "overallScore": 85,
  "breakdown": {
    "skills": 80,
    "experience": 90,
    "education": 75,
    "relevance": 85
  },
  "strengths": [
    "Strong technical skills in required technologies",
    "Relevant industry experience"
  ],
  "weaknesses": [
    "Missing specific certification",
    "Limited leadership experience"
  ],
  "keywordMatches": [
    "JavaScript",
    "React",
    "Node.js"
  ],
  "experienceYears": 5,
  "summary": "Strong candidate with relevant technical skills and good experience. Some gaps in leadership and certifications.",
  "recommendations": [
    "Consider for technical interview",
    "Ask about leadership experience during interview"
  ],
  "redFlags": [],
  "fitScore": 85
}

SCORING CRITERIA:
- Overall Score: 0-100 (weighted average of all factors)
- Skills: How well candidate's skills match job requirements (0-100)
- Experience: Relevance and depth of work experience (0-100)
- Education: Educational background relevance (0-100)
- Relevance: Overall fit for the specific role (0-100)
- Experience Years: Estimated total years of relevant experience
- Keyword Matches: List of job-relevant keywords found in resume
- Red Flags: Any concerning elements (employment gaps, job hopping, etc.)

Be objective, fair, and provide actionable insights for hiring decisions.
`;
  }

  processAIResponse(aiResponse, basicInfo) {
    try {
      // Ensure all required fields are present with defaults
      const processed = {
        overallScore: Math.min(100, Math.max(0, aiResponse.overallScore || 0)),
        breakdown: {
          skills: Math.min(100, Math.max(0, aiResponse.breakdown?.skills || 0)),
          experience: Math.min(100, Math.max(0, aiResponse.breakdown?.experience || 0)),
          education: Math.min(100, Math.max(0, aiResponse.breakdown?.education || 0)),
          relevance: Math.min(100, Math.max(0, aiResponse.breakdown?.relevance || 0))
        },
        strengths: Array.isArray(aiResponse.strengths) ? aiResponse.strengths.slice(0, 10) : [],
        weaknesses: Array.isArray(aiResponse.weaknesses) ? aiResponse.weaknesses.slice(0, 10) : [],
        keywordMatches: Array.isArray(aiResponse.keywordMatches) ? aiResponse.keywordMatches.slice(0, 20) : [],
        experienceYears: Math.max(0, aiResponse.experienceYears || 0),
        summary: aiResponse.summary || 'Resume analyzed successfully.',
        recommendations: Array.isArray(aiResponse.recommendations) ? aiResponse.recommendations.slice(0, 5) : [],
        redFlags: Array.isArray(aiResponse.redFlags) ? aiResponse.redFlags.slice(0, 5) : [],
        fitScore: Math.min(100, Math.max(0, aiResponse.fitScore || aiResponse.overallScore || 0)),
        candidateName: basicInfo.candidateName,
        keywordsMatched: aiResponse.keywordMatches?.length || 0
      };

      return processed;

    } catch (error) {
      logger.error('Error processing AI response:', error);
      
      // Return fallback response
      return {
        overallScore: 50,
        breakdown: { skills: 50, experience: 50, education: 50, relevance: 50 },
        strengths: ['Resume processed'],
        weaknesses: ['Unable to complete full analysis'],
        keywordMatches: [],
        experienceYears: 0,
        summary: 'Basic analysis completed with limited AI processing.',
        recommendations: ['Manual review recommended'],
        redFlags: [],
        fitScore: 50,
        candidateName: basicInfo.candidateName,
        keywordsMatched: 0
      };
    }
  }

  async batchScoreResumes(resumes, jobRequirements) {
    const results = [];
    
    for (const resume of resumes) {
      try {
        const result = await this.scoreResume(
          resume.extractedText, 
          jobRequirements, 
          resume.basicInfo
        );
        
        results.push({
          resumeId: resume.id,
          success: true,
          ...result
        });

        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        logger.error(`Batch scoring failed for resume ${resume.id}:`, error);
        results.push({
          resumeId: resume.id,
          success: false,
          error: error.message,
          overallScore: 0,
          summary: 'Scoring failed'
        });
      }
    }

    return results;
  }

  async analyzeJobDescription(jobDescription) {
    try {
      logger.info('Analyzing job description with AI');

      const prompt = `
Analyze this job description and extract key requirements in JSON format:

JOB DESCRIPTION:
${jobDescription}

Please provide analysis in this JSON format:
{
  "title": "Software Engineer",
  "requiredSkills": ["JavaScript", "React", "Node.js"],
  "preferredSkills": ["Python", "AWS", "Docker"],
  "experienceLevel": "3-5 years",
  "educationRequirements": "Bachelor's degree in Computer Science or related field",
  "keywords": ["JavaScript", "React", "Node.js", "API", "Database"],
  "responsibilities": ["Develop web applications", "Collaborate with team"],
  "industry": "Technology",
  "location": "Remote",
  "salaryRange": "80k-120k",
  "benefits": ["Health insurance", "401k"]
}

Extract only what's clearly stated in the job description. Use "Not specified" for missing information.
`;

      const completion = await openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert at analyzing job descriptions and extracting structured requirements.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 1000,
        temperature: 0.2,
        response_format: { type: 'json_object' }
      });

      const analysis = JSON.parse(completion.choices[0].message.content);
      
      logger.info('Job description analysis completed');
      
      return {
        ...analysis,
        tokensUsed: completion.usage.total_tokens
      };

    } catch (error) {
      logger.error('Job description analysis failed:', error);
      throw new Error(`Job analysis failed: ${error.message}`);
    }
  }

  async generateInsights(companyId, timeframe = '30d') {
    try {
      // Get recent scoring data from database
      const analyticsData = await dbQueries.getCompanyAnalytics(
        companyId,
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        new Date()
      );

      if (!analyticsData || analyticsData.length === 0) {
        return {
          insights: ['No recent data available for analysis'],
          trends: [],
          recommendations: ['Upload more resumes to generate insights']
        };
      }

      const prompt = `
Analyze this resume screening data and provide insights:

ANALYTICS DATA:
${JSON.stringify(analyticsData, null, 2)}

Please provide insights in this JSON format:
{
  "insights": [
    "Average score has improved by 15% this month",
    "Most candidates lack required Python skills"
  ],
  "trends": [
    "Increasing number of senior-level candidates",
    "Skills gap in cloud technologies"
  ],
  "recommendations": [
    "Consider expanding search criteria",
    "Focus recruiting on specific universities"
  ]
}

Focus on actionable insights for hiring decisions.
`;

      const completion = await openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert HR analyst providing actionable recruiting insights.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 800,
        temperature: 0.4,
        response_format: { type: 'json_object' }
      });

      const insights = JSON.parse(completion.choices[0].message.content);
      
      return {
        ...insights,
        generatedAt: new Date().toISOString(),
        timeframe: timeframe
      };

    } catch (error) {
      logger.error('Insights generation failed:', error);
      return {
        insights: ['Unable to generate insights at this time'],
        trends: [],
        recommendations: ['Please try again later']
      };
    }
  }
}

module.exports = new AIScorer();