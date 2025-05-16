const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const morgan = require('morgan');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');
const { createProxyMiddleware } = require('http-proxy-middleware');

// Load env
dotenv.config();


const app = express();
const PORT = process.env.PORT || 3000;

// my middleware
app.use(morgan('dev')); // Request logging
app.use(cors()); // Enable CORS for all routes
app.use(bodyParser.json()); // Parse JSON request bodies
app.use(bodyParser.urlencoded({ extended: true })); // Parse URL-encoded bodies
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files

// Configure file upload with multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    // Create uploads directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename
    const uniqueFilename = `${Date.now()}-${uuidv4()}-${file.originalname}`;
    cb(null, uniqueFilename);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB 
  },
  fileFilter: (req, file, cb) => {
    // Accept video and image files only
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPG, PNG, GIF and MP4 files are allowed.'));
    }
  }
});

// Setup in-memory database for videos (in a real app, use a proper database)
const videosDB = {
  videos: [],
  webhooks: [],
  apiKeys: {},
  users: {},
};

// API key middleware
const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key is required' });
  }
  
  // Check if API key is valid (in a real app, check against database)
  if (!Object.keys(videosDB.apiKeys).includes(apiKey)) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  // Add user info to request
  req.user = videosDB.apiKeys[apiKey];
  next();
};

// Initialize some API keys for testing
videosDB.apiKeys['test_api_key_1'] = { id: 1, name: 'Test User 1', plan: 'free' };
videosDB.apiKeys['test_api_key_2'] = { id: 2, name: 'Test User 2', plan: 'premium' };

// Webhook registration endpoint
app.post('/api/register-webhook', apiKeyAuth, (req, res) => {
  const { url } = req.body;
  const userId = req.user.id;
  
  if (!url) {
    return res.status(400).json({ error: 'Webhook URL is required' });
  }
  
  // Validate URL format
  try {
    new URL(url);
  } catch (error) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }
  
  // Add or update webhook URL for user
  const existingWebhookIndex = videosDB.webhooks.findIndex(hook => hook.userId === userId);
  
  if (existingWebhookIndex >= 0) {
    videosDB.webhooks[existingWebhookIndex].url = url;
  } else {
    videosDB.webhooks.push({ userId, url });
  }
  
  res.json({ success: true, message: 'Webhook registered successfully' });
});

// Generate video endpoint
app.post('/api/generate-video', apiKeyAuth, (req, res) => {
  const {
    prompt,
    topic = 'Random AI Story',
    voice = 'Charlie',
    theme = 'Hormozi_1',
    style = 'None',
    language = 'English',
    duration = '30-60',
    aspect_ratio = '9:16',
    custom_instruction,
  } = req.body;
  
  // Validate required fields
  if (!prompt && topic === 'Custom') {
    return res.status(400).json({ error: 'Prompt is required when topic is set to Custom' });
  }
  
  // Check user limits
  const userPlan = req.user.plan;
  const userVideos = videosDB.videos.filter(v => v.userId === req.user.id);
  
  if (userPlan === 'free' && userVideos.length >= 5) {
    return res.status(403).json({ error: 'Free plan limited to 5 videos. Please upgrade to continue.' });
  }
  
  // Generate unique vid ID
  const videoId = Math.floor(Math.random() * 1000000000000);
  
  // Create video entry
  const newVideo = {
    id: videoId,
    userId: req.user.id,
    prompt,
    topic,
    voice,
    theme,
    style,
    language,
    duration,
    aspect_ratio,
    custom_instruction,
    status: 'processing',
    created_at: new Date().toISOString(),
    completed_at: null,
    video_url: null,
    thumbnail_url: null,
  };
  
  // Add to database
  videosDB.videos.push(newVideo);
  
  simulateVideoGeneration(videoId);
  
  // Return immediately with the video ID
  res.json({ vid: videoId });
});

// Simulate video generation process
const simulateVideoGeneration = (videoId) => {
  // Find the video in our database
  const videoIndex = videosDB.videos.findIndex(v => v.id === videoId);
  
  if (videoIndex === -1) {
    console.error(`Video with ID ${videoId} not found.`);
    return;
  }
  
  const video = videosDB.videos[videoIndex];
  
  //  processing time (2-3 minutes)
  const processingTime = Math.floor(Math.random() * 60000) + 120000; 
  
  setTimeout(() => {
    // Update video status to completed
    videosDB.videos[videoIndex].status = 'completed';
    videosDB.videos[videoIndex].completed_at = new Date().toISOString();
    
    // Generate mock URLs
    const baseUrl = 'https://example.com/videos';
    videosDB.videos[videoIndex].video_url = `${baseUrl}/${videoId}.mp4`;
    videosDB.videos[videoIndex].thumbnail_url = `${baseUrl}/${videoId}_thumb.jpg`;
    
    // Find user's webhook URL
    const userId = video.userId;
    const webhook = videosDB.webhooks.find(hook => hook.userId === userId);
    
    // Send webhook notif if URL  
    if (webhook && webhook.url) {
      sendWebhookNotification(webhook.url, videosDB.videos[videoIndex]);
    }
    
    console.log(`Video ${videoId} processing completed.`);
  }, processingTime);
};

