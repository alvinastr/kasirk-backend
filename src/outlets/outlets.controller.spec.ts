import { Test, TestingModule } from '@nestjs/testing';
import { OutletsController } from './outlets.controller';

describe('OutletsController', () => {
  let controller: OutletsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OutletsController],
    }).compile();

    controller = module.get<OutletsController>(OutletsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
