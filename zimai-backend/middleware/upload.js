const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

// Configure multer for memory storage (files will be processed in memory)
const storage = multer.memoryStorage();

// File filter function
const fileFilter = (req, file, cb) => {
  const allowedTypes = process.env.ALLOWED_FILE_TYPES?.split(',') || ['application/pdf'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    const error = new Error(`File type not allowed. Allowed types: ${allowedTypes.join(', ')}`);
    error.code = 'INVALID_FILE_TYPE';
    cb(error, false);
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB default
    files: 1, // Only allow one file at a time
  },
});

// Error handling middleware for multer
const handleUploadError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    logger.warn('Multer upload error:', { error: error.message, code: error.code });
    
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({
          error: 'File too large',
          message: `File size must be less than ${(parseInt(process.env.MAX_FILE_SIZE) || 10485760) / 1024 / 1024}MB`
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          error: 'Too many files',
          message: 'Only one file allowed per upload'
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          error: 'Unexpected file field',
          message: 'File field name must be "resume"'
        });
      default:
        return res.status(400).json({
          error: 'Upload error',
          message: error.message
        });
    }
  }
  
  if (error && error.code === 'INVALID_FILE_TYPE') {
    return res.status(400).json({
      error: 'Invalid file type',
      message: error.message
    });
  }
  
  next(error);
};

// Middleware to validate uploaded file
const validateFile = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      error: 'No file uploaded',
      message: 'Please upload a PDF file'
    });
  }

  const file = req.file;
  
  // Additional validation
  if (file.size === 0) {
    return res.status(400).json({
      error: 'Empty file',
      message: 'Uploaded file is empty'
    });
  }

  // Check file extension as well as MIME type
  const fileExtension = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = ['.pdf'];
  
  if (!allowedExtensions.includes(fileExtension)) {
    return res.status(400).json({
      error: 'Invalid file extension',
      message: `File must have one of these extensions: ${allowedExtensions.join(', ')}`
    });
  }

  // Generate unique filename for storage
  const uniqueFilename = `${uuidv4()}${fileExtension}`;
  file.uniqueFilename = uniqueFilename;

  logger.info('File upload validated successfully:', {
    originalName: file.originalname,
    uniqueFilename: uniqueFilename,
    size: file.size,
    mimetype: file.mimetype
  });

  next();
};

// Single file upload middleware
const uploadSingle = upload.single('resume');

// Wrapper function to handle upload with error handling
const handleFileUpload = (req, res, next) => {
  uploadSingle(req, res, (error) => {
    if (error) {
      return handleUploadError(error, req, res, next);
    }
    validateFile(req, res, next);
  });
};

module.exports = {
  handleFileUpload,
  handleUploadError,
  validateFile
};