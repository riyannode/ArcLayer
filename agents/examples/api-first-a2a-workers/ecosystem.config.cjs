module.exports = {
  apps: [
    {
      name: 'creator-worker',
      cwd: __dirname,
      script: 'dist/index.js',
      env: { DOTENV_CONFIG_PATH: `${__dirname}/.env.creator`, DOTENV_CONFIG_OVERRIDE: 'true' },
      autorestart: true,
      max_restarts: 10,
    },
    {
      name: 'submitter-worker',
      cwd: __dirname,
      script: 'dist/index.js',
      env: { DOTENV_CONFIG_PATH: `${__dirname}/.env.submitter`, DOTENV_CONFIG_OVERRIDE: 'true' },
      autorestart: true,
      max_restarts: 10,
    },
    {
      name: 'evaluator-worker',
      cwd: __dirname,
      script: 'dist/index.js',
      env: { DOTENV_CONFIG_PATH: `${__dirname}/.env.evaluator`, DOTENV_CONFIG_OVERRIDE: 'true' },
      autorestart: true,
      max_restarts: 10,
    },
  ],
};
