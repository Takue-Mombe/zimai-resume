const pdfParser = require('../services/pdfParser');
const aiScorer = require('../services/aiScorer');
const dbQueries = require('../supabase/queries');
const supabase = require('../supabase/client');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class ResumeController { 
  // Process uploaded resume
  async processResume(req, res) {
    const startTime = Date.now();
    let resumeId = null;

    try {
      const { companyId } = req.params;
      const file = req.file;

      // Validate company access
      if (req.user.company.id !== companyId) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Cannot process resumes for different company'
        });
      }

      // Check token availability
      if (req.user.company.tokens_remaining <= 0) {
        return res.status(402).json({
          error: 'Insufficient tokens',
          message: 'No tokens remaining for resume processing'
        });
      }

      logger.info('Starting resume processing:', {
        filename: file.originalname,
        size: file.size,
        companyId
      });

      // Validate PDF
      const pdfValidation = await pdfParser.validatePDF(file.buffer);
      if (!pdfValidation.isValid) {
        return res.status(400).json({
          error: 'Invalid PDF',
          message: pdfValidation.error
        });
      }

      // Upload to Supabase Storage
      const fileName = `${companyId}/${uuidv4()}.pdf`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('resumes')
        .upload(fileName, file.buffer, {
          contentType: 'application/pdf',
          upsert: false
        });

      if (uploadError) {
        throw new Error(`File upload failed: ${uploadError.message}`);
      }

      // Create resume record in database
      const { data: resumeData, error: dbError } = await supabase
        .from('resumes')
        .insert({
          company_id: companyId,
          filename: file.originalname,
          file_path: uploadData.path,
          file_size: file.size,
          status: 'processing'
        })
        .select()
        .single();

      if (dbError) {
        throw new Error(`Database error: ${dbError.message}`);
      }

      resumeId = resumeData.id;

      // Extract text from PDF
      const extractedData = await pdfParser.extractText(file.buffer, file.originalname);
      const basicInfo = await pdfParser.extractBasicInfo(extractedData.text);

      // Get job requirements for scoring
      const jobRequirements = await dbQueries.getJobRequirements(companyId);

      // Score resume with AI
      const scoringResult = await aiScorer.scoreResume(
        extractedData.text,
        jobRequirements,
        basicInfo
      );

      // Update resume with scoring results
      const updatedResume = await dbQueries.updateResumeScore(resumeId, scoringResult);

      // Deduct token and log usage
      await dbQueries.decrementCompanyTokens(companyId);
      await dbQueries.logTokenUsage(companyId, resumeId, 1, 'resume_processing');

      // Log analytics event
      await dbQueries.logAnalyticsEvent(companyId, 'resume_processed', {
        resumeId,
        score: scoringResult.overallScore,
        processingTime: Date.now() - startTime,
        tokensUsed: scoringResult.tokensUsed || 1
      });

      const processingTime = Date.now() - startTime;
      logger.logPerformance('resume_processing', processingTime, {
        resumeId,
        companyId,
        score: scoringResult.overallScore
      });

      res.status(200).json({
        success: true,
        message: 'Resume processed successfully',
        data: {
          resumeId: updatedResume.id,
          filename: updatedResume.filename,
          score: updatedResume.score,
          status: updatedResume.status,
          candidateName: updatedResume.candidate_name,
          summary: updatedResume.ai_summary,
          processingTime: `${processingTime}ms`,
          tokensRemaining: req.user.company.tokens_remaining - 1
        }
      });

    } catch (error) {
      logger.logError(error, req, { resumeId, companyId: req.params.companyId });

      // Update resume status to failed if it was created
      if (resumeId) {
        try {
          await dbQueries.updateResumeStatus(resumeId, 'failed', error.message);
        } catch (updateError) {
          logger.error('Failed to update resume status:', updateError);
        }
      }

      res.status(500).json({
        error: 'Processing failed',
        message: process.env.NODE_ENV === 'production' 
          ? 'Failed to process resume' 
          : error.message
      });
    }
  }

  // Get resume details
  async getResume(req, res) {
    try {
      const { resumeId } = req.params;
      const companyId = req.user.company.id;

      const resume = await dbQueries.getResumeById(resumeId);

      if (!resume) {
        return res.status(404).json({
          error: 'Resume not found',
          message: 'No resume found with the provided ID'
        });
      }

      if (resume.company_id !== companyId) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Cannot access resume from different company'
        });
      }

      res.status(200).json({
        success: true,
        data: resume
      });

    } catch (error) {
      logger.logError(error, req);
      res.status(500).json({
        error: 'Failed to retrieve resume',
        message: error.message
      });
    }
  }

  // Get company resumes with pagination
  async getCompanyResumes(req, res) {
    try {
      const companyId = req.user.company.id;
      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const offset = (page - 1) * limit;

      const resumes = await dbQueries.getResumesByCompany(companyId, limit, offset);

      // Get total count for pagination
      const { count: totalCount } = await supabase
        .from('resumes')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyId);

      const totalPages = Math.ceil(totalCount / limit);

      res.status(200).json({
        success: true,
        data: {
          resumes,
          pagination: {
            currentPage: page,
            totalPages,
            totalItems: totalCount,
            itemsPerPage: limit,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1
          }
        }
      });

    } catch (error) {
      logger.logError(error, req);
      res.status(500).json({
        error: 'Failed to retrieve resumes',
        message: error.message
      });
    }
  }

  // Batch process resumes
  async batchProcess(req, res) {
    try {
      const { resumeIds } = req.body;
      const companyId = req.user.company.id;

      if (!Array.isArray(resumeIds) || resumeIds.length === 0) {
        return res.status(400).json({
          error: 'Invalid input',
          message: 'Resume IDs array is required'
        });
      }

      if (resumeIds.length > 10) {
        return res.status(400).json({
          error: 'Too many resumes',
          message: 'Maximum 10 resumes can be processed at once'
        });
      }

      // Check token availability
      if (req.user.company.tokens_remaining < resumeIds.length) {
        return res.status(402).json({
          error: 'Insufficient tokens',
          message: `Need ${resumeIds.length} tokens, but only ${req.user.company.tokens_remaining} available`
        });
      }

      const results = [];
      const jobRequirements = await dbQueries.getJobRequirements(companyId);

      for (const resumeId of resumeIds) {
        try {
          const resume = await dbQueries.getResumeById(resumeId);
          
          if (!resume || resume.company_id !== companyId) {
            results.push({
              resumeId,
              success: false,
              error: 'Resume not found or access denied'
            });
            continue;
          }

          if (resume.status === 'processed') {
            results.push({
              resumeId,
              success: true,
              message: 'Already processed',
              score: resume.score
            });
            continue;
          }

          // Download and process resume
          const { data: fileData } = await supabase.storage
            .from('resumes')
            .download(resume.file_path);

          const buffer = await fileData.arrayBuffer();
          const extractedData = await pdfParser.extractText(Buffer.from(buffer), resume.filename);
          const basicInfo = await pdfParser.extractBasicInfo(extractedData.text);

          const scoringResult = await aiScorer.scoreResume(
            extractedData.text,
            jobRequirements,
            basicInfo
          );

          await dbQueries.updateResumeScore(resumeId, scoringResult);
          await dbQueries.decrementCompanyTokens(companyId);

          results.push({
            resumeId,
            success: true,
            score: scoringResult.overallScore,
            summary: scoringResult.summary
          });

          // Small delay to avoid overwhelming the AI service
          await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
          logger.error(`Batch processing failed for resume ${resumeId}:`, error);
          results.push({
            resumeId,
            success: false,
            error: error.message
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      
      res.status(200).json({
        success: true,
        message: `Processed ${successCount} out of ${resumeIds.length} resumes`,
        data: {
          results,
          summary: {
            total: resumeIds.length,
            successful: successCount,
            failed: resumeIds.length - successCount
          }
        }
      });

    } catch (error) {
      logger.logError(error, req);
      res.status(500).json({
        error: 'Batch processing failed',
        message: error.message
      });
    }
  }

  // Delete resume
  async deleteResume(req, res) {
    try {
      const { resumeId } = req.params;
      const companyId = req.user.company.id;

      const resume = await dbQueries.getResumeById(resumeId);

      if (!resume) {
        return res.status(404).json({
          error: 'Resume not found',
          message: 'No resume found with the provided ID'
        });
      }

      if (resume.company_id !== companyId) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Cannot delete resume from different company'
        });
      }

      // Delete file from storage
      const { error: storageError } = await supabase.storage
        .from('resumes')
        .remove([resume.file_path]);

      if (storageError) {
        logger.warn('Failed to delete file from storage:', storageError);
      }

      // Delete from database
      const { error: dbError } = await supabase
        .from('resumes')
        .delete()
        .eq('id', resumeId);

      if (dbError) {
        throw new Error(`Database deletion failed: ${dbError.message}`);
      }

      // Log analytics event
      await dbQueries.logAnalyticsEvent(companyId, 'resume_deleted', {
        resumeId,
        filename: resume.filename
      });

      res.status(200).json({
        success: true,
        message: 'Resume deleted successfully'
      });

    } catch (error) {
      logger.logError(error, req);
      res.status(500).json({
        error: 'Failed to delete resume',
        message: error.message
      });
    }
  }

  // Get resume analytics
  async getAnalytics(req, res) {
    try {
      const companyId = req.user.company.id;
      const { startDate, endDate } = req.query;

      const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate) : new Date();

      const analytics = await dbQueries.getCompanyAnalytics(companyId, start, end);

      res.status(200).json({
        success: true,
        data: analytics,
        dateRange: {
          start: start.toISOString(),
          end: end.toISOString()
        }
      });

    } catch (error) {
      logger.logError(error, req);
      res.status(500).json({
        error: 'Failed to retrieve analytics',
        message: error.message
      });
    }
  }
}

module.exports = new ResumeController();