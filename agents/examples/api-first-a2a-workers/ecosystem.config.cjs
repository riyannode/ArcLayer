module.exports = {
  apps: [
    {
      name: 'creator-worker',
      cwd: __dirname,
      script: 'dist/index.js',
      env: { WORKER_ROLE: 'creator', DRY_RUN: process.env.DRY_RUN || 'true' },
      autorestart: true,
      max_restarts: 10,
    },
    {
      name: 'submitter-worker',
      cwd: __dirname,
      script: 'dist/index.js',
      env: { WORKER_ROLE: 'submitter', DRY_RUN: process.env.DRY_RUN || 'true' },
      autorestart: true,
      max_restarts: 10,
    },
    {
      name: 'evaluator-worker',
      cwd: __dirname,
      script: 'dist/index.js',
      env: { WORKER_ROLE: 'evaluator', DRY_RUN: process.env.DRY_RUN || 'true' },
      autorestart: true,
      max_restarts: 10,
    },
  ],
};
