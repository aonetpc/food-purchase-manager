const COS = require('cos-nodejs-sdk-v5');
const fs = require('fs');
const path = require('path');

console.log('=== Deploy to Tencent Cloud COS ===');
console.log('Environment variables:');
console.log('  TENCENT_SECRET_ID:', process.env.TENCENT_SECRET_ID ? '***' : 'NOT SET');
console.log('  TENCENT_SECRET_KEY:', process.env.TENCENT_SECRET_KEY ? '***' : 'NOT SET');
console.log('  COS_BUCKET:', process.env.COS_BUCKET || 'NOT SET');
console.log('  COS_REGION:', process.env.COS_REGION || 'NOT SET');

if (!process.env.TENCENT_SECRET_ID) {
  console.error('ERROR: TENCENT_SECRET_ID is not set');
  process.exit(1);
}

if (!process.env.TENCENT_SECRET_KEY) {
  console.error('ERROR: TENCENT_SECRET_KEY is not set');
  process.exit(1);
}

if (!process.env.COS_BUCKET) {
  console.error('ERROR: COS_BUCKET is not set');
  process.exit(1);
}

if (!process.env.COS_REGION) {
  console.error('ERROR: COS_REGION is not set');
  process.exit(1);
}

const cos = new COS({
  SecretId: process.env.TENCENT_SECRET_ID,
  SecretKey: process.env.TENCENT_SECRET_KEY,
  Logger: console,
});

const bucket = process.env.COS_BUCKET;
const region = process.env.COS_REGION;
const distDir = path.resolve(__dirname, '../dist');

console.log('\nDist directory:', distDir);

if (!fs.existsSync(distDir)) {
  console.error('ERROR: dist directory does not exist:', distDir);
  process.exit(1);
}

const filesToUpload = [];

function collectFiles(dir, prefix = '') {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stats = fs.statSync(filePath);
    const key = prefix ? prefix + '/' + file : file;
    if (stats.isDirectory()) {
      collectFiles(filePath, key);
    } else {
      filesToUpload.push({ localPath: filePath, key });
    }
  }
}

collectFiles(distDir);
console.log('\nFiles to upload:', filesToUpload.length);
filesToUpload.forEach(f => console.log('  -', f.key));

async function uploadFile(localPath, key) {
  console.log('\nUploading:', key);
  try {
    const data = fs.readFileSync(localPath);
    console.log('  Size:', data.length, 'bytes');
    const cacheControl = key.startsWith('assets/')
      ? 'max-age=31536000, immutable'
      : 'no-cache';
    return new Promise((resolve, reject) => {
      cos.putObject(
        {
          Bucket: bucket,
          Region: region,
          Key: key,
          Body: data,
          CacheControl: cacheControl,
          ContentType: getContentType(key),
        },
        (err, data) => {
          if (err) {
            console.error('  ERROR:', err.message);
            console.error('  ERROR CODE:', err.statusCode);
            console.error('  ERROR DETAIL:', JSON.stringify(err, null, 2));
            reject(err);
          } else {
            console.log('  SUCCESS:', data && data.Location);
            resolve();
          }
        }
      );
    });
  } catch (readErr) {
    console.error('  READ ERROR:', readErr.message);
    throw readErr;
  }
}

function getContentType(key) {
  const ext = path.extname(key).toLowerCase();
  const types = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.svg': 'image/svg+xml',
    '.map': 'application/json',
  };
  return types[ext] || 'application/octet-stream';
}

async function run() {
  for (const { localPath, key } of filesToUpload) {
    await uploadFile(localPath, key);
  }
  console.log('\n=== Deployment completed successfully! ===');
  process.exit(0);
}

run().catch((err) => {
  console.error('\n=== Deployment failed ===');
  console.error('Final error:', err.message);
  process.exit(1);
});
