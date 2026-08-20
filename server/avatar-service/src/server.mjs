import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { mkdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createProvider } from './providers.mjs';

const PORT = Number(process.env.PORT ?? 8787);
const uploadDirectory = resolve('tmp/uploads');
await mkdir(uploadDirectory, { recursive: true });

const app = express();
const jobs = new Map();
const provider = createProvider(process.env);
const upload = multer({
  dest: uploadDirectory,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    callback(allowed ? null : new Error('只支持 JPG、PNG 或 WebP 照片。'), allowed);
  },
});

app.disable('x-powered-by');
app.use(cors({ origin: process.env.ALLOWED_ORIGIN?.split(',') ?? true }));
app.use(express.json({ limit: '64kb' }));

app.get('/health', (_request, response) => {
  response.json({ ok: true, provider: process.env.AVATAR_PROVIDER ?? 'mock' });
});

app.post('/v1/avatar/jobs', upload.single('photo'), (request, response) => {
  if (!request.file) {
    response.status(400).json({ message: '缺少 photo 文件。' });
    return;
  }
  const jobId = crypto.randomUUID();
  const job = {
    jobId,
    status: 'queued',
    progress: 5,
    message: '照片上传成功，等待生成',
    createdAt: Date.now(),
  };
  jobs.set(jobId, job);
  response.status(202).json(publicJob(job));

  void runJob(job, {
    photoPath: request.file.path,
    mimeType: request.file.mimetype,
    displayName: String(request.body.displayName ?? '我的明中都角色').slice(0, 40),
    stylePreset: String(request.body.stylePreset ?? 'ming-zhongdu-traveler').slice(0, 80),
  });
});

app.get('/v1/avatar/jobs/:jobId', (request, response) => {
  const job = jobs.get(request.params.jobId);
  if (!job) {
    response.status(404).json({ message: '没有找到该生成任务。' });
    return;
  }
  response.json(publicJob(job));
});

app.use((error, _request, response, _next) => {
  console.error('[avatar-service]', error);
  response.status(error instanceof multer.MulterError ? 400 : 500).json({
    message: error instanceof Error ? error.message : '服务器发生未知错误。',
  });
});

async function runJob(job, input) {
  job.status = 'running';
  job.progress = 10;
  try {
    const avatar = await provider.generate({
      ...input,
      onProgress: (progress, message) => {
        job.progress = Math.max(job.progress, Math.min(99, progress));
        job.message = message;
      },
    });
    validateManifest(avatar);
    job.status = 'succeeded';
    job.progress = 100;
    job.message = '角色生成完成';
    job.avatar = avatar;
  } catch (error) {
    job.status = 'failed';
    job.message = error instanceof Error ? error.message : '角色生成失败。';
  } finally {
    await unlink(input.photoPath).catch(() => undefined);
  }
}

function validateManifest(manifest) {
  const directions = ['down', 'up', 'left', 'right'];
  const valid = manifest?.version === 2
    && typeof manifest.previewUrl === 'string'
    && manifest.canvas?.width > 0
    && manifest.canvas?.height > 0
    && directions.every((direction) => typeof manifest.idle?.[direction] === 'string'
      && manifest.walk?.[direction]?.length >= 4
      && manifest.run?.[direction]?.length >= 4);
  if (!valid) throw new Error('上游返回的 v2 角色清单不完整。');
}

function publicJob(job) {
  return {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    message: job.message,
    ...(job.avatar ? { avatar: job.avatar } : {}),
  };
}

app.listen(PORT, () => {
  console.log(`Ming Zhongdu avatar service: http://localhost:${PORT}`);
  console.log(`Provider: ${process.env.AVATAR_PROVIDER ?? 'mock'}`);
});
