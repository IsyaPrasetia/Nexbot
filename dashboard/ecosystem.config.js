module.exports = {
  apps: [
    {
      name: 'DASHBOARD',
      script: './server/index.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        PORT: 5577
      }
    }
  ]
};
