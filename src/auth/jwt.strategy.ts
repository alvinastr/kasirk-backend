import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import {ExtractJwt, Strategy} from "passport-jwt";

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
    validate(payload: any) {
        return {
            user_id: payload.sub,
            tenant_id: payload.tenant_id,
            role: payload.role,
        }
    }
}
