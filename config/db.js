const mongoose = require('mongoose');
const dbURL = process.env.ATLAS_URI;

function connectDb() {
    if (!dbURL) {
        console.error('ATLAS_URI is not set');
        process.exit(1);
    }
    return mongoose
        .connect(dbURL)
        .then(() => {
            console.log('Data base connected');
        })
        .catch((err) => {
            console.error('MongoDB connection failed:', err.message);
            process.exit(1);
        });
}

module.exports = connectDb;