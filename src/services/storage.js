const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const logger = require('../utils/logger');

// Initialize S3 Client
// If the env variables are missing, we create a mock client for local development
let s3Client;
const isMock = !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_S3_BUCKET_NAME;

if (isMock) {
  logger.warn('⚠️  AWS S3 credentials not found. Using MOCK storage service.');
} else {
  s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  logger.info('✅ AWS S3 client initialized');
}

/**
 * Upload a file to AWS S3
 * @param {Buffer} buffer - The file buffer to upload
 * @param {string} filename - The destination filename
 * @param {string} mimeType - The MIME type of the file (e.g., 'image/jpeg')
 * @param {object} metadata - Optional metadata tags for ML training (e.g., { species: 'shrimp', disease: 'white_spot' })
 * @returns {Promise<string>} The public URL of the uploaded file
 */
async function uploadMedia(buffer, filename, mimeType = 'image/jpeg', metadata = {}) {
  const bucketName = process.env.AWS_S3_BUCKET_NAME || 'farmer-media';

  if (isMock) {
    logger.info(`[MOCK S3] Mock upload complete for ${filename}. Metadata:`, metadata);
    return `https://mock-s3.example.com/${bucketName}/${filename}`;
  }

  // Convert metadata values to strings (S3 metadata requirement)
  const stringifiedMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined && value !== null) {
      stringifiedMetadata[key] = String(value);
    }
  }

  const params = {
    Bucket: bucketName,
    Key: filename,
    Body: buffer,
    ContentType: mimeType,
    Metadata: stringifiedMetadata,
    // Note: To make the object public via ACL, the bucket must have ACLs enabled.
    // If your bucket uses Bucket Policies for public access, you can remove this.
    // ACL: 'public-read' 
  };

  try {
    const command = new PutObjectCommand(params);
    await s3Client.send(command);
    
    // Construct the public URL
    const region = process.env.AWS_REGION || 'us-east-1';
    const url = `https://${bucketName}.s3.${region}.amazonaws.com/${filename}`;
    
    logger.info(`✅ Successfully uploaded media to S3: ${url}`);
    return url;
  } catch (error) {
    logger.error('❌ Failed to upload to AWS S3:', { error: error.message, filename });
    throw error;
  }
}

module.exports = {
  uploadMedia
};
