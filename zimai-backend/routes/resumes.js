const express = require('express');
const router = express.Router();
const resumeController = require('../controllers/resumeController');
const { handleFileUpload } = require('../middleware/upload');
const { requireTokens, requireRole } = require('../middleware/authMiddleware');
const Joi = require('joi');
const logger = require('../utils/logger');

// Validation schemas
const schemas = {
  batchProcess: Joi.object({
    resumeIds: Joi.array()
      .items(Joi.string().uuid())
      .min(1)
      .max(10)
      .required()
  }),
  
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20)
  }),
  
  dateRange: Joi.object({
    startDate: Joi.date().iso(),
    endDate: Joi.date().iso().min(Joi.ref('startDate'))
  })
};

// Validation middleware
const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body.resumeIds ? req.body : req.query);
    
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        message: error.details[0].message,
        details: error.details
      });
    }
    
    // Merge validated values back
    if (req.body.resumeIds) {
      req.body = { ...req.body, ...value };
    } else {
      req.query = { ...req.query, ...value };
    }
    
    next();
  };
};

// Routes

/**
 * @swagger
 * /api/resumes/company/{companyId}/upload:
 *   post:
 *     summary: Upload and process a resume
 *     description: Upload a PDF resume and process it with AI scoring
 *     parameters:
 *       - in: path
 *         name: companyId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               resume:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Resume processed successfully
 *       400:
 *         description: Invalid file or validation error
 *       402:
 *         description: Insufficient tokens
 *       500:
 *         description: Processing failed
 */
router.post('/company/:companyId/upload', 
  requireTokens,
  handleFileUpload,
  resumeController.processResume
);

/**
 * @swagger
 * /api/resumes/{resumeId}:
 *   get:
 *     summary: Get resume details
 *     parameters:
 *       - in: path
 *         name: resumeId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 */
router.get('/:resumeId', resumeController.getResume);

/**
 * @swagger
 * /api/resumes/{resumeId}:
 *   delete:
 *     summary: Delete a resume
 *     parameters:
 *       - in: path
 *         name: resumeId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 */
router.delete('/:resumeId', 
  requireRole(['admin', 'manager']),
  resumeController.deleteResume
);

/**
 * @swagger
 * /api/resumes/company/list:
 *   get:
 *     summary: Get company resumes with pagination
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 */
router.get('/company/list',
  validate(schemas.pagination),
  resumeController.getCompanyResumes
);

/**
 * @swagger
 * /api/resumes/batch/process:
 *   post:
 *     summary: Batch process multiple resumes
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               resumeIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *                 minItems: 1
 *                 maxItems: 10
 */
router.post('/batch/process',
  requireTokens,
  requireRole(['admin', 'manager']),
  validate(schemas.batchProcess),
  resumeController.batchProcess
);

/**
 * @swagger
 * /api/resumes/analytics:
 *   get:
 *     summary: Get resume analytics for company
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 */
router.get('/analytics',
  validate(schemas.dateRange),
  resumeController.getAnalytics
);

// Health check endpoint for resume service
router.get('/health', (req, res) => {
  res.status(200).json({
    service: 'resume-processing',
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Error handling middleware for routes
router.use((error, req, res, next) => {
  logger.logError(error, req);
  
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      error: 'File too large',
      message: 'Resume file must be smaller than 10MB'
    });
  }
  
  if (error.code === 'INVALID_FILE_TYPE') {
    return res.status(400).json({
      error: 'Invalid file type',
      message: 'Only PDF files are supported'
    });
  }
  
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' 
      ? 'An unexpected error occurred' 
      : error.message
  });
});

module.exports = router;