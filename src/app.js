require('dotenv').config();

const express = require('express');
const cors = require('cors');
const apiRoutes = require('./routes/api.routes');
const healthRoutes = require('./routes/health.routes');

const app = express();

app.use(cors());
app.use(express.json());
app.use('/api', apiRoutes);
app.use('/', healthRoutes);

module.exports = app;
