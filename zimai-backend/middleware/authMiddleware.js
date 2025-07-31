const supabase = require('../supabase/client');
const logger = require('../utils/logger');

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'No valid authorization header found'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify the JWT token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      logger.warn('Authentication failed:', { error: error?.message });
      return res.status(401).json({
        error: 'Invalid token',
        message: 'Authentication failed'
      });
    }

    // Get user's company information
    try {
      const { data: userMetadata, error: metadataError } = await supabase
        .from('user_metadata')
        .select(`
          company_id,
          role,
          companies (
            id,
            name,
            code,
            tokens_remaining,
            is_active
          )
        `)
        .eq('user_id', user.id)
        .single();

      if (metadataError || !userMetadata || !userMetadata.companies) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'User not associated with any company'
        });
      }

      if (!userMetadata.companies.is_active) {
        return res.status(403).json({
          error: 'Account suspended',
          message: 'Company account is not active'
        });
      }

      // Add user and company info to request object
      req.user = {
        id: user.id,
        email: user.email,
        name: user.user_metadata?.name,
        role: userMetadata.role,
        company: userMetadata.companies
      };

      logger.info('User authenticated successfully:', {
        userId: user.id,
        companyId: userMetadata.companies.id,
        role: userMetadata.role
      });

      next();
    } catch (dbError) {
      logger.error('Database error during authentication:', dbError);
      return res.status(500).json({
        error: 'Authentication error',
        message: 'Failed to verify user permissions'
      });
    }

  } catch (error) {
    logger.error('Auth middleware error:', error);
    return res.status(500).json({
      error: 'Authentication error',
      message: 'Internal server error during authentication'
    });
  }
};

// Optional middleware for role-based access control
const requireRole = (requiredRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'User not authenticated'
      });
    }

    const userRole = req.user.role;
    const allowedRoles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: `Required role: ${allowedRoles.join(' or ')}, current role: ${userRole}`
      });
    }

    next();
  };
};

// Middleware to check if company has tokens
const requireTokens = (req, res, next) => {
  if (!req.user || !req.user.company) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Company information not available'
    });
  }

  if (req.user.company.tokens_remaining <= 0) {
    return res.status(402).json({
      error: 'Insufficient tokens',
      message: 'Company has no remaining tokens'
    });
  }

  next();
};

module.exports = authMiddleware;
module.exports.requireRole = requireRole;
module.exports.requireTokens = requireTokens;