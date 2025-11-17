module.exports = {
  apps: [
    {
      name: 'api-mrb',
      script: 'src/index.ts',
      interpreter: '/usr/local/bin/ts-node',
      interpreter_args: '-r tsconfig-paths/register',
      watch: true,
      env: {
        NODE_ENV: 'development',
        PORT: 8044
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 8044
      },
    },
  ],
};

