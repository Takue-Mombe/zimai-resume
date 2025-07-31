/**
 * Text sanitization utilities for cleaning extracted resume text
 */

function sanitizeText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  let cleaned = text;

  // Remove excessive whitespace and normalize line breaks
  cleaned = cleaned.replace(/\r\n/g, '\n');
  cleaned = cleaned.replace(/\r/g, '\n');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.replace(/[ \t]{2,}/g, ' ');

  // Remove common PDF artifacts
  cleaned = cleaned.replace(/\f/g, ''); // Form feed characters
  cleaned = cleaned.replace(/\u00A0/g, ' '); // Non-breaking spaces
  cleaned = cleaned.replace(/\u2022/g, '•'); // Normalize bullet points
  cleaned = cleaned.replace(/\u2013/g, '-'); // En dash to hyphen
  cleaned = cleaned.replace(/\u2014/g, '--'); // Em dash

  // Remove or normalize special characters that might interfere with AI processing
  cleaned = cleaned.replace(/[""]/g, '"'); // Normalize quotes
  cleaned = cleaned.replace(/['']/g, "'"); // Normalize apostrophes
  cleaned = cleaned.replace(/…/g, '...'); // Normalize ellipsis

  // Remove excessive punctuation
  cleaned = cleaned.replace(/\.{4,}/g, '...');
  cleaned = cleaned.replace(/-{3,}/g, '--');
  cleaned = cleaned.replace(/_{3,}/g, '__');

  // Clean up common resume formatting artifacts
  cleaned = cleaned.replace(/^\s*Page \d+ of \d+\s*$/gm, ''); // Page numbers
  cleaned = cleaned.replace(/^\s*\d+\s*$/gm, ''); // Standalone numbers (likely page numbers)
  
  // Remove email signatures and footers that might appear in PDFs
  cleaned = cleaned.replace(/Confidential and Proprietary[\s\S]*$/gm, '');
  cleaned = cleaned.replace(/This email and any attachments[\s\S]*$/gm, '');

  // Final cleanup
  cleaned = cleaned.trim();
  cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n'); // Remove triple+ line breaks

  return cleaned;
}

function extractKeywords(text, commonKeywords = []) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const textLower = text.toLowerCase();
  const foundKeywords = [];

  // Default tech keywords if none provided
  const defaultKeywords = [
    'javascript', 'python', 'java', 'react', 'node.js', 'sql', 'html', 'css',
    'git', 'aws', 'docker', 'kubernetes', 'mongodb', 'postgresql', 'redis',
    'typescript', 'angular', 'vue', 'express', 'django', 'flask', 'spring',
    'microservices', 'api', 'rest', 'graphql', 'agile', 'scrum', 'devops'
  ];

  const keywordsToCheck = commonKeywords.length > 0 ? commonKeywords : defaultKeywords;

  for (const keyword of keywordsToCheck) {
    const keywordLower = keyword.toLowerCase();
    const regex = new RegExp(`\\b${keywordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    
    if (regex.test(textLower)) {
      foundKeywords.push(keyword);
    }
  }

  return [...new Set(foundKeywords)]; // Remove duplicates
}

function extractSections(text) {
  if (!text || typeof text !== 'string') {
    return {};
  }

  const sections = {};
  const lines = text.split('\n');
  let currentSection = 'header';
  let currentContent = [];

  // Common section headers
  const sectionPatterns = {
    experience: /^(experience|work\s+experience|employment|professional\s+experience|career)/i,
    education: /^(education|academic|qualifications|schooling)/i,
    skills: /^(skills|technical\s+skills|competencies|technologies|expertise)/i,
    projects: /^(projects|portfolio|work\s+samples)/i,
    certifications: /^(certifications?|licenses?|credentials)/i,
    summary: /^(summary|profile|objective|about|introduction)/i,
    contact: /^(contact|personal\s+information)/i
  };

  for (const line of lines) {
    const trimmedLine = line.trim();
    
    if (trimmedLine.length === 0) {
      currentContent.push('');
      continue;
    }

    // Check if this line is a section header
    let foundSection = null;
    for (const [sectionName, pattern] of Object.entries(sectionPatterns)) {
      if (pattern.test(trimmedLine)) {
        foundSection = sectionName;
        break;
      }
    }

    if (foundSection) {
      // Save previous section
      if (currentContent.length > 0) {
        sections[currentSection] = currentContent.join('\n').trim();
      }
      
      // Start new section
      currentSection = foundSection;
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  // Save the last section
  if (currentContent.length > 0) {
    sections[currentSection] = currentContent.join('\n').trim();
  }

  return sections;
}

function normalizeCompanyNames(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }

  // Common company suffix normalizations
  const suffixMap = {
    'inc.': 'Inc',
    'llc': 'LLC',
    'corp.': 'Corp',
    'ltd.': 'Ltd',
    'co.': 'Co.',
    'company': 'Company',
    'corporation': 'Corporation',
    'incorporated': 'Inc',
    'limited': 'Ltd'
  };

  let normalized = text;
  
  for (const [oldSuffix, newSuffix] of Object.entries(suffixMap)) {
    const regex = new RegExp(`\\b${oldSuffix}\\b`, 'gi');
    normalized = normalized.replace(regex, newSuffix);
  }

  return normalized;
}

function validateTextQuality(text) {
  if (!text || typeof text !== 'string') {
    return { isValid: false, issues: ['No text provided'] };
  }

  const issues = [];
  const warnings = [];

  // Check minimum length
  if (text.length < 100) {
    issues.push('Text too short (less than 100 characters)');
  }

  // Check for too much repetition (might indicate OCR errors)
  const words = text.toLowerCase().split(/\s+/);
  const wordCount = {};
  for (const word of words) {
    if (word.length > 3) {
      wordCount[word] = (wordCount[word] || 0) + 1;
    }
  }

  const totalWords = words.length;
  const uniqueWords = Object.keys(wordCount).length;
  const vocabularyRatio = uniqueWords / totalWords;

  if (vocabularyRatio < 0.3) {
    warnings.push('High repetition detected - possible OCR issues');
  }

  // Check for excessive special characters (OCR artifacts)
  const specialChars = text.match(/[^\w\s.,!?;:()\-"']/g) || [];
  const specialCharRatio = specialChars.length / text.length;

  if (specialCharRatio > 0.1) {
    warnings.push('High number of special characters - possible extraction issues');
  }

  // Check for reasonable sentence structure
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const avgWordsPerSentence = totalWords / sentences.length;

  if (avgWordsPerSentence < 3) {
    warnings.push('Very short sentences - possible formatting issues');
  } else if (avgWordsPerSentence > 50) {
    warnings.push('Very long sentences - possible missing punctuation');
  }

  return {
    isValid: issues.length === 0,
    issues,
    warnings,
    stats: {
      length: text.length,
      wordCount: totalWords,
      uniqueWords,
      vocabularyRatio,
      specialCharRatio,
      avgWordsPerSentence
    }
  };
}

module.exports = {
  sanitizeText,
  extractKeywords,
  extractSections,
  normalizeCompanyNames,
  validateTextQuality
};