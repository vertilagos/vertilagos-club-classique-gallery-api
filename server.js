const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors({
  origin: ['https://verti.ng', 'http://verti.ng'],
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

// Main folder ID from environment variable
const MAIN_FOLDER_ID = process.env.MAIN_FOLDER_ID;

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
    console.error('Error fetching gallery folders:', error);
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
    
    // Generate direct view links for images
    const images = response.data.files.map(file => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      thumbnailLink: file.thumbnailLink,
      imageUrl: `https://drive.google.com/uc?export=view&id=${file.id}`,
      downloadUrl: file.webContentLink,
      createdTime: file.createdTime
    }));
    
    return images;
  } catch (error) {
    console.error('Error fetching images:', error);
    throw error;
  }
}

/**
 * Get complete gallery structure
 */
async function getCompleteGallery() {
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
    
    return galleries;
  } catch (error) {
    console.error('Error fetching complete gallery:', error);
    throw error;
  }
}

// API Endpoints

/**
 * GET /api/galleries
 * Returns all gallery folders with their images
 */
app.get('/api/galleries', async (req, res) => {
  try {
    const galleries = await getCompleteGallery();
    res.json({
      success: true,
      count: galleries.length,
      data: galleries
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch galleries',
      message: error.message
    });
  }
});

/**
 * GET /api/galleries/:folderId
 * Returns images from a specific gallery folder
 */
app.get('/api/galleries/:folderId', async (req, res) => {
  try {
    const { folderId } = req.params;
    const images = await getImagesFromFolder(folderId);
    res.json({
      success: true,
      count: images.length,
      data: images
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch gallery images',
      message: error.message
    });
  }
});

/**
 * GET /api/folders
 * Returns only the folder list (lighter request)
 */
app.get('/api/folders', async (req, res) => {
  try {
    const folders = await getGalleryFolders();
    res.json({
      success: true,
      count: folders.length,
      data: folders
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch folders',
      message: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Main folder ID: ${MAIN_FOLDER_ID}`);
});
