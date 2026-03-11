import Hashids from 'hashids';

const hashids = new Hashids("BNPB_RAMBU_API_SECRET_SALT", 8); // Minimum length 8

export function encodeId(id: number): string {
    return hashids.encode(id);
}

export function decodeId(hash: string | number): number | null {
    if (typeof hash === 'number') return hash; // Fallback if already number
    
    const decoded = hashids.decode(hash);
    
    if (decoded.length === 0) {
        return null;
    }
    
    return Number(decoded[0]);
}
