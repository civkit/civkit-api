var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
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
const query = (text, params) => __awaiter(void 0, void 0, void 0, function* () {
    const start = Date.now();
    try {
        const res = yield pool.query(text, params);
        const duration = Date.now() - start;
        console.log('executed query', { text, duration, rows: res.rowCount });
        return res;
    }
    catch (error) {
        console.error('query error', { text, error });
        throw error;
    }
});
// Flag to determine which database connection to use
const usePrisma = process.env.USE_PRISMA === 'true';
export { pool, query, prisma, usePrisma };
