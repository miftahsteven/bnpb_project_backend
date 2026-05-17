"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = openRambuRoutes;
const client_1 = require("@prisma/client");
const nodemailer = __importStar(require("nodemailer"));
const crypto = __importStar(require("crypto"));
const rate_limit_1 = __importDefault(require("@fastify/rate-limit"));
const prisma = new client_1.PrismaClient();
/**
 * Open Rambu Routes Plugin
 * Encapsulates public API routes for fetching Provinces, Cities, and Rambu data.
 */
async function openRambuRoutes(fastify) {
    // Register rate limiting for public endpoints
    await fastify.register(rate_limit_1.default, {
        max: 30,
        timeWindow: '1 minute',
        cache: 10000,
        allowList: ['127.0.0.1'], // Allow localhost for testing
        skipOnError: true
    });
    // Global Middleware for API Key validation
    fastify.addHook('preHandler', async (request, reply) => {
        // Exclude registrasi endpoint from API key validation
        if (request.url.includes('/registrasi')) {
            return;
        }
        const apiKey = request.headers['x-api-key'];
        if (!apiKey) {
            return reply.code(401).send({ message: 'Unauthorized: Api Key Wajib Diisi' });
        }
        // Check if API key exists in user_openapi table
        const user = await prisma.user_openapi.findFirst({
            where: {
                key: apiKey,
                //status: { in: [1] }
            }
        });
        //if status user = 0
        if (user?.status === 0) {
            return reply.code(401).send({ message: 'Unauthorized: Akun Kamu Ter-suspend. Hubungi Admin' });
        }
        if (!user) {
            return reply.code(401).send({ message: 'Unauthorized: API Key Tidak Terdaftar' });
        }
    });
    /**
     * @route   GET /api/public/provinces
     * @desc    Get all provinces
     */
    fastify.get('/provinces', async (request, reply) => {
        try {
            const provinces = await prisma.provinces.findMany({
                select: { prov_id: true, prov_name: true }
            });
            const formatted = provinces.map(p => ({
                id: p.prov_id,
                name: p.prov_name
            }));
            return { success: true, data: formatted };
        }
        catch (error) {
            request.log.error(error);
            return reply.code(500).send({ success: false, message: 'Internal Server Error' });
        }
    });
    /**
     * @route   GET /api/public/categories
     * @desc    Get all categories
     */
    fastify.get('/categories', async (request, reply) => {
        try {
            const data = await prisma.category.findMany({
                select: { id: true, name: true, code: true }
            });
            return { success: true, data };
        }
        catch (error) {
            request.log.error(error);
            return reply.code(500).send({ success: false, message: 'Internal Server Error' });
        }
    });
    /**
     * @route   GET /api/public/models
     * @desc    Get all models
     */
    fastify.get('/models', async (request, reply) => {
        try {
            const data = await prisma.model.findMany({
                select: { id: true, name: true }
            });
            return { success: true, data };
        }
        catch (error) {
            request.log.error(error);
            return reply.code(500).send({ success: false, message: 'Internal Server Error' });
        }
    });
    /**
     * @route   GET /api/public/disaster-types
     * @desc    Get all disaster types
     */
    fastify.get('/disaster-types', async (request, reply) => {
        try {
            const data = await prisma.disasterType.findMany({
                select: { id: true, name: true, code: true }
            });
            return { success: true, data };
        }
        catch (error) {
            request.log.error(error);
            return reply.code(500).send({ success: false, message: 'Internal Server Error' });
        }
    });
    /**
     * @route   GET /api/public/cities
     * @desc    Get cities by province ID
     */
    fastify.get('/cities', async (request, reply) => {
        try {
            const { prov_id } = request.query;
            if (!prov_id)
                return reply.code(400).send({ message: 'prov_id is required' });
            const cities = await prisma.cities.findMany({
                where: { prov_id: Number(prov_id) },
                select: { city_id: true, city_name: true, prov_id: true }
            });
            const formatted = cities.map(c => ({
                id: c.city_id,
                name: c.city_name,
                province_id: c.prov_id
            }));
            return { success: true, data: formatted };
        }
        catch (error) {
            request.log.error(error);
            return reply.code(500).send({ success: false, message: 'Internal Server Error' });
        }
    });
    /**
     * @route   GET /api/public/rambu
     * @desc    Get published rambu data
     */
    fastify.get('/rambu', async (request, reply) => {
        try {
            const { provinsi_id, city_id } = request.query;
            const filters = {
                status: 'published'
            };
            if (provinsi_id && !isNaN(Number(provinsi_id))) {
                filters.prov_id = Number(provinsi_id);
            }
            if (city_id && !isNaN(Number(city_id))) {
                filters.city_id = Number(city_id);
            }
            const data = await prisma.rambu.findMany({
                where: filters,
                include: {
                    provinces: { select: { prov_name: true } },
                    cities: { select: { city_name: true } },
                    districts: { select: { dis_name: true } },
                    subdistricts: { select: { subdis_name: true } },
                    category: { select: { name: true } },
                    disasterType: { select: { name: true } },
                    photos: { select: { url: true } },
                    RambuProps: {
                        include: {
                            costsource: { select: { name: true } },
                            model_RambuProps_modelTomodel: { select: { name: true } }
                        },
                        orderBy: { id: 'desc' },
                        take: 1
                    },
                    // owner relation does not exist in schema
                    // owner: { select: { name: true } } 
                }
            });
            const formattedData = data.map((item) => ({
                id: item.id,
                name: item.name,
                address: null, // item.address does not exist in Rambu model
                latitude: item.lat,
                longitude: item.lng, // item.lng in schema, item.long in original code
                province: item.provinces?.prov_name,
                city: item.cities?.city_name,
                district: item.districts?.dis_name,
                subdistrict: item.subdistricts?.subdis_name,
                category: item.category?.name,
                source_fund: item.RambuProps?.[0]?.costsource?.name || null,
                model: item.RambuProps?.[0]?.model_RambuProps_modelTomodel?.name || null,
                disaster_type: item.disasterType?.name || null,
                // owner: item.owner?.name,
                condition: null, // item.condition does not exist in Rambu model
                published_at: item.updatedAt,
                photos: item.photos?.map(p => {
                    const url = p.url || '';
                    const host = request.headers.host || 'localhost:8044';
                    const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
                    if (url.startsWith('http://') || url.startsWith('https://')) {
                        if (!isLocal && (url.includes('localhost') || url.includes('127.0.0.1'))) {
                            return url.replace(/^http:\/\/localhost(:\d+)?/, 'https://rambu-api.bnpb.go.id');
                        }
                        return url;
                    }
                    const protocol = isLocal ? 'http' : 'https';
                    let cleanPath = url.startsWith('/') ? url : `/${url}`;
                    if (!cleanPath.startsWith('/public')) {
                        cleanPath = `/public${cleanPath}`;
                    }
                    return isLocal
                        ? `${protocol}://${host}${cleanPath}`
                        : `https://rambu-api.bnpb.go.id${cleanPath}`;
                }) || []
            }));
            if (formattedData.length === 0) {
                return {
                    success: true,
                    count: 0,
                    data: [],
                    message: 'Rambu pada provinsi tersebut tidak ada'
                };
            }
            return {
                success: true,
                count: formattedData.length,
                data: formattedData
            };
        }
        catch (error) {
            request.log.error(error);
            return reply.code(500).send({ success: false, message: 'Internal Server Error' });
        }
    });
    /**
     * @route   GET /api/public/rambu
     * @desc    Get published rambu data
     */
    fastify.get('/rambu-excel', async (request, reply) => {
        try {
            const { provinsi_id, city_id } = request.query;
            const filters = {
                status: 'published'
            };
            if (provinsi_id && !isNaN(Number(provinsi_id))) {
                filters.prov_id = Number(provinsi_id);
            }
            if (city_id && !isNaN(Number(city_id))) {
                filters.city_id = Number(city_id);
            }
            const data = await prisma.rambu.findMany({
                where: filters,
                include: {
                    provinces: { select: { prov_name: true } },
                    cities: { select: { city_name: true } },
                    districts: { select: { dis_name: true } },
                    subdistricts: { select: { subdis_name: true } },
                    category: { select: { name: true } },
                    disasterType: { select: { name: true } },
                    RambuProps: {
                        include: {
                            costsource: { select: { name: true } },
                            model_RambuProps_modelTomodel: { select: { name: true } }
                        },
                        orderBy: { id: 'desc' },
                        take: 1
                    },
                    // owner relation does not exist in schema
                    // owner: { select: { name: true } } 
                }
            });
            const formattedData = data.map((item) => ({
                id: item.id,
                name: item.name,
                address: null, // item.address does not exist in Rambu model
                latitude: item.lat,
                longitude: item.lng, // item.lng in schema, item.long in original code
                province: item.provinces?.prov_name,
                city: item.cities?.city_name,
                district: item.districts?.dis_name,
                subdistrict: item.subdistricts?.subdis_name,
                category: item.category?.name,
                source_fund: item.RambuProps?.[0]?.costsource?.name || null,
                model: item.RambuProps?.[0]?.model_RambuProps_modelTomodel?.name || null,
                disaster_type: item.disasterType?.name || null,
                // owner: item.owner?.name,
                condition: null, // item.condition does not exist in Rambu model
                published_at: item.updatedAt
            }));
            if (formattedData.length === 0) {
                return {
                    success: true,
                    count: 0,
                    data: [],
                    message: 'Rambu pada provinsi tersebut tidak ada'
                };
            }
            return {
                success: true,
                count: formattedData.length,
                data: formattedData
            };
        }
        catch (error) {
            request.log.error(error);
            return reply.code(500).send({ success: false, message: 'Internal Server Error' });
        }
    });
    /**
     * @route   GET /api/public/rambu/count
     * @desc    Get count of published rambu data (lightweight endpoint)
     */
    fastify.get('/rambu/count', async (request, reply) => {
        try {
            const { provinsi_id, city_id } = request.query;
            const filters = {
                status: 'published'
            };
            if (provinsi_id && !isNaN(Number(provinsi_id))) {
                filters.prov_id = Number(provinsi_id);
            }
            if (city_id && !isNaN(Number(city_id))) {
                filters.city_id = Number(city_id);
            }
            // Use count() instead of findMany() for better performance
            const count = await prisma.rambu.count({
                where: filters
            });
            return {
                success: true,
                count,
                filters: { provinsi_id, city_id: city_id || null }
            };
        }
        catch (error) {
            request.log.error(error);
            return reply.code(500).send({ success: false, message: 'Internal Server Error' });
        }
    });
    /**
     * @route   GET /api/public/rambu/radius
     * @desc    Get published rambu data within a radius
     */
    fastify.get('/rambu/radius', async (request, reply) => {
        try {
            const { lat, lng, radius } = request.query;
            if (!lat || !lng || !radius) {
                return reply.code(400).send({ success: false, message: 'lat, lng, and radius are mandatory.' });
            }
            const centerLat = parseFloat(lat);
            const centerLng = parseFloat(lng);
            const radiusKm = parseFloat(radius);
            const latDelta = radiusKm / 111;
            const lngDelta = radiusKm / (111 * Math.cos(centerLat * (Math.PI / 180)));
            const minLat = centerLat - latDelta;
            const maxLat = centerLat + latDelta;
            const minLng = centerLng - lngDelta;
            const maxLng = centerLng + lngDelta;
            const data = await prisma.rambu.findMany({
                where: {
                    status: 'published',
                    lat: { gte: minLat, lte: maxLat },
                    lng: { gte: minLng, lte: maxLng }
                },
                include: {
                    provinces: { select: { prov_name: true } },
                    cities: { select: { city_name: true } },
                    districts: { select: { dis_name: true } },
                    subdistricts: { select: { subdis_name: true } },
                    category: { select: { name: true } },
                    disasterType: { select: { name: true } },
                    photos: { select: { url: true } },
                    RambuProps: {
                        include: {
                            costsource: { select: { name: true } },
                            model_RambuProps_modelTomodel: { select: { name: true } }
                        },
                        orderBy: { id: 'desc' },
                        take: 1
                    }
                }
            });
            const calculateDistance = (lat1, lon1, lat2, lon2) => {
                const R = 6371; // Radius of the earth in km
                const dLat = (lat2 - lat1) * (Math.PI / 180);
                const dLon = (lon2 - lon1) * (Math.PI / 180);
                const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
                        Math.sin(dLon / 2) * Math.sin(dLon / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                return R * c;
            };
            const filteredData = data.filter(item => {
                if (item.lat == null || item.lng == null)
                    return false;
                const dist = calculateDistance(centerLat, centerLng, item.lat, item.lng);
                return dist <= radiusKm;
            });
            const formattedData = filteredData.map((item) => ({
                id: item.id,
                name: item.name,
                address: null,
                latitude: item.lat,
                longitude: item.lng,
                province: item.provinces?.prov_name,
                city: item.cities?.city_name,
                district: item.districts?.dis_name,
                subdistrict: item.subdistricts?.subdis_name,
                category: item.category?.name,
                source_fund: item.RambuProps?.[0]?.costsource?.name || null,
                model: item.RambuProps?.[0]?.model_RambuProps_modelTomodel?.name || null,
                disaster_type: item.disasterType?.name || null,
                published_at: item.updatedAt,
                photos: item.photos?.map(p => {
                    const url = p.url || '';
                    const host = request.headers.host || 'localhost:8044';
                    const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
                    if (url.startsWith('http://') || url.startsWith('https://')) {
                        if (!isLocal && (url.includes('localhost') || url.includes('127.0.0.1'))) {
                            return url.replace(/^http:\/\/localhost(:\d+)?/, 'https://rambu-api.bnpb.go.id');
                        }
                        return url;
                    }
                    const protocol = isLocal ? 'http' : 'https';
                    let cleanPath = url.startsWith('/') ? url : `/${url}`;
                    if (!cleanPath.startsWith('/public')) {
                        cleanPath = `/public${cleanPath}`;
                    }
                    return isLocal
                        ? `${protocol}://${host}${cleanPath}`
                        : `https://rambu-api.bnpb.go.id${cleanPath}`;
                }) || []
            }));
            return {
                success: true,
                count: formattedData.length,
                data: formattedData
            };
        }
        catch (error) {
            request.log.error(error);
            return reply.code(500).send({ success: false, message: 'Internal Server Error' });
        }
    });
    /**
     * @route   POST /api/public/registrasi
     * @desc    Register for public API access
     */
    fastify.post('/registrasi', async (request, reply) => {
        try {
            const { email, domain, institusi } = request.body;
            // Validate email format
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!email || !emailRegex.test(email)) {
                return reply.code(400).send({ success: false, message: 'Invalid email format' });
            }
            // Validate domain format
            const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
            if (!domain || !domainRegex.test(domain)) {
                return reply.code(400).send({ success: false, message: 'Invalid domain format. Example: example.com' });
            }
            // Validate institusi is provided
            if (!institusi || institusi.trim() === '') {
                return reply.code(400).send({ success: false, message: 'Institusi is required' });
            }
            // Check if email already exists in user_openapi
            const existingUser = await prisma.user_openapi.findFirst({
                where: { email: email }
            });
            let apiKey;
            if (existingUser) {
                // Return existing API key
                apiKey = existingUser.key || '';
                return {
                    success: true,
                    message: 'Email already registered. Your existing API key has been sent to your email.',
                    email: email
                };
            }
            else {
                // Generate unique API key
                apiKey = `bnpb_${crypto.randomBytes(16).toString('hex')}_${Date.now()}`;
                // Store user in user_openapi table with domain and institusi
                await prisma.user_openapi.create({
                    data: {
                        email: email,
                        key: apiKey,
                        domain: domain,
                        institusi: institusi,
                        status: 1
                    }
                });
            }
            // Configure email transporter
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: Number(process.env.SMTP_PORT),
                secure: false, // true for 465, false for other ports
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS
                }
            });
            // Email content
            const mailOptions = {
                from: `"BNPB Open Data" <${process.env.SMTP_USER}>`,
                to: email,
                subject: 'API Key - BNPB Open Data',
                html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2c3e50;">Selamat Datang di BNPB Open Data API</h2>
            <p>Terima kasih telah mendaftar untuk mengakses BNPB Open Data API.</p>
            <p>Berikut adalah API Key Anda:</p>
            <div style="background-color: #f4f4f4; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <code style="font-size: 14px; color: #e74c3c; word-break: break-all;">${apiKey}</code>
            </div>
            <p><strong>Cara Penggunaan:</strong></p>
            <ol>
              <li>Gunakan API Key ini pada header request Anda dengan key: <code>x-api-key</code></li>
              <li>Endpoint tersedia:
                <ul>
                  <li>GET /api/public/provinces - Daftar provinsi</li>
                  <li>GET /api/public/cities?prov_id={id} - Daftar kota/kabupaten</li>
                  <li>GET /api/public/rambu?provinsi_id={id}&city_id={id} - Data rambu bencana</li>
                </ul>
              </li>
            </ol>
            <p style="color: #7f8c8d; font-size: 12px; margin-top: 30px;">
              Simpan API Key ini dengan aman. Jangan bagikan kepada pihak yang tidak berwenang.
            </p>
          </div>
        `
            };
            // Send email
            await transporter.sendMail(mailOptions);
            return {
                success: true,
                message: 'Registration successful. API key has been sent to your email.',
                email: email
            };
        }
        catch (error) {
            request.log.error(error);
            return reply.code(500).send({ success: false, message: 'Internal Server Error' });
        }
    });
}
