// src/db/db.js
// src/db/db.js
import pg from 'pg';
const { Pool } = pg;
// Configure database using environment variables
const pool = new Pool({
    user: process.env.DB_USER,       // e.g., 'postgres'
    host: process.env.DB_HOST,       // e.g., 'localhost'
    database: process.env.DB_NAME,   // e.g., 'civkit_escrow'
    password: String(process.env.DB_PASSWORD),
    port: parseInt(process.env.DB_PORT || '5432'), // Default PostgreSQL port
});

/**
 * A generic query function to run queries against the database.
 * @param text The SQL query text.
 * @param params Parameters for the SQL query.
 * @returns A promise that resolves to the query result.
 */
const query = async (text, params) => {
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        console.log('executed query', { text, duration, rows: res.rowCount });
        return res;
    } catch (error) {
        console.error('query error', { text, error });
        throw error;
    }
};

// Export both the pool for direct access and the query function for convenience
export { pool, query };
