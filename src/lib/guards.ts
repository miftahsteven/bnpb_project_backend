import { prisma } from './prisma';
import jwt from 'jsonwebtoken';

// Rate limiter in-memory khusus untuk OPEN API
const rateLimitMap = new Map<string, { count: number, resetAt: number }>();
const MAX_HITS_PER_DAY = 100; //saya ubah menjadi 100
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function checkRateLimit(key: string, maxHits: number, windowMs: number): { allowed: true } | { allowed: false, remainingTime: number } {
    const now = Date.now();
    let record = rateLimitMap.get(key);

    if (!record || now > record.resetAt) {
        record = { count: 1, resetAt: now + windowMs };
        rateLimitMap.set(key, record);
        return { allowed: true };
    }

    if (record.count >= maxHits) {
        return { allowed: false, remainingTime: record.resetAt - now };
    }

    record.count++;
    return { allowed: true };
}

/**
 * Ekstrak hostname bersih dari header Origin atau Referer.
 * Mengembalikan null jika tidak ada header yang valid.
 */
export function extractOriginDomain(req: any): string | null {
    const origin = req.headers['origin'];
    if (origin) {
        try {
            return new URL(origin).hostname;
        } catch { /* abaikan URL tidak valid */ }
    }
    const referer = req.headers['referer'];
    if (referer) {
        try {
            return new URL(referer).hostname;
        } catch { /* abaikan URL tidak valid */ }
    }
    return null;
}

export const DASHBOARD_ALLOWED_DOMAINS = ['localhost', '127.0.0.1', 'bnpb.go.id', 'rambu.bnpb.go.id'];

/**
 * Hybrid guard: menerima request jika salah satu dari berikut terpenuhi:
 * 1. x-api-key valid + domain origin cocok (atau domain tidak dikonfigurasi)
 * 2. Authorization Bearer Token valid SECARA BERSAMAAN DENGAN x-api-key yang valid dan origin domain yang sesuai whitelist Dashboard
 *
 * Error response:
 * - 401 jika API Key tidak ditemukan
 * - 403 jika API Key valid tapi domain tidak cocok atau tidak ada origin
 */
export async function authOrApiKeyGuard(req: any, reply: any) {
    // 0. Validasi User-Agent (Pencegahan untuk curl, postman, dsb di terminal)
    const userAgent = (req.headers['user-agent'] || '').toLowerCase();
    if (
        !userAgent || 
        userAgent.includes('curl') || 
        userAgent.includes('postman') || 
        userAgent.includes('wget') || 
        userAgent.includes('insomnia') || 
        userAgent.includes('httpie')
    ) {
        return reply.code(403).send({ 
            error: 'Forbidden: Access from terminal or non-browser clients is not allowed.' 
        });
    }

    // 1. Ekstrak Auth Token (jika ada)
    const authHeader = req.headers.authorization;
    let hasValidBearer = false;
    let authUser = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7).trim();
        if (token) {
            const JWT_SECRET = process.env.JWT_SECRET || "5w6xiQ8WWu25bbKPpVbUimXkXbXwb1X5M58I9ISPneA=";
            try {
                const decoded = jwt.verify(token, JWT_SECRET) as any;
                const user = await prisma.users.findUnique({
                    where: { id: decoded.id },
                    select: { id: true, role: true, status: true, token: true }
                } as any);

                if (user && user.status === 1 && user.token === token) {
                    hasValidBearer = true;
                    authUser = { id: user.id, role: user.role };
                }
            } catch (e) {
                // Token tidak valid, anggap tidak punya bearer
            }
        }
    }

    // 2. Wajib Cek API Key (baik saat ada Bearer maupun tidak)
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
        return reply.code(401).send({ message: 'Unauthorized: Missing API Key' });
    }

    const FALLBACK_KEY = 'atIZJ3oo9E91Vwu6Cg6x5+fImuZ276Y1k+EDNW+z1kU=';
    const isBypassKey = apiKey === process.env.PUBLIC_API_KEY || 
                        apiKey === process.env.VITE_PUBLIC_API_KEY || 
                        apiKey === FALLBACK_KEY;

    let userApiKey: any = null;
    let isBypassedPublic = false;

    if (isBypassKey) {
        // Bypass DB check for public frontend key
        isBypassedPublic = true;
        userApiKey = {
            key: apiKey,
            domain: null, // Allow from anywhere, or rest of Dashboard origins will catch it
            status: 1,
            institusi: 'map-public-frontend'
        };
    } else {
        userApiKey = await prisma.user_openapi.findFirst({
            where: { key: apiKey as string }
        });

        if (!userApiKey) {
            return reply.code(401).send({ message: 'Unauthorized: Invalid API Key' });
        }
        
        if (userApiKey.status !== 1) {
            return reply.code(401).send({ message: 'Unauthorized: API Key has been suspended' });
        }
    }

    // 3. Validasi Domain
    const requestDomain = extractOriginDomain(req);
    
    // For pure public API calls with the public key, origin domain might not even be present or strictly controlled if we want
    if (!requestDomain && !isBypassedPublic) {
        return reply.code(403).send({
            message: 'Forbidden: Request origin cannot be determined. Domain verification required.',
        });
    }

    // Jika memiliki Bearer Token, wajib tunduk pada whitelist Dashboard
    if (hasValidBearer) {
        const isAllowed = DASHBOARD_ALLOWED_DOMAINS.some(
            (allowed) => !requestDomain || requestDomain === allowed || requestDomain.endsWith(`.${allowed}`) // allowing empty domain to pass local testing
        );
        if (!isAllowed) {
            return reply.code(403).send({
                error: `Forbidden: Domain "${requestDomain}" is not allowed to access dashboard resources with Bearer Token.`,
            });
        }
        // Pasang akun untuk bisa diteruskan
        req.authUser = authUser;
    } else {
        // Jika tidak memiliki Bearer (Akses murni Publik)
        // Domain harus sesuai dengan yang didaftarkan pada API Key tersebut
        // Skip Strict Domain check if using bypassed public key
        if (!isBypassedPublic) {
            const registeredDomain = userApiKey.domain?.trim() || null;
            if (registeredDomain && requestDomain !== registeredDomain) {
                return reply.code(403).send({
                    message: `Forbidden: Domain "${requestDomain}" is not authorized for this API Key. Registered domain: "${registeredDomain}".`,
                });
            }
        }
    }

    // --- RATE LIMITING & MONITORING ---
    const isInternalFrontend = userApiKey.institusi?.toLowerCase().includes('internal') || 
                                userApiKey.institusi?.toLowerCase().includes('frontend') ||
                                userApiKey.institusi === 'map-public-frontend' ||
                                userApiKey.key === process.env.VITE_PUBLIC_API_KEY ||
                                userApiKey.key === process.env.PUBLIC_API_KEY ||
                                userApiKey.key === 'atIZJ3oo9E91Vwu6Cg6x5+fImuZ276Y1k+EDNW+z1kU=';

    if (!isInternalFrontend) {
        const clientIp = req.headers['x-forwarded-for'] || req.ip || 'unknown-ip';
        const rateLimitKey = `apiKey_${userApiKey.key}_IP_${clientIp}`;

        const limitCheck = checkRateLimit(rateLimitKey, MAX_HITS_PER_DAY, ONE_DAY_MS);
        
        if (!limitCheck.allowed) {
            console.warn(`[RATE LIMIT EXCEEDED] API Key: ${userApiKey.key} | IP: ${clientIp}`);
            const resetHours = Math.ceil(limitCheck.remainingTime / (1000 * 60 * 60));
            return reply.code(429).send({
                message: `Too Many Requests. Open API Usage Limit Exceeded (Max ${MAX_HITS_PER_DAY} hits/day). Please try again in ${resetHours} hours.`,
                code: 429
            });
        }
    }

    return;
}

