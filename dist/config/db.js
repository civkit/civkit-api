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
const { Pool } = pg;
// Configure database using environment variables
const pool = new Pool({
    user: process.env.DB_USER, // e.g., 'postgres'
    host: process.env.DB_HOST, // e.g., 'localhost'
    database: process.env.DB_NAME, // e.g., 'civkit_escrow'
    password: String(process.env.DB_PASSWORD),
    port: parseInt(process.env.DB_PORT || '5432'), // Default PostgreSQL port
});
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
export { pool, query };
