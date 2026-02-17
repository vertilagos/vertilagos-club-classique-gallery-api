const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const mammoth = require('mammoth');
require('dotenv').config();

const app = express();
app.use(cors({
  origin: ['https://verti.ng', 'http://verti.ng', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

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
const NEWS_FOLDER_ID = process.env.NEWS_FOLDER_ID;

let galleryCache = { data: null, lastUpdated: null };
let newsCache = { data: null, lastUpdated: null };
const CACHE_DURATION = 10 * 60 * 1000;

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

async function getImagesFromFolder(folderId) {
  try {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and (mimeType contains 'image/') and trashed=false`,
      fields: 'files(id, name, mimeType, thumbnailLink, webViewLink, webContentLink, createdTime)',
      orderBy: 'createdTime desc'
    });
    
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
    console.error(`Error fetching images:`, error.message);
    throw error;
  }
}

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

    galleryCache.data = galleries;
    galleryCache.lastUpdated = now;
    return galleries;
  } catch (error) {
    console.error('Error fetching gallery:', error.message);
    throw error;
  }
}

async function getNewsArticles() {
  try {
    const response = await drive.files.list({
      q: `'${NEWS_FOLDER_ID}' in parents and (mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document' or mimeType='application/msword') and trashed=false`,
      fields: 'files(id, name, createdTime, modifiedTime)',
      orderBy: 'createdTime desc'
    });
    return response.data.files;
  } catch (error) {
    console.error('Error fetching news:', error.message);
    throw error;
  }
}

async function getDocumentContent(fileId) {
  try {
    const response = await drive.files.get(
      { fileId: fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    
    const result = await mammoth.convertToHtml({ buffer: Buffer.from(response.data) });
    return {
      html: result.value,
      messages: result.messages
    };
  } catch (error) {
    console.error(`Error reading document:`, error.message);
    throw error;
  }
}

function extractExcerpt(html, maxLength = 200) {
  const text = html.replace(/<[^>]*>/g, '');
  const excerpt = text.substring(0, maxLength).trim();
  return excerpt.length < text.length ? excerpt + '...' : excerpt;
}

async function getAllNewsArticles(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && newsCache.data && (now - newsCache.lastUpdated < CACHE_DURATION)) {
    return newsCache.data;
  }

  try {
    const articles = await getNewsArticles();
    
    const articlesWithExcerpts = await Promise.all(
      articles.map(async (article) => {
        try {
          const content = await getDocumentContent(article.id);
          const excerpt = extractExcerpt(content.html);
          const title = article.name.replace(/\.(docx|doc)$/i, '');
          
          return {
            id: article.id,
            title: title,
            excerpt: excerpt,
            createdTime: article.createdTime,
            modifiedTime: article.modifiedTime
          };
        } catch (error) {
          console.error(`Error processing article:`, error.message);
          return null;
        }
      })
    );

    const validArticles = articlesWithExcerpts.filter(article => article !== null);
    newsCache.data = validArticles;
    newsCache.lastUpdated = now;
    
    return validArticles;
  } catch (error) {
    console.error('Error fetching news:', error.message);
    throw error;
  }
}

app.get('/api/galleries', async (req, res) => {
  try {
    const galleries = await getCompleteGallery();
    res.json({ success: true, count: galleries.length, data: galleries });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch galleries', message: error.message });
  }
});

app.get('/api/galleries/:folderId', async (req, res) => {
  try {
    const images = await getImagesFromFolder(req.params.folderId);
    res.json({ success: true, count: images.length, data: images });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch images', message: error.message });
  }
});

app.get('/api/news', async (req, res) => {
  try {
    const articles = await getAllNewsArticles();
    res.json({ success: true, count: articles.length, data: articles });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch news', message: error.message });
  }
});

app.get('/api/news/:articleId', async (req, res) => {
  try {
    const articles = await getNewsArticles();
    const article = articles.find(a => a.id === req.params.articleId);
    
    if (!article) {
      return res.status(404).json({ success: false, error: 'Article not found' });
    }
    
    const content = await getDocumentContent(req.params.articleId);
    const title = article.name.replace(/\.(docx|doc)$/i, '');
    
    res.json({
      success: true,
      data: {
        id: article.id,
        title: title,
        content: content.html,
        createdTime: article.createdTime,
        modifiedTime: article.modifiedTime
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch article', message: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    features: ['galleries', 'news']
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server on port ${PORT}`);
  console.log(`📂 Gallery: ${MAIN_FOLDER_ID}`);
  console.log(`📰 News: ${NEWS_FOLDER_ID || 'Not set'}`);
});
