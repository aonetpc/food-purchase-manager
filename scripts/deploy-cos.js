const COS = require('cos-nodejs-sdk-v5');
const fs = require('fs');
const path = require('path');

const cos = new COS({
  SecretId: process.env.TENCENT_SECRET_ID,
  SecretKey: process.env.TENCENT_SECRET_KEY,
});

const bucket = process.env.COS_BUCKET;
const region = process.env.COS_REGION;
const distDir = path.resolve(__dirname, '../dist');

async function uploadFile(localPath, key) {
  const data = fs.readFileSync(localPath);
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
      },
      (err) => (err ? reject(err) : resolve())
    );
  });
}

async function uploadDir(dir, prefix = '') {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stats = fs.statSync(filePath);
    const key = prefix ? prefix + '/' + file : file;

    if (stats.isDirectory()) {
      await uploadDir(filePath, key);
    } else {
      await uploadFile(filePath, key);
      console.log('Uploaded:', key);
    }
  }
}

uploadDir(distDir)
  .then(() => {
    console.log('Deployment completed!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
