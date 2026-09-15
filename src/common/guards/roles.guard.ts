import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtPayload } from '../../auth/types/jwt-payload.type';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { UserRole } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (!requiredRoles?.length) {
            return true;
        }

        const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();

        if (!request.user || !requiredRoles.includes(request.user.role as UserRole)) {
            throw new ForbiddenException('You do not have permission to perform this action');
        }

        return true;
    }
}
