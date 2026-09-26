export interface JwtPayload {
    sub: string;
    tenant_id: string;
    role: string;
    outlet_id: string | null;
}
