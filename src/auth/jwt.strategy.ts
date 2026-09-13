import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import {ExtractJwt, Strategy} from "passport-jwt";
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
    validate(payload: JwtPayload) {
        return payload;
    }
}
