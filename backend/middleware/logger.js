const pool = require('../db');

async function logOperation(userId, targetUserId, module, action, details, req) {
  try {
    const ipAddress = req?.ip || req?.connection?.remoteAddress || '';
    const userAgent = req?.headers?.['user-agent'] || '';
    
    const logId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    
    await pool.query(
      'INSERT INTO user_operation_logs (id, user_id, target_user_id, module, action, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [logId, userId, targetUserId, module, action, JSON.stringify(details), ipAddress, userAgent]
    );
  } catch (err) {
    console.error('Failed to log operation:', err);
  }
}

module.exports = {
  logOperation,
};