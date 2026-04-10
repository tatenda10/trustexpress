import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = Router();

router.post('/', requireAuth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const isMulter = err instanceof multer.MulterError;
      const message = isMulter && err.code === 'LIMIT_FILE_SIZE'
        ? 'File is too large. Maximum upload size is 10MB.'
        : (err.message || 'Upload failed');
      console.error('POST /api/upload failed', {
        userId: req.userId,
        code: err.code || null,
        message,
        mimetype: req.file?.mimetype || req.headers['content-type'] || null,
      });
      return res.status(400).json({ error: message });
    }

    if (!req.file) {
      console.error('POST /api/upload failed', {
        userId: req.userId,
        message: 'No file uploaded',
      });
      return res.status(400).json({ error: 'No file uploaded' });
    }

    return res.json({ url: `/uploads/${req.file.filename}` });
  });
});

export default router;
