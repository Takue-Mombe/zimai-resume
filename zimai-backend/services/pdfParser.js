const pdf = require('pdf-parse');
const logger = require('../utils/logger');
const { sanitizeText } = require('../utils/sanitizeText');

class PDFParser {
  async extractText(buffer, filename) {
    try {
      logger.info('Starting PDF text extraction:', { filename });

      // Parse PDF using pdf-parse
      const pdfData = await pdf(buffer, {
        // PDF parsing options
        max: 0, // Parse all pages
        version: 'v1.10.100', // Specify PDF.js version for consistency
      });

      const rawText = pdfData.text;
      
      if (!rawText || rawText.trim().length === 0) {
        throw new Error('No text content found in PDF');
      }

      // Sanitize and clean the extracted text
      const cleanText = sanitizeText(rawText);

      const extractedData = {
        text: cleanText,
        rawText: rawText,
        metadata: {
          pages: pdfData.numpages,
          info: pdfData.info || {},
          version: pdfData.version,
          wordCount: cleanText.split(/\s+/).length,
          charCount: cleanText.length
        }
      };

      logger.info('PDF text extraction completed:', {
        filename,
        pages: extractedData.metadata.pages,
        wordCount: extractedData.metadata.wordCount,
        charCount: extractedData.metadata.charCount
      });

      return extractedData;

    } catch (error) {
      logger.error('PDF text extraction failed:', {
        filename,
        error: error.message,
        stack: error.stack
      });

      // Provide specific error messages for common issues
      if (error.message.includes('Invalid PDF')) {
        throw new Error('Invalid PDF file format');
      } else if (error.message.includes('encrypted')) {
        throw new Error('PDF is password protected or encrypted');
      } else if (error.message.includes('No text content')) {
        throw new Error('PDF contains no readable text content');
      } else {
        throw new Error(`Failed to extract text from PDF: ${error.message}`);
      }
    }
  }

