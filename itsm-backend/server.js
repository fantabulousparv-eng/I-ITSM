const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// Connect to MongoDB
// NEW FIXED CODE
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/itsm_db')
.then(() => {
  console.log('MongoDB Connected Successfully');
}).catch((err) => {
  console.error('Database connection error:', err);
});

// Basic Test Route
app.get('/', (req, res) => {
  res.send('ITSM Backend Server is Running');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Import auth routes
const authRoutes = require('./routes/authRoutes');

// Use auth routes
app.use('/api/auth', authRoutes);


// Import incident routes
const incidentRoutes = require('./routes/incidentroutes');

// Use incident routes
app.use('/api/incidents', incidentRoutes);