// Send webhook notif 
const sendWebhookNotification = async (webhookUrl, videoData) => {
  try {
    //  webhook payload
    const payload = {
      event: 'video.completed',
      vid: videoData.id,
      status: videoData.status,
      video_url: videoData.video_url,
      thumbnail_url: videoData.thumbnail_url,
      completed_at: videoData.completed_at,
    };
    
    // Send webhook notif 
    await axios.post(webhookUrl, payload);
    console.log(`Webhook notification sent to ${webhookUrl} for video ${videoData.id}`);
  } catch (error) {
    console.error(`Failed to send webhook notification: ${error.message}`);
  }
};

// im checking video status endpoint
app.get('/api/check-video', apiKeyAuth, (req, res) => {
  const { vid } = req.query;
  
  if (!vid) {
    return res.status(400).json({ error: 'Video ID is required' });
  }
  
  // Find video
  const videoId = parseInt(vid, 10);
  const video = videosDB.videos.find(v => v.id === videoId);
  
  if (!video) {
    return res.status(404).json({ error: 'Video not found' });
  }
  
  // Check if user has access to this video
  if (video.userId !== req.user.id) {
    return res.status(403).json({ error: 'You do not have access to this video' });
  }
  
 
  res.json({
    vid: video.id,
    status: video.status,
    video_url: video.video_url,
    thumbnail_url: video.thumbnail_url,
    created_at: video.created_at,
    completed_at: video.completed_at,
  });
});

// Get video metadata endpoint
app.get('/api/get-video-metadata', (req, res) => {
  const { id } = req.query;
  
  if (!id) {
    return res.status(400).json({ error: 'Video ID is required' });
  }
  
  // Find video
  const videoId = parseInt(id, 10);
  const video = videosDB.videos.find(v => v.id === videoId);
  
  if (!video) {
    return res.status(404).json({ error: 'Video not found' });
  }
  
  // Return public video metadata
  res.json({
    id: video.id,
    status: video.status,
    created_at: video.created_at,
    completed_at: video.completed_at,
    video_type: 'mp4',
    duration: video.duration,
    language: video.language,
    theme: video.theme,
  });
});

// Get video file endpoint (simulated)
app.get('/api/video/:id', (req, res) => {
  const { id } = req.params;
  const videoId = parseInt(id, 10);
  

  const video = videosDB.videos.find(v => v.id === videoId);
  
  if (!video) {
    return res.status(404).json({ error: 'Video not found' });
  }
  
  if (video.status !== 'completed') {
    return res.status(400).json({ error: 'Video is still processing' });
  }
  if (req.method === 'HEAD') {
    return res.status(204).end();
  }
  
  
  res.status(400).json({ error: 'Video streaming not implemented in this demo server' });
});

// my proxy for handling video requests directly from the frontend
// need bypass of CORS issues when the frontend tries to access videos
app.use('/proxy/video', createProxyMiddleware({
  target: 'https://example.com',
  changeOrigin: true,
  pathRewrite: {
    '^/proxy/video': '/videos',
  },
  onProxyRes: (proxyRes, req, res) => {
    // Add headers to allow video downloads
    proxyRes.headers['Content-Disposition'] = `attachment; filename="video_${req.params.id}.mp4"`;
  },
}));

// Upload custom media for video generation
app.post('/api/upload-media', apiKeyAuth, upload.single('media'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
 
  res.json({
    success: true,
    file: {
      id: uuidv4(),
      originalName: req.file.originalname,
      filename: req.file.filename,
      size: req.file.size,
      mimeType: req.file.mimetype,
      path: req.file.path,
    },
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  
  // Handle multer errors
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
    }
    return res.status(400).json({ error: err.message });
  }
  
  // Handle other errors
  res.status(500).json({ error: 'Internal server error' });
});


app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});


app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API is available at http://localhost:${PORT}/api`);
});


module.exports = app;