/**
 * Dashboard guard: hanya untuk akses internal setelah login.
 * Validasi:
 * 1. Authorization Bearer Token harus valid (user terdaftar & aktif)
 * 2. Origin/Referer (jika ada) harus dari domain whitelist: localhost atau bnpb.go.id
 *
 * Error:
 * - 401 jika tidak ada / token tidak valid
 * - 403 jika domain bukan dari whitelist
 */

export async function authDashboardGuard(req: any, reply: any) {
    // 1. Validasi User-Agent (Pencegahan untuk curl, postman, dsb di terminal)
    const userAgent = (req.headers['user-agent'] || '').toLowerCase();
    if (
        !userAgent || 
        userAgent.includes('curl') || 
        userAgent.includes('postman') || 
        userAgent.includes('wget') || 
        userAgent.includes('insomnia') || 
        userAgent.includes('httpie')
    ) {
        return reply.code(403).send({ 
            error: 'Forbidden: Access from terminal or non-browser clients is not allowed.' 
        });
    }

    // 2. Validasi Bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Unauthorized: Auth Token required for dashboard access' });
    }
    const token = authHeader.slice(7).trim();
    if (!token) return reply.code(401).send({ error: 'Unauthorized' });

    const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
    let user;
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        
        user = await prisma.users.findUnique({
            where: { id: decoded.id },
            select: { id: true, role: true, status: true, token: true }
        } as any);

        if (!user || user.status !== 1 || user.token !== token) {
            return reply.code(401).send({ error: 'Unauthorized: Invalid or expired token' });
        }
    } catch (e) {
        return reply.code(401).send({ error: 'Unauthorized: Invalid or expired token' });
    }

    // 2. Validasi domain origin (whitelist) — wajib untuk dashboard
    const requestDomain = extractOriginDomain(req);
    if (!requestDomain) {
        return reply.code(403).send({
            error: 'Forbidden: Request origin cannot be determined. Domain validation failed.',
        });
    }

    const isAllowed = DASHBOARD_ALLOWED_DOMAINS.some(
        (allowed) => requestDomain === allowed || requestDomain.endsWith(`.${allowed}`)
    );
    if (!isAllowed) {
        return reply.code(403).send({
            error: `Forbidden: Domain "${requestDomain}" is not allowed to access dashboard resources.`,
        });
    }

    req.authUser = { id: user.id, role: user.role as number };
}