  async extractBasicInfo(text) {
    try {
      const basicInfo = {
        candidateName: null,
        email: null,
        phone: null,
        location: null
      };

      // Extract email addresses
      const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
      const emails = text.match(emailRegex);
      if (emails && emails.length > 0) {
        basicInfo.email = emails[0]; // Take the first email found
      }

      // Extract phone numbers (various formats)
      const phoneRegex = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
      const phones = text.match(phoneRegex);
      if (phones && phones.length > 0) {
        basicInfo.phone = phones[0].replace(/\s+/g, ' ').trim();
      }

      // Extract candidate name (usually at the beginning of resume)
      const lines = text.split('\n').filter(line => line.trim().length > 0);
      const firstFewLines = lines.slice(0, 5);
      
      for (const line of firstFewLines) {
        const trimmedLine = line.trim();
        // Skip common headers and look for name-like patterns
        if (trimmedLine.length > 3 && 
            trimmedLine.length < 50 && 
            !trimmedLine.includes('@') && 
            !trimmedLine.match(/\d{3,}/) &&
            !/(resume|cv|curriculum|vitae)/i.test(trimmedLine)) {
          
          // Check if it looks like a name (2-4 words, mostly letters)
          const words = trimmedLine.split(/\s+/);
          if (words.length >= 2 && words.length <= 4) {
            const isNameLike = words.every(word => 
              /^[A-Za-z][A-Za-z'.-]*$/.test(word) && word.length > 1
            );
            if (isNameLike) {
              basicInfo.candidateName = trimmedLine;
              break;
            }
          }
        }
      }

      // Extract location (look for city, state patterns)
      const locationRegex = /([A-Z][a-z]+,?\s*[A-Z]{2})|([A-Z][a-z]+\s*,\s*[A-Z][a-z]+)/g;
      const locations = text.match(locationRegex);
      if (locations && locations.length > 0) {
        basicInfo.location = locations[0];
      }

      return basicInfo;

    } catch (error) {
      logger.error('Error extracting basic info:', error);
      return {
        candidateName: null,
        email: null,
        phone: null,
        location: null
      };
    }
  }

  async extractSkills(text) {
    try {
      const commonSkills = [
        // Programming Languages
        'javascript', 'python', 'java', 'c++', 'c#', 'php', 'ruby', 'go', 'rust', 'swift',
        'kotlin', 'typescript', 'scala', 'r', 'matlab', 'sql', 'html', 'css',
        
        // Frameworks & Libraries
        'react', 'angular', 'vue', 'node.js', 'express', 'django', 'flask', 'spring',
        'laravel', 'rails', 'asp.net', 'jquery', 'bootstrap', 'tailwind',
        
        // Databases
        'mysql', 'postgresql', 'mongodb', 'redis', 'elasticsearch', 'oracle', 'sqlite',
        
        // Cloud & DevOps
        'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'jenkins', 'git', 'ci/cd',
        
        // Tools & Technologies
        'linux', 'windows', 'macos', 'nginx', 'apache', 'microservices', 'api',
        'restful', 'graphql', 'websockets', 'tcp/ip',
        
        // Soft Skills
        'leadership', 'communication', 'teamwork', 'problem solving', 'analytical',
        'project management', 'agile', 'scrum', 'kanban'
      ];

      const foundSkills = [];
      const textLower = text.toLowerCase();

      for (const skill of commonSkills) {
        const skillRegex = new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        if (skillRegex.test(textLower)) {
          foundSkills.push(skill);
        }
      }

      const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
      const emails = text.match(emailRegex);
      if (emails && emails.length > 0) {
        foundSkills.push(...emails);
      }

      return [...new Set(foundSkills)]; // Remove duplicates

    } catch (error) {
      logger.error('Error extracting skills:', error);
      return [];
    }
  }

  async extractExperience(text) {
    try {
      const experienceInfo = {
        totalYears: 0,
        companies: [],
        positions: []
      };

      // Look for experience indicators
      const experiencePatterns = [
        /(\d+)\+?\s*years?\s*(?:of\s*)?experience/gi,
        /experience[:\s]*(\d+)\+?\s*years?/gi,
        /(\d+)\+?\s*years?\s*in/gi
      ];

      let maxYears = 0;
      for (const pattern of experiencePatterns) {
        const matches = text.match(pattern);
        if (matches) {
          for (const match of matches) {
            const years = parseInt(match.match(/\d+/)[0]);
            if (years > maxYears) {
              maxYears = years;
            }
          }
        }
      }

      experienceInfo.totalYears = maxYears;

      // Extract company names (basic pattern matching)
      const companyPatterns = [
        /at\s+([A-Z][A-Za-z\s&.,-]+(?:Inc|LLC|Corp|Ltd|Company|Co\.|Technologies|Tech|Solutions|Systems|Group))/gi,
        /([A-Z][A-Za-z\s&.,-]+(?:Inc|LLC|Corp|Ltd|Company|Co\.|Technologies|Tech|Solutions|Systems|Group))/gi
      ];

      const companies = new Set();
      for (const pattern of companyPatterns) {
        const matches = text.match(pattern);
        if (matches) {
          matches.forEach(match => {
            const company = match.replace(/^at\s+/i, '').trim();
            if (company.length > 3 && company.length < 100) {
              companies.add(company);
            }
          });
        }
      }

      experienceInfo.companies = Array.from(companies).slice(0, 10); // Limit to 10

      return experienceInfo;

    } catch (error) {
      logger.error('Error extracting experience:', error);
      return {
        totalYears: 0,
        companies: [],
        positions: []
      };
    }
  }

  async validatePDF(buffer) {
    try {
      // Check PDF signature
      const pdfSignature = buffer.slice(0, 4).toString();
      if (pdfSignature !== '%PDF') {
        return { isValid: false, error: 'Invalid PDF signature' };
      }

      // Check minimum file size
      if (buffer.length < 1024) {
        return { isValid: false, error: 'File too small to be a valid PDF' };
      }

      // Try to parse to ensure it's not corrupted
      await pdf(buffer, { max: 1 }); // Parse just first page for validation

      return { isValid: true };

    } catch (error) {
      return { 
        isValid: false, 
        error: `PDF validation failed: ${error.message}` 
      };
    }
  }
}

module.exports = new PDFParser();