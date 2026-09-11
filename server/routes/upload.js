import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = Router();

router.post('/', requireAuth, (req, res) => {
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'files', maxCount: 8 },
  ])(req, res, (err) => {
    if (err) {
      const isMulter = err instanceof multer.MulterError;
      const message = isMulter && err.code === 'LIMIT_FILE_SIZE'
        ? 'File is too large. Maximum upload size is 10MB.'
        : (err.message || 'Upload failed');
      console.error('POST /api/upload failed', {
        userId: req.userId,
        code: err.code || null,
        message,
        mimetype: req.headers['content-type'] || null,
      });
      return res.status(400).json({ error: message });
    }

    const files = [
      ...(req.files?.file || []),
      ...(req.files?.files || []),
    ];

    if (files.length === 0) {
      console.error('POST /api/upload failed', {
        userId: req.userId,
        message: 'No file uploaded',
        contentType: req.headers['content-type'] || null,
        bodyKeys: req.body ? Object.keys(req.body) : [],
      });
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const urls = files.map((file) => `/uploads/${file.filename}`);
    return res.json({ url: urls[0], urls });
  });
});

export default router;
