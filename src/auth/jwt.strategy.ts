import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import {ExtractJwt, Strategy} from "passport-jwt";
import { isUUID } from "class-validator";
import type { JwtPayload } from "./types/jwt-payload.type";
import { ConfigService } from '@nestjs/config';
import { getJwtSecret } from './jwt.config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    
    constructor(configService: ConfigService) {
        super({
            jwtFromRequest:
                ExtractJwt.fromAuthHeaderAsBearerToken(),

            secretOrKey:
                getJwtSecret(configService),
        });
    }

    validate(payload: JwtPayload): JwtPayload {
        if (!payload || !isUUID(payload.sub) || !isUUID(payload.tenant_id) ||
            typeof payload.role !== "string" || !payload.role.trim() ||
            (payload.outlet_id != null && !isUUID(payload.outlet_id))) {
            throw new UnauthorizedException();
        }

        return {
            sub: payload.sub,
            tenant_id: payload.tenant_id,
            role: payload.role,
            outlet_id: payload.outlet_id ?? null,
        };

    }
}
