module.exports = {
  apps: [
    {
      name: 'api-mrb-supplydata',
      script: 'build/index.js', // jalankan hasil build
      watch: false,             // matikan watch di production
      instances: 1,             // bisa ubah ke 'max' untuk cluster mode
      env: {
        NODE_ENV: 'development',
        PORT: 8044,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 8044,
      },
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      time: true,
    },
  ],
};

