import { OutletsController } from './outlets.controller';

describe('OutletsController', () => {
  let controller: OutletsController;

  beforeEach(() => {
    controller = new OutletsController({} as never);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
