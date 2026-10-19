const app = require('./src/app');

const PORT = process.env.PORT || 10000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('Fitness App Backend Running');
    console.log('Port:', PORT);
    console.log('Environment:', process.env.NODE_ENV || 'development');
  });
}

module.exports = app;
