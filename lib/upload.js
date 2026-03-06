/**
 * upload.js — Cloud upload subroutine
 *
 * Enabled via: node crawl.js --url <...> --upload --provider r2|s3
 *
 * Configure via environment variables (or a .env file loaded by dotenv):
 *
 * For Cloudflare R2:
 *   CLOUD_BUCKET_NAME=your-bucket-name
 *   CLOUD_ACCOUNT_ID=your-cf-account-id      (R2 only)
 *   CLOUD_ACCESS_KEY=your-access-key-id
 *   CLOUD_SECRET_KEY=your-secret-access-key
 *   CLOUD_KEY_PREFIX=boards                  (optional, default: "boards")
 *
 * For AWS S3:
 *   CLOUD_BUCKET_NAME=your-bucket-name
 *   CLOUD_REGION=eu-west-1                   (S3 only, default: us-east-1)
 *   CLOUD_ACCESS_KEY=your-access-key-id
 *   CLOUD_SECRET_KEY=your-secret-access-key
 *   CLOUD_KEY_PREFIX=boards                  (optional, default: "boards")
 *
 * Install dependencies when you're ready to enable this:
 *   npm install @aws-sdk/client-s3 dotenv
 *
 * Then uncomment the imports below.
 */

// import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
// import 'dotenv/config';

import { log, logError, logWarn } from './logger.js';
import fs from 'fs';
import path from 'path';

/**
 * Uploads the manifest JSON to a cloud bucket.
 * The manifest is stored at: {keyPrefix}/{boardSlug}/manifest.json
 *
 * @param {object} manifest
 * @param {'r2'|'s3'} provider
 * @param {string} localManifestPath  - also used to derive a filename
 */
export const uploadManifest = async (manifest, provider, localManifestPath) => {
  // Guard: tell the user what they need to set up
  logWarn('Upload subroutine called but @aws-sdk/client-s3 is not installed.');
  logWarn('To enable uploads, run: npm install @aws-sdk/client-s3 dotenv');
  logWarn('Then uncomment the SDK imports in lib/upload.js and remove this guard.');
  logWarn('See the comment at the top of lib/upload.js for required env vars.');

  /*
   * -------------------------------------------------------------------------
   * Uncomment everything below once you've installed the SDK and set your env vars
   * -------------------------------------------------------------------------

  const bucketName = process.env.CLOUD_BUCKET_NAME;
  const accessKey  = process.env.CLOUD_ACCESS_KEY;
  const secretKey  = process.env.CLOUD_SECRET_KEY;
  const keyPrefix  = process.env.CLOUD_KEY_PREFIX ?? 'boards';

  if (!bucketName || !accessKey || !secretKey) {
    logError('Missing cloud credentials. Check CLOUD_BUCKET_NAME, CLOUD_ACCESS_KEY, CLOUD_SECRET_KEY in your .env');
    return;
  }

  // Build the S3-compatible client (R2 and S3 use the same SDK)
  const client = buildClient(provider, { accessKey, secretKey });

  // Key: boards/my-board-name/manifest.json
  const boardSlug = slugify(manifest.board || 'untitled');
  const objectKey = `${keyPrefix}/${boardSlug}/manifest.json`;

  const body = JSON.stringify(manifest, null, 2);

  try {
    await client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
      Body: body,
      ContentType: 'application/json',
    }));
    log(`Manifest uploaded to ${provider.toUpperCase()}: s3://${bucketName}/${objectKey}`);
  } catch (err) {
    logError(`Upload failed: ${err.message}`);
  }

  * -------------------------------------------------------------------------
  */
};

/**
 * Builds an S3Client pointed at the right endpoint for the provider.
 * (Uncomment when enabling uploads)
 */
// const buildClient = (provider, { accessKey, secretKey }) => {
//   const credentials = {
//     accessKeyId: accessKey,
//     secretAccessKey: secretKey,
//   };
//
//   if (provider === 'r2') {
//     const accountId = process.env.CLOUD_ACCOUNT_ID;
//     if (!accountId) throw new Error('CLOUD_ACCOUNT_ID is required for R2');
//     return new S3Client({
//       region: 'auto',
//       endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
//       credentials,
//     });
//   }
//
//   // Default: AWS S3
//   return new S3Client({
//     region: process.env.CLOUD_REGION ?? 'us-east-1',
//     credentials,
//   });
// };

// const slugify = (str) =>
//   str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
