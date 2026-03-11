import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import * as crypto from 'crypto';
import rateLimit from '@fastify/rate-limit';

const prisma = new PrismaClient();

// Define input types for query parameters
interface CityQuery {
  prov_id: string;
}

interface RambuQuery {
  provinsi_id?: string;
  city_id?: string;
}

interface RegistrationBody {
  email: string;
  domain: string;
  institusi: string;
}

/**
 * Open Rambu Routes Plugin
 * Encapsulates public API routes for fetching Provinces, Cities, and Rambu data.
 */
export default async function openRambuRoutes(fastify: FastifyInstance) {

  // Register rate limiting for public endpoints
  await fastify.register(rateLimit, {
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
        key: apiKey as string,
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
  fastify.get('/provinces', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const provinces = await prisma.provinces.findMany({
        select: { prov_id: true, prov_name: true }
      });
      
      const formatted = provinces.map(p => ({
        id: p.prov_id,
        name: p.prov_name
      }));
      
      return { success: true, data: formatted };
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ success: false, message: 'Internal Server Error' });
    }
  });

  /**
   * @route   GET /api/public/cities
   * @desc    Get cities by province ID
   */
  fastify.get<{ Querystring: CityQuery }>('/cities', async (request, reply) => {
    try {
      const { prov_id } = request.query;
      if (!prov_id) return reply.code(400).send({ message: 'prov_id is required' });

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
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ success: false, message: 'Internal Server Error' });
    }
  });

  /**
   * @route   GET /api/public/rambu
   * @desc    Get published rambu data
   */
  fastify.get<{ Querystring: RambuQuery }>('/rambu', async (request, reply) => {
    try {
      const { provinsi_id, city_id } = request.query;

      // Mandatory validation for provinsi_id
      if (!provinsi_id) {
        return reply.code(400).send({ success: false, message: 'provinsi_id is mandatory.' });
      }

      const filters: any = {
        status: 'published',
        prov_id: Number(provinsi_id)
      };

      // Optional city_id filter, only if valid
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
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ success: false, message: 'Internal Server Error' });
    }
  });

  /**
   * @route   GET /api/public/rambu
   * @desc    Get published rambu data
   */
  fastify.get<{ Querystring: RambuQuery }>('/rambu-excel', async (request, reply) => {
    try {
      const { provinsi_id, city_id } = request.query;

      // Mandatory validation for provinsi_id
      if (!provinsi_id) {
        return reply.code(400).send({ success: false, message: 'provinsi_id is mandatory.' });
      }

      const filters: any = {
        status: 'published',
        prov_id: Number(provinsi_id)
      };

      // Optional city_id filter, only if valid
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
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ success: false, message: 'Internal Server Error' });
    }
  });

  /**
   * @route   GET /api/public/rambu/count
   * @desc    Get count of published rambu data (lightweight endpoint)
   */
  fastify.get<{ Querystring: RambuQuery }>('/rambu/count', async (request, reply) => {
    try {
      const { provinsi_id, city_id } = request.query;

      // Mandatory validation for provinsi_id
      if (!provinsi_id) {
        return reply.code(400).send({ success: false, message: 'provinsi_id is mandatory.' });
      }

      const filters: any = {
        status: 'published',
        prov_id: Number(provinsi_id)
      };

      // Optional city_id filter, only if valid
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
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ success: false, message: 'Internal Server Error' });
    }
  });

  /**
   * @route   POST /api/public/registrasi
   * @desc    Register for public API access
   */
  fastify.post<{ Body: RegistrationBody }>('/registrasi', async (request, reply) => {
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

      let apiKey: string;

      if (existingUser) {
        // Return existing API key
        apiKey = existingUser.key || '';
        return {
          success: true,
          message: 'Email already registered. Your existing API key has been sent to your email.',
          email: email
        };
      } else {
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
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ success: false, message: 'Internal Server Error' });
    }
  });
  
}
