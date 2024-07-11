import pg from 'pg';
import { PrismaClient } from '@prisma/client';

const { Pool } = pg;

// Configure database using environment variables
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: String(process.env.DB_PASSWORD),
    port: parseInt(process.env.DB_PORT || '5432'),
});

// Initialize Prisma client
const prisma = new PrismaClient();

/**
 * A generic query function to run queries against the database.
 * @param text The SQL query text.
 * @param params Parameters for the SQL query.
 * @returns A promise that resolves to the query result.
 */
const query = async (text: any, params: any) => {
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

// Flag to determine which database connection to use
const usePrisma = process.env.USE_PRISMA === 'true';

export { pool, query, prisma, usePrisma };