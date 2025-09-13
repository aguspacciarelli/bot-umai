const { MongoClient } = require('mongodb');

let db;

async function connectDB(uri, dbName) {
    try {
        const client = new MongoClient(uri);
        await client.connect();
        db = client.db(dbName);
        console.log('Conectado a MongoDB desde database.js');
        return db;
    } catch (error) {
        console.error('Error al conectar a MongoDB desde database.js:', error);
        throw error;
    }
}

function getDB() {
    if (!db) {
        throw new Error('La conexión a la base de datos no ha sido establecida.');
    }
    return db;
}

module.exports = { connectDB, getDB };