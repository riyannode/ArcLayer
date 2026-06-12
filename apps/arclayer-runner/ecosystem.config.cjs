module.exports = {
  apps: [
    {
      name: "arclayer-runner",
      script: "dist/index.js",
      args: "start",
      cwd: __dirname,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
