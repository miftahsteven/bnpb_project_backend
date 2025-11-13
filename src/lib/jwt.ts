import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "super-secret-bnpb";

export function signToken(payload: any) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" });
}

export function verifyToken(token: string) {
    return jwt.verify(token, JWT_SECRET);
}
