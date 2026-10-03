import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';

const user = {
  sub: '22222222-2222-4222-8222-222222222222',
  tenant_id: '11111111-1111-4111-8111-111111111111',
  role: 'CASHIER',
};
const shiftId = '66666666-6666-4666-8666-666666666666';

describe('ShiftsController ValidationPipe', () => {
  let app: INestApplication;
  let close: jest.Mock;

  beforeEach(async () => {
    close = jest.fn<any>().mockResolvedValue({ shift_id: shiftId, status: 'CLOSED' });
    const moduleRef = await Test.createTestingModule({
      controllers: [ShiftsController],
      providers: [{ provide: ShiftsService, useValue: { open: jest.fn(), current: jest.fn(), summary: jest.fn(), close } }],
    })
      .overrideGuard(JwtGuard)
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().user = user;
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    ['an empty JSON object', () => request(app.getHttpServer()).post(`/shifts/${shiftId}/close`).send({})],
    ['no request body', () => request(app.getHttpServer()).post(`/shifts/${shiftId}/close`)],
  ])('accepts %s for the empty V1 CloseShiftDto over real HTTP', async (_case, send) => {
    await send().expect(201);
    expect(close).toHaveBeenCalledWith(user, shiftId, expect.anything());
  });

  it('rejects legacy closing cash fields before the service runs', async () => {
    await request(app.getHttpServer()).post(`/shifts/${shiftId}/close`).send({ closing_cash: 100 }).expect(400);
    expect(close).not.toHaveBeenCalled();
  });
});
