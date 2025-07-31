const supabase = require('./client');
const logger = require('../utils/logger');

class DatabaseQueries {
  // Resume operations
  async getResumeById(resumeId) {
    try {
      const { data, error } = await supabase
        .from('resumes')
        .select('*')
        .eq('id', resumeId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error fetching resume:', error);
      throw error;
    }
  }

  async updateResumeScore(resumeId, scoreData) {
    try {
      const { data, error } = await supabase
        .from('resumes')
        .update({
          score: scoreData.overallScore,
          ai_summary: scoreData.summary,
          keywords_matched: scoreData.keywordsMatched,
          experience_years: scoreData.experienceYears,
          candidate_name: scoreData.candidateName,
          status: 'processed',
          processed_at: new Date().toISOString()
        })
        .eq('id', resumeId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error updating resume score:', error);
      throw error;
    }
  }

  async updateResumeStatus(resumeId, status, errorMessage = null) {
    try {
      const updateData = { 
        status,
        processed_at: new Date().toISOString()
      };
      
      if (errorMessage) {
        updateData.error_message = errorMessage;
      }

      const { data, error } = await supabase
        .from('resumes')
        .update(updateData)
        .eq('id', resumeId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error updating resume status:', error);
      throw error;
    }
  }

  // Company operations
  async getCompanyById(companyId) {
    try {
      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .eq('id', companyId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error fetching company:', error);
      throw error;
    }
  }

  async decrementCompanyTokens(companyId) {
    try {
      const { data, error } = await supabase.rpc('decrement_token', {
        company_id: companyId
      });

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error decrementing tokens:', error);
      throw error;
    }
  }

  // Job requirements
  async getJobRequirements(companyId) {
    try {
      const { data, error } = await supabase
        .from('job_requirements')
        .select('*')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data || null;
    } catch (error) {
      logger.error('Error fetching job requirements:', error);
      throw error;
    }
  }

  // Analytics operations
  async logAnalyticsEvent(companyId, eventType, eventData) {
    try {
      const { data, error } = await supabase
        .from('analytics_events')
        .insert({
          company_id: companyId,
          event_type: eventType,
          event_data: eventData,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error logging analytics event:', error);
      throw error;
    }
  }

  async getCompanyAnalytics(companyId, startDate, endDate) {
    try {
      const { data, error } = await supabase.rpc('get_company_analytics', {
        company_id: companyId,
        start_date: startDate,
        end_date: endDate
      });

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error fetching company analytics:', error);
      throw error;
    }
  }

  // Token usage tracking
  async logTokenUsage(companyId, resumeId, tokensUsed, operation) {
    try {
      const { data, error } = await supabase
        .from('token_usage')
        .insert({
          company_id: companyId,
          resume_id: resumeId,
          tokens_used: tokensUsed,
          operation: operation,
          timestamp: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error logging token usage:', error);
      throw error;
    }
  }

  // Batch operations
  async getResumesByCompany(companyId, limit = 50, offset = 0) {
    try {
      const { data, error } = await supabase
        .from('resumes')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;
      return data || [];
    } catch (error) {
      logger.error('Error fetching company resumes:', error);
      throw error;
    }
  }

  async getResumesForProcessing(limit = 10) {
    try {
      const { data, error } = await supabase
        .from('resumes')
        .select('*')
        .eq('status', 'uploaded')
        .order('created_at', { ascending: true })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      logger.error('Error fetching resumes for processing:', error);
      throw error;
    }
  }
}

module.exports = new DatabaseQueries();