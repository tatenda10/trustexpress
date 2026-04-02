import { hasPermission } from '../lib/admin-rbac.js';

export function requirePermission(permissionKey) {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!hasPermission(req.admin, permissionKey)) {
      return res.status(403).json({ error: 'Insufficient permissions', required: permissionKey });
    }

    return next();
  };
}