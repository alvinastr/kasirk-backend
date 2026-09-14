import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import {ExtractJwt, Strategy} from "passport-jwt";
import { isUUID } from "class-validator";
import type { JwtPayload } from "./types/jwt-payload.type";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    
    constructor() {
        // Initialize the JWT strategy
        super({
            jwtFromRequest:
                ExtractJwt.fromAuthHeaderAsBearerToken(),

            secretOrKey:
                'kasirkita-secret',
        });
    }

    // Implement JWT strategy logic here
    validate(payload: JwtPayload): JwtPayload {
        if (!payload || !isUUID(payload.sub) || !isUUID(payload.tenant_id) ||
            typeof payload.role !== "string" || !payload.role.trim()) {
            throw new UnauthorizedException();
        }

        return {
            sub: payload.sub,
            tenant_id: payload.tenant_id,
            role: payload.role
        };

    }
}
