const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
  origin: ['https://verti.ng', 'http://verti.ng', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

// Google Drive API setup
const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

oauth2Client.setCredentials({
  refresh_token: process.env.REFRESH_TOKEN
});

const drive = google.drive({ version: 'v3', auth: oauth2Client });
const MAIN_FOLDER_ID = process.env.MAIN_FOLDER_ID;

// Simple Cache Object
let galleryCache = {
  data: null,
  lastUpdated: null
};
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes in milliseconds

/**
 * Helper to transform Google Drive file objects to gallery-friendly objects
 * Note: We swap the unreliable 'uc' export link for a high-res thumbnail link hack.
 */
const transformFile = (file) => ({
  id: file.id,
  name: file.name,
  mimeType: file.mimeType,
  thumbnailLink: file.thumbnailLink,
  // Replacing =s220 (default) with =s1000 for high-res preview
  imageUrl: file.thumbnailLink ? file.thumbnailLink.replace(/=s\d+/, '=s1000') : null,
  downloadUrl: file.webContentLink,
  createdTime: file.createdTime
});

/**
 * Get all subfolders within the main folder
 */
async function getGalleryFolders() {
  try {
    const response = await drive.files.list({
      q: `'${MAIN_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name, createdTime, modifiedTime)',
      orderBy: 'name'
    });
    return response.data.files;
  } catch (error) {
    console.error('Error fetching gallery folders:', error.message);
    throw error;
  }
}

/**
 * Get all images from a specific folder
 */
async function getImagesFromFolder(folderId) {
  try {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and (mimeType contains 'image/') and trashed=false`,
      fields: 'files(id, name, mimeType, thumbnailLink, webViewLink, webContentLink, createdTime)',
      orderBy: 'createdTime desc'
    });
    
    return response.data.files.map(transformFile);
  } catch (error) {
    console.error(`Error fetching images from folder ${folderId}:`, error.message);
    throw error;
  }
}

/**
 * Get complete gallery structure with basic caching logic
 */
async function getCompleteGallery(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && galleryCache.data && (now - galleryCache.lastUpdated < CACHE_DURATION)) {
    return galleryCache.data;
  }

  try {
    const folders = await getGalleryFolders();
    const galleries = await Promise.all(
      folders.map(async (folder) => {
        const images = await getImagesFromFolder(folder.id);
        return {
          id: folder.id,
          name: folder.name,
          createdTime: folder.createdTime,
          modifiedTime: folder.modifiedTime,
          imageCount: images.length,
          images: images
        };
      })
    );

    // Update Cache
    galleryCache.data = galleries;
    galleryCache.lastUpdated = now;
    return galleries;
  } catch (error) {
    console.error('Error fetching complete gallery:', error.message);
    throw error;
  }
}

// --- API Endpoints ---

app.get('/api/galleries', async (req, res) => {
  try {
    const galleries = await getCompleteGallery();
    res.json({
      success: true,
      count: galleries.length,
      cached: Date.now() - galleryCache.lastUpdated < CACHE_DURATION,
      data: galleries
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch galleries', message: error.message });
  }
});

app.get('/api/galleries/:folderId', async (req, res) => {
  try {
    const { folderId } = req.params;
    const images = await getImagesFromFolder(folderId);
    res.json({ success: true, count: images.length, data: images });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch images', message: error.message });
  }
});

app.get('/api/folders', async (req, res) => {
  try {
    const folders = await getGalleryFolders();
    res.json({ success: true, count: folders.length, data: folders });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch folders', message: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), cacheAge: galleryCache.lastUpdated });
});

// Server startup
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`-----------------------------------------`);
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📂 Monitoring Folder: ${MAIN_FOLDER_ID}`);
  console.log(`-----------------------------------------`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use. Try a different port.`);
  } else {
    console.error('❌ Server error:', err);
  }
});
